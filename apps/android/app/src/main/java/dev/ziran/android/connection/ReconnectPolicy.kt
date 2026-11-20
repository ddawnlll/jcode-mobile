package dev.ziran.android.connection

import dev.ziran.android.protocol.Backoff

/**
 * Backoff state for reconnects.
 *
 * The attempt counter is owned here and is reset only when a socket actually
 * opens. Resetting it in connect() was the old bug: every retry went through
 * connect(), so the attempt count never grew and the delay stayed at the
 * first step forever.
 */
class ReconnectPolicy(private val delayFor: (Int) -> Long = Backoff::delayMs) {

    private var attempt = 0

    @Synchronized
    fun reset() {
        attempt = 0
    }

    /** Count this attempt and return the delay before the next socket open. */
    @Synchronized
    fun nextDelayMs(): Long {
        attempt += 1
        return delayFor(attempt)
    }

    @get:Synchronized
    val attempts: Int
        get() = attempt
}
