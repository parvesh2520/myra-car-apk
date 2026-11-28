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

    @Test
    fun everyReplyIsSpokenInTheSameVoice() {
        val car = Car().apply { homeSaved = true }
        fun a(type: String, vararg kv: Pair<String, Any>) = JSONObject().put("type", type).apply { kv.forEach { put(it.first, it.second) } }
        val actions = buildList {
            for (t in 10..35) add(a("climate.setTemp", "value" to t))
            for (d in listOf(-3, -1, 1, 3)) add(a("climate.adjustTemp", "delta" to d))
            for (f in -1..8) add(a("climate.fan", "value" to f))
            for (v in -2..32) add(a("media.volume", "value" to v))
            for (h in 0..6) add(a("seat.height", "value" to h))
            for (c in CabinColor.entries) add(a("ambient.color", "color" to c.key))
            for (t in DemoTrack.entries) add(a("media.play", "genre" to t.key))
            add(a("media.play", "genre" to "ghazal"))
            add(a("ambient.color", "color" to "beige"))
            for (d in listOf("Home", "Office", "Bandra Station")) add(a("nav.start", "destination" to d))
            for (t in listOf("climate.power", "media.play", "media.pause", "media.skip", "nav.start", "nav.stop", "greet",
                "thanks", "help", "", "window.open", "lights.hazard")) add(a(t))
            add(a("climate.power", "on" to false))
            add(a("media.skip", "dir" to -1))
            add(a("media.volume", "mute" to true))
        }
        val replies = actions.map { car.run(it).reply } +
            listOf("climate_on", "climate_off", "media_play", "media_pause", "media_next", "media_previous",
                "climate_temperature_up", "climate_temperature_down", "climate_temperature_set", "climate_fan_speed_up",
                "climate_fan_speed_down", "climate_fan_speed_set", "volume_up", "volume_down", "volume_set",
                "ambient_light_set", "seat_height_set", "shortcut_define", "dialog_confirm", "dialog_cancel",
                "unsupported", "greeting", "something_else", "navigation_destination_request")
                .map { car.apply(Understanding(it, .9f, 0f, 1), "please").reply } +
            car.apply(Understanding("climate_on", .3f, 0f, 1), "x").reply +
            car.apply(Understanding("climate_on", .9f, .9f, 1), "x").reply +
            listOf("Saved. Say “chill mode” to ac 20°c, ambient light: blue.", "Deleted the “chill mode” shortcut.",
                "There's no shortcut called “chill mode”.", "Which shortcut did you mean? Say “chill” or “chill mode”.",
                "I couldn't tell what “chill mode” should do. Try: whenever I say chill mode, set the AC to 20 and play music.",
                "AC is on. Volume 12. Navigating to Bandra Station.")
        val known = VoiceLines.all().toSet()
        for (reply in replies) {
            val lines = VoiceLines.forReply(reply)
            assertTrue("Nothing spoken for: $reply", lines.isNotEmpty())
            assertTrue("No clip line for: $reply -> $lines", lines.all { it in known })
        }
        assertEquals(listOf("AC is on.", "Volume 12.", "Navigating there now."), VoiceLines.forReply("AC is on. Volume 12. Navigating to Bandra Station."))
        assertEquals(listOf("Temperature set to 22 degrees."), VoiceLines.forReply("Temperature set to 22°C."))
    }
}
