package dev.ziran.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalWindowInfo
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
import dev.ziran.android.design.Scenes
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.paintingColorFilter
import dev.ziran.android.design.rememberPaintingBitmap
import dev.ziran.android.design.wuClickable

/**
 * Scene and theme: Scenes.dc.html. 230 dp cross-fading header, back chevron,
 * Ink day/night pill switch, 3-column grid of twelve 78 dp rounded thumbnails
 * with animated 3 dp-outset seal outline and night colour treatment.
 */
@Composable
fun ScenesScreen(
    palette: Palette,
    selectedScene: String = "peaks",
    themeMode: String = "system",
    onBack: () -> Unit = {},
    onSelectScene: (String) -> Unit = {},
    onSelectTheme: (String) -> Unit = {},
    reducedMotion: Boolean = false,
) {
    val thumbWidthPx = (LocalWindowInfo.current.containerSize.width / 3).coerceAtLeast(256)
    val thumbColorFilter = remember(palette.nightFactor) { paintingColorFilter(palette.nightFactor) }

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome(sceneKey = selectedScene, palette = palette, headerHeightDp = 230, reducedMotion = reducedMotion)

        val safeTop = rememberSafeTopInsetDp()
        Column(
            Modifier
                .fillMaxSize()
                .safeTopAndHorizontalPadding()
                .padding(top = contentTopSpacerDp(180, safeTop, minClearanceDp = 56).dp)
                .navigationBarsPadding(),
        ) {
            Text(
                "Scene",
                style = TextStyle(
                    fontFamily = WuFonts.Garamond,
                    fontSize = 28.sp,
                    lineHeight = 34.sp,
                    fontWeight = FontWeight.Medium,
                    color = palette.ink,
                ),
                modifier = Modifier.padding(horizontal = 22.dp),
            )
            Text(
                "behind every thread",
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                modifier = Modifier.padding(horizontal = 22.dp).padding(top = 2.dp),
            )

            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "Ink",
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink),
                )
                ThemeSwitch(
                    isNight = palette.isNight,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onSelect = onSelectTheme,
                )
            }

            Spacer(Modifier.height(8.dp))
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                modifier = Modifier.fillMaxWidth().weight(1f).padding(horizontal = 18.dp),
                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(Scenes, key = { it.key }) { scene ->
                    val on = scene.key == selectedScene
                    val ringColor by animateColorAsState(
                        targetValue = if (on) palette.seal else Color.Transparent,
                        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 300, easing = WuEasing.Default),
                        label = "scene-ring-${scene.key}",
                    )
                    val bitmap = rememberPaintingBitmap(scene.drawableRes, thumbWidthPx)
                    Column(
                        Modifier
                            .wuClickable(reducedMotion = reducedMotion, onClick = { onSelectScene(scene.key) })
                            .semantics { role = Role.RadioButton; contentDescription = scene.label },
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(78.dp)
                                .drawBehind {
                                    if (ringColor.alpha > 0.01f) {
                                        val offset = 3.dp.toPx()
                                        val strokeW = 1.6.dp.toPx()
                                        val r = 6.dp.toPx()
                                        drawRoundRect(
                                            color = ringColor,
                                            topLeft = Offset(-offset, -offset),
                                            size = Size(size.width + offset * 2f, size.height + offset * 2f),
                                            cornerRadius = CornerRadius(r, r),
                                            style = Stroke(strokeW),
                                        )
                                    }
                                }
                                .clip(RoundedCornerShape(4.dp))
                                .background(palette.paper2),
                        ) {
                            Image(
                                bitmap = bitmap,
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                colorFilter = thumbColorFilter,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                        Text(
                            scene.label,
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 13.5.sp,
                                lineHeight = 16.sp,
                                color = palette.ink,
                            ),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 5.dp),
                        )
                    }
                }
                item(span = { GridItemSpan(3) }, key = "scene-caption") {
                    Text(
                        "Details from old paintings. Left alone, the scene changes with the hour.",
                        style = TextStyle(
                            fontFamily = WuFonts.Garamond,
                            fontSize = 15.sp,
                            lineHeight = 21.sp,
                            fontStyle = FontStyle.Italic,
                            color = palette.ink3,
                        ),
                        modifier = Modifier.padding(top = 4.dp, bottom = 16.dp),
                    )
                }
            }
        }

        // Top-left back chevron sits above the column so taps are never intercepted.
        BackChevron(palette, onBack, label = "Back to threads", reducedMotion = reducedMotion)
    }
}

@Composable
private fun ThemeSwitch(
    isNight: Boolean,
    palette: Palette,
    reducedMotion: Boolean,
    onSelect: (String) -> Unit,
) {
    Row(
        Modifier
            .border(1.dp, palette.line, RoundedCornerShape(22.dp))
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        listOf("day" to false, "night" to true).forEach { (option, optionNight) ->
            val on = isNight == optionNight
            val bg by animateColorAsState(
                targetValue = if (on) palette.ink else Color.Transparent,
                animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 300, easing = WuEasing.Default),
                label = "theme-pill-bg-$option",
            )
            val fg by animateColorAsState(
                targetValue = if (on) palette.paper else palette.ink2,
                animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 300, easing = WuEasing.Default),
                label = "theme-pill-fg-$option",
            )
            Box(
                Modifier
                    .height(34.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(bg)
                    .wuClickable(reducedMotion = reducedMotion, onClick = { onSelect(option) })
                    .padding(horizontal = 14.dp)
                    .semantics { role = Role.Button; contentDescription = option.replaceFirstChar { it.uppercase() } },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    option,
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = fg),
                )
            }
        }
    }
}
