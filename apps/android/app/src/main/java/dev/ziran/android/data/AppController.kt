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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
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
    private val drainPolicy = QueueDrainPolicy()
    private var adapterGeneration = 0L
    private var adapterScope: CoroutineScope? = null
    private var sessionGeneration = 0
    private var snapshotTimer: Job? = null
    private var queueRetryJob: Job? = null
    private val inFlightSends = java.util.Collections.synchronizedSet(mutableSetOf<String>())
    private val notifiedKeys = java.util.Collections.synchronizedSet(LinkedHashSet<String>())
    private var pendingCreateRequestId: String? = null
    private var pendingCreateTitle: String? = null

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
            scope.launch { checkForUpdates(manual = false) }
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
        adapterGeneration++
        val gen = adapterGeneration
        adapterScope?.cancel()
        snapshotTimer?.cancel()
        sessionsRefreshJob?.cancel()
        queueRetryJob?.cancel()
        val previous = client
        previous?.close()
        val clientScope = CoroutineScope(SupervisorJob(scope.coroutineContext[Job]) + Dispatchers.Default)
        adapterScope = clientScope
        val adapter = AdapterClient(credential.baseUrl, credential.token, clientScope)
        client = adapter
        setState {
            it.copy(
                connection = "connecting",
                reconnecting = false,
                hasAuthoritativeSessions = false,
                sessionsLoading = true,
                backendReady = null,
                backendName = null,
                serverCapabilities = emptySet(),
                sessionsError = null,
            )
        }
        adapter.connect()
        clientScope.launch {
            var everConnected = false
            adapter.status.collect { status ->
                if (gen != adapterGeneration) return@collect
                if (status == dev.ziran.android.connection.ConnectionStatus.Connected) everConnected = true
                val revoked = adapter.lastCloseReason == "revoked"
                setState {
                    it.copy(
                        connection = when (status) {
                            dev.ziran.android.connection.ConnectionStatus.Connecting -> "connecting"
                            dev.ziran.android.connection.ConnectionStatus.Connected -> "connected"
                            dev.ziran.android.connection.ConnectionStatus.Offline -> "offline"
                        },
                        reconnecting = everConnected && status != dev.ziran.android.connection.ConnectionStatus.Connected && !revoked,
                        // A revocation is a source-backed fact, not a guess.
                        connectionMessage = if (revoked) "This device was revoked by the server." else null,
                        savedOnPhone = if (status == dev.ziran.android.connection.ConnectionStatus.Offline) true else it.savedOnPhone,
                        serverName = adapter.server.value?.name ?: it.serverName,
                    )
                }
                if (status == dev.ziran.android.connection.ConnectionStatus.Connected) {
                    maybeDrainQueue()
                    clientScope.launch {
                        refreshConnectedHealth(credential.baseUrl, gen)
                        if (everConnected) refreshSessions()
                    }
                }
            }
        }
        clientScope.launch {
            adapter.server.collect { server ->
                if (gen != adapterGeneration) return@collect
                if (server != null) {
                    val detectedBackend = inferBackendName(server)
                    setState {
                        it.copy(
                            serverName = server.name,
                            adapterVersion = server.adapterVersion,
                            protocolVersion = server.protocolVersion,
                            serverCapabilities = server.capabilities.toSet(),
                            backendName = detectedBackend ?: it.backendName,
                            backendReady = if (server.healthy) true else it.backendReady,
                        )
                    }
                }
            }
        }
        clientScope.launch {
            // One collector, in arrival order. The transport publishes on an
            // unlimited channel precisely so nothing is conflated or dropped.
            adapter.events.collect { envelope ->
                if (gen != adapterGeneration) return@collect
                handleEnvelope(envelope, credential.serverId, gen)
            }
        }
        // Load cached sessions first so offline cold-start never claims confirmed empty,
        // then wait for socket & fetch authoritative sessions.
        val cachedList = loadCachedSessions(credential.serverId)
        if (gen != adapterGeneration) return
        if (cachedList != null) {
            setState {
                it.copy(
                    sessions = cachedList,
                    savedOnPhone = true,
                )
            }
        }
        awaitConnected(gen)
        if (gen != adapterGeneration) return
        refreshSessions()
        if (gen != adapterGeneration) return
        loadQueues(credential)
        val last = store.getLastSession(credential.serverId)
        val ids = _state.value.sessions.map { it.sessionId }
        if (last != null && (ids.contains(last) || cachedList?.any { it.sessionId == last } == true)) {
            openSession(last)
        }
    }

    private fun inferBackendName(server: dev.ziran.android.protocol.ServerInfo): String? {
        val caps = server.capabilities
        return when {
            caps.any { it.equals("backend:pu", ignoreCase = true) || it.equals("driver:pu", ignoreCase = true) } -> "Pu"
            caps.any { it.equals("backend:jcode", ignoreCase = true) || it.equals("driver:jcode", ignoreCase = true) } -> "JCode"
            server.jcodeVersion.isNotBlank() && server.jcodeVersion != "unknown" -> "JCode"
            else -> null
        }
    }

    /** Trigger an immediate reconnect from the Home offline/reconnecting UI (#118). */
    fun reconnectNow() {
        val adapter = client
        val cred = currentCredential()
        if (adapter != null) {
            setState { it.copy(connection = "connecting", reconnecting = true, sessionsError = null) }
            adapter.reconnectNow()
        } else if (cred != null) {
            scope.launch { startClient(cred) }
        }
    }

    private suspend fun awaitConnected(gen: Long = adapterGeneration) {
        var tries = 0
        while (gen == adapterGeneration && client?.status?.value != dev.ziran.android.connection.ConnectionStatus.Connected && tries < 50) {
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

    suspend fun refreshConnectedHealth(baseUrl: String? = currentCredential()?.baseUrl, gen: Long = adapterGeneration) {
        val url = baseUrl ?: return
        val result = PairingHttp.probeHealth(url, http)
        if (gen != adapterGeneration) return
        if (result is dev.ziran.android.protocol.HealthProbeResult.Reachable) {
            setState {
                it.copy(
                    adapterVersion = result.adapterVersion,
                    protocolVersion = result.protocolVersion,
                    jcodeConnected = result.jcodeConnected,
                    backendReady = result.jcodeConnected || it.backendReady == true,
                )
            }
        }
    }

    suspend fun forgetServer(serverId: String) {
        store.removeServer(serverId)
        val remaining = store.listServerIds()
        if (currentCredential()?.serverId == serverId) {
            adapterGeneration++
            adapterScope?.cancel()
            adapterScope = null
            snapshotTimer?.cancel()
            sessionsRefreshJob?.cancel()
            queueRetryJob?.cancel()
            client?.close()
            client = null
            credential = null
            setState {
                it.copy(
                    phase = if (remaining.isEmpty()) "unpaired" else it.phase,
                    pairedServers = remaining,
                    sessions = emptyList(),
                    hasAuthoritativeSessions = false,
                    sessionsLoading = false,
                    lastSyncedAtMs = null,
                    activeSessionId = null,
                    snapshot = null,
                    connection = "offline",
                    reconnecting = false,
                    backendReady = null,
                    backendName = null,
                    serverCapabilities = emptySet(),
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

    private fun handleEnvelope(envelope: dev.ziran.android.protocol.Envelope, serverId: String, gen: Long) {
        if (gen != adapterGeneration) return
        when (envelope.type) {
            "session.event" -> {
                val payload = dev.ziran.android.protocol.parseSessionEvent(envelope.payload) ?: return
                onSessionEvent(serverId, envelope.sessionId, envelope.epoch, envelope.seq, payload)
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
                val backendConnectedRaw = envelope.payload["backend_connected"]
                    ?: envelope.payload["agent_connected"]
                    ?: envelope.payload["jcode_connected"]
                val connected = backendConnectedRaw?.toString()?.trim('"') == "true"
                val explicitBackend = (envelope.payload["backend_name"] ?: envelope.payload["agent_name"])
                    ?.toString()?.trim('"')?.ifBlank { null }
                val legacyJcode = envelope.payload.containsKey("jcode_connected") && explicitBackend == null
                val was = _state.value.backendReady == true
                setState {
                    it.copy(
                        jcodeConnected = connected,
                        backendReady = connected,
                        backendName = explicitBackend ?: it.backendName ?: if (legacyJcode) "JCode" else null,
                    )
                }
                if (connected && !was && _state.value.activeSessionId != null) {
                    _state.value.activeSessionId?.let { id ->
                        adapterScope?.launch { subscribeToSession(id, forReconnect = true) }
                    }
                }
            }
            "sessions.changed" -> scheduleSessionsRefresh()
            else -> Unit
        }
    }

    // -- sessions -------------------------------------------------------------

    suspend fun refreshSessions() {
        val gen = adapterGeneration
        val adapter = client ?: return
        val credential = currentCredential() ?: return
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            val cached = loadCachedSessions(credential.serverId)
            if (gen != adapterGeneration) return
            setState {
                it.copy(
                    sessions = cached ?: it.sessions,
                    sessionsLoading = false,
                    savedOnPhone = cached != null || it.sessions.isNotEmpty(),
                    sessionsError = if (cached != null) "Adapter unreachable. Showing data saved on this phone." else it.sessionsError,
                )
            }
            return
        }
        setState { it.copy(sessionsLoading = true) }
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
            if (gen != adapterGeneration) return
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
            if (gen != adapterGeneration) return
            val active = _state.value.activeSessionId
            setState {
                it.copy(
                    sessions = merged,
                    sessionRevision = revision,
                    savedOnPhone = false,
                    hasAuthoritativeSessions = true,
                    sessionsLoading = false,
                    lastSyncedAtMs = System.currentTimeMillis(),
                    sessionsError = null,
                    activeMissing = active != null && merged.none { s -> s.sessionId == active } && it.snapshot?.session?.sessionId != active,
                )
            }
            // A session that just went idle may hold queued text; drain it into
            // its own thread, not the open one.
            maybeDrainQueue()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (gen != adapterGeneration) return
            setState {
                it.copy(
                    sessionsLoading = false,
                    sessionsError = "Sessions could not be refreshed: ${error.message}",
                    savedOnPhone = it.sessions.isNotEmpty(),
                )
            }
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

    suspend fun openSession(sessionId: String, forReconnect: Boolean = false, targetServerId: String? = null) {
        if (!targetServerId.isNullOrBlank() && targetServerId != currentCredential()?.serverId) {
            val targetCred = loadCredential(targetServerId)
            if (targetCred != null) {
                setState { it.copy(phase = "ready", serverName = targetCred.serverId) }
                startClient(targetCred)
            }
        }
        val gen = adapterGeneration
        sessionGeneration++
        val generation = sessionGeneration
        val credential = currentCredential()
        val draft = credential?.let { store.loadDraft(it.serverId, sessionId) } ?: ""
        val pending = credential?.let { store.loadPending(it.serverId, sessionId) }
        val cached = credential?.let { loadCachedSnapshot(it.serverId, sessionId) }
        if (generation != sessionGeneration || gen != adapterGeneration) return
        val previous = _state.value.activeSessionId
        _composerText.value = draft
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
                modelsError = null,
                modelActionError = null,
                queuedMessages = credential?.let { queues.list(it.serverId, sessionId) } ?: emptyList(),
                queuedError = credential?.let { drainPolicy.pausedError(it.serverId, sessionId) },
            )
        }
        credential?.let { store.setLastSession(it.serverId, sessionId) }
        if (pending != null) lookupOperation(pending.operationId)
        if (client?.status?.value != dev.ziran.android.connection.ConnectionStatus.Connected) return
        if (previous != null && previous != sessionId) {
            try { client?.request("sessions.unsubscribe", JsonObject(mapOf("session_id" to JsonPrimitive(previous))), timeoutMs = 8000) } catch (_: Exception) { }
        }
        if (generation == sessionGeneration && gen == adapterGeneration) subscribeToSession(sessionId, forReconnect)
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

    private fun onSessionEvent(
        serverId: String,
        sessionId: String?,
        epoch: String?,
        seq: Long?,
        payload: dev.ziran.android.protocol.SessionEventPayload,
    ) {
        // Multi-thread notification routing runs BEFORE active-session UI filtering (#122).
        if (!sessionId.isNullOrBlank()) {
            val threadTitle = _state.value.sessions.firstOrNull { it.sessionId == sessionId }?.title
            val eventKey = "$serverId|$sessionId|${payload.eventKind}|${payload.turnId.orEmpty()}|${seq ?: 0L}"
            when (val event = payload.event) {
                is dev.ziran.android.protocol.SessionEvent.PermissionRequest -> {
                    val permKey = "$serverId|$sessionId|perm|${event.requestId}"
                    val title = if (!threadTitle.isNullOrBlank()) "Approval needed · $threadTitle" else "Approval needed"
                    notify(
                        kind = LocalNotifications.CHANNEL_APPROVAL,
                        serverId = serverId,
                        sessionId = sessionId,
                        eventKey = permKey,
                        title = title,
                        body = "Tool ${event.toolName} is waiting for your decision.",
                    )
                }
                is dev.ziran.android.protocol.SessionEvent.TurnDone -> {
                    val title = if (!threadTitle.isNullOrBlank()) "Turn complete · $threadTitle" else "Turn complete"
                    notify(
                        kind = LocalNotifications.CHANNEL_TURNS,
                        serverId = serverId,
                        sessionId = sessionId,
                        eventKey = eventKey,
                        title = title,
                        body = "The agent finished its turn.",
                    )
                }
                is dev.ziran.android.protocol.SessionEvent.AdapterError -> {
                    val title = if (!threadTitle.isNullOrBlank()) "Turn failed · $threadTitle" else "Turn failed"
                    notify(
                        kind = LocalNotifications.CHANNEL_FAILURES,
                        serverId = serverId,
                        sessionId = sessionId,
                        eventKey = eventKey,
                        title = title,
                        body = "An error interrupted this thread.",
                    )
                }
                else -> Unit
            }
        }
        if (sessionId != _state.value.activeSessionId) {
            if (payload.event is dev.ziran.android.protocol.SessionEvent.TurnDone ||
                payload.event is dev.ziran.android.protocol.SessionEvent.TurnStopped
            ) {
                scheduleSessionsRefresh()
            }
            return
        }
        if (_state.value.snapshot == null) { scheduleSnapshot(250); return }
        val reduction = reducer.reduceEvent(_state.value, sessionId, epoch, seq, payload)
        setState { reduction.state }
        if (reduction.effect is LiveReducer.Effect.NeedSnapshot) scheduleSnapshot(150)
        when (payload.event) {
            is dev.ziran.android.protocol.SessionEvent.TurnDone -> scheduleSnapshot(150)
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

    enum class SendOutcome { ACCEPTED, REJECTED, UNCERTAIN, DEFERRED }

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
    ): SendOutcome {
        val text = rawText.trim()
        val sessionId = targetSessionId ?: _state.value.activeSessionId ?: return SendOutcome.DEFERRED
        val credential = currentCredential() ?: return SendOutcome.DEFERRED
        val gen = adapterGeneration
        val adapter = client ?: run {
            setState { it.copy(sessionsError = "The adapter is offline. The draft is saved on this phone.") }
            return SendOutcome.DEFERRED
        }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(sessionsError = "The adapter is offline. The draft is saved on this phone.") }
            return SendOutcome.DEFERRED
        }
        if (text.isEmpty()) return SendOutcome.DEFERRED
        val lockKey = "${credential.serverId}|$sessionId"
        if (!inFlightSends.add(lockKey)) {
            if (!fromQueue) {
                setState { it.copy(sessionsError = "A message is already being sent in this thread.") }
            }
            return SendOutcome.DEFERRED
        }
        try {
            val isActiveNow = _state.value.activeSessionId == sessionId
            val pending = if (isActiveNow) {
                _state.value.pending
            } else {
                store.loadPending(credential.serverId, sessionId)?.let { p ->
                    PendingMessage(p.text, p.operationId, p.state, null, p.createdAtMs)
                }
            }
            if (OperationReconciler.isBlockingNewSend(pending)) {
                setState { it.copy(sessionsError = "This message is still being resolved. Do not resend it.") }
                return SendOutcome.DEFERRED
            }
            val isWorking = isActiveNow && (_state.value.live.turnId != null || _state.value.live.daemonRunning)
            var expectedTurnId: String? = null
            var sentTag: String? = null
            if (isWorking && !fromQueue) {
                val mode = steerModeOverride ?: _state.value.activeSteerMode
                when (mode) {
                    "after" -> {
                        enqueue(sessionId, text)
                        setState {
                            it.copy(
                                composerText = if (it.activeSessionId == sessionId) "" else it.composerText,
                                live = if (it.activeSessionId == sessionId) {
                                    it.live.copy(sentDuringTurn = it.live.sentDuringTurn + SentTurnNote(text, "waits for the turn"))
                                } else it.live,
                            )
                        }
                        store.saveDraft(credential.serverId, sessionId, "")
                        return SendOutcome.ACCEPTED
                    }
                    "stop" -> {
                        stop()
                        var waited = 0
                        while (waited < 20000 && gen == adapterGeneration && (_state.value.live.turnId != null || _state.value.live.daemonRunning)) {
                            kotlinx.coroutines.delay(100L)
                            waited += 100
                        }
                        if (gen != adapterGeneration) return SendOutcome.DEFERRED
                        if (_state.value.live.turnId != null || _state.value.live.daemonRunning) {
                            setState {
                                it.copy(
                                    sessionsError = "The current turn is still stopping. Wait for it to settle before sending.",
                                )
                            }
                            return SendOutcome.DEFERRED
                        }
                        expectedTurnId = null
                        sentTag = "sent after stop"
                    }
                    else -> {
                        val activeTurn = _state.value.live.turnId
                        if (activeTurn != null) {
                            expectedTurnId = activeTurn
                            sentTag = "steering"
                        } else {
                            enqueue(sessionId, text)
                            setState {
                                it.copy(
                                    composerText = if (it.activeSessionId == sessionId) "" else it.composerText,
                                    live = if (it.activeSessionId == sessionId) {
                                        it.live.copy(sentDuringTurn = it.live.sentDuringTurn + SentTurnNote(text, "waits for the turn"))
                                    } else it.live,
                                )
                            }
                            store.saveDraft(credential.serverId, sessionId, "")
                            return SendOutcome.ACCEPTED
                        }
                    }
                }
            }
            val operationId = UUID.randomUUID().toString()
            val next = PendingMessage(text, operationId, "staged", null, System.currentTimeMillis())
            // A queue drain must leave the user's draft exactly as it is (#119).
            if (!fromQueue) {
                store.saveDraft(credential.serverId, sessionId, text)
                if (_state.value.activeSessionId == sessionId) _composerText.value = ""
            }
            store.savePending(credential.serverId, sessionId, operationId, text, "staged", next.createdAt)
            setState {
                val activeMatch = it.activeSessionId == sessionId
                it.copy(
                    pending = if (activeMatch) next else it.pending,
                    composerText = if (activeMatch && !fromQueue) "" else it.composerText,
                    live = if (activeMatch && sentTag != null) {
                        it.live.copy(sentDuringTurn = it.live.sentDuringTurn + SentTurnNote(text, sentTag))
                    } else it.live,
                )
            }
            return try {
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
                SendOutcome.ACCEPTED
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                // Only an adapter `error` reply proves the attempt never entered the
                // session. Anything else (socket close, timeout) is unknown: the
                // bytes may have reached the agent, so no resend is offered.
                val rejected = error is AdapterRequestError
                if (rejected) {
                    setState {
                        val activeMatch = it.activeSessionId == sessionId
                        it.copy(
                            pending = if (activeMatch) null else it.pending,
                            composerText = if (activeMatch && !fromQueue) text else it.composerText,
                            sessionsError = if (fromQueue) {
                                "Queued message was not sent: ${error.message}"
                            } else {
                                "Message was not sent: ${error.message}"
                            },
                        )
                    }
                    store.clearPending(credential.serverId, sessionId)
                    if (!fromQueue) store.saveDraft(credential.serverId, sessionId, text)
                    SendOutcome.REJECTED
                } else {
                    val unknown = next.copy(state = "unknown", error = error.message)
                    setState {
                        val activeMatch = it.activeSessionId == sessionId
                        it.copy(
                            pending = if (activeMatch) unknown else it.pending,
                            sessionsError = "Delivery unconfirmed: ${error.message}",
                        )
                    }
                    store.savePending(credential.serverId, sessionId, operationId, text, "unknown", next.createdAt)
                    SendOutcome.UNCERTAIN
                }
            }
        } finally {
            inFlightSends.remove(lockKey)
        }
    }

    private var draining = false
    private var lastPendingLookupAt = 0L

    private suspend fun enqueue(sessionId: String, text: String) {
        val serverId = currentCredential()?.serverId ?: return
        drainPolicy.clear(serverId, sessionId)
        val next = queues.enqueue(serverId, sessionId, text)
        store.saveQueue(serverId, sessionId, next)
        if (_state.value.activeSessionId == sessionId) setState { it.copy(queuedMessages = next, queuedError = null) }
    }

    /** User explicitly retries a paused queued message after a rejection or backoff pause (#119). */
    fun retryQueuedMessages(sessionId: String? = _state.value.activeSessionId) {
        val serverId = currentCredential()?.serverId ?: return
        val sid = sessionId ?: return
        drainPolicy.clear(serverId, sid)
        if (_state.value.activeSessionId == sid) setState { it.copy(queuedError = null) }
        maybeDrainQueue()
    }

    /** User removes the head queued message when they no longer want it sent (#119). */
    fun discardFirstQueuedMessage(sessionId: String? = _state.value.activeSessionId) {
        val serverId = currentCredential()?.serverId ?: return
        val sid = sessionId ?: return
        queues.takeFirst(serverId, sid)
        drainPolicy.clear(serverId, sid)
        val remaining = queues.list(serverId, sid)
        scope.launch { store.saveQueue(serverId, sid, remaining) }
        if (_state.value.activeSessionId == sid) {
            setState { it.copy(queuedMessages = remaining, queuedError = null) }
        }
    }

    private suspend fun loadQueues(credential: PairedCredential) {
        for (sessionId in store.queuedSessionIds(credential.serverId)) {
            queues.load(credential.serverId, sessionId, store.loadQueue(credential.serverId, sessionId))
        }
        val active = _state.value.activeSessionId
        if (active != null) setState { it.copy(queuedMessages = queues.list(credential.serverId, active)) }
    }

    /**
     * Send the oldest queued message of whichever session has gone idle (#119).
     *
     * Peeks first so a crash, disconnect, or blocking pending operation never
     * loses the message. Permanent rejection pauses draining instead of looping.
     */
    private fun maybeDrainQueue() {
        if (draining) return
        val credential = currentCredential() ?: return
        val gen = adapterGeneration
        val current = _state.value
        if (current.connection != "connected") return
        val now = System.currentTimeMillis()
        val target = queues.pendingSessions().firstOrNull { (serverId, sessionId) ->
            serverId == credential.serverId &&
                sessionIsIdle(sessionId) &&
                drainPolicy.canDrain(serverId, sessionId, now)
        } ?: return
        val sessionId = target.second
        val text = queues.peekFirst(credential.serverId, sessionId) ?: return
        draining = true
        (adapterScope ?: scope).launch {
            var shouldContinue = false
            try {
                if (gen != adapterGeneration) return@launch
                val outcome = sendText(text, targetSessionId = sessionId, fromQueue = true)
                when (outcome) {
                    SendOutcome.ACCEPTED -> {
                        queues.removeFirstIf(credential.serverId, sessionId, text)
                        val remaining = queues.list(credential.serverId, sessionId)
                        store.saveQueue(credential.serverId, sessionId, remaining)
                        drainPolicy.recordSuccess(credential.serverId, sessionId)
                        if (_state.value.activeSessionId == sessionId) {
                            setState { it.copy(queuedMessages = remaining, queuedError = null) }
                        }
                        shouldContinue = true
                    }
                    SendOutcome.UNCERTAIN -> {
                        // Now tracked durably as pending(state="unknown") for reconciliation;
                        // remove from queue so it can never be blind-resent.
                        queues.removeFirstIf(credential.serverId, sessionId, text)
                        val remaining = queues.list(credential.serverId, sessionId)
                        store.saveQueue(credential.serverId, sessionId, remaining)
                        if (_state.value.activeSessionId == sessionId) {
                            setState { it.copy(queuedMessages = remaining) }
                        }
                    }
                    SendOutcome.REJECTED -> {
                        // Permanent adapter rejection: keep head in queue, pause auto-drain.
                        val err = _state.value.sessionsError ?: "Queued message was rejected by the server."
                        drainPolicy.recordPermanentRejection(credential.serverId, sessionId, err)
                        if (_state.value.activeSessionId == sessionId) {
                            setState { it.copy(queuedError = err) }
                        }
                    }
                    SendOutcome.DEFERRED -> {
                        // Blocking pending op or offline: back off boundedly without dropping.
                        val delayMs = drainPolicy.recordTransientFailure(
                            credential.serverId,
                            sessionId,
                            "Queued message is waiting for the connection or prior send to settle.",
                        )
                        if (delayMs != null) {
                            queueRetryJob?.cancel()
                            queueRetryJob = (adapterScope ?: scope).launch {
                                kotlinx.coroutines.delay(delayMs)
                                if (gen == adapterGeneration) maybeDrainQueue()
                            }
                        } else if (_state.value.activeSessionId == sessionId) {
                            setState { it.copy(queuedError = drainPolicy.pausedError(credential.serverId, sessionId)) }
                        }
                    }
                }
            } finally {
                draining = false
                if (shouldContinue && gen == adapterGeneration) maybeDrainQueue()
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

    private fun notify(
        kind: String,
        serverId: String,
        sessionId: String,
        eventKey: String,
        title: String,
        body: String,
    ) {
        val ctx = context ?: return
        val st = _state.value
        val allowed = when (kind) {
            LocalNotifications.CHANNEL_APPROVAL -> st.notifyWaiting
            LocalNotifications.CHANNEL_TURNS -> st.notifyDone
            else -> true
        }
        if (!allowed) return
        // Deduplicate replayed/duplicate events across reconnects (#122).
        synchronized(notifiedKeys) {
            if (!notifiedKeys.add(eventKey)) return
            while (notifiedKeys.size > 256) {
                val it = notifiedKeys.iterator()
                if (it.hasNext()) {
                    it.next()
                    it.remove()
                }
            }
        }
        // Only suppress when the user is actively viewing THIS exact thread in foreground.
        val isViewingThisThread = st.activeSessionId == sessionId
        val onlyWhenClosed = if (isViewingThisThread) st.notifyOnlyClosed else false
        LocalNotifications.postIfBackgrounded(
            context = ctx,
            channel = kind,
            sessionId = sessionId,
            title = title,
            body = body,
            onlyWhenClosed = onlyWhenClosed,
            serverId = serverId,
            notificationKey = eventKey,
        )
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
        val gen = adapterGeneration
        val adapter = client ?: run {
            setState { it.copy(modelsLoading = false, modelsError = "Adapter is offline. Reconnect to load models.") }
            return
        }
        val sessionId = _state.value.activeSessionId ?: _state.value.sessions.firstOrNull()?.sessionId
        if (sessionId == null) {
            setState { it.copy(modelsLoading = false, modelsError = "No thread available to query models yet.") }
            return
        }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(modelsLoading = false, modelsError = "Adapter is offline. Reconnect to load models.") }
            return
        }
        setState { it.copy(modelsLoading = true, modelsError = null) }
        try {
            val payload = adapter.request("models.list", JsonObject(mapOf("session_id" to JsonPrimitive(sessionId))), sessionId = sessionId, timeoutMs = 25000)
            if (gen != adapterGeneration) return
            val runtime = dev.ziran.android.protocol.parseRuntime(payload["runtime"] as? JsonObject)
            val models = payload["models"]?.let {
                (it as? kotlinx.serialization.json.JsonArray)?.mapNotNull { item -> (item as? JsonObject)?.let { m -> dev.ziran.android.protocol.parseRoute(m) } }
            } ?: emptyList()
            if (_state.value.activeSessionId == null || _state.value.activeSessionId == sessionId) {
                setState { it.copy(models = models, runtime = latestRuntime(it.runtime, runtime), modelsLoading = false, modelsError = null) }
            } else {
                setState { it.copy(modelsLoading = false) }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (gen != adapterGeneration) return
            if (_state.value.activeSessionId == null || _state.value.activeSessionId == sessionId) {
                setState {
                    it.copy(
                        modelsLoading = false,
                        modelsError = error.message?.takeIf { m -> m.isNotBlank() } ?: "Could not load models from server.",
                    )
                }
            }
        }
    }

    suspend fun selectModel(model: String, provider: String, apiMethod: String): Boolean {
        val gen = adapterGeneration
        val adapter = client ?: run {
            setState { it.copy(modelActionError = "Adapter is offline. Model was not changed.") }
            return false
        }
        val sessionId = _state.value.activeSessionId ?: run {
            setState { it.copy(modelActionError = "Open a thread first to change its model.") }
            return false
        }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(modelActionError = "Adapter is offline. Model was not changed.") }
            return false
        }
        if (_state.value.modelActionPending) return false
        setState { it.copy(modelActionPending = true, modelActionError = null) }
        return try {
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
            if (gen != adapterGeneration) return false
            val runtime = dev.ziran.android.protocol.parseRuntime(payload["runtime"] as? JsonObject)
            if (_state.value.activeSessionId != sessionId) {
                setState { it.copy(modelActionPending = false) }
                return true
            }
            setState { it.copy(runtime = latestRuntime(it.runtime, runtime), modelActionPending = false, modelActionError = null) }
            true
        } catch (error: CancellationException) {
            setState { it.copy(modelActionPending = false) }
            throw error
        } catch (error: Exception) {
            if (gen == adapterGeneration) {
                setState {
                    it.copy(
                        modelActionPending = false,
                        modelActionError = "Could not switch model: ${error.message ?: "request failed"}",
                    )
                }
            }
            false
        }
    }

    suspend fun setReasoning(effort: String): Boolean {
        val gen = adapterGeneration
        val adapter = client ?: run {
            setState { it.copy(modelActionError = "Adapter is offline. Effort was not changed.") }
            return false
        }
        val sessionId = _state.value.activeSessionId ?: run {
            setState { it.copy(modelActionError = "Open a thread first to change its effort.") }
            return false
        }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(modelActionError = "Adapter is offline. Effort was not changed.") }
            return false
        }
        if (_state.value.modelActionPending) return false
        setState { it.copy(modelActionPending = true, modelActionError = null) }
        return try {
            val runtimePayload = adapter.request(
                "reasoning.set",
                JsonObject(mapOf("session_id" to JsonPrimitive(sessionId), "effort" to JsonPrimitive(effort))),
                sessionId = sessionId,
                timeoutMs = 25000,
            )
            if (gen != adapterGeneration) return false
            val runtime = dev.ziran.android.protocol.parseRuntime(runtimePayload)
            if (_state.value.activeSessionId != sessionId) {
                setState { it.copy(modelActionPending = false) }
                return true
            }
            setState { it.copy(runtime = latestRuntime(it.runtime, runtime), modelActionPending = false, modelActionError = null) }
            true
        } catch (error: CancellationException) {
            setState { it.copy(modelActionPending = false) }
            throw error
        } catch (error: Exception) {
            if (gen == adapterGeneration) {
                setState {
                    it.copy(
                        modelActionPending = false,
                        modelActionError = "Could not update effort: ${error.message ?: "request failed"}",
                    )
                }
            }
            false
        }
    }

    // -- session management ---------------------------------------------------

    private suspend fun sessionAction(type: String, sessionId: String, label: String): Boolean {
        val gen = adapterGeneration
        val adapter = client ?: run {
            setState { it.copy(sessionsError = "Adapter is offline. Could not $label thread.") }
            return false
        }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(sessionsError = "Adapter is offline. Could not $label thread.") }
            return false
        }
        return try {
            val payload = adapter.request(type, JsonObject(mapOf("session_id" to JsonPrimitive(sessionId))), sessionId = sessionId, timeoutMs = 20000)
            if (gen != adapterGeneration) return false
            val session = (payload["session"] as? JsonObject)?.let { dev.ziran.android.protocol.parseSessionSummary(it) }
            if (session != null) {
                setState {
                    it.copy(
                        sessions = it.sessions.map { existing -> if (existing.sessionId == session.sessionId) session else existing },
                        snapshot = if (it.snapshot?.session?.sessionId == session.sessionId) it.snapshot.copy(session = session) else it.snapshot,
                        sessionsError = null,
                    )
                }
            }
            true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (gen == adapterGeneration) {
                setState { it.copy(sessionsError = "Could not $label thread: ${error.message ?: "request failed"}") }
            }
            false
        }
    }

    suspend fun archiveSession(sessionId: String): Boolean = sessionAction("sessions.archive", sessionId, "archive")
    suspend fun restoreSession(sessionId: String): Boolean = sessionAction("sessions.restore", sessionId, "restore")

    suspend fun toggleFavorite(sessionId: String): Boolean {
        val gen = adapterGeneration
        val current = _state.value.sessions.firstOrNull { it.sessionId == sessionId }
        val favorite = !(current?.favorite ?: false)
        val adapter = client ?: run {
            setState { it.copy(sessionsError = "Adapter is offline. Could not update favorite.") }
            return false
        }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(sessionsError = "Adapter is offline. Could not update favorite.") }
            return false
        }
        return try {
            val payload = adapter.request(
                "sessions.favorite",
                dev.ziran.android.protocol.RequestPayloads.favorite(sessionId, favorite),
                sessionId = sessionId,
                timeoutMs = 20000,
            )
            if (gen != adapterGeneration) return false
            val session = (payload["session"] as? JsonObject)?.let { dev.ziran.android.protocol.parseSessionSummary(it) }
            if (session != null) {
                setState {
                    it.copy(
                        sessions = it.sessions.map { e -> if (e.sessionId == session.sessionId) session else e },
                        snapshot = if (it.snapshot?.session?.sessionId == session.sessionId) it.snapshot.copy(session = session) else it.snapshot,
                        sessionsError = null,
                    )
                }
            }
            true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (gen == adapterGeneration) {
                setState { it.copy(sessionsError = "Could not update favorite: ${error.message ?: "request failed"}") }
            }
            false
        }
    }

    suspend fun renameSession(sessionId: String, title: String): Boolean {
        val gen = adapterGeneration
        val adapter = client ?: run {
            setState { it.copy(sessionsError = "Adapter is offline. Could not rename thread.") }
            return false
        }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(sessionsError = "Adapter is offline. Could not rename thread.") }
            return false
        }
        return try {
            val payload = adapter.request(
                "sessions.rename",
                JsonObject(mapOf("session_id" to JsonPrimitive(sessionId), "title" to JsonPrimitive(title))),
                sessionId = sessionId,
                timeoutMs = 20000,
            )
            if (gen != adapterGeneration) return false
            val session = (payload["session"] as? JsonObject)?.let { dev.ziran.android.protocol.parseSessionSummary(it) }
            if (session != null) {
                setState {
                    it.copy(
                        // Guarded by session identity so renaming thread B never overwrites active thread A (#120).
                        snapshot = if (it.snapshot?.session?.sessionId == session.sessionId) it.snapshot.copy(session = session) else it.snapshot,
                        sessions = it.sessions.map { e -> if (e.sessionId == session.sessionId) session else e },
                        sessionsError = null,
                    )
                }
            }
            true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (gen == adapterGeneration) {
                setState { it.copy(sessionsError = "Could not rename thread: ${error.message ?: "request failed"}") }
            }
            false
        }
    }

    fun clearCreateSessionError() {
        setState { it.copy(createSessionError = null) }
    }

    suspend fun createSession(projectId: String?, title: String, workingDir: String? = null): SessionSummary? {
        if (_state.value.creatingSession) return null
        val gen = adapterGeneration
        val adapter = client ?: run {
            setState { it.copy(createSessionError = "Adapter is offline. Reconnect to start a new thread.") }
            return null
        }
        if (adapter.status.value != dev.ziran.android.connection.ConnectionStatus.Connected) {
            setState { it.copy(createSessionError = "Adapter is offline. Reconnect to start a new thread.") }
            return null
        }
        // Reuse stable clientRequestId when retrying the same title to prevent duplicate sessions (#121).
        val normalizedTitle = title.ifBlank { "New thread" }
        val clientRequestId = if (pendingCreateTitle == normalizedTitle && pendingCreateRequestId != null) {
            pendingCreateRequestId!!
        } else {
            UUID.randomUUID().toString().also {
                pendingCreateRequestId = it
                pendingCreateTitle = normalizedTitle
            }
        }
        setState { it.copy(creatingSession = true, createSessionError = null) }
        return try {
            val payload = adapter.request(
                "sessions.create",
                dev.ziran.android.protocol.RequestPayloads.create(
                    clientRequestId = clientRequestId,
                    projectId = projectId,
                    title = normalizedTitle,
                    workingDir = workingDir,
                ),
                timeoutMs = 40000,
            )
            if (gen != adapterGeneration) {
                setState { it.copy(creatingSession = false) }
                return null
            }
            val created = (payload["session"] as? JsonObject)?.let { dev.ziran.android.protocol.parseSessionSummary(it) }
            if (created != null) {
                pendingCreateRequestId = null
                pendingCreateTitle = null
                setState {
                    it.copy(
                        sessions = listOf(created) + it.sessions.filter { s -> s.sessionId != created.sessionId },
                        creatingSession = false,
                        createSessionError = null,
                    )
                }
                openSession(created.sessionId)
                created
            } else {
                setState { it.copy(creatingSession = false, createSessionError = "Server did not return the new thread.") }
                null
            }
        } catch (error: CancellationException) {
            setState { it.copy(creatingSession = false) }
            throw error
        } catch (error: Exception) {
            if (gen == adapterGeneration) {
                setState {
                    it.copy(
                        creatingSession = false,
                        createSessionError = "Could not create thread: ${error.message ?: "request failed"}",
                    )
                }
            }
            null
        }
    }

    // -- in-app auto-updater (GitHub Releases JSON API) -----------------------

    private var updateJob: Job? = null

    fun checkForUpdates(manual: Boolean = true) {
        val current = _state.value.update
        if (current.status == "checking" || current.status == "downloading") return
        val now = System.currentTimeMillis()
        if (!manual && current.lastCheckedAtMs != null && now - current.lastCheckedAtMs < 6 * 3600_000L) return
        updateJob?.cancel()
        setState { it.copy(update = it.update.copy(status = "checking", error = null)) }
        updateJob = scope.launch {
            val res = dev.ziran.android.update.UpdateManager.checkLatestRelease(
                http = http,
                currentVersion = dev.ziran.android.BuildConfig.VERSION_NAME,
            )
            val checkedAt = System.currentTimeMillis()
            when (res) {
                is dev.ziran.android.update.UpdateManager.CheckResult.UpdateAvailable -> setState {
                    it.copy(
                        update = it.update.copy(
                            status = "available",
                            release = res.release,
                            error = null,
                            lastCheckedAtMs = checkedAt,
                        ),
                    )
                }
                is dev.ziran.android.update.UpdateManager.CheckResult.UpToDate -> setState {
                    it.copy(
                        update = it.update.copy(
                            status = "up_to_date",
                            release = null,
                            error = null,
                            lastCheckedAtMs = checkedAt,
                        ),
                    )
                }
                is dev.ziran.android.update.UpdateManager.CheckResult.Failed -> setState {
                    it.copy(
                        update = it.update.copy(
                            status = if (manual) "error" else "idle",
                            error = if (manual) res.message else null,
                            lastCheckedAtMs = checkedAt,
                        ),
                    )
                }
            }
        }
    }

    fun downloadAndInstallUpdate() {
        val ctx = context ?: return
        val st = _state.value.update
        if (st.status == "downloading") return
        val existingPath = st.downloadedApkPath
        if (st.status == "ready_to_install" && !existingPath.isNullOrBlank()) {
            val f = java.io.File(existingPath)
            if (f.exists()) {
                val launched = dev.ziran.android.update.UpdateManager.launchApkInstaller(ctx, f)
                if (launched == dev.ziran.android.update.UpdateManager.InstallLaunchResult.NEEDS_UNKNOWN_SOURCES_PERMISSION) {
                    setState {
                        it.copy(
                            update = it.update.copy(
                                error = "Allow installing unknown apps for Ziran, then tap Install again.",
                            ),
                        )
                    }
                }
                return
            }
        }
        val release = st.release ?: return
        updateJob?.cancel()
        setState {
            it.copy(
                update = it.update.copy(
                    status = "downloading",
                    progressPercent = 0,
                    error = null,
                ),
            )
        }
        updateJob = scope.launch {
            try {
                val apkFile = dev.ziran.android.update.UpdateManager.downloadAndVerifyApk(
                    context = ctx,
                    http = http,
                    release = release,
                    onProgress = { pct ->
                        setState { it.copy(update = it.update.copy(progressPercent = pct)) }
                    },
                )
                setState {
                    it.copy(
                        update = it.update.copy(
                            status = "ready_to_install",
                            progressPercent = 100,
                            downloadedApkPath = apkFile.absolutePath,
                            error = null,
                        ),
                    )
                }
                val launched = dev.ziran.android.update.UpdateManager.launchApkInstaller(ctx, apkFile)
                if (launched == dev.ziran.android.update.UpdateManager.InstallLaunchResult.NEEDS_UNKNOWN_SOURCES_PERMISSION) {
                    setState {
                        it.copy(
                            update = it.update.copy(
                                error = "Allow installing unknown apps for Ziran, then tap Install again.",
                            ),
                        )
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                setState {
                    it.copy(
                        update = it.update.copy(
                            status = "available",
                            error = error.message ?: "Update download failed.",
                        ),
                    )
                }
            }
        }
    }

    fun dismissUpdateBanner() {
        val tag = _state.value.update.release?.tagName ?: return
        setState { it.copy(update = it.update.copy(bannerDismissedTag = tag)) }
    }

    fun close() {
        adapterGeneration++
        adapterScope?.cancel()
        adapterScope = null
        snapshotTimer?.cancel()
        sessionsRefreshJob?.cancel()
        queueRetryJob?.cancel()
        client?.close()
    }

    private fun currentCredential(): PairedCredential? = credential

    private var credential: PairedCredential? = null
}
