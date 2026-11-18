package dev.ziran.android.protocol

import kotlinx.serialization.json.JsonObject

const val PROTOCOL_VERSION = 4
const val MIN_PROTOCOL_VERSION = 2
const val WS_SUBPROTOCOL = "jcode.mobile.v4"
const val JOURNAL_WS_SUBPROTOCOL = "jcode.mobile.v3"
const val LEGACY_WS_SUBPROTOCOL = "jcode.mobile.v2"
const val BYTE_PACKAGE_CHUNK = 64 * 1024
const val BYTE_PACKAGE_LIMIT = 64 * 1024 * 1024

enum class Kind { Request, Response, Event }

data class Envelope(
    val v: Int,
    val kind: Kind,
    val id: String,
    val replyTo: String? = null,
    val serverId: String? = null,
    val sessionId: String? = null,
    val operationId: String? = null,
    val epoch: String? = null,
    val seq: Long? = null,
    val type: String,
    val payload: JsonObject = JsonObject(emptyMap()),
)

data class ErrorPayload(val code: String, val message: String, val retryable: Boolean)

class AdapterRequestError(payload: ErrorPayload) :
    Exception(payload.message) {
    val code: String = payload.code
    val retryable: Boolean = payload.retryable
}

data class ServerInfo(
    val serverId: String,
    val name: String,
    val adapterVersion: String,
    val protocolVersion: Int,
    val minProtocolVersion: Int,
    val jcodeVersion: String,
    val jcodeProtocolVersion: Int,
    val jcodeCapabilities: List<String>,
    val healthy: Boolean,
    val capabilities: List<String>,
    val startedAtMs: Long,
    val commandCodeAvailable: Boolean? = null,
)

data class DeviceInfo(
    val deviceId: String,
    val name: String,
    val createdAtMs: Long,
    val lastSeenAtMs: Long? = null,
)

data class PairedCredential(
    val baseUrl: String,
    val token: String,
    val device: DeviceInfo,
    val serverId: String,
    val savedAt: Long,
)

enum class AgentKind(val displayName: String) {
    Crane("crane"),
    Fox("fox"),
    Heron("heron"),
    Owl("owl"),
    Moth("moth"),
    Unknown("agent");

    companion object {
        fun fromLabel(label: String?): AgentKind = when (label?.trim()?.lowercase()) {
            "crane" -> Crane
            "fox" -> Fox
            "heron" -> Heron
            "owl" -> Owl
            "moth" -> Moth
            else -> Unknown
        }
    }
}

data class SessionSummary(
    val sessionId: String,
    val title: String?,
    val titleSource: String,
    val status: String,
    val workingDir: String?,
    val projectId: String?,
    val updatedAtMs: Long?,
    val transcriptBytes: Long?,
    val saved: Boolean,
    val archived: Boolean,
    val parentSessionId: String?,
    val agentLabel: String?,
    val swarmStatus: String? = null,
    val favorite: Boolean? = null,
) {
    val agentKind: AgentKind get() = AgentKind.fromLabel(agentLabel)
    val displayTitle: String get() = title ?: sessionId
}

data class Project(
    val projectId: String,
    val label: String,
    val path: String,
    val pinned: Boolean,
    val createdAtMs: Long,
    val sessionCount: Int,
)

data class HistoryMessageView(
    val index: Int,
    val role: String,
    val content: String,
    val toolCallId: String?,
    val toolName: String?,
    val toolInput: JsonObject? = null,
    val responseStats: JsonObject? = null,
)

data class ModelRouteView(
    val model: String,
    val provider: String,
    val apiMethod: String,
    val available: Boolean,
    val detail: String,
    val isCommandCode: Boolean,
)

data class RuntimeIdentity(
    val provider: String?,
    val model: String?,
    val reasoningEffort: String?,
    val effortOptions: List<String>? = null,
    val authMethod: String?,
    val accountLabel: String?,
)

data class RuntimeView(
    val provider: String?,
    val model: String?,
    val reasoningEffort: String?,
    val effortOptions: List<String>? = null,
    val authMethod: String?,
    val accountLabel: String?,
    val providers: List<String>,
    val routes: List<ModelRouteView>,
    val observedAtMs: Long,
    val source: String,
)

data class SwarmAgentView(
    val sessionId: String,
    val parentSessionId: String?,
    val label: String?,
    val status: String,
    val model: String?,
    val provider: String?,
    val reasoningEffort: String?,
)

