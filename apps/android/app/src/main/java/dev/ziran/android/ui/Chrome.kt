package dev.ziran.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import dev.ziran.android.design.Grain
import dev.ziran.android.design.Painting
import dev.ziran.android.design.Palette
import dev.ziran.android.design.sceneByKey

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
) {
    val scene = sceneByKey(sceneKey)
    Box(Modifier.fillMaxSize()) {
        Painting(
            scene = scene,
            palette = palette,
            modifier = Modifier.align(Alignment.TopCenter),
            heightDp = headerHeightDp,
            reducedMotion = reducedMotion,
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
