package com.myra.car

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log

/**
 * Myra's voice: pre-rendered clips ([VoiceLines]), all in the same local neural voice, played one at a time.
 * No speech engine and no network, so a line never switches voice and starts as soon as it is asked for.
 * Only the clip playing is in memory. Main thread only.
 */
internal class CabinVoice(private val context: Context, private val speakingChanged: (Boolean) -> Unit) {
    private var player: MediaPlayer? = null
    private var current = 0
    private val queue = ArrayDeque<String>() // lines still to play after the current one
    var speaking = false
        private set

    /** Interrupts whatever is playing. */
    fun speak(text: String) {
        stop()
        queue += text
        next()
    }

    /** Plays [lines] after whatever is playing, instead of cutting it off. */
    fun speakAfter(lines: List<String>) {
        queue += lines
        if (!speaking) next()
    }

    /** Starts the next line with a clip; when none is left, Myra has stopped speaking. */
    private fun next() {
        release()
        while (queue.isNotEmpty()) {
            val text = queue.removeFirst()
            val clip = open(text) ?: continue
            val id = current
            player = clip
            clip.setOnCompletionListener { if (id == current) next() }
            clip.setOnErrorListener { _, _, _ -> if (id == current) next(); true }
            if (runCatching { clip.start() }.isFailure) { release(); continue }
            if (!speaking) {
                speaking = true
                speakingChanged(true)
            }
            return
        }
        if (speaking) {
            speaking = false
            speakingChanged(false)
        }
    }

    private fun open(text: String): MediaPlayer? = runCatching {
        context.assets.openFd("voice/${VoiceLines.key(text)}.ogg").use { fd ->
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
                prepare()
            }
        }
    }.onFailure { Log.w("MyraVoice", "No clip for: $text", it) }.getOrNull()

    private fun release() {
        current++
        player?.release()
        player = null
    }

    fun stop() {
        queue.clear()
        next()
    }

    fun close() = stop()
}
