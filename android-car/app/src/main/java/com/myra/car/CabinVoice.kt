package com.myra.car

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log

/**
 * Myra's voice: one pre-rendered clip per line ([VoiceLines]), all in the same local neural voice. No speech
 * engine and no network, so a line never switches voice halfway and starts as soon as it is asked for.
 */
internal class CabinVoice(private val context: Context, private val speakingChanged: (Boolean) -> Unit) {
    private var player: MediaPlayer? = null
    private var current = 0
    var speaking = false
        private set

    fun speak(text: String) {
        stop()
        val id = ++current
        val clip = runCatching {
            context.assets.openFd("voice/${VoiceLines.key(text)}.ogg").use { fd ->
                MediaPlayer().apply {
                    setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
                    prepare()
                }
            }
        }.onFailure { Log.w("MyraVoice", "No clip for: $text", it) }.getOrNull() ?: return
        player = clip
        speaking = true
        speakingChanged(true)
        clip.setOnCompletionListener { if (id == current) stop() }
        clip.setOnErrorListener { _, _, _ -> if (id == current) stop(); true }
        if (runCatching { clip.start() }.isFailure) stop()
    }

    fun stop() {
        current++
        player?.release()
        player = null
        if (speaking) {
            speaking = false
            speakingChanged(false)
        }
    }

    fun close() = stop()
}
