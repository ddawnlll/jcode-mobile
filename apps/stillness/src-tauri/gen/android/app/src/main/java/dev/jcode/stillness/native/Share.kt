package dev.jcode.stillness.native

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.util.Patterns
import androidx.core.content.FileProvider
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * Inbound sharesheet intake and outbound share chooser.
 *
 * Inbound text, URLs, images, and files are copied into the app cache and
 * exposed through the app FileProvider, so the webview never depends on a
 * transient URI grant that ends with the launching activity. The queue is
 * bounded and durable across process death.
 */
object ShareInbox {
    const val PREFS = "jcode_share_inbox"
    private const val KEY_QUEUE = "queue"
    private const val KEY_DISCARDED = "discarded"
    private const val MAX_ITEMS = 10
    private const val MAX_ITEM_BYTES = 25L * 1024L * 1024L
    private const val MAX_MULTI_ITEMS = 5
    private const val TAG = "JCodeShareInbox"

    data class ShareItemData(
        val kind: String,
        val text: String?,
        val url: String?,
        val mimeType: String?,
        val fileName: String?,
        val uri: String?,
        val sizeBytes: Long?,
    )

    data class SharePendingData(
        val items: List<ShareItemData>,
        val discarded: Int,
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun handles(intent: Intent?): Boolean {
        if (intent == null) return false
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) {
            return false
        }
        return intent.type != null || intent.hasExtra(Intent.EXTRA_TEXT) ||
            intent.hasExtra(Intent.EXTRA_STREAM)
    }

    /**
     * Capture an inbound share. Returns true when the intent was a share and was
     * queued (or deliberately dropped as too large, which still counts as
     * handled so the client can surface the failure).
     */
    fun capture(context: Context, intent: Intent): Boolean {
        if (!handles(intent)) return false
        val items = mutableListOf<ShareItemData>()
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()
        if (!text.isNullOrEmpty()) {
            val url = if (Patterns.WEB_URL.matcher(text).matches()) text else null
            items += ShareItemData(
                kind = if (url != null) "url" else "text",
                text = text.take(20_000),
                url = url,
                mimeType = "text/plain",
                fileName = null,
                uri = null,
                sizeBytes = text.length.toLong(),
            )
        }
        val uris = streamUris(intent)
        var dropped = 0
        for (uri in uris.take(MAX_MULTI_ITEMS)) {
            val item = copyStream(context, intent.type, uri)
            if (item == null) {
                dropped += 1
                continue
            }
            items += item
        }
        if (dropped > 0) recordDropped(context, dropped)
        if (items.isEmpty()) {
            // Nothing readable: record the drop so the UI can say so instead of
            // presenting an empty queue as a successful share.
            NativeEvents.emit("shareInbound", mapOf("count" to 0, "dropped" to dropped))
            return true
        }
        append(context, items)
        NativeEvents.emit("shareInbound", mapOf("count" to items.size, "dropped" to dropped))
        return true
    }

