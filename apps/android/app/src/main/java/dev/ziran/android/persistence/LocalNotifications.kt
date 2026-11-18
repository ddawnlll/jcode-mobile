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

    /** Post if backgrounded and permitted. Returns true when posted. */
    fun postIfBackgrounded(context: Context, channel: String, sessionId: String, title: String, body: String): Boolean {
        if (!isBackgrounded(context)) return false
        if (!hasPermission(context)) return false
        ensureChannels(context)
        val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("ziran://session/$sessionId"))
        intent.setPackage(context.packageName)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        val pending = PendingIntent.getActivity(context, sessionId.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify((sessionId.hashCode() and 0x7fffffff), notification)
        return true
    }
}
