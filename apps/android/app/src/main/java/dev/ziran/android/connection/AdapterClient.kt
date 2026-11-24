package dev.ziran.android.connection

import dev.ziran.android.protocol.AdapterRequestError
import dev.ziran.android.protocol.BytePackageAssembler
import dev.ziran.android.protocol.BytePackageViolation
import dev.ziran.android.protocol.Envelope
import dev.ziran.android.protocol.EnvelopeWriter
import dev.ziran.android.protocol.JOURNAL_WS_SUBPROTOCOL
import dev.ziran.android.protocol.LEGACY_WS_SUBPROTOCOL
import dev.ziran.android.protocol.MIN_PROTOCOL_VERSION
import dev.ziran.android.protocol.PROTOCOL_VERSION
import dev.ziran.android.protocol.ServerInfo
import dev.ziran.android.protocol.V5_WS_SUBPROTOCOL
import dev.ziran.android.protocol.WS_SUBPROTOCOL
import dev.ziran.android.protocol.parseEnvelope
import dev.ziran.android.protocol.parseError
import dev.ziran.android.protocol.parseServerInfo
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** The socket went away. Distinct from an adapter `error` reply. */
class ConnectionLost(message: String) : Exception(message)

/**
 * OkHttp client for the adapter /v2/ws socket. Mirrors adapter.ts.
 *
 * - Sends Authorization: Bearer plus the three v4/v3/v2 subprotocols.
 * - Sends client.hello at v=2 (min 2 / max 4) and uses negotiated_version after.
 *   Every request is gated on that hello completing, so no envelope can be
 *   written at the wrong version.
 * - Handles v4 transport.bytes packages; any violation closes with 4002.
 * - Reconnects with exponential backoff capped at 12 s. The attempt counter is
 *   reset only when a socket opens, so retries actually back off.
 *
 * This class owns no session logic. Repository and ViewModels subscribe to its
 * flow. Socket close never cancels anything by itself.
 */
enum class ConnectionStatus { Connecting, Connected, Offline }

