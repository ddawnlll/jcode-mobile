package dev.ziran.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuFonts

/** Temporary empty screens for step 1: navigation must build and run. */

@Composable
fun StartPlaceholder(palette: Palette = Palette.Day) {
    Box(Modifier.fillMaxSize().background(palette.paper)) {
        Column(Modifier.align(Alignment.Center).padding(24.dp)) {
            Text("Start", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 28.sp, fontWeight = FontWeight.Medium, color = palette.ink))
            Text("Pairing. Empty placeholder for step 1.", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.ink3))
            Text("dev.ziran.android · 0.7.0", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3))
        }
    }
}

@Composable
fun EmptyScreen(title: String, note: String, palette: Palette = Palette.Day) {
    Box(Modifier.fillMaxSize().background(palette.paper)) {
        Column(Modifier.align(Alignment.Center).padding(24.dp)) {
            Text(title, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 28.sp, fontWeight = FontWeight.Medium, color = palette.ink))
            Text(note, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.ink3))
        }
    }
}
