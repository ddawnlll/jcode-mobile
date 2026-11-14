package dev.jcode.stillness.native

/**
 * Pure guards for the image reader.
 *
 * Kept free of Android types so a plain JVM unit test can cover the size and
 * type decisions that gate the adapter's attachment path.
 */
object ImageGuard {
    const val MAX_DECODED_BYTES = 4L * 1024L * 1024L

    fun isImageMime(mime: String?): Boolean =
        !mime.isNullOrBlank() && mime.startsWith("image/", ignoreCase = true)

    fun exceedsLimit(decodedBytes: Long): Boolean = decodedBytes > MAX_DECODED_BYTES

    fun mimeForFileName(name: String?): String? {
        val extension = name
            ?.substringAfterLast('.', "")
            ?.lowercase()
            ?.takeIf { it.isNotEmpty() }
            ?: return null
        return when (extension) {
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "bmp" -> "image/bmp"
            "heic", "heif" -> "image/heic"
            "avif" -> "image/avif"
            else -> null
        }
    }
}
