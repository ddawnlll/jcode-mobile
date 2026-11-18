package dev.ziran.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.sceneByKey

/**
 * Shared screen chrome: painting header, mist, paper fade and grain.
 * Sizes come straight from the board inline styles.
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
        Box(
            Modifier
                .width(390.dp)
                .height(headerHeightDp.dp)
                .align(androidx.compose.ui.Alignment.TopCenter)
                .background(palette.paper),
        ) {
            dev.ziran.android.design.Painting(
                scene = scene,
                isNight = palette.isNight,
                modifier = Modifier.fillMaxSize(),
                heightDp = headerHeightDp,
                reducedMotion = reducedMotion,
            )
            // Paper fade: gradient from transparent to paper.
            Box(
                Modifier.fillMaxSize().background(
                    androidx.compose.ui.graphics.Brush.verticalGradient(
                        0f to androidx.compose.ui.graphics.Color.Transparent,
                        0.55f to androidx.compose.ui.graphics.Color.Transparent,
                        0.98f to palette.paper,
                    ),
                ),
            )
        }
        // Grain overlay, 256 dp tiles, above all content but non-interactive.
        Image(
            painter = painterResource(
                if (palette.isNight) dev.ziran.android.R.drawable.grain_night else dev.ziran.android.R.drawable.grain_day,
            ),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
    }
}
