package dev.ziran.android.data

import dev.ziran.android.protocol.ContextView
import dev.ziran.android.protocol.HistoryMessageView
import dev.ziran.android.protocol.RuntimeView
import dev.ziran.android.protocol.SessionEvent
import dev.ziran.android.protocol.SessionEventPayload
import dev.ziran.android.protocol.SessionSnapshot

/**
 * Live-turn reducer. Ports applySessionEvent, appendText, replaceText,
 * finishBlock, upsertTool, finishTurn and settleIdle from controller.ts, plus
 * reconcileLiveBlocks and applySnapshot reconciliation.
 *
 * Fencing: events for another session, another epoch, duplicate or older seq,
 * and text/tool frames for a turn other than the live turn are ignored.
 * A gap or needs_reconcile requests a snapshot, never invented events.
 */
class LiveReducer {
    /** How the caller should react after a reduction step. */
    sealed interface Effect {
        object None : Effect
        object NeedSnapshot : Effect
        data class Notice(val message: String) : Effect
    }

    data class Reduction(val state: AppState, val effect: Effect)

    fun reduceEvent(state: AppState, sessionId: String?, epoch: String?, seq: Long?, payload: SessionEventPayload): Reduction {
        if (sessionId == null) return Reduction(state, Effect.None)
        if (payload.event == null) return Reduction(state, Effect.None)
        if (sessionId != state.activeSessionId) return Reduction(state, Effect.None)
        if (state.snapshot == null) return Reduction(state, Effect.None) // caller schedules snapshot
        if (state.epoch != null && epoch != null && epoch != state.epoch) {
            val next = state.copy(live = state.live.copy(needsReconcile = true))
            return Reduction(next, Effect.NeedSnapshot)
        }
        val s = seq ?: 0L
        if (s > 0) {
            if (s <= state.lastSeq) return Reduction(state, Effect.None)
            if (state.lastSeq > 0 && s > state.lastSeq + 1) {
                val next = state.copy(live = state.live.copy(needsReconcile = true, status = "reconciling"))
                return Reduction(next, Effect.NeedSnapshot)
            }
        }
        var next = if (s > 0) state.copy(lastSeq = s, reconciling = false) else state
        val eventTurn = payload.turnId ?: (payload.event as? SessionEvent.TurnStarted)?.turnId
        val fenced = setOf(
            "text_delta", "text_done", "text_replace", "reasoning_delta", "reasoning_done",
            "tool_start", "tool_input_delta", "tool_exec", "tool_done",
            "session_status", "turn_stopped", "turn_done",
        )
        if (eventTurn != null && payload.eventKind in fenced &&
            ((next.live.turnId != null && eventTurn != next.live.turnId) || eventTurn == next.live.finishedTurnId)
        ) {
            return Reduction(next, Effect.None)
        }
        next = when (val event = payload.event) {
            is SessionEvent.TurnStarted -> next.copy(
                live = LiveState(
                    turnId = event.turnId,
                    operationId = event.operationId,
                    status = "dispatching",
                    startedAtMs = payload.observedAtMs,
                    daemonRunning = true,
                    daemonStatus = "running",
                ),
            )
            is SessionEvent.TextDelta -> appendText(next, event.text, event.messageId)
            is SessionEvent.TextDone -> finishBlock(next, event.messageId)
            is SessionEvent.TextReplace -> replaceText(next, event.text, event.messageId)
            is SessionEvent.ReasoningDelta -> {
                val reasoning = next.live.reasoning.toMutableList()
                val last = reasoning.lastOrNull()
                if (last == null || last.done) {
                    reasoning.add(LiveBlock(s, "reasoning-$s", event.text, false))
                } else {
                    reasoning[reasoning.lastIndex] = last.copy(text = last.text + event.text)
                }
                val startMs = next.live.reasoningStartedAtMs ?: payload.observedAtMs.takeIf { it > 0 } ?: System.currentTimeMillis()
                next.copy(live = next.live.copy(reasoning = reasoning, reasoningStartedAtMs = startMs, status = "thinking"))
            }
            is SessionEvent.ReasoningDone -> {
                val secs = event.durationSecs ?: next.live.reasoningStartedAtMs?.let {
                    ((System.currentTimeMillis() - it) / 1000L).coerceAtLeast(1L)
                }
                next.copy(
                    live = next.live.copy(
                        reasoning = next.live.reasoning.map { if (it.done) it else it.copy(done = true) },
                        reasoningDurationSecs = secs ?: next.live.reasoningDurationSecs,
                        status = "working",
                    ),
                )
            }
            is SessionEvent.ToolStart -> upsertTool(next, event.callId, event.name, "started")
            is SessionEvent.ToolInputDelta -> {
                val tool = next.live.tools.firstOrNull { it.callId == event.callId }
                upsertTool(next, event.callId, tool?.name ?: "tool", "running", tool?.input ?: "", event.delta)
            }
            is SessionEvent.ToolExec -> upsertTool(next, event.callId, event.name, "running")
            is SessionEvent.ToolDone -> upsertTool(
                next, event.callId, event.name, if (event.error != null) "failed" else "done",
                "", "", event.output, event.error,
            )
            is SessionEvent.PermissionRequest -> next.copy(
                live = next.live.copy(
                    permission = PermissionRequest(event.requestId, event.toolName, event.description),
                    status = "waiting for permission",
                ),
            )
            is SessionEvent.TokenUsage -> next.copy(
                context = ContextView(
                    event.input, event.output, event.cacheReadInput, event.cacheCreationInput,
                    event.effectiveBudget, next.runtime?.provider, next.runtime?.model,
                    payload.observedAtMs, "jcode.token_usage",
                ),
            )
            is SessionEvent.SessionStatus -> when (event.status) {
                "idle", "closed", "cancelled" -> settleIdle(next)
                "running", "generating", "tool_running", "processing" -> next.copy(
                    live = next.live.copy(
                        daemonRunning = true,
                        daemonStatus = "running",
                        status = if (next.live.turnId != null) next.live.status else "running",
                    ),
                )
                "attached" -> next
                else -> next.copy(live = next.live.copy(daemonStatus = "unknown"))
            }
            is SessionEvent.ConnectionPhase -> next.copy(live = next.live.copy(phase = event.phase))
            is SessionEvent.SessionRecovery -> next.copy(
                live = next.live.copy(recovery = Recovery(event.continuationMessage, event.reconnectNotice)),
            )
            is SessionEvent.TitleChanged -> {
                val snapshot = next.snapshot
                if (snapshot != null) {
                    val title = event.displayTitle.ifEmpty { event.title }
                    next.copy(
                        sessions = next.sessions.map { if (it.sessionId == snapshot.session.sessionId) it.copy(title = title) else it },
                        snapshot = snapshot.copy(session = snapshot.session.copy(title = title)),
                    )
                } else next
            }
            is SessionEvent.PlanUpdated -> next
            is SessionEvent.ContextCapChanged -> {
                val ctx = next.context
                if (ctx != null) next.copy(context = ctx.copy(effectiveBudget = event.effectiveBudget)) else next
            }
            is SessionEvent.AdapterError -> next.copy(
                live = next.live.copy(error = event.code + ": " + event.message, status = "error"),
            )
            is SessionEvent.TurnStopped -> finishTurn(next, event.turnId, "stopped")
            is SessionEvent.TurnDone -> finishTurn(next, event.turnId, "done")
            is SessionEvent.NeedsReconcile -> next.copy(
                live = next.live.copy(needsReconcile = true, status = "reconciling"),
            )
            is SessionEvent.Unknown -> next
            else -> next
        }
        val effect = if (payload.event is SessionEvent.NeedsReconcile) Effect.NeedSnapshot else Effect.None
        return Reduction(next, effect)
    }

