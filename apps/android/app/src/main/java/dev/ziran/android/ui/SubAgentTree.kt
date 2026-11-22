package dev.ziran.android.ui

import dev.ziran.android.protocol.SessionSummary
import dev.ziran.android.protocol.SwarmAgentView

/** Grouped top-level thread with its nested sub-agents. */
data class ThreadTreeItem(
    val session: SessionSummary,
    val subAgents: List<SessionSummary>,
    val autoExpandedBySearch: Boolean = false,
)

/** Status sort rank: waiting (0) -> working (1) -> finished (2) -> resting (3). */
fun sessionStatusRank(status: String): Int = when (status.trim().lowercase()) {
    "waiting", "permission", "ask" -> 0
    "working", "running", "generating", "tool_running", "processing", "live" -> 1
    "done", "finished", "completed" -> 2
    else -> 3
}

/**
 * Builds the filtered, sorted tree of top-level threads and their nested sub-agents.
 *
 * Rules:
 * - Any session with a non-blank `parentSessionId` is a sub-agent and NEVER appears top-level.
 * - Search matches title, status/swarmStatus note, and agentLabel across parent and sub-agents.
 * - If a sub-agent matches the search query, its parent is kept and marked `autoExpandedBySearch = true`.
 * - Sort order: `recent` (updatedAtMs desc), `name` (title asc), `status` (rank asc, then recent).
 */
fun buildThreadTree(
    sessions: List<SessionSummary>,
    query: String,
    sortMode: String,
    snapshotAgents: List<SwarmAgentView>? = null,
    activeParentId: String? = null,
): List<ThreadTreeItem> {
    val active = sessions.filter { !it.archived }
    val childrenByParent = active
        .filter { !it.parentSessionId.isNullOrBlank() }
        .groupBy { it.parentSessionId!! }
        .toMutableMap()

    // Merge SwarmAgentView entries from snapshot if they aren't already in sessions list.
    if (!snapshotAgents.isNullOrEmpty()) {
        val knownIds = active.mapTo(mutableSetOf()) { it.sessionId }
        for (agent in snapshotAgents) {
            val parentId = agent.parentSessionId ?: activeParentId ?: continue
            if (agent.sessionId == parentId || agent.sessionId in knownIds) continue
            val synth = SessionSummary(
                sessionId = agent.sessionId,
                title = agent.label ?: "Sub-agent",
                titleSource = "swarm",
                status = agent.status,
                workingDir = null,
                projectId = null,
                updatedAtMs = null,
                transcriptBytes = null,
                saved = false,
                archived = false,
                parentSessionId = parentId,
                agentLabel = agent.label,
                swarmStatus = agent.status,
            )
            childrenByParent.getOrPut(parentId) { emptyList() }.let { existing ->
                childrenByParent[parentId] = existing + synth
            }
        }
    }

    val topLevel = active.filter { it.parentSessionId.isNullOrBlank() }
    val q = query.trim().lowercase()

    fun matches(s: SessionSummary): Boolean {
        if (q.isEmpty()) return true
        val haystack = buildString {
            append(s.title.orEmpty()).append(' ')
            append(s.swarmStatus ?: s.status).append(' ')
            append(s.agentLabel.orEmpty())
        }.lowercase()
        return haystack.contains(q)
    }

    val filtered = topLevel.mapNotNull { parent ->
        val subs = childrenByParent[parent.sessionId].orEmpty()
        val parentHit = matches(parent)
        val matchingSubs = if (q.isEmpty()) subs else subs.filter(::matches)
        if (q.isEmpty()) {
            ThreadTreeItem(parent, subs, autoExpandedBySearch = false)
        } else if (parentHit || matchingSubs.isNotEmpty()) {
            ThreadTreeItem(
                session = parent,
                subAgents = if (matchingSubs.isNotEmpty()) matchingSubs else subs,
                autoExpandedBySearch = matchingSubs.isNotEmpty(),
            )
        } else {
            null
        }
    }

    val comparator = when (sortMode) {
        "name" -> compareBy<ThreadTreeItem> { (it.session.title ?: "").lowercase() }
            .thenByDescending { it.session.updatedAtMs ?: 0L }
        "status" -> compareBy<ThreadTreeItem> { sessionStatusRank(it.session.swarmStatus ?: it.session.status) }
            .thenByDescending { it.session.updatedAtMs ?: 0L }
        else -> compareByDescending<ThreadTreeItem> { it.session.updatedAtMs ?: 0L }
    }

    return filtered.sortedWith(comparator)
}
