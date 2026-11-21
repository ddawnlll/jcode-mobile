package dev.ziran.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.ziran.android.design.MotionMath
import dev.ziran.android.design.Palette
import dev.ziran.android.design.ReducedFadeScale
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import kotlinx.coroutines.withContext
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * Screen transitions from Motion.dc.html and Flow.dc.html.
 *
 * - InkDrop: the new page is revealed by a circle growing from the tapped point
 *   to 160% (900 ms, WuEasing.Default), while the page underneath dims to 0.35 and scales to 0.985.
 * - Unroll: Model and Scenes unroll from the TOP down behind a thin ink rod (800 ms).
 * - Roll: Model and Scenes roll UP and away behind the ink rod (700 ms).
 * - Slide: back slides the leaving page right (SlideOut) while the page beneath
 *   returns from a -22% parallax and 0.55 opacity (420 ms, WuEasing.Default).
 * - Predictive back: tracks finger 1:1 with 0.9 shrink, 30 dp rounded corners,
 *   -40 dp beneath parallax, and floating back chip.
 */
enum class NavKind { InkDrop, Unroll, Roll, Slide, None }

data class NavTransition(
    val kind: NavKind,
    val from: Screen,
    val to: Screen,
    val origin: Offset = Offset.Unspecified,
    /** True while a predictive-back gesture drives progress directly. */
    val predictive: Boolean = false,
    /** Touch Y in px during predictive back for positioning the floating chip. */
    val touchY: Float = 0f,
    /** True after predictive back is released past 1/3 and sliding off to commit. */
    val predictiveCommitting: Boolean = false,
    /** Finger progress at the moment commit started (for seamless continuation). */
    val commitStartProgress: Float = 0f,
)

private data class ScreenLayer(val screen: Screen, val modifier: Modifier)

/**
 * Paint one transition at [progress] in 0..1.
 *
 * Every visible screen is rendered through a SINGLE `layers.forEach { key(layer.screen) }`
 * call site so starting or finishing any transition NEVER tears down, recreates,
 * or flashes a screen that stays visible.
 */
