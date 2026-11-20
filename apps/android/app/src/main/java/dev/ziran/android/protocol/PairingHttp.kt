package dev.ziran.android.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * POST {base}/v2/pair with {code, device_name} -> {token, device, server}.
 * Mirrors adapter.ts pairDevice. Native keeps the Bearer header instead of the
 * browser token subprotocol.
 */
object PairingHttp {
    private val json = EnvelopeWriter.json

    suspend fun pair(baseUrl: String, code: String, deviceName: String, http: OkHttpClient): PairPayload =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val normalized = dev.ziran.android.connection.ServerUrls.normalize(baseUrl)
        val body = JsonObject(
            mapOf(
                "code" to JsonPrimitive(code.trim()),
                "device_name" to JsonPrimitive(deviceName.trim()),
            ),
        ).let { json.encodeToString(JsonObject.serializer(), it) }
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("$normalized/v2/pair")
            .post(body)
            .build()
        // `use` closes the response body on the success path and on a throw.
        http.newCall(request).execute().use { response ->
            val text = response.body?.string() ?: throw IllegalStateException("Empty pairing response.")
            val obj = json.parseToJsonElement(text).jsonObject
            if (!response.isSuccessful) throw AdapterRequestError(parseError(obj))
            buildPayload(obj)
        }
    }

    private fun buildPayload(obj: JsonObject): PairPayload {
        val token = obj["token"]?.let { it.toString().trim('"') }
        val device = obj["device"]?.let { runCatching { it.jsonObject }.getOrNull() }
        val server = obj["server"]?.let { runCatching { it.jsonObject }.getOrNull() }
        if (token.isNullOrEmpty() || device == null || server == null) {
            throw IllegalStateException("The adapter returned an incomplete pairing response.")
        }
        return PairPayload(token, parseDeviceInfo(device), parseServerInfo(server))
    }
}

data class PairPayload(val token: String, val device: DeviceInfo, val server: ServerInfo)
