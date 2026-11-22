package dev.ziran.android.design

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color

/**
 * Wu wei tokens. Single source for day and night, from design/wu-wei/README.md.
 * Boards use the same hex values. No other colour should be introduced inline.
 */
object Tokens {
    val DayPaper = Color(0xFFE5EBE0)
    val DayPaper2 = Color(0xFFD6E0D3)
    val DayInk = Color(0xFF16231D)
    val DayInk2 = Color(0xFF2D3C34)
    val DayInk3 = Color(0xFF56685D)
    val DayLine = Color(0xFFBCCBBE)
    val DaySeal = Color(0xFF2E4374)
    val DayOnSeal = Color(0xFFF1F4EC)
    val DayBlue = Color(0xFF3F7484)
    val DayGreen = Color(0xFF3B7A5C)

    val NightPaper = Color(0xFF0E1613)
    val NightPaper2 = Color(0xFF17221D)
    val NightInk = Color(0xFFDCE8DE)
    val NightInk2 = Color(0xFFBCCFC1)
    val NightInk3 = Color(0xFF86998C)
    val NightLine = Color(0xFF24342C)
    val NightSeal = Color(0xFF93A6D9)
    val NightOnSeal = Color(0xFF10140F)
    val NightBlue = Color(0xFF7FAFBD)
    val NightGreen = Color(0xFF6FA88A)

    // Night painting treatment from the boards: brightness .58, saturate .85.
    const val NightBrightness = 0.58f
    const val NightSaturation = 0.85f
}

/** Resolved palette for one screen, always applied explicitly by the caller. */
@Immutable
data class Palette(
    val paper: Color,
    val paper2: Color,
    val ink: Color,
    val ink2: Color,
    val ink3: Color,
    val line: Color,
    val seal: Color,
    val onSeal: Color,
    val blue: Color,
    val green: Color,
    val isNight: Boolean,
    val nightFactor: Float = if (isNight) 1f else 0f,
) {
    companion object {
        val Day = Palette(
            Tokens.DayPaper, Tokens.DayPaper2, Tokens.DayInk, Tokens.DayInk2,
            Tokens.DayInk3, Tokens.DayLine, Tokens.DaySeal, Tokens.DayOnSeal,
            Tokens.DayBlue, Tokens.DayGreen, isNight = false, nightFactor = 0f,
        )
        val Night = Palette(
            Tokens.NightPaper, Tokens.NightPaper2, Tokens.NightInk, Tokens.NightInk2,
            Tokens.NightInk3, Tokens.NightLine, Tokens.NightSeal, Tokens.NightOnSeal,
            Tokens.NightBlue, Tokens.NightGreen, isNight = true, nightFactor = 1f,
        )
    }
}

/**
 * Eases all palette colours and the night painting factor over 600 ms
 * (or 120 ms under reduced motion), matching Motion.dc.html.
 */
@Composable
fun rememberAnimatedPalette(isNight: Boolean, reducedMotion: Boolean): Palette {
    val target = if (isNight) Palette.Night else Palette.Day
    val duration = if (reducedMotion) WuDurations.ReducedFade else WuDurations.Theme
    val spec = tween<Color>(duration, easing = WuEasing.Default)
    val paper by animateColorAsState(target.paper, spec, label = "theme-paper")
    val paper2 by animateColorAsState(target.paper2, spec, label = "theme-paper2")
    val ink by animateColorAsState(target.ink, spec, label = "theme-ink")
    val ink2 by animateColorAsState(target.ink2, spec, label = "theme-ink2")
    val ink3 by animateColorAsState(target.ink3, spec, label = "theme-ink3")
    val line by animateColorAsState(target.line, spec, label = "theme-line")
    val seal by animateColorAsState(target.seal, spec, label = "theme-seal")
    val onSeal by animateColorAsState(target.onSeal, spec, label = "theme-onseal")
    val blue by animateColorAsState(target.blue, spec, label = "theme-blue")
    val green by animateColorAsState(target.green, spec, label = "theme-green")
    val nightFactor by animateFloatAsState(
        targetValue = if (isNight) 1f else 0f,
        animationSpec = tween(duration, easing = WuEasing.Default),
        label = "theme-night-factor",
    )
    return Palette(
        paper = paper,
        paper2 = paper2,
        ink = ink,
        ink2 = ink2,
        ink3 = ink3,
        line = line,
        seal = seal,
        onSeal = onSeal,
        blue = blue,
        green = green,
        isNight = isNight,
        nightFactor = nightFactor,
    )
}
