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
        assertEquals("chill mode", s.match("chil mode")?.name) // ASR misspelling
        assertNull(s.match("set the ac to 20"))
        val reloaded = Shortcuts(f)
        assertEquals(1, reloaded.all.size)
        assertEquals(2, reloaded.all[0].actions.size)
        assertTrue(reloaded.delete("chill mode"))
        assertEquals(0, Shortcuts(f).all.size)
        f.delete()
    }

    @Test
    fun runsLlmActions() {
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
        assertEquals(2, Llm.parse("""[{"type":"media.play"},{"type":"media.pause"}]""")?.size)
        assertNull(Llm.parse("not json"))
    }
}
