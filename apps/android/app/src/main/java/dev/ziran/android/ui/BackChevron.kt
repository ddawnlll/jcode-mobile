package dev.ziran.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.wuClickable

/**
 * Brush-drawn back chevron (`<`) at left:8 top:50, 44x44 as on Model and Scenes.
 * Exact SVG path from build3.py: `M15 5c-3 2.5-5.5 4.6-7 7 1.5 2.4 4 4.5 7 7`.
 */
@Composable
fun BackChevron(
    palette: Palette,
    onBack: () -> Unit,
    label: String = "Back",
    reducedMotion: Boolean = false,
) {
    Box(
        Modifier
            .padding(start = 8.dp, top = 50.dp)
            .size(44.dp)
            .wuClickable(reducedMotion = reducedMotion, onClick = onBack)
            .semantics { role = Role.Button; contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(22.dp)) {
            val u = minOf(size.width, size.height) / 24f
            val p = Path().apply {
                moveTo(15f * u, 5f * u)
                cubicTo(12f * u, 7.5f * u, 9.5f * u, 9.6f * u, 8f * u, 12f * u)
                cubicTo(9.5f * u, 14.4f * u, 12f * u, 16.5f * u, 15f * u, 19f * u)
            }
            drawPath(
                p,
                palette.ink,
                style = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
    }
}

/**
 * Three-stroke threads menu button at left:8 top:50, 44x44 as on Main/Live.
 * Exact SVG path from build3.py: `M4 7.5h15 M4 12h10 M4 16.5h13`.
 */
@Composable
fun ThreadsMenuButton(
    palette: Palette,
    onClick: () -> Unit,
    reducedMotion: Boolean = false,
) {
    Box(
        Modifier
            .padding(start = 8.dp, top = 50.dp)
            .size(44.dp)
            .wuClickable(reducedMotion = reducedMotion, onClick = onClick)
            .semantics { role = Role.Button; contentDescription = "Threads" },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(22.dp)) {
            val u = minOf(size.width, size.height) / 24f
            val p = Path().apply {
                moveTo(4f * u, 7.5f * u); lineTo(19f * u, 7.5f * u)
                moveTo(4f * u, 12f * u); lineTo(14f * u, 12f * u)
                moveTo(4f * u, 16.5f * u); lineTo(17f * u, 16.5f * u)
            }
            drawPath(
                p,
                palette.ink,
                style = Stroke(1.7.dp.toPx(), cap = StrokeCap.Round),
            )
        }
    }
}
