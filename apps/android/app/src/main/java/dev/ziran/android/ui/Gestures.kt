package dev.ziran.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.MotionMath
import dev.ziran.android.design.Palette
import dev.ziran.android.design.ReducedFadeScale
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Shared gesture surfaces from Flow.dc.html: undo bar, pull ring and sheet.
 */

/** Undo bar: rises from +24 dp over 450 ms (WuEasing.Default) with ink background. */
@Composable
fun UndoBar(
    visible: Boolean,
    title: String,
    palette: Palette,
    onUndo: () -> Unit,
    modifier: Modifier = Modifier,
    reducedMotion: Boolean = false,
) {
    val risePx = with(LocalDensity.current) { 24.dp.toPx().toInt() }
    val enterDur = if (reducedMotion) WuDurations.ReducedFade else WuDurations.SwipeCollapse
    val exitDur = if (reducedMotion) WuDurations.ReducedFade else 300
    AnimatedVisibility(
        visible = visible,
        enter = if (reducedMotion) {
            fadeIn(tween(enterDur, easing = WuEasing.Default))
        } else {
            slideInVertically(tween(enterDur, easing = WuEasing.Default)) { risePx } +
                fadeIn(tween(300, easing = WuEasing.Default))
        },
        exit = if (reducedMotion) {
            fadeOut(tween(exitDur, easing = WuEasing.Default))
        } else {
            slideOutVertically(tween(exitDur, easing = WuEasing.Default)) { risePx } +
                fadeOut(tween(exitDur, easing = WuEasing.Default))
        },
        modifier = modifier.padding(horizontal = 14.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .background(palette.ink, RoundedCornerShape(12.dp))
                .padding(start = 16.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Archived \u201C$title\u201D",
                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.paper),
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Box(
                Modifier
                    .height(44.dp)
                    .wuClickable(reducedMotion = reducedMotion, onClick = onUndo)
                    .padding(horizontal = 12.dp)
                    .semantics { role = Role.Button; contentDescription = "Undo archive" },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "undo",
                    style = TextStyle(
                        fontFamily = WuFonts.Mono,
                        fontSize = 12.sp,
                        color = palette.paper,
                        textDecoration = TextDecoration.Underline,
                    ),
                )
            }
        }
    }
}

/**
 * Pull-to-refresh ink ring at the top of the list (`Flow.dc.html`).
 * Fills as you pull (`pullDp / 70`), scales 0.4 -> 1.0, spins at 800 ms/rev
 * while refreshing, then settles smoothly in 450 ms.
 */
@Composable
fun PullInkRing(
    palette: Palette,
    pullDp: Float,
    phase: String,
    reducedMotion: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val pullP = MotionMath.pullProgress(pullDp)
    val targetY = MotionMath.pullIndicatorY(pullDp, phase)
    val targetScale = if (phase == "refresh") 1f else 0.4f + 0.6f * pullP
    val targetAlpha = if (phase == "refresh") 1f else if (phase == "idle") 0f else pullP

    val isDrag = phase == "drag"
    val animY by animateFloatAsState(
        targetValue = targetY,
        animationSpec = tween(if (isDrag) 1 else WuDurations.PullSettle, easing = WuEasing.Default),
        label = "pull-ring-y",
    )
    val animScale by animateFloatAsState(
        targetValue = targetScale,
        animationSpec = tween(if (isDrag) 1 else WuDurations.PullSettle, easing = WuEasing.Default),
        label = "pull-ring-scale",
    )
    val animAlpha by animateFloatAsState(
        targetValue = targetAlpha,
        animationSpec = tween(if (isDrag) 1 else 300, easing = WuEasing.Default),
        label = "pull-ring-alpha",
    )

    val spinTransition = if (phase == "refresh" && !reducedMotion) {
        rememberInfiniteTransition(label = "pull-spin")
    } else null
    val spinAngle = spinTransition?.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "pull-spin-deg",
    )

    if (animAlpha <= 0.005f && phase == "idle") return

    Canvas(
        modifier
            .size(28.dp)
            .graphicsLayer {
                translationY = with(density) { (animY - 6f).dp.toPx() }
                scaleX = animScale
                scaleY = animScale
                alpha = animAlpha
                rotationZ = spinAngle?.value ?: 0f
            },
    ) {
        val sweep = if (phase == "refresh") 245f else (pullP * 340f).coerceAtLeast(8f)
        drawArc(
            color = palette.ink,
            startAngle = -90f,
            sweepAngle = sweep,
            useCenter = false,
            style = Stroke(2.4.dp.toPx(), cap = StrokeCap.Round),
        )
    }
}

