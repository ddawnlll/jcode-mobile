package dev.ziran.android.ui

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.Scenes
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.sceneByKey

/**
 * Scene and theme: Scenes.dc.html. 230 dp header, Day/Night/Follow switch,
 * 3-column grid of twelve 78 dp painting thumbnails with seal outline on
 * selection. Copy verbatim from the board.
 */
@Composable
fun ScenesScreen(
    palette: Palette,
    selectedScene: String = "peaks",
    themeMode: String = "system",
    sceneKey: String = "peaks",
    onBack: () -> Unit = {},
    onSelectScene: (String) -> Unit = {},
    onSelectTheme: (String) -> Unit = {},
    reducedMotion: Boolean = false,
) {
    Box(Modifier.fillMaxSize().background(palette.paper)) {
        // Header shows the selected painting.
        ScreenChrome(sceneKey = selectedScene, palette, headerHeightDp = 230, reducedMotion = reducedMotion)
        BackChevron(palette, onBack)
        Column(Modifier.fillMaxSize().padding(horizontal = 22.dp).padding(top = 180.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text("Scene", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Medium, color = palette.ink))
                    Text("behind every thread", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(top = 2.dp))
                }
            }
            Column(Modifier.padding(top = 12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Ink", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink))
                    Spacer(Modifier.weight(1f))
                    ThemeSwitch(themeMode, palette, onSelectTheme)
                }
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    modifier = Modifier.padding(top = 16.dp).fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(Scenes) { scene ->
                        val on = scene.key == selectedScene
                        Column {
                            Box(
                                Modifier.fillMaxWidth().height(78.dp)
                                    .background(palette.paper2, androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                                    .let {
                                        if (on) it.background(palette.seal.copy(alpha = 0.15f), androidx.compose.foundation.shape.RoundedCornerShape(4.dp)) else it
                                    }
                                    .semantics { role = Role.Button; contentDescription = "Scene ${scene.label}" }
                                    .clickable { onSelectScene(scene.key) },
                                contentAlignment = Alignment.Center,
                            ) {
                                Image(
                                    painter = painterResource(scene.drawableRes),
                                    contentDescription = null,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                            Text(scene.label, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 13.5.sp, lineHeight = 16.sp, color = palette.ink), modifier = Modifier.padding(top = 5.dp))
                        }
                    }
                }
                Text(
                    "Details from old paintings. Left alone, the scene changes with the hour.",
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.sp, lineHeight = 21.sp, fontStyle = FontStyle.Italic, color = palette.ink3),
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        }
    }
}

@Composable
private fun ThemeSwitch(mode: String, palette: Palette, onSelect: (String) -> Unit) {
    Row(Modifier.background(palette.paper2, androidx.compose.foundation.shape.RoundedCornerShape(22.dp)).padding(3.dp)) {
        listOf("day", "night", "system").forEach { option ->
            val on = mode == option
            Box(
                Modifier
                    .let {
                        if (on) it.background(palette.ink, androidx.compose.foundation.shape.RoundedCornerShape(18.dp)) else it
                    }
                    .semantics { role = Role.Button; contentDescription = "Theme $option" }
                    .clickable { onSelect(option) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text(
                    option,
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 12.sp, color = if (on) palette.paper else palette.ink2),
                )
            }
        }
    }
}
