package dev.ziran.android

import dev.ziran.android.ui.formatPairingCode
import org.junit.Assert.assertEquals
import org.junit.Test

class StartPairingTest {

    @Test
    fun formatsPairingCodeAsFourFourFour() {
        assertEquals("", formatPairingCode(""))
        assertEquals("K7QM", formatPairingCode("k7qm"))
        assertEquals("K7QM-P2", formatPairingCode("k7qm-p2"))
        assertEquals("K7QM-P2XA-9R4L", formatPairingCode("k7qmp2xa9r4l"))
        assertEquals("K7QM-P2XA-9R4L", formatPairingCode("k7qm-p2xa-9r4l-extra"))
        assertEquals("AB12-CD34", formatPairingCode("ab12!@#cd34"))
    }
}
