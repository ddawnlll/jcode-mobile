package dev.jcode.stillness.native

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import java.io.ByteArrayOutputStream

/**
 * Read one picked image into base64 for the adapter attachment path.
 *
 * The command accepts the content URI returned by the Photo Picker, the Storage
 * Access Framework, or camera capture. It rejects non-image MIME types, enforces
 * a 4 MiB decoded limit before base64 encoding, and never logs image bytes. The
 * adapter still validates count, type, size, and magic bytes; this guard exists
 * so the phone does not ship an obviously invalid payload.
 */
object ImageReader {
    data class PickedImageData(
        val status: String,
        val mimeType: String?,
        val name: String?,
        val size: Int?,
        val base64: String?,
        val error: String?,
    )

    fun read(context: Context, rawUri: String): PickedImageData {
        val uri = try {
            Uri.parse(rawUri)
        } catch (error: Exception) {
            return failure("unreadable", null, null, "invalid_uri")
        }
        if (uri.scheme != "content" && uri.scheme != "file") {
            return failure("unreadable", null, null, "unsupported_scheme")
        }
        val name = queryDisplayName(context, uri) ?: uri.lastPathSegment ?: "image"
        val declared = try {
            context.contentResolver.getType(uri)
        } catch (error: Exception) {
            null
        }
        val mime = declared?.takeIf { it.isNotBlank() } ?: ImageGuard.mimeForFileName(name)
        if (!ImageGuard.isImageMime(mime)) {
            return failure("unsupported_type", mime, name, "not_an_image")
        }
        val stream = try {
            context.contentResolver.openInputStream(uri)
        } catch (error: Exception) {
            // The message can contain a path but never image bytes.
            return failure("unreadable", mime, name, error.javaClass.simpleName)
        } ?: return failure("unreadable", mime, name, "stream_unavailable")

        val bytes = try {
            stream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                var total = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    total += read
                    if (ImageGuard.exceedsLimit(total)) {
                        return failure("too_large", mime, name, "exceeds_4_mib")
                    }
                    output.write(buffer, 0, read)
                }
                output.toByteArray()
            }
        } catch (error: Exception) {
            return failure("unreadable", mime, name, error.javaClass.simpleName)
        }

        return PickedImageData(
            status = "ok",
            mimeType = mime,
            name = name,
            size = bytes.size,
            base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
            error = null,
        )
    }

    private fun failure(
        status: String,
        mimeType: String?,
        name: String?,
        error: String,
    ): PickedImageData = PickedImageData(
        status = status,
        mimeType = mimeType,
        name = name,
        size = null,
        base64 = null,
        error = error,
    )

    private fun queryDisplayName(context: Context, uri: Uri): String? = try {
        context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index < 0) null else cursor.getString(index)
        }
    } catch (error: Exception) {
        null
    }
}
