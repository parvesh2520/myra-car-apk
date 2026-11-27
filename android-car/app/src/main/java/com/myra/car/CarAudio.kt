package com.myra.car

import android.content.Context
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.SystemClock
import android.view.KeyEvent
import kotlin.math.roundToInt

/**
 * The head unit's real audio. Media keys go to the active player: with a phone on Bluetooth, the head unit's
 * Bluetooth music app forwards them to the phone (AVRCP). Volume is the music stream, on the car's 0-30 scale.
 */
internal class CarAudio(private val context: Context) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val max get() = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    private var player: MediaPlayer? = null
    var track: DemoTrack? = null
        private set

    val volume get() = (audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 30f / max).roundToInt()

    /** Applies what the command did to [car] to the real audio. */
    fun apply(intent: String, car: Car, genre: String? = null) {
        when (intent) {
            "volume_up", "volume_down" -> {
                val current = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
                var target = (car.volume * max / 30f).roundToInt()
                // The head unit may have fewer steps than 30: always move at least one step.
                if (target == current) target += if (intent == "volume_up") 1 else -1
                audio.setStreamVolume(AudioManager.STREAM_MUSIC, target.coerceIn(0, max), AudioManager.FLAG_SHOW_UI)
                car.syncVolume(volume)
            }
            "media_play" -> {
                val selected = genre?.let(DemoTrack::from)
                when {
                    selected != null -> play(selected)
                    player != null -> player?.start()
                    else -> press(KeyEvent.KEYCODE_MEDIA_PLAY)
                }
            }
            "media_pause" -> if (player == null) press(KeyEvent.KEYCODE_MEDIA_PAUSE) else player?.pause()
            "media_next", "media_previous" -> {
                val current = track
                val next = intent == "media_next"
                if (current == null) press(if (next) KeyEvent.KEYCODE_MEDIA_NEXT else KeyEvent.KEYCODE_MEDIA_PREVIOUS)
                else play(DemoTrack.entries[(current.ordinal + if (next) 1 else DemoTrack.entries.size - 1) % DemoTrack.entries.size])
            }
        }
    }

    private var ducked = false

    fun duck(duck: Boolean) {
        ducked = duck
        val level = if (duck) 0.16f else 1f
        player?.setVolume(level, level)
    }

    private fun play(selected: DemoTrack) {
        val next = checkNotNull(MediaPlayer.create(context, selected.audio)) { "Could not open ${selected.title}" }
        if (player == null) press(KeyEvent.KEYCODE_MEDIA_PAUSE)
        close()
        player = next
        track = selected
        next.isLooping = true
        duck(ducked)
        next.start()
    }

    fun close() {
        player?.release()
        player = null
        track = null
    }

    private fun press(code: Int) {
        val t = SystemClock.uptimeMillis()
        audio.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0))
        audio.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_UP, code, 0))
    }
}
