package dev.ziran.android.protocol

/**
 * v4 byte packages: a JSON transport.bytes descriptor, then binary chunks of
 * at most 64 KiB, at most 64 MiB in total. Any violation closes with 4002.
 * Mirrors adapter.ts handleFrame / failBytePackage.
 */
class BytePackageAssembler {
    private var buffer: ByteArray? = null
    private var used = 0

    val active: Boolean get() = buffer != null

    /** Begin a package. Returns null when the descriptor is invalid. */
    fun begin(length: Int?): Boolean {
        if (length == null) return false
        if (length <= BYTE_PACKAGE_CHUNK || length > BYTE_PACKAGE_LIMIT) return false
        buffer = ByteArray(length)
        used = 0
        return true
    }

    /** Feed one binary chunk. Returns the assembled text when complete, or null. */
    fun feed(chunk: ByteArray): String? {
        val b = buffer ?: return null
        if (chunk.isEmpty() || chunk.size > BYTE_PACKAGE_CHUNK || used + chunk.size > b.size) {
            reset()
            throw BytePackageViolation()
        }
        System.arraycopy(chunk, 0, b, used, chunk.size)
        used += chunk.size
        if (used < b.size) return null
        val complete = b
        reset()
        return try {
            String(complete, Charsets.UTF_8)
        } catch (_: Exception) {
            throw BytePackageViolation()
        }
    }

    fun reset() {
        buffer = null
        used = 0
    }
}

class BytePackageViolation : Exception("Invalid byte package")

/**
 * Reconnect backoff: 500 ms doubling, capped at 12 s. From adapter.ts:
 * 500 * 2^min(attempt, 5), capped at 12_000.
 */
object Backoff {
    fun delayMs(attempt: Int): Long {
        val a = attempt.coerceIn(1, 10)
        return minOf(12000L, 500L * (1L shl minOf(a, 5)))
    }
}
