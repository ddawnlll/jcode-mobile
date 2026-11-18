package dev.ziran.android.protocol

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.LinkedHashMap

/**
 * Pairing links, validating exactly as apps/stillness pairingPayload.ts.
 * Form: jcode://pair?v=2&url=...&code=XXXX-XXXX-XXXX[&name][&expires]
 * Codes use the Crockford-like alphabet without I, L, O, 0, 1.
 * Remote servers must be https; http only for loopback.
 */
object PairingPayload {
    data class Payload(val server: String, val code: String, val name: String? = null)

    private val codePattern = Regex("^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$")
    private val allowed = setOf("v", "url", "code", "name", "expires")

    fun parse(value: String, nowMs: Long = System.currentTimeMillis()): Payload {
        val raw = value.trim()
        if (raw.isEmpty()) throw IllegalArgumentException("This is not a valid pairing link.")
        val uri = try {
            URI(raw)
        } catch (_: Exception) {
            throw IllegalArgumentException("This is not a valid pairing link.")
        }
        // pairingPayload.ts: scheme jcode:, host pair, no port/user/password, empty path, no hash.
        if (uri.scheme != "jcode" || uri.host != "pair" || uri.port != -1 ||
            !uri.userInfo.isNullOrEmpty() || uri.fragment != null || (uri.path != "" && uri.path != null && uri.path != "/")
        ) {
            throw IllegalArgumentException("This is not a supported JCode pairing link.")
        }
        val params = parseQuery(uri.rawQuery)
        for ((key, values) in params) {
            if (key !in allowed || values.size != 1) {
                throw IllegalArgumentException("This pairing link has invalid fields.")
            }
        }
        if (params["v"]?.firstOrNull() != "2") {
            throw IllegalArgumentException("This pairing link uses an unsupported version.")
        }
        val code = params["code"]?.firstOrNull() ?: ""
        if (!codePattern.matches(code)) {
            throw IllegalArgumentException("This pairing link has an invalid code.")
        }
        val expires = params["expires"]?.firstOrNull()
        if (expires != null) {
            if (expires.length > 16 || expires.any { !it.isDigit() }) {
                throw IllegalArgumentException("This pairing link has an invalid expiry.")
            }
            val exp = expires.toLongOrNull()
                ?: throw IllegalArgumentException("This pairing link has an invalid expiry.")
            if (exp <= nowMs) throw IllegalArgumentException("This pairing link has expired.")
        }
        val serverRaw = params["url"]?.firstOrNull() ?: ""
        val server = normalizeServerUrl(serverRaw) // throws on invalid
        val host = server.host?.lowercase() ?: throw IllegalArgumentException("This pairing link has an invalid server address.")
        val loopback = isLoopbackHost(host)
        if (server.scheme == "http" && !loopback) {
            throw IllegalArgumentException("Remote pairing requires a trusted HTTPS address.")
        }
        return Payload(server = server.toString().trimEnd('/'), code = code, name = params["name"]?.firstOrNull())
    }

    private fun parseQuery(query: String?): LinkedHashMap<String, MutableList<String>> {
        val map = LinkedHashMap<String, MutableList<String>>()
        if (query.isNullOrEmpty()) return map
        for (pair in query.split('&')) {
            if (pair.isEmpty()) continue
            val eq = pair.indexOf('=')
            val k = urlDecode(if (eq >= 0) pair.substring(0, eq) else pair)
            val v = urlDecode(if (eq >= 0) pair.substring(eq + 1) else "")
            map.getOrPut(k) { mutableListOf() }.add(v)
        }
        return map
    }

    private fun urlDecode(s: String): String =
        try { URLDecoder.decode(s, "UTF-8") } catch (_: Exception) { s }

    fun buildLink(server: String, code: String, name: String? = null): String {
        val base = "jcode://pair?v=2&url=" + URLEncoder.encode(server, "UTF-8") + "&code=" + URLEncoder.encode(code, "UTF-8")
        return if (name != null) base + "&name=" + URLEncoder.encode(name, "UTF-8") else base
    }
}

/** True for loopback hosts: localhost, 127.0.0.1, ::1, *.localhost. */
fun isLoopbackHost(host: String?): Boolean {
    if (host.isNullOrEmpty()) return false
    val h = host.lowercase().trim('[', ']')
    // 10.0.2.2 is the Android emulator's alias for the host loopback interface.
    return h == "localhost" || h == "127.0.0.1" || h == "::1" ||
        h == "10.0.2.2" || h.endsWith(".localhost")
}

/**
 * Normalize a pasted server address to its origin. Bare hosts get https, loopback
 * gets http. A pasted app URL is accepted and reduced to its origin.
 */
fun normalizeServerUrl(input: String): URI {
    var value = input.trim()
    if (value.isEmpty()) throw IllegalArgumentException("Enter the adapter address.")
    if (!value.startsWith("http://", ignoreCase = true) && !value.startsWith("https://", ignoreCase = true)) {
        val bareHost = value.substringBefore('/').substringBefore(':')
        value = (if (isLoopbackHost(bareHost)) "http" else "https") + "://" + value
    }
    val url = try {
        URI(value)
    } catch (_: Exception) {
        throw IllegalArgumentException("This pairing link has an invalid server address.")
    }
    if (url.scheme != "http" && url.scheme != "https") {
        throw IllegalArgumentException("This pairing link has an invalid server address.")
    }
    if (!url.userInfo.isNullOrEmpty()) {
        throw IllegalArgumentException("This pairing link has an invalid server address.")
    }
    if (url.scheme == "http" && !isLoopbackHost(url.host)) {
        throw IllegalArgumentException("Remote pairing requires a trusted HTTPS address.")
    }
    if ((url.path != null && url.path != "" && url.path != "/") || !url.query.isNullOrEmpty() || url.fragment != null) {
        throw IllegalArgumentException("This pairing link has an invalid server address.")
    }
    // Rebuild origin only.
    val port = url.port
    val authority = if (port != -1 && !((url.scheme == "https" && port == 443) || (url.scheme == "http" && port == 80))) {
        url.host + ":" + port
    } else {
        url.host ?: throw IllegalArgumentException("This pairing link has an invalid server address.")
    }
    return URI.create(url.scheme + "://" + authority)
}

fun wsUrlFor(baseUrl: String): String {
    val url = URI(baseUrl)
    val wsScheme = if (url.scheme == "https") "wss" else "ws"
    return "$wsScheme://${url.host}:${if (url.port != -1) url.port else if (wsScheme == "wss") 443 else 80}/v2/ws"
}

fun hexUuid(prefix: String): String = prefix + "_" + java.util.UUID.randomUUID().toString()
