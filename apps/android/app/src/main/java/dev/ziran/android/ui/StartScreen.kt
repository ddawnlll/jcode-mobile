package dev.ziran.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.SendSeal
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.sceneByKey

/**
 * Start screen: Start.dc.html. Pairing with server and code fields, paste a
 * pairing link, and the send seal. Header is the butterfly painting, 340 dp.
 */
@Composable
fun StartScreen(
    palette: Palette,
    sceneKey: String = "butterfly",
    serverValue: String = "https://studio-vps:7646",
    codeValue: String = "",
    error: String? = null,
    onServerChange: (String) -> Unit = {},
    onCodeChange: (String) -> Unit = {},
    onPair: () -> Unit = {},
    onPaste: () -> Unit = {},
    reducedMotion: Boolean = false,
) {
    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome(sceneKey, palette, headerHeightDp = 340, reducedMotion = reducedMotion)
        Column(Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
            Spacer(Modifier.height(290.dp))
            Text("jcode", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.ink3), modifier = Modifier.offset(y = 0.dp))
            Text(
                "Pair with your server",
                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Medium, color = palette.ink),
                modifier = Modifier.padding(top = 6.dp),
            )
            Text(
                "Start the adapter where jcode runs. It prints a code that works once, for ten minutes.",
                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.5.sp, lineHeight = 25.sp, color = palette.ink3),
                modifier = Modifier.padding(top = 8.dp),
            )
            Column(Modifier.padding(top = 22.dp)) {
                Text("server", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3))
                BasicTextField(
                    value = serverValue,
                    onValueChange = onServerChange,
                    textStyle = TextStyle(fontFamily = WuFonts.Mono, fontSize = 14.sp, color = palette.ink),
                    modifier = Modifier.fillMaxWidth().height(42.dp).background(Color.Transparent),
                    singleLine = true,
                )
                Box(Modifier.fillMaxWidth().height(1.5.dp).background(palette.line))
            }
            Column(Modifier.padding(top = 14.dp)) {
                Text("code", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3))
                BasicTextField(
                    value = codeValue,
                    onValueChange = onCodeChange,
                    textStyle = TextStyle(fontFamily = WuFonts.Mono, fontSize = 20.sp, color = palette.ink),
                    modifier = Modifier.fillMaxWidth().height(48.dp).background(palette.paper2, androidx.compose.foundation.shape.RoundedCornerShape(4.dp)).padding(horizontal = 14.dp),
                    singleLine = true,
                )
            }
            if (error != null) {
                Text(error, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.sp, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic, color = palette.seal), modifier = Modifier.padding(top = 10.dp))
            }
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth().padding(bottom = 30.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "paste a pairing link",
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.ink2, textDecoration = TextDecoration.Underline),
                    modifier = Modifier.semantics { role = Role.Button; contentDescription = "paste a pairing link" },
                )
                Spacer(Modifier.weight(1f))
                Box(Modifier.semantics { role = Role.Button; contentDescription = "Pair" }) {
                    SendSeal(sizeDp = 64, backgroundColor = palette.seal, strokeColor = palette.onSeal)
                }
            }
        }
    }
}
