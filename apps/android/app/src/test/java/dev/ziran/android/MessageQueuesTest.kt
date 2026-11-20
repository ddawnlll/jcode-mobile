package dev.ziran.android

import dev.ziran.android.data.MessageQueues
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The old queue lived on AppState as one global list, so a message written in
 * thread A could be drained while thread B was open. Every entry is now scoped
 * to one serverId + sessionId.
 */
class MessageQueuesTest {

    private val server = "srv1"

    @Test
    fun queuesDoNotLeakBetweenSessions() {
        val q = MessageQueues()
        q.enqueue(server, "threadA", "for A")
        q.enqueue(server, "threadB", "for B")

        assertEquals(listOf("for A"), q.list(server, "threadA"))
        assertEquals(listOf("for B"), q.list(server, "threadB"))

        assertEquals("for A", q.takeFirst(server, "threadA"))
        // B is untouched by draining A.
        assertEquals(listOf("for B"), q.list(server, "threadB"))
        assertEquals(listOf("for B"), q.list(server, "threadB"))
    }

    @Test
    fun queuesDoNotLeakBetweenServers() {
        val q = MessageQueues()
        q.enqueue("serverOne", "sameThreadId", "one")
        q.enqueue("serverTwo", "sameThreadId", "two")

        assertEquals("one", q.takeFirst("serverOne", "sameThreadId"))
        assertEquals(listOf("two"), q.list("serverTwo", "sameThreadId"))
    }

    @Test
    fun drainIsFifo() {
        val q = MessageQueues()
        q.enqueue(server, "t", "first")
        q.enqueue(server, "t", "second")
        q.enqueue(server, "t", "third")

        assertEquals("first", q.takeFirst(server, "t"))
        assertEquals("second", q.takeFirst(server, "t"))
        assertEquals(listOf("third"), q.list(server, "t"))
    }

    @Test
    fun pushFrontRestoresOrderForARejectedQueuedSend() {
        val q = MessageQueues()
        q.enqueue(server, "t", "queued-one")
        q.enqueue(server, "t", "queued-two")

        val taken = q.takeFirst(server, "t")
        val restored = q.pushFront(server, "t", taken!!)

        assertEquals(listOf("queued-one", "queued-two"), restored)
    }

    @Test
    fun takingTheLastEntryRemovesTheSession() {
        val q = MessageQueues()
        q.enqueue(server, "t", "only")
        assertEquals("only", q.takeFirst(server, "t"))
        assertTrue(q.pendingSessions().isEmpty())
        assertNull(q.takeFirst(server, "t"))
    }

    @Test
    fun loadReplacesAndEmptyLoadClears() {
        val q = MessageQueues()
        q.load(server, "t", listOf("a", "b"))
        assertEquals(listOf("a", "b"), q.list(server, "t"))
        q.load(server, "t", emptyList())
        assertTrue(q.list(server, "t").isEmpty())
        assertTrue(q.pendingSessions().isEmpty())
    }

    @Test
    fun pendingSessionsListsEveryScopedQueue() {
        val q = MessageQueues()
        q.enqueue("s1", "a", "x")
        q.enqueue("s2", "b", "y")

        val pending = q.pendingSessions().toSet()

        assertEquals(setOf("s1" to "a", "s2" to "b"), pending)
    }
}
