package com.myra.car

import org.json.JSONObject

/** The app's own demo music. [art] is the cover colour on the home player. */
internal enum class DemoTrack(val title: String, val audio: Int, val art: Int, vararg val aliases: String) {
    CALM("Quiet Roads", R.raw.quiet_roads, 0xFF35566E.toInt(), "relaxing", "peaceful", "soothing"),
    ENERGETIC("Night Drive", R.raw.night_drive, 0xFF7A3B3B.toInt(), "upbeat", "high energy", "energetic"),
    FOCUS("Clear Sky", R.raw.clear_sky, 0xFF3F6A5A.toInt(), "instrumental", "study", "concentration"),
    CHILL("City Glow", R.raw.city_glow, 0xFF6B5532.toInt(), "lo fi", "lofi", "laid back");

    val key get() = name.lowercase()
    val mood get() = name.lowercase().replaceFirstChar { it.uppercase() }

    companion object {
        fun from(text: String): DemoTrack? {
            val key = Shortcuts.normalize(text)
            return entries.firstOrNull { key == it.key || key == it.title.lowercase() || key in it.aliases }
        }
    }
}

/** Parameterized commands that the existing intent model has no labels for. */
internal object CockpitRequests {
    private val negative = Regex("""\b(?:not|never|don['’]?t|do not|cannot|can['’]?t|won['’]?t|no|stop|avoid|without)\b""")
    private val courtesy = Regex("""^(?:(?:can|could|would|will) you |i (?:want|would like) you to )""")
    private val play = Regex("""^(?:play|put on|start) (?:me )?(?:(?:some|something|a|the) )?(.+?)(?: (?:music|songs?|tracks?|tunes?|beats?|playlist))?$""")
    private val light = Regex(
        """^(?:(?:change|set|make|turn|switch) )?(?:the |my )?(?:colo[u]?r of (?:the |my )?)?(?:cabin |interior )?ambient light(?:s|ing)?(?: colo[u]?r)? (?:to )?(\w+)$"""
    )
    private val fan = Regex("""^(?:set|change|turn|put) (?:the |my )?fan(?: speed)? (?:to |on )?(?:level )?([0-7]|zero|one|two|three|four|five|six|seven)$""")
    private val seat = Regex("""^(?:set|change|adjust|move) (?:the |my |driver'?s )?seat(?: height)? (?:to )?(?:level )?([1-5]|one|two|three|four|five)$""")
    private val seatMove = Regex("""^(raise|lower) (?:the |my |driver'?s )?seat(?: height)?$""")
    private val numbers = listOf("zero", "one", "two", "three", "four", "five", "six", "seven")

    fun parse(text: String): JSONObject? {
        val request = Shortcuts.normalize(text).replace(courtesy, "").removePrefix("please ")
        if (negative.containsMatchIn(request)) return null
        fun action(type: String, key: String, value: Any) = JSONObject().put("type", type).put(key, value)
        fun number(value: String) = value.toIntOrNull() ?: numbers.indexOf(value)

        play.matchEntire(request)?.groupValues?.get(1)?.let(DemoTrack::from)?.let { return action("media.play", "genre", it.key) }
        light.matchEntire(request)?.groupValues?.get(1)?.let(CabinColor::from)?.let { return action("ambient.color", "color", it.key) }
        fan.matchEntire(request)?.let { return action("climate.fan", "value", number(it.groupValues[1])) }
        seat.matchEntire(request)?.let { return action("seat.height", "value", number(it.groupValues[1])) }
        seatMove.matchEntire(request)?.let { return action("seat.height", "delta", if (it.groupValues[1] == "raise") 1 else -1) }
        return null
    }
}
