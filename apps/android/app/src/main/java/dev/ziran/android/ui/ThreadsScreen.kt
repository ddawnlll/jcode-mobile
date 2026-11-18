package dev.ziran.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.Seal
import dev.ziran.android.design.WuFonts
import dev.ziran.android.protocol.AgentKind
import dev.ziran.android.protocol.SessionSummary

/**
 * Threads screen: Sessions.dc.html. 280 dp pavilion painting, title block,
 * then rows: 30 dp seal, 19/25 title, 14.5/20 italic subtitle, state mark.
 */
@Composable
fun ThreadsScreen(
    palette: Palette,
    sessions: List<SessionSummary>,
    serverName: String = "studio-vps",
    sceneKey: String = "pavilion",
    onOpen: (String) -> Unit = {},
    onScenes: () -> Unit = {},
    reducedMotion: Boolean = false,
) {
    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome(sceneKey, palette, headerHeightDp = 280, reducedMotion = reducedMotion)
        Column(Modifier.fillMaxSize().padding(horizontal = 22.dp)) {
            Row(Modifier.padding(top = 54.dp, end = 0.dp).fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics { role = Role.Button; contentDescription = "Server $serverName. Scenes and theme." }) {
                    Box(Modifier.size(6.dp).background(palette.green, androidx.compose.foundation.shape.CircleShape))
                    Spacer(Modifier.width(8.dp))
                    Text(serverName, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, color = palette.ink2))
                }
            }
            Spacer(Modifier.height(226.dp - 54.dp - 40.dp + 40.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text("Threads", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Medium, color = palette.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("~/src · ${sessions.size} sessions", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(top = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            LazyColumn(Modifier.fillMaxWidth().weight(1f).padding(top = 10.dp)) {
                items(sessions) { session ->
                    ThreadRow(session, palette, onClick = { onOpen(session.sessionId) })
                }
            }
        }
        Composer(
            palette = palette,
            placeholder = "begin a new thread…",
            modifier = Modifier.align(Alignment.BottomCenter).padding(horizontal = 20.dp).padding(bottom = 22.dp),
        )
    }
}

@Composable
private fun ThreadRow(session: SessionSummary, palette: Palette, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Seal(kind = session.agentKind, sizeDp = 30, backgroundColor = palette.seal, strokeColor = palette.onSeal)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(session.displayTitle, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 19.sp, lineHeight = 25.sp, color = palette.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitleFor(session), style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 14.5.sp, lineHeight = 20.sp, fontStyle = FontStyle.Italic, color = palette.ink3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(14.dp))
        StateMark(session, palette)
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(palette.line))
}

private fun subtitleFor(session: SessionSummary): String {
    val agent = session.agentKind.displayName
    return when {
        session.status == "waiting_for_permission" -> "$agent asks to run a command"
        session.status == "running" -> "$agent · working"
        session.status == "done" -> "$agent · done"
        session.status == "resting" -> "$agent · resting"
        session.agentLabel != null -> "$agent · ${session.status}"
        else -> session.status.ifEmpty { "idle" }
    }
}

@Composable
private fun StateMark(session: SessionSummary, palette: Palette) {
    when {
        session.status == "waiting_for_permission" -> Box(Modifier.size(10.dp).background(palette.seal, androidx.compose.foundation.shape.CircleShape))
        session.status == "running" -> Text("⠋", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 15.sp, color = palette.blue))
        session.status == "done" -> Canvas(Modifier.size(15.dp)) {
            drawArc(palette.seal, startAngle = -90f, sweepAngle = 360f, useCenter = false, style = Stroke(1.6.dp.toPx()))
        }
        else -> Box(Modifier.size(6.dp).background(palette.ink3.copy(alpha = 0.6f), androidx.compose.foundation.shape.CircleShape))
    }
}

/** Composer: ink underline, 17 sp Garamond input, 48 dp send seal. */
@Composable
fun Composer(
    palette: Palette,
    placeholder: String,
    modifier: Modifier = Modifier,
    value: String = "",
    onValueChange: (String) -> Unit = {},
    onSend: () -> Unit = {},
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            androidx.compose.foundation.text.BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink),
                modifier = Modifier.fillMaxWidth().height(50.dp),
                singleLine = true,
            )
            // Ink underline, hand-drawn curve as in the board SVG.
            Canvas(Modifier.fillMaxWidth().height(6.dp).offset(y = -7.dp)) {
                val p = androidx.compose.ui.graphics.Path()
                p.moveTo(2f, size.height * 0.7f)
                p.cubicTo(size.width * 0.2f, size.height * 0.2f, size.width * 0.45f, size.height * 0.9f, size.width * 0.7f, size.height * 0.4f)
                p.cubicTo(size.width * 0.85f, size.height * 0.3f, size.width * 0.95f, size.height * 0.5f, size.width - 2f, size.height * 0.4f)
                drawPath(p, palette.ink.copy(alpha = 0.55f), style = Stroke(2.4.dp.toPx(), cap = StrokeCap.Round))
            }
        }
        Spacer(Modifier.width(10.dp))
        Box(Modifier.size(48.dp).clickable { onSend() }.semantics { role = Role.Button; contentDescription = "Send" }) {
            dev.ziran.android.design.SendSeal(sizeDp = 48, backgroundColor = palette.seal, strokeColor = palette.onSeal)
        }
    }
}
