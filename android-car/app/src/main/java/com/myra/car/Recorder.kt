package com.myra.car

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.ByteArrayOutputStream
import java.util.concurrent.BlockingQueue

/**
 * The microphone, open while Myra AI is selected. Opening it on a slow head unit takes long, and a short ring
 * buffer keeps the last [PREROLL_MS] so a command spoken right on the press is not cut off. While a command is
 * recorded, every 100 ms of 16 kHz mono PCM is handed to [sink] (the uploader); an empty array marks the end.
 */
class Recorder {
    private val chunkBytes = SAMPLE_RATE / 10 * 2
    private val ring = ArrayDeque<ByteArray>()
    private var sink: BlockingQueue<ByteArray>? = null
    private var capture: ByteArrayOutputStream? = null
    private var recordingCommand = false
    @Volatile private var record: AudioRecord? = null

    /** Bytes of audio sent to the current [sink] (16-bit mono: bytes / 32 = ms). */
    var sentBytes = 0L; private set

    /** Loudest 100 ms (RMS, 16-bit scale) of the current command: below [SPEECH_RMS] nobody spoke. */
    var peakRms = 0.0; private set

    @SuppressLint("MissingPermission") // the activity asks for RECORD_AUDIO before starting
    fun open(): Boolean {
        if (record != null) return true
        val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, maxOf(min, chunkBytes * 4))
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); return false }
        try { rec.startRecording() } catch (_: IllegalStateException) { rec.release(); return false }
        record = rec
        Thread({
            while (record === rec) {
                val buf = ByteArray(chunkBytes)
                var n = 0
                while (n < buf.size && record === rec) {
                    val r = rec.read(buf, n, buf.size - n)
                    if (r <= 0) break
                    n += r
                }
                if (n < buf.size) continue
                synchronized(this) {
                    if (record !== rec) return@synchronized
                    ring.addLast(buf)
                    while (ring.size > PREROLL_MS / 100) ring.removeFirst()
                    if (recordingCommand) {
                        sink?.put(buf)
                        capture?.write(buf)
                        sentBytes += buf.size
                        peakRms = maxOf(peakRms, rms(buf))
                    }
                }
            }
        }, "mic").apply { priority = Thread.MAX_PRIORITY }.start()
        return true
    }

    /** Starts collecting audio (the pre-roll first) for upload, local identification, or both. */
    fun start(queue: BlockingQueue<ByteArray>? = null, captureVoice: Boolean = false) = synchronized(this) {
        sentBytes = 0
        peakRms = 0.0
        capture = if (captureVoice) ByteArrayOutputStream() else null
        for (b in ring) { queue?.put(b); sentBytes += b.size; capture?.write(b) }
        sink = queue
        recordingCommand = true
    }

    /** Ends the current command; returns its length in ms. */
    fun stop(): Long = synchronized(this) {
        sink?.put(ByteArray(0))
        sink = null
        recordingCommand = false
        sentBytes / (SAMPLE_RATE * 2 / 1000)
    }

    fun takeVoice(): ByteArray? = synchronized(this) {
        capture?.toByteArray().also { capture = null }
    }

    fun clearPreroll() = synchronized(this) { ring.clear() }

    fun close() {
        val rec = synchronized(this) {
            stop()
            capture = null
            ring.clear()
            record.also { record = null }
        }
        rec?.let {
            try { it.stop() } finally { it.release() }
        }
    }

    private fun rms(pcm: ByteArray): Double {
        var sum = 0.0
        for (i in pcm.indices step 2) {
            val s = (pcm[i].toInt() and 0xFF) or (pcm[i + 1].toInt() shl 8)
            sum += s.toDouble() * s
        }
        return Math.sqrt(sum / (pcm.size / 2))
    }

    companion object {
        fun samples(pcm: ByteArray) = FloatArray(pcm.size / 2) { i ->
            ((pcm[2 * i].toInt() and 0xFF) or (pcm[2 * i + 1].toInt() shl 8)) / 32768f
        }
        const val SAMPLE_RATE = 16000
        const val PREROLL_MS = 400
        // ~-42 dBFS: room or engine hum stays below, any spoken word goes above. Silence sent to Sarvam's translate
        // mode can come back as an invented sentence, so it is not acted on.
        const val SPEECH_RMS = 260.0
    }
}
