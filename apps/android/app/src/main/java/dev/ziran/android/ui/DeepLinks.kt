package dev.ziran.android.ui

import dev.ziran.android.protocol.PairingPayload

/**
 * Deep links: ziran://pair?... and jcode://pair??. Pairing links are validated
 * exactly as pairingPayload.ts; session links open an existing session.
 */
object DeepLinks {
    sealed interface Route {
        data class Pair(val server: String, val code: String) : Route
        data class Session(val sessionId: String) : Route
        object Unknown : Route
    }

    fun parse(uriString: String?): Route {
        val raw = uriString?.trim() ?: return Route.Unknown
        val uri = try { java.net.URI(raw) } catch (_: Exception) { return Route.Unknown }
        if (uri.host == "pair" && (uri.scheme == "ziran" || uri.scheme == "jcode")) {
            return try {
                val payload = PairingPayload.parse(raw)
                Route.Pair(payload.server, payload.code)
            } catch (_: Exception) {
                Route.Unknown
            }
        }
        if (uri.host == "session" && (uri.scheme == "ziran" || uri.scheme == "jcode")) {
            val id = uri.path?.trim('/')?.ifEmpty { null }
            return if (id != null) Route.Session(id) else Route.Unknown
        }
        return Route.Unknown
    }
}
