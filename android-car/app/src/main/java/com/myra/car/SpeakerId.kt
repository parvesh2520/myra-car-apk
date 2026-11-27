package com.myra.car

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.io.File
import java.nio.FloatBuffer
import kotlin.math.sqrt

/** The profile a voice belongs to; scores are cosine similarities to the voiceprints. */
data class Match(val profile: String, val score: Float, val margin: Float)

/**
 * Who is speaking, on the car: the backend's driver recognition (bhashadrive/audio/speaker_id.py) ported to the app.
 * Same model (3D-Speaker CAM++ zh/en, fp32 ONNX, 192-d embedding), same features ([Fbank]), same thresholds.
 * A voiceprint is the mean of a profile's enrollment embeddings. Only embeddings are stored, never audio; they are
 * biometric data, so they stay in the app's private storage and [forget] deletes them.
 */
class SpeakerId(context: Context) : Closeable {
    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    private val store = File(context.noBackupFilesDir, "voiceprints.json")
    val prints = Voiceprints(load(store))

    init {
        // ONNX Runtime reads the model from a file path, so its 28 MB never pass through the Java heap.
        val model = File(context.noBackupFilesDir, MODEL)
        if (model.length() != context.assets.openFd(MODEL).use { it.length }) {
            val tmp = File(model.path + ".tmp")
            context.assets.open(MODEL).use { i -> tmp.outputStream().use { i.copyTo(it) } }
            check(tmp.renameTo(model)) { "could not install the speaker model" }
        }
        session = OrtSession.SessionOptions().use { opts ->
            opts.setIntraOpNumThreads(4)
            opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            // Free activations after each run instead of keeping an arena: the car has ~500 MB for apps.
            opts.setCPUArenaAllocator(false)
            opts.setMemoryPatternOptimization(false)
            env.createSession(model.path, opts)
        }
    }

    override fun close() = session.close()

    /** Unit-length embedding of 16 kHz speech in [-1, 1]. */
    fun embed(speech: FloatArray): FloatArray {
        val feats = Fbank.compute(speech)
        val shape = longArrayOf(1, (feats.size / Fbank.BINS).toLong(), Fbank.BINS.toLong())
        OnnxTensor.createTensor(env, FloatBuffer.wrap(feats), shape).use { x ->
            session.run(mapOf("x" to x)).use { out ->
                @Suppress("UNCHECKED_CAST")
                return unit((out[0].value as Array<FloatArray>)[0])
            }
        }
    }

    /** Adds one utterance to [profile]'s voiceprint; returns its number of samples. Throws with a message to show. */
    fun enroll(profile: String, audio: FloatArray): Int {
        val speech = voiced(audio)
        require(speech.size >= MIN_ENROLL_S * RATE) { "Need at least ${MIN_ENROLL_S} s of speech; please say the whole sentence." }
        val n = prints.add(profile, embed(speech))
        save()
        return n
    }

    /** The enrolled profile this voice belongs to, or null when unsure (too short, too far, or too close to two). */
    fun identify(audio: FloatArray): Match? {
        if (prints.isEmpty()) return null
        val speech = voiced(audio)
        if (speech.size < MIN_IDENTIFY_S * RATE) return null
        return prints.match(embed(speech))
    }

    fun forget(profile: String) {
        prints.remove(profile)
        save()
    }

    private fun save() {
        val samples = JSONObject()
        for ((p, list) in prints.samples) samples.put(p, JSONArray(list.map { e -> JSONArray(e.map { it.toDouble() }) }))
        val tmp = File(store.path + ".tmp")
        tmp.writeText(JSONObject().put("model", MODEL).put("samples", samples).toString())
        check(tmp.renameTo(store)) { "could not save the voiceprints" }
    }

