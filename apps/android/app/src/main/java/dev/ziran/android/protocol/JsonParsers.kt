package dev.ziran.android.protocol

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/**
 * JSON parsing for the adapter wire. Lax by design: unknown fields are
 * ignored, missing optionals are null. No invented values.
 */

internal fun JsonObject.str(key: String): String? {
    val p = this.get(key) as? JsonPrimitive ?: return null
    if (p.isString) return p.content
    if (p.toString() == "null") return null
    return p.toString().trim('"')
}

fun JsonObject.strOr(key: String, default: String): String = str(key) ?: default
fun JsonObject.boolOr(key: String, default: Boolean): Boolean {
    val p = this.get(key) as? JsonPrimitive ?: return default
    if (p.isString) return default
    val t = p.toString()
    return when (t) { "true" -> true; "false" -> false; else -> default }
}
fun JsonObject.longOr(key: String): Long? {
    val p = this.get(key) as? JsonPrimitive ?: return null
    if (p.isString) return runCatching { p.content.toLong() }.getOrNull()
    return runCatching { p.toString().toLong() }.getOrNull()
}
fun JsonObject.intOr(key: String): Int? {
    val p = this.get(key) as? JsonPrimitive ?: return null
    if (p.isString) return runCatching { p.content.toInt() }.getOrNull()
    return runCatching { p.toString().toInt() }.getOrNull()
}
fun JsonObject.objOr(key: String): JsonObject? = this[key]?.let { runCatching { it.jsonObject }.getOrNull() }
fun JsonObject.arrOr(key: String): JsonArray? = this[key]?.let { runCatching { it.jsonArray }.getOrNull() }
fun JsonObject.objList(key: String): List<JsonObject> {
    val arr = arrOr(key) ?: return emptyList()
    return arr.mapNotNull { runCatching { it.jsonObject }.getOrNull() }
}
fun JsonObject.strList(key: String): List<String> {
    val arr = arrOr(key) ?: return emptyList()
    return arr.mapNotNull { (it as? JsonPrimitive)?.let { p -> if (p.isString) p.content else p.toString().trim('"') } }
}

/** Parse an envelope from its text form. Returns null on any shape error. */
fun parseEnvelope(text: String, json: kotlinx.serialization.json.Json): Envelope? {
    val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
    val v = obj.intOr("v") ?: 0
    val kind = when (obj.str("kind")) {
        "request" -> Kind.Request
        "response" -> Kind.Response
        else -> Kind.Event
    }
    return Envelope(
        v = v,
        kind = kind,
        id = obj.strOr("id", ""),
        replyTo = obj.str("reply_to"),
        serverId = obj.str("server_id"),
        sessionId = obj.str("session_id"),
        operationId = obj.str("operation_id"),
        epoch = obj.str("epoch"),
        seq = obj.longOr("seq"),
        type = obj.strOr("type", ""),
        payload = obj.objOr("payload") ?: JsonObject(emptyMap()),
    )
}

fun parseServerInfo(o: JsonObject): ServerInfo = ServerInfo(
    serverId = o.strOr("server_id", ""),
    name = o.strOr("name", ""),
    adapterVersion = o.strOr("adapter_version", ""),
    protocolVersion = o.intOr("protocol_version") ?: 0,
    minProtocolVersion = o.intOr("min_protocol_version") ?: 0,
    jcodeVersion = o.strOr("jcode_version", ""),
    jcodeProtocolVersion = o.intOr("jcode_protocol_version") ?: 0,
    jcodeCapabilities = o.strList("jcode_capabilities"),
    healthy = o.boolOr("healthy", false),
    capabilities = o.strList("capabilities"),
    startedAtMs = o.longOr("started_at_ms") ?: 0,
    commandCodeAvailable = (o.get("command_code_available") as? JsonPrimitive)?.let { if (it.isString) null else it.toString() == "true" },
)

fun parseDeviceInfo(o: JsonObject): DeviceInfo = DeviceInfo(
    deviceId = o.strOr("device_id", ""),
    name = o.strOr("name", ""),
    createdAtMs = o.longOr("created_at_ms") ?: 0,
    lastSeenAtMs = o.longOr("last_seen_at_ms"),
)

fun parseSessionSummary(o: JsonObject): SessionSummary = SessionSummary(
    sessionId = o.strOr("session_id", ""),
    title = o.str("title"),
    titleSource = o.strOr("title_source", ""),
    status = o.strOr("status", "unknown"),
    workingDir = o.str("working_dir"),
    projectId = o.str("project_id"),
    updatedAtMs = o.longOr("updated_at_ms"),
    transcriptBytes = o.longOr("transcript_bytes"),
    saved = o.boolOr("saved", false),
    archived = o.boolOr("archived", false),
    parentSessionId = o.str("parent_session_id"),
    agentLabel = o.str("agent_label"),
    swarmStatus = o.str("swarm_status"),
    favorite = (o.get("favorite") as? JsonPrimitive)?.let { if (it.isString) null else it.toString() == "true" },
)

