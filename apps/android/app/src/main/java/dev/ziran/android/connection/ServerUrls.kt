package dev.ziran.android.connection

import kotlinx.serialization.json.JsonObject

/**
 * Hosts for pairing. Mirrors adapter.ts normalizeServerUrl / isLoopbackHost.
 */
object ServerUrls {
    fun isLoopbackHost(value: String): Boolean {
        val host = value.replaceFirst(Regex("^https?://"), "").split('/')[0].split(':')[0].trim('[', ']')
        return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "10.0.2.2" || host.endsWith(".localhost")
    }

    fun normalize(input: String): String {
        var value = input.trim()
        if (value.isEmpty()) throw IllegalArgumentException("Enter the adapter address.")
        if (!value.startsWith("http://", ignoreCase = true) && !value.startsWith("https://", ignoreCase = true)) {
            val bareHost = value.substringBefore('/').substringBefore(':')
            value = (if (isLoopbackHost(bareHost)) "http" else "https") + "://" + value
        }
        val url = java.net.URI(value)
        if (url.scheme != "http" && url.scheme != "https") throw IllegalArgumentException("Invalid server address.")
        if (url.scheme == "http" && !isLoopbackHost(url.host ?: "")) {
            throw IllegalArgumentException("Remote pairing requires a trusted HTTPS address.")
        }
        val authority = buildString {
            append(url.host ?: throw IllegalArgumentException("Invalid server address."))
            if (url.port != -1) append(":" + url.port)
        }
        return url.scheme + "://" + authority
    }

    fun wsUrl(baseUrl: String): String {
        val url = java.net.URI(normalize(baseUrl))
        val ws = if (url.scheme == "https") "wss" else "ws"
        val port = if (url.port != -1) url.port else if (ws == "wss") 443 else 80
        return "${ws}://${url.host}:$port/v2/ws"
    }
}

data class PairResult(val token: String, val deviceId: String, val deviceName: String, val serverId: String, val serverName: String) {
    companion object {
        fun fromPayload(p: JsonObject): PairResult? {
            val token = p["token"]?.let { it.toString().trim('"') } ?: return null
            val device = p["device"] as? JsonObject ?: return null
            val server = p["server"] as? JsonObject ?: return null
            return PairResult(
                token = token,
                deviceId = device["device_id"]?.toString()?.trim('"') ?: "",
                deviceName = device["name"]?.toString()?.trim('"') ?: "",
                serverId = server["server_id"]?.toString()?.trim('"') ?: "",
                serverName = server["name"]?.toString()?.trim('"') ?: "",
            )
        }
    }
}
