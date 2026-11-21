package dev.ziran.android.protocol

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Wire values for optional fields.
 *
 * `JsonPrimitive(null.toString())` serializes the *string* "null". Rust reads
 * `Option<String>` and `bool` strictly, so such a request is rejected — and the
 * adapter checks `typeof frame.session_id === 'string'`, so a literal "null"
 * would even look like a real session id.
 *
 * Null must be `JsonNull`; booleans must be `JsonPrimitive(Boolean)` and never
 * a String.
 */
fun jsonOrNull(value: String?): JsonElement =
    value?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull

fun jsonBool(value: Boolean): JsonElement = JsonPrimitive(value)

/** The daemon opens `working_dir` as a directory, so only an absolute path is sent. */
fun jsonWorkingDir(path: String?): JsonElement =
    if (path != null && path.startsWith("/")) JsonPrimitive(path) else JsonNull

/**
 * Request bodies for the adapter protocol, in one place so a test can assert
 * the exact JSON that goes on the wire.
 *
 * Field names and optional handling follow `crates/adapter-protocol/src/lib.rs`
 * and `apps/stillness/src/lib/controller.ts`.
 */
object RequestPayloads {

    fun reserve(
        operationId: String,
        sessionId: String,
        body: String,
        expectedTurnId: String? = null,
    ): JsonObject = JsonObject(
        mapOf(
            "operation_id" to JsonPrimitive(operationId),
            "session_id" to JsonPrimitive(sessionId),
            "kind" to JsonPrimitive("send"),
            "body" to JsonPrimitive(body),
            "expected_turn_id" to jsonOrNull(expectedTurnId),
            "images" to JsonArray(emptyList()),
        ),
    )

    fun dispatch(operationId: String): JsonObject = JsonObject(
        mapOf("operation_id" to JsonPrimitive(operationId)),
    )

    /**
     * `allow_running_unknown` is true only when the adapter lost the turn id but
     * the daemon still proves this session is generating. It is a bool on the
     * wire, not the string "true".
     */
    fun cancel(
        sessionId: String,
        operationId: String?,
        expectedTurnId: String?,
    ): JsonObject = JsonObject(
        mapOf(
            "session_id" to JsonPrimitive(sessionId),
            "operation_id" to jsonOrNull(operationId),
            "expected_turn_id" to jsonOrNull(expectedTurnId),
            "allow_running_unknown" to jsonBool(expectedTurnId == null),
        ),
    )

    fun favorite(sessionId: String, favorite: Boolean): JsonObject = JsonObject(
        mapOf(
            "session_id" to JsonPrimitive(sessionId),
            "favorite" to jsonBool(favorite),
        ),
    )

    fun create(
        clientRequestId: String,
        projectId: String?,
        title: String,
        workingDir: String? = null,
    ): JsonObject = JsonObject(
        mapOf(
            "client_request_id" to JsonPrimitive(clientRequestId),
            "project_id" to jsonOrNull(projectId),
            "working_dir" to jsonWorkingDir(workingDir),
            "title" to jsonOrNull(title.trim()),
        ),
    )

    fun lookupOperation(operationId: String): JsonObject = JsonObject(
        mapOf("operation_id" to JsonPrimitive(operationId)),
    )
}
