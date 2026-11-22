package dev.ziran.android

import dev.ziran.android.protocol.SessionSummary
import dev.ziran.android.ui.buildThreadTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SubAgentAndSortTest {

    private fun sess(
        id: String,
        title: String,
        status: String,
        updatedAt: Long,
        agent: String,
        parent: String? = null,
    ) = SessionSummary(
        sessionId = id,
        title = title,
        titleSource = "manual",
        status = status,
        workingDir = null,
        projectId = null,
        updatedAtMs = updatedAt,
        transcriptBytes = 0L,
        saved = true,
        archived = false,
        parentSessionId = parent,
        agentLabel = agent,
        swarmStatus = status,
    )

    private val sample = listOf(
        sess("s-fox", "Adapter v4 timeline", "working", 5000L, "fox"),
        sess("s-crane", "Clean the build cache", "waiting", 4000L, "crane"),
        sess("s-heron", "Pinned todo card", "working", 3000L, "heron"),
        sess("s-wren", "Migrate old pins", "working", 3500L, "wren", parent = "s-heron"),
        sess("s-lynx", "Drag to reorder", "working", 3400L, "lynx", parent = "s-heron"),
        sess("s-moth", "Android back stack", "idle", 1000L, "moth"),
    )

    @Test
    fun subAgentsNeverAppearTopLevel() {
        val tree = buildThreadTree(sample, query = "", sortMode = "recent")
        assertEquals(listOf("s-fox", "s-crane", "s-heron", "s-moth"), tree.map { it.session.sessionId })
        val heron = tree.first { it.session.sessionId == "s-heron" }
        assertEquals(listOf("s-wren", "s-lynx"), heron.subAgents.map { it.sessionId })
        assertFalse(heron.autoExpandedBySearch)
    }

    @Test
    fun searchMatchesSubAgentAndAutoUnfoldsParent() {
        val tree = buildThreadTree(sample, query = "migrate", sortMode = "recent")
        assertEquals(1, tree.size)
        assertEquals("s-heron", tree[0].session.sessionId)
        assertTrue(tree[0].autoExpandedBySearch)
        assertEquals(listOf("s-wren"), tree[0].subAgents.map { it.sessionId })
    }

    @Test
    fun sortsByStatusWaitingWorkingFinishedResting() {
        val tree = buildThreadTree(sample, query = "", sortMode = "status")
        assertEquals(listOf("s-crane", "s-fox", "s-heron", "s-moth"), tree.map { it.session.sessionId })
    }

    @Test
    fun sortsByNameAlphabetically() {
        val tree = buildThreadTree(sample, query = "", sortMode = "name")
        assertEquals(listOf("s-fox", "s-moth", "s-crane", "s-heron"), tree.map { it.session.sessionId })
    }
}
