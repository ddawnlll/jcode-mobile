package dev.ziran.android.design

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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
}

/** Board durations in milliseconds. */
object WuDurations {
    const val Ripple = 650
    const val RippleCleanup = 700
    const val Press = 180
    const val InkDrop = 900
    const val Unroll = 800
    const val BackSlide = 420
    const val PredictiveSettle = 320
    const val SwipeCollapse = 450
    const val UndoBar = 4600
    const val LongPressHold = 450
    const val Sheet = 420
    const val PullSettle = 450
    const val ThrottleWord = 500
    const val WordStagger = 65
    const val ToolIn = 550
    const val RingDraw = 900
    const val Panel = 750
    const val SceneFade = 1200
    const val KenBurns = 34000
    const val Theme = 600
    const val ReducedMax = 150
}

/**
 * Reduced motion: when the system animator scale is 0, every duration becomes
 * a 150 ms fade or less. Gestures still follow the finger.
 */
fun reducedDuration(wantedMs: Int, durationScale: Float): Int {
    if (durationScale <= 0.01f) return minOf(wantedMs, WuDurations.ReducedMax)
    return (wantedMs * durationScale).toInt().coerceAtLeast(1)
}

/** Read animator scale once per composition; 1.0 means full motion. Zero is reduced. */
@Composable
fun rememberAnimatorScale(): Float {
    val context = LocalContext.current
    return remember(context) {
        android.provider.Settings.Global.getFloat(
            context.contentResolver,
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        )
    }
}

/** Press scale: controls to 97 percent, seals to 90 percent with a tilt. */
fun pressScale(isSeal: Boolean): Float = if (isSeal) 0.90f else 0.97f

/** Backwards compatible name used by screens. */
object WuMotion {
    val ease: Easing = WuEasing.Default
    fun tween(durationMs: Int, easing: Easing = WuEasing.Default) =
        androidx.compose.animation.core.tween<Float>(durationMs, easing = easing)
}