    private fun appendText(state: AppState, text: String, messageId: String?): AppState {
        val id = messageId ?: "current"
        val current = state.live.assistants.lastOrNull { it.id == id && (messageId != null || !it.done) }
        return updateText(state, id, (current?.text ?: "") + text, current)
    }

    private fun replaceText(state: AppState, text: String, messageId: String?): AppState {
        val id = messageId ?: "current"
        return updateText(state, id, text, state.live.assistants.lastOrNull { it.id == id })
    }

    private fun updateText(state: AppState, id: String, text: String, previous: LiveBlock?): AppState {
        val status = when {
            state.live.status == "thinking" -> "writing"
            state.live.status == "idle" -> "working"
            else -> state.live.status
        }
        val assistants = if (previous != null) {
            state.live.assistants.map { if (it == previous) it.copy(text = text) else it }
        } else {
            state.live.assistants + LiveBlock(state.lastSeq, id, text, false)
        }
        return state.copy(live = state.live.copy(assistants = assistants, status = status))
    }

    private fun finishBlock(state: AppState, messageId: String?): AppState {
        val id = messageId ?: "current"
        val current = state.live.assistants.lastOrNull { it.id == id } ?: return state
        return state.copy(
            live = state.live.copy(
                assistants = state.live.assistants.map { if (it == current) it.copy(done = true) else it },
            ),
        )
    }

