package dev.ziran.android.ui

import dev.ziran.android.protocol.PairingPayload

/**
 * Deep links: ziran://pair?... and jcode://pair??. Pairing links are validated
 * exactly as pairingPayload.ts; session links open an existing session.
 */
object DeepLinks {
    sealed interface Route {
        data class Pair(val server: String, val code: String) : Route
        data class Session(val sessionId: String, val serverId: String? = null) : Route
        object Unknown : Route
    }

    fun parse(uriString: String?): Route {
        val raw = uriString?.trim() ?: return Route.Unknown
        val uri = try { java.net.URI(raw) } catch (_: Exception) { return Route.Unknown }
        if (uri.host == "pair" && (uri.scheme == "ziran" || uri.scheme == "jcode")) {
            return try {
                // Both schemes are accepted; the payload validator speaks jcode://.
                val canonical = if (uri.scheme == "ziran") "jcode:" + raw.substringAfter(":") else raw
                val payload = PairingPayload.parse(canonical)
                Route.Pair(payload.server, payload.code)
            } catch (_: Exception) {
                Route.Unknown
            }
        }
        if (uri.host == "session" && (uri.scheme == "ziran" || uri.scheme == "jcode")) {
            val id = uri.path?.trim('/')?.ifEmpty { null } ?: return Route.Unknown
            val serverId = uri.rawQuery
                ?.split('&')
                ?.firstOrNull { it.startsWith("server=") }
                ?.substringAfter("server=")
                ?.let { runCatching { java.net.URLDecoder.decode(it, "UTF-8") }.getOrNull() }
                ?.ifBlank { null }
            return Route.Session(id, serverId)
        }
        return Route.Unknown
    }
}
