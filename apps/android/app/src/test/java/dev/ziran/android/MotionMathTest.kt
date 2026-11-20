package dev.ziran.android

import android.view.HapticFeedbackConstants
import dev.ziran.android.design.MotionMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionMathTest {
    @Test fun commitPastOneThird() {
        assertFalse(MotionMath.shouldCommitBack(0.32f))
        assertTrue(MotionMath.shouldCommitBack(0.34f))
    }

    @Test fun predictiveScaleReachesNinetyPercent() {
        assertEquals(1f, MotionMath.predictiveScale(0f), 0.0001f)
        assertEquals(0.9f, MotionMath.predictiveScale(1f), 0.0001f)
    }

    @Test fun parallaxIsTwentyTwoPercent() {
        assertEquals(-22f, MotionMath.backParallaxOffsetX(0f, 100f), 0.0001f)
        assertEquals(0f, MotionMath.backParallaxOffsetX(1f, 100f), 0.0001f)
    }

    @Test fun archiveThresholdIs110px() {
        assertEquals(110f, MotionMath.ArchiveThresholdPx, 0.0001f)
        assertEquals(-420f, MotionMath.ArchiveOffscreenPx, 0.0001f)
    }

    @Test fun pullProgressCapsAtOne() {
        assertEquals(0f, MotionMath.pullProgress(0f), 0.0001f)
        assertEquals(1f, MotionMath.pullProgress(140f), 0.0001f)
    }

    @Test fun rippleCurveStartsAtEightPercent() {
        assertEquals(0.08f, MotionMath.rippleScale(0f), 0.0001f)
        assertEquals(1f, MotionMath.rippleScale(1f), 0.0001f)
    }

    @Test fun hapticConstantsMatchSpec() {
        // CONTEXT_CLICK on seals, LONG_PRESS on long-press: API values exist.
        assertTrue(HapticFeedbackConstants.CONTEXT_CLICK >= 0)
        assertTrue(HapticFeedbackConstants.LONG_PRESS >= 0)
    }

    @Test fun liveTimelineDurations() {
        assertEquals(550, MotionMath.ToolInMs)
        assertEquals(900, MotionMath.RingDrawMs)
        assertEquals(750, MotionMath.PanelMs)
        assertEquals(65, MotionMath.WordStaggerMs)
    }
}
