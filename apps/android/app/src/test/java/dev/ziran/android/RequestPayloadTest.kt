package dev.ziran.android

import dev.ziran.android.protocol.EnvelopeWriter
import dev.ziran.android.protocol.RequestPayloads
import dev.ziran.android.protocol.jsonBool
import dev.ziran.android.protocol.jsonOrNull
import dev.ziran.android.protocol.jsonWorkingDir
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exact wire JSON. The bug this replaces sent the string "null" and stringified
 * booleans; Rust reads Option<String> and bool strictly, so those requests fail
 * deserialization.
 */
class RequestPayloadTest {

    @Test
    fun reserveSendsJsonNullTurnAndNoStringNull() {
        val payload = RequestPayloads.reserve("op1", "s1", "hello")
        assertEquals(
            """{"operation_id":"op1","session_id":"s1","kind":"send","body":"hello","expected_turn_id":null,"images":[]}""",
            payload.toString(),
        )
        assertFalse(payload.toString().contains("\"null\""))
        assertTrue(payload["expected_turn_id"] is JsonNull)
    }

    @Test
    fun reserveSendsATurnIdWhenGiven() {
        val payload = RequestPayloads.reserve("op1", "s1", "hi", expectedTurnId = "t9")
        assertEquals("\"t9\"", payload["expected_turn_id"].toString())
    }

    @Test
    fun cancelWithoutTurnSendsNullsAndBooleanTrue() {
        val payload = RequestPayloads.cancel("s1", operationId = null, expectedTurnId = null)
        assertEquals(
            """{"session_id":"s1","operation_id":null,"expected_turn_id":null,"allow_running_unknown":true}""",
            payload.toString(),
        )
        // A stringified boolean is the bug: it must be a JSON literal.
        assertEquals("true", payload["allow_running_unknown"].toString())
        assertTrue(payload["allow_running_unknown"] is JsonPrimitive)
        assertFalse((payload["allow_running_unknown"] as JsonPrimitive).isString)
    }

    @Test
    fun cancelWithTurnSendsBooleanFalse() {
        val payload = RequestPayloads.cancel("s1", operationId = "op1", expectedTurnId = "t1")
        assertEquals(
            """{"session_id":"s1","operation_id":"op1","expected_turn_id":"t1","allow_running_unknown":false}""",
            payload.toString(),
        )
        assertFalse((payload["allow_running_unknown"] as JsonPrimitive).isString)
    }

    @Test
    fun favoriteSendsABoolean() {
        val payload = RequestPayloads.favorite("s1", false)
        assertEquals("""{"session_id":"s1","favorite":false}""", payload.toString())
        assertFalse((payload["favorite"] as JsonPrimitive).isString)
    }

    @Test
    fun createSendsNullsForEmptyOptionalFields() {
        val payload = RequestPayloads.create("c1", projectId = null, title = "")
        assertEquals(
            """{"client_request_id":"c1","project_id":null,"working_dir":null,"title":null}""",
            payload.toString(),
        )
    }

    @Test
    fun createSendsWorkingDirOnlyWhenAbsolute() {
        val absolute = RequestPayloads.create("c1", "p1", "Title", workingDir = "/home/me/work")
        assertEquals(
            """{"client_request_id":"c1","project_id":"p1","working_dir":"/home/me/work","title":"Title"}""",
            absolute.toString(),
        )
        val relative = RequestPayloads.create("c1", "p1", "Title", workingDir = "relative/path")
        assertTrue(relative["working_dir"] is JsonNull)
    }

    @Test
    fun envelopeOmitsNoSessionAsJsonNullNotTheStringNull() {
        val text = EnvelopeWriter.request("req_1", "sessions.list", kotlinx.serialization.json.JsonObject(emptyMap()), 4)
        val env = kotlinx.serialization.json.Json.parseToJsonElement(text).jsonObject
        assertTrue(env["session_id"] is JsonNull)
        assertTrue(env["operation_id"] is JsonNull)
        assertFalse(text.contains("\"session_id\":\"null\""))
    }

    @Test
    fun helpersNeverEmitTheStringNull() {
        assertEquals("null", jsonOrNull(null).toString())
        assertEquals("null", jsonOrNull("").toString())
        assertEquals("\"x\"", jsonOrNull("x").toString())
        assertEquals("true", jsonBool(true).toString())
        assertEquals("null", jsonWorkingDir("relative").toString())
        assertEquals("\"/abs\"", jsonWorkingDir("/abs").toString())
    }
}
