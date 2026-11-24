package dev.ziran.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.BuildConfig
import dev.ziran.android.data.AppState
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.sceneByKey
import dev.ziran.android.design.wuClickable

/**
 * Settings tab (`Settings.dc.html` / `Settings-Night.dc.html`).
 * All settings persist in DataStore. Toggles slide over 450 ms.
 */
@Composable
fun SettingsScreen(
    palette: Palette,
    state: AppState,
    onPairAnother: () -> Unit,
    onForgetServer: (String) -> Unit,
    onSelectTheme: (String) -> Unit,
    onOpenScenes: () -> Unit,
    onOpenDefaultModel: () -> Unit,
    onSelectSteerDefault: (String) -> Unit,
    onToggleNotifyWaiting: (Boolean) -> Unit,
    onToggleNotifyDone: (Boolean) -> Unit,
    onToggleNotifyOnlyClosed: (Boolean) -> Unit,
    reducedMotion: Boolean = false,
) {
    val steerNotes = mapOf(
        "steer" to "Your message reaches the agent at its next step. Nothing stops.",
        "wait" to "Your message waits until the agent finishes, then goes.",
        "ask" to "Each time, Ziran asks which you mean.",
    )
    val sceneLabel = sceneByKey(state.scene).label
    val defaultModelLabel = listOfNotNull(
        state.defaultModel ?: state.runtime?.model,
        state.defaultEffort ?: state.runtime?.reasoningEffort,
    ).joinToString(" · ").ifEmpty { "server default" }

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome("sage_under_pine", palette, headerHeightDp = 170, reducedMotion = reducedMotion)

        val safeTop = rememberSafeTopInsetDp()
        Column(
            Modifier
                .fillMaxSize()
                .safeTopAndHorizontalPadding()
                .padding(horizontal = 22.dp),
        ) {
            Spacer(Modifier.height(contentTopSpacerDp(112, safeTop, minClearanceDp = 12).dp))

            Text(
                "Settings",
                style = TextStyle(
                    fontFamily = WuFonts.Garamond,
                    fontSize = 30.sp,
                    lineHeight = 36.sp,
                    fontWeight = FontWeight.Medium,
                    color = palette.ink,
                ),
            )

            Spacer(Modifier.height(8.dp))

            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 96.dp),
            ) {
                // Servers
                SettingsLabel("servers", palette)
                val servers = state.pairedServers.ifEmpty { listOfNotNull(state.serverName) }
                servers.forEach { serverId ->
                    val isCurrent = serverId == state.serverName
                    val online = isCurrent && state.connection == "connected"
                    val sub = if (online) {
                        "connected · protocol ${state.protocolVersion ?: 4}"
                    } else if (isCurrent) {
                        "offline"
                    } else {
                        "paired"
                    }
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = 52.dp)
                            .drawBehind {
                                drawLine(palette.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                            }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(7.dp).background(if (online) palette.green else palette.ink3, CircleShape))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                serverId,
                                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                sub,
                                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.5.sp, color = palette.ink3),
                            )
                        }
                        Text(
                            "forget",
                            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                            modifier = Modifier
                                .wuClickable(reducedMotion = reducedMotion, onClick = { onForgetServer(serverId) })
                                .padding(horizontal = 8.dp, vertical = 6.dp)
                                .semantics { role = Role.Button; contentDescription = "Forget $serverId" },
                        )
                    }
                }
                SettingsLinkRow(
                    title = "Pair another server",
                    value = null,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onClick = onPairAnother,
                )

                // Appearance
                SettingsLabel("appearance", palette, topDp = 18)
                WuSegmentedControl(
                    options = listOf("day" to "Day", "night" to "Night", "system" to "Follow phone"),
                    selectedKey = state.themeMode,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onSelect = onSelectTheme,
                )
                Spacer(Modifier.height(4.dp))
                SettingsLinkRow(
                    title = "Scene",
                    value = sceneLabel,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onClick = onOpenScenes,
                )

                // Model
                SettingsLabel("model", palette, topDp = 18)
                SettingsLinkRow(
                    title = "For new threads",
                    value = defaultModelLabel,
                    monoValue = true,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onClick = onOpenDefaultModel,
                )

                // While an agent works
                SettingsLabel("while an agent works", palette, topDp = 18)
                WuSegmentedControl(
                    options = listOf("steer" to "Steer", "wait" to "Wait", "ask" to "Ask"),
                    selectedKey = state.steerDefault,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onSelect = onSelectSteerDefault,
                )
                Text(
                    "${steerNotes[state.steerDefault] ?: steerNotes["steer"]} Stop is always one tap away.",
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 14.5.sp,
                        lineHeight = 20.sp,
                        fontStyle = FontStyle.Italic,
                        color = palette.ink3,
                    ),
                    modifier = Modifier.padding(top = 6.dp, bottom = 6.dp),
                )

                // Notifications
                SettingsLabel("notifications", palette, topDp = 14)
                SettingsToggleRow(
                    title = "Waiting for you",
                    checked = state.notifyWaiting,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onToggle = { onToggleNotifyWaiting(!state.notifyWaiting) },
                )
                SettingsToggleRow(
                    title = "Work finished",
                    checked = state.notifyDone,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onToggle = { onToggleNotifyDone(!state.notifyDone) },
                )
                SettingsToggleRow(
                    title = "Only when Ziran is closed",
                    checked = state.notifyOnlyClosed,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onToggle = { onToggleNotifyOnlyClosed(!state.notifyOnlyClosed) },
                )

                // About
                SettingsLabel("about", palette, topDp = 18)
                SettingsInfoRow("Ziran", BuildConfig.VERSION_NAME, palette)
                SettingsInfoRow("Adapter", state.adapterVersion ?: "from the server", palette)
            }
        }
    }
}

