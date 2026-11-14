package dev.jcode.stillness.native

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Device push registration state.
 *
 * There is no Firebase project in this build and no `google-services.json`, so
 * the honest capability is `not_configured`. The store still accepts a token
 * from a pluggable relay so a future transport can be wired without changing the
 * JavaScript surface, but registering a token is never reported as proven
 * delivery.
 *
 * The relay contract is a documented broadcast:
 *
 *   action  dev.jcode.stillness.PUSH_RELAY
 *   extras  token (must match the stored device token)
 *           kind  turn_complete | turn_failed | approval_needed | test
 *           title, body, sessionId, turnId
 *
 * An FCM `onMessageReceived` (or any messaging service) can translate its
 * payload into this broadcast on the same process. The receiver is not exported,
 * so another app cannot post notifications through it.
 */
object PushRegistration {
    const val PREFS = "jcode_push_registration"
    private const val KEY_TOKEN = "token"
    private const val KEY_REGISTERED_AT = "registeredAt"

    const val ACTION_RELAY_PUSH = "dev.jcode.stillness.PUSH_RELAY"
    const val EXTRA_TOKEN = "token"

    private const val NOT_CONFIGURED_REASON =
        "No Firebase project is configured for this build (no google-services.json, " +
            "no FCM credentials). A relay token can be stored, but delivery is not verified."

    data class PushStatusData(
        val state: String,
        val token: String?,
        val registeredAt: Long?,
        val transport: String,
        val reason: String,
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun token(context: Context): String? =
        prefs(context).getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() }

    fun status(context: Context): PushStatusData {
        val stored = prefs(context)
        return PushStatusData(
            state = "not_configured",
            token = stored.getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() },
            registeredAt = if (stored.contains(KEY_REGISTERED_AT)) {
                stored.getLong(KEY_REGISTERED_AT, 0L)
            } else {
                null
            },
            transport = "relay_broadcast",
            reason = NOT_CONFIGURED_REASON,
        )
    }

    fun registerLocal(context: Context, token: String): PushStatusData {
        require(token.isNotBlank()) { "push token must not be blank" }
        require(token.length <= 4096) { "push token is unreasonably long" }
        prefs(context).edit()
            .putString(KEY_TOKEN, token)
            .putLong(KEY_REGISTERED_AT, System.currentTimeMillis() / 1000L)
            .apply()
        return status(context)
    }
}

/**
 * Non-exported relay endpoint.
 *
 * Keeping this a plain `BroadcastReceiver` avoids compiling against the Firebase
 * SDK without credentials, which would either crash at startup or silently
 * never receive anything.
 */
class PushRelayReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != PushRegistration.ACTION_RELAY_PUSH) return
        val expected = PushRegistration.token(context)
        val provided = intent.getStringExtra(PushRegistration.EXTRA_TOKEN)
        if (expected == null) {
            Log.w(TAG, "push relay ignored: no registered device token")
            return
        }
        if (provided != expected) {
            Log.w(TAG, "push relay ignored: token mismatch")
            return
        }
        val posted = Notifications.post(
            context,
            Notifications.PostRequest(
                kind = intent.getStringExtra("kind"),
                title = intent.getStringExtra("title"),
                body = intent.getStringExtra("body"),
                sessionId = intent.getStringExtra("sessionId"),
                turnId = intent.getStringExtra("turnId"),
            ),
        )
        if (!posted.posted) {
            Log.w(TAG, "push relay could not post: ${posted.error}")
        }
    }

    private companion object {
        const val TAG = "JCodePushRelay"
    }
}
