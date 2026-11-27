package com.myra.car

/**
 * What a command did: the reply shown, the command as logged on the server (null = none), and the
 * [CarAudio] intent to apply to the head unit's real audio (null = the classifier's intent, or none).
 */
data class Outcome(val reply: String, val command: Map<String, Any>?, val audio: String? = null)

/**
 * The car state the demo shows (music and volume also drive the head unit's real audio, see [CarAudio]), and how an [Understanding] of an English sentence changes it.
 * Parameters come from the sentence itself: a temperature (16-30), an amount ("a little" / "a lot"), a place.
 */
class Car {
    var acOn = true; private set
    var temp = 22; private set
    var fan = 3; private set
    var volume = 12; private set
    var playing = false; private set
    var destination: String? = null; private set

    /** Starts from the head unit's real music volume, so "turn it up" goes up from what the driver hears. */
    fun syncVolume(value: Int) { volume = value.coerceIn(0, 30) }

    fun apply(u: Understanding, text: String): Outcome {
        if (u.confidence < MIN_CONFIDENCE) return Outcome("Sorry, I didn't catch that. Please say it again.", null)
        val action = u.intent in ACTIONS
        if (action && u.negated > 0.5f) return Outcome("Okay, I won't do that.", null)
        val step = amount(text)
        return when (u.intent) {
            "climate_temperature_up" -> setTemp(temp + step, "Warming up to")
            "climate_temperature_down" -> setTemp(temp - step, "Cooling down to")
            "climate_temperature_set" -> temperature(text)?.let { setTemp(it, "Temperature set to") }
                ?: Outcome("Which temperature? Say a number from 16 to 30.", null)
            "climate_fan_speed_up" -> setFan(fan + step)
            "climate_fan_speed_down" -> setFan(fan - step)
            "climate_on" -> { acOn = true; Outcome("AC is on.", cmd(u.intent)) }
            "climate_off" -> { acOn = false; Outcome("AC is off.", cmd(u.intent)) }
            "volume_up" -> setVolume(volume + 2 * step)
            "volume_down" -> setVolume(volume - 2 * step)
            "media_play" -> { playing = true; Outcome("Playing music.", cmd(u.intent)) }
            "media_pause" -> { playing = false; Outcome("Music paused.", cmd(u.intent)) }
            "media_next" -> { playing = true; Outcome("Next track.", cmd(u.intent)) }
            "media_previous" -> { playing = true; Outcome("Previous track.", cmd(u.intent)) }
            "navigation_destination_request" -> place(text)?.let { lookUp(it) } ?: Outcome("Where would you like to go?", null)
            "dialog_confirm" -> Outcome("Okay.", null)
            "dialog_cancel" -> Outcome("Okay, cancelled.", null)
            "unsupported" -> Outcome("Sorry, I can't do that in this car.", null)
            else -> Outcome("Could you say that a bit more specifically?", null) // ambiguous
        }
    }

    /**
     * One action as the on-device LLM writes it (`{"type":"climate.setTemp","value":20}`), also the form a
     * shortcut stores. Types this demo car has no hardware for are answered, not faked.
     */
    fun run(a: org.json.JSONObject): Outcome {
        val type = a.optString("type")
        return when (type) {
            "climate.adjustTemp" -> a.optInt("delta", 2).let { setTemp(temp + it, if (it > 0) "Warming up to" else "Cooling down to") }
            "climate.setTemp" -> setTemp(a.optInt("value", temp), "Temperature set to")
            "climate.power" -> if (a.optBoolean("on", true)) { acOn = true; Outcome("AC is on.", cmd("climate_on")) }
                else { acOn = false; Outcome("AC is off.", cmd("climate_off")) }
            "climate.fan" -> setFan(if (a.has("value")) a.optInt("value") else fan + a.optInt("delta", 1))
            "media.volume" -> {
                val before = volume
                val out = setVolume(when { a.optBoolean("mute") -> 0; a.has("value") -> a.optInt("value"); else -> volume + a.optInt("delta", 4) })
                out.copy(audio = if (volume >= before) "volume_up" else "volume_down")
            }
            "media.play" -> { playing = true; Outcome(a.optString("genre").takeIf { it.isNotEmpty() }?.let { "Playing $it music." } ?: "Playing music.", cmd("media_play"), "media_play") }
            "media.pause" -> { playing = false; Outcome("Music paused.", cmd("media_pause"), "media_pause") }
            "media.skip" -> { playing = true; if (a.optInt("dir", 1) < 0) Outcome("Previous track.", cmd("media_previous"), "media_previous") else Outcome("Next track.", cmd("media_next"), "media_next") }
            "nav.start" -> a.optString("destination").takeIf { it.isNotBlank() }?.let { lookUp(it) }
                ?: Outcome("Where would you like to go?", null)
            "nav.stop" -> { destination = null; Outcome("Navigation stopped.", cmd("navigation_stop")) }
            "greet" -> Outcome("Hello! What can I do?", null)
            "thanks" -> Outcome("You're welcome.", null)
            "help" -> Outcome("Try: set the AC to 22, next song, take me home — or teach me a shortcut: “whenever I say chill mode, …”.", null)
            "" -> Outcome("Sorry, I didn't catch that. Please say it again.", null)
            else -> Outcome("${describe(type)} isn't connected in this car.", null)
        }
    }

