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
 * Every chunk also goes to [tap] (hands-free listening), under this object's lock, with its byte position in the
 * stream; the ring holds [RING_MS] so a command can start at a position the wake word found ([startAt]).
 */
class Recorder {
    private val chunkBytes = SAMPLE_RATE / 10 * 2
    private val ring = ArrayDeque<ByteArray>()
    private var sink: BlockingQueue<ByteArray>? = null
    private var capture: ByteArrayOutputStream? = null
    private var recordingCommand = false
    @Volatile private var record: AudioRecord? = null
    private var streamBytes = 0L // bytes read since the mic opened; ring.last ends here

    /** Sees every chunk once, in order: (pcm, its stream position in bytes). */
    @Volatile var tap: ((ByteArray, Long) -> Unit)? = null

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
        synchronized(this) { streamBytes = 0; ring.clear() }
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
                    while (ring.size > RING_MS / 100) ring.removeFirst()
                    if (recordingCommand) take(buf)
                    tap?.invoke(buf, streamBytes)
                    streamBytes += buf.size
                }
            }
        }, "mic").apply { priority = Thread.MAX_PRIORITY }.start()
        return true
    }

    private fun take(b: ByteArray) {
        sink?.put(b)
        capture?.write(b)
        sentBytes += b.size
        peakRms = maxOf(peakRms, rms(b))
    }

    /** Starts collecting audio (the pre-roll first) for upload, local identification, or both. */
    fun start(queue: BlockingQueue<ByteArray>? = null, captureVoice: Boolean = false) =
        startAt(Long.MAX_VALUE, queue, captureVoice)

    /**
     * Like [start], but the command begins at stream byte [pos] (as far back as the ring reaches; [Long.MAX_VALUE]
     * means the usual pre-roll). The buffered audio from there is sent first.
     */
    /** [voiceFrom]: the voice sample may start earlier than the command, e.g. with the wake word ("Hi Myra"). */
    fun startAt(pos: Long, queue: BlockingQueue<ByteArray>?, captureVoice: Boolean = false, voiceFrom: Long = pos) = synchronized(this) {
        sentBytes = 0
        peakRms = 0.0
        sink = queue
        recordingCommand = true
        val from = if (pos == Long.MAX_VALUE) streamBytes - PREROLL_MS / 100 * chunkBytes else pos and 1L.inv() // whole samples
        val voice = minOf(from, voiceFrom and 1L.inv())
        capture = if (captureVoice) ByteArrayOutputStream() else null
        var p = streamBytes - ring.size.toLong() * chunkBytes
        for (b in ring) {
            val vSkip = (voice - p).coerceIn(0, b.size.toLong()).toInt()
            val skip = (from - p).coerceIn(0, b.size.toLong()).toInt()
            if (vSkip < skip) capture?.write(b, vSkip, skip - vSkip) // before the command: voice sample only
            if (skip < b.size) take(if (skip == 0) b else b.copyOfRange(skip, b.size))
            p += b.size
        }
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

    /** Stream position (bytes) of the newest audio. */
    val position get() = synchronized(this) { streamBytes }

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

    companion object {
        fun rms(pcm: ByteArray): Double {
            var sum = 0.0
            for (i in pcm.indices step 2) {
                val s = (pcm[i].toInt() and 0xFF) or (pcm[i + 1].toInt() shl 8)
                sum += s.toDouble() * s
            }
            return Math.sqrt(sum / (pcm.size / 2))
        }

        fun samples(pcm: ByteArray) = FloatArray(pcm.size / 2) { i ->
            ((pcm[2 * i].toInt() and 0xFF) or (pcm[2 * i + 1].toInt() shl 8)) / 32768f
        }
        const val SAMPLE_RATE = 16000
        const val PREROLL_MS = 400
        const val RING_MS = 5_000 // longer than HandsFree.BACKLOG_CHUNKS, so the command's start is still here
        // ~-42 dBFS: room or engine hum stays below, any spoken word goes above. Silence sent to Sarvam's translate
        // mode can come back as an invented sentence, so it is not acted on.
        const val SPEECH_RMS = 260.0
    }
}
