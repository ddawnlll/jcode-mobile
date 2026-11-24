package dev.ziran.android

import dev.ziran.android.data.AppState
import dev.ziran.android.data.LiveReducer
import dev.ziran.android.data.OperationReconciler
import dev.ziran.android.data.PendingMessage
import dev.ziran.android.protocol.OperationView
import dev.ziran.android.protocol.SessionEvent
import dev.ziran.android.protocol.SessionEventPayload
import dev.ziran.android.protocol.SessionSnapshot
import dev.ziran.android.protocol.SessionSummary
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression test for Bug 1b: sending a message after the agent has responded.
 * Runs send -> accepted -> turn_done -> send -> accepted -> turn_done -> send
 * three times with zero conflict and no stale turnId or blocking pending state.
 */
class SendAfterTurnDoneTest {

    @Test
    fun threeConsecutiveSendAndTurnDoneCyclesNeverBlock() {
        val reducer = LiveReducer()
        val summary = SessionSummary(
            sessionId = "sess-1",
            title = "Test",
            titleSource = "manual",
            status = "idle",
            workingDir = null,
            projectId = null,
            updatedAtMs = 1000L,
            transcriptBytes = 0L,
            saved = true,
            archived = false,
            parentSessionId = null,
            agentLabel = "fox",
        )
        val snapshot = SessionSnapshot(
            session = summary,
            messages = emptyList(),
            runtime = null,
            epoch = "ep-1",
            lastSeq = 0L,
            revision = 1L,
            authoritativeAtMs = 1000L,
            stale = false,
            source = "test",
        )
        var state = AppState(
            phase = "ready",
            connection = "connected",
            activeSessionId = "sess-1",
            snapshot = snapshot,
            epoch = "ep-1",
            lastSeq = 0L,
        )

        var seq = 1L
        for (cycle in 1..3) {
            // 1. Before sending, nothing blocks a new send and no stale turnId remains.
            assertFalse("Cycle $cycle: pending must not block send", OperationReconciler.isBlockingNewSend(state.pending))
            assertNull("Cycle $cycle: turnId must be null before send", state.live.turnId)

            val opId = "op-$cycle"
            val turnId = "turn-$cycle"

            // 2. Stage pending message -> blocks duplicate resend while in flight.
            state = state.copy(
                pending = PendingMessage("message $cycle", opId, "staged", null, cycle * 1000L),
            )
            assertTrue("Cycle $cycle: staged blocks resend", OperationReconciler.isBlockingNewSend(state.pending))

            // 3. Adapter accepts dispatch -> OperationReconciler marks accepted.
            val accepted = OperationView(
                operationId = opId,
                sessionId = "sess-1",
                turnId = turnId,
                state = "accepted",
                errorCode = null,
                errorMessage = null,
                createdAtMs = cycle * 1000L,
                updatedAtMs = cycle * 1000L + 10L,
            )
            val outcome = OperationReconciler.reconcile(state.pending, accepted)
            state = state.copy(pending = outcome.pending)
            assertFalse("Cycle $cycle: accepted must not block subsequent sends", OperationReconciler.isBlockingNewSend(state.pending))

            // 4. TurnStarted -> TextDelta -> TurnDone.
            val started = SessionEventPayload(
                event = SessionEvent.TurnStarted(turnId, opId),
                eventKind = "turn_started",
                turnId = turnId,
                operationId = opId,
                observedAtMs = cycle * 1000L + 20L,
            )
            state = reducer.reduceEvent(state, "sess-1", "ep-1", seq++, started).state
            assertTrue(state.live.turnId == turnId)

            val delta = SessionEventPayload(
                event = SessionEvent.TextDelta("reply $cycle", "msg-$cycle"),
                eventKind = "text_delta",
                turnId = turnId,
                operationId = opId,
                observedAtMs = cycle * 1000L + 50L,
            )
            state = reducer.reduceEvent(state, "sess-1", "ep-1", seq++, delta).state

            val done = SessionEventPayload(
                event = SessionEvent.TurnDone(turnId),
                eventKind = "turn_done",
                turnId = turnId,
                operationId = opId,
                observedAtMs = cycle * 1000L + 100L,
            )
            state = reducer.reduceEvent(state, "sess-1", "ep-1", seq++, done).state

            // 5. After TurnDone: turnId is cleared, daemonRunning is false, accepted pending is cleared,
            //    and the user prompt remains visible in snapshot.messages until authoritative snapshot arrives.
            assertNull("Cycle $cycle: turnId cleared after TurnDone", state.live.turnId)
            assertFalse("Cycle $cycle: daemonRunning cleared after TurnDone", state.live.daemonRunning)
            assertNull("Cycle $cycle: accepted pending cleared after TurnDone", state.pending)
            assertTrue(
                "Cycle $cycle: user prompt stays in snapshot.messages after TurnDone",
                state.snapshot?.messages?.any { it.role == "user" && it.content == "message $cycle" } == true,
            )
        }
    }
}
