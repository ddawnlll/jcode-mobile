package dev.ziran.android

import dev.ziran.android.protocol.PlanStepStatus
import dev.ziran.android.protocol.parsePlan
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PlanParserTest {

    @Test
    fun parsesJcodeTodoStatePayload() {
        val raw = Json.parseToJsonElement(
            """
            {
              "plan": {
                "title": "Pinned todo card",
                "user_intention": "Pin a live todo card to the thread header"
              },
              "todos": [
                {
                  "id": "todo-1",
                  "content": "Card follows its thread id",
                  "status": "completed",
                  "group": "owl",
                  "touched": "TodoCard.tsx +48 −12",
                  "detail": "Reads the thread id from the route."
                },
                {
                  "id": "todo-2",
                  "content": "Migrate old pins",
                  "status": "in_progress",
                  "lane": "wren",
                  "started_at_ms": 1700000000000
                },
                {
                  "id": "todo-3",
                  "content": "Card in the thread header",
                  "status": "pending",
                  "agent": "heron",
                  "blocked_by": ["the migration"]
                }
              ]
            }
            """.trimIndent(),
        )
        val parsed = parsePlan(raw)
        assertNotNull(parsed)
        parsed!!
        assertEquals("Pinned todo card", parsed.title)
        assertEquals("Pin a live todo card to the thread header", parsed.intention)
        assertEquals(3, parsed.steps.size)

        assertEquals(PlanStepStatus.Done, parsed.steps[0].status)
        assertEquals("owl", parsed.steps[0].agent)
        assertEquals("TodoCard.tsx +48 −12", parsed.steps[0].touched)
        assertEquals("Reads the thread id from the route.", parsed.steps[0].detail)

        assertEquals(PlanStepStatus.Now, parsed.steps[1].status)
        assertEquals("wren", parsed.steps[1].agent)
        assertEquals(1700000000000L, parsed.steps[1].startedAtMs)

        assertEquals(PlanStepStatus.Todo, parsed.steps[2].status)
        assertEquals("heron", parsed.steps[2].agent)
        assertEquals("the migration", parsed.steps[2].waitsFor)
    }

    @Test
    fun returnsNullOnEmptyOrMissingTodos() {
        assertNull(parsePlan(null))
        assertNull(parsePlan(Json.parseToJsonElement("""{"todos":[]}""")))
        assertNull(parsePlan(Json.parseToJsonElement("""{"plan":{"title":"Empty"}}""")))
    }

    @Test
    fun parsesAlternateStepsArrayShape() {
        val raw = Json.parseToJsonElement(
            """
            {
              "steps": [
                { "title": "First", "status": "done", "who": "lynx" },
                { "name": "Second", "state": "working", "owner": "fox", "elapsed_secs": 42 }
              ]
            }
            """.trimIndent(),
        )
        val parsed = parsePlan(raw)
        assertNotNull(parsed)
        assertEquals(2, parsed!!.steps.size)
        assertEquals(PlanStepStatus.Done, parsed.steps[0].status)
        assertEquals("lynx", parsed.steps[0].agent)
        assertEquals(PlanStepStatus.Now, parsed.steps[1].status)
        assertEquals("fox", parsed.steps[1].agent)
        assertEquals(42L, parsed.steps[1].elapsedSecs)
    }
}
