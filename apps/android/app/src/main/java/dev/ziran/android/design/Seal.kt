package dev.ziran.android.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.ziran.android.protocol.AgentKind
import kotlin.math.sin

/**
 * Trigram seals, drawn on Canvas. Three strokes, solid is 1 and broken is 0,
 * read top to bottom. Strokes match Sessions.dc.html: viewBox 24 at 70% of seal box,
 * X 5 to 19, Y 7, 12, 17, stroke 2.6, round caps. Broken strokes split 5-10.4, 13.6-19.
 */
object Trigrams {
    val Crane = listOf(1, 1, 1)
    val Fox = listOf(1, 0, 1)
    val Heron = listOf(0, 1, 0)
    val Owl = listOf(1, 0, 0)
    val Moth = listOf(0, 1, 1)
    val Wren = listOf(1, 1, 0)
    val Lynx = listOf(0, 0, 1)

    fun forKind(kind: AgentKind): List<Int> = when (kind) {
        AgentKind.Crane -> Crane
        AgentKind.Fox -> Fox
        AgentKind.Heron -> Heron
        AgentKind.Owl -> Owl
        AgentKind.Moth -> Moth
        AgentKind.Wren -> Wren
        AgentKind.Lynx -> Lynx
        AgentKind.Unknown -> Crane
    }
}

fun AgentKind.bits(): List<Int> = Trigrams.forKind(this)

/** The five agents named in the design. Order matches Sessions board. */
val AgentKindsInBoardOrder = listOf(
    AgentKind.Crane, AgentKind.Fox, AgentKind.Heron, AgentKind.Owl, AgentKind.Moth,
)

/**
 * Builds a deterministic slightly rough-edged seal rectangle path matching
 * the SVG `#rough` filter on the boards, with zero runtime filter cost.
 */
private fun buildRoughSealPath(w: Float, h: Float): Path {
    val p = Path()
    val amp = (minOf(w, h) * 0.014f).coerceAtMost(1.8f)
    val steps = 10
    fun jitter(idx: Int, phase: Float): Float =
        (sin(idx * 2.17f + phase) * 0.65f + sin(idx * 4.73f + phase * 1.9f) * 0.35f) * amp

    p.moveTo(amp, amp)
    // Top edge
    for (i in 1..steps) {
        val t = i.toFloat() / steps
        p.lineTo(amp + (w - 2 * amp) * t, amp + jitter(i, 0.3f))
    }
    // Right edge
    for (i in 1..steps) {
        val t = i.toFloat() / steps
        p.lineTo(w - amp + jitter(i, 1.7f), amp + (h - 2 * amp) * t)
    }
    // Bottom edge
    for (i in 1..steps) {
        val t = i.toFloat() / steps
        p.lineTo(w - amp - (w - 2 * amp) * t, h - amp + jitter(i, 3.1f))
    }
    // Left edge
    for (i in 1 until steps) {
        val t = i.toFloat() / steps
        p.lineTo(amp + jitter(i, 4.9f), h - amp - (h - 2 * amp) * t)
    }
    p.close()
    return p
}

private fun DrawScope.drawSendStroke(strokeColor: Color) {
    // Board: SVG viewBox 24x24 scaled to 62% of the seal square, centered.
    val box = minOf(size.width, size.height)
    val icon = box * 0.62f
    val ox = (size.width - icon) / 2f
    val oy = (size.height - icon) / 2f
    val u = icon / 24f
    val strokeW = 2.6f * u
    val path = Path().apply {
        moveTo(ox + 12f * u, oy + 19.5f * u)
        cubicTo(
            ox + 11.6f * u, oy + 15f * u,
            ox + 12.2f * u, oy + 10f * u,
            ox + 12f * u, oy + 5.2f * u,
        )
        moveTo(ox + 6.6f * u, oy + 10.4f * u)
        cubicTo(
            ox + 8.6f * u, oy + 8.6f * u,
            ox + 10.4f * u, oy + 6.8f * u,
            ox + 12f * u, oy + 5f * u,
        )
        cubicTo(
            ox + 13.6f * u, oy + 6.8f * u,
            ox + 15.4f * u, oy + 8.6f * u,
            ox + 17.4f * u, oy + 10.4f * u,
        )
    }
    drawPath(
        path = path,
        color = strokeColor,
        style = Stroke(strokeW, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )
}

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
            .semantics { role = Role.Image; contentDescription = "Agent $label" },
    ) {
        Canvas(Modifier.size(size)) {
            if (backgroundColor != null) {
                drawPath(buildRoughSealPath(this.size.width, this.size.height), backgroundColor)
            }
            // Board: SVG viewBox 24x24 scaled to 70% of the seal square, centered.
            val box = minOf(this.size.width, this.size.height)
            val icon = box * 0.70f
            val ox = (this.size.width - icon) / 2f
            val oy = (this.size.height - icon) / 2f
            val u = icon / 24f
            val strokeW = 2.6f * u
            val xs = ox + 5f * u
            val xe = ox + 19f * u
            val xm1 = ox + 10.4f * u
            val xm2 = ox + 13.6f * u
            val ys = floatArrayOf(oy + 7f * u, oy + 12f * u, oy + 17f * u)
            val color = strokeColor ?: Color.White
            bits.forEachIndexed { index, bit ->
                val y = ys[index]
                if (bit == 1) {
                    drawLine(color, Offset(xs, y), Offset(xe, y), strokeW, StrokeCap.Round)
                } else {
                    drawLine(color, Offset(xs, y), Offset(xm1, y), strokeW, StrokeCap.Round)
                    drawLine(color, Offset(xm2, y), Offset(xe, y), strokeW, StrokeCap.Round)
                }
            }
        }
    }
}

/**
 * Send seal as a button: Wu wei press sink (90% + -3° tilt + CONTEXT_CLICK haptic),
 * rough indigo square, 62% rising brush stroke, optional stamp animation.
 */
@Composable
fun SealButton(
    modifier: Modifier = Modifier,
    sizeDp: Int = 48,
    backgroundColor: Color,
    strokeColor: Color,
    label: String = "Send",
    stampTrigger: Int = 0,
    stampDelayMs: Int = WuDurations.StampDelay,
    animateStamp: Boolean = true,
    reducedMotion: Boolean = false,
    onClick: () -> Unit,
) {
    val size = sizeDp.dp
    val stampMod = if (animateStamp) {
        Modifier.wuStamp(trigger = stampTrigger, initialDelayMs = stampDelayMs, reducedMotion = reducedMotion)
    } else {
        Modifier
    }
    Box(
        modifier = modifier
            .then(stampMod)
            .size(size)
            .wuClickable(isSeal = true, reducedMotion = reducedMotion, onClick = onClick)
            .semantics { role = Role.Button; contentDescription = label },
    ) {
        Canvas(Modifier.size(size)) {
            drawPath(buildRoughSealPath(this.size.width, this.size.height), backgroundColor)
            drawSendStroke(strokeColor)
        }
    }
}

/** Non-interactive send seal drawing (used when parent handles click). */
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
            .semantics { role = Role.Button; contentDescription = label },
    ) {
        Canvas(Modifier.size(size)) {
            drawPath(buildRoughSealPath(this.size.width, this.size.height), backgroundColor)
            drawSendStroke(strokeColor)
        }
    }
}

/** Slightly rough-edged indigo seal square, as in the boards (filter "rough"). */
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
