package dev.ziran.android

import dev.ziran.android.ui.formatPairingCode
import org.junit.Assert.assertEquals
import org.junit.Test

class StartPairingTest {

    @Test
    fun preservesV5AndV4PairingCodesWithoutMangling() {
        assertEquals("", formatPairingCode(""))
        assertEquals("ziran-pair", formatPairingCode("ziran-pair"))
        assertEquals("ziran-pair", formatPairingCode("  ziran-pair \n"))
        assertEquals("K7QM-P2XA-9R4L", formatPairingCode("K7QM-P2XA-9R4L"))
        assertEquals("my_custom_code-2026", formatPairingCode("my_custom_code-2026"))
    }
}