fun parseProject(o: JsonObject): Project = Project(
    projectId = o.strOr("project_id", ""),
    label = o.strOr("label", ""),
    path = o.strOr("path", ""),
    pinned = o.boolOr("pinned", false),
    createdAtMs = o.longOr("created_at_ms") ?: 0,
    sessionCount = o.intOr("session_count") ?: 0,
)

fun parseHistoryMessage(o: JsonObject): HistoryMessageView = HistoryMessageView(
    index = o.intOr("index") ?: 0,
    role = o.strOr("role", "unknown"),
    content = o.strOr("content", ""),
    toolCallId = o.str("tool_call_id"),
    toolName = o.str("tool_name"),
    toolInput = o.objOr("tool_input"),
    responseStats = o.objOr("response_stats"),
)

fun parseRoute(o: JsonObject): ModelRouteView = ModelRouteView(
    model = o.strOr("model", ""),
    provider = o.strOr("provider", ""),
    apiMethod = o.strOr("api_method", ""),
    available = o.boolOr("available", false),
    detail = o.strOr("detail", ""),
    isCommandCode = o.boolOr("is_command_code", false),
)

fun parseRuntime(o: JsonObject?): RuntimeView? {
    if (o == null) return null
    return RuntimeView(
        provider = o.str("provider"),
        model = o.str("model"),
        reasoningEffort = o.str("reasoning_effort"),
        effortOptions = o.strList("effort_options").takeIf { it.isNotEmpty() },
        authMethod = o.str("auth_method"),
        accountLabel = o.str("account_label"),
        providers = o.strList("providers"),
        routes = o.objList("routes").map(::parseRoute),
        observedAtMs = o.longOr("observed_at_ms") ?: 0,
        source = o.strOr("source", ""),
    )
}

fun parseAgent(o: JsonObject): SwarmAgentView = SwarmAgentView(
    sessionId = o.strOr("session_id", ""),
    parentSessionId = o.str("parent_session_id"),
    label = o.str("label"),
    status = o.strOr("status", "unknown"),
    model = o.str("model"),
    provider = o.str("provider"),
    reasoningEffort = o.str("reasoning_effort"),
)

fun parseContext(o: JsonObject?): ContextView? {
    if (o == null) return null
    return ContextView(
        inputTokens = o.longOr("input_tokens"),
        outputTokens = o.longOr("output_tokens"),
        cacheReadInput = o.longOr("cache_read_input"),
        cacheCreationInput = o.longOr("cache_creation_input"),
        effectiveBudget = o.longOr("effective_budget"),
        provider = o.str("provider"),
        model = o.str("model"),
        observedAtMs = o.longOr("observed_at_ms") ?: 0,
        source = o.strOr("source", ""),
    )
}

fun parseSnapshot(o: JsonObject): SessionSnapshot? {
    val session = o.objOr("session")?.let(::parseSessionSummary) ?: return null
    val active = o.objOr("active_turn")?.let {
        ActiveTurnView(
            turnId = it.strOr("turn_id", ""),
            operationId = it.strOr("operation_id", ""),
            status = it.strOr("status", "unknown"),
            startedAtMs = it.longOr("started_at_ms") ?: 0,
        )
    }
    val daemon = o.objOr("daemon_status")?.let {
        DaemonStatusView(
            status = it.strOr("status", "unknown"),
            rawStatus = it.strOr("raw_status", ""),
            observedAtMs = it.longOr("observed_at_ms") ?: 0,
            source = it.strOr("source", ""),
        )
    }
    return SessionSnapshot(
        session = session,
        messages = o.objList("messages").map(::parseHistoryMessage),
        runtime = parseRuntime(o.objOr("runtime")),
        agents = o.arrOr("agents")?.mapNotNull { runCatching { it.jsonObject }.getOrNull() }?.map(::parseAgent),
        context = parseContext(o.objOr("context")),
        activeTurn = active,
        daemonStatus = daemon,
        epoch = o.strOr("epoch", ""),
        lastSeq = o.longOr("last_seq") ?: 0,
        revision = o.longOr("revision") ?: 0,
        authoritativeAtMs = o.longOr("authoritative_at_ms") ?: 0,
        stale = o.boolOr("stale", false),
        source = o.strOr("source", ""),
    )
}

fun parseOperation(o: JsonObject): OperationView = OperationView(
    operationId = o.strOr("operation_id", ""),
    sessionId = o.strOr("session_id", ""),
    turnId = o.str("turn_id"),
    state = o.strOr("state", "unknown"),
    errorCode = o.str("error_code"),
    errorMessage = o.str("error_message"),
    createdAtMs = o.longOr("created_at_ms") ?: 0,
    updatedAtMs = o.longOr("updated_at_ms") ?: 0,
)

