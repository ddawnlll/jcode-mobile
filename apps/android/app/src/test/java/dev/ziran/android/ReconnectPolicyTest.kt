package dev.ziran.android.connection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The old code reset the attempt counter inside connect(), and every retry went
 * through connect(), so the delay never grew past the first step.
 */
class ReconnectPolicyTest {

    @Test
    fun delaysGrowThenCapAtTwelveSeconds() {
        val policy = ReconnectPolicy()
        val delays = (1..10).map { policy.nextDelayMs() }

        assertEquals(1_000L, delays[0])
        // Strictly increasing until the cap.
        val growing = delays.take(5)
        assertTrue("delays must grow: $delays", growing.zipWithNext().all { (a, b) -> b > a })
        // Never above the cap, and the cap is actually reached.
        assertTrue("no delay may exceed 12 s: $delays", delays.all { it <= 12_000L })
        assertEquals(12_000L, delays.last())
    }

    @Test
    fun resetReturnsToTheFirstStep() {
        val policy = ReconnectPolicy()
        repeat(4) { policy.nextDelayMs() }
        assertEquals(4, policy.attempts)

        policy.reset()

        assertEquals(0, policy.attempts)
        assertEquals(1_000L, policy.nextDelayMs())
    }

    @Test
    fun attemptsAccumulateWithoutReset() {
        val policy = ReconnectPolicy()
        repeat(3) { policy.nextDelayMs() }
        assertEquals("connect() must not clear this", 3, policy.attempts)
    }
}
