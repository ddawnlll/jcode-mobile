package dev.ziran.android.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/**
 * Motion math: pure functions shared by screens and tested on the JVM.
 * Values come from Motion.dc.html and Flow keyframes.
 */
object MotionMath {
    /** Predictive back commits past one third. */
    fun shouldCommitBack(progress: Float): Boolean = progress > 1f / 3f

    /** Back slide: leaving page 0 to 100 percent of width. */
    fun backSlideOffsetX(progress: Float, widthPx: Float): Float = widthPx * progress.coerceIn(0f, 1f)

    /** Entering page returns from -22 percent parallax. */
    fun backParallaxOffsetX(progress: Float, widthPx: Float): Float = -widthPx * 0.22f * (1f - progress.coerceIn(0f, 1f))

    /** Sheet: translateY 105 percent down to 0. */
    fun sheetOffsetY(progress: Float, heightPx: Float): Float = heightPx * (1f - progress.coerceIn(0f, 1f)) * 1.05f

    /** Pull-to-refresh ring fill: pull / 70, capped at 1. */
    fun pullProgress(pullPx: Float): Float = (pullPx / 70f).coerceIn(0f, 1f)

    /** Pull indicator sits at pull * 0.45 while dragging, 22 dp settling. */
    fun pullIndicatorY(pullPx: Float, phase: String): Float = when (phase) {
        "drag" -> minOf(pullPx * 0.45f, 40f)
        "refresh" -> 22f
        else -> 0f
    }

    /** List follows pull at 0.45, 26 dp while refreshing. */
    fun pullListY(pullPx: Float, phase: String): Float = when (phase) {
        "drag" -> pullPx * 0.45f
        "refresh" -> 26f
        else -> 0f
    }

    /** Swipe archive threshold and commit offset. */
    const val ArchiveThresholdPx = 110f
    const val ArchiveOffscreenPx = -420f

    /** Ink ripple: 650 ms scale 0.08 to 1, opacity 0.22 to 0, cleanup 700 ms. */
    fun rippleScale(progress: Float): Float = 0.08f + (1f - 0.08f) * progress.coerceIn(0f, 1f)
    fun rippleAlpha(progress: Float): Float = 0.22f * (1f - progress.coerceIn(0f, 1f))

    /** Predictive back scale: 1 to 0.9, rounded corners to 30 px propagated. */
    fun predictiveScale(progress: Float): Float = 1f - 0.1f * progress.coerceIn(0f, 1f)
    fun predictiveCornerPx(progress: Float): Float = 30f * progress.coerceIn(0f, 1f)

    /** Live timeline: tool row 550 ms, ring 900 ms, panel 750 ms, words 65 ms stagger. */
    const val ToolInMs = 550
    const val RingDrawMs = 900
    const val PanelMs = 750
    const val WordStaggerMs = 65
    const val WordMs = 500
}

/** One tap ripple, coordinates in layout px from the host origin. */
data class Ripple(val id: Long, val xPx: Float, val yPx: Float)

/**
 * Tap host: every pointer down spawns an ink ripple at the local point.
 * Ripples live 700 ms. The host is pointer-transparent for children.
 */
@Composable
fun InkRippleHost(
    ink: Color,
    durationScale: Float,
    reducedMotion: Boolean,
    content: @Composable () -> Unit,
) {
    val ripples = remember { mutableStateListOf<Ripple>() }
    var nextId = remember { longArrayOf(0) }
    Box(
        Modifier.pointerInput(Unit) {
            detectTapGestures { offset ->
                nextId[0] += 1
                ripples.add(Ripple(nextId[0], offset.x, offset.y))
            }
        },
    ) {
        content()
        ripples.forEach { ripple ->
            val progress by animateFloatAsState(
                targetValue = 1f,
                animationSpec = tween(reducedDuration(650, durationScale), easing = WuEasing.Default),
                label = "ripple-${ripple.id}",
            )
            Box(
                Modifier
                    .offset { IntOffset((ripple.xPx - 90f).toInt(), (ripple.yPx - 90f).toInt()) }
                    .size(180.dp)
                    .alpha(MotionMath.rippleAlpha(progress))
                    .clip(androidx.compose.foundation.shape.CircleShape)
                    .background(ink),
            )
            LaunchedEffect(ripple.id) {
                kotlinx.coroutines.delay(if (reducedMotion) 150 else 700)
                ripples.remove(ripple)
            }
        }
    }
}
