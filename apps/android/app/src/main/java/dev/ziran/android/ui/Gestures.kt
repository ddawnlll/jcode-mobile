package dev.ziran.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
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
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import kotlin.math.roundToInt

/**
 * Shared gesture surfaces from Flow.dc.html: undo bar, pull ring and sheet.
 * Row swipe and long-press live on the row itself in ThreadsScreen so the
 * horizontal drag and the tap detector can arbitrate through Compose.
 */

/** Undo bar: rises for 4.6 s with ink background and one undo action. */
@Composable
fun UndoBar(
    visible: Boolean,
    title: String,
    palette: Palette,
    onUndo: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible,
        enter = slideInVertically(tween(450, easing = WuEasing.Default)) + fadeIn(),
        exit = slideOutVertically(tween(300)) + fadeOut(),
        modifier = modifier.padding(horizontal = 14.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .background(palette.ink, androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Archived \u201C$title\u201D",
                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.paper),
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            Text(
                "undo",
                style = TextStyle(
                    fontFamily = WuFonts.Mono,
                    fontSize = 12.sp,
                    color = palette.paper,
                    textDecoration = TextDecoration.Underline,
                ),
                modifier = Modifier
                    .padding(horizontal = 12.dp)
                    .semantics { role = Role.Button; contentDescription = "Undo archive" }
                    .clickable { onUndo() },
            )
        }
    }
}

/** Pull-to-refresh ink ring at the top of the list. */
@Composable
fun PullInkRing(palette: Palette, pullPx: Float, phase: String) {
    val progress = MotionMath.pullProgress(pullPx)
    val y = MotionMath.pullIndicatorY(pullPx, phase)
    Canvas(
        Modifier
            .offset { IntOffset(0, y.roundToInt()) }
            .size(28.dp)
            .padding(top = 6.dp),
    ) {
        drawArc(
            palette.ink,
            startAngle = -90f,
            sweepAngle = if (phase == "refresh") 300f else progress * 360f,
            useCenter = false,
            style = Stroke(1.6.dp.toPx(), cap = StrokeCap.Round),
        )
    }
}

/** Back slide transition: page leaves 0 to 100 percent, previous returns from -22 percent. */
fun backSlideTransition(progress: Float, widthPx: Float): Pair<Float, Float> =
    MotionMath.backSlideOffsetX(progress, widthPx) to MotionMath.backParallaxOffsetX(progress, widthPx)

/** Sheet: slides up over a scrim, 420 ms. Tap the scrim to dismiss. */
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
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(
                    palette.paper,
                    androidx.compose.foundation.shape.RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
                )
                .padding(horizontal = 20.dp, vertical = 10.dp),
        ) {
            content()
        }
    }
}
