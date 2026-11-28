package com.myra.car

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import org.json.JSONObject
import java.io.Closeable
import java.nio.FloatBuffer
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * "Okay Myra" without touching the screen. Every microphone chunk goes through [onAudio] (mic thread) to one
 * thread that, for each 80 ms of audio:
 *
 * - runs openWakeWord's speech features (melspectrogram + embedding, assets/wake) and the Myra model trained on
 *   them by tools/wake_word/train_wake.py, exactly as tools/wake_word/features.py does on the PC. When the score
 *   passes the calibrated threshold on enough chunks in a row, the command starts at [WakeTrim.cut]: the pause
 *   after "Myra" in the range where "Myra" ends relative to the firing chunk (measured on unseen voices), or the
 *   start of that range when there is no pause. The range can reach past the firing chunk, so the trim waits for
 *   that audio. [onWake] gets the stream position, so only the command is uploaded.
 * - runs Silero VAD; during a hands-free command, [Endpointer] uses it to call [onEnd] when the driver has finished.
 *
 * The stream is processed continuously, also while a command is recorded, so the features never lose context.
 */
class HandsFree(context: Context, private val onWake: (Long) -> Unit, private val onEnd: () -> Unit) : Closeable {
    private class Chunk(val pcm: ByteArray, val pos: Long)

    private val env = OrtEnvironment.getEnvironment()
    private val assets = context.assets
    private fun session(name: String): OrtSession = OrtSession.SessionOptions().use { o ->
        o.setIntraOpNumThreads(1)
        o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        env.createSession(assets.open("wake/$name").use { it.readBytes() }, o)
    }
    private val mel = session("melspectrogram.onnx")
    private val emb = session("embedding_model.onnx")
    private val wake = session("myra_wake.onnx")
    private val vad = session("silero_vad.onnx")
    private val cal = JSONObject(assets.open("wake/wake_calibration.json").bufferedReader().use { it.readText() })
    private val threshold = cal.getDouble("threshold").toFloat()
    private val consecutive = cal.optInt("consecutive", 1)
    private val endMinMs = cal.getDouble("end_before_fire_min_ms")
    private val endMaxMs = cal.getDouble("end_before_fire_max_ms")

    private val queue = LinkedBlockingQueue<Chunk>(BACKLOG_CHUNKS)
    @Volatile private var closed = false
    private var endpointer: Endpointer? = null // set by main, used by the thread, under this lock
    private var endpointFrom = 0L
    private val worker = Thread(::run, "hands-free").apply { start() }

    /** Mic thread: [pos] is the chunk's byte position in the microphone stream. A full queue drops audio. */
    fun onAudio(pcm: ByteArray, pos: Long) { queue.offer(Chunk(pcm, pos)) }

    /** Main thread: a hands-free command starts at stream byte [from]; watch for its end ([noSpeechMs]: see [Endpointer]). */
    fun beginCommand(from: Long, noSpeechMs: Long = Endpointer.NO_SPEECH_MS) =
        synchronized(this) { endpointer = Endpointer(noSpeechMs); endpointFrom = from }

    /** Main thread: the command ended another way (tap, 10 s cap, tab change). */
    fun endCommand() = synchronized(this) { endpointer = null }

    // ---- the hands-free thread ----

    private val features = WakeFeatures()
    private val raw = ShortArray(RAW_SAMPLES) // the last 2 s, for the trim; index = sample position % size
    private var pending = FloatArray(0) // samples not yet in a whole 80 ms chunk
    private var pendingPos = 0L // sample position of pending[0]
    private var nextPos = -1L // expected byte position of the next mic chunk
    private var quietUntil = 0L // sample position before which a new wake is ignored (just fired)
    private var over = 0 // chunks in a row at or over the threshold
    private var fired = -1L // sample position the model fired at, while waiting for the audio the trim needs
    private val vadState = FloatArray(2 * 128)
    private val vadContext = FloatArray(VAD_CONTEXT)
    private var vadPending = FloatArray(0)
    private val probs = ArrayDeque<Pair<Long, Float>>() // (chunk end byte, speech probability), last few seconds

