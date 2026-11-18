package dev.ziran.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.data.AppState
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuFonts
import dev.ziran.android.protocol.ModelRouteView

/**
 * Model and effort: Model.dc.html. 250 dp riders header, model rows (54 dp),
 * then six ink dots for reasoning effort. Selected model has seal ring.
 */
val Efforts = listOf("minimal", "low", "medium", "high", "xhigh", "max")

@Composable
fun ModelScreen(
    palette: Palette,
    state: AppState,
    sceneKey: String = "riders",
    onBack: () -> Unit = {},
    onSelectModel: (ModelRouteView) -> Unit = {},
    onSetEffort: (String) -> Unit = {},
    reducedMotion: Boolean = false,
) {
    val runtime = state.runtime
    val selectedModel = runtime?.model
    val selectedEffort = runtime?.reasoningEffort ?: "medium"
    val effortIndex = Efforts.indexOf(selectedEffort).coerceIn(0, 5)
    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome(sceneKey, palette, headerHeightDp = 250, reducedMotion = reducedMotion)
        BackChevron(palette, onBack)
        Column(Modifier.fillMaxSize().padding(horizontal = 22.dp).padding(top = 196.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text("Model", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Medium, color = palette.ink))
                    Text("used from the next turn", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(top = 2.dp))
                }
            }
            Column(Modifier.padding(top = 10.dp)) {
                val models = state.models.ifEmpty {
                    listOf(
                        ModelRouteView("gpt-5.6-luna", "openai", "responses", true, "openai · responses", false),
                        ModelRouteView("claude-opus-5-5", "anthropic", "messages", true, "anthropic · your subscription", false),
                        ModelRouteView("deepseek-v4-flash", "command-code", "messages", true, "command-code · quick and light", false),
                    )
                }
                models.forEach { model ->
                    val on = model.model == selectedModel
                    val op = if (model.available) 1f else 0.45f
                    Row(
                        Modifier.fillMaxWidth().height(54.dp).clickable(enabled = model.available) { onSelectModel(model) }.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f).background(palette.paper).then(Modifier.fillMaxSize().graphicsLayer { alpha = op })) {
                            Text(model.model, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 13.5.sp, color = palette.ink))
                            Text(model.detail, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 14.sp, fontStyle = FontStyle.Italic, color = palette.ink3))
                        }
                        if (on) Box(Modifier.size(8.dp).background(palette.seal, androidx.compose.foundation.shape.CircleShape))
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(palette.line))
                }
            }
            Row(Modifier.padding(top = 22.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Effort", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 19.sp, color = palette.ink))
                Spacer(Modifier.width(8.dp))
                Text("how much ink", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.sp, fontStyle = FontStyle.Italic, color = palette.ink3))
            }
            Text("use this brush", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.sp, fontStyle = FontStyle.Italic, color = palette.ink3), modifier = Modifier.padding(top = 2.dp))
            Row(Modifier.padding(top = 8.dp).fillMaxWidth(), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween) {
                Efforts.forEachIndexed { index, effort ->
                    val ink = (0.12 + index * 0.17).toFloat()
                    val on = index == effortIndex
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f).semantics { role = Role.Button; contentDescription = "Effort $effort" }.clickable { onSetEffort(effort) }) {
                        Box(
                            Modifier.size(36.dp).background(
                                androidx.compose.ui.graphics.Color.Transparent,
                                androidx.compose.foundation.shape.CircleShape,
                            ).let {
                                if (on) it.background(palette.seal, androidx.compose.foundation.shape.CircleShape) else it
                            },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(Modifier.size(26.dp).background(palette.ink.copy(alpha = ink), androidx.compose.foundation.shape.CircleShape))
                        }
                        Text(effort, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.sp, color = palette.ink3), modifier = Modifier.padding(top = 6.dp))
                    }
                }
            }
        }
        // Confirm seal, rotated -3 deg as in the board.
        Box(Modifier.align(Alignment.BottomEnd).padding(end = 22.dp, bottom = 30.dp).size(52.dp).graphicsLayer { rotationZ = -3f }.semantics { role = Role.Button; contentDescription = "Confirm model" }.clickable { onBack() }) {
            dev.ziran.android.design.SendSeal(sizeDp = 52, backgroundColor = palette.seal, strokeColor = palette.onSeal)
        }
    }
}
