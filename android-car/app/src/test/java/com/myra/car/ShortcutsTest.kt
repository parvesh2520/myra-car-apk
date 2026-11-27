package com.myra.car

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ShortcutsTest {
    private fun a(json: String) = JSONObject(json)

    @Test
    fun parsesDefinitions() {
        assertEquals("chill mode" to listOf("set the ac to 20", "play music"),
            Shortcuts.parseDefinition("Whenever I say chill mode, set the AC to 20 and play music."))
        assertEquals("movie night", Shortcuts.parseDefinition("When I say \"movie night\" then turn the volume down")?.first)
        assertEquals("party", Shortcuts.parseDefinition("Create a shortcut called party that will play music")?.first)
        assertNull(Shortcuts.parseDefinition("Set the AC to 22"))
        assertEquals("chill mode", Shortcuts.isDelete("Delete the chill mode shortcut."))
        assertNull(Shortcuts.isDelete("Turn up the volume"))
    }

    @Test
    fun savesMatchesAndPersists() {
        val f = File.createTempFile("shortcuts", ".json").apply { delete() }
        val s = Shortcuts(f)
        assertTrue(s.save("Chill Mode", listOf(a("""{"type":"climate.setTemp","value":20}"""), a("""{"type":"media.play"}"""))))
        assertEquals("chill mode", s.match("Chill mode.")?.name)
        assertEquals("chill mode", s.match("hey myra, activate chill mode please")?.name)
        val typo = ShortcutMatcher { null }.match("chil mode", s.all) as ShortcutMatch.Found
        assertEquals("chill mode", typo.shortcut.name)
        assertNull(s.match("set the ac to 20"))
        val reloaded = Shortcuts(f)
        assertEquals(1, reloaded.all.size)
        assertEquals(2, reloaded.all[0].actions.size)
        assertTrue(reloaded.delete("chill mode"))
        assertEquals(0, Shortcuts(f).all.size)
        f.delete()
    }

    @Test
    fun matchesContractionsAndEmphasisWithoutLosingTheSavedActions() {
        val shortcut = Shortcuts.Shortcut("i am very tired", listOf(a("""{"type":"media.play","genre":"calm"}""")))
        val matcher = ShortcutMatcher { error("These variations do not require the encoder") }
        for (text in listOf("I’m really tired", "I am tired", "I feel so tired", "Activate I am extremely tired")) {
            assertEquals(ShortcutMatch.Found(shortcut), matcher.match(text, listOf(shortcut)))
        }
        for (text in listOf("I am not tired", "You are very tired", "I am wide awake", "Why am I tired?", "Play energetic music")) {
            assertNull(matcher.match(text, listOf(shortcut)))
        }
    }

    @Test
    fun ranksParaphrasesAndAsksWhenTwoShortcutsAreClose() {
        val tired = Shortcuts.Shortcut("i am very tired", listOf(a("""{"type":"media.play","genre":"calm"}""")))
        val rested = Shortcuts.Shortcut("i am wide awake", listOf(a("""{"type":"media.play","genre":"energetic"}""")))
        val sleepy = Shortcuts.Shortcut("i am very sleepy", listOf(a("""{"type":"climate.setTemp","value":22}""")))
        val calls = mutableMapOf<String, Int>()
        val matcher = ShortcutMatcher { phrase ->
            calls[phrase] = (calls[phrase] ?: 0) + 1
            when (phrase) {
                "i am exhausted" -> floatArrayOf(1f, 0f)
                "i am tired" -> floatArrayOf(.83f, .5578f)
                "i am sleepy" -> floatArrayOf(.81f, .5864f)
                else -> null
            }
        }
        repeat(2) {
            assertEquals(ShortcutMatch.Found(tired), matcher.match("I feel exhausted", listOf(tired, rested)))
        }
        assertEquals(1, calls["i am tired"])
        assertEquals(ShortcutMatch.Ambiguous(listOf(tired.name, sleepy.name)),
            matcher.match("I feel exhausted", listOf(tired, sleepy)))
        assertNull(matcher.match("I feel exhausted", listOf(rested)))
    }

    @Test
    fun splitsRequests() {
        assertEquals(listOf("set the ac to 22", "play music"), Shortcuts.clauses("Set the AC to 22 and play music."))
        assertEquals(listOf("turn the fan down", "next song", "volume up"), Shortcuts.clauses("Turn the fan down, next song, then volume up"))
        assertEquals(listOf("take me to the airport"), Shortcuts.clauses("Take me to the airport please"))
    }

    @Test
    fun runsActions() {
        val car = Car()
        car.run(a("""{"type":"climate.setTemp","value":20}"""))
        assertEquals(20, car.temp)
        car.run(a("""{"type":"climate.adjustTemp","delta":2}"""))
        assertEquals(22, car.temp)
        assertEquals("volume_up", car.run(a("""{"type":"media.volume","delta":4}""")).audio)
        assertEquals("media_next", car.run(a("""{"type":"media.skip","dir":1}""")).audio)
        assertNull(car.run(a("""{"type":"window","target":"passenger","open":100}""")).command)
        assertNotNull(Car.action("climate_temperature_set", "set the ac to 21"))
        assertEquals("AC 20°C", Car.label(a("""{"type":"climate.setTemp","value":20}""")))
        car.run(a("""{"type":"nav.start","destination":"Phoenix Mall"}"""))
        assertEquals("Phoenix Mall", car.destination)
    }

    @Test
    fun remembersTrackAndLightingInShortcut() {
        val file = File.createTempFile("cabin-shortcut", ".json")
        try {
            val definition = checkNotNull(Shortcuts.parseDefinition(
                "Whenever I say evening drive, play some calm music and change the color of the ambient light to pink."
            ))
            val actions = definition.second.map { checkNotNull(CockpitRequests.parse(it)) }
            assertTrue(Shortcuts(file).save(definition.first, actions))

            val car = Car()
            val shortcut = checkNotNull(Shortcuts(file).match("Evening drive."))
            assertEquals(listOf("Play calm music", "Ambient light: pink"), shortcut.actions.map(Car::label))
            val results = shortcut.actions.map(car::run)
            assertEquals("calm", results.first().genre)
            assertEquals("Playing Quiet Roads.", results.first().reply)
            assertEquals(CabinColor.PINK, car.light)
        } finally {
            file.delete()
        }
    }

    @Test
    fun recognizesDemoTracksAndCabinControls() {
        for ((phrase, track) in mapOf(
            "Play energetic music" to DemoTrack.ENERGETIC,
            "Could you put on some focus music please?" to DemoTrack.FOCUS,
            "Play City Glow" to DemoTrack.CHILL,
            "Play some lo-fi beats" to DemoTrack.CHILL,
        )) {
            val action = checkNotNull(CockpitRequests.parse(phrase))
            assertEquals(track.key, action.getString("genre"))
        }
        assertNull(CockpitRequests.parse("Don't play calm music"))
        assertNull(CockpitRequests.parse("Don't change the ambient light to pink"))

        val car = Car()
        val profile = Cabin(false, 21, 5, CabinColor.PURPLE, 2)
        car.restore(profile)
        assertEquals(profile, car.cabin())
        car.run(checkNotNull(CockpitRequests.parse("Set fan speed to four")))
        car.run(checkNotNull(CockpitRequests.parse("Raise my seat")))
        assertEquals(profile.copy(fan = 4, seatHeight = 3), car.cabin())
    }
}