data class ContextView(
    val inputTokens: Long?,
    val outputTokens: Long?,
    val cacheReadInput: Long?,
    val cacheCreationInput: Long?,
    val effectiveBudget: Long?,
    val provider: String?,
    val model: String?,
    val observedAtMs: Long,
    val source: String,
)

data class ActiveTurnView(
    val turnId: String,
    val operationId: String,
    val status: String,
    val startedAtMs: Long,
)

data class DaemonStatusView(
    val status: String,
    val rawStatus: String,
    val observedAtMs: Long,
    val source: String,
)

data class SessionSnapshot(
    val session: SessionSummary,
    val messages: List<HistoryMessageView>,
    val runtime: RuntimeView?,
    val agents: List<SwarmAgentView>? = null,
    val context: ContextView? = null,
    val activeTurn: ActiveTurnView? = null,
    val daemonStatus: DaemonStatusView? = null,
    val epoch: String,
    val lastSeq: Long,
    val revision: Long,
    val authoritativeAtMs: Long,
    val stale: Boolean,
    val source: String,
)

data class OperationView(
    val operationId: String,
    val sessionId: String,
    val turnId: String?,
    val state: String,
    val errorCode: String?,
    val errorMessage: String?,
    val createdAtMs: Long,
    val updatedAtMs: Long,
)

sealed interface SessionEvent {
    data class TurnStarted(val turnId: String, val operationId: String) : SessionEvent
    data class TextDelta(val text: String, val messageId: String?) : SessionEvent
    data class TextDone(val messageId: String?) : SessionEvent
    data class TextReplace(val text: String, val messageId: String?) : SessionEvent
    data class ReasoningDelta(val text: String) : SessionEvent
    data class ReasoningDone(val durationSecs: Long?) : SessionEvent
    data class ToolStart(val callId: String, val name: String) : SessionEvent
    data class ToolInputDelta(val callId: String, val delta: String) : SessionEvent
    data class ToolExec(val callId: String, val name: String) : SessionEvent
    data class ToolDone(val callId: String, val name: String, val output: String, val error: String?) : SessionEvent
    data class PermissionRequest(val requestId: String, val toolName: String, val description: String) : SessionEvent
    data class TokenUsage(val input: Long, val output: Long, val cacheReadInput: Long?, val cacheCreationInput: Long?, val effectiveBudget: Long?) : SessionEvent
    data class SessionStatus(val status: String, val pendingSoftInterrupts: Long?) : SessionEvent
    data class ConnectionPhase(val phase: String) : SessionEvent
    data class SessionRecovery(val continuationMessage: String, val reconnectNotice: String?) : SessionEvent
    data class TitleChanged(val title: String?, val displayTitle: String) : SessionEvent
    data class PlanUpdated(val plan: JsonObject?) : SessionEvent
    data class ContextCapChanged(val maxContextTokens: Long?, val effectiveBudget: Long) : SessionEvent
    data class AdapterError(val code: String, val message: String, val retryable: Boolean) : SessionEvent
    data class TurnStopped(val turnId: String?, val reason: String, val message: String, val providerStopReason: String?) : SessionEvent
    data class TurnDone(val turnId: String?) : SessionEvent
    data class NeedsReconcile(val reason: String) : SessionEvent
    data class Unknown(val raw: JsonObject) : SessionEvent
}

data class SessionEventPayload(
    val event: SessionEvent,
    val eventKind: String,
    val turnId: String?,
    val operationId: String?,
    val observedAtMs: Long,
)

data class JournalEventView(
    val seq: Long,
    val turnId: String?,
    val operationId: String?,
    val event: SessionEvent,
    val eventKind: String,
    val observedAtMs: Long,
)

data class EventsSubscribePayload(
    val sessionId: String,
    val epoch: String,
    val events: List<JournalEventView>,
    val floorSeq: Long,
    val latestSeq: Long,
    val gap: Boolean,
    val hasMore: Boolean,
    val resyncRequired: Boolean,
    val snapshot: SessionSnapshot?,
)

data class OperationStatePayload(val operation: OperationView, val duplicate: Boolean)

data class CancelTurnResponse(
    val cancelled: Boolean,
    val turnId: String?,
    val alreadyStopped: Boolean? = null,
    val finalState: String? = null,
    val atomicTurnScope: Boolean,
    val note: String? = null,
)
