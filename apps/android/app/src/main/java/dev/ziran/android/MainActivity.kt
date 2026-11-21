package dev.ziran.android

import android.Manifest
import android.content.Intent
import android.graphics.Color as AndroidColor
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import dev.ziran.android.persistence.LocalNotifications
import dev.ziran.android.ui.ZiranApp

internal data class DisplayModeCandidate(
    val modeId: Int,
    val width: Int,
    val height: Int,
    val refreshRate: Float,
)

/**
 * Pick the highest refresh-rate display mode matching the active physical
 * resolution so 90/120/144 Hz phones render at full native frame rate without
 * changing screen resolution.
 */
internal fun selectPeakRefreshMode(
    modes: List<DisplayModeCandidate>,
    currentWidth: Int,
    currentHeight: Int,
): DisplayModeCandidate? {
    val sameRes = modes.filter { it.width == currentWidth && it.height == currentHeight }
    return (if (sameRes.isNotEmpty()) sameRes else modes).maxByOrNull { it.refreshRate }
}

/**
 * One Activity, `singleTask`, so a pairing link that arrives while the app is
 * running reaches onNewIntent instead of starting a second task.
 *
 * The controller lives in [ZiranApplication]; this class only renders it and
 * forwards intents. It never owns a turn, and onDestroy does not close anything.
 */
@android.annotation.SuppressLint("InlinedApi")
class MainActivity : ComponentActivity() {

    /** Bumped on every intent so an identical link still re-runs the effect. */
    private var deepLinkSeq = mutableStateOf(0)
    private var deepLink = mutableStateOf<String?>(null)

    // The permission constant is inlined from API 33; the launch is guarded
    // by hasPermission(), which checks the SDK level first.
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        // Either answer is final for this install: the prompt is not shown again.
        (application as? ZiranApplication)?.controller?.notificationsHandled(granted)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Edge to edge so WindowInsets.ime reaches Compose and the composer can
        // ride the keyboard frame by frame instead of hiding behind it.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT),
        )
        requestHighestRefreshRate()
        readIntent(intent)
        val controller = (application as ZiranApplication).controller
        setContent {
            ZiranApp(
                controller = controller,
                deepLink = deepLink.value,
                deepLinkNonce = deepLinkSeq.value,
                onThemeNightChanged = { isNight ->
                    val style = if (isNight) {
                        SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                    } else {
                        SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                    }
                    enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                },
                onRequestNotifications = {
                    if (LocalNotifications.hasPermission(this)) {
                        controller.notificationsHandled(true)
                    } else {
                        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readIntent(intent)
    }

    private fun requestHighestRefreshRate() {
        val activeDisplay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            display
        } else {
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay
        } ?: return
        val current = activeDisplay.mode
        val candidates = activeDisplay.supportedModes.map {
            DisplayModeCandidate(it.modeId, it.physicalWidth, it.physicalHeight, it.refreshRate)
        }
        val best = selectPeakRefreshMode(candidates, current.physicalWidth, current.physicalHeight) ?: return
        window.attributes = window.attributes.apply {
            preferredDisplayModeId = best.modeId
            preferredRefreshRate = best.refreshRate
        }
    }

    private fun readIntent(intent: Intent?) {
        val data = intent?.data?.toString() ?: return
        deepLink.value = data
        deepLinkSeq.value = deepLinkSeq.value + 1
    }
}
