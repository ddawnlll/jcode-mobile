package dev.ziran.android

import dev.ziran.android.protocol.EnvelopeWriter
import dev.ziran.android.protocol.Kind
import dev.ziran.android.protocol.parseEnvelope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EnvelopeTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun parsesResponseEnvelope() {
        val text = """{"v":4,"kind":"response","id":"r1","reply_to":"req_1","type":"sessions.list","payload":{"sessions":[]}}"""
        val env = parseEnvelope(text, json)!!
        assertEquals(4, env.v)
        assertEquals(Kind.Response, env.kind)
        assertEquals("r1", env.id)
        assertEquals("req_1", env.replyTo)
        assertEquals("sessions.list", env.type)
    }

    @Test fun parsesEventWithSeqAndEpoch() {
        val text = """{"v":4,"kind":"event","id":"e1","session_id":"s1","epoch":"ep1","seq":42,"type":"session.event","payload":{"event":{"kind":"text_delta","text":"hi"},"turn_id":"t1"}}"""
        val env = parseEnvelope(text, json)!!
        assertEquals(Kind.Event, env.kind)
        assertEquals("s1", env.sessionId)
        assertEquals("ep1", env.epoch)
        assertEquals(42L, env.seq)
    }

    @Test fun malformedJsonReturnsNull() {
        assertNull(parseEnvelope("not json", json))
        assertNull(parseEnvelope("[]", json))
    }

    @Test fun writerCreatesRequestAtVersion() {
        val payload = JsonObject(mapOf("session_id" to JsonPrimitive("s1")))
        val text = EnvelopeWriter.request("req_9", "sessions.snapshot", payload, 2, "s1")
        val env = parseEnvelope(text, EnvelopeWriter.json)!!
        assertEquals(2, env.v)
        assertEquals(Kind.Request, env.kind)
        assertEquals("sessions.snapshot", env.type)
        assertEquals("s1", env.sessionId)
    }

    @Test fun helloOffersMinMaxAndSubprotocols() {
        val hello = EnvelopeWriter.helloPayload("ziran-android", "0.7.0")
        assertEquals(2, hello["min_version"]?.toString()?.trim('"')?.toInt())
        assertEquals(4, hello["max_version"]?.toString()?.trim('"')?.toInt())
        assertTrue(hello["supports"].toString().contains("jcode.mobile.v4"))
    }
}
