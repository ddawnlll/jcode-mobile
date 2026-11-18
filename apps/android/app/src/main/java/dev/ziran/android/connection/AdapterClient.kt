package dev.ziran.android.connection

import dev.ziran.android.protocol.AdapterRequestError
import dev.ziran.android.protocol.BYTE_PACKAGE_CHUNK
import dev.ziran.android.protocol.Backoff
import dev.ziran.android.protocol.BytePackageAssembler
import dev.ziran.android.protocol.BytePackageViolation
import dev.ziran.android.protocol.Envelope
import dev.ziran.android.protocol.EnvelopeWriter
import dev.ziran.android.protocol.JOURNAL_WS_SUBPROTOCOL
import dev.ziran.android.protocol.LEGACY_WS_SUBPROTOCOL
import dev.ziran.android.protocol.MIN_PROTOCOL_VERSION
import dev.ziran.android.protocol.PROTOCOL_VERSION
import dev.ziran.android.protocol.ServerInfo
import dev.ziran.android.protocol.WS_SUBPROTOCOL
import dev.ziran.android.protocol.parseEnvelope
import dev.ziran.android.protocol.parseError
import dev.ziran.android.protocol.parseServerInfo
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * OkHttp client for the adapter /v2/ws socket. Mirrors adapter.ts.
 *
 * - Sends Authorization: Bearer plus the three v4/v3/v2 subprotocols.
 * - Sends client.hello at v=2 (min 2 / max 4) and uses negotiated_version after.
 * - Handles v4 transport.bytes packages; any violation closes with 4002.
 * - Reconnects with exponential backoff capped at 12 s.
 *
 * This class owns no session logic. Repository and ViewModels subscribe to
 * its flows. Socket close never cancels anything by itself.
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
) {
    val json = EnvelopeWriter.json

    private val _status = MutableStateFlow(ConnectionStatus.Offline)
    val status: StateFlow<ConnectionStatus> = _status.asStateFlow()

    private val _server = MutableStateFlow<ServerInfo?>(null)
    val server: StateFlow<ServerInfo?> = _server.asStateFlow()

    private val _events = MutableStateFlow<Envelope?>(null)
    val events: StateFlow<Envelope?> = _events.asStateFlow()

    private var socket: WebSocket? = null
    private var reconnectAttempt = 0
    private var manuallyClosed = false
    private var reconnectJob: Job? = null
    private val pending = java.util.concurrent.ConcurrentHashMap<String, (Result<JsonObject>) -> Unit>()
    private val assembler = BytePackageAssembler()
    var negotiatedVersion: Int = PROTOCOL_VERSION
        private set

    fun connect() {
        manuallyClosed = false
        reconnectAttempt = 0
        openSocket()
    }

    fun close() {
        manuallyClosed = true
        reconnectJob?.cancel()
        assembler.reset()
        socket?.close(1000, "client closed")
        socket = null
        _status.value = ConnectionStatus.Offline
    }

    suspend fun request(
        type: String,
        payload: JsonObject,
        sessionId: String? = null,
        operationId: String? = null,
        timeoutMs: Long = 30_000,
        wireVersion: Int? = null,
    ): JsonObject {
        val ws = socket ?: throw IllegalStateException("Adapter is not connected.")
        val id = "req_" + UUID.randomUUID().toString()
        val text = EnvelopeWriter.request(id, type, payload, wireVersion ?: negotiatedVersion, sessionId, operationId)
        val timeout = kotlinx.coroutines.CompletableDeferred<JsonObject>()
        pending[id] = { result -> timeout.complete(result.getOrNull() ?: JsonObject(emptyMap())) }
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
            try {
                val value = kotlinx.coroutines.withTimeout(timeoutMs) { timeout.await() }
                return@launch
            } catch (_: Exception) {
                pending.remove(id)
                throw IllegalStateException("$type timed out.")
            }
        }
        val sent = ws.send(text)
        if (!sent) {
            pending.remove(id)
            throw IllegalStateException("Adapter is not connected.")
        }
        return kotlinx.coroutines.withTimeout(timeoutMs + 1000) { timeout.await() }
    }

    private fun openSocket() {
        if (socket != null) return
        _status.value = ConnectionStatus.Connecting
        assembler.reset()
        val request = Request.Builder()
            .url(ServerUrls.wsUrl(baseUrl))
            .header("Authorization", "Bearer $token")
            .header("Sec-WebSocket-Protocol", "$WS_SUBPROTOCOL, $JOURNAL_WS_SUBPROTOCOL, $LEGACY_WS_SUBPROTOCOL")
            .build()
        val ws = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                _status.value = ConnectionStatus.Connected
                reconnectAttempt = 0
                scope.launch { sendHello(ws) }
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleTextFrame(text)
            }

            override fun onMessage(ws: WebSocket, bytes: okio.ByteString) {
                handleBinaryFrame(bytes)
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(code, reason)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                onSocketClosed(code, reason)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                onSocketClosed(1006, t.message ?: "Connection closed.")
            }
        })
        socket = ws
    }

    private suspend fun sendHello(ws: WebSocket) {
        val id = "req_" + UUID.randomUUID().toString()
        val hello = EnvelopeWriter.helloPayload("ziran-android", "0.7.0")
        val text = EnvelopeWriter.request(id, "client.hello", hello, MIN_PROTOCOL_VERSION)
        pending[id] = { result ->
            val payload = result.getOrNull()
            if (payload != null) {
                val negotiated = payload["negotiated_version"]?.toString()?.trim('"')?.toIntOrNull()
                    ?: (payload["server"] as? JsonObject)?.let { parseServerInfo(it).protocolVersion }
                    ?: PROTOCOL_VERSION
                negotiatedVersion = negotiated
                (payload["server"] as? JsonObject)?.let { _server.value = parseServerInfo(it) }
            }
        }
        ws.send(text)
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
        socket?.close(4002, "Invalid byte package")
    }

    private fun receive(envelope: Envelope) {
        if (envelope.kind == dev.ziran.android.protocol.Kind.Response) {
            val replyTo = envelope.replyTo
            if (replyTo != null) {
                val callback = pending.remove(replyTo)
                if (callback != null) {
                    if (envelope.type == "error") {
                        callback(Result.failure(AdapterRequestError(parseError(envelope.payload))))
                    } else {
                        callback(Result.success(envelope.payload))
                    }
                    return
                }
            }
            if (envelope.type != "error") _events.value = envelope
            return
        }
        if (envelope.kind == dev.ziran.android.protocol.Kind.Event) {
            _events.value = envelope
        }
    }

    private fun onSocketClosed(code: Int, reason: String) {
        assembler.reset()
        _status.value = ConnectionStatus.Offline
        val failure = Exception(if (code == 1008) "This device was revoked by the server." else "Connection closed ($code).")
        for ((_, callback) in pending) callback(Result.failure(failure))
        pending.clear()
        socket = null
        if (!manuallyClosed) scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (reconnectJob?.isActive == true || manuallyClosed) return
        reconnectAttempt += 1
        val delayMs = Backoff.delayMs(reconnectAttempt)
        reconnectJob = scope.launch {
            delay(delayMs)
            if (!manuallyClosed) {
                try { connect() } catch (_: Exception) { scheduleReconnect() }
            }
        }
    }
}
