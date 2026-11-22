package dev.ziran.android.protocol

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

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
            val text = response.body.string()
            val obj = json.parseToJsonElement(text).jsonObject
            if (!response.isSuccessful) throw AdapterRequestError(parseError(obj))
            buildPayload(obj)
        }
    }

    /**
     * Unauthenticated `GET {base}/health` probe for the Start screen.
     * Uses the same URL normalization rules as pairing and cancels the HTTP call
     * immediately when the coroutine is cancelled.
     */
    suspend fun probeHealth(baseUrl: String, http: OkHttpClient): HealthProbeResult {
        val normalized = try {
            dev.ziran.android.connection.ServerUrls.normalize(baseUrl)
        } catch (e: IllegalArgumentException) {
            return HealthProbeResult.Unreachable(e.message)
        }
        val probeClient = http.newBuilder()
            .callTimeout(4, TimeUnit.SECONDS)
            .build()
        val request = Request.Builder()
            .url("$normalized/health")
            .get()
            .build()
        return suspendCancellableCoroutine { cont ->
            val call = probeClient.newCall(request)
            cont.invokeOnCancellation { call.cancel() }
            call.enqueue(
                object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        if (cont.isActive) cont.resume(HealthProbeResult.Unreachable(e.message))
                    }

                    override fun onResponse(call: Call, response: Response) {
                        response.use {
                            if (!cont.isActive) return
                            if (!response.isSuccessful) {
                                cont.resume(HealthProbeResult.Unreachable("HTTP ${response.code}"))
                                return
                            }
                            try {
                                val obj = json.parseToJsonElement(response.body.string()).jsonObject
                                val ok = obj["ok"]?.jsonPrimitive?.booleanOrNull ?: true
                                if (!ok) {
                                    cont.resume(HealthProbeResult.Unreachable())
                                    return
                                }
                                val adapterVersion = obj["adapter_version"]?.jsonPrimitive?.contentOrNull ?: "unknown"
                                val protocolVersion = obj["protocol_version"]?.jsonPrimitive?.intOrNull ?: 0
                                val minProtocol = obj["min_protocol_version"]?.jsonPrimitive?.intOrNull ?: protocolVersion
                                val jcodeConnected = obj["jcode_connected"]?.jsonPrimitive?.booleanOrNull ?: false
                                val compatible = protocolVersion >= MIN_PROTOCOL_VERSION && minProtocol <= PROTOCOL_VERSION
                                cont.resume(
                                    HealthProbeResult.Reachable(
                                        adapterVersion = adapterVersion,
                                        protocolVersion = protocolVersion,
                                        minProtocolVersion = minProtocol,
                                        jcodeConnected = jcodeConnected,
                                        compatible = compatible,
                                    ),
                                )
                            } catch (_: Exception) {
                                cont.resume(HealthProbeResult.Unreachable())
                            }
                        }
                    }
                },
            )
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

sealed interface HealthProbeResult {
    data object Idle : HealthProbeResult
    data object Probing : HealthProbeResult
    data class Reachable(
        val adapterVersion: String,
        val protocolVersion: Int,
        val minProtocolVersion: Int,
        val jcodeConnected: Boolean,
        val compatible: Boolean,
    ) : HealthProbeResult
    data class Unreachable(val reason: String? = null) : HealthProbeResult
}
