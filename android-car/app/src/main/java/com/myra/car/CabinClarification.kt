package com.myra.car

import org.json.JSONObject

internal enum class CabinSuggestion(
    val label: String,
    val intent: String,
    val instruction: String,
    vararg val aliases: String,
) {
    COOL("cool", "climate_temperature_down", "lower the temperature", "cooler", "decrease the temperature", "temperature down"),
    WARM("warm", "climate_temperature_up", "raise the temperature", "warmer", "increase the temperature", "temperature up"),
    FAN_UP("fan_up", "climate_fan_speed_up", "raise the fan speed", "increase the fan", "fan up", "higher fan"),
    FAN_DOWN("fan_down", "climate_fan_speed_down", "lower the fan speed", "decrease the fan", "fan down", "lower fan"),
    VOLUME_UP("volume_up", "volume_up", "turn up the volume", "louder", "volume up"),
    VOLUME_DOWN("volume_down", "volume_down", "turn down the volume", "quieter", "volume down");

    fun accepts(answer: String): Boolean = answer == instruction || answer in aliases
}

/** A question Myra asks instead of guessing. [text] is shown; [spoken] is said aloud ([VoiceLines]). */
internal sealed class CabinQuestion(val text: String, val spoken: String = text) {
    class Confirm(val suggestion: CabinSuggestion) :
        CabinQuestion("Should I ${suggestion.instruction}?")

    class Choose(val first: CabinSuggestion, val second: CabinSuggestion) :
        CabinQuestion("Should I ${first.instruction} or ${second.instruction}?")

    /** Any other action the model was not sure enough about: "Should I play the next track?". */
    class ConfirmAction(val action: JSONObject, instruction: Pair<String, String>) :
        CabinQuestion("Should I ${instruction.first}?", "Should I ${instruction.second}?")

    data object Temperature : CabinQuestion("What temperature should I set? Say a number from 16 to 30.")
    data object Rephrase : CabinQuestion("Which setting would you like me to change?")

    val buttons: List<Pair<String, String>> get() = when (this) {
        is Confirm, is ConfirmAction -> listOf("Yes" to "yes", "No" to "no")
        is Choose -> listOf(first.instruction.replaceFirstChar { it.uppercase() } to "first",
            second.instruction.replaceFirstChar { it.uppercase() } to "second", "Cancel" to "cancel")
        Temperature -> listOf("Cancel" to "cancel")
        Rephrase -> emptyList()
    }

    companion object {
        /** What Myra would ask before [action] (shown, spoken); null for actions it never confirms this way. */
        fun instruction(a: JSONObject): Pair<String, String>? {
            fun same(s: String) = s to s
            return when (a.optString("type")) {
                "climate.setTemp" -> same("set the temperature to ${a.optInt("value")} degrees")
                "climate.power" -> same(if (a.optBoolean("on", true)) "turn on the AC" else "turn off the AC")
                "climate.fan" -> if (a.has("value")) same("set the fan to level ${a.optInt("value")}") else null
                "media.volume" -> when {
                    a.optBoolean("mute") -> same("mute the audio")
                    a.has("value") -> same("set the volume to ${a.optInt("value")}")
                    else -> null
                }
                "media.play" -> same(a.optString("genre").let(DemoTrack::from)?.let { "play ${it.title}" } ?: "play music")
                "media.pause" -> same("pause the music")
                "media.skip" -> same(if (a.optInt("dir", 1) < 0) "play the previous track" else "play the next track")
                "ambient.color" -> CabinColor.from(a.optString("color"))?.let { same("change the ambient light to ${it.key}") }
                "seat.height" -> when {
                    a.has("value") -> same("set your seat to level ${a.optInt("value")}")
                    a.optInt("delta") > 0 -> same("raise your seat")
                    else -> same("lower your seat")
                }
                "nav.start" -> "start navigation to ${a.optString("destination")}" to "start navigation"
                "nav.stop" -> same("stop navigation")
                else -> null
            }
        }

        /** Every spoken question, for the voice clips ([VoiceLines.all]). */
        fun spokenLines(): List<String> = buildList {
            val suggestions = CabinSuggestion.entries
            for (a in suggestions) {
                add(Confirm(a).spoken)
                for (b in suggestions) if (a != b) add(Choose(a, b).spoken)
            }
            add(Temperature.spoken)
            add(Rephrase.spoken)
            fun j(type: String, vararg kv: Pair<String, Any>) = JSONObject().put("type", type).apply { kv.forEach { put(it.first, it.second) } }
            val actions = buildList {
                for (t in Cabin.TEMPERATURE_RANGE) add(j("climate.setTemp", "value" to t))
                add(j("climate.power", "on" to true)); add(j("climate.power", "on" to false))
                for (f in Cabin.FAN_RANGE) add(j("climate.fan", "value" to f))
                add(j("media.volume", "mute" to true))
                for (v in 0..30) add(j("media.volume", "value" to v))
                add(j("media.play")); for (t in DemoTrack.entries) add(j("media.play", "genre" to t.key))
                add(j("media.pause")); add(j("media.skip", "dir" to 1)); add(j("media.skip", "dir" to -1))
                for (c in CabinColor.entries) add(j("ambient.color", "color" to c.key))
                add(j("seat.height", "delta" to 1)); add(j("seat.height", "delta" to -1))
                for (h in Cabin.SEAT_HEIGHT_RANGE) add(j("seat.height", "value" to h))
                add(j("nav.start", "destination" to "Home")); add(j("nav.stop"))
            }
            for (a in actions) instruction(a)?.let { add(ConfirmAction(a, it).spoken) }
        }.distinct()
    }
}

internal sealed interface CabinAnswer {
    data class Apply(val action: JSONObject) : CabinAnswer
    data object Decline : CabinAnswer
    data object Repeat : CabinAnswer
    data object NewRequest : CabinAnswer
}

