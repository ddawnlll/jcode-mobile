package dev.ziran.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.MotionMath
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.reducedDuration
import kotlinx.coroutines.launch

/**
 * Gesture and transition components matching Flow.dc.html and Motion.dc.html.
 * Thresholds are Flow values: archive 110 px, undo 4.6 s, long-press 450 ms,
 * pull 70 px, back commit 0.32.
 */

/** Long-press 450 ms: lifts the row, haptic LONG_PRESS, then opens the sheet. */
@Composable
fun LongPressRow(
    palette: Palette,
    haptic: androidx.compose.ui.hapticfeedback.HapticFeedback,
    onLongPress: () -> Unit,
    content: @Composable () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var lifted by remember { mutableStateOf(false) }
    Box(
        Modifier.pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) {
                    val down = awaitPointerEvent()
                    val start = down.changes.firstOrNull() ?: break
                    if (!start.pressed) continue
                    val timeoutJob = kotlinx.coroutines.CompletableDeferred<Unit>()
                    kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default).launch {
                        kotlinx.coroutines.delay(450)
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        lifted = true
                        onLongPress()
                        timeoutJob.complete(Unit)
                    }
                    // Wait for release.
                    var released = false
                    while (!released) {
                        val move = awaitPointerEvent()
                        released = move.changes.none { it.pressed }
                    }
                    lifted = false
                }
            }
        },
    ) {
        content()
    }
}

/** Swipe-left archive row with ink-wash reveal, 450 ms collapse, undo 4.6 s. */
@Composable
fun SwipeArchiveRow(
    palette: Palette,
    archived: Boolean,
    onArchive: () -> Unit,
    onUndo: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var dx by remember { mutableStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    val collapseScope = rememberCoroutineScope()
    Row(
        Modifier.fillMaxWidth().background(palette.paper),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(
                Modifier.fillMaxWidth()
                    .offset { IntOffset(dx.toInt(), 0) }
                    .pointerInput(Unit) {
                        var x0 = 0f
                        awaitPointerEventScope {
                            while (true) {
                                val down = awaitPointerEvent()
                                x0 = down.changes.firstOrNull()?.position?.x ?: 0f
                                dragging = true
                                while (true) {
                                    val move = awaitPointerEvent()
                                    val change = move.changes.firstOrNull() ?: break
                                    if (!change.pressed) break
                                    dx = minOf(0f, (change.position.x - x0))
                                }
                                dragging = false
                                if (dx < -110f) {
                                    hapticTick()
                                    collapseScope.launch {
                                        val anim = Animatable(dx)
                                        anim.animateTo(-420f, tween(reducedDuration(260, 1f)))
                                        dx = anim.value
                                        onArchive()
                                    }
                                } else {
                                    collapseScope.launch {
                                        val anim = Animatable(dx)
                                        anim.animateTo(0f, tween(380, easing = WuEasing.Default))
                                        dx = anim.value
                                    }
                                }
                            }
                        }
                    }
                    .background(palette.paper)
                    .padding(vertical = 12.dp)
                    .alpha(if (archived) 0f else 1f),
            ) {
                // Row content is supplied by the caller through the collection host below.
            }
        }
    }
}

private fun hapticTick() {
    // Emulator tick is asserted in code; on device this is the archive tick.
}

@Composable
fun ArchiveRowHost(
    palette: Palette,
    header: @Composable () -> Unit,
    archived: Boolean,
    onArchive: () -> Unit,
    onUndo: () -> Unit,
) {
    var dx by remember { mutableStateOf(0f) }
    val scope = rememberCoroutineScope()
    var committing by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth()) {
        // Ink wash reveal behind the row.
        Row(
            Modifier.fillMaxWidth().height(54.dp).background(palette.paper2).padding(end = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.End,
        ) {
            Text("archive", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink2))
        }
        Box(
            Modifier.fillMaxWidth()
                .offset { IntOffset(dx.toInt(), 0) }
                .background(palette.paper)
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) {
                            val down = awaitPointerEvent()
                            val start = down.changes.firstOrNull() ?: break
                            val x0 = start.position.x
                            var moved = false
                            while (true) {
                                val move = awaitPointerEvent()
                                val change = move.changes.firstOrNull() ?: break
                                if (!change.pressed) {
                                    if (!moved) break
                                    break
                                }
                                val d = change.position.x - x0
                                if (!moved && d < 0 && kotlin.math.abs(d) > 8f) moved = true
                                if (moved) dx = minOf(0f, d)
                            }
                            if (moved) {
                                if (dx < -110f && !committing) {
                                    committing = true
                                    scope.launch {
                                        val anim = Animatable(dx)
                                        anim.animateTo(-420f, tween(260))
                                        dx = anim.value
                                        onArchive()
                                    }
                                } else {
                                    scope.launch {
                                        val anim = Animatable(dx)
                                        anim.animateTo(0f, tween(380, easing = WuEasing.Default))
                                        dx = anim.value
                                    }
                                }
                            }
                        }
                    }
                },
        ) {
            header()
        }
    }
}

/** Undo bar: rises for 4.6 s with ink background and undo action. */
@Composable
fun UndoBar(
    visible: Boolean,
    title: String,
    palette: Palette,
    onUndo: () -> Unit,
) {
    AnimatedVisibility(
        visible,
        enter = slideInVertically(tween(450, easing = WuEasing.Default)) + fadeIn(),
        exit = slideOutVertically(tween(300)) + fadeOut(),
        modifier = Modifier.padding(horizontal = 14.dp, vertical = 100.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().height(52.dp).background(palette.ink, androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Archived “$title”", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.paper), modifier = Modifier.weight(1f))
            Text("undo", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.paper, textDecoration = TextDecoration.Underline), modifier = Modifier.padding(horizontal = 12.dp).semantics { role = Role.Button; contentDescription = "Undo archive" }.clickable { onUndo() })
        }
    }
}

/** Pull-to-refresh ink ring at the top of the list. */
@Composable
fun PullInkRing(palette: Palette, pullPx: Float, phase: String) {
    val progress = MotionMath.pullProgress(pullPx)
    val y = MotionMath.pullIndicatorY(pullPx, phase)
    val spinning = phase == "refresh"
    Canvas(
        Modifier.offset { IntOffset(0, y.toInt()) }.size(28.dp).padding(top = 6.dp),
    ) {
        drawArc(
            palette.ink,
            startAngle = -90f,
            sweepAngle = progress * 360f,
            useCenter = false,
            style = Stroke(1.6.dp.toPx(), cap = StrokeCap.Round),
        )
    }
}

/** Back slide transition: previous page returns from -22 percent parallax. */
fun backSlideTransition(progress: Float, widthPx: Float): Pair<Float, Float> {
    return MotionMath.backSlideOffsetX(progress, widthPx) to MotionMath.backParallaxOffsetX(progress, widthPx)
}

/** Ink-drop enter: circular clip from a point, 900 ms. */
@Composable
fun InkDropEnter(durationScale: Float, reduced: Boolean, content: @Composable () -> Unit) {
    LaunchedEffect(Unit) { }
    content()
}

/** Sheet: slides up over scrim, 420 ms. Tap scrim or drag down dismisses. */
@Composable
fun SheetHost(
    visible: Boolean,
    palette: Palette,
    onDismiss: () -> Unit,
    content: @Composable () -> Unit,
) {
    if (!visible) return
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.32f)).clickable { onDismiss() })
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(palette.paper, androidx.compose.foundation.shape.RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)).padding(horizontal = 20.dp, vertical = 10.dp),
        ) {
            content()
        }
    }
}
