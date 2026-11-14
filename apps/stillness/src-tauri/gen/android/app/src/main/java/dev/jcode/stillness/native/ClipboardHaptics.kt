package dev.jcode.stillness.native

import android.app.Activity
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.Looper
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * Clipboard and haptics.
 *
 * Clipboard reads are privacy-safe: Android 10+ only returns clipboard data to a
 * focused app, and content flagged sensitive is redacted when the privacy setting
 * is on. Nothing is logged.
 *
 * Haptics use the platform HapticFeedbackConstants through the decor view, so the
 * system haptics setting and the app setting both apply.
 */
object ClipboardHaptics {
    data class ClipboardReadData(
        val available: Boolean,
        val text: String?,
        val sensitive: Boolean,
        val reason: String?,
    )

    data class ClipboardWriteData(
        val written: Boolean,
        val error: String?,
    )

    data class HapticData(
        val performed: Boolean,
        val kind: String,
        val reason: String?,
    )

    fun read(activity: Activity): ClipboardReadData {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !activity.hasWindowFocus()) {
            return ClipboardReadData(
                available = false,
                text = null,
                sensitive = false,
                reason = "app_not_focused",
            )
        }
        val manager = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            ?: return ClipboardReadData(false, null, false, "clipboard_unavailable")
        val clip = manager.primaryClip
            ?: return ClipboardReadData(true, null, false, "clipboard_empty")
        if (clip.itemCount == 0) return ClipboardReadData(true, null, false, "clipboard_empty")
        val sensitive = isSensitive(clip.description)
        val redact = sensitive &&
            NativeSettings.getBoolean(activity, NativeSettings.KEY_PRIVACY_CLIPBOARD_REDACT)
        if (redact) {
            return ClipboardReadData(true, null, true, "redacted_sensitive")
        }
        val text = clip.getItemAt(0).coerceToText(activity)?.toString()
        return ClipboardReadData(true, text, sensitive, null)
    }

    fun write(activity: Activity, text: String, sensitive: Boolean): ClipboardWriteData {
        val manager = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            ?: return ClipboardWriteData(false, "clipboard_unavailable")
        return try {
            val clip = ClipData.newPlainText("JCode", text)
            if (sensitive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                clip.description.extras = android.os.PersistableBundle().apply {
                    putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
                }
            }
            manager.setPrimaryClip(clip)
            ClipboardWriteData(true, null)
        } catch (error: Exception) {
            ClipboardWriteData(false, error.message ?: "clipboard_write_failed")
        }
    }

    private fun isSensitive(description: ClipDescription): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        val extras = description.extras ?: return false
        return extras.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE, false)
    }

    private fun constantFor(kind: String): Int? = when (kind) {
        "light" -> HapticFeedbackConstants.KEYBOARD_TAP
        "medium" -> HapticFeedbackConstants.CONTEXT_CLICK
        "heavy" -> HapticFeedbackConstants.LONG_PRESS
        "success" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            HapticFeedbackConstants.CONFIRM
        } else {
            HapticFeedbackConstants.LONG_PRESS
        }
        "error" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            HapticFeedbackConstants.REJECT
        } else {
            HapticFeedbackConstants.LONG_PRESS
        }
        else -> null
    }

    fun haptic(activity: Activity, kind: String): HapticData {
        val constant = constantFor(kind)
            ?: return HapticData(false, kind, "unknown_haptic")
        if (!NativeSettings.getBoolean(activity, NativeSettings.KEY_HAPTICS_ENABLED)) {
            return HapticData(false, kind, "haptics_disabled_in_app")
        }
        if (!systemHapticsEnabled(activity)) {
            return HapticData(false, kind, "haptics_disabled_in_system")
        }
        val vibrator = activity.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
        if (vibrator?.hasVibrator() != true) {
            return HapticData(false, kind, "no_vibrator")
        }
        if (Looper.myLooper() != Looper.getMainLooper()) {
            return HapticData(false, kind, "not_on_main_thread")
        }
        val view: View = activity.window?.decorView
            ?: return HapticData(false, kind, "no_decor_view")
        val performed = view.performHapticFeedback(
            constant,
            HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING,
        )
        // FLAG_IGNORE_GLOBAL_SETTING keeps the app's own toggle authoritative
        // while the system setting was already checked above.
        return if (performed) {
            HapticData(true, kind, null)
        } else {
            HapticData(false, kind, "platform_refused")
        }
    }

    private fun systemHapticsEnabled(context: Context): Boolean {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (audio?.getRingerMode() == AudioManager.RINGER_MODE_SILENT) return false
        return Settings.System.getInt(
            context.contentResolver,
            Settings.System.HAPTIC_FEEDBACK_ENABLED,
            1,
        ) != 0
    }
}
