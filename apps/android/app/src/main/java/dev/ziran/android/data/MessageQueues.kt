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
