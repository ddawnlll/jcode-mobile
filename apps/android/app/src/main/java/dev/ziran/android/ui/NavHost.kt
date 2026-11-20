package dev.ziran.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.ziran.android.design.MotionMath
import dev.ziran.android.design.WuEasing
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * Screen transitions from Motion.dc.html and Flow.dc.html.
 *
 * - InkDrop: the new page is revealed by a circle growing from the tapped point
 *   to 160 percent (900 ms), while the page underneath dims.
 * - Unroll: Model and Scenes unroll from the top behind a thin ink rod (800 ms).
 * - Slide: back slides the page right while the one beneath returns from a
 *   22 percent parallax (420 ms). Predictive back keeps the same geometry and
 *   adds the 0.9 shrink and rounded corners while the finger is down.
 */
enum class NavKind { InkDrop, Unroll, Slide, None }

data class NavTransition(
    val kind: NavKind,
    val from: Screen,
    val to: Screen,
    val origin: Offset = Offset.Unspecified,
    /** True while a predictive-back gesture drives progress directly. */
    val predictive: Boolean = false,
)

/**
 * Paint one transition at [progress] in 0..1. With no transition it paints
 * only [current].
 */
@Composable
fun ScreenTransition(
    current: Screen,
    transition: NavTransition?,
    progress: Float,
    widthPx: Float,
    content: @Composable (Screen) -> Unit,
) {
    if (transition == null) {
        content(current)
        return
    }
    val p = progress.coerceIn(0f, 1f)
    Box(Modifier.fillMaxSize()) {
        when (transition.kind) {
            NavKind.InkDrop -> {
                Box(Modifier.fillMaxSize().alpha(1f - 0.45f * p)) { content(transition.from) }
                val origin = transition.origin.takeIf { it != Offset.Unspecified } ?: Offset(widthPx / 2f, widthPx / 2f)
                Box(Modifier.fillMaxSize().inkCircleClip(origin, p)) { content(transition.to) }
            }

            NavKind.Unroll -> {
                Box(Modifier.fillMaxSize().alpha(1f - 0.4f * p)) { content(transition.from) }
                Box(Modifier.fillMaxSize().unrollClip(p)) { content(transition.to) }
                if (p < 1f) {
                    Canvas(Modifier.fillMaxSize()) {
                        val y = size.height * p
                        drawRoundRect(
                            color = Color(0xFF1C1A17).copy(alpha = 0.75f * (1f - p)),
                            topLeft = Offset(-6.dp.toPx(), y - 3.dp.toPx()),
                            size = Size(size.width + 12.dp.toPx(), 6.dp.toPx()),
                            cornerRadius = CornerRadius(3.dp.toPx()),
                        )
                    }
                }
            }

            NavKind.Slide -> {
                val (leavingX, beneathX) = backSlideTransition(p, widthPx)
                // The returning page paints first; the leaving page rides above it.
                Box(Modifier.fillMaxSize().graphicsLayer { translationX = beneathX }) {
                    content(transition.to)
                }
                if (transition.predictive) {
                    val scale = MotionMath.predictiveScale(p)
                    val cornerDp = MotionMath.predictiveCornerPx(p).dp
                    Box(
                        Modifier
                            .fillMaxSize()
                            .graphicsLayer {
                                translationX = widthPx * 0.35f * p
                                scaleX = scale
                                scaleY = scale
                                transformOrigin = TransformOrigin(0f, 0.5f)
                                clip = p > 0.001f
                                shape = RoundedCornerShape(cornerDp)
                                shadowElevation = 8f * p
                            },
                    ) { content(transition.from) }
                } else {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .graphicsLayer { translationX = leavingX },
                    ) { content(transition.from) }
                }
            }

            NavKind.None -> content(transition.to)
        }
    }
}

/** Circular ink reveal to the farthest corner, overshooting by 160 percent. */
fun Modifier.inkCircleClip(origin: Offset, progress: Float): Modifier = this.then(
    Modifier.drawWithContent {
        val radius = 1.6f * hypot(
            maxOf(origin.x, size.width - origin.x).toDouble(),
            maxOf(origin.y, size.height - origin.y).toDouble(),
        ).toFloat() * progress.coerceIn(0f, 1f)
        if (radius < 1f) {
            drawContent()
            return@drawWithContent
        }
        clipPath(Path().apply { addOval(Rect(center = origin, radius = radius)) }) {
            this@drawWithContent.drawContent()
        }
    },
)

/** Vertical unroll: the visible band grows downward from the top edge. */
fun Modifier.unrollClip(progress: Float): Modifier = this.then(
    Modifier.drawWithContent {
        val top = size.height * (1f - progress.coerceIn(0f, 1f))
        clipRect(0f, top, size.width, size.height) {
            this@drawWithContent.drawContent()
        }
    },
)

/** Board duration for each kind. */
fun navDurationMs(kind: NavKind): Int = when (kind) {
    NavKind.InkDrop -> 900
    NavKind.Unroll -> 800
    NavKind.Slide -> 420
    NavKind.None -> 0
}

/** Board easing: unroll uses the flatter curve, everything else the shared ease. */
fun navEasing(kind: NavKind) = when (kind) {
    NavKind.Unroll -> WuEasing.UnrollBoard
    else -> WuEasing.Default
}

/** Drive a transition 0 to 1. Reduced motion becomes a 150 ms fade. */
suspend fun runNavTransition(
    progress: Animatable<Float, *>,
    kind: NavKind,
    durationScale: Float = 1f,
    reducedMotion: Boolean = false,
) {
    progress.snapTo(0f)
    if (reducedMotion) {
        progress.animateTo(1f, tween(150, easing = WuEasing.Default))
        return
    }
    val duration = (navDurationMs(kind) * durationScale).toInt().coerceAtLeast(1)
    progress.animateTo(1f, tween(duration, easing = navEasing(kind)))
}

/** Rod position while the unroll is in flight, in px from the top edge. */
fun rodOffset(progress: Float, heightPx: Float): IntOffset =
    IntOffset(0, (heightPx * progress.coerceIn(0f, 1f)).roundToInt())