    /** A destination request: the app searches Google Places for it and starts navigation once one is picked. */
    private fun lookUp(place: String) = Outcome("Looking up $place on Google Maps…", cmd(NAV_REQUEST, "destination" to place))

    /** The route Google Maps is guiding (null: none). */
    fun navigate(to: String?) { destination = to }

    private fun setTemp(value: Int, verb: String): Outcome {
        temp = value.coerceIn(16, 30)
        acOn = true
        return Outcome("$verb $temp°C.", cmd("climate_temperature_set", "value" to temp))
    }

    private fun setFan(value: Int): Outcome {
        fan = value.coerceIn(0, 7)
        return Outcome(if (fan == 0) "Fan is off." else "Fan speed $fan.", cmd("climate_fan_speed", "value" to fan))
    }

    private fun setVolume(value: Int): Outcome {
        volume = value.coerceIn(0, 30)
        return Outcome("Volume $volume.", cmd("volume", "value" to volume))
    }

    private fun cmd(type: String, vararg fields: Pair<String, Any>): Map<String, Any> = mapOf("type" to type, *fields)

    companion object {
        const val MIN_CONFIDENCE = 0.6f // below this the car asks again instead of acting
        const val NAV_REQUEST = "navigation_destination_request"
        private val ACTIONS = setOf(
            "climate_temperature_up", "climate_temperature_down", "climate_temperature_set", "climate_fan_speed_up",
            "climate_fan_speed_down", "climate_on", "climate_off", "volume_up", "volume_down", "media_play",
            "media_pause", "media_next", "media_previous", "navigation_destination_request",
        )
        /** A classifier intent as an action ([run]'s form), for shortcuts saved without the LLM. Null: not an action. */
        fun action(intent: String, text: String): org.json.JSONObject? {
            val step = amount(text)
            fun j(type: String, vararg kv: Pair<String, Any>) = org.json.JSONObject().put("type", type).apply { kv.forEach { put(it.first, it.second) } }
            return when (intent) {
                "climate_temperature_up" -> j("climate.adjustTemp", "delta" to step)
                "climate_temperature_down" -> j("climate.adjustTemp", "delta" to -step)
                "climate_temperature_set" -> temperature(text)?.let { j("climate.setTemp", "value" to it) }
                "climate_fan_speed_up" -> j("climate.fan", "delta" to step)
                "climate_fan_speed_down" -> j("climate.fan", "delta" to -step)
                "climate_on" -> j("climate.power", "on" to true)
                "climate_off" -> j("climate.power", "on" to false)
                "volume_up" -> j("media.volume", "delta" to 2 * step)
                "volume_down" -> j("media.volume", "delta" to -2 * step)
                "media_play" -> j("media.play")
                "media_pause" -> j("media.pause")
                "media_next" -> j("media.skip", "dir" to 1)
                "media_previous" -> j("media.skip", "dir" to -1)
                "navigation_destination_request" -> place(text)?.let { j("nav.start", "destination" to it) }
                else -> null
            }
        }

        /** A short label for an action, as the Shortcuts screen lists it. */
        fun label(a: org.json.JSONObject): String {
            fun signed(k: String) = a.optInt(k).let { if (it > 0) "+$it" else "$it" }
            return when (a.optString("type")) {
                "climate.adjustTemp" -> if (a.optInt("delta") > 0) "Warmer ${signed("delta")}°" else "Cooler ${signed("delta")}°"
                "climate.setTemp" -> "AC ${a.optInt("value")}°C"
                "climate.power" -> if (a.optBoolean("on", true)) "AC on" else "AC off"
                "climate.fan" -> if (a.has("value")) "Fan ${a.optInt("value")}" else "Fan ${signed("delta")}"
                "media.volume" -> when { a.optBoolean("mute") -> "Mute"; a.has("value") -> "Volume ${a.optInt("value")}"; else -> "Volume ${signed("delta")}" }
                "media.play" -> a.optString("genre").takeIf { it.isNotEmpty() }?.let { "Play $it" } ?: "Play music"
                "media.pause" -> "Pause music"
                "media.skip" -> if (a.optInt("dir", 1) < 0) "Previous track" else "Next track"
                "nav.start" -> "Navigate to ${a.optString("destination")}"
                "nav.stop" -> "Stop navigation"
                else -> describe(a.optString("type"))
            }
        }

        /** "lights.hazard" -> "Hazard lights", for actions the car can't do. */
        fun describe(type: String): String = when (type.substringBefore('.')) {
            "query" -> "Trip information"
            "window" -> "Window control"
            "ambient" -> "Ambient lighting"
            "seat" -> "Seat control"
            "phone" -> "Calling"
            "lights" -> "Light control"
            "doors" -> "Door locking"
            else -> type.split('.', '_').reversed().joinToString(" ").replaceFirstChar { it.uppercase() }
        }

        private val WORD_NUMBERS = mapOf(
            "sixteen" to 16, "seventeen" to 17, "eighteen" to 18, "nineteen" to 19, "twenty" to 20, "twenty one" to 21,
            "twenty two" to 22, "twenty three" to 23, "twenty four" to 24, "twenty five" to 25, "twenty six" to 26,
            "twenty seven" to 27, "twenty eight" to 28, "twenty nine" to 29, "thirty" to 30,
        )
        private val LITTLE = Regex("""\b(a (little|bit)|slightly|little|bit|thoda|a touch)\b""")
        private val LOT = Regex("""\b(a lot|lots|very|much|maximum|max|full|really|way)\b""")
        private val TO_PLACE = Regex("""\b(?:to|towards|till|until|for)\s+(?:the\s+)?(.+)$""")
        private val NAV_WORDS = Regex("""\b(please|navigate|navigation|take me|take us|drive|go|start|route|directions?|show|me|the way|now|let's|lets|can you|could you|i want to|to)\b""")

        /** 1 step by default and for "a little"; 3 for "a lot". */
        fun amount(text: String): Int {
            val t = text.lowercase()
            return when { LITTLE.containsMatchIn(t) -> 1; LOT.containsMatchIn(t) -> 3; else -> 1 }
        }

        /** A temperature in the AC's range, as digits ("22", "22°C") or words ("twenty two"). */
        fun temperature(text: String): Int? {
            val t = text.lowercase().replace('-', ' ')
            Regex("""\b(1[6-9]|2[0-9]|30)\b""").find(t)?.let { return it.value.toInt() }
            return WORD_NUMBERS.entries.sortedByDescending { it.key.length }.firstOrNull { Regex("""\b${it.key}\b""").containsMatchIn(t) }?.value
        }

        /** The place in "navigate to X" / "take me to the X"; else what is left once the navigation words go. */
        fun place(text: String): String? {
            val t = text.trim().trimEnd('.', '!', '?', ',').lowercase()
            if (Regex("""\b(home|ghar)\b""").containsMatchIn(t)) return "Home"
            if (Regex("""\b(office|work)\b""").containsMatchIn(t)) return "Office"
            val raw = TO_PLACE.find(t)?.groupValues?.get(1) ?: t.replace(NAV_WORDS, " ")
            val place = raw.replace(Regex("""\b(please|now|right now|quickly)\b"""), " ").replace(Regex("""\s+"""), " ").trim(' ', ',', '.')
            if (place.isEmpty()) return null
            return place.split(' ').joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }
        }
    }
}