@Composable
fun ScreenTransition(
    current: Screen,
    transition: NavTransition?,
    progress: Float,
    widthPx: Float,
    palette: Palette,
    reducedMotion: Boolean = false,
    content: @Composable (Screen) -> Unit,
) {
    val density = LocalDensity.current
    val p = progress.coerceIn(0f, 1f)

    val layers: List<ScreenLayer>
    var rodFraction: Float? = null
    var rodAlpha = 0f

    if (transition == null) {
        layers = listOf(ScreenLayer(current, Modifier.fillMaxSize()))
    } else if (reducedMotion && !transition.predictive) {
        val eased = WuEasing.Default.transform(p)
        layers = listOf(
            ScreenLayer(transition.from, Modifier.fillMaxSize().graphicsLayer { alpha = 1f - eased }),
            ScreenLayer(transition.to, Modifier.fillMaxSize().graphicsLayer { alpha = eased }),
        )
    } else {
        when (transition.kind) {
            NavKind.InkDrop -> {
                val e = WuEasing.Default.transform(p)
                val origin = transition.origin.takeIf { it != Offset.Unspecified }
                    ?: Offset(widthPx * 0.5f, widthPx * 0.8f)
                layers = listOf(
                    ScreenLayer(
                        transition.from,
                        Modifier.fillMaxSize().graphicsLayer {
                            alpha = 1f - 0.65f * e
                            val s = 1f - 0.015f * e
                            scaleX = s
                            scaleY = s
                        },
                    ),
                    ScreenLayer(
                        transition.to,
                        Modifier.fillMaxSize().inkCircleClip(origin, e),
                    ),
                )
            }

            NavKind.Unroll -> {
                val e = WuEasing.Default.transform(p)
                if (e < 0.999f) {
                    rodFraction = e
                    rodAlpha = 0.75f * (1f - e * 0.25f)
                }
                layers = listOf(
                    ScreenLayer(transition.from, Modifier.fillMaxSize().graphicsLayer { alpha = 1f - 0.5f * e }),
                    ScreenLayer(transition.to, Modifier.fillMaxSize().unrollClip(e)),
                )
            }

            NavKind.Roll -> {
                val eRoll = WuEasing.Roll.transform(p)
                val eBeneath = WuEasing.Default.transform(p)
                val visibleFraction = 1f - eRoll
                if (visibleFraction > 0.001f && visibleFraction < 0.999f) {
                    rodFraction = visibleFraction
                    rodAlpha = 0.75f * visibleFraction
                }
                layers = listOf(
                    ScreenLayer(
                        transition.to,
                        Modifier.fillMaxSize().graphicsLayer {
                            alpha = 0.30f + 0.70f * eBeneath
                            val s = 0.985f + 0.015f * eBeneath
                            scaleX = s
                            scaleY = s
                        },
                    ),
                    ScreenLayer(transition.from, Modifier.fillMaxSize().unrollClip(visibleFraction)),
                )
            }

            NavKind.Slide -> {
                if (transition.predictive) {
                    val dragShiftPx = with(density) { 46.dp.toPx() }
                    val beneathShiftPx = with(density) { 40.dp.toPx() }
                    val maxShadowPx = with(density) { 14.dp.toPx() }

                    val leaveTx: Float
                    val leaveScale: Float
                    val cornerDp: Float
                    val beneathTx: Float
                    val beneathAlpha: Float

                    if (transition.predictiveCommitting) {
                        val t = WuEasing.Default.transform(p)
                        val sp = transition.commitStartProgress
                        val startTx = dragShiftPx * sp
                        val endTx = widthPx + with(density) { 30.dp.toPx() }
                        leaveTx = startTx + (endTx - startTx) * t
                        leaveScale = MotionMath.predictiveScale(sp) + (0.90f - MotionMath.predictiveScale(sp)) * t
                        cornerDp = MotionMath.predictiveCornerPx(sp) + (30f - MotionMath.predictiveCornerPx(sp)) * t
                        val bp = sp + (1f - sp) * t
                        beneathTx = -beneathShiftPx * (1f - bp)
                        beneathAlpha = 0.55f + 0.45f * bp
                    } else {
                        leaveTx = dragShiftPx * p
                        leaveScale = MotionMath.predictiveScale(p)
                        cornerDp = MotionMath.predictiveCornerPx(p)
                        beneathTx = -beneathShiftPx * (1f - p)
                        beneathAlpha = 0.55f + 0.45f * p
                    }

                    layers = listOf(
                        ScreenLayer(
                            transition.to,
                            Modifier.fillMaxSize().graphicsLayer {
                                translationX = beneathTx
                                alpha = beneathAlpha
                            },
                        ),
                        ScreenLayer(
                            transition.from,
                            Modifier.fillMaxSize().graphicsLayer {
                                translationX = leaveTx
                                scaleX = leaveScale
                                scaleY = leaveScale
                                transformOrigin = TransformOrigin.Center
                                clip = cornerDp > 0.1f
                                shape = RoundedCornerShape(cornerDp.dp)
                                shadowElevation = maxShadowPx * (if (transition.predictiveCommitting) 1f else p)
                            },
                        ),
                    )
                } else {
                    val eIn = WuEasing.Default.transform(p)
                    val eOut = WuEasing.SlideOut.transform(p)
                    val beneathX = MotionMath.backParallaxOffsetX(eIn, widthPx)
                    val leavingX = MotionMath.backSlideOffsetX(eOut, widthPx)
                    val edgeShadowW = with(density) { 18.dp.toPx() }

                    layers = listOf(
                        ScreenLayer(
                            transition.to,
                            Modifier.fillMaxSize().graphicsLayer {
                                translationX = beneathX
                                alpha = 0.55f + 0.45f * eIn
                            },
                        ),
                        ScreenLayer(
                            transition.from,
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer { translationX = leavingX }
                                .drawWithContent {
                                    drawContent()
                                    if (eOut > 0.001f && eOut < 0.999f) {
                                        drawRect(
                                            brush = Brush.horizontalGradient(
                                                0f to Color.Transparent,
                                                1f to Color.Black.copy(alpha = 0.12f * (1f - eOut)),
                                                startX = -edgeShadowW,
                                                endX = 0f,
                                            ),
                                            topLeft = Offset(-edgeShadowW, 0f),
                                            size = Size(edgeShadowW, size.height),
                                        )
                                    }
                                },
                        ),
                    )
                }
            }

            NavKind.None -> {
                layers = listOf(ScreenLayer(transition.to, Modifier.fillMaxSize()))
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        layers.forEach { layer ->
            key(layer.screen) {
                Box(layer.modifier) {
                    content(layer.screen)
                }
            }
        }

        // Ink rod overlay for Unroll / Roll transitions.
        val rf = rodFraction
        if (rf != null) {
            Canvas(Modifier.fillMaxSize()) {
                val y = size.height * rf
                val rodH = 6.dp.toPx()
                val overhang = 6.dp.toPx()
                drawRoundRect(
                    color = palette.ink.copy(alpha = rodAlpha),
                    topLeft = Offset(-overhang, y - rodH / 2f),
                    size = Size(size.width + overhang * 2f, rodH),
                    cornerRadius = CornerRadius(3.dp.toPx()),
                )
            }
        }
    }
}

/**
 * Circular ink reveal from [origin] to 160% of the farthest corner.
 * At progress ~0 (radius < 1 px), draws NOTHING so the incoming screen never
 * flashes full-frame before shrinking.
 */
fun Modifier.inkCircleClip(origin: Offset, progress: Float): Modifier = this.then(
    Modifier.drawWithContent {
        val clamped = progress.coerceIn(0f, 1f)
        if (clamped <= 0.001f) return@drawWithContent
        if (clamped >= 0.999f) {
            drawContent()
            return@drawWithContent
        }
        val radius = 1.6f * hypot(
            maxOf(origin.x, size.width - origin.x).toDouble(),
            maxOf(origin.y, size.height - origin.y).toDouble(),
        ).toFloat() * clamped
        if (radius < 1f) return@drawWithContent
        clipPath(Path().apply { addOval(Rect(center = origin, radius = radius)) }) {
            this@drawWithContent.drawContent()
        }
    },
)

/**
 * Vertical top-down unroll clip: `clip-path: inset(0 0 (1-p)*100% 0)`.
 * Reveals from y = 0 down to y = height * progress.
 */
fun Modifier.unrollClip(progress: Float): Modifier = this.then(
    Modifier.drawWithContent {
        val clamped = progress.coerceIn(0f, 1f)
        if (clamped <= 0.001f) return@drawWithContent
        if (clamped >= 0.999f) {
            drawContent()
            return@drawWithContent
        }
        clipRect(0f, 0f, size.width, size.height * clamped) {
            this@drawWithContent.drawContent()
        }
    },
)

/** Board duration for each kind. */
fun navDurationMs(kind: NavKind): Int = when (kind) {
    NavKind.InkDrop -> WuDurations.InkDrop
    NavKind.Unroll -> WuDurations.Unroll
    NavKind.Roll -> WuDurations.Roll
    NavKind.Slide -> WuDurations.BackSlide
    NavKind.None -> 0
}

/** Board easing: shared WuEasing.Default everywhere except Roll. */
fun navEasing(kind: NavKind) = when (kind) {
    NavKind.Roll -> WuEasing.Roll
    else -> WuEasing.Default
}

/**
 * Drive a linear 0..1 transition clock over the board duration. Each layer
 * applies its exact easing curve in ScreenTransition. Compose's MotionDurationScale
 * scales the duration automatically (1x normal, 4x slow-mo). Under reduced motion,
 * runs a gentle 120 ms crossfade even when system ANIMATOR_DURATION_SCALE == 0.
 */
suspend fun runNavTransition(
    progress: Animatable<Float, *>,
    kind: NavKind,
    durationScale: Float = 1f,
    reducedMotion: Boolean = false,
) {
    progress.snapTo(0f)
    if (kind == NavKind.None) {
        progress.snapTo(1f)
        return
    }
    if (reducedMotion || durationScale <= 0.01f) {
        withContext(ReducedFadeScale) {
            progress.animateTo(1f, tween(WuDurations.ReducedFade, easing = LinearEasing))
        }
        return
    }
    val duration = navDurationMs(kind).coerceAtLeast(1)
    progress.animateTo(1f, tween(duration, easing = LinearEasing))
}

/** Rod position while the unroll is in flight, in px from the top edge. */
fun rodOffset(progress: Float, heightPx: Float): IntOffset =
    IntOffset(0, (heightPx * progress.coerceIn(0f, 1f)).roundToInt())
