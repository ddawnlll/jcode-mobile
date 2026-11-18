package dev.ziran.android.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.DefaultShadowColor
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import kotlin.math.roundToInt

/** The twelve paintings, in Scenes board order. */
data class Scene(
    val key: String,
    val label: String,
    @DrawableRes val drawableRes: Int,
)

val Scenes = listOf(
    Scene("peaks", "peaks", dev.ziran.android.R.drawable.painting_peaks),
    Scene("jade_peaks", "jade peaks", dev.ziran.android.R.drawable.painting_jade_peaks),
    Scene("pavilion", "pavilion", dev.ziran.android.R.drawable.painting_pavilion),
    Scene("river_valley", "river valley", dev.ziran.android.R.drawable.painting_river_valley),
    Scene("blue_hills", "blue hills", dev.ziran.android.R.drawable.painting_blue_hills),
    Scene("riders", "riders", dev.ziran.android.R.drawable.painting_riders),
    Scene("misty_peaks", "misty peaks", dev.ziran.android.R.drawable.painting_misty_peaks),
    Scene("lone_boat", "lone boat", dev.ziran.android.R.drawable.painting_lone_boat),
    Scene("sage_under_pine", "sage under pine", dev.ziran.android.R.drawable.painting_sage_under_pine),
    Scene("green_woods", "green woods", dev.ziran.android.R.drawable.painting_green_woods),
    Scene("quiet_river", "quiet river", dev.ziran.android.R.drawable.painting_quiet_river),
    Scene("butterfly", "butterfly", dev.ziran.android.R.drawable.painting_butterfly),
)

fun sceneByKey(key: String): Scene = Scenes.firstOrNull { it.key == key } ?: Scenes.first()

/**
 * Painting header with Ken Burns drift (34 s, alternate), mist band and paper
 * fade, matching the boards: painting fills the top box, a blurred paper band
 * sits near the middle, a gradient fades it into the paper.
 */
@Composable
fun Painting(
    scene: Scene,
    isNight: Boolean,
    modifier: Modifier = Modifier,
    heightDp: Int = 280,
    reducedMotion: Boolean = false,
) {
    val scaleTarget = 1.10f
    val transition = if (reducedMotion) null else rememberInfiniteTransition(label = "kenburns")
    val drift = if (transition != null) transition.animateFloat(
        initialValue = 1.03f, targetValue = scaleTarget,
        animationSpec = infiniteRepeatable(
            animation = tween(34000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ), label = "kenburns-scale",
    ) else null
    val tx = if (transition != null) transition.animateFloat(
        initialValue = 0f, targetValue = -12f,
        animationSpec = infiniteRepeatable(
            animation = tween(34000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ), label = "kenburns-tx",
    ) else null
    val ty = if (transition != null) transition.animateFloat(
        initialValue = 0f, targetValue = -6f,
        animationSpec = infiniteRepeatable(
            animation = tween(34000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ), label = "kenburns-ty",
    ) else null
    val scale = drift?.value ?: 1.0f
    Box(modifier = modifier) {
        Box(Modifier.fillMaxSize()) {
            Image(
                painter = painterResource(scene.drawableRes),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                colorFilter = if (isNight) ColorFilter.tint(
                    androidx.compose.ui.graphics.Color.Black, blendMode = androidx.compose.ui.graphics.BlendMode.Multiply,
                ) else null,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        scaleX = scale; scaleY = scale
                        translationX = tx?.value ?: 0f
                        translationY = ty?.value ?: 0f
                        transformOrigin = TransformOrigin(0.6f, 0.4f)
                    }
                    .alpha(if (isNight) 0.58f else 1f),
            )
            // Mist band: a blurred paper strip. Compose has no blur on Box without
            // RenderEffect, so use a semi-transparent paper band.
            Box(
                Modifier
                    .offset(y = (heightDp * 0.52).roundToInt().dp)
                    .graphicsLayer { scaleX = 1.15f }
                    .alpha(0.32f)
                    .fillMaxSize()
                    .background(dev.ziran.android.design.Tokens.DayPaper),
            )
        }
    }
}

/** Paper grain as a tiled bitmap overlay, 256 dp tiles as in the boards. */
@Composable
fun Grain(isNight: Boolean) {
    Image(
        painter = painterResource(
            if (isNight) dev.ziran.android.R.drawable.grain_night else dev.ziran.android.R.drawable.grain_day,
        ),
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier.fillMaxSize(),
    )
}