/** Back slide transition: page leaves 0 to 100 percent, previous returns from -22 percent. */
fun backSlideTransition(progress: Float, widthPx: Float): Pair<Float, Float> =
    MotionMath.backSlideOffsetX(progress, widthPx) to MotionMath.backParallaxOffsetX(progress, widthPx)

/**
 * Action sheet: slides up over a dimming scrim (420 ms sheet, 380 ms scrim,
 * WuEasing.Default). Tap the scrim, drag down, or press system back to dismiss.
 */
@Composable
fun SheetHost(
    visible: Boolean,
    palette: Palette,
    onDismiss: () -> Unit,
    reducedMotion: Boolean = false,
    content: @Composable () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val progress = remember { Animatable(0f) }
    var rendered by remember { mutableStateOf(visible) }
    var sheetHeightPx by remember { mutableFloatStateOf(900f) }
    var dragOffsetPx by remember { mutableFloatStateOf(0f) }

    BackHandler(enabled = visible) { onDismiss() }

    LaunchedEffect(visible, reducedMotion) {
        if (visible) {
            rendered = true
            dragOffsetPx = 0f
            if (reducedMotion) {
                withContext(ReducedFadeScale) {
                    progress.animateTo(1f, tween(WuDurations.ReducedFade, easing = WuEasing.Default))
                }
            } else {
                progress.animateTo(1f, tween(WuDurations.Sheet, easing = WuEasing.Default))
            }
        } else if (rendered) {
            if (reducedMotion) {
                withContext(ReducedFadeScale) {
                    progress.animateTo(0f, tween(WuDurations.ReducedFade, easing = WuEasing.Default))
                }
            } else {
                progress.animateTo(0f, tween(WuDurations.Scrim, easing = WuEasing.Default))
            }
            dragOffsetPx = 0f
            rendered = false
        }
    }

    if (!rendered) return

    val dismissThresholdPx = with(LocalDensity.current) { 96.dp.toPx() }
    val p = progress.value
    val dragFraction = (dragOffsetPx / sheetHeightPx.coerceAtLeast(1f)).coerceIn(0f, 1f)
    val effectiveScrim = (p * (1f - dragFraction * 0.7f)).coerceIn(0f, 1f)

    Box(Modifier.fillMaxSize()) {
        // Dimming scrim (0 -> 0.32 alpha)
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = effectiveScrim }
                .background(Color.Black.copy(alpha = 0.32f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss,
                )
                .semantics { role = Role.Button; contentDescription = "Close actions" },
        )
        // Sheet surface
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .onSizeChanged { if (it.height > 0) sheetHeightPx = it.height.toFloat() }
                .graphicsLayer {
                    if (reducedMotion) {
                        alpha = p
                        translationY = dragOffsetPx
                    } else {
                        translationY = MotionMath.sheetOffsetY(p, sheetHeightPx) + dragOffsetPx
                    }
                    shadowElevation = 24f * p
                    shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
                    clip = true
                }
                .background(palette.paper)
                .draggable(
                    orientation = Orientation.Vertical,
                    state = rememberDraggableState { delta ->
                        dragOffsetPx = (dragOffsetPx + delta).coerceAtLeast(0f)
                    },
                    onDragStopped = { velocity ->
                        if (dragOffsetPx > dismissThresholdPx || velocity > 900f) {
                            onDismiss()
                        } else {
                            scope.launch {
                                val start = dragOffsetPx
                                val anim = Animatable(start)
                                anim.animateTo(0f, tween(WuDurations.PredictiveSettle, easing = WuEasing.Default)) {
                                    dragOffsetPx = value
                                }
                            }
                        }
                    },
                )
                .navigationBarsPadding()
                .padding(horizontal = 20.dp, vertical = 10.dp),
        ) {
            content()
        }
    }
}
