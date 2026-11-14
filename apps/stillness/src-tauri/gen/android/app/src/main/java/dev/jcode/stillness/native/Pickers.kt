package dev.jcode.stillness.native

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import java.io.File

/**
 * Photo Picker, Storage Access Framework, and camera capture.
 *
 * The photo picker is preferred on Android 13+ and falls back to
 * ACTION_OPEN_DOCUMENT, which needs no storage permission. Camera capture uses
 * ACTION_IMAGE_CAPTURE with a FileProvider output URI, so this app never asks
 * for the CAMERA permission and never opens a camera preview of its own.
 */
object Pickers {
    private const val TAG = "JCodePickers"
    const val MAX_URIS = 10

    data class PickResultData(
        val status: String,
        val uris: List<String>,
        val mimeTypes: List<String>,
        val error: String?,
    )

    fun imagesIntent(context: Context, max: Int?): Intent {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val picker = Intent(MediaStore.ACTION_PICK_IMAGES)
            val limit = (max ?: 1).coerceIn(1, 100)
            picker.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, limit)
            if (picker.resolveActivity(context.packageManager) != null) return picker
            Log.i(TAG, "photo picker unavailable; falling back to the document picker")
        }
        return Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, (max ?: 1) > 1)
        }
    }

    fun documentIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
    }

    fun cameraIntent(context: Context): Pair<Intent, Uri>? {
        val dir = File(context.cacheDir, "native-capture").apply { mkdirs() }
        val target = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        val uri = try {
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
        } catch (error: Exception) {
            Log.w(TAG, "could not create a camera output URI", error)
            return null
        }
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (intent.resolveActivity(context.packageManager) == null) {
            Log.i(TAG, "no camera activity can capture a photo")
            target.delete()
            return null
        }
        return intent to uri
    }

    fun available(context: Context): Boolean =
        imagesIntent(context, 1).resolveActivity(context.packageManager) != null

    fun cameraAvailable(context: Context): Boolean =
        Intent(MediaStore.ACTION_IMAGE_CAPTURE).resolveActivity(context.packageManager) != null

    fun fromResult(
        context: Context,
        result: ActivityResult,
        max: Int?,
    ): PickResultData {
        if (result.resultCode != Activity.RESULT_OK) {
            return PickResultData("cancelled", emptyList(), emptyList(), null)
        }
        val intent = result.data
        val uris = mutableListOf<Uri>()
        val clip = intent?.clipData
        if (clip != null && clip.itemCount > 0) {
            for (index in 0 until clip.itemCount) {
                clip.getItemAt(index).uri?.let(uris::add)
            }
        } else {
            intent?.data?.let(uris::add)
        }
        val limited = uris.take((max ?: MAX_URIS).coerceIn(1, MAX_URIS))
        for (uri in limited) {
            try {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            } catch (error: Exception) {
                // ACTION_PICK_IMAGES and camera results do not offer persistable
                // grants; the URI stays readable for this process.
                Log.d(TAG, "no persistable grant for $uri")
            }
        }
        val mimes = limited.map {
            context.contentResolver.getType(it) ?: "application/octet-stream"
        }
        return PickResultData("picked", limited.map(Uri::toString), mimes, null)
    }

    fun cameraResult(uri: Uri, resultCode: Int): PickResultData {
        if (resultCode != Activity.RESULT_OK) {
            return PickResultData("cancelled", emptyList(), emptyList(), null)
        }
        return PickResultData("picked", listOf(uri.toString()), listOf("image/jpeg"), null)
    }

    fun unavailable(reason: String): PickResultData =
        PickResultData("unavailable", emptyList(), emptyList(), reason)
}
