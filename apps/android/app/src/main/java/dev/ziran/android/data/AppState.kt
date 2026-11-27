package dev.ziran.android.data

import androidx.compose.runtime.Immutable
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

@Immutable
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

@Immutable
data class LiveBlock(val seq: Long, val id: String, val text: String, val done: Boolean)

@Immutable
data class PendingMessage(
    val text: String,
    val operationId: String,
    val state: String, // staged | reserved | dispatching | accepted | unknown | rejected
    val error: String?,
    val createdAt: Long,
)

@Immutable
data class SentTurnNote(val text: String, val tag: String)

@Immutable
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
    val pendingSoftInterrupts: Long = 0L,
    val sentDuringTurn: List<SentTurnNote> = emptyList(),
    val assistants: List<LiveBlock> = emptyList(),
    val reasoning: List<LiveBlock> = emptyList(),
    val tools: List<LiveTool> = emptyList(),
    val permission: PermissionRequest? = null,
    val recovery: Recovery? = null,
    val error: String? = null,
    val needsReconcile: Boolean = false,
)

@Immutable
data class PermissionRequest(val requestId: String, val toolName: String, val description: String)
@Immutable
data class Recovery(val continuation: String, val notice: String?)

@Immutable
data class UpdateReleaseInfo(
    val version: String,
    val tagName: String,
    val title: String,
    val notes: String,
    val apkUrl: String,
    val apkName: String,
    val apkSizeBytes: Long,
    val sha256Url: String? = null,
    val htmlUrl: String = "",
)

@Immutable
data class UpdateUiState(
    val status: String = "idle", // idle | checking | up_to_date | available | downloading | ready_to_install | error
    val release: UpdateReleaseInfo? = null,
    val progressPercent: Int = 0,
    val downloadedApkPath: String? = null,
    val error: String? = null,
    val lastCheckedAtMs: Long? = null,
    val bannerDismissedTag: String? = null,
)

@Immutable
data class AppState(
    val phase: String = "loading", // loading | unpaired | pairing | ready
    val pairingError: String? = null,
    val pairingStage: String = "idle",
    val pairingMessage: String = "",
    val connection: String = "offline", // connecting | connected | offline
    val reconnecting: Boolean = false,
    val connectionMessage: String? = null,
    val jcodeConnected: Boolean = false,
    val backendName: String? = null,
    val backendReady: Boolean? = null,
    val serverCapabilities: Set<String> = emptySet(),
    val savedOnPhone: Boolean = false,
    val hasAuthoritativeSessions: Boolean = false,
    val sessionsLoading: Boolean = false,
    val lastSyncedAtMs: Long? = null,
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
    val modelsLoading: Boolean = false,
    val modelsError: String? = null,
    val modelActionPending: Boolean = false,
    val modelActionError: String? = null,
    val creatingSession: Boolean = false,
    val createSessionError: String? = null,
    val agents: List<SwarmAgentView>? = null,
    val plan: dev.ziran.android.protocol.PlanView? = null,
    val context: ContextView? = null,
    val lastSeq: Long = 0,
    val epoch: String? = null,
    val reconciling: Boolean = false,
    val composerText: String = "",
    val themeMode: String = "system", // day | night | system
    val scene: String = "peaks",
    val pairServer: String = "http://10.0.2.2:7644",
    val pairCode: String = "",
    val pairPasteNonce: Int = 0,
    val healthProbe: dev.ziran.android.protocol.HealthProbeResult = dev.ziran.android.protocol.HealthProbeResult.Idle,
    val queuedMessages: List<String> = emptyList(),
    val queuedNotice: String? = null,
    val queuedError: String? = null,
    val serverName: String? = null,
    val adapterVersion: String? = null,
    val protocolVersion: Int? = null,
    val pairedServers: List<String> = emptyList(),
    /** Settings: steer | wait | ask */
    val steerDefault: String = "steer",
    /** Active composer mode while working: steer | stop | after */
    val activeSteerMode: String = "steer",
    /** Threads sort: recent | name | status */
    val threadsSort: String = "recent",
    /** Stored default model & effort for new threads. */
    val defaultModel: String? = null,
    val defaultProvider: String? = null,
    val defaultApiMethod: String? = null,
    val defaultEffort: String? = null,
    /** Notification toggles persisted in DataStore. */
    val notifyWaiting: Boolean = true,
    val notifyDone: Boolean = true,
    val notifyOnlyClosed: Boolean = true,
    /** True when the POST_NOTIFICATIONS reason should be on screen. */
    val notificationsPrompt: Boolean = false,
    /** In-app GitHub release auto-update state. */
    val update: UpdateUiState = UpdateUiState(),
)
