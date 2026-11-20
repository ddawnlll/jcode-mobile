package dev.ziran.android.connection

import dev.ziran.android.BuildConfig
import kotlinx.serialization.json.JsonObject

/**
 * The one URL normalizer for pairing and for the socket. Mirrors
 * adapter.ts normalizeServerUrl / isLoopbackHost.
 *
 * Cleartext is a local-development affordance, never a release one:
 * - always: localhost, 127.0.0.1, ::1 (and *.localhost)
 * - debug builds only: 10.0.2.2, the Android emulator alias for the host
 *   loopback interface
 *
 * The release network security config refuses cleartext to 10.0.2.2 as well, so
 * a release build cannot fall back to it even if a caller asked.
 */
object ServerUrls {

    fun isLoopbackHost(value: String, debug: Boolean = BuildConfig.DEBUG): Boolean {
        val authority = value.replaceFirst(Regex("^[a-zA-Z]+://"), "").split('/')[0]
        // Bracketed IPv6 keeps its colons; a bare address with more than one
        // colon is IPv6 too, so only split a host:port pair once.
        val host = when {
            authority.startsWith("[") -> authority.substringAfter('[').substringBefore(']')
            authority.count { it == ':' } > 1 -> authority
            else -> authority.substringBefore(':')
        }.lowercase()
        if (host == "localhost" || host == "127.0.0.1" || host == "::1") return true
        if (host.endsWith(".localhost")) return true
        return debug && host == "10.0.2.2"
    }

    /** Reduce any accepted address to its origin, or explain why it is refused. */
    fun normalize(input: String, debug: Boolean = BuildConfig.DEBUG): String {
        var value = input.trim()
        if (value.isEmpty()) throw IllegalArgumentException("Enter the adapter address.")
        if (!value.startsWith("http://", ignoreCase = true) && !value.startsWith("https://", ignoreCase = true)) {
            val bareHost = value.substringBefore('/').substringBefore(':')
            value = (if (isLoopbackHost(bareHost, debug)) "http" else "https") + "://" + value
        }
        val url = try {
            java.net.URI(value)
        } catch (_: Exception) {
            throw IllegalArgumentException("This pairing link has an invalid server address.")
        }
        if (url.scheme != "http" && url.scheme != "https") {
            throw IllegalArgumentException("This pairing link has an invalid server address.")
        }
        if (!url.userInfo.isNullOrEmpty()) {
            throw IllegalArgumentException("This pairing link has an invalid server address.")
        }
        if (url.scheme == "http" && !isLoopbackHost(url.host ?: "", debug)) {
            throw IllegalArgumentException("Remote pairing requires a trusted HTTPS address.")
        }
        if (url.fragment != null) {
            throw IllegalArgumentException("This pairing link has an invalid server address.")
        }
        val port = url.port
        val authority = if (port != -1 && !((url.scheme == "https" && port == 443) || (url.scheme == "http" && port == 80))) {
            url.host + ":" + port
        } else {
            url.host ?: throw IllegalArgumentException("This pairing link has an invalid server address.")
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

data class PairResult(
    val token: String,
    val deviceId: String,
    val deviceName: String,
    val serverId: String,
    val serverName: String,
) {
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
