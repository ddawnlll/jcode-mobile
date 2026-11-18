package dev.ziran.android.data

import android.content.Context
import dev.ziran.android.connection.AdapterClient
import dev.ziran.android.persistence.AppStore
import dev.ziran.android.persistence.LocalNotifications
import dev.ziran.android.protocol.AdapterRequestError
import dev.ziran.android.protocol.CancelTurnResponse
import dev.ziran.android.protocol.OperationView
import dev.ziran.android.protocol.PairedCredential
import dev.ziran.android.protocol.PairingHttp
import dev.ziran.android.protocol.PairPayload
import dev.ziran.android.protocol.SessionSnapshot
import dev.ziran.android.protocol.SessionSummary
import dev.ziran.android.protocol.normalizeServerUrl
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Central store and repository. Ports controller.ts behaviour without the web
 * layer. Key invariants (AGENTS.md):
 *
 * - Navigation, back, background, socket close and process death never cancel
 *   anything. Only the explicit Stop control sends operations.cancel.
 * - Reopening restores the exact server and session. A missing target shows
 *   an honest recovery state; never a replacement.
 * - An unconfirmed send stays pending and unknown. Never resend its bytes.
 * - Every draft, cache and pending send is scoped by serverId + sessionId.
 */
class AppController(
    private val store: AppStore,
    private val context: Context? = null,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build(),
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val reducer = LiveReducer()
    private var sessionGeneration = 0
    private var snapshotTimer: Job? = null

    var client: AdapterClient? = null
        private set

    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()

    private fun setState(update: (AppState) -> AppState) {
        _state.update(update)
    }

    fun scope(): CoroutineScope = scope

    // -- lifecycle ------------------------------------------------------------

    fun start() {
        scope.launch {
            // Saved scene and theme resolve before the first paint settles.
            val scene = store.getScene()
            val theme = store.getThemeMode()
            setState { it.copy(scene = scene, themeMode = theme) }
            context?.let { LocalNotifications.ensureChannels(it) }
            val serverIds = store.listServerIds()
            val first = serverIds.firstOrNull()
            if (first == null) {
                setState { it.copy(phase = "unpaired") }
                return@launch
            }
            val credential = loadCredential(first) ?: run {
                setState { it.copy(phase = "unpaired") }
                return@launch
            }
            setState { it.copy(phase = "ready", serverName = credential.serverId) }
            startClient(credential)
            awaitReady()
        }
    }

    private suspend fun loadCredential(serverId: String): PairedCredential? {
        val prefs = store.dataStore().data.first()
        return store.loadCredentialFromPrefs(prefs, serverId)
    }

    suspend fun pair(baseUrl: String, code: String, deviceName: String) {
        setState { it.copy(phase = "pairing", pairingStage = "pairing", pairingError = null, pairingMessage = "Exchanging the one-time pairing code.") }
        try {
            val normalized = normalizeServerUrl(baseUrl).toString().trimEnd('/')
            val response: PairPayload = PairingHttp.pair(normalized, code, deviceName, http)
            val credential = PairedCredential(
                baseUrl = normalized,
                token = response.token,
                device = response.device,
                serverId = response.server.serverId,
                savedAt = System.currentTimeMillis(),
            )
            store.saveCredential(credential)
            this.credential = credential
            setState { it.copy(pairingStage = "connecting", pairingMessage = "Negotiating the authenticated mobile channel.") }
            startClient(credential, fresh = true)
            setState { it.copy(phase = "ready", pairingStage = "verified", pairingError = null) }
        } catch (error: Exception) {
            setState {
                it.copy(
                    phase = "unpaired",
                    pairingStage = "error",
                    pairingError = error.message ?: (error.javaClass.simpleName + " during pairing."),
                    pairingMessage = error.message ?: "Pairing failed.",
                )
            }
        }
    }

    suspend fun startClient(credential: PairedCredential, fresh: Boolean = false) {
        this.credential = credential
        val previous = client
        previous?.close()
        val adapter = AdapterClient(credential.baseUrl, credential.token, scope)
        client = adapter
        adapter.connect()
        scope.launch {
            adapter.status.collect { status ->
                setState {
                    it.copy(
                        connection = when (status) {
                            dev.ziran.android.connection.ConnectionStatus.Connecting -> "connecting"
                            dev.ziran.android.connection.ConnectionStatus.Connected -> "connected"
                            dev.ziran.android.connection.ConnectionStatus.Offline -> "offline"
                        },
                        savedOnPhone = if (status == dev.ziran.android.connection.ConnectionStatus.Offline) true else it.savedOnPhone,
                        serverName = adapter.server.value?.name ?: it.serverName,
                    )
                }
                if (status == dev.ziran.android.connection.ConnectionStatus.Connected) maybeDrainQueue()
            }
        }
        scope.launch {
            adapter.server.collect { server ->
                if (server != null) setState { it.copy(serverName = server.name, protocolVersion = server.protocolVersion) }
            }
        }
        scope.launch {
            adapter.events.collect { envelope ->
                if (envelope == null) return@collect
                handleEnvelope(envelope)
            }
        }
        // Wait for the socket, then load sessions and restore the session.
        awaitConnected()
        refreshSessions()
        val last = store.getLastSession(credential.serverId)
        val cachedList = loadCachedSessions(credential.serverId)
        val ids = _state.value.sessions.map { it.sessionId }
        if (last != null && (ids.contains(last) || cachedList?.any { it.sessionId == last } == true)) {
            openSession(last)
        }
    }

    private suspend fun awaitConnected() {
        var tries = 0
        while (client?.status?.value != dev.ziran.android.connection.ConnectionStatus.Connected && tries < 50) {
            kotlinx.coroutines.delay(100)
            tries++
        }
    }

    private suspend fun awaitReady() {
        awaitConnected()
        refreshSessions()
    }

    fun setPairServer(value: String) {
        setState { it.copy(pairServer = value, pairingError = null) }
    }

    fun setPairCode(value: String) {
        setState { it.copy(pairCode = value, pairingError = null) }
    }

    /** Parse a pasted pairing link exactly as pairingPayload.ts; fill the fields. */
    fun applyPairingLink(raw: String): Boolean {
        return try {
            val payload = dev.ziran.android.protocol.PairingPayload.parse(raw)
            setState { it.copy(pairServer = payload.server, pairCode = payload.code, pairingError = null) }
            true
        } catch (error: Exception) {
            setState { it.copy(pairingError = error.message ?: "This is not a supported pairing link.") }
            false
        }
    }

    suspend fun pairFromFields() {
        val server = _state.value.pairServer
        val code = _state.value.pairCode
        if (code.isBlank()) {
            setState { it.copy(pairingError = "Enter the one-time code from the adapter.") }
            return
        }
        pair(server, code, "ziran-android")
    }

    suspend fun setScene(key: String) {
        store.setScene(key)
        setState { it.copy(scene = key) }
    }

    suspend fun setThemeMode(mode: String) {
        store.setThemeMode(mode)
        setState { it.copy(themeMode = mode) }
    }

    // -- envelope routing -----------------------------------------------------

    private fun handleEnvelope(envelope: dev.ziran.android.protocol.Envelope) {
        when (envelope.type) {
            "session.event" -> {
                val payload = dev.ziran.android.protocol.parseSessionEvent(envelope.payload) ?: return
                onSessionEvent(envelope.sessionId, envelope.epoch, envelope.seq, payload)
            }
            "session.runtime" -> {
                if (envelope.sessionId != _state.value.activeSessionId) return
                val runtime = dev.ziran.android.protocol.parseRuntime(envelope.payload["runtime"] as? JsonObject)
                if (runtime != null) setState { it.copy(runtime = latestRuntime(it.runtime, runtime)) }
            }
            "session.swarm" -> {
                if (envelope.sessionId != _state.value.activeSessionId) return
                val agents = envelope.payload["agents"]?.let {
                    (it as? kotlinx.serialization.json.JsonArray)?.mapNotNull { item ->
                        (item as? JsonObject)?.let { dev.ziran.android.protocol.parseAgent(it) }
                    }
                }
                if (agents != null) setState { it.copy(agents = agents) }
            }
            "operations.state" -> {
                val operation = envelope.payload["operation"]?.let { (it as? JsonObject)?.let { dev.ziran.android.protocol.parseOperation(it) } }
                if (operation != null) applyOperation(operation)
            }
            "server.connection" -> {
                val connected = envelope.payload["jcode_connected"]?.toString()?.trim('"') == "true"
                val was = _state.value.jcodeConnected
                setState { it.copy(jcodeConnected = connected) }
                if (connected && !was && _state.value.activeSessionId != null) {
                    _state.value.activeSessionId?.let { scope.launch { subscribeToSession(it, forReconnect = true) } }
                }
            }
            "sessions.changed" -> scheduleSessionsRefresh()
            else -> Unit
        }
    }

    // -- sessions -------------------------------------------------------------

    suspend fun refreshSessions() {
        val adapter = client ?: return
        val credential = currentCredential() ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            val cached = loadCachedSessions(credential.serverId)
            if (cached != null) {
                setState { it.copy(savedOnPhone = true, sessionsError = "Adapter unreachable. Showing data saved on this phone.") }
            }
            return
        }
        try {
            val payload = try {
                adapter.request(
                    "sessions.delta",
                    JsonObject(
                        mapOf(
                            "since_revision" to JsonPrimitive(_state.value.sessionRevision),
                            "include_projects" to JsonPrimitive(true),
                        ),
                    ),
                )
            } catch (_: Exception) {
                adapter.request("sessions.list", JsonObject(emptyMap()))
            }
            val incoming = payload["sessions"]?.let {
                (it as? kotlinx.serialization.json.JsonArray)?.mapNotNull { item -> (item as? JsonObject)?.let { dev.ziran.android.protocol.parseSessionSummary(it) } }
            } ?: emptyList()
            val removed = payload["removed"]?.let {
                (it as? kotlinx.serialization.json.JsonArray)?.mapNotNull { v -> v.toString().trim('"') }
            } ?: emptyList()
            val full = payload["full"]?.toString()?.trim('"') != "false"
            val revision = payload["revision"]?.toString()?.trim('"')?.toLongOrNull() ?: _state.value.sessionRevision
            // A delta merges into the list; only a full listing replaces it.
            val current = _state.value.sessions
            val merged = if (full) {
                incoming
            } else {
                val base = current.associateBy { it.sessionId }.toMutableMap()
                for (session in incoming) base[session.sessionId] = session
                for (id in removed) base.remove(id)
                base.values.sortedByDescending { it.updatedAtMs ?: 0L }
            }
            store.saveSessionListCache(credential.serverId, payload.toString())
            val active = _state.value.activeSessionId
            setState {
                it.copy(
                    sessions = merged,
                    sessionRevision = revision,
                    savedOnPhone = false,
                    sessionsError = null,
                    activeMissing = active != null && merged.none { s -> s.sessionId == active } && it.snapshot?.session?.sessionId != active,
                )
            }
        } catch (error: Exception) {
            setState { it.copy(sessionsError = "Sessions could not be refreshed: ${error.message}", savedOnPhone = true) }
        }
    }

    private fun scheduleSessionsRefresh() {
        scope.launch { kotlinx.coroutines.delay(32); refreshSessions() }
    }

    private suspend fun loadCachedSessions(serverId: String): List<SessionSummary>? {
        val raw = store.loadSessionListCache(serverId) ?: return null
        val obj = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
        return obj["sessions"]?.let {
            (it as? kotlinx.serialization.json.JsonArray)?.mapNotNull { item -> (item as? JsonObject)?.let { s -> dev.ziran.android.protocol.parseSessionSummary(s) } }
        }
    }

    suspend fun openSession(sessionId: String, forReconnect: Boolean = false) {
        sessionGeneration++
        val generation = sessionGeneration
        val credential = currentCredential()
        val draft = credential?.let { store.loadDraft(it.serverId, sessionId) } ?: ""
        val pending = credential?.let { store.loadPending(it.serverId, sessionId) }
        val cached = credential?.let { loadCachedSnapshot(it.serverId, sessionId) }
        val previous = _state.value.activeSessionId
        setState {
            it.copy(
                activeSessionId = sessionId,
                activeMissing = false,
                snapshot = cached,
                savedOnPhone = cached != null,
                live = dev.ziran.android.data.LiveState(),
                pending = pending?.let { p -> PendingMessage(p.text, p.operationId, p.state, null, p.createdAtMs) },
                composerText = draft,
                lastSeq = cached?.lastSeq ?: 0,
                epoch = cached?.epoch,
                runtime = cached?.runtime,
                agents = cached?.agents,
                context = cached?.context,
                models = emptyList(),
            )
        }
        credential?.let { store.setLastSession(it.serverId, sessionId) }
        if (pending != null) lookupOperation(pending.operationId)
        if (client?.status?.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        if (previous != null && previous != sessionId) {
            try { client?.request("sessions.unsubscribe", JsonObject(mapOf("session_id" to JsonPrimitive(previous))), timeoutMs = 8000) } catch (_: Exception) { }
        }
        if (generation == sessionGeneration) subscribeToSession(sessionId, forReconnect)
    }

    private suspend fun subscribeToSession(sessionId: String, forReconnect: Boolean) {
        val adapter = client ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        val generation = sessionGeneration
        val buffered = mutableListOf<dev.ziran.android.protocol.Envelope>()
        setState { it.copy(reconciling = true) }
        try {
            if (forReconnect && _state.value.lastSeq > 0 && adapter.negotiatedVersion >= 3) {
                try {
                    var more = true
                    while (more && generation == sessionGeneration && _state.value.activeSessionId == sessionId) {
                        val cursor = _state.value.lastSeq
                        val replay = adapter.request(
                            "events.subscribe",
                            JsonObject(
                                mapOf(
                                    "session_id" to JsonPrimitive(sessionId),
                                    "after_seq" to JsonPrimitive(cursor),
                                    "epoch" to JsonPrimitive(_state.value.epoch ?: ""),
                                    "limit" to JsonPrimitive(512),
                                    "tail" to JsonPrimitive(160),
                                ),
                            ),
                            sessionId = sessionId,
                            timeoutMs = 20000,
                        )
                        if (generation != sessionGeneration) return
                        val parsed = dev.ziran.android.protocol.parseEventsSubscribe(replay)
                        if (parsed == null) break
                        if (parsed.resyncRequired || parsed.gap) {
                            if (parsed.snapshot != null) applySnapshot(parsed.snapshot)
                            setState { it.copy(reconciling = false, epoch = parsed.epoch) }
                            return
                        }
                        if (parsed.events.isEmpty()) {
                            setState { it.copy(reconciling = false, epoch = parsed.epoch) }
                            ackEvents(sessionId, _state.value.lastSeq)
                            return
                        }
                        for (item in parsed.events) {
                            val payload = dev.ziran.android.protocol.SessionEventPayload(item.event, item.eventKind, item.turnId, item.operationId, item.observedAtMs)
                            val reduction = reducer.reduceEvent(_state.value, parsed.sessionId, parsed.epoch, item.seq, payload)
                            setState { reduction.state }
                            if (reduction.effect is LiveReducer.Effect.NeedSnapshot) {
                                snapshotTimer?.cancel()
                                snapshotTimer = scope.launch { kotlinx.coroutines.delay(150); refreshSnapshot() }
                            }
                        }
                        more = parsed.hasMore
                        if (!more) {
                            setState { it.copy(reconciling = false, epoch = parsed.epoch) }
                            ackEvents(sessionId, _state.value.lastSeq)
                            return
                        }
                        if (_state.value.lastSeq <= cursor) break
                    }
                } catch (_: Exception) { }
            }
            if (generation != sessionGeneration || _state.value.activeSessionId != sessionId) return
            val snapshotPayload = adapter.request(
                "sessions.subscribe",
                JsonObject(
                    mapOf(
                        "session_id" to JsonPrimitive(sessionId),
                        "tail" to JsonPrimitive(160),
                        "after_seq" to JsonPrimitive(_state.value.lastSeq ?: 0),
                    ),
                ),
                sessionId = sessionId,
                timeoutMs = 35000,
            )
            if (generation != sessionGeneration) return
            val snapshot = dev.ziran.android.protocol.parseSnapshot(snapshotPayload)
            if (snapshot != null) {
                applySnapshot(snapshot)
                if (snapshot.stale) scheduleSnapshot(60)
            }
        } catch (error: Exception) {
            if (generation != sessionGeneration) return
            setState {
                it.copy(
                    reconciling = false,
                    activeMissing = error is AdapterRequestError && error.code == "not_found",
                    sessionsError = "Session could not be restored: ${error.message}",
                    savedOnPhone = true,
                )
            }
        } finally {
            if (generation == sessionGeneration) setState { it.copy(reconciling = false) }
        }
    }

    private suspend fun ackEvents(sessionId: String, seq: Long) {
        if (seq <= 0) return
        try {
            val adapter = client ?: return
            val payload = adapter.request("events.ack", JsonObject(mapOf("session_id" to JsonPrimitive(sessionId), "seq" to JsonPrimitive(seq))), sessionId = sessionId, timeoutMs = 8000)
            val floor = payload["floor_seq"]?.toString()?.trim('"')?.toLongOrNull() ?: 0
            val acked = payload["acked_seq"]?.toString()?.trim('"')?.toLongOrNull() ?: 0
            if (floor > 0 && acked < floor - 1) scheduleSnapshot(120)
        } catch (_: Exception) { }
    }

    private fun applySnapshot(snapshot: SessionSnapshot) {
        val credential = currentCredential() ?: return
        scope.launch { store.saveSnapshotCache(credential.serverId, snapshot.session.sessionId, snapshot.toString()) }
        val pendingInHistory = _state.value.pending?.let { pending ->
            snapshot.messages.any { it.role == "user" && it.content == pending.text }
        } == true
        val next = applySnapshotToState(_state.value, snapshot)
        setState {
            var s = next
            if (pendingInHistory) {
                s = s.copy(pending = null, composerText = "")
                scope.launch { store.clearPending(credential.serverId, snapshot.session.sessionId) }
            }
            s
        }
        maybeDrainQueue()
    }

    private suspend fun loadCachedSnapshot(serverId: String, sessionId: String): SessionSnapshot? {
        val raw = store.loadSnapshotCache(serverId, sessionId) ?: return null
        val obj = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
        return dev.ziran.android.protocol.parseSnapshot(obj)
    }

    suspend fun refreshSnapshot() {
        val adapter = client ?: return
        val sessionId = _state.value.activeSessionId ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        val generation = sessionGeneration
        val requestedTurn = _state.value.live.turnId
        val requestedFinished = _state.value.live.finishedTurnId
        val requestedEpoch = _state.value.epoch
        setState { it.copy(reconciling = true) }
        try {
            val payload = adapter.request(
                "sessions.snapshot",
                JsonObject(mapOf("session_id" to JsonPrimitive(sessionId), "tail" to JsonPrimitive(160), "after_seq" to JsonPrimitive(_state.value.lastSeq))),
                sessionId = sessionId,
                timeoutMs = 30000,
            )
            if (generation != sessionGeneration) return
            val snapshot = dev.ziran.android.protocol.parseSnapshot(payload) ?: return
            if (_state.value.live.turnId != requestedTurn || _state.value.live.finishedTurnId != requestedFinished) return
            if (snapshot.epoch != requestedEpoch && snapshot.epoch != _state.value.epoch) return
            if (snapshot.lastSeq < _state.value.lastSeq) return
            applySnapshot(snapshot)
        } catch (_: Exception) {
        } finally {
            if (generation == sessionGeneration) setState { it.copy(reconciling = false) }
        }
    }

    private fun scheduleSnapshot(delayMs: Long) {
        snapshotTimer?.cancel()
        snapshotTimer = scope.launch { kotlinx.coroutines.delay(delayMs); refreshSnapshot() }
    }

    private fun onSessionEvent(sessionId: String?, epoch: String?, seq: Long?, payload: dev.ziran.android.protocol.SessionEventPayload) {
        if (sessionId != _state.value.activeSessionId) return
        if (_state.value.snapshot == null) { scheduleSnapshot(250); return }
        val reduction = reducer.reduceEvent(_state.value, sessionId, epoch, seq, payload)
        setState { reduction.state }
        if (reduction.effect is LiveReducer.Effect.NeedSnapshot) scheduleSnapshot(150)
        when (val event = payload.event) {
            is dev.ziran.android.protocol.SessionEvent.PermissionRequest ->
                notify(LocalNotifications.CHANNEL_APPROVAL, "Approval needed", "${event.toolName}: ${event.description}".take(160))
            is dev.ziran.android.protocol.SessionEvent.TurnDone ->
                notify(LocalNotifications.CHANNEL_TURNS, "Turn complete", "The agent finished in this thread.")
            else -> Unit
        }
        maybeDrainQueue()
    }

    // -- send / stop / permission ---------------------------------------------

    fun setComposerText(text: String) {
        setState { it.copy(composerText = text) }
        val credential = currentCredential() ?: return
        val sessionId = _state.value.activeSessionId ?: return
        scope.launch { store.saveDraft(credential.serverId, sessionId, text) }
    }

    suspend fun send() = sendText(_state.value.composerText)

    /** Send exactly the text the field currently shows. */
    suspend fun sendText(rawText: String) {
        val text = rawText.trim()
        val sessionId = _state.value.activeSessionId ?: return
        val adapter = client ?: run { setState { it.copy(sessionsError = "The adapter is offline. The draft is saved on this phone.") }; return }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(sessionsError = "The adapter is offline. The draft is saved on this phone.") }
            return
        }
        if (text.isEmpty()) return
        val pending = _state.value.pending
        if (pending != null && pending.state in listOf("staged", "reserved", "dispatching", "accepted", "unknown")) {
            setState { it.copy(sessionsError = "This message is still being resolved. Do not resend it.") }
            return
        }
        // A message written while the turn runs is a soft interrupt: it waits
        // in the queue and is sent once the turn settles. Nothing is cancelled.
        if (_state.value.live.turnId != null || _state.value.live.daemonRunning) {
            setState { it.copy(queuedMessages = it.queuedMessages + text, composerText = "") }
            store.saveDraft(currentCredential()!!.serverId, sessionId, "")
            return
        }
        val credential = currentCredential() ?: return
        val operationId = UUID.randomUUID().toString()
        val next = PendingMessage(text, operationId, "staged", null, System.currentTimeMillis())
        store.saveDraft(credential.serverId, sessionId, text)
        store.savePending(credential.serverId, sessionId, operationId, text, "staged", next.createdAt)
        setState { it.copy(pending = next, composerText = "") }
        try {
            val reserved = adapter.request(
                "operations.reserve",
                JsonObject(
                    mapOf(
                        "operation_id" to JsonPrimitive(operationId),
                        "session_id" to JsonPrimitive(sessionId),
                        "kind" to JsonPrimitive("send"),
                        "body" to JsonPrimitive(text),
                        "expected_turn_id" to JsonPrimitive(null.toString()),
                    ),
                ),
                sessionId = sessionId,
                operationId = operationId,
                timeoutMs = 15000,
            )
            applyOperation(dev.ziran.android.protocol.parseOperation((reserved["operation"] as? JsonObject) ?: JsonObject(emptyMap())))
            val dispatched = adapter.request(
                "operations.dispatch",
                JsonObject(mapOf("operation_id" to JsonPrimitive(operationId))),
                sessionId = sessionId,
                operationId = operationId,
                timeoutMs = 40000,
            )
            applyOperation(dev.ziran.android.protocol.parseOperation((dispatched["operation"] as? JsonObject) ?: JsonObject(emptyMap())))
            store.saveDraft(credential.serverId, sessionId, "")
        } catch (error: Exception) {
            val unknown = error !is AdapterRequestError
            if (!unknown) {
                setState { it.copy(pending = null, composerText = text) }
                store.clearPending(credential.serverId, sessionId)
                store.saveDraft(credential.serverId, sessionId, text)
                setState { it.copy(sessionsError = "Message was not sent: ${error.message}") }
            } else {
                setState { it.copy(pending = next.copy(state = "unknown", error = error.message)) }
                store.savePending(credential.serverId, sessionId, operationId, text, "unknown", next.createdAt)
                setState { it.copy(sessionsError = "Delivery unconfirmed: ${error.message}") }
            }
        }
    }

    private var draining = false

    /** Send the first queued message once no turn is running. */
    private fun maybeDrainQueue() {
        if (draining) return
        val current = _state.value
        // Never spend a queued message while offline: it would be lost without
        // an operation to look up later.
        if (current.connection != "connected") return
        val running = current.live.turnId != null || current.live.daemonRunning
        if (running || current.queuedMessages.isEmpty()) return
        val next = current.queuedMessages.first()
        draining = true
        scope.launch {
            setState { it.copy(queuedMessages = it.queuedMessages.drop(1), composerText = next) }
            send()
            draining = false
            maybeDrainQueue()
        }
    }

    private fun notify(kind: String, title: String, body: String) {
        val ctx = context ?: return
        val sessionId = _state.value.activeSessionId ?: return
        LocalNotifications.postIfBackgrounded(ctx, kind, sessionId, title, body)
    }

    private fun applyOperation(operation: OperationView) {
        if (operation.operationId.isEmpty()) return
        setState { it.copy(operations = it.operations + (operation.operationId to operation)) }
        val pending = _state.value.pending
        if (pending != null && pending.operationId == operation.operationId) {
            setState { it.copy(pending = pending.copy(state = operation.state)) }
        }
    }

    suspend fun lookupOperation(operationId: String) {
        val adapter = client ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        try {
            val payload = adapter.request("operations.lookup", JsonObject(mapOf("operation_id" to JsonPrimitive(operationId))))
            val operation = (payload["operation"] as? JsonObject)?.let { dev.ziran.android.protocol.parseOperation(it) }
            if (operation != null) applyOperation(operation)
        } catch (_: Exception) { }
    }

    suspend fun stop() {
        val adapter = client ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        val sessionId = _state.value.activeSessionId ?: return
        val turnId = _state.value.live.turnId
        val daemonRunning = _state.value.live.daemonRunning
        if (turnId == null && !daemonRunning) return
        try {
            val response = adapter.request(
                "operations.cancel",
                JsonObject(
                    mapOf(
                        "session_id" to JsonPrimitive(sessionId),
                        "operation_id" to JsonPrimitive(_state.value.live.operationId ?: null.toString()),
                        "expected_turn_id" to JsonPrimitive(turnId ?: null.toString()),
                        "allow_running_unknown" to JsonPrimitive((turnId == null).toString()),
                    ),
                ),
                sessionId = sessionId,
                operationId = _state.value.live.operationId,
                timeoutMs = 20000,
            )
            val alreadyStopped = response["already_stopped"]?.toString()?.trim('"') == "true"
            val finalState = response["final_state"]?.toString()?.trim('"')
            if (alreadyStopped || finalState == "idle") {
                setState { it.copy(live = it.live.copy(turnId = null, status = "idle", daemonRunning = false, daemonStatus = "idle")) }
                scheduleSnapshot(40)
            } else if (finalState == "running" || finalState == null) {
                scheduleSnapshot(400)
            }
        } catch (error: Exception) {
            if (error is AdapterRequestError && error.code == "conflict") refreshSnapshot()
        }
    }

    suspend fun respondPermission(decision: String) {
        val permission = _state.value.live.permission ?: return
        val sessionId = _state.value.activeSessionId ?: return
        val adapter = client ?: return
        try {
            adapter.request(
                "tool.permission_response",
                JsonObject(
                    mapOf(
                        "session_id" to JsonPrimitive(sessionId),
                        "request_id" to JsonPrimitive(permission.requestId),
                        "decision" to JsonPrimitive(decision),
                    ),
                ),
                sessionId = sessionId,
                timeoutMs = 15000,
            )
            setState { it.copy(live = it.live.copy(permission = null, status = "working")) }
        } catch (error: Exception) {
            setState { it.copy(sessionsError = error.message) }
        }
    }

    // -- models ---------------------------------------------------------------

    suspend fun refreshModels() {
        val adapter = client ?: return
        val sessionId = _state.value.activeSessionId ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        try {
            val payload = adapter.request("models.list", JsonObject(mapOf("session_id" to JsonPrimitive(sessionId))), sessionId = sessionId, timeoutMs = 25000)
            val runtime = dev.ziran.android.protocol.parseRuntime(payload["runtime"] as? JsonObject)
            val models = payload["models"]?.let {
                (it as? kotlinx.serialization.json.JsonArray)?.mapNotNull { item -> (item as? JsonObject)?.let { m -> dev.ziran.android.protocol.parseRoute(m) } }
            } ?: emptyList()
            if (_state.value.activeSessionId == sessionId) {
                setState { it.copy(models = models, runtime = latestRuntime(it.runtime, runtime), modelsError = null) }
            }
        } catch (_: Exception) {
            if (_state.value.activeSessionId == sessionId) setState { it.copy(models = emptyList()) }
        }
    }

    suspend fun selectModel(model: String, provider: String, apiMethod: String) {
        val adapter = client ?: return
        val sessionId = _state.value.activeSessionId ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        try {
            val payload = adapter.request(
                "models.set",
                JsonObject(
                    mapOf(
                        "session_id" to JsonPrimitive(sessionId),
                        "model" to JsonPrimitive(model),
                        "expected_provider" to JsonPrimitive(provider),
                        "api_method" to JsonPrimitive(apiMethod),
                    ),
                ),
                sessionId = sessionId,
                timeoutMs = 30000,
            )
            val runtime = dev.ziran.android.protocol.parseRuntime(payload["runtime"] as? JsonObject)
            if (_state.value.activeSessionId != sessionId) return
            setState { it.copy(runtime = latestRuntime(it.runtime, runtime)) }
        } catch (_: Exception) { }
    }

    suspend fun setReasoning(effort: String) {
        val adapter = client ?: return
        val sessionId = _state.value.activeSessionId ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        try {
            val runtimePayload = adapter.request(
                "reasoning.set",
                JsonObject(mapOf("session_id" to JsonPrimitive(sessionId), "effort" to JsonPrimitive(effort))),
                sessionId = sessionId,
                timeoutMs = 25000,
            )
            val runtime = dev.ziran.android.protocol.parseRuntime(runtimePayload)
            if (_state.value.activeSessionId != sessionId) return
            setState { it.copy(runtime = latestRuntime(it.runtime, runtime)) }
        } catch (_: Exception) { }
    }

    // -- session management ---------------------------------------------------

    private suspend fun sessionAction(type: String, sessionId: String): Boolean {
        val adapter = client ?: return false
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return false
        return try {
            val payload = adapter.request(type, JsonObject(mapOf("session_id" to JsonPrimitive(sessionId))), sessionId = sessionId, timeoutMs = 20000)
            val session = (payload["session"] as? JsonObject)?.let { dev.ziran.android.protocol.parseSessionSummary(it) }
            if (session != null) {
                setState {
                    it.copy(
                        sessions = it.sessions.map { existing -> if (existing.sessionId == session.sessionId) session else existing },
                        snapshot = if (it.snapshot?.session?.sessionId == session.sessionId) it.snapshot.copy(session = session) else it.snapshot,
                    )
                }
            }
            true
        } catch (_: Exception) { false }
    }

    suspend fun archiveSession(sessionId: String): Boolean = sessionAction("sessions.archive", sessionId)
    suspend fun restoreSession(sessionId: String): Boolean = sessionAction("sessions.restore", sessionId)

    suspend fun toggleFavorite(sessionId: String): Boolean {
        val current = _state.value.sessions.firstOrNull { it.sessionId == sessionId }
        val favorite = !(current?.favorite ?: false)
        val adapter = client ?: return false
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return false
        return try {
            val payload = adapter.request(
                "sessions.favorite",
                JsonObject(mapOf("session_id" to JsonPrimitive(sessionId), "favorite" to JsonPrimitive(favorite.toString()))),
                sessionId = sessionId,
                timeoutMs = 20000,
            )
            val session = (payload["session"] as? JsonObject)?.let { dev.ziran.android.protocol.parseSessionSummary(it) }
            if (session != null) {
                setState { it.copy(sessions = it.sessions.map { e -> if (e.sessionId == session.sessionId) session else e }) }
            }
            true
        } catch (_: Exception) { false }
    }

    suspend fun renameSession(sessionId: String, title: String) {
        val adapter = client ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        try {
            val payload = adapter.request(
                "sessions.rename",
                JsonObject(mapOf("session_id" to JsonPrimitive(sessionId), "title" to JsonPrimitive(title))),
                sessionId = sessionId,
                timeoutMs = 20000,
            )
            val session = (payload["session"] as? JsonObject)?.let { dev.ziran.android.protocol.parseSessionSummary(it) }
            if (session != null) {
                setState {
                    it.copy(
                        snapshot = it.snapshot?.copy(session = session),
                        sessions = it.sessions.map { e -> if (e.sessionId == session.sessionId) session else e },
                    )
                }
            }
        } catch (_: Exception) { }
    }

    suspend fun createSession(projectId: String?, title: String) {
        val adapter = client ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        val clientRequestId = UUID.randomUUID().toString()
        try {
            val payload = adapter.request(
                "sessions.create",
                JsonObject(
                    mapOf(
                        "client_request_id" to JsonPrimitive(clientRequestId),
                        "project_id" to JsonPrimitive(projectId ?: null.toString()),
                        "working_dir" to JsonPrimitive(null.toString()),
                        "title" to JsonPrimitive(title.trim().ifEmpty { null.toString() }),
                    ),
                ),
                timeoutMs = 40000,
            )
            val created = (payload["session"] as? JsonObject)?.let { dev.ziran.android.protocol.parseSessionSummary(it) }
            if (created != null) {
                setState { it.copy(sessions = listOf(created) + it.sessions.filter { s -> s.sessionId != created.sessionId }) }
                openSession(created.sessionId)
            }
        } catch (_: Exception) { }
    }

    fun close() {
        client?.close()
    }

    private fun currentCredential(): PairedCredential? = credential

    private var credential: PairedCredential? = null
}
