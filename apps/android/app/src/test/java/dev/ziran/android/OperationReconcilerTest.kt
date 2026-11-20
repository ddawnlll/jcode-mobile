package dev.ziran.android

import dev.ziran.android.data.OperationReconciler
import dev.ziran.android.data.PendingMessage
import dev.ziran.android.protocol.OperationView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Delivery is decided by operation id and state, never by matching message
 * text. The old code cleared pending when the snapshot happened to contain a
 * user message with the same words, which could report a failed send as
 * delivered.
 */
class OperationReconcilerTest {

    private val pending = PendingMessage(
        text = "hello",
        operationId = "op1",
        state = "dispatching",
        error = null,
        createdAt = 1_000L,
    )

    private fun operation(
        state: String,
        id: String = "op1",
        errorMessage: String? = null,
    ) = OperationView(
        operationId = id,
        sessionId = "s1",
        turnId = null,
        state = state,
        errorCode = if (errorMessage != null) "rejected" else null,
        errorMessage = errorMessage,
        createdAtMs = 0,
        updatedAtMs = 0,
    )

    @Test
    fun acceptedKeepsPendingWithItsStateSoNoResendIsOffered() {
        val outcome = OperationReconciler.reconcile(pending, operation("accepted"))
        assertNotNull(outcome.pending)
        assertEquals("accepted", outcome.pending!!.state)
        assertNull("accepted must not restore the composer", outcome.restoreComposerText)
    }

    @Test
    fun observedInHistoryIsAcceptance() {
        val outcome = OperationReconciler.reconcile(pending, operation("observed_in_history"))
        assertEquals("observed_in_history", outcome.pending!!.state)
        assertNull(outcome.restoreComposerText)
    }

    @Test
    fun rejectedClearsPendingAndReturnsTheText() {
        val outcome = OperationReconciler.reconcile(pending, operation("rejected", errorMessage = "session is archived"))
        assertNull(outcome.pending)
        assertEquals("hello", outcome.restoreComposerText)
        assertTrue(outcome.errorMessage!!.contains("session is archived"))
    }

    @Test
    fun cancelledClearsPending() {
        val outcome = OperationReconciler.reconcile(pending, operation("cancelled"))
        assertNull(outcome.pending)
        assertEquals("hello", outcome.restoreComposerText)
    }

    @Test
    fun unknownKeepsTheEntryAndOffersNoResend() {
        val outcome = OperationReconciler.reconcile(pending, operation("unknown"))
        assertEquals("unknown", outcome.pending!!.state)
        assertNull(outcome.restoreComposerText)
    }

    @Test
    fun anotherOperationsUpdateNeverTouchesThisPending() {
        val outcome = OperationReconciler.reconcile(pending, operation(id = "op2", state = "rejected"))
        assertEquals("dispatching", outcome.pending!!.state)
        assertNull(outcome.restoreComposerText)
    }

    @Test
    fun aLateDispatchEchoCannotWalkAcceptedBackwards() {
        val accepted = operation("accepted")
        val late = operation("dispatching")
        assertTrue(OperationReconciler.isStaleEcho(accepted, late))
        assertEquals(false, OperationReconciler.isStaleEcho(operation("staged"), late))
    }
}
