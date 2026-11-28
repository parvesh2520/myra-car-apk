package com.myra.car

import org.junit.Assert.assertEquals
import org.junit.Test

class HandsFreeTest {
    /** Feeds [pattern] (S = 100 ms Silero says speech, . = not); returns how it ended and when (ms). */
    private fun run(pattern: String): Pair<Endpointer.State, Long> {
        val e = Endpointer()
        pattern.forEachIndexed { i, c ->
            val s = e.feed(if (c == 'S') 0.9f else 0.05f)
            if (s != Endpointer.State.LISTENING) return s to (i + 1) * 100L
        }
        return Endpointer.State.LISTENING to pattern.length * 100L
    }

    @Test fun waitsOutPausesInsideASentence() {
        // "set the AC to" 1.5 s, 0.8 s pause, "twenty two" 1 s, then quiet: ends 1.0 s after the last word.
        assertEquals(Endpointer.State.DONE to 4_300L, run("S".repeat(15) + ".".repeat(8) + "S".repeat(10) + ".".repeat(30)))
    }

    @Test fun aShortStartGetsALongerThinkingPause() {
        // "set the…" 0.8 s, 1.2 s thinking, "temperature to 22": not cut in the pause.
        assertEquals(Endpointer.State.DONE to 4_200L, run("S".repeat(8) + ".".repeat(12) + "S".repeat(12) + ".".repeat(30)))
        assertEquals(2_300L, run("S".repeat(13) + ".".repeat(30)).second) // a full sentence: the normal 1 s
        assertEquals(2_100L, run("SSSSSS" + ".".repeat(30)).second) // "next song": 0.6 s + 1.5 s
    }

    @Test fun hysteresisKeepsSoftSyllables() {
        val e = Endpointer()
        repeat(12) { e.feed(0.9f) }
        repeat(20) { assertEquals(Endpointer.State.LISTENING, e.feed(0.4f)) } // still speech once speaking
    }

    @Test fun nothingSaidOrJustACough() {
        assertEquals(Endpointer.State.NOTHING_SAID to 4_000L, run(".".repeat(60)))
        assertEquals(Endpointer.State.NOTHING_SAID to 4_000L, run("..S" + ".".repeat(60)))
    }

    @Test fun firstWakeWaitsOneSecondThenStillListensToACommand() {
        val bare = Endpointer(1_000L)
        repeat(9) { assertEquals(Endpointer.State.LISTENING, bare.feed(0.05f)) }
        assertEquals(Endpointer.State.NOTHING_SAID, bare.feed(0.05f)) // "Hi Myra" alone: over after 1 s
        val command = Endpointer(1_000L)
        repeat(3) { command.feed(0.05f) }
        repeat(10) { assertEquals(Endpointer.State.LISTENING, command.feed(0.9f)) } // "Hi Myra, turn on the AC"
    }

    @Test fun trimStartsAtThePauseAfterMyra() {
        // 0.3 s of "Myra" (loud), 0.15 s pause, then the command (loud): cut = start of the pause.
        val audio = ShortArray(16000) { i -> if (i < 4800 || i >= 7200) (if (i % 2 == 0) 8000 else -8000).toShort() else 3 }
        assertEquals(4800L, WakeTrim.cut(0, 9600) { audio[it.toInt()] })
        // No pause, only a 20 ms dip (a consonant): keep the whole range rather than risk cutting the command.
        val runOn = ShortArray(16000) { i -> (if (i in 5120 until 5440) 300 else if (i % 2 == 0) 8000 else -8000).toShort() }
        assertEquals(0L, WakeTrim.cut(0, 9600) { runOn[it.toInt()] })
    }

    @Test fun stripsALeftoverWakeWord() {
        assertEquals("turn on the AC.", Wake.strip("Okay Myra, turn on the AC."))
        assertEquals("next song", Wake.strip("Myra next song"))
        assertEquals("Take me to Mira Road", Wake.strip("Take me to Mira Road"))
        assertEquals("Myra", Wake.strip("Myra"))
    }
}
