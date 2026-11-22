package dev.ziran.android.ui

import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.SealButton
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable
import dev.ziran.android.design.wuRise
import dev.ziran.android.protocol.HealthProbeResult
import dev.ziran.android.protocol.MIN_PROTOCOL_VERSION
import dev.ziran.android.protocol.PROTOCOL_VERSION
import kotlinx.coroutines.delay

/** Formats raw input into `XXXX-XXXX-XXXX` (max 12 alphanumeric characters). */
internal fun formatPairingCode(raw: String): String {
    val clean = raw.uppercase().filter { it.isLetterOrDigit() }.take(12)
    return clean.chunked(4).joinToString("-")
}

/**
 * Start / Pairing screen: Start.dc.html + Start-Night.dc.html.
 *
 * - Debounced `GET {server}/health` probe (500 ms after typing, immediate on paste).
 * - `XXXX-XXXX-XXXX` code formatting with per-character 6 dp rise + fade (180 ms; 20 ms stagger on paste).
 * - Progressive ink underline following character count; indigo on failure.
 * - Pair seal stays dim until 12 code chars + reachable compatible server, then stamps in once.
 * - Painting's 3-stage progress dots track `pairingStage` and slow Ken Burns drift while waiting.
 */
@Composable
fun StartScreen(
    palette: Palette,
    sceneKey: String = "butterfly",
    serverValue: String = "",
    codeValue: String = "",
    error: String? = null,
    pairingStage: String = "idle",
    healthProbe: HealthProbeResult = HealthProbeResult.Idle,
    pasteNonce: Int = 0,
    onServerChange: (String) -> Unit = {},
    onCodeChange: (String) -> Unit = {},
    onPair: () -> Unit = {},
    onPaste: () -> Unit = {},
    reducedMotion: Boolean = false,
) {
    val view = LocalView.current
    var localServer by remember { mutableStateOf(serverValue) }
    var lastServer by remember { mutableStateOf(serverValue) }
    LaunchedEffect(serverValue) {
        if (serverValue != lastServer) {
            localServer = serverValue
            lastServer = serverValue
        }
    }

    val formattedExternal = remember(codeValue) { formatPairingCode(codeValue) }
    var localCodeField by remember {
        mutableStateOf(TextFieldValue(formattedExternal, TextRange(formattedExternal.length)))
    }
    var lastCode by remember { mutableStateOf(formattedExternal) }
    LaunchedEffect(formattedExternal) {
        if (formattedExternal != lastCode) {
            localCodeField = TextFieldValue(formattedExternal, TextRange(formattedExternal.length))
            lastCode = formattedExternal
        }
    }

    val alnumCount = localCodeField.text.count { it.isLetterOrDigit() }
    val serverReady = healthProbe is HealthProbeResult.Reachable && healthProbe.compatible
    val isReadyToPair = alnumCount == 12 && serverReady
    var wasReady by remember { mutableStateOf(false) }
    var readyStampTrigger by remember { mutableIntStateOf(0) }
    LaunchedEffect(isReadyToPair) {
        if (isReadyToPair && !wasReady) {
            readyStampTrigger += 1
        }
        wasReady = isReadyToPair
    }

    val isPairingActive = pairingStage == "pairing" || pairingStage == "connecting"
    val sealAlpha by animateFloatAsState(
        targetValue = if (isReadyToPair || isPairingActive) 1f else 0.35f,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 240, easing = WuEasing.Default),
        label = "pair-seal-alpha",
    )

    // Haptic CONFIRM when stage reaches verified.
    LaunchedEffect(pairingStage) {
        if (pairingStage == "verified") {
            @Suppress("DEPRECATION")
            view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        }
    }

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome(
            sceneKey = sceneKey,
            palette = palette,
            headerHeightDp = 340,
            reducedMotion = reducedMotion,
            slowDrift = isPairingActive,
        )

        // Painting's 3-stage progress dots (pairing -> connecting -> verified).
        PairingStageDots(
            stage = pairingStage,
            palette = palette,
            reducedMotion = reducedMotion,
            modifier = Modifier
                .fillMaxWidth()
                .height(340.dp)
                .padding(start = 24.dp, end = 24.dp, bottom = 58.dp),
        )

        val safeTop = rememberSafeTopInsetDp()
        Column(
            Modifier
                .fillMaxSize()
                .safeTopAndHorizontalPadding()
                .padding(horizontal = 24.dp)
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
        ) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(contentTopSpacerDp(290, safeTop, minClearanceDp = 24).dp))
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

                val stageSubtitle = when (pairingStage) {
                    "pairing" -> "exchanging the code…"
                    "connecting" -> "negotiating the channel…"
                    "verified" -> "verified"
                    else -> "Start the adapter where jcode runs. It prints a code that works once, for ten minutes."
                }
                AnimatedContent(
                    targetState = stageSubtitle,
                    transitionSpec = {
                        val dur = if (reducedMotion) WuDurations.ReducedFade else 220
                        fadeIn(tween(dur, easing = WuEasing.Default)) togetherWith
                            fadeOut(tween(dur.coerceAtMost(160), easing = WuEasing.Default))
                    },
                    label = "pairing-stage-subtitle",
                    modifier = Modifier.padding(top = 8.dp),
                ) { copy ->
                    Text(
                        copy,
                        style = TextStyle(
                            fontFamily = WuFonts.Garamond,
                            fontSize = 17.5.sp,
                            lineHeight = 25.sp,
                            color = if (pairingStage in listOf("pairing", "connecting", "verified")) palette.ink2 else palette.ink3,
                        ),
                    )
                }

                // Server field + flowing probe hairline + health line
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
                    ServerProbeUnderline(
                        probing = healthProbe is HealthProbeResult.Probing,
                        palette = palette,
                        reducedMotion = reducedMotion,
                    )
                    Spacer(Modifier.height(6.dp))
                    ServerHealthStatusLine(healthProbe = healthProbe, palette = palette, reducedMotion = reducedMotion)
                }

                // One-time code field (XXXX-XXXX-XXXX, animated chars, progressive ink underline)
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
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                            .background(palette.paper2, RoundedCornerShape(4.dp))
                            .padding(horizontal = 14.dp),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        if (localCodeField.text.isEmpty()) {
                            Text(
                                "K7QM-P2XA-9R4L",
                                style = TextStyle(
                                    fontFamily = WuFonts.Mono,
                                    fontSize = 20.sp,
                                    letterSpacing = 0.16.em,
                                    color = palette.ink3.copy(alpha = 0.38f),
                                ),
                            )
                        } else {
                            AnimatedCodeText(
                                code = localCodeField.text,
                                pasteNonce = pasteNonce,
                                color = palette.ink,
                                reducedMotion = reducedMotion,
                            )
                        }
                        BasicTextField(
                            value = localCodeField,
                            onValueChange = { next ->
                                val formatted = formatPairingCode(next.text)
                                val updated = TextFieldValue(formatted, TextRange(formatted.length))
                                localCodeField = updated
                                lastCode = formatted
                                onCodeChange(formatted)
                            },
                            textStyle = TextStyle(
                                fontFamily = WuFonts.Mono,
                                fontSize = 20.sp,
                                letterSpacing = 0.16.em,
                                color = Color.Transparent,
                            ),
                            cursorBrush = SolidColor(palette.ink),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    // Progressive ink underline following character count; indigo on failure.
                    CodeInkUnderline(
                        fraction = alnumCount / 12f,
                        isError = error != null,
                        palette = palette,
                        reducedMotion = reducedMotion,
                    )
                }

                // Error fades in under the code field in ink (never red, no shake).
                AnimatedVisibility(
                    visible = error != null,
                    enter = fadeIn(tween(if (reducedMotion) WuDurations.ReducedFade else 240, easing = WuEasing.Default)),
                    exit = fadeOut(tween(if (reducedMotion) WuDurations.ReducedFade else 160, easing = WuEasing.Default)),
                ) {
                    Text(
                        error.orEmpty(),
                        style = TextStyle(
                            fontFamily = WuFonts.Garamond,
                            fontSize = 15.sp,
                            fontStyle = FontStyle.Italic,
                            color = palette.ink,
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
                    stampTrigger = readyStampTrigger,
                    animateStamp = true,
                    reducedMotion = reducedMotion,
                    modifier = Modifier.graphicsLayer { alpha = sealAlpha },
                    onClick = onPair,
                )
            }
        }
    }
}

