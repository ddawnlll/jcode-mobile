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
    /** Soft-interrupt queue, scoped by serverId + sessionId. */
    private val queues = MessageQueues()
    private var sessionGeneration = 0
    private var snapshotTimer: Job? = null

    var client: AdapterClient? = null
        private set

    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()

    /** Scoped composer flow so typing never recomposes ZiranApp root. */
    private val _composerText = MutableStateFlow("")
    val composerText: StateFlow<String> = _composerText.asStateFlow()
    private var draftSaveJob: Job? = null

    private fun setState(update: (AppState) -> AppState) {
        _state.update { prev ->
            val next = update(prev)
            if (next.composerText != prev.composerText) {
                _composerText.value = next.composerText
            }
            next
        }
    }

    fun scope(): CoroutineScope = scope

    // -- lifecycle ------------------------------------------------------------

    fun start() {
        scope.launch {
            // Saved scene, theme, and settings resolve before the first paint settles.
            val scene = store.getScene()
            val theme = store.getThemeMode()
            val steerDef = store.getSteerDefault()
            val threadsSort = store.getThreadsSort()
            val (defModel, defProvider, defApi) = store.getDefaultModel()
            val defEffort = store.getDefaultEffort()
            val nWait = store.getNotifyWaiting()
            val nDone = store.getNotifyDone()
            val nClosed = store.getNotifyOnlyClosed()
            val serverIds = store.listServerIds()
            setState {
                it.copy(
                    scene = scene,
                    themeMode = theme,
                    steerDefault = steerDef,
                    activeSteerMode = if (steerDef == "wait") "after" else "steer",
                    threadsSort = threadsSort,
                    defaultModel = defModel,
                    defaultProvider = defProvider,
                    defaultApiMethod = defApi,
                    defaultEffort = defEffort,
                    notifyWaiting = nWait,
                    notifyDone = nDone,
                    notifyOnlyClosed = nClosed,
                    pairedServers = serverIds,
                )
            }
            context?.let { LocalNotifications.ensureChannels(it) }
            // Ask once, after the first successful pairing, with the reason on
            // screen. Never before pairing: nothing to notify about yet.
            setState { it.copy(notificationsPrompt = false) }
            val first = serverIds.firstOrNull()
            if (first == null) {
                setState { it.copy(phase = "unpaired") }
                probeServer(_state.value.pairServer, immediate = true)
                return@launch
            }
            val credential = loadCredential(first) ?: run {
                setState { it.copy(phase = "unpaired") }
                probeServer(_state.value.pairServer, immediate = true)
                return@launch
            }
            setState { it.copy(phase = "ready", serverName = credential.serverId) }
            startClient(credential)
            scope.launch { refreshConnectedHealth(credential.baseUrl) }
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
            val normalized = dev.ziran.android.connection.ServerUrls.normalize(baseUrl)
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
            maybeAskForNotifications()
        } catch (error: Exception) {
            val msg = error.message ?: (error.javaClass.simpleName + " during pairing.")
            val expiredOrUsed = msg.contains("expired", ignoreCase = true) ||
                msg.contains("used", ignoreCase = true) ||
                msg.contains("already", ignoreCase = true)
            setState {
                it.copy(
                    phase = "unpaired",
                    pairingStage = "error",
                    pairingError = msg,
                    pairingMessage = msg,
                    pairCode = if (expiredOrUsed) "" else it.pairCode,
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
                val revoked = adapter.lastCloseReason == "revoked"
                setState {
                    it.copy(
                        connection = when (status) {
                            dev.ziran.android.connection.ConnectionStatus.Connecting -> "connecting"
                            dev.ziran.android.connection.ConnectionStatus.Connected -> "connected"
                            dev.ziran.android.connection.ConnectionStatus.Offline -> "offline"
                        },
                        // A revocation is a source-backed fact, not a guess.
                        connectionMessage = if (revoked) "This device was revoked by the server." else null,
                        savedOnPhone = if (status == dev.ziran.android.connection.ConnectionStatus.Offline) true else it.savedOnPhone,
                        serverName = adapter.server.value?.name ?: it.serverName,
                    )
                }
                if (status == dev.ziran.android.connection.ConnectionStatus.Connected) {
                    maybeDrainQueue()
                    scope.launch { refreshConnectedHealth(credential.baseUrl) }
                }
            }
        }
        scope.launch {
            adapter.server.collect { server ->
                if (server != null) setState { it.copy(serverName = server.name, protocolVersion = server.protocolVersion) }
            }
        }
        scope.launch {
            // One collector, in arrival order. The transport publishes on an
            // unlimited channel precisely so nothing is conflated or dropped.
            adapter.events.collect { envelope ->
                handleEnvelope(envelope)
            }
        }
        // Wait for the socket, then load sessions and restore the session.
        awaitConnected()
        refreshSessions()
        loadQueues(credential)
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

    private var probeJob: Job? = null

    fun probeServer(serverUrl: String = _state.value.pairServer, immediate: Boolean = false) {
        probeJob?.cancel()
        val trimmed = serverUrl.trim()
        if (trimmed.isEmpty()) {
            setState { it.copy(healthProbe = dev.ziran.android.protocol.HealthProbeResult.Idle) }
            return
        }
        probeJob = scope.launch {
            if (!immediate) kotlinx.coroutines.delay(500L)
            setState { it.copy(healthProbe = dev.ziran.android.protocol.HealthProbeResult.Probing) }
            val result = PairingHttp.probeHealth(trimmed, http)
            if (_state.value.pairServer.trim() == trimmed) {
                setState { it.copy(healthProbe = result) }
            }
        }
    }

    fun setPairServer(value: String) {
        setState { it.copy(pairServer = value, pairingError = null) }
        probeServer(value, immediate = false)
    }

    fun setPairCode(value: String) {
        setState {
            it.copy(
                pairCode = value,
                pairingError = null,
                pairingStage = if (it.pairingStage == "error") "idle" else it.pairingStage,
            )
        }
    }

    /** Parse a pasted pairing link exactly as pairingPayload.ts; fill the fields. */
    fun applyPairingLink(raw: String): Boolean {
        return try {
            val payload = dev.ziran.android.protocol.PairingPayload.parse(raw)
            setState {
                it.copy(
                    pairServer = payload.server,
                    pairCode = payload.code,
                    pairPasteNonce = it.pairPasteNonce + 1,
                    pairingError = null,
                    pairingStage = "idle",
                )
            }
            probeServer(payload.server, immediate = true)
            true
        } catch (error: Exception) {
            setState { it.copy(pairingError = error.message ?: "This is not a supported pairing link.") }
            false
        }
    }

    /**
     * Pair from a link. The fields are updated first so, if pairing fails, the
     * screen shows the server that was actually tried instead of the default.
     */
    suspend fun pairFromLink(server: String, code: String) {
        setState { it.copy(pairServer = server, pairCode = code, pairingError = null) }
        pair(server, code, "ziran-android")
    }

    /** The link was not a usable pairing link; say so on the pair screen. */
    fun reportPairingLinkError() {
        setState {
            it.copy(
                phase = "unpaired",
                pairingError = "This pairing link is not valid. Check the adapter's code and try again.",
            )
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

    suspend fun setSteerDefault(mode: String) {
        store.setSteerDefault(mode)
        setState {
            it.copy(
                steerDefault = mode,
                activeSteerMode = when (mode) {
                    "wait" -> "after"
                    "steer" -> "steer"
                    else -> it.activeSteerMode
                },
            )
        }
    }

    fun setActiveSteerMode(mode: String) {
        setState { it.copy(activeSteerMode = mode) }
    }

    suspend fun setThreadsSort(sort: String) {
        store.setThreadsSort(sort)
        setState { it.copy(threadsSort = sort) }
    }

    suspend fun setDefaultModel(model: String, provider: String, apiMethod: String) {
        store.setDefaultModel(model, provider, apiMethod)
        setState { it.copy(defaultModel = model, defaultProvider = provider, defaultApiMethod = apiMethod) }
    }

    suspend fun setDefaultEffort(effort: String) {
        store.setDefaultEffort(effort)
        setState { it.copy(defaultEffort = effort) }
    }

    suspend fun setNotifyWaiting(enabled: Boolean) {
        store.setNotifyWaiting(enabled)
        setState { it.copy(notifyWaiting = enabled) }
    }

    suspend fun setNotifyDone(enabled: Boolean) {
        store.setNotifyDone(enabled)
        setState { it.copy(notifyDone = enabled) }
    }

    suspend fun setNotifyOnlyClosed(enabled: Boolean) {
        store.setNotifyOnlyClosed(enabled)
        setState { it.copy(notifyOnlyClosed = enabled) }
    }

    suspend fun refreshConnectedHealth(baseUrl: String? = currentCredential()?.baseUrl) {
        val url = baseUrl ?: return
        val result = PairingHttp.probeHealth(url, http)
        if (result is dev.ziran.android.protocol.HealthProbeResult.Reachable) {
            setState {
                it.copy(
                    adapterVersion = result.adapterVersion,
                    protocolVersion = result.protocolVersion,
                    jcodeConnected = result.jcodeConnected,
                )
            }
        }
    }

    suspend fun forgetServer(serverId: String) {
        store.removeServer(serverId)
        val remaining = store.listServerIds()
        if (currentCredential()?.serverId == serverId) {
            client?.close()
            client = null
            credential = null
            setState {
                it.copy(
                    phase = if (remaining.isEmpty()) "unpaired" else it.phase,
                    pairedServers = remaining,
                    sessions = emptyList(),
                    activeSessionId = null,
                    snapshot = null,
                    connection = "offline",
                )
            }
            if (remaining.isNotEmpty()) {
                val nextCred = loadCredential(remaining.first())
                if (nextCred != null) {
                    setState { it.copy(phase = "ready", serverName = nextCred.serverId) }
                    startClient(nextCred)
                }
            }
        } else {
            setState { it.copy(pairedServers = remaining) }
        }
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
            // A session that just went idle may hold queued text; drain it into
            // its own thread, not the open one.
            maybeDrainQueue()
        } catch (error: Exception) {
            setState { it.copy(sessionsError = "Sessions could not be refreshed: ${error.message}", savedOnPhone = true) }
        }
    }

    private var sessionsRefreshJob: kotlinx.coroutines.Job? = null

    private fun scheduleSessionsRefresh() {
        sessionsRefreshJob?.cancel()
        sessionsRefreshJob = scope.launch {
            kotlinx.coroutines.delay(120)
            refreshSessions()
        }
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
                plan = cached?.plan,
                context = cached?.context,
                models = emptyList(),
                queuedMessages = credential?.let { queues.list(it.serverId, sessionId) } ?: emptyList(),
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
        scope.launch {
            dev.ziran.android.ui.MarkdownCache.prewarm(snapshot.messages)
            store.saveSnapshotCache(credential.serverId, snapshot.session.sessionId, snapshot.toString())
        }
        setState { applySnapshotToState(it, snapshot) }
        // Delivery is decided by operation state, never by matching text: an
        // older message with the same words is not proof that this send landed.
        reconcilePending()
        maybeDrainQueue()
    }

    /**
     * Ask the adapter for the operation's own state. Pending stays unresolved
     * (and never offers a resend) until the operation itself settles.
     */
    private fun reconcilePending() {
        val pending = _state.value.pending ?: return
        if (pending.state !in setOf("staged", "reserved", "dispatching", "unknown")) return
        val now = System.currentTimeMillis()
        if (now - lastPendingLookupAt < 2_000) return
        lastPendingLookupAt = now
        scope.launch { lookupOperation(pending.operationId) }
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
            is dev.ziran.android.protocol.SessionEvent.TurnDone -> {
                notify(LocalNotifications.CHANNEL_TURNS, "Turn complete", "The agent finished in this thread.")
                scheduleSnapshot(150)
            }
            is dev.ziran.android.protocol.SessionEvent.TurnStopped -> scheduleSnapshot(150)
            else -> Unit
        }
        maybeDrainQueue()
    }

    // -- send / stop / permission ---------------------------------------------

    fun setComposerText(text: String) {
        _composerText.value = text
        val credential = currentCredential() ?: return
        val sessionId = _state.value.activeSessionId ?: return
        draftSaveJob?.cancel()
        draftSaveJob = scope.launch {
            kotlinx.coroutines.delay(250L)
            store.saveDraft(credential.serverId, sessionId, text)
        }
    }

    /** Persist per-device reading position when connected to an Adapter v5 server. */
    fun reportReadingPosition(sessionId: String, messageIndex: Int, scrollOffsetPx: Int = 0) {
        val adapter = client ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        val caps = adapter.server.value?.capabilities.orEmpty()
        if ("reading.positions" !in caps) return
        scope.launch {
            runCatching {
                adapter.request(
                    "reading.set",
                    JsonObject(
                        mapOf(
                            "session_id" to JsonPrimitive(sessionId),
                            "message_index" to JsonPrimitive(messageIndex),
                            "scroll_offset_px" to JsonPrimitive(scrollOffsetPx),
                            "last_read_seq" to JsonPrimitive(_state.value.lastSeq),
                        ),
                    ),
                    sessionId = sessionId,
                    timeoutMs = 5000,
                )
            }
        }
    }

    suspend fun send() = sendText(_composerText.value.ifEmpty { _state.value.composerText })

    /**
     * Send exactly the given text.
     *
     * A queue drain passes the session it was queued in, so a message written
     * in thread A still lands in A when thread B is on screen. It never touches
     * the composer.
     */
    suspend fun sendText(
        rawText: String,
        targetSessionId: String? = null,
        fromQueue: Boolean = false,
        steerModeOverride: String? = null,
    ) {
        val text = rawText.trim()
        val sessionId = targetSessionId ?: _state.value.activeSessionId ?: return
        val isActive = _state.value.activeSessionId == sessionId
        val adapter = client ?: run { setState { it.copy(sessionsError = "The adapter is offline. The draft is saved on this phone.") }; return }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(sessionsError = "The adapter is offline. The draft is saved on this phone.") }
            return
        }
        if (text.isEmpty()) return
        val pending = if (isActive) _state.value.pending else null
        if (OperationReconciler.isBlockingNewSend(pending)) {
            setState { it.copy(sessionsError = "This message is still being resolved. Do not resend it.") }
            return
        }
        val isWorking = isActive && (_state.value.live.turnId != null || _state.value.live.daemonRunning)
        var expectedTurnId: String? = null
        var sentTag: String? = null
        if (isWorking && !fromQueue) {
            val mode = steerModeOverride ?: _state.value.activeSteerMode
            when (mode) {
                "after" -> {
                    enqueue(sessionId, text)
                    setState {
                        it.copy(
                            composerText = "",
                            live = it.live.copy(sentDuringTurn = it.live.sentDuringTurn + SentTurnNote(text, "waits for the turn")),
                        )
                    }
                    val serverId = currentCredential()?.serverId
                    if (serverId != null) store.saveDraft(serverId, sessionId, "")
                    return
                }
                "stop" -> {
                    stop()
                    // Wait for turn_stopped / idle before sending; never dispatch while still running.
                    var waited = 0
                    while (waited < 20000 && (_state.value.live.turnId != null || _state.value.live.daemonRunning)) {
                        kotlinx.coroutines.delay(100L)
                        waited += 100
                    }
                    if (_state.value.live.turnId != null || _state.value.live.daemonRunning) {
                        setState {
                            it.copy(
                                sessionsError = "The current turn is still stopping. Wait for it to settle before sending.",
                            )
                        }
                        return
                    }
                    expectedTurnId = null
                    sentTag = "sent after stop"
                }
                else -> {
                    // Steer now: reserve with expected_turn_id = active turn id (soft interrupt).
                    val activeTurn = _state.value.live.turnId
                    if (activeTurn != null) {
                        expectedTurnId = activeTurn
                        sentTag = "steering"
                    } else {
                        // Honest fallback when turn_id is unknown: queue after this turn.
                        enqueue(sessionId, text)
                        setState {
                            it.copy(
                                composerText = "",
                                live = it.live.copy(sentDuringTurn = it.live.sentDuringTurn + SentTurnNote(text, "waits for the turn")),
                            )
                        }
                        val serverId = currentCredential()?.serverId
                        if (serverId != null) store.saveDraft(serverId, sessionId, "")
                        return
                    }
                }
            }
        }
        val credential = currentCredential() ?: return
        val operationId = UUID.randomUUID().toString()
        val next = PendingMessage(text, operationId, "staged", null, System.currentTimeMillis())
        // A queue drain must leave the user's draft exactly as it is.
        if (!fromQueue) store.saveDraft(credential.serverId, sessionId, text)
        store.savePending(credential.serverId, sessionId, operationId, text, "staged", next.createdAt)
        setState {
            it.copy(
                pending = if (isActive) next else it.pending,
                composerText = if (isActive) "" else it.composerText,
                live = if (isActive && sentTag != null) {
                    it.live.copy(sentDuringTurn = it.live.sentDuringTurn + SentTurnNote(text, sentTag))
                } else it.live,
            )
        }
        try {
            val reserved = adapter.request(
                "operations.reserve",
                dev.ziran.android.protocol.RequestPayloads.reserve(
                    operationId = operationId,
                    sessionId = sessionId,
                    body = text,
                    expectedTurnId = expectedTurnId,
                ),
                sessionId = sessionId,
                operationId = operationId,
                timeoutMs = 15000,
            )
            applyOperation(dev.ziran.android.protocol.parseOperation((reserved["operation"] as? JsonObject) ?: JsonObject(emptyMap())))
            val dispatched = adapter.request(
                "operations.dispatch",
                dev.ziran.android.protocol.RequestPayloads.dispatch(operationId),
                sessionId = sessionId,
                operationId = operationId,
                timeoutMs = 40000,
            )
            applyOperation(dev.ziran.android.protocol.parseOperation((dispatched["operation"] as? JsonObject) ?: JsonObject(emptyMap())))
            if (!fromQueue) store.saveDraft(credential.serverId, sessionId, "")
        } catch (error: Exception) {
            // Only an adapter `error` reply proves the attempt never entered the
            // session. Anything else (socket close, timeout) is unknown: the
            // bytes may have reached the agent, so no resend is offered.
            val rejected = error is AdapterRequestError
            if (rejected) {
                setState {
                    it.copy(
                        pending = if (isActive) null else it.pending,
                        composerText = if (isActive && !fromQueue) text else it.composerText,
                    )
                }
                store.clearPending(credential.serverId, sessionId)
                if (fromQueue) {
                    // The queued text was never accepted: keep it queued rather
                    // than silently dropping it into the draft field.
                    val restored = queues.pushFront(credential.serverId, sessionId, text)
                    store.saveQueue(credential.serverId, sessionId, restored)
                    if (_state.value.activeSessionId == sessionId) setState { it.copy(queuedMessages = restored) }
                    setState { it.copy(sessionsError = "Queued message was not sent: ${error.message}") }
                } else {
                    store.saveDraft(credential.serverId, sessionId, text)
                    setState { it.copy(sessionsError = "Message was not sent: ${error.message}") }
                }
            } else {
                val unknown = next.copy(state = "unknown", error = error.message)
                setState { it.copy(pending = if (isActive) unknown else it.pending) }
                store.savePending(credential.serverId, sessionId, operationId, text, "unknown", next.createdAt)
                setState { it.copy(sessionsError = "Delivery unconfirmed: ${error.message}") }
            }
        }
    }

    private var draining = false
    private var lastPendingLookupAt = 0L

    private suspend fun enqueue(sessionId: String, text: String) {
        val serverId = currentCredential()?.serverId ?: return
        val next = queues.enqueue(serverId, sessionId, text)
        store.saveQueue(serverId, sessionId, next)
        if (_state.value.activeSessionId == sessionId) setState { it.copy(queuedMessages = next) }
    }

    private suspend fun loadQueues(credential: PairedCredential) {
        for (sessionId in store.queuedSessionIds(credential.serverId)) {
            queues.load(credential.serverId, sessionId, store.loadQueue(credential.serverId, sessionId))
        }
        val active = _state.value.activeSessionId
        if (active != null) setState { it.copy(queuedMessages = queues.list(credential.serverId, active)) }
    }

    /**
     * Send the oldest queued message of whichever session has gone idle.
     *
     * Each take is scoped to that one session, and the text goes straight to
     * sendText: the composer keeps whatever the user is typing now.
     */
    private fun maybeDrainQueue() {
        if (draining) return
        val credential = currentCredential() ?: return
        val current = _state.value
        // Never spend a queued message while offline: it would be lost without
        // an operation to look up later.
        if (current.connection != "connected") return
        val target = queues.pendingSessions().firstOrNull { (serverId, sessionId) ->
            serverId == credential.serverId && sessionIsIdle(sessionId)
        } ?: return
        val sessionId = target.second
        val text = queues.takeFirst(credential.serverId, sessionId) ?: return
        draining = true
        scope.launch {
            store.saveQueue(credential.serverId, sessionId, queues.list(credential.serverId, sessionId))
            if (_state.value.activeSessionId == sessionId) {
                setState { it.copy(queuedMessages = queues.list(credential.serverId, sessionId)) }
            }
            try {
                sendText(text, targetSessionId = sessionId, fromQueue = true)
            } finally {
                draining = false
                maybeDrainQueue()
            }
        }
    }

    /**
     * Idle means source-backed: the live turn for the open session, or the
     * session list status for any other one.
     */
    private fun sessionIsIdle(sessionId: String): Boolean {
        val state = _state.value
        if (state.activeSessionId == sessionId) {
            return state.live.turnId == null && !state.live.daemonRunning
        }
        val summary = state.sessions.firstOrNull { it.sessionId == sessionId } ?: return false
        return summary.status == "idle"
    }

    /**
     * On Android 13+ a notification needs a runtime permission. Ask once, after
     * pairing, and say why on screen rather than firing a bare system dialog.
     */
    private suspend fun maybeAskForNotifications() {
        val ctx = context ?: return
        if (android.os.Build.VERSION.SDK_INT < 33) return
        if (store.notificationsAsked()) return
        if (LocalNotifications.hasPermission(ctx)) {
            store.setNotificationsAsked(true)
            return
        }
        setState { it.copy(notificationsPrompt = true) }
    }

    /** Record the user's answer; the prompt is not shown again. */
    fun notificationsHandled(granted: Boolean) {
        scope.launch {
            store.setNotificationsAsked(true)
            setState { it.copy(notificationsPrompt = false) }
            if (granted) context?.let { LocalNotifications.ensureChannels(it) }
        }
    }

    private fun notify(kind: String, title: String, body: String) {
        val ctx = context ?: return
        val st = _state.value
        val sessionId = st.activeSessionId ?: return
        val allowed = when (kind) {
            LocalNotifications.CHANNEL_APPROVAL -> st.notifyWaiting
            LocalNotifications.CHANNEL_TURNS -> st.notifyDone
            else -> true
        }
        if (!allowed) return
        LocalNotifications.postIfBackgrounded(ctx, kind, sessionId, title, body, onlyWhenClosed = st.notifyOnlyClosed)
    }

    /**
     * Reconcile one operation by id.
     *
     * A late `dispatching` update must not walk a terminal state backwards, and
     * a `rejected`/`cancelled` operation proves the attempt never landed, so the
     * pending entry clears and the text returns to the draft.
     */
    private fun applyOperation(operation: OperationView) {
        if (operation.operationId.isEmpty()) return
        val previous = _state.value.operations[operation.operationId]
        if (OperationReconciler.isStaleEcho(previous, operation)) return

        val credential = currentCredential()
        val sessionId = _state.value.activeSessionId
        val pending = _state.value.pending
        val isMine = pending != null && pending.operationId == operation.operationId
        val outcome = OperationReconciler.reconcile(pending, operation)

        setState {
            it.copy(
                operations = it.operations + (operation.operationId to operation),
                pending = outcome.pending,
                composerText = outcome.restoreComposerText ?: it.composerText,
                sessionsError = outcome.errorMessage ?: it.sessionsError,
            )
        }
        if (isMine && credential != null && sessionId != null) {
            val settled = outcome.pending
            val text = outcome.restoreComposerText
            scope.launch {
                if (settled == null) {
                    store.clearPending(credential.serverId, sessionId)
                    if (text != null) store.saveDraft(credential.serverId, sessionId, text)
                } else {
                    store.savePending(
                        credential.serverId, sessionId,
                        settled.operationId, settled.text, settled.state, settled.createdAt,
                    )
                }
            }
        }
    }

    suspend fun lookupOperation(operationId: String) {
        val adapter = client ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        try {
            val payload = adapter.request(
                "operations.lookup",
                dev.ziran.android.protocol.RequestPayloads.lookupOperation(operationId),
            )
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
                dev.ziran.android.protocol.RequestPayloads.cancel(
                    sessionId = sessionId,
                    operationId = _state.value.live.operationId,
                    expectedTurnId = turnId,
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
            // A rejected stop is not a silent no-op: say so, and re-read the
            // session so the status line is source-backed again.
            val conflict = error is AdapterRequestError && error.code == "conflict"
            setState {
                it.copy(
                    sessionsError = if (conflict) {
                        "Stop conflicted with server state. Refreshing the session."
                    } else {
                        "Stop was rejected: ${error.message}"
                    },
                )
            }
            if (conflict || error is AdapterRequestError) refreshSnapshot()
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

    // -- plan -----------------------------------------------------------------

    suspend fun refreshPlan() {
        val adapter = client ?: return
        val sessionId = _state.value.activeSessionId ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        try {
            val payload = adapter.request(
                "plan.snapshot",
                JsonObject(mapOf("session_id" to JsonPrimitive(sessionId))),
                sessionId = sessionId,
                timeoutMs = 15000,
            )
            val parsed = dev.ziran.android.protocol.parsePlan(payload["plan"])
            if (_state.value.activeSessionId == sessionId) {
                setState { it.copy(plan = parsed) }
            }
        } catch (_: Exception) {
        }
    }

    fun coordinatorSessionId(state: AppState = _state.value): String? {
        val active = state.activeSessionId
        val parent = state.snapshot?.session?.parentSessionId
        if (!parent.isNullOrBlank()) return parent
        val coordinator = state.agents?.firstOrNull { it.parentSessionId.isNullOrBlank() }
        return coordinator?.sessionId ?: active
    }

    // -- models ---------------------------------------------------------------

    suspend fun refreshModels() {
        val adapter = client ?: return
        val sessionId = _state.value.activeSessionId ?: _state.value.sessions.firstOrNull()?.sessionId ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        try {
            val payload = adapter.request("models.list", JsonObject(mapOf("session_id" to JsonPrimitive(sessionId))), sessionId = sessionId, timeoutMs = 25000)
            val runtime = dev.ziran.android.protocol.parseRuntime(payload["runtime"] as? JsonObject)
            val models = payload["models"]?.let {
                (it as? kotlinx.serialization.json.JsonArray)?.mapNotNull { item -> (item as? JsonObject)?.let { m -> dev.ziran.android.protocol.parseRoute(m) } }
            } ?: emptyList()
            if (_state.value.activeSessionId == null || _state.value.activeSessionId == sessionId) {
                setState { it.copy(models = models, runtime = latestRuntime(it.runtime, runtime), modelsError = null) }
            }
        } catch (_: Exception) {
            if (_state.value.activeSessionId == null || _state.value.activeSessionId == sessionId) {
                setState { it.copy(models = emptyList()) }
            }
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
                dev.ziran.android.protocol.RequestPayloads.favorite(sessionId, favorite),
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

    suspend fun createSession(projectId: String?, title: String, workingDir: String? = null) {
        val adapter = client ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        val clientRequestId = UUID.randomUUID().toString()
        try {
            val payload = adapter.request(
                "sessions.create",
                dev.ziran.android.protocol.RequestPayloads.create(
                    clientRequestId = clientRequestId,
                    projectId = projectId,
                    title = title,
                    workingDir = workingDir,
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
