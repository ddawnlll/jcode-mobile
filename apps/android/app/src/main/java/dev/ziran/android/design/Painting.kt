package dev.ziran.android.design

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Shader
import androidx.annotation.DrawableRes
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.dp
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
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
    Scene("butterfly", "butterfly dream", dev.ziran.android.R.drawable.painting_butterfly),
)

/** Flock painting used exclusively by the Plan screen. */
val FlockScene = Scene("flock", "flock", dev.ziran.android.R.drawable.painting_flock)

fun sceneByKey(key: String): Scene = Scenes.firstOrNull { it.key == key } ?: Scenes.first()

/**
 * Decodes each painting ONCE at display size and pre-scales the 256 dp grain
 * tile ONCE so BitmapShader runs with an identity matrix (zero per-frame resampling).
 */
object BitmapCache {
    private val paintings = ConcurrentHashMap<Long, ImageBitmap>()
    private val grainShaders = ConcurrentHashMap<Long, ShaderBrush>()

    fun painting(resources: Resources, @DrawableRes resId: Int, targetWidthPx: Int): ImageBitmap {
        val bucket = ((targetWidthPx.coerceAtLeast(128) + 127) / 128) * 128
        val key = (resId.toLong() shl 20) or bucket.toLong()
        return paintings.getOrPut(key) {
            decodeSampled(resources, resId, bucket).asImageBitmap()
        }
    }

    fun grainBrush(resources: Resources, @DrawableRes resId: Int, tilePx: Int): ShaderBrush {
        val sz = tilePx.coerceIn(128, 1024)
        val key = (resId.toLong() shl 16) or sz.toLong()
        return grainShaders.getOrPut(key) {
            val opts = BitmapFactory.Options().apply { inScaled = false }
            val raw = BitmapFactory.decodeResource(resources, resId, opts)
            val scaled = if (raw.width != sz || raw.height != sz) {
                Bitmap.createScaledBitmap(raw, sz, sz, true).also { raw.recycle() }
            } else {
                raw
            }
            ShaderBrush(BitmapShader(scaled, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT))
        }
    }

    private fun decodeSampled(resources: Resources, @DrawableRes resId: Int, reqWidth: Int): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeResource(resources, resId, bounds)
        var sample = 1
        if (bounds.outWidth > reqWidth) {
            val halfW = bounds.outWidth / 2
            while (halfW / sample >= reqWidth) {
                sample *= 2
            }
        }
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return BitmapFactory.decodeResource(resources, resId, opts)
    }
}

/** Remember a display-sized cached ImageBitmap for a painting resource. */
@Composable
fun rememberPaintingBitmap(@DrawableRes resId: Int, targetWidthPx: Int): ImageBitmap {
    val resources = LocalContext.current.resources
    return remember(resId, targetWidthPx) {
        BitmapCache.painting(resources, resId, targetWidthPx)
    }
}

/**
 * CSS-equivalent night filter: `brightness(lerp(1, 0.58, f)) saturate(lerp(1, 0.85, f))`.
 */
fun paintingColorFilter(nightFactor: Float): ColorFilter? {
    val f = nightFactor.coerceIn(0f, 1f)
    if (f <= 0.001f) return null
    val brightness = 1f + (Tokens.NightBrightness - 1f) * f
    val sat = 1f + (Tokens.NightSaturation - 1f) * f
    val satMatrix = ColorMatrix().apply { setToSaturation(sat) }
    val brightMatrix = ColorMatrix(
        floatArrayOf(
            brightness, 0f, 0f, 0f, 0f,
            0f, brightness, 0f, 0f, 0f,
            0f, 0f, brightness, 0f, 0f,
            0f, 0f, 0f, 1f, 0f,
        ),
    )
    satMatrix.timesAssign(brightMatrix)
    return ColorFilter.colorMatrix(satMatrix)
}

/**
 * Painting header with 1.2 s scene cross-fade, 34 s Ken Burns drift,
 * 16 s drifting mist band and seamless paper fade. All brushes are cached
 * with `drawWithCache` and motion runs strictly on `graphicsLayer`.
 */