fun parseSessionEvent(o: JsonObject): SessionEventPayload? {
    val event = o.objOr("event") ?: return null
    val kind = event.strOr("kind", "unknown")
    val parsed: SessionEvent = when (kind) {
        "turn_started" -> SessionEvent.TurnStarted(event.strOr("turn_id", ""), event.strOr("operation_id", ""))
        "text_delta" -> SessionEvent.TextDelta(event.strOr("text", ""), event.str("message_id"))
        "text_done" -> SessionEvent.TextDone(event.str("message_id"))
        "text_replace" -> SessionEvent.TextReplace(event.strOr("text", ""), event.str("message_id"))
        "reasoning_delta" -> SessionEvent.ReasoningDelta(event.strOr("text", ""))
        "reasoning_done" -> SessionEvent.ReasoningDone(event.longOr("duration_secs"))
        "tool_start" -> SessionEvent.ToolStart(event.strOr("call_id", ""), event.strOr("name", ""))
        "tool_input_delta" -> SessionEvent.ToolInputDelta(event.strOr("call_id", ""), event.strOr("delta", ""))
        "tool_exec" -> SessionEvent.ToolExec(event.strOr("call_id", ""), event.strOr("name", ""))
        "tool_done" -> SessionEvent.ToolDone(
            event.strOr("call_id", ""), event.strOr("name", ""),
            event.strOr("output", ""), event.str("error"),
        )
        "permission_request" -> SessionEvent.PermissionRequest(
            event.strOr("request_id", ""), event.strOr("tool_name", ""), event.strOr("description", ""),
        )
        "token_usage" -> SessionEvent.TokenUsage(
            event.longOr("input") ?: 0, event.longOr("output") ?: 0,
            event.longOr("cache_read_input"), event.longOr("cache_creation_input"),
            event.longOr("effective_budget"),
        )
        "session_status" -> SessionEvent.SessionStatus(event.strOr("status", "unknown"), event.longOr("pending_soft_interrupts"))
        "connection_phase" -> SessionEvent.ConnectionPhase(event.strOr("phase", ""))
        "session_recovery" -> SessionEvent.SessionRecovery(event.strOr("continuation_message", ""), event.str("reconnect_notice"))
        "title_changed" -> SessionEvent.TitleChanged(event.str("title"), event.strOr("display_title", ""))
        "plan_updated" -> SessionEvent.PlanUpdated(event.objOr("plan"))
        "context_cap_changed" -> SessionEvent.ContextCapChanged(event.longOr("max_context_tokens"), event.longOr("effective_budget") ?: 0)
        "adapter_error" -> SessionEvent.AdapterError(event.strOr("code", ""), event.strOr("message", ""), event.boolOr("retryable", false))
        "turn_stopped" -> SessionEvent.TurnStopped(
            event.str("turn_id"), event.strOr("reason", ""), event.strOr("message", ""),
            event.str("provider_stop_reason"),
        )
        "turn_done" -> SessionEvent.TurnDone(event.str("turn_id"))
        "needs_reconcile" -> SessionEvent.NeedsReconcile(event.strOr("reason", ""))
        else -> SessionEvent.Unknown(event)
    }
    return SessionEventPayload(
        event = parsed,
        eventKind = kind,
        turnId = o.str("turn_id"),
        operationId = o.str("operation_id"),
        observedAtMs = o.longOr("observed_at_ms") ?: 0,
    )
}

fun parseEventsSubscribe(o: JsonObject): EventsSubscribePayload? {
    val events = o.objList("events").mapNotNull { item ->
        val ev = parseSessionEvent(item) ?: return@mapNotNull null
        JournalEventView(
            seq = item.longOr("seq") ?: 0,
            turnId = item.str("turn_id"),
            operationId = item.str("operation_id"),
            event = ev.event,
            eventKind = ev.eventKind,
            observedAtMs = item.longOr("observed_at_ms") ?: 0,
        )
    }
    return EventsSubscribePayload(
        sessionId = o.strOr("session_id", ""),
        epoch = o.strOr("epoch", ""),
        events = events,
        floorSeq = o.longOr("floor_seq") ?: 0,
        latestSeq = o.longOr("latest_seq") ?: 0,
        gap = o.boolOr("gap", false),
        hasMore = o.boolOr("has_more", false),
        resyncRequired = o.boolOr("resync_required", false),
        snapshot = o.objOr("snapshot")?.let(::parseSnapshot),
    )
}

fun parseError(o: JsonObject): ErrorPayload = ErrorPayload(
    code = o.strOr("code", "error"),
    message = o.strOr("message", "Request failed."),
    retryable = o.boolOr("retryable", false),
)
