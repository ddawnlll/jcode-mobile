package dev.ziran.android.data

import dev.ziran.android.protocol.ContextView
import dev.ziran.android.protocol.HistoryMessageView
import dev.ziran.android.protocol.ModelRouteView
import dev.ziran.android.protocol.OperationView
import dev.ziran.android.protocol.Project
import dev.ziran.android.protocol.RuntimeView
import dev.ziran.android.protocol.SessionEventPayload
import dev.ziran.android.protocol.SessionSnapshot
import dev.ziran.android.protocol.SessionSummary
import dev.ziran.android.protocol.SwarmAgentView

/** App-level state. One store survives screen unmounts. */

data class LiveTool(
    val seq: Long,
    val callId: String,
    val name: String,
    val input: String,
    val output: String,
    val error: String?,
    val status: String, // started | running | done | failed | unknown
    val startedAtMs: Long = System.currentTimeMillis(),
)

data class LiveBlock(val seq: Long, val id: String, val text: String, val done: Boolean)

data class PendingMessage(
    val text: String,
    val operationId: String,
    val state: String, // staged | reserved | dispatching | accepted | unknown | rejected
    val error: String?,
    val createdAt: Long,
)

data class LiveState(
    val turnId: String? = null,
    val operationId: String? = null,
    val finishedTurnId: String? = null,
    val daemonRunning: Boolean = false,
    val daemonStatus: String? = null, // running | idle | unknown | null
    val status: String = "idle",
    val phase: String = "",
    val startedAtMs: Long? = null,
    val reasoningStartedAtMs: Long? = null,
    val reasoningDurationSecs: Long? = null,
    val assistants: List<LiveBlock> = emptyList(),
    val reasoning: List<LiveBlock> = emptyList(),
    val tools: List<LiveTool> = emptyList(),
    val permission: PermissionRequest? = null,
    val recovery: Recovery? = null,
    val error: String? = null,
    val needsReconcile: Boolean = false,
)

data class PermissionRequest(val requestId: String, val toolName: String, val description: String)
data class Recovery(val continuation: String, val notice: String?)

data class AppState(
    val phase: String = "loading", // loading | unpaired | pairing | ready
    val pairingError: String? = null,
    val pairingStage: String = "idle",
    val pairingMessage: String = "",
    val connection: String = "offline", // connecting | connected | offline
    val connectionMessage: String? = null,
    val jcodeConnected: Boolean = false,
    val savedOnPhone: Boolean = false,
    val sessions: List<SessionSummary> = emptyList(),
    val sessionsError: String? = null,
    val sessionRevision: Long = 0,
    val activeSessionId: String? = null,
    val activeMissing: Boolean = false,
    val snapshot: SessionSnapshot? = null,
    val live: LiveState = LiveState(),
    val pending: PendingMessage? = null,
    val operations: Map<String, OperationView> = emptyMap(),
    val models: List<ModelRouteView> = emptyList(),
    val runtime: RuntimeView? = null,
    val modelsError: String? = null,
    val agents: List<SwarmAgentView>? = null,
    val context: ContextView? = null,
    val lastSeq: Long = 0,
    val epoch: String? = null,
    val reconciling: Boolean = false,
    val composerText: String = "",
    val themeMode: String = "system", // day | night | system
    val scene: String = "peaks",
    val pairServer: String = "http://10.0.2.2:7644",
    val pairCode: String = "",
    val queuedMessages: List<String> = emptyList(),
    val queuedNotice: String? = null,
    val serverName: String? = null,
    val protocolVersion: Int? = null,
    /** True when the POST_NOTIFICATIONS reason should be on screen. */
    val notificationsPrompt: Boolean = false,
)
