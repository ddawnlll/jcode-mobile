package dev.jcode.stillness.native

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

/**
 * Downloads and open-with.
 *
 * On Android 10+ files are published through MediaStore into
 * `Download/JCode`, which needs no storage permission. On older releases the
 * file is written into the app-specific external Downloads directory and shared
 * through the FileProvider, because asking for WRITE_EXTERNAL_STORAGE just to
 * save an attachment is not justified here.
 */
object Downloads {
    private const val TAG = "JCodeDownloads"
    private const val MAX_BASE64 = 32 * 1024 * 1024
    private const val MAX_BYTES = 24 * 1024 * 1024
    private val RELATIVE_DIR = Environment.DIRECTORY_DOWNLOADS + "/JCode"

    data class DownloadedFileData(
        val status: String,
        val uri: String?,
        val displayName: String?,
        val location: String?,
        val error: String?,
    )

    data class OpenWithData(
        val launched: Boolean,
        val error: String?,
    )

    fun save(context: Context, fileName: String, mimeType: String, base64: String): DownloadedFileData {
        if (base64.length > MAX_BASE64) {
            return DownloadedFileData("failed", null, null, null, "payload_too_large")
        }
        val bytes = try {
            Base64.decode(base64, Base64.DEFAULT)
        } catch (error: IllegalArgumentException) {
            return DownloadedFileData("failed", null, null, null, "invalid_base64")
        }
        if (bytes.size > MAX_BYTES) {
            return DownloadedFileData("failed", null, null, null, "payload_too_large")
        }
        val safeName = sanitize(fileName).ifBlank { "attachment" }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveToMediaStore(context, safeName, mimeType, bytes)
        } else {
            saveToAppFiles(context, safeName, mimeType, bytes)
        }
    }

    private fun saveToMediaStore(
        context: Context,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ): DownloadedFileData {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, RELATIVE_DIR)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val uri = try {
            resolver.insert(collection, values)
        } catch (error: Exception) {
            Log.w(TAG, "MediaStore rejected the download insert", error)
            null
        } ?: return DownloadedFileData("failed", null, null, null, "mediastore_insert_failed")
        return try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: return DownloadedFileData("failed", null, null, null, "mediastore_open_failed")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            DownloadedFileData(
                status = "saved_to_downloads",
                uri = uri.toString(),
                displayName = fileName,
                location = "$RELATIVE_DIR/$fileName",
                error = null,
            )
        } catch (error: Exception) {
            Log.w(TAG, "could not write the MediaStore download", error)
            runCatching { resolver.delete(uri, null, null) }
            DownloadedFileData("failed", null, null, null, error.message ?: "write_failed")
        }
    }

    private fun saveToAppFiles(
        context: Context,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ): DownloadedFileData {
        val root = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: File(context.filesDir, "downloads")
        val dir = File(root, "JCode").apply { mkdirs() }
        val target = File(dir, fileName)
        return try {
            target.outputStream().use { it.write(bytes) }
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                target,
            )
            DownloadedFileData(
                status = "stored_in_app_files",
                uri = uri.toString(),
                displayName = fileName,
                location = target.absolutePath,
                error = null,
            )
        } catch (error: Exception) {
            Log.w(TAG, "could not write the app-file download", error)
            DownloadedFileData("failed", null, null, null, error.message ?: "write_failed")
        }
    }

    fun openWith(context: Context, rawUri: String, mimeType: String?): OpenWithData {
        val uri = try {
            Uri.parse(rawUri)
        } catch (error: Exception) {
            return OpenWithData(false, "invalid_uri")
        }
        if (uri.scheme.isNullOrBlank()) return OpenWithData(false, "invalid_uri")
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mimeType?.takeIf { it.isNotBlank() } ?: "*/*")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (intent.resolveActivity(context.packageManager) == null) {
            return OpenWithData(false, "no_activity_handles_this_file")
        }
        return try {
            context.startActivity(intent)
            OpenWithData(true, null)
        } catch (error: Exception) {
            Log.w(TAG, "open-with failed", error)
            OpenWithData(false, error.message ?: "open_failed")
        }
    }

    private fun sanitize(name: String): String {
        val base = name.substringAfterLast('/').substringAfterLast('\\')
        return base.replace(Regex("[^A-Za-z0-9._-]"), "_").take(128)
    }
}
