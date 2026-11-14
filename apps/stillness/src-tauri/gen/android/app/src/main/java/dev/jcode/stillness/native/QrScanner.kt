package dev.jcode.stillness.native

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.io.InputStream

/**
 * QR decoding from a captured or picked image using ZXing core.
 *
 * The app does not open its own camera preview: it launches the platform camera
 * activity, then decodes the resulting image. That keeps the permission surface
 * at "no CAMERA permission" and still gives a real, verifiable QR leg. When the
 * decoder finds nothing it reports `unreadable`, never a fabricated pairing code.
 */
object QrScanner {
    private const val TAG = "JCodeQrScanner"
    private const val MAX_DIMENSION = 1600

    data class QrResultData(
        val status: String,
        val text: String?,
        val format: String?,
        val error: String?,
    )

    fun decode(context: Context, uri: Uri): QrResultData {
        val loaded = loadBitmap(context, uri)
        if (loaded.bitmap == null) {
            return QrResultData("unreadable", null, null, loaded.error)
        }
        val bitmap = loaded.bitmap
        return try {
            val result = decodeBitmap(bitmap)
            if (result == null) {
                QrResultData("unreadable", null, null, "no QR code found in the image")
            } else {
                QrResultData("decoded", result.text, result.format, null)
            }
        } catch (error: NotFoundException) {
            QrResultData("unreadable", null, null, "no QR code found in the image")
        } catch (error: Exception) {
            Log.w(TAG, "QR decode failed", error)
            QrResultData("unreadable", null, null, error.message ?: "decode failed")
        } finally {
            bitmap.recycle()
        }
    }

    private data class Decoded(val text: String, val format: String)

    private fun decodeBitmap(bitmap: Bitmap): Decoded? {
        val scaled = scaleDown(bitmap)
        val width = scaled.width
        val height = scaled.height
        val pixels = IntArray(width * height)
        scaled.getPixels(pixels, 0, width, 0, 0, width, height)
        if (scaled !== bitmap) scaled.recycle()
        val source = RGBLuminanceSource(width, height, pixels)
        val binary = BinaryBitmap(HybridBinarizer(source))
        val hints = mapOf(
            DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
            DecodeHintType.TRY_HARDER to true,
            DecodeHintType.CHARACTER_SET to "UTF-8",
        )
        val reader = MultiFormatReader().apply { setHints(hints) }
        return try {
            val result = reader.decode(binary)
            Decoded(result.text, result.barcodeFormat.name)
        } finally {
            reader.reset()
        }
    }

    private fun scaleDown(bitmap: Bitmap): Bitmap {
        val largest = maxOf(bitmap.width, bitmap.height)
        if (largest <= MAX_DIMENSION) return bitmap
        val ratio = MAX_DIMENSION.toFloat() / largest.toFloat()
        val width = (bitmap.width * ratio).toInt().coerceAtLeast(1)
        val height = (bitmap.height * ratio).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(bitmap, width, height, true)
    }

    private data class Loaded(val bitmap: Bitmap?, val error: String?)

    private fun loadBitmap(context: Context, uri: Uri): Loaded {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val probe = open(context, uri)
            ?: return Loaded(null, "could not open the image stream")
        probe.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return Loaded(null, "the image dimensions could not be read")
        }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_DIMENSION * 2) {
            sample *= 2
        }
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val source = open(context, uri)
            ?: return Loaded(null, "the image stream could not be reopened")
        val bitmap = source.use { BitmapFactory.decodeStream(it, null, options) }
            ?: return Loaded(null, "the image could not be decoded")
        return Loaded(bitmap, null)
    }

    private fun open(context: Context, uri: Uri): InputStream? = try {
        context.contentResolver.openInputStream(uri)
    } catch (error: Exception) {
        Log.w(TAG, "could not open $uri", error)
        null
    }
}
