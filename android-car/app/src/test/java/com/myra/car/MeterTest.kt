package com.myra.car

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MeterTest {
    @Test
    fun trackerBlinksClosureAndYawns() {
        val d = DrowsinessTracker()
        var t = 0L
        fun run(ms: Long, eyes: Float, jaw: Float = 0f, face: Boolean = true): DrowsinessTracker.Metrics {
            var m = d.update(t, face, eyes, jaw)
            val end = t + ms
            while (t < end) { t += 33; m = d.update(t, face, eyes, jaw) } // 30 fps
            return m
        }
        run(1000, 0.05f)
        repeat(3) { run(150, 0.9f); run(1000, 0.05f) }
        assertEquals(3, run(0, 0.05f).blinksPerMin)
        assertEquals(DrowsinessTracker.Level.ASLEEP, run(1600, 0.9f).level)
        run(1000, 0.05f)
        assertEquals(1, run(1300, 0.05f, jaw = 0.8f).yawns)
        assertEquals(DrowsinessTracker.Level.NO_FACE, run(2100, 0f, face = false).level)
    }

    @Test
    fun eyeClosureDoesNotContinueAcrossMissingFrames() {
        val tracker = DrowsinessTracker()
        tracker.update(0, true, .9f, 0f)
        tracker.update(42, true, .9f, 0f)
        val afterGap = tracker.update(6_000, true, .9f, 0f)
        assertEquals(0L, afterGap.closedMs)
        assertEquals(DrowsinessTracker.Level.TIRING, afterGap.level)
    }

    @Test
    fun oneFramePerSecondStillDetectsLongEyeClosure() {
        val tracker = DrowsinessTracker()
        tracker.update(0, true, .05f, 0f)
        assertEquals(1000L, tracker.update(2_000, true, .9f, 0f).let { tracker.update(3_000, true, .9f, 0f) }.closedMs)
        assertEquals(DrowsinessTracker.Level.ASLEEP, tracker.update(4_000, true, .9f, 0f).level)
    }

    @Test
    fun sendsOnePhotoPerRequest() {
        val server = PhoneFrameServer()
        try {
            val phone = PhoneEndpoint.parse("127.0.0.1:${server.port}", server.code)!!
            server.publish(CameraFrame(-1, 270, byteArrayOf(1, 2, 3)))
            PhoneStream(phone).use { stream ->
                val a = stream.next()
                assertEquals(-1, a.id); assertEquals(270, a.rotation); assertArrayEquals(byteArrayOf(1, 2, 3), a.jpeg)
                val wrong = PhoneEndpoint.parse("127.0.0.1:${server.port}", if (server.code == "00000000") "11111111" else "00000000")!!
                assertThrows(IllegalStateException::class.java) { PhoneStream(wrong) }
                server.publish(CameraFrame(-2, 270, byteArrayOf(4)))
                assertEquals(-2, stream.next().id)
            }
        } finally {
            server.close()
        }
    }
}
