package dev.ziran.android.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Serialize envelopes for sending. Payload is a raw JSON object; ids and scope
 * ride on the envelope exactly as in adapter.ts request().
 */
object EnvelopeWriter {
    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
    }

    fun request(id: String, type: String, payload: JsonObject, v: Int, sessionId: String? = null, operationId: String? = null): String {
        val o = JsonObject(
            mapOf(
                "v" to JsonPrimitive(v),
                "kind" to JsonPrimitive("request"),
                "id" to JsonPrimitive(id),
                "type" to JsonPrimitive(type),
                "payload" to payload,
                // JsonNull, never the string "null": the adapter treats a
                // string as a real session id.
                "session_id" to (sessionId?.let(::JsonPrimitive) ?: JsonNull),
                "operation_id" to (operationId?.let(::JsonPrimitive) ?: JsonNull),
            )
        )
        return json.encodeToString(JsonObject.serializer(), o)
    }

    fun helloPayload(clientName: String, clientVersion: String): JsonObject = buildMap {
        put("client_name", JsonPrimitive(clientName))
        put("client_version", JsonPrimitive(clientVersion))
        put("min_version", JsonPrimitive(MIN_PROTOCOL_VERSION))
        put("max_version", JsonPrimitive(PROTOCOL_VERSION))
        put("supports", JsonArray(listOf(JsonPrimitive(V5_WS_SUBPROTOCOL), JsonPrimitive(WS_SUBPROTOCOL), JsonPrimitive(JOURNAL_WS_SUBPROTOCOL), JsonPrimitive(LEGACY_WS_SUBPROTOCOL))))
    }.let(::JsonObject)
}