internal object CabinDialogue {
    private val yes = Regex("""^(?:yes|yeah|yep|sure|go ahead|do it|do that|okay|ok|correct|sounds good)(?: (?:go ahead|do it|do that|please|that is right|that's right))?$""")
    private val no = Regex("""^(?:no|nope|cancel|never mind|nevermind|leave it|leave it as it is|don't|do not)(?: (?:thanks|thank you|do that|do it|change it|leave it))?$""")
    private val degrees = Regex("""^(?:(?:set|make|change) it (?:to )?)?(?:\d+(?: c| celsius| degrees(?: celsius)?)?|(?:sixteen|seventeen|eighteen|nineteen|twenty(?: one| two| three| four| five| six| seven| eight| nine)?|thirty)(?: degrees(?: celsius)?)?)$""")
    private val observationStart = Regex("""^(?:the |my )?(?:temperature|cabin|interior|ac|thermostat|fan|blower|air|airflow|air circulation|vents|volume|sound|music|speakers|audio|radio|stereo|song|soundtrack)\b|^(?:it(?:'s| is| feels)|this|i(?:'m| am| feel| can| cannot)|there (?:is|isn't)|inside)\b""")
    private val cabinSetting = Regex("""\b(?:temperature|cabin|interior|ac|thermostat|fan|blower|airflow|ventilation|vents?|volume|music|speakers|audio|radio|stereo|song|soundtrack|hot|warm|cold|chilly|freezing|sweating|shivering|roasting)\b""")
    private val outsideCabin = Regex("""\b(?:outside|outdoors|engine|radiator|phone|headphones|weather|traffic)\b""")
    private val negation = Regex("""\b(?:not|never|don't|dont|do not|without)\b""")
    private val relativeTemperature = Regex("""^(?:the )?(?:(?:cabin|interior|ac) )?(?:temperature|temp|thermostat) (?:is|feels|seems) (?:too |very |a bit )?(high|low|warm|cold)(?: (?:in here|in the cabin|inside))?$""")
    private val missingTemperature = Regex("""^(?:(?:can|could|would|will) you (?:please )?)?(?:set|adjust|change) (?:the )?(?:(?:cabin|interior|ac) )?(?:temperature|temp)(?: to)?$""")

    fun isObservation(text: String): Boolean {
        val phrase = Shortcuts.normalize(text)
        return observationStart.containsMatchIn(phrase) && cabinSetting.containsMatchIn(phrase)
    }

    fun canSuggest(text: String): Boolean {
        val phrase = Shortcuts.normalize(text)
        return !outsideCabin.containsMatchIn(phrase) && !negation.containsMatchIn(phrase)
    }

    fun temperatureCue(text: String): CabinSuggestion? {
        val term = relativeTemperature.matchEntire(Shortcuts.normalize(text))?.groupValues?.get(1) ?: return null
        return if (term == "high" || term == "warm") CabinSuggestion.COOL else CabinSuggestion.WARM
    }

    fun needsTemperature(text: String): Boolean = missingTemperature.matches(Shortcuts.normalize(text))

    fun questionFor(result: Understanding, text: String): CabinQuestion? {
        if (result.negated > 0.5f) return null
        val best = CabinSuggestion.entries.firstOrNull { it.intent == result.intent }
        val runner = result.runnerUp
        val other = CabinSuggestion.entries.firstOrNull { it.intent == runner?.intent }
        return when {
            result.intent == "climate_temperature_set" && Car.temperature(text) == null -> CabinQuestion.Temperature
            best != null && other != null && runner != null && runner.confidence >= .30f &&
                result.confidence - runner.confidence <= .14f -> CabinQuestion.Choose(best, other)
            best != null && result.confidence in .45f..<Car.MIN_CONFIDENCE -> CabinQuestion.Confirm(best)
            best == null && result.confidence in .45f..<Car.MIN_CONFIDENCE ->
                Car.action(result.intent, text, result.slots)?.let { a -> CabinQuestion.instruction(a)?.let { CabinQuestion.ConfirmAction(a, it) } }
                    ?: CabinQuestion.Rephrase
            result.intent == "ambiguous" || result.confidence < Car.MIN_CONFIDENCE -> CabinQuestion.Rephrase
            else -> null
        }
    }

    fun answer(question: CabinQuestion, text: String): CabinAnswer {
        val answer = Shortcuts.normalize(text)
        if (no.matches(answer)) return CabinAnswer.Decline
        if (question == CabinQuestion.Temperature ||
            question is CabinQuestion.Confirm && question.suggestion in listOf(CabinSuggestion.COOL, CabinSuggestion.WARM)) {
            if (degrees.matches(answer)) {
                val value = Car.temperature(answer) ?: return CabinAnswer.Repeat
                return CabinAnswer.Apply(JSONObject().put("type", "climate.setTemp").put("value", value))
            }
        }
        if (question is CabinQuestion.ConfirmAction && yes.matches(answer)) return CabinAnswer.Apply(JSONObject(question.action.toString()))
        val selection = when (question) {
            is CabinQuestion.Confirm -> question.suggestion.takeIf { yes.matches(answer) || it.accepts(answer) }
            is CabinQuestion.Choose -> when {
                answer in setOf("first", "the first one", "option one", "option 1") || question.first.accepts(answer) -> question.first
                answer in setOf("second", "the second one", "option two", "option 2") || question.second.accepts(answer) -> question.second
                else -> null
            }
            else -> null
        }
        if (selection != null) return CabinAnswer.Apply(checkNotNull(Car.action(selection.intent, text)))
        return if (yes.matches(answer)) CabinAnswer.Repeat else CabinAnswer.NewRequest
    }
}