    private fun upsertTool(
        state: AppState,
        callId: String,
        name: String,
        status: String,
        initialInput: String = "",
        inputDelta: String = "",
        output: String = "",
        error: String? = null,
    ): AppState {
        val tools = state.live.tools.toMutableList()
        val index = tools.indexOfFirst { it.callId == callId }
        if (index == -1) {
            tools.add(LiveTool(state.lastSeq, callId, name, initialInput + inputDelta, output, error, status))
        } else {
            val existing = tools[index]
            tools[index] = existing.copy(
                name = name.ifEmpty { existing.name },
                input = existing.input + inputDelta,
                output = output.ifEmpty { existing.output },
                error = error ?: existing.error,
                status = status,
            )
        }
        return state.copy(live = state.live.copy(tools = tools, status = if (status == "failed") "tool failed" else "working"))
    }

    private fun finishTurn(state: AppState, turnId: String?, status: String): AppState {
        return state.copy(
            live = state.live.copy(
                turnId = null,
                finishedTurnId = turnId ?: state.live.turnId ?: state.live.finishedTurnId,
                status = status,
                phase = "",
                permission = null,
                startedAtMs = null,
                daemonRunning = false,
                daemonStatus = "idle",
                assistants = state.live.assistants.map { if (it.done) it else it.copy(done = true) },
                reasoning = state.live.reasoning.map { if (it.done) it else it.copy(done = true) },
                tools = state.live.tools.map {
                    if (it.status == "started" || it.status == "running") it.copy(status = "unknown") else it
                },
            ),
        )
    }

    private fun settleIdle(state: AppState): AppState {
        return state.copy(
            live = state.live.copy(
                turnId = null,
                finishedTurnId = state.live.turnId ?: state.live.finishedTurnId,
                operationId = null,
                startedAtMs = null,
                permission = null,
                phase = "",
                status = "idle",
                needsReconcile = false,
                daemonRunning = false,
                daemonStatus = "idle",
                tools = state.live.tools.map {
                    if (it.status == "started" || it.status == "running") it.copy(status = "unknown") else it
                },
            ),
        )
    }

    // -- reconcileLiveBlocks, ported from controller.ts -----------------------

    data class Reconciled(val assistants: List<LiveBlock>, val reasoning: List<LiveBlock>, val tools: List<LiveTool>)

    fun reconcile(messages: List<HistoryMessageView>, live: LiveState): Reconciled {
        if (messages.isEmpty()) return Reconciled(live.assistants, live.reasoning, live.tools)
        val historyToolIds = messages.filter { it.role == "tool" && it.toolCallId != null }.map { it.toolCallId!! }.toSet()
        val historyText = normalize(messages.filter { it.role == "assistant" }.map { it.content }.joinToString("\n"))
        val tools = live.tools.filter { it.callId !in historyToolIds }.map {
            if (it.status == "started" || it.status == "running") it.copy(status = "unknown") else it
        }
        val assistants = live.assistants.filter { block ->
            if (!block.done) true else {
                val text = normalize(block.text)
                text.isNotEmpty() && !historyText.contains(text.take(240))
            }
        }
        val represented = tools.isEmpty() && assistants.isEmpty()
        return Reconciled(assistants, if (represented) emptyList() else live.reasoning, tools)
    }