    private fun reset(pos: Long) {
        features.reset()
        pending = FloatArray(0)
        pendingPos = pos / 2
        vadState.fill(0f); vadContext.fill(0f); vadPending = FloatArray(0)
        probs.clear()
        over = 0
        fired = -1
    }

    private fun run() {
        try {
            while (!closed) {
                val c = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
                if (c.pos != nextPos) reset(c.pos) // first audio, mic reopened, or chunks dropped
                nextPos = c.pos + c.pcm.size
                val samples = FloatArray(c.pcm.size / 2) { i ->
                    ((c.pcm[2 * i].toInt() and 0xFF) or (c.pcm[2 * i + 1].toInt() shl 8)).toShort().toFloat()
                }
                val first = c.pos / 2
                for (i in samples.indices) raw[((first + i) % RAW_SAMPLES).toInt()] = samples[i].toInt().toShort()
                endpoint(c, speechProbability(samples))
                pending += samples
                while (pending.size >= WakeFeatures.CHUNK) {
                    val score = features.push(pending.copyOf(WakeFeatures.CHUNK), mel, emb, wake, env)
                    pending = pending.copyOfRange(WakeFeatures.CHUNK, pending.size)
                    pendingPos += WakeFeatures.CHUNK
                    over = if (score >= threshold) over + 1 else 0
                    if (over >= consecutive && pendingPos >= quietUntil) {
                        quietUntil = pendingPos + 2 * Recorder.SAMPLE_RATE
                        fired = pendingPos
                    }
                }
                if (fired >= 0 && nextPos / 2 >= cutEnd(fired)) {
                    onWake(cut(fired) * 2)
                    fired = -1
                }
            }
        } catch (_: InterruptedException) {
        }
    }

    /** features.cut_end: the last sample the trim looks at. */
    private fun cutEnd(fire: Long) = fire - (endMinMs * 16).toLong() + 960

    /** features.cut: where the command starts, from the audio around the firing chunk. */
    private fun cut(fire: Long): Long {
        val oldest = maxOf(0L, nextPos / 2 - RAW_SAMPLES)
        val lo = maxOf(oldest, (fire - (endMaxMs * 16).toLong()) / 160 * 160)
        val hi = minOf(nextPos / 2, cutEnd(fire))
        return WakeTrim.cut(lo, hi) { i -> raw[(i % RAW_SAMPLES).toInt()] } ?: fire
    }

    /** Silero VAD over the chunk's 32 ms windows; the chunk's speech probability is its highest. */
    private fun speechProbability(samples: FloatArray): Float {
        vadPending += samples
        var best = 0f
        while (vadPending.size >= VAD_WINDOW) {
            val input = FloatArray(VAD_CONTEXT + VAD_WINDOW)
            vadContext.copyInto(input)
            for (i in 0 until VAD_WINDOW) input[VAD_CONTEXT + i] = vadPending[i] / 32768f
            input.copyInto(vadContext, 0, VAD_WINDOW, VAD_WINDOW + VAD_CONTEXT)
            vadPending = vadPending.copyOfRange(VAD_WINDOW, vadPending.size)
            OnnxTensor.createTensor(env, FloatBuffer.wrap(input), longArrayOf(1, input.size.toLong())).use { x ->
                OnnxTensor.createTensor(env, FloatBuffer.wrap(vadState), longArrayOf(2, 1, 128)).use { st ->
                    OnnxTensor.createTensor(env, 16000L).use { sr ->
                        vad.run(mapOf("input" to x, "state" to st, "sr" to sr)).use { out ->
                            best = maxOf(best, (out[0].value as Array<FloatArray>)[0][0])
                            @Suppress("UNCHECKED_CAST")
                            val s = out[1].value as Array<Array<FloatArray>>
                            for (a in 0 until 2) s[a][0].copyInto(vadState, a * 128)
                        }
                    }
                }
            }
        }
        return best
    }

