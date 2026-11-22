package dev.ziran.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable

enum class RootTab(val label: String) {
    Home("home"),
    Threads("threads"),
    Settings("settings"),
}

/**
 * Bottom navigation bar (`Home.dc.html`, `Sessions.dc.html`, `Settings.dc.html`):
 * italic words (`home · threads · settings`) with an indigo dot under the active one.
 */
@Composable
fun WuBottomNav(
    activeTab: RootTab,
    palette: Palette,
    reducedMotion: Boolean,
    onSelect: (RootTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val dur = if (reducedMotion) WuDurations.ReducedFade else 260
    Row(
        modifier
            .fillMaxWidth()
            .background(palette.paper)
            .drawBehind {
                drawLine(
                    color = palette.line,
                    start = Offset(0f, 0f),
                    end = Offset(size.width, 0f),
                    strokeWidth = 1.dp.toPx(),
                )
            }
            .navigationBarsPadding()
            .height(62.dp)
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RootTab.entries.forEach { tab ->
            val on = tab == activeTab
            val textColor by animateColorAsState(
                targetValue = if (on) palette.ink else palette.ink3,
                animationSpec = tween(dur, easing = WuEasing.Default),
                label = "nav-text-${tab.name}",
            )
            val dotScale by animateFloatAsState(
                targetValue = if (on) 1f else 0f,
                animationSpec = tween(dur, easing = WuEasing.Default),
                label = "nav-dot-${tab.name}",
            )
            Column(
                Modifier
                    .weight(1f)
                    .height(52.dp)
                    .wuClickable(reducedMotion = reducedMotion, onClick = { onSelect(tab) })
                    .semantics {
                        role = Role.Tab
                        selected = on
                        contentDescription = tab.label
                    },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    tab.label,
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 17.sp,
                        fontStyle = FontStyle.Italic,
                        color = textColor,
                    ),
                )
                Spacer(Modifier.height(4.dp))
                Box(
                    Modifier
                        .size(5.dp)
                        .graphicsLayer {
                            scaleX = dotScale
                            scaleY = dotScale
                            alpha = dotScale
                        }
                        .background(palette.seal, CircleShape),
                )
            }
        }
    }
}

/**
 * Floating 52 dp indigo new-thread seal (`+`), positioned above the bottom nav bar.
 */
@Composable
fun FloatingNewThreadSeal(
    palette: Palette,
    reducedMotion: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .navigationBarsPadding()
            .padding(end = 20.dp, bottom = 78.dp)
            .size(52.dp)
            .wuClickable(isSeal = true, reducedMotion = reducedMotion, onClick = onClick)
            .semantics { role = Role.Button; contentDescription = "New thread" },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(52.dp)) {
            drawRoundRect(
                color = palette.seal,
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx(), 3.dp.toPx()),
            )
            val u = size.minDimension / 24f
            val stroke = 2.2f * u
            drawLine(palette.onSeal, Offset(12f * u, 6.5f * u), Offset(12f * u, 17.5f * u), stroke, StrokeCap.Round)
            drawLine(palette.onSeal, Offset(6.5f * u, 12f * u), Offset(17.5f * u, 12f * u), stroke, StrokeCap.Round)
        }
    }
}