@Composable
private fun SettingsLabel(text: String, palette: Palette, topDp: Int = 8) {
    Text(
        text,
        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
        modifier = Modifier.padding(top = topDp.dp, bottom = 6.dp),
    )
}

@Composable
internal fun WuSegmentedControl(
    options: List<Pair<String, String>>,
    selectedKey: String,
    palette: Palette,
    reducedMotion: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val dur = if (reducedMotion) WuDurations.ReducedFade else 300
    Row(
        modifier
            .fillMaxWidth()
            .background(palette.paper2, RoundedCornerShape(9.dp))
            .padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEach { (key, label) ->
            val on = key == selectedKey
            val bg by animateColorAsState(
                targetValue = if (on) palette.paper else palette.paper2,
                animationSpec = tween(dur, easing = WuEasing.Default),
                label = "seg-bg-$key",
            )
            val fg by animateColorAsState(
                targetValue = if (on) palette.ink else palette.ink2,
                animationSpec = tween(dur, easing = WuEasing.Default),
                label = "seg-fg-$key",
            )
            Box(
                Modifier
                    .weight(1f)
                    .height(34.dp)
                    .background(bg, RoundedCornerShape(7.dp))
                    .wuClickable(reducedMotion = reducedMotion, onClick = { onSelect(key) })
                    .semantics { role = Role.Tab; contentDescription = label },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.sp, color = fg),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun SettingsLinkRow(
    title: String,
    value: String?,
    palette: Palette,
    reducedMotion: Boolean,
    monoValue: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 52.dp)
            .wuClickable(reducedMotion = reducedMotion, onClick = onClick)
            .drawBehind {
                drawLine(palette.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
            }
            .semantics { role = Role.Button; contentDescription = title },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink))
        Spacer(Modifier.weight(1f))
        if (value != null) {
            Text(
                value,
                style = if (monoValue) {
                    TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, color = palette.ink3)
                } else {
                    TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.sp, fontStyle = FontStyle.Italic, color = palette.ink3)
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.width(6.dp))
        }
        Text("›", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink3))
    }
}

@Composable
private fun SettingsToggleRow(
    title: String,
    checked: Boolean,
    palette: Palette,
    reducedMotion: Boolean,
    onToggle: () -> Unit,
) {
    val dur = if (reducedMotion) WuDurations.ReducedFade else 450
    val trackBg by animateColorAsState(
        targetValue = if (checked) palette.seal else palette.paper,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 350, easing = WuEasing.Default),
        label = "tog-bg",
    )
    val trackBorder by animateColorAsState(
        targetValue = if (checked) palette.seal else palette.ink3,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 350, easing = WuEasing.Default),
        label = "tog-border",
    )
    val thumbColor by animateColorAsState(
        targetValue = if (checked) palette.onSeal else palette.ink3,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 350, easing = WuEasing.Default),
        label = "tog-thumb",
    )
    val thumbX by animateDpAsState(
        targetValue = if (checked) 21.dp else 3.dp,
        animationSpec = tween(dur, easing = WuEasing.Default),
        label = "tog-x",
    )

    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 52.dp)
            .wuClickable(reducedMotion = reducedMotion, onClick = onToggle)
            .drawBehind {
                drawLine(palette.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
            }
            .semantics {
                role = Role.Switch
                toggleableState = if (checked) ToggleableState.On else ToggleableState.Off
                contentDescription = title
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink))
        Spacer(Modifier.weight(1f))
        Box(
            Modifier
                .width(44.dp)
                .height(26.dp)
                .background(trackBg, RoundedCornerShape(13.dp))
                .border(1.5.dp, trackBorder, RoundedCornerShape(13.dp)),
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(
                Modifier
                    .offset(x = thumbX)
                    .size(17.dp)
                    .background(thumbColor, CircleShape),
            )
        }
    }
}

@Composable
private fun SettingsInfoRow(title: String, value: String, palette: Palette) {
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 52.dp)
            .drawBehind {
                drawLine(palette.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink))
        Spacer(Modifier.weight(1f))
        Text(value, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, color = palette.ink3))
    }
}
