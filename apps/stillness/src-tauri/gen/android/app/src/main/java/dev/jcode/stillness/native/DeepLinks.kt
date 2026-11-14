package dev.jcode.stillness.native

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Deep-link intake and forwarding.
 *
 * The notification tap, dynamic shortcut, home widget, and Quick Settings tile
 * all route through one `jcode-mobile://` URL. The activity receives it, queues
 * it natively, and the client consumes it after it is ready to navigate. A
 * missing session is never replaced with a new one.
 */
object DeepLinks {
    private const val PREFS = "jcode_deep_links"
    private const val KEY_PENDING_URL = "pendingUrl"
    private const val KEY_PENDING_ACTION = "pendingAction"
    private const val KEY_PENDING_SESSION = "pendingSession"

    const val ACTION_OPEN_SESSION = "open_session"
    const val ACTION_NEW_SESSION = "new_session"
    const val ACTION_UNKNOWN = "unknown"

    data class PendingDeepLinkData(
        val url: String?,
        val action: String?,
        val sessionId: String?,
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Queue the intent's link when it is a JCode deep link. */
    fun capture(context: Context, intent: Intent?): Boolean {
        val data = intent?.data ?: return false
        if (!data.scheme.equals(Notifications.DEEP_LINK_SCHEME, ignoreCase = true)) return false
        val pending = parse(data)
        prefs(context).edit()
            .putString(KEY_PENDING_URL, data.toString())
            .putString(KEY_PENDING_ACTION, pending.action)
            .putString(KEY_PENDING_SESSION, pending.sessionId)
            .apply()
        NativeEvents.emit("deepLink", pending)
        return true
    }

    fun parse(uri: Uri): PendingDeepLinkData {
        val host = uri.host?.lowercase()
        return when (host) {
            Notifications.DEEP_LINK_HOST_NEW_SESSION -> PendingDeepLinkData(
                uri.toString(),
                ACTION_NEW_SESSION,
                null,
            )
            Notifications.DEEP_LINK_HOST_SESSION -> {
                val session = uri.pathSegments.firstOrNull()?.takeIf { it.isNotBlank() }
                if (session == null) {
                    PendingDeepLinkData(uri.toString(), ACTION_UNKNOWN, null)
                } else {
                    // Uri.pathSegments is already decoded; decoding again would
                    // corrupt ids containing percent escapes.
                    PendingDeepLinkData(uri.toString(), ACTION_OPEN_SESSION, session)
                }
            }
            else -> PendingDeepLinkData(uri.toString(), ACTION_UNKNOWN, null)
        }
    }

    fun peek(context: Context): PendingDeepLinkData {
        val stored = prefs(context)
        return PendingDeepLinkData(
            url = stored.getString(KEY_PENDING_URL, null),
            action = stored.getString(KEY_PENDING_ACTION, null),
            sessionId = stored.getString(KEY_PENDING_SESSION, null),
        )
    }

    fun consume(context: Context): PendingDeepLinkData {
        val pending = peek(context)
        prefs(context).edit()
            .remove(KEY_PENDING_URL)
            .remove(KEY_PENDING_ACTION)
            .remove(KEY_PENDING_SESSION)
            .apply()
        return pending
    }
}
