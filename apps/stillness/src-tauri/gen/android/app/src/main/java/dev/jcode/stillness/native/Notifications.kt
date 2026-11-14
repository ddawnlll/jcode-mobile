package dev.jcode.stillness.native

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import dev.jcode.stillness.MainActivity
import dev.jcode.stillness.R

/**
 * Local notification channels, permission state, and deep-linked taps.
 *
 * This is a real NotificationManager integration. Delivery to the device is
 * local: the daemon runs on the VPS and this app posts when the client observes
 * a turn finish, a failure, or an approval request. Nothing here claims remote
 * push delivery.
 */
object Notifications {
    const val CHANNEL_TURNS = "turns_complete"
    const val CHANNEL_FAILURES = "turn_failures"
    const val CHANNEL_APPROVALS = "approval_needed"
    const val GROUP = "dev.jcode.stillness.turns"
    const val SUMMARY_ID = 9_001

    const val DEEP_LINK_SCHEME = "jcode-mobile"
    const val DEEP_LINK_HOST_SESSION = "session"
    const val DEEP_LINK_HOST_NEW_SESSION = "new-session"

    private const val PERMISSION_PREFS = "jcode_notification_permission"
    private const val KEY_ASKED = "asked"

    enum class Kind(
        val wire: String,
        val channelId: String,
        val channelName: String,
        val channelDescription: String,
        val importance: Int,
        val priority: Int,
        val defaultTitle: String,
    ) {
        TURN_COMPLETE(
            "turn_complete",
            CHANNEL_TURNS,
            "Turn complete",
            "A turn finished without an error.",
            NotificationManager.IMPORTANCE_DEFAULT,
            NotificationCompat.PRIORITY_DEFAULT,
            "Turn complete",
        ),
        TURN_FAILED(
            "turn_failed",
            CHANNEL_FAILURES,
            "Turn failures",
            "A turn failed or the adapter reported an error.",
            NotificationManager.IMPORTANCE_HIGH,
            NotificationCompat.PRIORITY_HIGH,
            "Turn failed",
        ),
        APPROVAL_NEEDED(
            "approval_needed",
            CHANNEL_APPROVALS,
            "Approval needed",
            "A tool call is waiting for your approval.",
            NotificationManager.IMPORTANCE_HIGH,
            NotificationCompat.PRIORITY_HIGH,
            "Approval needed",
        ),
        TEST(
            "test",
            CHANNEL_TURNS,
            "Turn complete",
            "A turn finished without an error.",
            NotificationManager.IMPORTANCE_DEFAULT,
            NotificationCompat.PRIORITY_DEFAULT,
            "Test notification",
        );

        companion object {
            fun from(wire: String?): Kind =
                entries.firstOrNull { it.wire == wire } ?: TURN_COMPLETE
        }
    }

    data class ChannelStatus(
        val id: String,
        val name: String,
        val importance: Int,
        val enabled: Boolean,
    )

    data class NotificationStatusData(
        val permission: String,
        val notificationsEnabled: Boolean,
        val channels: List<ChannelStatus>,
        val group: String,
    )

    data class PostRequest(
        val kind: String?,
        val title: String?,
        val body: String?,
        val sessionId: String?,
        val turnId: String?,
    )

    data class NotificationPostedData(
        val posted: Boolean,
        val id: Int?,
        val channel: String?,
        val error: String?,
    )

    private fun prefs(context: Context) =
        context.getSharedPreferences(PERMISSION_PREFS, Context.MODE_PRIVATE)

