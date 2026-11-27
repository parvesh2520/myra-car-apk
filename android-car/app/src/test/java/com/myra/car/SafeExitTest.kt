package com.myra.car

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SafeExitTest {
    private fun cyclist(x: Float, score: Float = .9f) =
        ExitDetection("Bicycle", score, ExitBox(x, .4f, x + .08f, .67f))

    @Test
    fun warnsForConfirmedOccupancyAndAppliesChimeCooldown() {
        val tracker = SafeExitTracker(DoorSide.RIGHT.zone)
        // One photo about every second: two in a row in the zone confirm it.
        assertNull(tracker.update(0, listOf(cyclist(.7f))).candidate)
        val warning = tracker.update(1000, listOf(cyclist(.7f)))
        assertNotNull(warning.candidate)
        assertFalse(warning.approaching)
        assertTrue(warning.alert)
        assertFalse(tracker.update(2000, listOf(cyclist(.7f))).alert)
        assertNull(tracker.update(3000, emptyList()).candidate)
        assertNull(tracker.update(4000, listOf(cyclist(.7f))).candidate)
    }

    @Test
    fun projectsApproachingTrafficAndRejectsLowConfidenceAndOutsideMotion() {
        val tracker = SafeExitTracker(DoorSide.RIGHT.zone)
        val approach = (0..9).map { tracker.update(it * 1000L, listOf(cyclist(.1f + it * .08f))) }
        assertTrue(approach.any { it.candidate != null && it.approaching })

        val other = SafeExitTracker(DoorSide.RIGHT.zone)
        for (i in 0..9) {
            assertNull(other.update(i * 1000L, listOf(cyclist(.48f - i * .035f), cyclist(.7f, .45f))).candidate)
        }
        val left = SafeExitTracker(DoorSide.LEFT.zone)
        repeat(5) { assertNull(left.update(it * 1000L, listOf(cyclist(.7f))).candidate) }
    }
}
