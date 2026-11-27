package dev.ziran.android.data

/**
 * Soft-interrupt queue, scoped per server and session.
 *
 * The old queue was a single global list on AppState, so a message written in
 * thread A could be sent while thread B was open. Every entry here belongs to
 * exactly one serverId + sessionId, and a drain may only take from the session
 * it was queued in.
 */
class MessageQueues {

    private val bySession = mutableMapOf<String, MutableList<String>>()

    private fun key(serverId: String, sessionId: String) = "$serverId|$sessionId"

    @Synchronized
    fun load(serverId: String, sessionId: String, texts: List<String>) {
        if (texts.isEmpty()) bySession.remove(key(serverId, sessionId))
        else bySession[key(serverId, sessionId)] = texts.toMutableList()
    }

    @Synchronized
    fun list(serverId: String, sessionId: String): List<String> =
        bySession[key(serverId, sessionId)]?.toList() ?: emptyList()

    /** Append one message and return the session's new queue, in order. */
    @Synchronized
    fun enqueue(serverId: String, sessionId: String, text: String): List<String> {
        val list = bySession.getOrPut(key(serverId, sessionId)) { mutableListOf() }
        list.add(text)
        return list.toList()
    }

    /** Put text back at the head, keeping the rest of the queue in order. */
    @Synchronized
    fun pushFront(serverId: String, sessionId: String, text: String): List<String> {
        val list = bySession.getOrPut(key(serverId, sessionId)) { mutableListOf() }
        list.add(0, text)
        return list.toList()
    }

    /** Inspect the oldest message without removing it so staging can commit durably first. */
    @Synchronized
    fun peekFirst(serverId: String, sessionId: String): String? {
        val list = bySession[key(serverId, sessionId)] ?: return null
        return list.firstOrNull()
    }

    /** Remove the head only if it still matches [expected], returning true if removed. */
    @Synchronized
    fun removeFirstIf(serverId: String, sessionId: String, expected: String): Boolean {
        val k = key(serverId, sessionId)
        val list = bySession[k] ?: return false
        if (list.firstOrNull() != expected) return false
        list.removeAt(0)
        if (list.isEmpty()) bySession.remove(k)
        return true
    }

    /** Remove and return the oldest message for this exact session. */
    @Synchronized
    fun takeFirst(serverId: String, sessionId: String): String? {
        val k = key(serverId, sessionId)
        val list = bySession[k] ?: return null
        if (list.isEmpty()) {
            bySession.remove(k)
            return null
        }
        val first = list.removeAt(0)
        if (list.isEmpty()) bySession.remove(k)
        return first
    }

    @Synchronized
    fun clear(serverId: String, sessionId: String) {
        bySession.remove(key(serverId, sessionId))
    }

    /** Sessions that still hold queued text, as serverId to sessionId pairs. */
    @Synchronized
    fun pendingSessions(): List<Pair<String, String>> = bySession.keys.mapNotNull { key ->
        val cut = key.indexOf('|')
        if (cut <= 0) null else key.substring(0, cut) to key.substring(cut + 1)
    }

    @Synchronized
    fun isEmpty(): Boolean = bySession.isEmpty()
}

/**
 * Per-session retry/backoff guard for queued message draining (#119).
 *
 * - Permanent rejection stops automatic retries immediately until the user
 *   explicitly retries or discards the queued message.
 * - Transient transport failures back off exponentially (1 s -> 2 s -> 4 s)
 *   and pause after [maxTransientAttempts] so a broken connection never spins.
 */
class QueueDrainPolicy(
    private val maxTransientAttempts: Int = 3,
    private val baseDelayMs: Long = 1_000L,
) {
    data class SessionDrainState(
        val transientFailures: Int = 0,
        val nextAllowedAtMs: Long = 0L,
        val pausedError: String? = null,
    )

    private val states = mutableMapOf<String, SessionDrainState>()

    private fun key(serverId: String, sessionId: String) = "$serverId|$sessionId"

    @Synchronized
    fun canDrain(serverId: String, sessionId: String, nowMs: Long = System.currentTimeMillis()): Boolean {
        val st = states[key(serverId, sessionId)] ?: return true
        if (st.pausedError != null) return false
        return nowMs >= st.nextAllowedAtMs
    }

    @Synchronized
    fun delayUntilReadyMs(serverId: String, sessionId: String, nowMs: Long = System.currentTimeMillis()): Long? {
        val st = states[key(serverId, sessionId)] ?: return 0L
        if (st.pausedError != null) return null
        return (st.nextAllowedAtMs - nowMs).coerceAtLeast(0L)
    }

    @Synchronized
    fun pausedError(serverId: String, sessionId: String): String? =
        states[key(serverId, sessionId)]?.pausedError

    @Synchronized
    fun recordSuccess(serverId: String, sessionId: String) {
        states.remove(key(serverId, sessionId))
    }

    /** Permanent adapter rejection: stop auto-retrying immediately. */
    @Synchronized
    fun recordPermanentRejection(serverId: String, sessionId: String, message: String) {
        states[key(serverId, sessionId)] = SessionDrainState(
            transientFailures = maxTransientAttempts,
            nextAllowedAtMs = Long.MAX_VALUE,
            pausedError = message,
        )
    }

    /**
     * Transient failure: returns the backoff delay in ms, or null if retries are
     * now exhausted and the session is paused for user action.
     */
    @Synchronized
    fun recordTransientFailure(
        serverId: String,
        sessionId: String,
        message: String,
        nowMs: Long = System.currentTimeMillis(),
    ): Long? {
        val k = key(serverId, sessionId)
        val prev = states[k]?.transientFailures ?: 0
        val next = prev + 1
        if (next >= maxTransientAttempts) {
            states[k] = SessionDrainState(
                transientFailures = next,
                nextAllowedAtMs = Long.MAX_VALUE,
                pausedError = message,
            )
            return null
        }
        val delayMs = baseDelayMs shl (next - 1)
        states[k] = SessionDrainState(
            transientFailures = next,
            nextAllowedAtMs = nowMs + delayMs,
            pausedError = null,
        )
        return delayMs
    }

    @Synchronized
    fun clear(serverId: String, sessionId: String) {
        states.remove(key(serverId, sessionId))
    }
}
