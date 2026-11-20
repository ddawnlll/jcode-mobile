package dev.ziran.android.design

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import dev.ziran.android.R

/**
 * Bundled fonts, from the board stylesheet: EB Garamond for prose, JetBrains
 * Mono for machine text. OFL, installed from res/font.
 */
object WuFonts {
    val Garamond = FontFamily(
        Font(R.font.ebgaramond_regular, FontWeight.Normal, FontStyle.Normal),
        Font(R.font.ebgaramond_medium, FontWeight.Medium, FontStyle.Normal),
        Font(R.font.ebgaramond_italic, FontWeight.Normal, FontStyle.Italic),
    )
    val Mono = FontFamily(
        Font(R.font.jetbrainsmono_regular, FontWeight.Normal),
        Font(R.font.jetbrainsmono_medium, FontWeight.Medium),
    )
}
