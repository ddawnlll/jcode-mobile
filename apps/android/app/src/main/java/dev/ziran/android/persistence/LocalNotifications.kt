package dev.ziran.android.persistence

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri

/**
 * Local notifications only, posted when the app is backgrounded for turn-done
 * and permission requests. Nothing claims remote delivery. Channels mirror
 * docs/ANDROID_NATIVE.md: turn complete, turn failures, approval needed.
 */
object LocalNotifications {
    const val CHANNEL_TURNS = "turns_complete"
    const val CHANNEL_FAILURES = "turn_failures"
    const val CHANNEL_APPROVAL = "approval_needed"

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(CHANNEL_TURNS, "Turn complete", NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CHANNEL_FAILURES, "Turn failures", NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(CHANNEL_APPROVAL, "Approval needed", NotificationManager.IMPORTANCE_HIGH),
            ),
        )
    }

    fun isBackgrounded(context: Context): Boolean {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val processes = manager.runningAppProcesses ?: return false
        val info = processes.firstOrNull { it.processName == context.packageName } ?: return false
        return info.importance > ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    fun hasPermission(context: Context): Boolean {
        if (android.os.Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    fun requestPermission(activity: android.app.Activity) {
        if (android.os.Build.VERSION.SDK_INT < 33) return
        ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
    }

    /** Post if permitted (and backgrounded when [onlyWhenClosed] is true). Returns true when posted. */
    fun postIfBackgrounded(
        context: Context,
        channel: String,
        sessionId: String,
        title: String,
        body: String,
        onlyWhenClosed: Boolean = true,
        serverId: String? = null,
        notificationKey: String? = null,
    ): Boolean {
        if (onlyWhenClosed && !isBackgrounded(context)) return false
        if (!hasPermission(context)) return false
        ensureChannels(context)
        val deepLinkUri = if (!serverId.isNullOrBlank()) {
            "ziran://session/$sessionId?server=${android.net.Uri.encode(serverId)}".toUri()
        } else {
            "ziran://session/$sessionId".toUri()
        }
        val intent = Intent(Intent.ACTION_VIEW, deepLinkUri)
        intent.setPackage(context.packageName)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        val notifId = ((notificationKey ?: "${serverId.orEmpty()}|$sessionId|$channel").hashCode() and 0x7fffffff)
        val pending = PendingIntent.getActivity(context, notifId, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setColor(0xFF2E4374.toInt())
            .setContentTitle(title)
            .setContentText(body)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(notifId, notification)
        return true
    }
}