    private fun endpoint(c: Chunk, prob: Float) {
        val end = c.pos + c.pcm.size
        probs.addLast(end to prob)
        while (probs.size > PROB_HISTORY) probs.removeFirst()
        val (ep, from) = synchronized(this) { endpointer to endpointFrom }
        if (ep == null) return
        // The command may start before this chunk: catch up on the chunks since its start first.
        val todo = if (!ep.started) probs.filter { it.first > from }.map { it.second } else listOf(prob)
        ep.started = true
        for (p in todo) if (ep.feed(p) != Endpointer.State.LISTENING) {
            synchronized(this) { if (endpointer === ep) endpointer = null else return }
            onEnd()
            return
        }
    }

    override fun close() {
        closed = true
        worker.interrupt()
        worker.join(2_000)
        listOf(mel, emb, wake, vad).forEach { it.close() }
    }

    companion object {
        const val BACKLOG_CHUNKS = 30 // 3 s; must stay below Recorder.RING_MS so the command start is still buffered
        const val RAW_SAMPLES = 2 * Recorder.SAMPLE_RATE
        const val VAD_WINDOW = 512
        const val VAD_CONTEXT = 64
        const val PROB_HISTORY = 50
    }
}

/** openWakeWord's streaming features (tools/wake_word/features.py) and the Myra model, per 80 ms chunk. */
class WakeFeatures {
    private var history = FloatArray(HISTORY)
    private val melFrames = FloatArray(MEL_WINDOW * MEL_BINS)
    private val embeddings = FloatArray(EMB_WINDOW * EMB_SIZE)
    private var count = 0

    init { reset() }

    fun reset() {
        history = FloatArray(HISTORY)
        melFrames.fill(1f)
        embeddings.fill(0f)
        count = 0
    }

    /** One 80 ms chunk (int16 values as floats); returns the wake score, 0 until 16 embeddings exist. */
    fun push(chunk: FloatArray, mel: OrtSession, emb: OrtSession, wake: OrtSession, env: OrtEnvironment): Float {
        val input = history + chunk
        history = input.copyOfRange(input.size - HISTORY, input.size)
        val frames = OnnxTensor.createTensor(env, FloatBuffer.wrap(input), longArrayOf(1, input.size.toLong())).use { x ->
            mel.run(mapOf(mel.inputNames.first() to x)).use { flat4(it[0].value) }
        }
        val n = frames.size / MEL_BINS // 8
        melFrames.copyInto(melFrames, 0, n * MEL_BINS, melFrames.size)
        for (i in frames.indices) melFrames[melFrames.size - frames.size + i] = frames[i] / 10f + 2f
        val e = OnnxTensor.createTensor(env, FloatBuffer.wrap(melFrames), longArrayOf(1, MEL_WINDOW.toLong(), MEL_BINS.toLong(), 1)).use { x ->
            emb.run(mapOf(emb.inputNames.first() to x)).use { flat4(it[0].value) }
        }
        embeddings.copyInto(embeddings, 0, EMB_SIZE, embeddings.size)
        e.copyInto(embeddings, embeddings.size - EMB_SIZE)
        if (++count < EMB_WINDOW) return 0f
        return OnnxTensor.createTensor(env, FloatBuffer.wrap(embeddings), longArrayOf(1, EMB_WINDOW.toLong(), EMB_SIZE.toLong())).use { x ->
            wake.run(mapOf(wake.inputNames.first() to x)).use { (it[0].value as Array<FloatArray>)[0][0] }
        }
    }

    companion object {
        const val CHUNK = 1280
        const val HISTORY = 480
        const val MEL_WINDOW = 76
        const val MEL_BINS = 32
        const val EMB_WINDOW = 16
        const val EMB_SIZE = 96

        /** Flattens a 4-D ONNX float result ([a][b][c][d]) in order. */
        @Suppress("UNCHECKED_CAST")
        fun flat4(v: Any): FloatArray {
            val out = ArrayList<Float>()
            for (a in v as Array<Array<Array<FloatArray>>>) for (b in a) for (c in b) for (d in c) out.add(d)
            return out.toFloatArray()
        }
    }
}

