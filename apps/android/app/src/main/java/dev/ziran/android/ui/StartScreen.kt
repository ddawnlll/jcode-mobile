package dev.ziran.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.SealButton
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable
import dev.ziran.android.design.wuRise

/**
 * Start screen: Start.dc.html. Butterfly header (340 dp), staggered rise
 * entrance, server and code fields, paste link, and stamped Pair seal.
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
    // Keep field text local while typing so fast IME bursts never drop characters.
    var localServer by remember { mutableStateOf(serverValue) }
    var lastServer by remember { mutableStateOf(serverValue) }
    var localCode by remember { mutableStateOf(codeValue) }
    var lastCode by remember { mutableStateOf(codeValue) }
    LaunchedEffect(serverValue) {
        if (serverValue != lastServer) {
            localServer = serverValue
            lastServer = serverValue
        }
    }
    LaunchedEffect(codeValue) {
        if (codeValue != lastCode) {
            localCode = codeValue
            lastCode = codeValue
        }
    }

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome(sceneKey, palette, headerHeightDp = 340, reducedMotion = reducedMotion)

        Column(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp)
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
        ) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(290.dp))
                Text(
                    "jcode",
                    style = TextStyle(
                        fontFamily = WuFonts.Mono,
                        fontSize = 12.sp,
                        letterSpacing = 0.08.em,
                        color = palette.ink3,
                    ),
                    modifier = Modifier.wuRise(delayMs = 0, reducedMotion = reducedMotion, key = "start-jcode"),
                )
                Text(
                    "Pair with your server",
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 32.sp,
                        lineHeight = 38.sp,
                        fontWeight = FontWeight.Medium,
                        color = palette.ink,
                    ),
                    modifier = Modifier
                        .padding(top = 6.dp)
                        .wuRise(delayMs = 100, reducedMotion = reducedMotion, key = "start-title"),
                )
                Text(
                    "Start the adapter where jcode runs. It prints a code that works once, for ten minutes.",
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 17.5.sp,
                        lineHeight = 25.sp,
                        color = palette.ink3,
                    ),
                    modifier = Modifier
                        .padding(top = 8.dp)
                        .wuRise(delayMs = 200, reducedMotion = reducedMotion, key = "start-copy"),
                )

                // Server field
                Column(
                    Modifier
                        .padding(top = 22.dp)
                        .wuRise(delayMs = 300, reducedMotion = reducedMotion, key = "start-server"),
                ) {
                    Text(
                        "server",
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                    )
                    Spacer(Modifier.height(2.dp))
                    BasicTextField(
                        value = localServer,
                        onValueChange = { next ->
                            localServer = next
                            lastServer = next
                            onServerChange(next)
                        },
                        textStyle = TextStyle(
                            fontFamily = WuFonts.Mono,
                            fontSize = 14.sp,
                            color = palette.ink,
                        ),
                        cursorBrush = SolidColor(palette.ink),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().height(42.dp),
                        decorationBox = { innerTextField ->
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                                innerTextField()
                            }
                        },
                    )
                    Box(Modifier.fillMaxWidth().height(1.5.dp).background(palette.line))
                }

                // One-time code field
                Column(
                    Modifier
                        .padding(top = 14.dp)
                        .wuRise(delayMs = 400, reducedMotion = reducedMotion, key = "start-code"),
                ) {
                    Text(
                        "code",
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                    )
                    Spacer(Modifier.height(6.dp))
                    BasicTextField(
                        value = localCode,
                        onValueChange = { next ->
                            localCode = next
                            lastCode = next
                            onCodeChange(next)
                        },
                        textStyle = TextStyle(
                            fontFamily = WuFonts.Mono,
                            fontSize = 20.sp,
                            letterSpacing = 0.16.em,
                            color = palette.ink,
                        ),
                        cursorBrush = SolidColor(palette.ink),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                            .background(palette.paper2, RoundedCornerShape(4.dp))
                            .padding(horizontal = 14.dp),
                        decorationBox = { innerTextField ->
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                                if (localCode.isEmpty()) {
                                    Text(
                                        "K7QM-P2XA-",
                                        style = TextStyle(
                                            fontFamily = WuFonts.Mono,
                                            fontSize = 20.sp,
                                            letterSpacing = 0.16.em,
                                            color = palette.ink3.copy(alpha = 0.45f),
                                        ),
                                    )
                                }
                                innerTextField()
                            }
                        },
                    )
                }

                if (error != null) {
                    Text(
                        error,
                        style = TextStyle(
                            fontFamily = WuFonts.Garamond,
                            fontSize = 15.sp,
                            fontStyle = FontStyle.Italic,
                            color = palette.seal,
                        ),
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
                Spacer(Modifier.height(24.dp))
            }

            Row(
                Modifier.fillMaxWidth().padding(bottom = 30.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .height(44.dp)
                        .wuClickable(reducedMotion = reducedMotion, onClick = onPaste)
                        .semantics { role = Role.Button; contentDescription = "paste a pairing link" },
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(
                        "paste a pairing link",
                        style = TextStyle(
                            fontFamily = WuFonts.Mono,
                            fontSize = 12.sp,
                            color = palette.ink2,
                        ),
                        modifier = Modifier.drawBehind {
                            val y = size.height + 4.dp.toPx()
                            drawLine(
                                color = palette.line,
                                start = Offset(0f, y),
                                end = Offset(size.width, y),
                                strokeWidth = 1.dp.toPx(),
                            )
                        },
                    )
                }
                Spacer(Modifier.weight(1f))
                SealButton(
                    sizeDp = 64,
                    backgroundColor = palette.seal,
                    strokeColor = palette.onSeal,
                    label = "Pair",
                    animateStamp = true,
                    reducedMotion = reducedMotion,
                    onClick = onPair,
                )
            }
        }
    }
}
