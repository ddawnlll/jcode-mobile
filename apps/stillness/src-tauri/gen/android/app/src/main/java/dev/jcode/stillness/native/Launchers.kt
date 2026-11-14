package dev.jcode.stillness.native

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log
import dev.jcode.stillness.MainActivity
import dev.jcode.stillness.R

/**
 * Dynamic shortcuts, the home widget, and the Quick Settings tile.
 *
 * All three entry points use the same `jcode-mobile://` deep link, so a tap lands
 * on the exact destination or on the honest recovery path when the session no
 * longer exists.
 */
object AppShortcuts {
    const val ID_NEW_SESSION = "new-session"
    const val ID_RECENT_SESSION = "recent-session"

    data class ShortcutsResultData(
        val count: Int,
        val ids: List<String>,
        val widget: Boolean,
        val error: String?,
    )

    private fun deepLink(context: Context, uri: Uri): Intent =
        Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = uri
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

    fun refresh(
        context: Context,
        recentSessionId: String?,
        recentSessionLabel: String?,
    ): ShortcutsResultData {
        val widgetUpdated = StillnessWidgetProvider.refresh(context)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) {
            return ShortcutsResultData(0, emptyList(), widgetUpdated, "shortcuts_require_api_25")
        }
        val manager = context.getSystemService(android.content.pm.ShortcutManager::class.java)
            ?: return ShortcutsResultData(0, emptyList(), widgetUpdated, "shortcut_manager_missing")
        val icon = Icon.createWithResource(context, R.drawable.ic_stat_jcode)
        val shortcuts = mutableListOf<android.content.pm.ShortcutInfo>()
        shortcuts += android.content.pm.ShortcutInfo.Builder(context, ID_NEW_SESSION)
            .setShortLabel("New session")
            .setLongLabel("Start a new JCode session")
            .setIcon(icon)
            .setIntent(deepLink(context, Notifications.deepLinkForSession(null)))
            .build()
        val recent = recentSessionId?.trim()
        if (!recent.isNullOrEmpty()) {
            val label = recentSessionLabel?.trim()?.takeIf { it.isNotEmpty() } ?: "Recent session"
            shortcuts += android.content.pm.ShortcutInfo.Builder(context, ID_RECENT_SESSION)
                .setShortLabel(label.take(24))
                .setLongLabel(label.take(64))
                .setIcon(icon)
                .setIntent(deepLink(context, Notifications.deepLinkForSession(recent)))
                .build()
        }
        val limited = shortcuts.take(manager.maxShortcutCountPerActivity.coerceAtLeast(1))
        return try {
            val accepted = manager.setDynamicShortcuts(limited)
            if (!accepted) {
                ShortcutsResultData(
                    manager.dynamicShortcuts.size,
                    manager.dynamicShortcuts.map { it.id },
                    widgetUpdated,
                    "rate_limited",
                )
            } else {
                ShortcutsResultData(
                    limited.size,
                    limited.map { it.id },
                    widgetUpdated,
                    null,
                )
            }
        } catch (error: Exception) {
            Log.w(TAG, "could not publish dynamic shortcuts", error)
            ShortcutsResultData(0, emptyList(), widgetUpdated, error.message ?: "shortcut_failure")
        }
    }

    private const val TAG = "JCodeShortcuts"
}

class StillnessWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (id in appWidgetIds) {
            appWidgetManager.updateAppWidget(id, buildViews(context))
        }
    }

    companion object {
        private const val REQUEST_NEW_SESSION = 4_242

        fun refresh(context: Context): Boolean {
            val manager = AppWidgetManager.getInstance(context.applicationContext) ?: return false
            val component = ComponentName(context.applicationContext, StillnessWidgetProvider::class.java)
            val ids = manager.getAppWidgetIds(component)
            if (ids.isEmpty()) return false
            for (id in ids) {
                manager.updateAppWidget(id, buildViews(context))
            }
            return true
        }

        private fun buildViews(context: Context): android.widget.RemoteViews {
            val views = android.widget.RemoteViews(
                context.packageName,
                R.layout.widget_stillness,
            )
            val intent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Notifications.deepLinkForSession(null)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                context,
                REQUEST_NEW_SESSION,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, pending)
            views.setTextViewText(R.id.widget_title, "JCode")
            views.setTextViewText(R.id.widget_action, "New session")
            return views
        }
    }
}

class NewSessionTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            label = "New session"
            state = Tile.STATE_INACTIVE
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        if (isLocked) {
            unlockAndRun { launchNewSession() }
        } else {
            launchNewSession()
        }
    }

    private fun launchNewSession() {
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Notifications.deepLinkForSession(null)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                val pending = PendingIntent.getActivity(
                    this,
                    0,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                startActivityAndCollapse(pending)
            } else {
                @Suppress("DEPRECATION")
                startActivityAndCollapse(intent)
            }
        } catch (error: Exception) {
            Log.w("JCodeTile", "could not launch a new session from the tile", error)
        }
    }
}
