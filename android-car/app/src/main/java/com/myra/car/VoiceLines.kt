package com.myra.car

/**
 * Everything Myra says aloud. Each line is a clip in assets/voice/, rendered on the PC with one local neural voice
 * (android-car/tools/make_voice.py), so the car always speaks in the same voice, instantly, without a speech engine.
 * Replies built from live values are spoken through [forReply]: numbers, colours and tracks have one clip per value;
 * words only the driver chose (places, shortcut names) get a general line, while the screen shows the full reply.
 * UnderstandingTest checks every line here has a clip.
 */
internal object VoiceLines {
    /** Drivers whose name has a clip; anyone else enrolled on the car hears the line without a name. */
    private val NAMED_DRIVERS = listOf("Kanishk", "Parvesh", "Pravesh")

    private fun named(profile: String?) = NAMED_DRIVERS.firstOrNull { it.equals(profile?.trim(), ignoreCase = true) }

    /** "Hi Kanishk, I have set your profile." */
    fun driverMatched(profile: String): String =
        named(profile)?.let { "Hi $it, I have set your profile." } ?: "Hi, I have set your profile."

    /** "Hi Kanishk." before the reply to a first command that was not a greeting. */
    fun hiDriver(profile: String): String = named(profile)?.let { "Hi $it." } ?: "Hi."

    /** Reply to "Hi Myra" once the driver's profile is already set. */
    fun hello(profile: String?): String = named(profile)?.let { "Hi $it! What can I do?" } ?: "Hello! What can I do?"
    const val DRIVER_UNKNOWN = "I heard your command. For your cabin profile, try speaking a little longer or enroll in Voice ID."

    fun salutation(hour: Int) = when (hour) {
        in 5..11 -> "Good morning"
        in 12..16 -> "Good afternoon"
        else -> "Good evening"
    }

    fun greeting(hour: Int) = "${salutation(hour)}. Welcome back."

    /** Replies with no live value, exactly as the app shows them. */
    private val FIXED_REPLIES = listOf(
        "Sorry, I didn't catch that. Please say it again.", "Okay, I won't do that.",
        "Which temperature? Say a number from 16 to 30.", "Which fan level? Say a number from 0 to 7.",
        "Which volume? Say a number from 0 to 30.", "Which ambient light colour?", "Which ambient light color?",
        "Which seat height? Say a level from 1 to 5.", "Say the shortcut's name and what it should do.",
        "Where would you like to go?", "Your home isn't saved yet. Tap Set home on the map to add it.",
        "Okay.", "Okay, cancelled.", "Sorry, I can't do that in this car.", "Could you say that a bit more specifically?",
        "AC is on.", "AC is off.", "Fan is off.", "Playing music.", "Music paused.", "Next track.", "Previous track.",
        "Navigation stopped.", "Hello! What can I do?", "You're welcome.", "I couldn't play that track. Please try again.",
        "I couldn't save that shortcut. Say the name, then what it should do.",
        "Okay, I’ll leave it as it is.", "Could you say those requests one at a time?",
        "That shortcut changed. Try saying it again.", "Which shortcut did you mean?",
        "I couldn't understand the command. Try again.",
    )

    // General lines for sentences that carry the driver's own words.
    private const val NAVIGATING = "Navigating there now."
    private const val HELP = "Try saying: set the AC to 22, next song, or take me home. You can also teach me a shortcut."
    private val GENERAL = listOf(NAVIGATING, HELP, "Navigating home.", "Navigating to the office.", "Shortcut saved.",
        "Shortcut deleted.", "I couldn't find that shortcut.", "I couldn't tell what that shortcut should do.",
        "That isn't connected in this car.")

    private val TEMPERATURE = Regex("""^(Warming up to|Cooling down to|Temperature set to) (\d+)°C\.$""")
    private val SENTENCE_END = Regex("""(?<=[.?!])\s+""")

    /** The lines that speak [reply]: its own clip, else one line per sentence. A sentence without a clip is skipped. */
    fun forReply(reply: String): List<String> {
        val text = reply.trim()
        if (text in known) return listOf(text)
        return text.split(SENTENCE_END).mapNotNull(::spoken).filter { it in known }
    }

    private fun spoken(sentence: String): String? {
        val s = sentence.trim()
        TEMPERATURE.matchEntire(s)?.let { return "${it.groupValues[1]} ${it.groupValues[2]} degrees." }
        return when {
            s.isEmpty() || s.startsWith("Say “") -> null // the driver's shortcut wording, shown on screen only
            s == "Navigating to Home." -> "Navigating home."
            s == "Navigating to Office." -> "Navigating to the office."
            s.startsWith("Navigating to ") -> NAVIGATING
            s.startsWith("Playing ") && s !in known -> "Playing music."
            s == "Saved." -> "Shortcut saved."
            s.startsWith("Deleted the “") -> "Shortcut deleted."
            s.startsWith("There's no shortcut called") -> "I couldn't find that shortcut."
            s.startsWith("I couldn't tell what “") -> "I couldn't tell what that shortcut should do."
            s.startsWith("Try: whenever I say") -> "Say the shortcut's name and what it should do."
            s.startsWith("Try: set the AC") -> HELP
            s.endsWith(" isn't connected in this car.") -> "That isn't connected in this car."
            else -> s
        }
    }

    private val known by lazy { all().toSet() }

    /** The clip's file name: "Should I play music?" -> "should_i_play_music". */
    fun key(text: String): String =
        text.lowercase().replace("'", "").split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }.joinToString("_").take(90)

    /** Every line the app can speak, for the clip check. */
    fun all(): List<String> = buildList {
        for (hour in listOf(8, 14, 20)) add(greeting(hour))
        add(driverMatched(""))
        add(hiDriver(""))
        for (n in NAMED_DRIVERS) { add(driverMatched(n)); add(hello(n)); add(hiDriver(n)) }
        add(DRIVER_UNKNOWN)
        addAll(CabinQuestion.spokenLines())
        addAll(FIXED_REPLIES)
        addAll(GENERAL)
        for (verb in listOf("Warming up to", "Cooling down to", "Temperature set to"))
            for (t in Cabin.TEMPERATURE_RANGE) add("$verb $t degrees.")
        for (f in Cabin.FAN_RANGE) if (f > 0) add("Fan speed $f.")
        for (v in 0..30) add("Volume $v.")
        for (h in Cabin.SEAT_HEIGHT_RANGE) add("Seat height set to level $h.")
        for (c in CabinColor.entries) add("Ambient lighting set to ${c.key}.")
        for (t in DemoTrack.entries) add("Playing ${t.title}.")
    }.distinct()
}
