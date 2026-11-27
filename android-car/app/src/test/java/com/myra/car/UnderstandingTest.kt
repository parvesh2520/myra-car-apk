package com.myra.car

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class UnderstandingTest {
    @Test
    fun actionsUseTheValuesTheModelTagged() {
        fun act(intent: String, text: String, slots: Map<String, String> = emptyMap()): String? =
            Car.action(intent, text, slots)?.let { a -> a.keys().asSequence().sorted().joinToString(",", "{", "}") { "\"$it\":${JSONObject.wrap(a.get(it)).let { v -> if (v is String) "\"$v\"" else v }}" } }
        assertEquals("""{"type":"climate.setTemp","value":24}""", act("climate_temperature_set", "make it twenty four", mapOf("TEMP" to "twenty four")))
        assertEquals("""{"type":"climate.fan","value":4}""", act("climate_fan_speed_set", "fan on four please", mapOf("LEVEL" to "four")))
        assertEquals("""{"type":"media.volume","value":18}""", act("volume_set", "volume 18"))
        assertEquals("""{"mute":true,"type":"media.volume"}""", act("volume_mute", "silence the speakers"))
        assertEquals("""{"color":"purple","type":"ambient.color"}""", act("ambient_light_set", "make the cabin violet", mapOf("COLOR" to "violet")))
        assertEquals("""{"genre":"chill","type":"media.play"}""", act("media_play", "put on lo fi", mapOf("GENRE" to "lo fi")))
        assertEquals("""{"destination":"Juhu Beach","type":"nav.start"}""", act("navigation_destination_request", "how do i get to juhu beach", mapOf("PLACE" to "juhu beach")))
        assertEquals("""{"delta":-1,"type":"seat.height"}""", act("seat_down", "my seat is too high"))
        assertEquals("""{"type":"seat.height","value":2}""", act("seat_height_set", "seat to two", mapOf("LEVEL" to "two")))
        assertEquals("""{"type":"nav.stop"}""", act("navigation_stop", "cancel the route"))
        assertEquals("""{"type":"climate.fan","value":2}""", act("climate_fan_speed_down", "knock the fan down to two", mapOf("LEVEL" to "two")))
        assertEquals("""{"delta":-1,"type":"climate.fan"}""", act("climate_fan_speed_down", "turn the fan down"))
        assertNull(act("climate_fan_speed_set", "fan to nine", mapOf("LEVEL" to "nine"))) // outside 0-7: ask, don't clamp
        assertNull(act("ambient_light_set", "change the lights"))
    }

    @Test
    fun shortcutDefinitionsFoundByTheModel() {
        assertEquals("movie night" to listOf("dim the lights", "play calm music"),
            Shortcuts.definitionAfter("Remember that movie night means dim the lights and play calm music.", "movie night"))
        assertEquals("road trip" to listOf("set the ac to 20"),
            Shortcuts.definitionAfter("Make road trip a shortcut for set the AC to 20", "road trip"))
        assertNull(Shortcuts.definitionAfter("whenever I say chill mode", "chill mode"))
    }

    @Test
    fun remembersWhatTheDriverMeant() {
        val file = File.createTempFile("learned", ".json").apply { delete() }
        try {
            val learned = Learned(file)
            learned.remember("It's a bit stuffy in here.", JSONObject("""{"type":"climate.fan","delta":1}"""))
            val again = Learned(file).all
            assertEquals("climate.fan", again.recall("it's a bit stuffy in here", { null })?.getString("type"))
            assertEquals("climate.fan", again.recall("Hey Myra, it's a bit stuffy in here", { floatArrayOf(1f, 0f) })?.getString("type"))
            assertNull(again.recall("play some music", { if (it == "play some music") floatArrayOf(0f, 1f) else floatArrayOf(1f, 0f) }))
        } finally {
            file.delete()
        }
    }

    @Test
    fun asksBeforeAnUnsureAction() {
        val unsure = Understanding("media_next", .52f, 0f, 1, IntentScore("media_previous", .2f))
        val question = CabinDialogue.questionFor(unsure, "can we hear something different")
        assertTrue(question is CabinQuestion.ConfirmAction)
        assertEquals("Should I play the next track?", question!!.spoken)
        val answer = CabinDialogue.answer(question, "yes") as CabinAnswer.Apply
        assertEquals("media.skip", answer.action.getString("type"))
        assertEquals(CabinAnswer.Decline, CabinDialogue.answer(question, "no"))
    }

    @Test
    fun everySpokenLineHasAVoiceClip() {
        val lines = VoiceLines.all()
        // The list make_voice.py renders: android-car/tools/make_voice.py --lines build/voice-lines.txt
        File("build").mkdirs()
        File("build/voice-lines.txt").writeText(lines.joinToString("\n") { "${VoiceLines.key(it)}\t$it" })
        val missing = lines.filter { !File("src/main/assets/voice/${VoiceLines.key(it)}.ogg").isFile }
        assertTrue("No clip for: ${missing.take(5)} (${missing.size} missing)", missing.isEmpty())
        assertEquals("Keys must be unique", lines.size, lines.map(VoiceLines::key).toSet().size)
    }
}
