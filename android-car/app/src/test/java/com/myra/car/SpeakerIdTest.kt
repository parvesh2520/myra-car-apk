package com.myra.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

/**
 * Fbank was checked once against sherpa-onnx's own features (OnlineStream.get_frames) on the backend's sample
 * clips: max difference 1.5e-4. These tests guard the shape of the features and the backend's matching rules.
 */
class SpeakerIdTest {
    private fun e(vararg v: Float) = SpeakerId.unit(v)

    @Test
    fun fbankFramesAndPitch() {
        val tone = FloatArray(16000) { (0.3 * sin(2 * PI * 1000 * it / 16000)).toFloat() }
        val f = Fbank.compute(tone)
        assertEquals(100, f.size / Fbank.BINS) // snip_edges=false: (16000 + 80) / 160
        // After global-mean the frames are equal, so look at the raw energy instead: the 1 kHz bin is the loudest.
        val raw = Fbank.compute(FloatArray(16000) { if (it < 8000) tone[it] else 0f })
        val first = (0 until Fbank.BINS).maxBy { raw[10 * Fbank.BINS + it] }
        assertTrue("1 kHz lands in mel bin $first", first in 26..28) // mel(1000 Hz) = 1000, bin centres every 34.2 mel from 31.8
    }

    @Test
    fun voicedDropsSilence() {
        val a = FloatArray(4800) { if (it < 2400) 0f else (0.2 * sin(it * 0.3)).toFloat() }
        assertEquals(2400, SpeakerId.voiced(a).size)
    }

    @Test
    fun matchingRules() {
        val p = Voiceprints()
        p.add("Asha", e(1f, 0f, 0f))
        p.add("Ravi", e(0f, 1f, 0f))
        assertEquals("Asha", p.match(e(0.9f, 0.1f, 0.2f))!!.profile)
        assertNull("too far from everyone", p.match(e(0f, 0f, 1f)))
        assertNull("ambiguous between two", p.match(e(1f, 1f, 0f)))
        assertThrows(IllegalArgumentException::class.java) { p.add("Asha", e(0f, 0f, 1f)) } // a different person
        repeat(8) { p.add("Asha", e(1f, 0.05f, 0f)) }
        assertEquals(SpeakerId.MAX_SAMPLES, p.counts()["Asha"])
        p.remove("Ravi")
        assertEquals(setOf("Asha"), p.counts().keys)
    }
}