class AdapterClient(
    val baseUrl: String,
    val token: String,
    private val scope: CoroutineScope,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build(),
    /**
     * Seam for tests. Production always goes through OkHttp; a unit test passes
     * a fake WebSocket so the real listener, framing and reply routing run
     * without a network.
     */
    private val webSocketFactory: (Request, WebSocketListener) -> WebSocket = { request, listener ->
        http.newWebSocket(request, listener)
    },
) {
    val json = EnvelopeWriter.json

    private val _status = MutableStateFlow(ConnectionStatus.Offline)
    val status: StateFlow<ConnectionStatus> = _status.asStateFlow()

    private val _server = MutableStateFlow<ServerInfo?>(null)
    val server: StateFlow<ServerInfo?> = _server.asStateFlow()

    /**
     * Events travel on an unbounded channel, not a StateFlow.
     *
     * A StateFlow conflates equal values, so a burst of text_delta frames
     * overwrote itself and the turn lost text. One collector drains this in
     * arrival order; nothing is dropped.
     */
    private val eventChannel = Channel<Envelope>(Channel.UNLIMITED)
    val events: Flow<Envelope> = eventChannel.receiveAsFlow()

    private val lock = Any()

    /** Guards socket, socketGeneration, ready and manuallyClosed. */
    private var socket: WebSocket? = null

    /**
     * Fences callbacks. Bumped whenever a socket opens or dies, so a late
     * onFailure from an old socket can never clear a new one.
     */
    private var socketGeneration = 0

    /** Completes once client.hello has been answered on the current socket. */
    private var ready: CompletableDeferred<Unit>? = null

    private val reconnect = ReconnectPolicy()
    private var manuallyClosed = false
    private var reconnectJob: Job? = null

    private val pending = ConcurrentHashMap<String, CompletableDeferred<Result<JsonObject>>>()
    private val assembler = BytePackageAssembler()

    @Volatile
    var negotiatedVersion: Int = PROTOCOL_VERSION
        private set

    @Volatile
    var lastCloseReason: String? = null
        private set

    fun connect() {
        synchronized(lock) { manuallyClosed = false }
        openSocket()
    }

    fun close() {
        val ws: WebSocket?
        synchronized(lock) {
            manuallyClosed = true
            reconnectJob?.cancel()
            reconnectJob = null
            socketGeneration += 1
            ws = socket
            socket = null
            ready?.completeExceptionally(ConnectionLost("Adapter is not connected."))
            ready = null
        }
        assembler.reset()
        eventChannel.close()
        ws?.close(1000, "client closed")
        failAllPending(ConnectionLost("Adapter is not connected."))
        _status.value = ConnectionStatus.Offline
    }

    /**
     * Send one request and wait for its reply.
     *
     * Nothing here can escape as an uncaught exception: the timeout runs in the
     * caller's coroutine, and the pending entry is always removed.
     */
    suspend fun request(
        type: String,
        payload: JsonObject,
        sessionId: String? = null,
        operationId: String? = null,
        timeoutMs: Long = 30_000,
        wireVersion: Int? = null,
    ): JsonObject {
        awaitReady(timeoutMs)
        val ws = currentSocket() ?: throw ConnectionLost("Adapter is not connected.")
        val id = "req_" + UUID.randomUUID().toString()
        val text = EnvelopeWriter.request(id, type, payload, wireVersion ?: negotiatedVersion, sessionId, operationId)
        val reply = CompletableDeferred<Result<JsonObject>>()
        pending[id] = reply
        try {
            if (!ws.send(text)) throw ConnectionLost("Adapter is not connected.")
            return withTimeout(timeoutMs) { reply.await().getOrThrow() }
        } finally {
            pending.remove(id)
        }
    }

    private suspend fun awaitReady(timeoutMs: Long) {
        val gate = synchronized(lock) { ready } ?: throw ConnectionLost("Adapter is not connected.")
        withTimeout(timeoutMs) { gate.await() }
    }

    /** Visible for tests: a request that timed out must leave nothing behind. */
    internal val pendingCount: Int
        get() = pending.size

    private fun currentSocket(): WebSocket? = synchronized(lock) {
        if (manuallyClosed) null else socket
    }

    private fun isCurrent(generation: Int): Boolean = synchronized(lock) {
        !manuallyClosed && generation == socketGeneration
    }

    private fun openSocket() {
        val generation: Int
        synchronized(lock) {
            if (manuallyClosed || socket != null) return
            generation = ++socketGeneration
        }
        _status.value = ConnectionStatus.Connecting
        assembler.reset()
        val request = Request.Builder()
            .url(ServerUrls.wsUrl(baseUrl))
            .header("Authorization", "Bearer $token")
            .header("Sec-WebSocket-Protocol", "$V5_WS_SUBPROTOCOL, $WS_SUBPROTOCOL, $JOURNAL_WS_SUBPROTOCOL, $LEGACY_WS_SUBPROTOCOL")
            .build()
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (!isCurrent(generation)) {
                    webSocket.close(1000, "stale socket")
                    return
                }
                onSocketOpened(generation)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!isCurrent(generation)) return
                handleTextFrame(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
                if (!isCurrent(generation)) return
                handleBinaryFrame(bytes)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onSocketClosed(generation, code, reason)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onSocketClosed(generation, 1006, t.message ?: "Connection closed.")
            }
        }
        val ws = webSocketFactory(request, listener)
        synchronized(lock) {
            if (generation == socketGeneration && !manuallyClosed) socket = ws
        }
    }

    private fun onSocketOpened(generation: Int) {
        val gate = CompletableDeferred<Unit>()
        synchronized(lock) {
            if (generation != socketGeneration) return
            ready = gate
            // Only a real open resets backoff. connect() must not.
            reconnect.reset()
            lastCloseReason = null
        }
        _status.value = ConnectionStatus.Connected
        scope.launch {
            try {
                sendHello()
                gate.complete(Unit)
            } catch (error: Exception) {
                gate.completeExceptionally(
                    if (error is ConnectionLost) error else ConnectionLost(error.message ?: "Handshake failed."),
                )
                closeSocket(generation, 1002, "hello failed")
            }
        }
    }

    private suspend fun sendHello() {
        val ws = currentSocket() ?: throw ConnectionLost("Adapter is not connected.")
        val id = "req_" + UUID.randomUUID().toString()
        val hello = EnvelopeWriter.helloPayload("ziran-android", "0.7.3")
        val text = EnvelopeWriter.request(id, "client.hello", hello, MIN_PROTOCOL_VERSION)
        val reply = CompletableDeferred<Result<JsonObject>>()
        pending[id] = reply
        try {
            if (!ws.send(text)) throw ConnectionLost("Adapter is not connected.")
            val payload = withTimeout(HELLO_TIMEOUT_MS) { reply.await().getOrThrow() }
            val negotiated = payload["negotiated_version"]?.toString()?.trim('"')?.toIntOrNull()
                ?: (payload["server"] as? JsonObject)?.let { parseServerInfo(it).protocolVersion }
                ?: PROTOCOL_VERSION
            negotiatedVersion = negotiated
            (payload["server"] as? JsonObject)?.let { _server.value = parseServerInfo(it) }
        } finally {
            pending.remove(id)
        }
    }

    private fun closeSocket(generation: Int, code: Int, reason: String) {
        val ws = synchronized(lock) { if (generation == socketGeneration) socket else null }
        ws?.close(code, reason)
    }

    private fun handleTextFrame(text: String) {
        val envelope = parseEnvelope(text, json) ?: return
        if (envelope.type == "transport.bytes" && negotiatedVersion >= 4) {
            val length = envelope.payload["length"]?.toString()?.trim('"')?.toIntOrNull()
            if (envelope.kind != dev.ziran.android.protocol.Kind.Event || envelope.v != 4 || !assembler.begin(length)) {
                failBytePackage()
                return
            }
            return
        }
        receive(envelope)
    }

    private fun handleBinaryFrame(bytes: okio.ByteString) {
        val chunk = bytes.toByteArray()
        val assembled = try {
            assembler.feed(chunk)
        } catch (_: BytePackageViolation) {
            failBytePackage()
            return
        } catch (_: Exception) {
            failBytePackage()
            return
        }
        if (assembled == null) return
        val envelope = parseEnvelope(assembled, json) ?: run { failBytePackage(); return }
        receive(envelope)
    }

    private fun failBytePackage() {
        assembler.reset()
        val generation = synchronized(lock) { socketGeneration }
        closeSocket(generation, 4002, "Invalid byte package")
    }

    private fun receive(envelope: Envelope) {
        if (envelope.kind == dev.ziran.android.protocol.Kind.Response) {
            val replyTo = envelope.replyTo
            if (replyTo != null) {
                val reply = pending.remove(replyTo)
                if (reply != null) {
                    if (envelope.type == "error") {
                        // A reply that says `error` is not a success with an
                        // empty body. Surface the adapter code to the caller.
                        reply.complete(Result.failure(AdapterRequestError(parseError(envelope.payload))))
                    } else {
                        reply.complete(Result.success(envelope.payload))
                    }
                    return
                }
            }
            if (envelope.type != "error") eventChannel.trySend(envelope)
            return
        }
        if (envelope.kind == dev.ziran.android.protocol.Kind.Event) {
            eventChannel.trySend(envelope)
        }
    }

    private fun onSocketClosed(generation: Int, code: Int, reason: String) {
        val failure = if (code == 1008) {
            ConnectionLost("This device was revoked by the server.")
        } else {
            ConnectionLost("Connection closed ($code).")
        }
        synchronized(lock) {
            // A late callback from an old socket must not clear a new one.
            if (generation != socketGeneration) return
            socket = null
            socketGeneration += 1
            ready?.completeExceptionally(failure)
            ready = null
            lastCloseReason = if (code == 1008) "revoked" else "closed"
        }
        assembler.reset()
        _status.value = ConnectionStatus.Offline
        failAllPending(failure)
        if (!manuallyClosed) scheduleReconnect()
    }

    private fun failAllPending(failure: ConnectionLost) {
        val keys = pending.keys.toList()
        for (key in keys) {
            // remove() first so a late reply cannot also resolve this entry.
            pending.remove(key)?.complete(Result.failure(failure))
        }
    }

    private fun scheduleReconnect() {
        synchronized(lock) {
            if (manuallyClosed) return
            if (reconnectJob?.isActive == true) return
        }
        val delayMs = reconnect.nextDelayMs()
        reconnectJob = scope.launch {
            delay(delayMs)
            val shouldOpen = synchronized(lock) { !manuallyClosed && socket == null }
            if (shouldOpen) openSocket()
        }
    }

    private companion object {
        const val HELLO_TIMEOUT_MS = 15_000L
    }
}