@Composable
private fun ServerProbeUnderline(
    probing: Boolean,
    palette: Palette,
    reducedMotion: Boolean,
) {
    val flowX = if (probing && !reducedMotion) {
        rememberInfiniteTransition(label = "server-probe-flow").animateFloat(
            initialValue = -0.5f,
            targetValue = 1.5f,
            animationSpec = infiniteRepeatable(tween(1200, easing = LinearEasing), RepeatMode.Restart),
            label = "server-probe-x",
        ).value
    } else null

    Box(Modifier.fillMaxWidth().height(1.5.dp).background(palette.line)) {
        if (probing) {
            val blue = palette.blue
            Canvas(Modifier.fillMaxSize()) {
                val x = (flowX ?: 0.25f) * size.width
                val bandW = size.width * 0.45f
                drawRect(
                    brush = Brush.horizontalGradient(
                        0f to Color.Transparent,
                        0.5f to blue,
                        1f to Color.Transparent,
                        startX = x,
                        endX = x + bandW,
                    ),
                )
            }
        }
    }
}

@Composable
private fun ServerHealthStatusLine(
    healthProbe: HealthProbeResult,
    palette: Palette,
    reducedMotion: Boolean,
) {
    AnimatedContent(
        targetState = healthProbe,
        transitionSpec = {
            val dur = if (reducedMotion) WuDurations.ReducedFade else 200
            fadeIn(tween(dur, easing = WuEasing.Default)) togetherWith
                fadeOut(tween(dur.coerceAtMost(150), easing = WuEasing.Default))
        },
        label = "server-health-line",
    ) { probe ->
        when (probe) {
            HealthProbeResult.Idle, HealthProbeResult.Probing -> {
                Spacer(Modifier.height(16.dp))
            }
            is HealthProbeResult.Reachable -> {
                if (!probe.compatible) {
                    val verText = if (probe.protocolVersion == 0) {
                        "adapter is too old (v1; needs protocol $MIN_PROTOCOL_VERSION..$PROTOCOL_VERSION)"
                    } else {
                        "adapter supports protocol ${probe.minProtocolVersion}..${probe.protocolVersion} (needs $MIN_PROTOCOL_VERSION..$PROTOCOL_VERSION)"
                    }
                    Text(
                        verText,
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, lineHeight = 16.sp, color = palette.ink3),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(
                            Modifier
                                .size(6.dp)
                                .background(if (probe.jcodeConnected) palette.green else palette.ink3, CircleShape),
                        )
                        val jcodePart = if (probe.jcodeConnected) "jcode connected" else "jcode not running"
                        Text(
                            "adapter ${probe.adapterVersion} · protocol ${probe.protocolVersion} · $jcodePart",
                            style = TextStyle(
                                fontFamily = WuFonts.Mono,
                                fontSize = 11.sp,
                                lineHeight = 16.sp,
                                color = if (probe.jcodeConnected) palette.ink2 else palette.ink3,
                            ),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            is HealthProbeResult.Unreachable -> {
                Text(
                    "can't reach this address yet",
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, lineHeight = 16.sp, color = palette.ink3),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun AnimatedCodeText(
    code: String,
    pasteNonce: Int,
    color: Color,
    reducedMotion: Boolean,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        code.forEachIndexed { index, ch ->
            AnimatedCodeChar(
                char = ch,
                index = index,
                pasteNonce = pasteNonce,
                color = color,
                reducedMotion = reducedMotion,
            )
        }
    }
}

@Composable
private fun AnimatedCodeChar(
    char: Char,
    index: Int,
    pasteNonce: Int,
    color: Color,
    reducedMotion: Boolean,
) {
    val risePx = with(LocalDensity.current) { 6.dp.toPx() }
    val progress = remember(index, char, pasteNonce) { Animatable(if (reducedMotion) 1f else 0f) }
    LaunchedEffect(index, char, pasteNonce, reducedMotion) {
        if (reducedMotion) {
            progress.snapTo(1f)
            return@LaunchedEffect
        }
        if (pasteNonce > 0) delay(index * 20L)
        progress.animateTo(1f, tween(180, easing = WuEasing.Default))
    }
    Text(
        text = char.toString(),
        style = TextStyle(
            fontFamily = WuFonts.Mono,
            fontSize = 20.sp,
            letterSpacing = 0.16.em,
            color = color,
        ),
        modifier = Modifier.graphicsLayer {
            val p = progress.value
            alpha = p
            translationY = if (reducedMotion) 0f else risePx * (1f - p)
        },
    )
}

@Composable
private fun CodeInkUnderline(
    fraction: Float,
    isError: Boolean,
    palette: Palette,
    reducedMotion: Boolean,
) {
    val animFraction by animateFloatAsState(
        targetValue = fraction.coerceIn(0f, 1f),
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 200, easing = WuEasing.Default),
        label = "code-underline-len",
    )
    val lineColor by animateColorAsState(
        targetValue = if (isError) palette.seal else palette.ink,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 220, easing = WuEasing.Default),
        label = "code-underline-color",
    )
    Box(Modifier.fillMaxWidth().height(2.dp).background(palette.line)) {
        Box(
            Modifier
                .fillMaxWidth(animFraction)
                .height(2.dp)
                .background(lineColor),
        )
    }
}

@Composable
private fun PairingStageDots(
    stage: String,
    palette: Palette,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val activeStep = when (stage) {
        "pairing" -> 1
        "connecting" -> 2
        "verified" -> 3
        else -> 0
    }
    val visible = activeStep > 0
    val rowAlpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 260, easing = WuEasing.Default),
        label = "pair-dots-alpha",
    )
    if (rowAlpha <= 0.001f) return

    val stampScale = remember { Animatable(1f) }
    LaunchedEffect(stage, reducedMotion) {
        if (stage == "verified" && !reducedMotion) {
            stampScale.snapTo(0f)
            stampScale.animateTo(1.35f, tween(320, easing = WuEasing.Default))
            stampScale.animateTo(1f, tween(230, easing = WuEasing.Default))
        } else {
            stampScale.snapTo(1f)
        }
    }

    Box(modifier.graphicsLayer { alpha = rowAlpha }) {
        Row(
            Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(end = 96.dp)
                .semantics { contentDescription = "Pairing progress: $stage" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (i in 1..3) {
                val filled = when {
                    stage == "verified" -> true
                    stage == "connecting" -> i <= 1
                    else -> false
                }
                val isCurrent = (stage == "pairing" && i == 1) || (stage == "connecting" && i == 2)
                val fill by animateColorAsState(
                    targetValue = if (filled) palette.seal else palette.paper,
                    animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 320, easing = WuEasing.Default),
                    label = "pair-dot-$i",
                )
                val border by animateColorAsState(
                    targetValue = when {
                        filled -> palette.seal
                        isCurrent -> palette.blue
                        else -> palette.ink2
                    },
                    animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 320, easing = WuEasing.Default),
                    label = "pair-dot-border-$i",
                )
                Box(
                    Modifier
                        .size(9.dp)
                        .graphicsLayer {
                            if (i == 3 && stage == "verified") {
                                scaleX = stampScale.value
                                scaleY = stampScale.value
                            }
                        }
                        .background(fill, CircleShape)
                        .border(1.4.dp, border, CircleShape),
                )
                if (i < 3) {
                    Box(
                        Modifier
                            .weight(1f)
                            .height(1.dp)
                            .background(palette.ink2.copy(alpha = 0.35f)),
                    )
                }
            }
        }
    }
}
