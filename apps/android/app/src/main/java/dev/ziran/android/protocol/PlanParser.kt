package dev.ziran.android.protocol

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

enum class PlanStepStatus { Done, Now, Todo }

data class PlanStepView(
    val id: String,
    val title: String,
    val status: PlanStepStatus,
    val agent: String? = null,
    val detail: String? = null,
    val touched: String? = null,
    val waitsFor: String? = null,
    val startedAtMs: Long? = null,
    val elapsedSecs: Long? = null,
)

data class PlanView(
    val title: String? = null,
    val intention: String? = null,
    val steps: List<PlanStepView> = emptyList(),
)

/**
 * Leniently parses `SessionSnapshot.plan`, `plan_updated.plan`, and `plan.snapshot`
 * payloads into [PlanView]. Supports jcode's `TodoState` (`todos` + optional `plan`)
 * as well as `steps`/`items` arrays. Returns null when there are no valid steps.
 */
fun parsePlan(raw: JsonElement?): PlanView? {
    if (raw == null) return null
    val array: JsonArray?
    var title: String? = null
    var intention: String? = null

    when (raw) {
        is JsonArray -> array = raw
        is JsonObject -> {
            val nestedPlan = raw["plan"] as? JsonObject
            title = (nestedPlan?.strOrNull("title") ?: raw.strOrNull("title"))?.trim()?.takeIf { it.isNotEmpty() }
            intention = (
                nestedPlan?.strOrNull("user_intention")
                    ?: nestedPlan?.strOrNull("intention")
                    ?: raw.strOrNull("user_intention")
                    ?: raw.strOrNull("intention")
                )?.trim()?.takeIf { it.isNotEmpty() }
            array = (raw["todos"] as? JsonArray)
                ?: (raw["steps"] as? JsonArray)
                ?: (raw["items"] as? JsonArray)
                ?: (nestedPlan?.get("todos") as? JsonArray)
                ?: (nestedPlan?.get("steps") as? JsonArray)
        }
        else -> return null
    }

    if (array == null || array.isEmpty()) return null

    val steps = array.mapIndexedNotNull { index, el ->
        val obj = el as? JsonObject ?: return@mapIndexedNotNull null
        val stepTitle = (
            obj.strOrNull("content")
                ?: obj.strOrNull("title")
                ?: obj.strOrNull("name")
                ?: obj.strOrNull("text")
            )?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapIndexedNotNull null

        val id = obj.strOrNull("id")?.trim()?.takeIf { it.isNotEmpty() } ?: "step-$index"
        val rawStatus = (obj.strOrNull("status") ?: obj.strOrNull("state") ?: "pending").trim().lowercase()
        val status = when (rawStatus) {
            "completed", "done", "finished", "complete" -> PlanStepStatus.Done
            "in_progress", "working", "now", "running", "active" -> PlanStepStatus.Now
            else -> PlanStepStatus.Todo
        }
        val agent = (
            obj.strOrNull("agent")
                ?: obj.strOrNull("owner")
                ?: obj.strOrNull("who")
                ?: obj.strOrNull("assigned_to")
                ?: obj.strOrNull("assignee")
                ?: obj.strOrNull("label")
                ?: obj.strOrNull("lane")
                ?: obj.strOrNull("group")
            )?.trim()?.takeIf { it.isNotEmpty() }

        val detail = (
            obj.strOrNull("detail")
                ?: obj.strOrNull("description")
                ?: obj.strOrNull("notes")
                ?: obj.strOrNull("summary")
                ?: obj.strOrNull("completion_confidence")
            )?.trim()?.takeIf { it.isNotEmpty() }

        val touched = (obj.strOrNull("touched") ?: obj.strOrNull("files"))?.trim()?.takeIf { it.isNotEmpty() }

        val blockedList = (obj["blocked_by"] as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { s -> s.isNotEmpty() } }
            ?: emptyList()
        val waitsFor = obj.strOrNull("waits_for")?.trim()?.takeIf { it.isNotEmpty() }
            ?: blockedList.takeIf { it.isNotEmpty() }?.joinToString(", ")

        val startedAtMs = obj.longOrNull("started_at_ms") ?: obj.longOrNull("started_at") ?: obj.longOrNull("updated_at_ms")
        val elapsedSecs = obj.longOrNull("elapsed_secs") ?: obj.longOrNull("elapsed")

        PlanStepView(
            id = id,
            title = stepTitle,
            status = status,
            agent = agent,
            detail = detail,
            touched = touched,
            waitsFor = waitsFor,
            startedAtMs = startedAtMs,
            elapsedSecs = elapsedSecs,
        )
    }

    if (steps.isEmpty()) return null
    return PlanView(title = title, intention = intention, steps = steps)
}

private fun JsonObject.strOrNull(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

private fun JsonObject.longOrNull(key: String): Long? =
    (this[key] as? JsonPrimitive)?.longOrNull