    private fun normalize(value: String): String = value.replace(Regex("\\s+"), " ").trim()
}

/** Apply an authoritative snapshot to live state, following applySnapshot. */
fun applySnapshotToState(state: AppState, snapshot: SessionSnapshot): AppState {
    val restoredTurn = snapshot.activeTurn
    val daemonStatus = snapshot.daemonStatus?.status
    val confirmedIdle = !snapshot.stale && daemonStatus == "idle"
    val confirmedRunning = !snapshot.stale && daemonStatus == "running"
    val legacyIdle = !snapshot.stale && daemonStatus == null && restoredTurn == null
    val idle = confirmedIdle || legacyIdle
    val reconciled = if (idle) LiveReducer().reconcile(snapshot.messages, state.live) else null
    val live = when {
        restoredTurn != null -> {
            val base = if (state.live.turnId == restoredTurn.turnId) state.live else LiveState()
            base.copy(
                turnId = restoredTurn.turnId,
                operationId = restoredTurn.operationId,
                finishedTurnId = null,
                startedAtMs = restoredTurn.startedAtMs,
                status = restoredTurn.status,
                phase = "",
                needsReconcile = false,
                permission = null,
                daemonRunning = true,
                daemonStatus = "running",
            )
        }
        idle -> {
            val tools = (reconciled?.tools ?: state.live.tools).map {
                if (it.status == "started" || it.status == "running") it.copy(status = "unknown") else it
            }
            state.live.copy(
                turnId = null,
                finishedTurnId = state.live.turnId ?: state.live.finishedTurnId,
                operationId = null,
                startedAtMs = null,
                permission = null,
                phase = "",
                status = "idle",
                needsReconcile = false,
                daemonRunning = false,
                daemonStatus = if (confirmedIdle) "idle" else state.live.daemonStatus,
                assistants = reconciled?.assistants ?: state.live.assistants,
                reasoning = reconciled?.reasoning ?: state.live.reasoning,
                tools = tools,
            )
        }
        confirmedRunning -> state.live.copy(
            turnId = null,
            finishedTurnId = null,
            operationId = null,
            startedAtMs = null,
            permission = null,
            phase = "",
            status = if (state.live.turnId != null) state.live.status else "running",
            needsReconcile = false,
            daemonRunning = true,
            daemonStatus = "running",
        )
        else -> state.live.copy(
            needsReconcile = daemonStatus == "unknown" || snapshot.stale,
            status = if (snapshot.stale) "reconciling" else state.live.status,
            daemonStatus = if (daemonStatus == "unknown") "unknown" else state.live.daemonStatus,
        )
    }
    val sessions = state.sessions.map { if (it.sessionId == snapshot.session.sessionId) snapshot.session else it }
    return state.copy(
        snapshot = snapshot,
        sessions = sessions,
        lastSeq = snapshot.lastSeq,
        epoch = snapshot.epoch,
        runtime = latestRuntime(state.runtime, snapshot.runtime),
        agents = snapshot.agents ?: state.agents,
        context = snapshot.context ?: state.context,
        savedOnPhone = false,
        activeMissing = false,
        live = live,
        reconciling = snapshot.stale || (daemonStatus == "unknown" && (state.live.turnId != null || state.live.daemonRunning)),
    )
}

fun latestRuntime(current: RuntimeView?, incoming: RuntimeView?): RuntimeView? {
    if (current != null && (incoming == null || current.observedAtMs > incoming.observedAtMs)) {
        return if (incoming != null) current.copy(routes = incoming.routes, providers = incoming.providers) else current
    }
    return incoming
}
