package dev.ziran.android

import dev.ziran.android.connection.ServerUrls
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cleartext to the emulator host is a debug affordance. A release build may only
 * use http to a real loopback address.
 */
class ServerUrlsTest {

    @Test
    fun releaseAllowsHttpOnlyToRealLoopback() {
        assertTrue(ServerUrls.isLoopbackHost("localhost", debug = false))
        assertTrue(ServerUrls.isLoopbackHost("127.0.0.1", debug = false))
        assertTrue(ServerUrls.isLoopbackHost("::1", debug = false))
        assertFalse("the emulator alias must not work in release", ServerUrls.isLoopbackHost("10.0.2.2", debug = false))
        assertFalse(ServerUrls.isLoopbackHost("example.com", debug = false))
    }

    @Test
    fun debugAddsTheEmulatorAlias() {
        assertTrue(ServerUrls.isLoopbackHost("10.0.2.2", debug = true))
        assertEquals("http://10.0.2.2:7644", ServerUrls.normalize("10.0.2.2:7644", debug = true))
    }

    @Test
    fun releaseRefusesCleartextToTheEmulatorAlias() {
        val failure = runCatching { ServerUrls.normalize("http://10.0.2.2:7644", debug = false) }
            .exceptionOrNull()
        assertTrue("expected a refusal, got $failure", failure is IllegalArgumentException)
        assertTrue(failure!!.message!!.contains("HTTPS"))
    }

    @Test
    fun remoteHttpIsRefusedInBothBuilds() {
        for (debug in listOf(true, false)) {
            val failure = runCatching { ServerUrls.normalize("http://example.com", debug = debug) }
                .exceptionOrNull()
            assertTrue("debug=$debug must refuse remote http", failure is IllegalArgumentException)
        }
    }

    @Test
    fun bareRemoteHostGetsHttps() {
        assertEquals("https://studio-vps:7646", ServerUrls.normalize("studio-vps:7646", debug = true))
    }

    @Test
    fun originIsReducedAndDefaultPortsDropped() {
        assertEquals("https://studio-vps", ServerUrls.normalize("https://studio-vps:443/some/path", debug = false))
        assertEquals("http://127.0.0.1:7644", ServerUrls.normalize("http://127.0.0.1:7644", debug = false))
    }

    @Test
    fun credentialsInTheUrlAreRefused() {
        val failure = runCatching { ServerUrls.normalize("https://user:pass@studio-vps", debug = false) }
            .exceptionOrNull()
        assertTrue(failure is IllegalArgumentException)
    }

    @Test
    fun socketUrlUsesWssForHttpsAndWsForLoopback() {
        assertEquals("wss://studio-vps:7646/v2/ws", ServerUrls.wsUrl("https://studio-vps:7646"))
        assertEquals("ws://127.0.0.1:7644/v2/ws", ServerUrls.wsUrl("http://127.0.0.1:7644"))
    }
}