    fun markPermissionAsked(context: Context) {
        prefs(context).edit().putBoolean(KEY_ASKED, true).apply()
    }

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        for (kind in Kind.entries) {
            if (manager.getNotificationChannel(kind.channelId) != null) continue
            val channel = NotificationChannel(kind.channelId, kind.channelName, kind.importance)
            channel.description = kind.channelDescription
            channel.enableVibration(kind.importance >= NotificationManager.IMPORTANCE_HIGH)
            channel.setShowBadge(true)
            manager.createNotificationChannel(channel)
        }
    }

    fun permissionState(context: Context): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (granted) return "granted"
            val asked = prefs(context).getBoolean(KEY_ASKED, false)
            return if (asked) "denied" else "prompt"
        }
        return if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            "granted"
        } else {
            "denied"
        }
    }

    fun status(context: Context): NotificationStatusData {
        ensureChannels(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        val channels = Kind.entries.distinctBy { it.channelId }.map { kind ->
            val channel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager?.getNotificationChannel(kind.channelId)
            } else {
                null
            }
            ChannelStatus(
                id = kind.channelId,
                name = kind.channelName,
                importance = channel?.importance ?: kind.importance,
                enabled = channel?.importance != NotificationManager.IMPORTANCE_NONE,
            )
        }
        return NotificationStatusData(
            permission = permissionState(context),
            notificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled(),
            channels = channels,
            group = GROUP,
        )
    }

    fun deepLinkForSession(sessionId: String?): Uri {
        val trimmed = sessionId?.trim()
        return if (trimmed.isNullOrEmpty()) {
            Uri.parse("$DEEP_LINK_SCHEME://$DEEP_LINK_HOST_NEW_SESSION")
        } else {
            Uri.parse("$DEEP_LINK_SCHEME://$DEEP_LINK_HOST_SESSION/${Uri.encode(trimmed)}")
        }
    }

    fun tapIntent(context: Context, sessionId: String?): Intent {
        val intent = Intent(context, MainActivity::class.java)
        intent.action = Intent.ACTION_VIEW
        intent.data = deepLinkForSession(sessionId)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_SINGLE_TOP or
            Intent.FLAG_ACTIVITY_CLEAR_TOP
        return intent
    }

    fun post(context: Context, request: PostRequest): NotificationPostedData {
        ensureChannels(context)
        if (!NativeSettings.getBoolean(context, NativeSettings.KEY_NOTIFICATIONS_ENABLED)) {
            return NotificationPostedData(false, null, null, "notifications_disabled")
        }
        if (permissionState(context) != "granted") {
            return NotificationPostedData(false, null, null, "permission_denied")
        }
        val kind = Kind.from(request.kind)
        val previews = NativeSettings.getBoolean(
            context,
            NativeSettings.KEY_NOTIFICATION_PREVIEWS,
        )
        val sessionKey = request.sessionId?.trim().orEmpty()
        val notificationId = stableId(sessionKey, kind)
        val title = request.title?.takeIf { it.isNotBlank() } ?: kind.defaultTitle
        val body = if (previews) {
            request.body?.takeIf { it.isNotBlank() }?.take(300)
                ?: "Open JCode to view the result."
        } else {
            "Open JCode to view the result."
        }
        val tap = PendingIntent.getActivity(
            context,
            notificationId,
            tapIntent(context, request.sessionId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(context, kind.channelId)
            .setSmallIcon(R.drawable.ic_stat_jcode)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(kind.priority)
            .setCategory(
                if (kind == Kind.APPROVAL_NEEDED) {
                    NotificationCompat.CATEGORY_REMINDER
                } else {
                    NotificationCompat.CATEGORY_STATUS
                },
            )
            .setGroup(GROUP)
            .setAutoCancel(true)
            .setContentIntent(tap)
        if (request.turnId != null) {
            builder.setWhen(System.currentTimeMillis())
        }
        val manager = NotificationManagerCompat.from(context)
        manager.notify(notificationId, builder.build())
        manager.notify(
            SUMMARY_ID,
            NotificationCompat.Builder(context, kind.channelId)
                .setSmallIcon(R.drawable.ic_stat_jcode)
                .setContentTitle("JCode")
                .setContentText("Session activity")
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setAutoCancel(true)
                .setContentIntent(tap)
                .build(),
        )
        return NotificationPostedData(true, notificationId, kind.channelId, null)
    }

    private fun stableId(sessionId: String, kind: Kind): Int {
        val base = if (sessionId.isEmpty()) 0 else sessionId.hashCode()
        return (base * 31 + kind.channelId.hashCode()) and 0x0FFF_FFFF
    }
}
