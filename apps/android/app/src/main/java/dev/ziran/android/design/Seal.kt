package dev.ziran.android.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.ziran.android.protocol.AgentKind

/**
 * Trigram seals, drawn on Canvas. Three strokes, solid is 1 and broken is 0,
 * read top to bottom. Strokes match Sessions.dc.html: viewBox 24, X 5 to 19,
 * Y 7, 12, 17, stroke 2.6, round caps. Broken strokes split 5-10.4, 13.6-19.
 */
object Trigrams {
    val Crane = listOf(1, 1, 1)
    val Fox = listOf(1, 0, 1)
    val Heron = listOf(0, 1, 0)
    val Owl = listOf(1, 0, 0)
    val Moth = listOf(0, 1, 1)

    fun forKind(kind: AgentKind): List<Int> = when (kind) {
        AgentKind.Crane -> Crane
        AgentKind.Fox -> Fox
        AgentKind.Heron -> Heron
        AgentKind.Owl -> Owl
        AgentKind.Moth -> Moth
        AgentKind.Unknown -> Crane
    }
}

fun AgentKind.bits(): List<Int> = Trigrams.forKind(this)

/** The five agents named in the design. Order matches Sessions board. */
val AgentKindsInBoardOrder = listOf(
    AgentKind.Crane, AgentKind.Fox, AgentKind.Heron, AgentKind.Owl, AgentKind.Moth,
)

@Composable
fun Seal(
    kind: AgentKind,
    modifier: Modifier = Modifier,
    sizeDp: Int = 30,
    backgroundColor: Color? = null,
    strokeColor: Color? = null,
    label: String = kind.displayName,
) {
    val bits = remember(kind) { kind.bits() }
    val size = sizeDp.dp
    Box(
        modifier = modifier
            .size(size)
            .then(if (backgroundColor != null) Modifier.background(backgroundColor, androidx.compose.foundation.shape.RoundedCornerShape(2.dp)) else Modifier)
            .semantics { role = Role.Image; contentDescription = "Agent $label" },
    ) {
        Canvas(Modifier.size(size)) {
            val strokeW = size.toPx() * (2.6f / 24f)
            val xs = size.toPx() * (5f / 24f)
            val xe = size.toPx() * (19f / 24f)
            val ys = listOf(7f, 12f, 17f).map { size.toPx() * (it / 24f) }
            val color = strokeColor ?: Color.White
            bits.forEachIndexed { index, bit ->
                val y = ys[index]
                if (bit == 1) {
                    drawLine(color, Offset(xs, y), Offset(xe, y), strokeW, androidx.compose.ui.graphics.StrokeCap.Round)
                } else {
                    val xm1 = size.toPx() * (10.4f / 24f)
                    val xm2 = size.toPx() * (13.6f / 24f)
                    drawLine(color, Offset(xs, y), Offset(xm1, y), strokeW, androidx.compose.ui.graphics.StrokeCap.Round)
                    drawLine(color, Offset(xm2, y), Offset(xe, y), strokeW, androidx.compose.ui.graphics.StrokeCap.Round)
                }
            }
        }
    }
}

/**
 * Send seal as a button: one node owns size, background, the brush stroke and
 * the click, so nothing sits between the finger and the handler.
 */
@Composable
fun SealButton(
    modifier: Modifier = Modifier,
    sizeDp: Int = 48,
    backgroundColor: Color,
    strokeColor: Color,
    label: String = "Send",
    onClick: () -> Unit,
) {
    val size = sizeDp.dp
    Box(
        modifier = modifier
            .size(size)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(2.dp))
            .background(backgroundColor)
            .clickable(onClick = onClick)
            .semantics { role = Role.Button; contentDescription = label },
    ) {
        Canvas(Modifier.size(size)) {
            val strokeW = size.toPx() * (2.6f / 24f)
            val path = Path().apply {
                moveTo(size.toPx() * (12f / 24f), size.toPx() * (19.5f / 24f))
                cubicTo(
                    size.toPx() * (11.6f / 24f), size.toPx() * (15f / 24f),
                    size.toPx() * (12.2f / 24f), size.toPx() * (10f / 24f),
                    size.toPx() * (12f / 24f), size.toPx() * (5.2f / 24f),
                )
                moveTo(size.toPx() * (6.6f / 24f), size.toPx() * (10.4f / 24f))
                cubicTo(
                    size.toPx() * (8.6f / 24f), size.toPx() * (8.6f / 24f),
                    size.toPx() * (10.4f / 24f), size.toPx() * (6.8f / 24f),
                    size.toPx() * (12f / 24f), size.toPx() * (5f / 24f),
                )
                cubicTo(
                    size.toPx() * (13.6f / 24f), size.toPx() * (6.8f / 24f),
                    size.toPx() * (15.4f / 24f), size.toPx() * (8.6f / 24f),
                    size.toPx() * (17.4f / 24f), size.toPx() * (10.4f / 24f),
                )
            }
            drawPath(path, strokeColor, style = Stroke(strokeW, cap = androidx.compose.ui.graphics.StrokeCap.Round))
        }
    }
}

/** Send seal: a single rising brush stroke, as drawn on Start and Main. */
@Composable
fun SendSeal(
    modifier: Modifier = Modifier,
    sizeDp: Int = 64,
    backgroundColor: Color,
    strokeColor: Color,
    label: String = "Send",
) {
    val size = sizeDp.dp
    Box(
        modifier = modifier
            .size(size)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(2.dp))
            .background(backgroundColor)
            .semantics { role = Role.Button; contentDescription = label },
    ) {
        Canvas(Modifier.size(size)) {
            val strokeW = size.toPx() * (2.6f / 24f)
            val path = Path().apply {
                moveTo(size.toPx() * (12f / 24f), size.toPx() * (19.5f / 24f))
                cubicTo(
                    size.toPx() * (11.6f / 24f), size.toPx() * (15f / 24f),
                    size.toPx() * (12.2f / 24f), size.toPx() * (10f / 24f),
                    size.toPx() * (12f / 24f), size.toPx() * (5.2f / 24f),
                )
                moveTo(size.toPx() * (6.6f / 24f), size.toPx() * (10.4f / 24f))
                cubicTo(
                    size.toPx() * (8.6f / 24f), size.toPx() * (8.6f / 24f),
                    size.toPx() * (10.4f / 24f), size.toPx() * (6.8f / 24f),
                    size.toPx() * (12f / 24f), size.toPx() * (5f / 24f),
                )
                cubicTo(
                    size.toPx() * (13.6f / 24f), size.toPx() * (6.8f / 24f),
                    size.toPx() * (15.4f / 24f), size.toPx() * (8.6f / 24f),
                    size.toPx() * (17.4f / 24f), size.toPx() * (10.4f / 24f),
                )
            }
            drawPath(path, strokeColor, style = Stroke(strokeW, cap = androidx.compose.ui.graphics.StrokeCap.Round))
        }
    }
}

/** Slightly rough-edged red seal square, as in the boards (filter "rough"). */
@Composable
fun SealSquare(
    modifier: Modifier = Modifier,
    sizeDp: Int = 30,
    color: Color,
) {
    Canvas(modifier.size(sizeDp.dp)) {
        val r = CornerRadius(size.toPx() * 0.08f, size.toPx() * 0.08f)
        drawRoundRect(color, cornerRadius = r)
    }
}

private fun Size.toPx(): Float = minOf(width, height)
