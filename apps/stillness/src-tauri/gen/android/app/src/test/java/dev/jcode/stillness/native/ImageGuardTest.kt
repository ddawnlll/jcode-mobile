package dev.jcode.stillness.native

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageGuardTest {
    @Test
    fun acceptsImageMimeTypesCaseInsensitively() {
        assertTrue(ImageGuard.isImageMime("image/png"))
        assertTrue(ImageGuard.isImageMime("IMAGE/JPEG"))
        assertTrue(ImageGuard.isImageMime("image/heic"))
    }

    @Test
    fun rejectsNonImageAndBlankMimeTypes() {
        assertFalse(ImageGuard.isImageMime("application/pdf"))
        assertFalse(ImageGuard.isImageMime("text/plain"))
        assertFalse(ImageGuard.isImageMime(null))
        assertFalse(ImageGuard.isImageMime(""))
    }

    @Test
    fun enforcesTheFourMebibyteDecodedLimit() {
        assertFalse(ImageGuard.exceedsLimit(0))
        assertFalse(ImageGuard.exceedsLimit(ImageGuard.MAX_DECODED_BYTES))
        assertTrue(ImageGuard.exceedsLimit(ImageGuard.MAX_DECODED_BYTES + 1))
    }

    @Test
    fun mapsKnownImageExtensions() {
        assertEquals("image/png", ImageGuard.mimeForFileName("shot.PNG"))
        assertEquals("image/jpeg", ImageGuard.mimeForFileName("photo.jpeg"))
        assertEquals("image/webp", ImageGuard.mimeForFileName("a.b.webp"))
        assertEquals("image/heic", ImageGuard.mimeForFileName("IMG_0001.HEIC"))
        assertNull(ImageGuard.mimeForFileName("notes.txt"))
        assertNull(ImageGuard.mimeForFileName(null))
        assertNull(ImageGuard.mimeForFileName("no-extension"))
    }
}
