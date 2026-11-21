package dev.ziran.android

import dev.ziran.android.ui.DeepLinks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The link shape `adb shell am start -d` uses, decoded exactly once.
 */
class DeepLinkParseTest {

    @Test
    fun parsesPairingLinkWithEncodedUrl() {
        val route = DeepLinks.parse(
            "ziran://pair?v=2&url=http%3A%2F%2F10.0.2.2%3A7651&code=DEMQ-2345-WXYZ",
        )
        assertTrue("expected a pair route, got $route", route is DeepLinks.Route.Pair)
        val pair = route as DeepLinks.Route.Pair
        assertEquals("http://10.0.2.2:7651", pair.server)
        assertEquals("DEMQ-2345-WXYZ", pair.code)
    }

    @Test
    fun parsesTheJcodeSchemeToo() {
        val route = DeepLinks.parse(
            "jcode://pair?v=2&url=https%3A%2F%2Fstudio-vps%3A7646&code=K7QM-P2XA-M4ZT",
        )
        assertTrue(route is DeepLinks.Route.Pair)
        assertEquals("https://studio-vps:7646", (route as DeepLinks.Route.Pair).server)
    }

    @Test
    fun rejectsUnsupportedLinks() {
        assertEquals(DeepLinks.Route.Unknown, DeepLinks.parse("ziran://pair?v=2"))
        assertEquals(DeepLinks.Route.Unknown, DeepLinks.parse("https://example.com"))
        assertEquals(DeepLinks.Route.Unknown, DeepLinks.parse(null))
    }

    @Test
    fun parsesSessionLink() {
        val route = DeepLinks.parse("ziran://session/s_123")
        assertTrue(route is DeepLinks.Route.Session)
        assertEquals("s_123", (route as DeepLinks.Route.Session).sessionId)
    }
}
