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
    fun streamsFramesOverOneConnection() {
        val server = PhoneFrameServer()
        try {
            val phone = PhoneEndpoint.parse("127.0.0.1:${server.port}", server.code)!!
            server.publish(CameraFrame(-1, 270, byteArrayOf(1, 2, 3)))
            PhoneStream(phone).use { stream ->
                val a = stream.next()
                assertEquals(-1, a.id); assertEquals(270, a.rotation); assertArrayEquals(byteArrayOf(1, 2, 3), a.jpeg)
                server.publish(CameraFrame(-2, 270, byteArrayOf(4)))
                assertEquals(-2, stream.next().id)
            }
            val wrong = PhoneEndpoint.parse("127.0.0.1:${server.port}", if (server.code == "00000000") "11111111" else "00000000")!!
            assertThrows(IllegalStateException::class.java) { PhoneStream(wrong) }
        } finally {
            server.close()
        }
    }
}
