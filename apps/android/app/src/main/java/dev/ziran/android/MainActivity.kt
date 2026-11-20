package dev.ziran.android

import android.Manifest
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import dev.ziran.android.persistence.LocalNotifications
import dev.ziran.android.ui.ZiranApp

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
        // ride the keyboard instead of hiding behind it.
        enableEdgeToEdge()
        readIntent(intent)
        val controller = (application as ZiranApplication).controller
        setContent {
            ZiranApp(
                controller = controller,
                // Compose state reads: a new intent recomposes and re-runs the
                // deep link effect, even for the same link string.
                deepLink = deepLink.value,
                deepLinkNonce = deepLinkSeq.value,
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

    private fun readIntent(intent: Intent?) {
        val data = intent?.data?.toString() ?: return
        deepLink.value = data
        deepLinkSeq.value = deepLinkSeq.value + 1
    }
}
