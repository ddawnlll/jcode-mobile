package dev.ziran.android

import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.paintingColorFilter
import dev.ziran.android.design.sceneByKey
import dev.ziran.android.ui.NavKind
import dev.ziran.android.ui.Screen
import dev.ziran.android.ui.backKindFor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RefreshRateAndMotionTest {

    @Test
    fun selects120HzModeMatchingCurrentResolution() {
        val modes = listOf(
            DisplayModeCandidate(modeId = 1, width = 1080, height = 2400, refreshRate = 60f),
            DisplayModeCandidate(modeId = 2, width = 1080, height = 2400, refreshRate = 120f),
            DisplayModeCandidate(modeId = 3, width = 1440, height = 3200, refreshRate = 144f),
        )
        val best = selectPeakRefreshMode(modes, currentWidth = 1080, currentHeight = 2400)
        assertNotNull(best)
        assertEquals(2, best!!.modeId)
        assertEquals(120f, best.refreshRate, 0.01f)
    }

    @Test
    fun fallsBackToHighestRateWhenResolutionAbsent() {
        val modes = listOf(
            DisplayModeCandidate(modeId = 4, width = 1080, height = 2400, refreshRate = 90f),
            DisplayModeCandidate(modeId = 5, width = 1080, height = 2400, refreshRate = 120f),
        )
        val best = selectPeakRefreshMode(modes, currentWidth = 720, currentHeight = 1600)
        assertEquals(5, best?.modeId)
    }

    @Test
    fun emptyModeListReturnsNull() {
        assertNull(selectPeakRefreshMode(emptyList(), 1080, 2400))
    }

    @Test
    fun pickersRollAwayAndThreadsSlideBack() {
        assertEquals(NavKind.Roll, backKindFor(Screen.Model()))
        assertEquals(NavKind.Roll, backKindFor(Screen.Scenes))
        assertEquals(NavKind.Slide, backKindFor(Screen.Thread("sess-fox")))
    }

    @Test
    fun nightColorFilterInactiveAtDayAndPresentAtNight() {
        assertNull(paintingColorFilter(0f))
        assertNotNull(paintingColorFilter(0.5f))
        assertNotNull(paintingColorFilter(1f))
    }

    @Test
    fun butterflyLabelMatchesBoardCopy() {
        assertEquals("butterfly dream", sceneByKey("butterfly").label)
    }

    @Test
    fun reducedMotionFadeStaysWithinSpec() {
        assert(WuDurations.ReducedFade <= 150) {
            "Reduced motion fade must be <= 150 ms per Motion.dc.html"
        }
    }
}