    companion object {
        const val MODEL = "campplus_sv_zh_en_16k.onnx"
        fun enrolledDrivers(context: Context): Set<String> =
            Voiceprints(load(File(context.noBackupFilesDir, "voiceprints.json"))).counts().keys
        const val RATE = 16000
        // Backend defaults (bhashadrive/config.py SpeakerIDConfig).
        const val THRESHOLD = 0.35f
        const val MARGIN = 0.04f
        const val SAME_PERSON = 0.35f
        const val MIN_IDENTIFY_S = 0.6
        const val MIN_ENROLL_S = 1.5
        const val MAX_SAMPLES = 6
        const val MIN_RMS = 0.005

        fun unit(v: FloatArray): FloatArray {
            var s = 0.0
            for (x in v) s += x.toDouble() * x
            val k = (1 / (sqrt(s) + 1e-9)).toFloat()
            return FloatArray(v.size) { v[it] * k }
        }

        /** Drops silent 30 ms frames, so pauses don't dilute the voice (and length checks count speech only). */
        fun voiced(audio: FloatArray): FloatArray {
            val n = 480
            val frames = audio.size / n
            val rms = DoubleArray(frames) { f ->
                var s = 0.0
                for (i in f * n until (f + 1) * n) s += audio[i].toDouble() * audio[i]
                sqrt(s / n)
            }
            val floor = maxOf(MIN_RMS, (rms.maxOrNull() ?: 0.0) * 0.05)
            val keep = (0 until frames).filter { rms[it] > floor }
            val out = FloatArray(keep.size * n)
            keep.forEachIndexed { j, f -> System.arraycopy(audio, f * n, out, j * n, n) }
            return out
        }

        private fun load(store: File): MutableMap<String, MutableList<FloatArray>> {
            val map = linkedMapOf<String, MutableList<FloatArray>>()
            val samples = runCatching { JSONObject(store.readText()).getJSONObject("samples") }.getOrNull() ?: return map
            for (p in samples.keys()) {
                val arr = samples.getJSONArray(p)
                map[p] = MutableList(arr.length()) { i -> arr.getJSONArray(i).let { e -> FloatArray(e.length()) { e.getDouble(it).toFloat() } } }
            }
            return map
        }
    }
}

/** The enrolled voiceprints and the matching rules, separate from the model so they can be unit-tested. */
class Voiceprints(val samples: MutableMap<String, MutableList<FloatArray>> = linkedMapOf()) {
    fun isEmpty() = samples.values.all { it.isEmpty() }
    fun counts(): Map<String, Int> = samples.filterValues { it.isNotEmpty() }.mapValues { it.value.size }
    fun remove(profile: String) { samples.remove(profile) }

    private fun print(list: List<FloatArray>) = SpeakerId.unit(FloatArray(list[0].size) { d -> list.sumOf { it[d].toDouble() }.toFloat() / list.size })

    /** Adds a unit embedding; a sample far from the profile's existing voiceprint is refused (a different person). */
    fun add(profile: String, emb: FloatArray): Int {
        val existing = samples[profile].orEmpty()
        if (existing.isNotEmpty()) {
            val sim = dot(print(existing), emb)
            require(sim >= SpeakerId.SAME_PERSON) {
                "This voice doesn't match $profile's voiceprint (similarity %.2f). Make sure the same person is speaking, or forget the voice and enroll again.".format(sim)
            }
        }
        // The newest samples win, so re-enrolling in a new cabin or with a cold tracks the voice.
        val next = (existing + emb).takeLast(SpeakerId.MAX_SAMPLES).toMutableList()
        samples[profile] = next
        return next.size
    }

    fun match(emb: FloatArray): Match? {
        val scores = samples.filterValues { it.isNotEmpty() }.map { (p, list) -> dot(print(list), emb) to p }.sortedByDescending { it.first }
        if (scores.isEmpty()) return null
        val (best, who) = scores[0]
        val margin = if (scores.size > 1) best - scores[1].first else best
        if (best < SpeakerId.THRESHOLD || margin < SpeakerId.MARGIN) return null
        return Match(who, best, margin)
    }

    private fun dot(a: FloatArray, b: FloatArray): Float {
        var s = 0.0
        for (i in a.indices) s += a[i].toDouble() * b[i]
        return s.toFloat()
    }
}