@Composable
fun Painting(
    scene: Scene,
    palette: Palette,
    modifier: Modifier = Modifier,
    heightDp: Int = 280,
    reducedMotion: Boolean = false,
) {
    val density = LocalDensity.current
    val widthPx = max(LocalWindowInfo.current.containerSize.width, 780)
    val txTargetPx = with(density) { (-12).dp.toPx() }
    val tyTargetPx = with(density) { (-6).dp.toPx() }
    val mistShiftPx = with(density) { 26.dp.toPx() }

    val transition = if (reducedMotion) null else rememberInfiniteTransition(label = "painting-motion")
    val kbProgress = transition?.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(WuDurations.KenBurns, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "kenburns",
    )
    val mistProgress = transition?.animateFloat(
        initialValue = -1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(WuDurations.MistDrift, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "mist-drift",
    )

    val colorFilter = remember(palette.nightFactor) { paintingColorFilter(palette.nightFactor) }
    val fadeDuration = if (reducedMotion) WuDurations.ReducedFade else WuDurations.SceneFade
    val mistTopDp = (heightDp * 0.56f - 39f).roundToInt().dp

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(heightDp.dp)
            .clipToBounds()
            .graphicsLayer {},
    ) {
        Crossfade(
            targetState = scene,
            animationSpec = tween(fadeDuration, easing = WuEasing.Default),
            label = "scene-crossfade",
        ) { targetScene ->
            val bitmap = rememberPaintingBitmap(targetScene.drawableRes, widthPx)
            Image(
                bitmap = bitmap,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                colorFilter = colorFilter,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        val p = kbProgress?.value ?: 0f
                        val scale = if (reducedMotion) 1.03f else 1.03f + 0.07f * p
                        scaleX = scale
                        scaleY = scale
                        translationX = if (reducedMotion) 0f else txTargetPx * p
                        translationY = if (reducedMotion) 0f else tyTargetPx * p
                        transformOrigin = TransformOrigin(0.6f, 0.4f)
                    },
            )
        }

        // Drifting mist band: cached vertical gradient on a 78 dp strip, GPU translationX only.
        val paperColor = palette.paper
        Box(
            Modifier
                .fillMaxWidth()
                .height(78.dp)
                .offset(y = mistTopDp)
                .graphicsLayer {
                    translationX = if (reducedMotion) 0f else mistShiftPx * (mistProgress?.value ?: 0f)
                }
                .drawWithCache {
                    val overhang = 48.dp.toPx()
                    val brush = Brush.verticalGradient(
                        0f to Color.Transparent,
                        0.35f to paperColor.copy(alpha = 0.28f),
                        0.50f to paperColor.copy(alpha = 0.34f),
                        0.65f to paperColor.copy(alpha = 0.28f),
                        1f to Color.Transparent,
                    )
                    onDrawBehind {
                        drawRect(
                            brush = brush,
                            topLeft = Offset(-overhang, 0f),
                            size = Size(size.width + overhang * 2f, size.height),
                        )
                    }
                },
        )

        // Paper fade: cached linear gradient melting the bottom 45% into paper.
        Box(
            Modifier
                .fillMaxSize()
                .drawWithCache {
                    val brush = Brush.verticalGradient(
                        0f to Color.Transparent,
                        0.55f to Color.Transparent,
                        0.96f to paperColor,
                        1f to paperColor,
                    )
                    onDrawBehind { drawRect(brush) }
                },
        )
    }
}

/**
 * Paper grain as a tiled 256 dp repeating bitmap with identity-matrix BitmapShader,
 * isolated on its own graphicsLayer RenderNode so Skia caches the layer instead of
 * re-running a scaled shader over the whole screen on every frame.
 */
@Composable
fun Grain(nightFactor: Float, modifier: Modifier = Modifier) {
    val resources = LocalContext.current.resources
    val tilePx = with(LocalDensity.current) { 256.dp.toPx().roundToInt() }
    val dayBrush = remember(tilePx) {
        BitmapCache.grainBrush(resources, dev.ziran.android.R.drawable.grain_day, tilePx)
    }
    val nightBrush = remember(tilePx) {
        BitmapCache.grainBrush(resources, dev.ziran.android.R.drawable.grain_night, tilePx)
    }
    val nf = nightFactor.coerceIn(0f, 1f)
    Box(modifier.fillMaxSize()) {
        if (nf < 0.999f) {
            Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer { alpha = 1f - nf }
                    .drawWithCache { onDrawBehind { drawRect(dayBrush) } },
            )
        }
        if (nf > 0.001f) {
            Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer { alpha = nf }
                    .drawWithCache { onDrawBehind { drawRect(nightBrush) } },
            )
        }
    }
}
