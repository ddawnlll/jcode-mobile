package dev.ziran.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import dev.ziran.android.design.Grain
import dev.ziran.android.design.Painting
import dev.ziran.android.design.Palette
import dev.ziran.android.design.sceneByKey

/**
 * Computes the top spacer inside a safeDrawing-padded content column so the
 * screen title sits cleanly at the painting's lower edge without ever going
 * under the status bar, display cutout, or top corner buttons.
 */
fun contentTopSpacerDp(targetTopFromScreenDp: Int, topInsetDp: Int, minClearanceDp: Int = 54): Int =
    (targetTopFromScreenDp - topInsetDp).coerceAtLeast(minClearanceDp)

/** Reads the current top safeDrawing inset in dp (status bar + display cutout). */
@Composable
fun rememberSafeTopInsetDp(): Int {
    val density = LocalDensity.current
    val topPx = WindowInsets.safeDrawing.getTop(density)
    return with(density) { topPx.toDp().value.toInt() }
}

/** Applies safeDrawing top + horizontal insets so controls clear cutouts in portrait and landscape. */
@Composable
fun Modifier.safeTopAndHorizontalPadding(): Modifier =
    this.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))

/**
 * Shared screen header chrome: full-width clipped painting with 1.2 s scene
 * cross-fade, 34 s Ken Burns drift, drifting mist band, and smooth paper fade.
 */
@Composable
fun ScreenChrome(
    sceneKey: String,
    palette: Palette,
    headerHeightDp: Int,
    reducedMotion: Boolean = false,
    slowDrift: Boolean = false,
) {
    val scene = sceneByKey(sceneKey)
    Box(Modifier.fillMaxSize()) {
        Painting(
            scene = scene,
            palette = palette,
            modifier = Modifier.align(Alignment.TopCenter),
            heightDp = headerHeightDp,
            reducedMotion = reducedMotion,
            slowDrift = slowDrift,
        )
    }
}

/**
 * Full-screen 256 dp tiled paper grain overlay, rendered above screen content
 * (matching CSS z-index: 5, pointer-events: none).
 */
@Composable
fun GrainOverlay(nightFactor: Float) {
    Grain(nightFactor = nightFactor, modifier = Modifier.fillMaxSize())
}
