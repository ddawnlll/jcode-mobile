package dev.ziran.android

import dev.ziran.android.protocol.PairingPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class PairingPayloadTest {
    private fun assertRejected(link: String) {
        try {
            PairingPayload.parse(link, 1_000_000L)
            fail("expected rejection: $link")
        } catch (e: IllegalArgumentException) {
            // expected
        }
    }

    @Test fun parsesHttpsLink() {
        val p = PairingPayload.parse("jcode://pair?v=2&url=https%3A%2F%2Fstudio-vps%3A7646&code=K7QM-P2XA-M4ZT", 1_000_000L)
        assertEquals("https://studio-vps:7646", p.server)
        assertEquals("K7QM-P2XA-M4ZT", p.code)
    }

    @Test fun loopbackHttpAllowed() {
        val p = PairingPayload.parse("jcode://pair?v=2&url=http%3A%2F%2F127.0.0.1%3A7644&code=ABCD-EFGH-JKLM", 1_000_000L)
        assertEquals("http://127.0.0.1:7644", p.server)
    }

    @Test fun remoteHttpRejected() {
        assertRejected("jcode://pair?v=2&url=http%3A%2F%2Fexample.com&code=ABCD-EFGH-JKLM")
    }

    @Test fun wrongVersionRejected() {
        assertRejected("jcode://pair?v=3&url=https%3A%2F%2Fa&code=ABCD-EFGH-JKLM")
    }

    @Test fun badCodeRejected() {
        assertRejected("jcode://pair?v=2&url=https%3A%2F%2Fa&code=ABCD-EFGH-JKL")
        assertRejected("jcode://pair?v=2&url=https%3A%2F%2Fa&code=abcd-efgh-jklm")
        assertRejected("jcode://pair?v=2&url=https%3A%2F%2Fa&code=ABCD-EFGH-JKL0")
    }

    @Test fun unknownFieldRejected() {
        assertRejected("jcode://pair?v=2&url=https%3A%2F%2Fa&code=ABCD-EFGH-JKLM&bogus=1")
    }

    @Test fun expiredRejected() {
        assertRejected("jcode://pair?v=2&url=https%3A%2F%2Fa&code=ABCD-EFGH-JKLM&expires=999")
    }

    @Test fun nameParamAccepted() {
        val p = PairingPayload.parse("jcode://pair?v=2&url=https%3A%2F%2Fa&code=ABCD-EFGH-JKLM&name=mbp", 1_000_000L)
        assertEquals("mbp", p.name)
    }

    @Test fun wrongHostRejected() {
        assertRejected("jcode://other?v=2&url=https%3A%2F%2Fa&code=ABCD-EFGH-JKLM")
    }

    @Test fun dotLocalhostAllowed() {
        val p = PairingPayload.parse("jcode://pair?v=2&url=http%3A%2F%2Ffoo.localhost&code=ABCD-EFGH-JKLM", 1_000_000L)
        assertTrue(p.server.startsWith("http://"))
    }
}
