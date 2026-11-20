package dev.ziran.android.connection

import dev.ziran.android.protocol.AdapterRequestError
import dev.ziran.android.protocol.EnvelopeWriter
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exercises the real AdapterClient listener, reply routing and event channel
 * against an in-memory socket. No network, no staging daemon.
 */
class AdapterClientTransportTest {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var client: AdapterClient? = null

    @After
    fun tearDown() {
        client?.close()
        scope.cancel()
    }

    // -- fixtures ------------------------------------------------------------

    private class FakeSocket(private val req: Request) : WebSocket {
        val sent = CopyOnWriteArrayList<String>()
        var closeCode: Int? = null

        override fun request(): Request = req
        override fun queueSize(): Long = 0L
        override fun send(text: String): Boolean = sent.add(text)
        override fun send(bytes: ByteString): Boolean = true
        override fun close(code: Int, reason: String?): Boolean {
            closeCode = code
            return true
        }
        override fun cancel() = Unit
    }

    private class Harness(val client: AdapterClient, val socket: FakeSocket, val listener: WebSocketListener)

    private fun harness(): Harness {
        lateinit var adapter: AdapterClient
        var captured: Pair<FakeSocket, WebSocketListener>? = null
        adapter = AdapterClient(
            baseUrl = "http://127.0.0.1:9",
            token = "test-token",
            scope = scope,
        ) { request, listener ->
            val socket = FakeSocket(request)
            captured = socket to listener
            socket
        }
        client = adapter
        adapter.connect()
        val (socket, listener) = captured ?: error("the socket factory was not called")
        return Harness(adapter, socket, listener)
    }

    private fun okResponse(): Response = Response.Builder()
        .request(Request.Builder().url("http://127.0.0.1:9").build())
        .protocol(okhttp3.Protocol.HTTP_1_1)
        .code(101)
        .message("Switching Protocols")
        .build()

    private fun open(harness: Harness) {
        harness.listener.onOpen(harness.socket, okResponse())
    }

    private fun idOf(text: String): String =
        EnvelopeWriter.json.parseToJsonElement(text).jsonObject["id"].toString().trim('"')

    private fun helloReply(requestId: String): String =
        """{"v":4,"kind":"response","id":"srv_1","reply_to":"$requestId","type":"client.hello","payload":{"negotiated_version":4}}"""

    /** Answer the outstanding client.hello so the ready gate opens. */
    private suspend fun awaitHello(harness: Harness) {
        withTimeout(3_000) { while (harness.socket.sent.isEmpty()) delay(2) }
        harness.listener.onMessage(harness.socket, helloReply(idOf(harness.socket.sent.first())))
    }

    // -- 1.1 events are not lost --------------------------------------------

    @Test
    fun thousandDeltasArriveInOrder() = runBlocking {
        val h = harness()
        open(h)
        awaitHello(h)

        val received = CopyOnWriteArrayList<String>()
        val collector: Job = launch {
            h.client.events.collect { envelope ->
                val event = envelope.payload["event"]?.jsonObject ?: return@collect
                received.add(event["text"].toString().trim('"'))
            }
        }
        // Back to back with no delay: a conflating StateFlow loses these.
        for (i in 0 until 1000) {
            h.listener.onMessage(
                h.socket,
                """{"v":4,"kind":"event","type":"session.event","session_id":"s1","seq":$i,"payload":{"event":{"kind":"text_delta","text":"d$i"}}}""",
            )
        }
        withTimeout(5_000) { while (received.size < 1000) delay(2) }
        assertEquals(1000, received.size)
        assertEquals((0 until 1000).map { "d$it" }, received.toList())
        collector.cancel()
    }

    // -- 1.2 errors are not successes ---------------------------------------

    @Test
    fun errorReplyThrowsAdapterRequestErrorWithCode() = runBlocking {
        val h = harness()
        open(h)
        awaitHello(h)

        val call = async {
            runCatching { h.client.request("sessions.favorite", JsonObject(emptyMap()), timeoutMs = 5_000) }
        }
        withTimeout(3_000) { while (h.socket.sent.size < 2) delay(2) }
        val requestId = idOf(h.socket.sent.last())
        h.listener.onMessage(
            h.socket,
            """{"v":4,"kind":"response","id":"srv_2","reply_to":"$requestId","type":"error","payload":{"code":"conflict","message":"Turn moved on.","retryable":false}}""",
        )
        val failure = call.await().exceptionOrNull()
        assertTrue("expected AdapterRequestError, got $failure", failure is AdapterRequestError)
        assertEquals("conflict", (failure as AdapterRequestError).code)
    }

    @Test
    fun socketCloseThrowsConnectionLost() = runBlocking {
        val h = harness()
        open(h)
        awaitHello(h)

        val call = async {
            runCatching { h.client.request("sessions.list", JsonObject(emptyMap()), timeoutMs = 5_000) }
        }
        withTimeout(3_000) { while (h.socket.sent.size < 2) delay(2) }
        h.listener.onFailure(h.socket, IOException("socket went away"), null)
        val failure = call.await().exceptionOrNull()
        assertTrue("expected ConnectionLost, got $failure", failure is ConnectionLost)
    }

    // -- 1.3 timeouts do not crash ------------------------------------------

    @Test
    fun requestTimeoutLeavesNothingPendingAndNothingEscapes() = runBlocking {
        val h = harness()
        open(h)
        awaitHello(h)

        val failure = runCatching {
            h.client.request("sessions.list", JsonObject(emptyMap()), timeoutMs = 80)
        }.exceptionOrNull()
        assertTrue(
            "expected TimeoutCancellationException, got $failure",
            failure is kotlinx.coroutines.TimeoutCancellationException,
        )
        assertEquals("a timed-out request must not stay in pending", 0, h.client.pendingCount)
        // The socket survived: a timeout is a caller-side wait, not a close.
        assertEquals(ConnectionStatus.Connected, h.client.status.value)
    }

    // -- 1.5 stale socket callbacks are ignored ------------------------------

    @Test
    fun lateCallbackFromOldSocketDoesNotClearTheNewOne() = runBlocking {
        val h = harness()
        open(h)
        awaitHello(h)

        h.client.close()
        h.client.connect()
        assertEquals(ConnectionStatus.Connecting, h.client.status.value)

        // A late failure from the closed socket must not touch the new one.
        h.listener.onFailure(h.socket, IOException("old socket"), null)
        assertEquals(ConnectionStatus.Connecting, h.client.status.value)
    }

    // -- 1.6 hello gates every request --------------------------------------

    @Test
    fun requestWaitsForHelloBeforeSending() = runBlocking {
        val h = harness()
        open(h) // hello sent, not answered yet

        val call = async {
            runCatching { h.client.request("sessions.list", JsonObject(emptyMap()), timeoutMs = 3_000) }
        }
        delay(120)
        assertEquals("no envelope may be written before hello is answered", 1, h.socket.sent.size)

        awaitHello(h)
        withTimeout(3_000) { while (h.socket.sent.size < 2) delay(2) }
        assertEquals(2, h.socket.sent.size)
        call.cancel()
    }
}
