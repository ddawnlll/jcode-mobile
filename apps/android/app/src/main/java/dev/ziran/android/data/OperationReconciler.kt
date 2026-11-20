package dev.ziran.android.data

import dev.ziran.android.protocol.OperationView

/** What the controller should do to pending after one operation update. */
data class PendingOutcome(
    /** The pending entry after this update, or null when it is settled. */
    val pending: PendingMessage?,
    /** Text to put back in the composer, when the attempt provably never landed. */
    val restoreComposerText: String? = null,
    /** Honest message for the error line, when the operation failed. */
    val errorMessage: String? = null,
)

/**
 * Pending is reconciled by operation id and operation state only.
 *
 * The old code cleared pending when the snapshot happened to contain a user
 * message with the same words ("snapshot.messages.any { content == pending.text }").
 * An older identical message is not proof that this send landed, so a send that
 * actually failed could be shown as delivered. Nothing here looks at message
 * text.
 */
object OperationReconciler {

    /**
     * States an operation never leaves. `accepted` and `observed_in_history`
     * mean the message reached the agent; `unknown` is not evidence of
     * anything, but a late `dispatching` echo after it is still stale.
     */
    val TERMINAL_STATES = setOf(
        "accepted", "observed_in_history", "unknown", "rejected", "cancelled",
    )

    /** True when an older terminal state must not be walked back to dispatching. */
    fun isStaleEcho(previous: OperationView?, incoming: OperationView): Boolean =
        previous != null && incoming.state == "dispatching" && previous.state in TERMINAL_STATES

    fun reconcile(pending: PendingMessage?, operation: OperationView): PendingOutcome {
        if (pending == null || pending.operationId != operation.operationId) {
            return PendingOutcome(pending)
        }
        return when (operation.state) {
            // The adapter explicitly rejected it, so the attempt never entered
            // the session. Give the text back and clear pending.
            "rejected", "cancelled" -> PendingOutcome(
                pending = null,
                restoreComposerText = pending.text,
                errorMessage = "Message was not sent: " +
                    (operation.errorMessage ?: "the adapter rejected it."),
            )
            // Reached the agent. Keep the entry as an audit trail, with its
            // final state; the composer is already clear.
            else -> PendingOutcome(
                pending = pending.copy(state = operation.state, error = operation.errorMessage),
            )
        }
    }
}
