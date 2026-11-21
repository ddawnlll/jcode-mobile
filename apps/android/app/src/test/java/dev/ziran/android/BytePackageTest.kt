package dev.ziran.android

import dev.ziran.android.protocol.BYTE_PACKAGE_CHUNK
import dev.ziran.android.protocol.BYTE_PACKAGE_LIMIT
import dev.ziran.android.protocol.Backoff
import dev.ziran.android.protocol.BytePackageAssembler
import dev.ziran.android.protocol.BytePackageViolation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class BytePackageTest {
    @Test fun rejectsSmallLength() {
        val a = BytePackageAssembler()
        assertFalse(a.begin(BYTE_PACKAGE_CHUNK)) // must be > 64 KiB
        assertFalse(a.begin(0))
        assertFalse(a.begin(null))
    }

    @Test fun rejectsTooLarge() {
        val a = BytePackageAssembler()
        assertFalse(a.begin(BYTE_PACKAGE_LIMIT + 1))
        assertTrue(a.begin(BYTE_PACKAGE_LIMIT))
    }

    @Test fun assemblesAcrossChunks() {
        val payload = "x".repeat(BYTE_PACKAGE_CHUNK + 10)
        val bytes = payload.toByteArray(Charsets.UTF_8)
        val a = BytePackageAssembler()
        assertTrue(a.begin(bytes.size))
        val first = bytes.copyOfRange(0, BYTE_PACKAGE_CHUNK)
        assertNull(a.feed(first))
        val rest = bytes.copyOfRange(BYTE_PACKAGE_CHUNK, bytes.size)
        assertEquals(payload, a.feed(rest))
    }

    @Test fun oversizeChunkFails() {
        val a = BytePackageAssembler()
        assertTrue(a.begin(BYTE_PACKAGE_CHUNK + 5))
        try {
            a.feed(ByteArray(BYTE_PACKAGE_CHUNK + 1))
            fail("expected violation")
        } catch (_: BytePackageViolation) { }
    }

    @Test fun overflowFails() {
        val a = BytePackageAssembler()
        assertTrue(a.begin(BYTE_PACKAGE_CHUNK + 20))
        a.feed(ByteArray(BYTE_PACKAGE_CHUNK))
        try {
            a.feed(ByteArray(30))
            fail("expected overflow")
        } catch (_: BytePackageViolation) { }
    }

    @Test fun emptyChunkFails() {
        val a = BytePackageAssembler()
        assertTrue(a.begin(BYTE_PACKAGE_CHUNK + 1))
        try {
            a.feed(ByteArray(0))
            fail("expected violation")
        } catch (_: BytePackageViolation) { }
    }

    @Test fun backoffIsDoublingCappedAt12s() {
        assertEquals(1000L, Backoff.delayMs(1))
        assertEquals(2000L, Backoff.delayMs(2))
        assertEquals(4000L, Backoff.delayMs(3))
        assertEquals(8000L, Backoff.delayMs(4))
        assertEquals(12000L, Backoff.delayMs(10))
        assertEquals(12000L, Backoff.delayMs(100))
    }
}
