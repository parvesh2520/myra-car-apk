package com.myra.car

/**
 * Everything Myra says aloud. Each line is a clip in assets/voice/, rendered on the PC with one local neural voice
 * (android-car/tools/make_voice.py), so the car always speaks in the same voice, instantly, without a speech engine.
 * A line without a clip stays silent; VoiceLinesTest checks every line has one.
 */
internal object VoiceLines {
    const val DRIVER_MATCHED = "Welcome back. I recognised your voice and set up the cabin for you."
    const val DRIVER_UNKNOWN = "I heard your command. For your cabin profile, try speaking a little longer or enroll in Voice ID."

    fun greeting(hour: Int): String {
        val salutation = when (hour) {
            in 5..11 -> "Good morning"
            in 12..16 -> "Good afternoon"
            else -> "Good evening"
        }
        return "$salutation. Welcome back. I'm Myra, and I'm ready when you are."
    }

    /** The clip's file name: "Should I play music?" -> "should_i_play_music". */
    fun key(text: String): String =
        text.lowercase().replace("'", "").split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }.joinToString("_").take(90)

    /** Every line the app can speak, for the clip check. */
    fun all(): List<String> = buildList {
        for (hour in listOf(8, 14, 20)) add(greeting(hour))
        add(DRIVER_MATCHED)
        add(DRIVER_UNKNOWN)
        addAll(CabinQuestion.spokenLines())
    }
}
