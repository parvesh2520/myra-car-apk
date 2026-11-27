package com.myra.car

import android.content.Context
import android.media.AudioManager
import android.os.SystemClock
import android.view.KeyEvent
import kotlin.math.roundToInt

/**
 * The head unit's real audio. Media keys go to the active player: with a phone on Bluetooth, the head unit's
 * Bluetooth music app forwards them to the phone (AVRCP). Volume is the music stream, on the car's 0-30 scale.
 */
internal class CarAudio(context: Context) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val max get() = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)

    val volume get() = (audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 30f / max).roundToInt()

    /** Applies what the command did to [car] to the real audio. */
    fun apply(intent: String, car: Car) {
        when (intent) {
            "volume_up", "volume_down" -> {
                val current = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
                var target = (car.volume * max / 30f).roundToInt()
                // The head unit may have fewer steps than 30: always move at least one step.
                if (target == current) target += if (intent == "volume_up") 1 else -1
                audio.setStreamVolume(AudioManager.STREAM_MUSIC, target.coerceIn(0, max), AudioManager.FLAG_SHOW_UI)
                car.syncVolume(volume)
            }
            "media_play" -> press(KeyEvent.KEYCODE_MEDIA_PLAY)
            "media_pause" -> press(KeyEvent.KEYCODE_MEDIA_PAUSE)
            "media_next" -> press(KeyEvent.KEYCODE_MEDIA_NEXT)
            "media_previous" -> press(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
        }
    }

    private fun press(code: Int) {
        val t = SystemClock.uptimeMillis()
        audio.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0))
        audio.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_UP, code, 0))
    }
}
