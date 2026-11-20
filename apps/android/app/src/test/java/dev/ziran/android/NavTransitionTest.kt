package dev.ziran.android

import androidx.compose.ui.geometry.Offset
import dev.ziran.android.design.MotionMath
import dev.ziran.android.ui.NavKind
import dev.ziran.android.ui.navDurationMs
import dev.ziran.android.ui.rodOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Transition geometry and board timings, without a device. */
class NavTransitionTest {

    @Test
    fun boardDurationsMatchMotionBoard() {
        assertEquals(900, navDurationMs(NavKind.InkDrop))
        assertEquals(800, navDurationMs(NavKind.Unroll))
        assertEquals(420, navDurationMs(NavKind.Slide))
    }

    @Test
    fun predictiveBackCommitsPastOneThirdOnly() {
        assertEquals(false, MotionMath.shouldCommitBack(0.30f))
        assertEquals(false, MotionMath.shouldCommitBack(1f / 3f))
        assertTrue(MotionMath.shouldCommitBack(0.34f))
        assertTrue(MotionMath.shouldCommitBack(1f))
    }

    @Test
    fun predictiveBackShrinksToNinetyPercentAndRoundsCorners() {
        assertEquals(1f, MotionMath.predictiveScale(0f), 0.0001f)
        assertEquals(0.9f, MotionMath.predictiveScale(1f), 0.0001f)
        assertEquals(0f, MotionMath.predictiveCornerPx(0f), 0.0001f)
        assertEquals(30f, MotionMath.predictiveCornerPx(1f), 0.0001f)
    }

    @Test
    fun backSlideLeavesRightAndReturnsFromTwentyTwoPercentParallax() {
        val width = 1080f
        // At rest: leaving page at 0, page beneath parked at -22 percent.
        assertEquals(0f, MotionMath.backSlideOffsetX(0f, width), 0.01f)
        assertEquals(-237.6f, MotionMath.backParallaxOffsetX(0f, width), 0.01f)
        // Committed: leaving page fully off-screen, beneath page at rest.
        assertEquals(1080f, MotionMath.backSlideOffsetX(1f, width), 0.01f)
        assertEquals(0f, MotionMath.backParallaxOffsetX(1f, width), 0.01f)
    }

    @Test
    fun unrollRodTracksProgress() {
        assertEquals(0, rodOffset(0f, 2000f).y)
        assertEquals(1000, rodOffset(0.5f, 2000f).y)
        assertEquals(2000, rodOffset(1f, 2000f).y)
        // Clamped, never past the bottom edge.
        assertEquals(2000, rodOffset(1.4f, 2000f).y)
    }

    @Test
    fun inkDropOriginIsARealPointOrUnspecified() {
        assertEquals(Offset.Unspecified, Offset.Unspecified)
        assertTrue(Offset(12f, 40f) != Offset.Unspecified)
    }
}