/** The trim, shared with tools/wake_word/features.py so the PC measurement is what the car does. */
object WakeTrim {
    const val PAUSE_DEPTH_DB = 20.0 // a pause is this much quieter than the loudest 10 ms frame in the range
    const val PAUSE_MIN_FRAMES = 12 // and lasts 120 ms: shorter dips can be consonants or a short gap inside the command

    /**
     * Where the command starts in samples [lo, hi), the range where "Myra" can end. If it holds a pause (the
     * quietest 10 ms frames, within 6 dB of the quietest, [PAUSE_DEPTH_DB] under the loudest and
     * [PAUSE_MIN_FRAMES] long), its start. Otherwise [lo]: the command follows "Myra" with no gap, and keeping
     * some of "Myra" (the transcript drops it) is better than losing the command's first sound. Null when the
     * range is under 10 ms.
     */
    fun cut(lo: Long, hi: Long, sample: (Long) -> Short): Long? {
        val frames = ((hi - lo) / 160).toInt()
        if (frames < 1) return null
        val e = DoubleArray(frames) { f ->
            var sum = 0.0
            for (i in 0 until 160) { val s = sample(lo + f * 160 + i).toDouble(); sum += s * s }
            10 * Math.log10(sum / 160 + 1)
        }
        val min = e.min()
        var a = e.indexOfFirst { it == min }
        var b = a
        while (a > 0 && e[a - 1] <= min + 6) a--
        while (b + 1 < frames && e[b + 1] <= min + 6) b++
        return if (e.max() - min >= PAUSE_DEPTH_DB && b - a + 1 >= PAUSE_MIN_FRAMES) lo + a * 160L else lo
    }
}

/** Drops a wake word the transcript still starts with ("Myra, turn on the AC" -> "turn on the AC"). */
object Wake {
    private val LEADING = Regex("""^\W*((okay|ok|hey)\W+)?(myra|maira|mira)\b\W*""", RegexOption.IGNORE_CASE)
    fun strip(text: String) = text.replace(LEADING, "").ifBlank { text }
}

/**
 * When a hands-free command is over, from Silero's speech probability for each 100 ms. The driver has finished
 * after [END_SILENCE_MS] of no speech following speech, or [SHORT_END_SILENCE_MS] if they have said under
 * [SHORT_SPEECH_MS] so far (a thinking pause after "set the…" is longer than one at the end of a sentence).
 * Nobody spoke within [noSpeechMs] ([NO_SPEECH_MS] unless the activity waits less): over. The 10 s cap is the activity's.
 */
class Endpointer(private val noSpeechMs: Long = NO_SPEECH_MS) {
    enum class State { LISTENING, DONE, NOTHING_SAID }

    var started = false // HandsFree: history since the command's start was fed
    private var ms = 0L
    private var speechMs = 0L
    private var quietMs = 0L
    private var inSpeech = false

    /** Speech counts from 200 ms of it, so a cough or a bump alone is not a command. */
    val spoke get() = speechMs >= 200

    fun feed(prob: Float): State {
        ms += 100
        inSpeech = prob >= if (inSpeech) 0.35f else 0.5f // Silero's own hysteresis
        if (inSpeech) { speechMs += 100; quietMs = 0 } else quietMs += 100
        return when {
            !spoke -> if (ms >= noSpeechMs) State.NOTHING_SAID else State.LISTENING
            quietMs >= (if (speechMs < SHORT_SPEECH_MS) SHORT_END_SILENCE_MS else END_SILENCE_MS) -> State.DONE
            else -> State.LISTENING
        }
    }

    companion object {
        const val END_SILENCE_MS = 1_000L
        const val SHORT_END_SILENCE_MS = 1_500L
        const val SHORT_SPEECH_MS = 1_000L
        const val NO_SPEECH_MS = 4_000L
    }
}