    @Suppress("DEPRECATION")
    private fun streamUris(intent: Intent): List<Uri> {
        val clip = intent.clipData
        if (clip != null && clip.itemCount > 0) {
            return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        }
        if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            return intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
        }
        val single = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        return if (single == null) emptyList() else listOf(single)
    }

    private fun copyStream(context: Context, intentType: String?, uri: Uri): ShareItemData? {
        val mime = context.contentResolver.getType(uri) ?: intentType ?: "application/octet-stream"
        val display = queryDisplayName(context, uri)
        val targetDir = File(context.cacheDir, "share-in").apply { mkdirs() }
        val baseName = sanitize(display ?: "shared-${System.currentTimeMillis()}")
        val target = File(targetDir, "${System.currentTimeMillis()}-$baseName")
        var total = 0L
        try {
            val input = context.contentResolver.openInputStream(uri) ?: return null
            input.use { source ->
                target.outputStream().use { sink ->
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        val read = source.read(buffer)
                        if (read <= 0) break
                        total += read
                        if (total > MAX_ITEM_BYTES) {
                            sink.flush()
                            target.delete()
                            Log.w(TAG, "shared item exceeded the 25 MiB bound and was dropped")
                            return null
                        }
                        sink.write(buffer, 0, read)
                    }
                }
            }
        } catch (error: Exception) {
            Log.w(TAG, "could not copy shared stream", error)
            target.delete()
            return null
        }
        val providerUri = try {
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                target,
            )
        } catch (error: Exception) {
            Log.w(TAG, "could not expose shared file through FileProvider", error)
            target.delete()
            return null
        }
        val kind = if (mime.startsWith("image/")) "image" else "file"
        return ShareItemData(
            kind = kind,
            text = null,
            url = null,
            mimeType = mime,
            fileName = display ?: target.name,
            uri = providerUri.toString(),
            sizeBytes = total,
        )
    }

    private fun queryDisplayName(context: Context, uri: Uri): String? {
        return try {
            context.contentResolver.query(
                uri,
                arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                val index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (index < 0) null else cursor.getString(index)
            }
        } catch (error: Exception) {
            null
        }
    }

    private fun sanitize(name: String): String {
        val trimmed = name.substringAfterLast('/').substringAfterLast('\\')
        val cleaned = trimmed.replace(Regex("[^A-Za-z0-9._-]"), "_")
        return cleaned.ifBlank { "shared" }.take(96)
    }

    @Synchronized
    private fun append(context: Context, items: List<ShareItemData>) {
        val stored = prefs(context)
        val queue = try {
            JSONArray(stored.getString(KEY_QUEUE, "[]"))
        } catch (error: Exception) {
            JSONArray()
        }
        for (item in items) queue.put(encode(item))
        var discarded = stored.getInt(KEY_DISCARDED, 0)
        while (queue.length() > MAX_ITEMS) {
            queue.remove(0)
            discarded += 1
        }
        stored.edit()
            .putString(KEY_QUEUE, queue.toString())
            .putInt(KEY_DISCARDED, discarded)
            .apply()
    }

    @Synchronized
    private fun recordDropped(context: Context, count: Int) {
        if (count <= 0) return
        val stored = prefs(context)
        val current = stored.getInt(KEY_DISCARDED, 0)
        stored.edit().putInt(KEY_DISCARDED, current + count).apply()
    }

    @Synchronized
    fun consume(context: Context): SharePendingData {
        val stored = prefs(context)
        val queue = try {
            JSONArray(stored.getString(KEY_QUEUE, "[]"))
        } catch (error: Exception) {
            JSONArray()
        }
        val items = mutableListOf<ShareItemData>()
        for (index in 0 until queue.length()) {
            decode(queue.optJSONObject(index))?.let(items::add)
        }
        val discarded = stored.getInt(KEY_DISCARDED, 0)
        stored.edit().putString(KEY_QUEUE, "[]").putInt(KEY_DISCARDED, 0).apply()
        return SharePendingData(items, discarded)
    }

    private fun encode(item: ShareItemData): JSONObject = JSONObject().apply {
        put("kind", item.kind)
        put("text", item.text)
        put("url", item.url)
        put("mimeType", item.mimeType)
        put("fileName", item.fileName)
        put("uri", item.uri)
        put("sizeBytes", item.sizeBytes)
    }

    private fun decode(json: JSONObject?): ShareItemData? {
        if (json == null) return null
        return ShareItemData(
            kind = json.optString("kind", "file"),
            text = if (json.isNull("text")) null else json.optString("text"),
            url = if (json.isNull("url")) null else json.optString("url"),
            mimeType = if (json.isNull("mimeType")) null else json.optString("mimeType"),
            fileName = if (json.isNull("fileName")) null else json.optString("fileName"),
            uri = if (json.isNull("uri")) null else json.optString("uri"),
            sizeBytes = if (json.isNull("sizeBytes")) null else json.optLong("sizeBytes"),
        )
    }
}

object ShareOut {
    data class OutboundRequest(
        val text: String?,
        val url: String?,
        val uri: String?,
        val mimeType: String?,
        val title: String?,
    )

    data class ShareLaunchedData(
        val launched: Boolean,
        val chooser: String?,
        val error: String?,
    )

    fun share(context: Context, request: OutboundRequest): ShareLaunchedData {
        val pieces = listOfNotNull(
            request.text?.takeIf { it.isNotBlank() },
            request.url?.takeIf { it.isNotBlank() },
        )
        if (pieces.isEmpty() && request.uri.isNullOrBlank()) {
            return ShareLaunchedData(false, null, "nothing_to_share")
        }
        val mime = request.mimeType?.takeIf { it.isNotBlank() }
            ?: if (request.uri.isNullOrBlank()) "text/plain" else "application/octet-stream"
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mime
            if (pieces.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, pieces.joinToString("\n\n"))
            val configured = request.uri
            if (!configured.isNullOrBlank()) {
                val parsed = Uri.parse(configured)
                putExtra(Intent.EXTRA_STREAM, parsed)
                clipData = ClipData.newRawUri("JCode attachment", parsed)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        val chooser = Intent.createChooser(send, request.title ?: "Share from JCode").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            context.startActivity(chooser)
            ShareLaunchedData(
                true,
                send.resolveActivity(context.packageManager)?.flattenToShortString(),
                null,
            )
        } catch (error: Exception) {
            Log.w("JCodeShareOut", "no share target accepted the intent", error)
            ShareLaunchedData(false, null, error.message ?: "no_share_target")
        }
    }
}
