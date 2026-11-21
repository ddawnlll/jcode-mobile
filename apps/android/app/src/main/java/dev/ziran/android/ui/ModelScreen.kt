package dev.ziran.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
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
import dev.ziran.android.data.AppState
import dev.ziran.android.design.Palette
import dev.ziran.android.design.SealButton
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable
import dev.ziran.android.protocol.ModelRouteView

/**
 * Model and effort: Model.dc.html. 250 dp riders header, back chevron,
 * transparent 54 dp model rows with 18 dp drawing seal ring, six ink dots
 * with animated seal border ring, and bottom-right "use this brush" + confirm seal.
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
    // Optimistic local selection so the ring draws immediately on tap while the RPC lands.
    var pickedModel by remember { mutableStateOf(runtime?.model ?: "gpt-5.6-luna") }
    var pickedEffort by remember { mutableStateOf(runtime?.reasoningEffort ?: "high") }
    LaunchedEffect(runtime?.model) { runtime?.model?.let { pickedModel = it } }
    LaunchedEffect(runtime?.reasoningEffort) { runtime?.reasoningEffort?.let { pickedEffort = it } }
    val effortIndex = Efforts.indexOf(pickedEffort).coerceIn(0, 5)

    val models = remember(state.models) {
        state.models.ifEmpty {
            listOf(
                ModelRouteView("gpt-5.6-luna", "openai", "responses", true, "openai · responses", false),
                ModelRouteView("claude-opus-5-5", "anthropic", "messages", true, "anthropic · your subscription", false),
                ModelRouteView("deepseek-v4-flash", "command-code", "messages", true, "command-code · quick and light", false),
                ModelRouteView("gpt-5.2", "openai", "responses", false, "openai · not in your plan", false),
            )
        }
    }

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome(sceneKey, palette, headerHeightDp = 250, reducedMotion = reducedMotion)

        Column(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 22.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(Modifier.height(196.dp))
            Text(
                "Model",
                style = TextStyle(
                    fontFamily = WuFonts.Garamond,
                    fontSize = 28.sp,
                    lineHeight = 34.sp,
                    fontWeight = FontWeight.Medium,
                    color = palette.ink,
                ),
            )
            Text(
                "used from the next turn",
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                modifier = Modifier.padding(top = 2.dp),
            )

            Spacer(Modifier.height(10.dp))
            Column(Modifier.fillMaxWidth()) {
                models.forEach { model ->
                    val on = model.model == pickedModel
                    val op = if (model.available) 1f else 0.45f
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .height(54.dp)
                            .graphicsLayer { alpha = op }
                            .wuClickable(
                                enabled = model.available,
                                reducedMotion = reducedMotion,
                                onClick = {
                                    pickedModel = model.model
                                    onSelectModel(model)
                                },
                            )
                            .semantics { role = Role.RadioButton; contentDescription = model.model },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                model.model,
                                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 13.5.sp, color = palette.ink),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                model.detail,
                                style = TextStyle(
                                    fontFamily = WuFonts.Garamond,
                                    fontSize = 14.sp,
                                    fontStyle = FontStyle.Italic,
                                    color = palette.ink3,
                                ),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        if (on) {
                            DrawingSealRing(
                                color = palette.seal,
                                sizeDp = 18,
                                key = model.model,
                                reducedMotion = reducedMotion,
                            )
                        }
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(palette.line))
                }
            }

            Row(
                Modifier.fillMaxWidth().padding(top = 22.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom,
            ) {
                Text(
                    "Effort",
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 19.sp, color = palette.ink),
                )
                Text(
                    "how much ink",
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 15.sp,
                        fontStyle = FontStyle.Italic,
                        color = palette.ink3,
                    ),
                )
            }

            Row(
                Modifier.padding(top = 8.dp).fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Efforts.forEachIndexed { index, effort ->
                    val inkAlpha = (0.12f + index * 0.17f).coerceAtMost(1f)
                    val on = index == effortIndex
                    val ringColor by animateColorAsState(
                        targetValue = if (on) palette.seal else Color.Transparent,
                        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 300, easing = WuEasing.Default),
                        label = "effort-ring-$effort",
                    )
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier
                            .weight(1f)
                            .height(70.dp)
                            .wuClickable(
                                reducedMotion = reducedMotion,
                                onClick = {
                                    pickedEffort = effort
                                    onSetEffort(effort)
                                },
                            )
                            .semantics { role = Role.RadioButton; contentDescription = effort },
                    ) {
                        Box(
                            Modifier
                                .size(38.dp)
                                .border(1.6.dp, ringColor, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                Modifier
                                    .size(26.dp)
                                    .background(palette.ink.copy(alpha = inkAlpha), CircleShape),
                            )
                        }
                        Text(
                            effort,
                            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.sp, color = palette.ink3),
                            modifier = Modifier.padding(top = 6.dp),
                            maxLines = 1,
                        )
                    }
                }
            }
            Spacer(Modifier.height(110.dp))
        }

        // Bottom-right: "use this brush" + confirm seal rotated -3 deg.
        Row(
            Modifier
                .align(Alignment.BottomEnd)
                .navigationBarsPadding()
                .padding(end = 22.dp, bottom = 30.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "use this brush",
                style = TextStyle(
                    fontFamily = WuFonts.Garamond,
                    fontSize = 15.sp,
                    fontStyle = FontStyle.Italic,
                    color = palette.ink3,
                ),
            )
            Spacer(Modifier.width(12.dp))
            SealButton(
                sizeDp = 52,
                backgroundColor = palette.seal,
                strokeColor = palette.onSeal,
                label = "Use this model",
                animateStamp = false,
                reducedMotion = reducedMotion,
                modifier = Modifier.graphicsLayer { rotationZ = -3f },
                onClick = onBack,
            )
        }

        // Top-left back chevron sits above the scroll column so taps are never swallowed.
        BackChevron(palette, onBack, label = "Back to the thread", reducedMotion = reducedMotion)
    }
}

/** 900 ms self-drawing vermilion selection ring (`ringdraw` in Model.dc.html). */
@Composable
private fun DrawingSealRing(
    color: Color,
    sizeDp: Int,
    key: Any,
    reducedMotion: Boolean,
) {
    val sweep = remember(key) { Animatable(if (reducedMotion) 1f else 0f) }
    LaunchedEffect(key, reducedMotion) {
        if (reducedMotion) {
            sweep.snapTo(1f)
        } else {
            sweep.animateTo(1f, tween(WuDurations.RingDraw, easing = WuEasing.Default))
        }
    }
    Canvas(Modifier.size(sizeDp.dp)) {
        val strokePx = 1.6.dp.toPx()
        drawArc(
            color = color,
            startAngle = -90f,
            sweepAngle = 360f * sweep.value,
            useCenter = false,
            style = Stroke(strokePx, cap = StrokeCap.Round),
        )
    }
}
