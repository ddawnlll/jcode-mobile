package dev.ziran.android

import dev.ziran.android.ui.DeepLinks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeepLinkTest {
    @Test fun ziranPairLinkParses() {
        val route = DeepLinks.parse("ziran://pair?v=2&url=http%3A%2F%2F10.0.2.2%3A7651&code=ABCD-EFGH-JKLM")
        assertTrue("got $route", route is DeepLinks.Route.Pair)
        val pair = route as DeepLinks.Route.Pair
        assertEquals("http://10.0.2.2:7651", pair.server)
        assertEquals("ABCD-EFGH-JKLM", pair.code)
    }

    @Test fun jcodePairLinkParses() {
        val route = DeepLinks.parse("jcode://pair?v=2&url=https%3A%2F%2Fexample.com&code=ABCD-EFGH-JKLM")
        assertTrue(route is DeepLinks.Route.Pair)
    }

    @Test fun sessionLinkParses() {
        val route = DeepLinks.parse("ziran://session/sess-42")
        assertEquals("sess-42", (route as DeepLinks.Route.Session).sessionId)
    }
}
