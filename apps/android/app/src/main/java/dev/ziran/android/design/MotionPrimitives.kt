package dev.ziran.android.design

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.LayoutModifierNode
import androidx.compose.ui.node.invalidatePlacement
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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

    /** Swipe archive threshold and commit offset (board dp/px). */
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
data class Ripple(val id: Long, val xPx: Float, val yPx: Float, val progress: Animatable<Float, *> = Animatable(0f))

/**
 * Tap host: every pointer down spawns a soft radial ink ripple at the touch point
 * (180 dp diameter, scale 0.08 -> 1, alpha 0.22 -> 0 over 650 ms, WuEasing.Default).
 * Replaces Material ripple everywhere.
 */
@Composable
fun InkRippleHost(
    ink: Color,
    durationScale: Float,
    reducedMotion: Boolean,
    /** Reports each pointer-down in host coordinates, for the ink-drop origin. */
    onTapOrigin: (Offset) -> Unit = {},
    content: @Composable () -> Unit,
) {
    val ripples = remember { mutableStateListOf<Ripple>() }
    val nextId = remember { longArrayOf(0) }
    val radiusPx = with(LocalDensity.current) { 90.dp.toPx() }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(reducedMotion) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        val down = event.changes.firstOrNull { it.pressed && !it.previousPressed }
                        if (down != null) {
                            onTapOrigin(down.position)
                            if (!reducedMotion) {
                                nextId[0] += 1
                                val r = Ripple(nextId[0], down.position.x, down.position.y)
                                ripples.add(r)
                                scope.launch {
                                    r.progress.animateTo(
                                        targetValue = 1f,
                                        animationSpec = tween(WuDurations.Ripple, easing = WuEasing.Default),
                                    )
                                    ripples.remove(r)
                                }
                            }
                        }
                    }
                }
            },
    ) {
        content()
        if (ripples.isNotEmpty()) {
            Canvas(Modifier.fillMaxSize()) {
                ripples.forEach { ripple ->
                    val p = ripple.progress.value
                    val scale = MotionMath.rippleScale(p)
                    val alpha = MotionMath.rippleAlpha(p)
                    if (alpha > 0.001f) {
                        val r = radiusPx * scale
                        val center = Offset(ripple.xPx, ripple.yPx)
                        drawCircle(
                            brush = Brush.radialGradient(
                                0f to ink.copy(alpha = alpha),
                                0.18f to ink.copy(alpha = alpha),
                                0.70f to Color.Transparent,
                                1f to Color.Transparent,
                                center = center,
                                radius = r.coerceAtLeast(1f),
                            ),
                            radius = r,
                            center = center,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Zero-overhead IndicationNodeFactory for Wu wei press feedback.
 * Allocates NO Animatable and NO graphicsLayer while idle or scrolling 200+ rows;
 * only animates on actual press via LayoutModifierNode.placeWithLayer.
 */
private data class WuPressIndication(
    val isSeal: Boolean,
    val reducedMotion: Boolean,
) : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode =
        WuPressIndicationNode(interactionSource, isSeal, reducedMotion)
}

private class WuPressIndicationNode(
    private val interactionSource: InteractionSource,
    private val isSeal: Boolean,
    private val reducedMotion: Boolean,
) : Modifier.Node(), LayoutModifierNode {
    private var pressAnim: Animatable<Float, AnimationVector1D>? = null
    private var animJob: Job? = null
    private var activePressCount = 0

    override fun onAttach() {
        if (reducedMotion) return
        coroutineScope.launch {
            interactionSource.interactions.collect { interaction ->
                when (interaction) {
                    is PressInteraction.Press -> {
                        activePressCount += 1
                        animatePress(1f)
                    }
                    is PressInteraction.Release, is PressInteraction.Cancel -> {
                        activePressCount = (activePressCount - 1).coerceAtLeast(0)
                        if (activePressCount == 0) animatePress(0f)
                    }
                }
            }
        }
    }

    private fun animatePress(target: Float) {
        val created = pressAnim == null
        val anim = pressAnim ?: Animatable(0f).also { pressAnim = it }
        if (created) invalidatePlacement()
        animJob?.cancel()
        animJob = coroutineScope.launch {
            anim.animateTo(target, tween(WuDurations.Press, easing = WuEasing.Default))
        }
    }

    override fun MeasureScope.measure(measurable: Measurable, constraints: Constraints): MeasureResult {
        val placeable = measurable.measure(constraints)
        val minScale = pressScale(isSeal)
        return layout(placeable.width, placeable.height) {
            val anim = pressAnim
            if (anim == null) {
                placeable.place(0, 0)
            } else {
                placeable.placeWithLayer(0, 0) {
                    val p = anim.value
                    if (p > 0.0001f) {
                        val s = 1f + (minScale - 1f) * p
                        scaleX = s
                        scaleY = s
                        if (!isSeal) {
                            alpha = 1f - 0.15f * p
                        } else {
                            rotationZ += -3f * p
                        }
                    }
                }
            }
        }
    }
}

private val WuControlIndication = WuPressIndication(isSeal = false, reducedMotion = false)
private val WuSealIndication = WuPressIndication(isSeal = true, reducedMotion = false)

/**
 * Wu wei press feedback: replaces Material ripple with a zero-composed Modifier.Node.
 * Controls sink to 97% (alpha 85%), seals sink to 90% with a -3° tilt in 180 ms.
 * Seals also emit CONTEXT_CLICK haptic feedback.
 */
fun Modifier.wuClickable(
    enabled: Boolean = true,
    isSeal: Boolean = false,
    reducedMotion: Boolean = false,
    onClick: () -> Unit,
): Modifier {
    val indication = when {
        reducedMotion -> null
        isSeal -> WuSealIndication
        else -> WuControlIndication
    }
    if (!isSeal) {
        return this.clickable(
            enabled = enabled,
            interactionSource = null,
            indication = indication,
            onClick = onClick,
        )
    }
    return composed {
        val view = LocalView.current
        this.clickable(
            enabled = enabled,
            interactionSource = null,
            indication = indication,
            onClick = {
                view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                onClick()
            },
        )
    }
}

/**
 * Staggered rise entrance (`s-rise`): 900 ms, translateY 6 dp -> 0, alpha 0 -> 1,
 * GPU graphicsLayer only. Uses Compose tween(delayMillis) so MotionDurationScale
 * scales both delay and duration consistently at 1x, 0.25x, and 0x.
 */
fun Modifier.wuRise(
    delayMs: Int = 0,
    reducedMotion: Boolean = false,
    key: Any = Unit,
): Modifier = composed {
    val progress = remember(key) { Animatable(if (reducedMotion) 1f else 0f) }
    val dyPx = with(LocalDensity.current) { 6.dp.toPx() }
    LaunchedEffect(key, reducedMotion) {
        if (reducedMotion) {
            progress.snapTo(1f)
            return@LaunchedEffect
        }
        if (progress.value >= 0.999f) return@LaunchedEffect
        progress.animateTo(
            targetValue = 1f,
            animationSpec = tween(
                durationMillis = WuDurations.Rise,
                delayMillis = delayMs,
                easing = WuEasing.Default,
            ),
        )
    }
    this.graphicsLayer {
        val p = progress.value
        alpha = p
        translationY = if (reducedMotion) 0f else dyPx * (1f - p)
    }
}

/**
 * Stamp entrance (`s-stamp`): 700 ms (500 ms initial delay), cubic-bezier(.2,.8,.2,1).
 * Single Animatable 0..1 mapped piecewise:
 *   0.0..0.6: scale 1.7 -> 0.94, rotate -14deg -> -2deg, alpha 0 -> 1
 *   0.6..1.0: scale 0.94 -> 1.0, rotate -2deg -> -3deg, alpha 1
 * Rests at -3deg. Re-triggers when [trigger] increments.
 */
fun Modifier.wuStamp(
    trigger: Int = 0,
    initialDelayMs: Int = WuDurations.StampDelay,
    reducedMotion: Boolean = false,
): Modifier = composed {
    val progress = remember { Animatable(if (reducedMotion) 1f else 0f) }
    var lastTrigger by remember { mutableIntStateOf(-1) }

    LaunchedEffect(trigger, reducedMotion) {
        if (reducedMotion) {
            progress.snapTo(1f)
            lastTrigger = trigger
            return@LaunchedEffect
        }
        if (lastTrigger == trigger && progress.value >= 0.999f) return@LaunchedEffect
        val wait = if (trigger == 0 && lastTrigger == -1) initialDelayMs else 0
        lastTrigger = trigger
        progress.snapTo(0f)
        progress.animateTo(
            targetValue = 1f,
            animationSpec = tween(
                durationMillis = WuDurations.Stamp,
                delayMillis = wait,
                easing = WuEasing.Stamp,
            ),
        )
    }

    this.graphicsLayer {
        val t = progress.value.coerceIn(0f, 1f)
        if (t <= 0.6f) {
            val u = (t / 0.6f).coerceIn(0f, 1f)
            val s = 1.7f + (0.94f - 1.7f) * u
            scaleX = s
            scaleY = s
            rotationZ = -14f + (-2f - (-14f)) * u
            alpha = u
        } else {
            val u = ((t - 0.6f) / 0.4f).coerceIn(0f, 1f)
            val s = 0.94f + (1.0f - 0.94f) * u
            scaleX = s
            scaleY = s
            rotationZ = -2f + (-3f - (-2f)) * u
            alpha = 1f
        }
    }
}

private val BrailleFrames = arrayOf("⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏")

/** Animated braille working mark (`s-braille`: 900 ms, 10 steps). */
@Composable
fun BrailleSpinnerText(
    color: Color,
    fontSize: TextUnit = 15.sp,
    reducedMotion: Boolean = false,
    modifier: Modifier = Modifier,
) {
    var frame by remember { mutableIntStateOf(0) }
    val scale = rememberAnimatorScale()
    LaunchedEffect(reducedMotion, scale) {
        if (reducedMotion) return@LaunchedEffect
        val stepMs = (90f * scale.coerceAtLeast(0.25f)).toLong().coerceAtLeast(16L)
        while (true) {
            delay(stepMs)
            frame = (frame + 1) % BrailleFrames.size
        }
    }
    Text(
        text = BrailleFrames[if (reducedMotion) 0 else frame],
        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = fontSize, color = color),
        modifier = modifier,
    )
}
