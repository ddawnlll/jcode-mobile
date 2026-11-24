package dev.ziran.android

import dev.ziran.android.design.statusBarUsesDarkIcons
import dev.ziran.android.ui.contentTopSpacerDp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression test for Bug 1a (Samsung Galaxy A34 status bar / display cutout insets
 * and painting top-band status bar icon polarity).
 */
class InsetsAndLuminanceTest {

    @Test
    fun contentTopSpacerNeverGoesUnderStatusBarOrCutout() {
        // Normal phone portrait (top inset 36 dp): target 170 dp -> 134 dp spacer below safe top.
        assertEquals(134, contentTopSpacerDp(170, topInsetDp = 36, minClearanceDp = 56))
        // Galaxy A34 tall teardrop notch (top inset 54 dp): target 170 dp -> 116 dp spacer.
        assertEquals(116, contentTopSpacerDp(170, topInsetDp = 54, minClearanceDp = 56))
        // Short painting or very tall cutout (top inset 140 dp): clamped to minClearanceDp (56 dp).
        assertEquals(56, contentTopSpacerDp(170, topInsetDp = 140, minClearanceDp = 56))
        // Settings/Threads compact header (target 112 dp) with tall notch (60 dp): clears safely.
        assertEquals(52, contentTopSpacerDp(112, topInsetDp = 60, minClearanceDp = 12))
    }

    @Test
    fun statusBarIconPolarityFollowsPaintingTopLuminance() {
        // Light day sky -> dark status bar icons.
        assertTrue(statusBarUsesDarkIcons(0.72f))
        // Dark night painting -> light status bar icons.
        assertFalse(statusBarUsesDarkIcons(0.24f))
        // Threshold boundary.
        assertTrue(statusBarUsesDarkIcons(0.45f))
        assertFalse(statusBarUsesDarkIcons(0.44f))
    }
}
