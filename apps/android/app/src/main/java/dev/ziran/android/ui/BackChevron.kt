package dev.ziran.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.ziran.android.design.Palette

/** Hamburger back button at left:8 top:50 44x44 as in Main and Model. */
@Composable
fun BackChevron(palette: Palette, onBack: () -> Unit) {
    Box(
        Modifier.size(44.dp).semantics { role = Role.Button; contentDescription = "Back" }.clickable { onBack() },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(22.dp)) {
            val p = androidx.compose.ui.graphics.Path()
            p.moveTo(size.width * 0.15f, size.height * 0.35f)
            p.lineTo(size.width * 0.85f, size.height * 0.35f)
            p.moveTo(size.width * 0.15f, size.height * 0.55f)
            p.lineTo(size.width * 0.55f, size.height * 0.55f)
            p.moveTo(size.width * 0.15f, size.height * 0.75f)
            p.lineTo(size.width * 0.7f, size.height * 0.75f)
            drawPath(p, palette.ink, style = Stroke(1.7.dp.toPx(), cap = StrokeCap.Round))
        }
    }
}
