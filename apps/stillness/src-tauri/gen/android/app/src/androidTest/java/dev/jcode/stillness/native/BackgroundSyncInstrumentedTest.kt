package dev.jcode.stillness.native

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import android.content.Context
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/** Run on an isolated test installation: these tests change native sync settings. */
@RunWith(AndroidJUnit4::class)
class BackgroundSyncInstrumentedTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val manager get() = WorkManager.getInstance(context)

    private fun work(name: String): List<WorkInfo> =
        manager.getWorkInfosForUniqueWork(name).get(10, TimeUnit.SECONDS)

    /** WorkManager cancellation is asynchronous; poll instead of assuming it
     * already reached the database when `set(false)` returns. */
    private fun awaitFinished(name: String, timeoutMs: Long = 10_000) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (work(name).all { it.state.isFinished }) return
            Thread.sleep(50)
        }
        assertTrue("work $name is still active after ${timeoutMs}ms", work(name).all { it.state.isFinished })
    }

    private fun awaitUnfinished(name: String, timeoutMs: Long = 10_000): WorkInfo {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            work(name).singleOrNull { !it.state.isFinished }?.let { return it }
            Thread.sleep(50)
        }
        fail("no unfinished work was recorded for $name within ${timeoutMs}ms")
        throw IllegalStateException("unreachable")
    }

    @After fun disable() {
        BackgroundSync.set(context, false, null, null)
        manager.cancelUniqueWork(BackgroundSync.UNIQUE_PERIODIC).result.get(10, TimeUnit.SECONDS)
        manager.cancelUniqueWork(BackgroundSync.UNIQUE_ONE_SHOT).result.get(10, TimeUnit.SECONDS)
    }

    @Test fun periodicWorkRequiresNetworkAndBatteryAndIsCancelledWhenDisabled() {
        BackgroundSync.set(context, true, 1, "https://example.com")
        val periodic = awaitUnfinished(BackgroundSync.UNIQUE_PERIODIC)
        assertEquals(NetworkType.CONNECTED, periodic.constraints.requiredNetworkType)
        assertTrue(periodic.constraints.requiresBatteryNotLow())
        assertEquals(15, BackgroundSync.status(context).intervalMinutes)

        BackgroundSync.set(context, false, null, null)
        awaitFinished(BackgroundSync.UNIQUE_PERIODIC)
        assertFalse(BackgroundSync.status(context).queued)
    }

    @Test fun disablingCancelsPendingOneShotAndPreventsNewRequests() {
        BackgroundSync.set(context, true, 30, "https://example.com")
        BackgroundSync.runNow(context)
        BackgroundSync.set(context, false, null, null)
        awaitFinished(BackgroundSync.UNIQUE_ONE_SHOT)
        assertFalse(BackgroundSync.status(context).queued)
        try {
            BackgroundSync.runNow(context)
            fail("disabled sync must reject one-shot work")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }

    @Test fun rejectsUnsupportedBaseUrlWithoutChangingSettings() {
        BackgroundSync.set(context, false, null, null)
        awaitFinished(BackgroundSync.UNIQUE_PERIODIC)
        try {
            BackgroundSync.set(context, true, 30, "file:///etc/passwd")
            fail("only http and https base URLs are accepted")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
        val status = BackgroundSync.status(context)
        assertFalse("a rejected URL must not enable sync", status.enabled)
        assertFalse("a rejected URL must not queue work", status.queued)
        awaitFinished(BackgroundSync.UNIQUE_PERIODIC)
    }
}
