package dev.ziran.android.design

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.platform.LocalContext

/**
 * Wu wei motion. One easing everywhere: cubic-bezier(.22, 1, .36, 1).
 * Only alpha, translation, scale and clip are animated. See Motion.dc.html.
 */
object WuEasing {
    val Default: Easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
    val SlideOut: Easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
    val Roll: Easing = CubicBezierEasing(0.5f, 0f, 0.6f, 1f)
    val UnrollBoard: Easing = CubicBezierEasing(0.3f, 0f, 0.2f, 1f)
    val Stamp: Easing = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
}

/** Board durations in milliseconds. */
object WuDurations {
    const val Ripple = 650
    const val RippleCleanup = 700
    const val Press = 180
    const val Stamp = 700
    const val StampDelay = 500
    const val Rise = 900
    const val InkDrop = 900
    const val Unroll = 800
    const val Roll = 700
    const val BackSlide = 420
    const val PredictiveCommit = 300
    const val PredictiveSettle = 320
    const val SwipeSlideOff = 260
    const val SwipeReturn = 380
    const val SwipeCollapse = 450
    const val UndoBar = 4600
    const val LongPressHold = 450
    const val LongPressSheetDelay = 140
    const val Sheet = 420
    const val Scrim = 380
    const val PullSettle = 450
    const val ThrottleWord = 500
    const val WordStagger = 65
    const val AnswerWordStagger = 55
    const val ToolIn = 550
    const val ToolSlideIn = 600
    const val RingDraw = 900
    const val RingDrawDelay = 100
    const val Panel = 750
    const val ThinkBarGrow = 3400
    const val HairlineFlow = 1600
    const val SceneFade = 1200
    const val KenBurns = 34000
    const val MistDrift = 16000
    const val Theme = 600
    const val ReducedMax = 150
    const val ReducedFade = 120
}

/**
 * Reduced motion duration helper for unit tests and manual delays.
 * Note: Compose animations already apply the system MotionDurationScale, so
 * Compose tween() calls should pass 1x board durations directly (or ReducedFade
 * when reducedMotion is active) rather than multiplying by durationScale again.
 */
fun reducedDuration(wantedMs: Int, durationScale: Float): Int {
    if (durationScale <= 0.01f) return minOf(wantedMs, WuDurations.ReducedMax)
    return (wantedMs * durationScale).toInt().coerceAtLeast(1)
}

/**
 * MotionDurationScale override used only for short reduced-motion fades so that
 * when ANIMATOR_DURATION_SCALE == 0, transitions crossfade gently in <= 150 ms
 * instead of snapping in a single frame.
 */
object ReducedFadeScale : MotionDurationScale {
    override val scaleFactor: Float = 1f
}

/** Root-provided animator duration scale so child rows never register extra ContentObservers. */
val LocalAnimatorScale = compositionLocalOf { 1f }

/**
 * Observe ANIMATOR_DURATION_SCALE live ONCE at the app root so changing it via
 * Settings or adb updates motion and reduced-motion immediately without restarting.
 */
@Composable
fun rememberObservedAnimatorScale(): Float {
    val context = LocalContext.current
    fun readScale(): Float = Settings.Global.getFloat(
        context.contentResolver,
        Settings.Global.ANIMATOR_DURATION_SCALE,
        1f,
    )
    var scale by remember(context) { mutableFloatStateOf(readScale()) }
    DisposableEffect(context) {
        val uri = Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE)
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                scale = readScale()
            }
        }
        runCatching { context.contentResolver.registerContentObserver(uri, false, observer) }
        onDispose {
            runCatching { context.contentResolver.unregisterContentObserver(observer) }
        }
    }
    return scale
}

/** O(1) read of the root-observed ANIMATOR_DURATION_SCALE. */
@Composable
fun rememberAnimatorScale(): Float = LocalAnimatorScale.current

/** Press scale: controls to 97 percent, seals to 90 percent with a tilt. */
fun pressScale(isSeal: Boolean): Float = if (isSeal) 0.90f else 0.97f

/** Backwards compatible name used by screens. */
object WuMotion {
    val ease: Easing = WuEasing.Default
    fun tween(durationMs: Int, easing: Easing = WuEasing.Default) =
        androidx.compose.animation.core.tween<Float>(durationMs, easing = easing)
}
