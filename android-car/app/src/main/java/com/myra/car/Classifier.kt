package com.myra.car

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.Closeable
import java.nio.LongBuffer

/**
 * One English sentence -> intent, its probability, the probability that it is negated, and the values the model
 * marked in it, by kind (TEMP, LEVEL, COLOR, GENRE, PLACE, NAME -> the words, e.g. PLACE -> "phoenix mall").
 */
data class IntentScore(val intent: String, val confidence: Float)
data class Understanding(
    val intent: String,
    val confidence: Float,
    val negated: Float,
    val latencyMs: Long,
    val runnerUp: IntentScore? = null,
    val slots: Map<String, String> = emptyMap(),
)

internal data class CommandRequest(
    val action: JSONObject?,
    val understanding: Understanding?,
    val question: CabinQuestion? = null,
)

/**
 * The on-device classifier: MiniLM-L6 fine-tuned on the cockpit intents, 8-bit ONNX, run by ONNX Runtime.
 * Files in assets/: model.int8.onnx, vocab.txt, labels.json (backend/bhashadrive/training/train_car_classifier.py).
 */
class Classifier(context: Context) : Closeable {
    private val env = OrtEnvironment.getEnvironment()
    private val labels: List<String>
    private val tags: List<String>
    private val tokenizer: WordPiece
    private val session: OrtSession
    private val shortcutEncoder = lazy { ShortcutEncoder(context.applicationContext, tokenizerForShortcuts()) }
    private val clarificationHead = lazy { CabinClarificationModel(context) }
    private var shortcutEncoderFailed = false
    private val shortcutMatcher = ShortcutMatcher(::embed)

    private fun embed(phrase: String): FloatArray? =
        if (shortcutEncoderFailed) null else try {
            shortcutEncoder.value.embed(phrase)
        } catch (error: Exception) {
            shortcutEncoderFailed = true
            Log.w("MyraShortcuts", "Shortcut similarity unavailable", error)
            null
        }

    init {
        val assets = context.assets
        val meta = JSONObject(assets.open("labels.json").bufferedReader().use { it.readText() })
        val arr = meta.getJSONArray("labels")
        labels = List(arr.length()) { arr.getString(it) }
        tags = meta.getJSONArray("tags").let { t -> List(t.length()) { t.getString(it) } }
        tokenizer = WordPiece(assets.open("vocab.txt").bufferedReader().use { it.readLines() }, meta.getInt("max_len"))
        session = OrtSession.SessionOptions().use { opts ->
            opts.setIntraOpNumThreads(4)
            opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            env.createSession(assets.open("model.int8.onnx").use { it.readBytes() }, opts)
        }
        try {
            classify("set the temperature to 22") // warm-up: first run allocates and optimises
        } catch (e: Exception) {
            close()
            throw e
        }
    }

    private fun tokenizerForShortcuts() = tokenizer

    internal fun matchShortcut(text: String, candidates: List<Shortcuts.Shortcut>): ShortcutMatch? =
        shortcutMatcher.match(text, candidates)

    override fun close() {
        try {
            if (shortcutEncoder.isInitialized()) shortcutEncoder.value.close()
        } finally {
            session.close()
        }
    }

    /** Sentence embedding for remembering what the driver meant ([Learned]); null when the encoder is unavailable. */
    internal fun meaning(text: String): FloatArray? = embed(Shortcuts.normalize(text))

    internal fun resolve(text: String): CommandRequest {
        CockpitRequests.parse(text)?.let { return CommandRequest(it, null) }
        if (CabinDialogue.needsTemperature(text)) return CommandRequest(null, null, CabinQuestion.Temperature)
        val observation = CabinDialogue.isObservation(text)
        val temperatureCue = CabinDialogue.temperatureCue(text)
        if ((observation || temperatureCue != null) && CabinDialogue.canSuggest(text)) {
            val suggestion = temperatureCue ?: runCatching { embed(text)?.let { clarificationHead.value.predict(it) } }.getOrNull()
            if (suggestion != null) return CommandRequest(null, null, CabinQuestion.Confirm(suggestion))
        }
        val result = classify(text)
        if (result.negated > 0.5f) return CommandRequest(null, result)
        if (observation) {
            return if (result.intent == "unsupported") CommandRequest(null, result)
            else CommandRequest(null, result, CabinQuestion.Rephrase)
        }
        val question = CabinDialogue.questionFor(result, text)
        if (question != null) return CommandRequest(null, result, question)
        val action = if (result.confidence >= Car.MIN_CONFIDENCE && result.negated < 0.5f) Car.action(result.intent, text, result.slots) else null
        return CommandRequest(action, result)
    }

    /** The first span of each kind: a word's tag is its first piece's; neighbouring words of one kind form one span. */
    private fun slots(encoded: WordPiece.Encoded, tokenTags: LongArray): Map<String, String> {
        val wordTag = HashMap<Int, String>()
        for (t in tokenTags.indices) {
            val w = encoded.wordOf.getOrElse(t) { -1 }
            if (w >= 0 && w !in wordTag) wordTag[w] = tags.getOrElse(tokenTags[t].toInt()) { "O" }
        }
        val out = LinkedHashMap<String, String>()
        var kind: String? = null
        val span = ArrayList<String>()
        fun close() {
            val k = kind ?: return
            if (k !in out && span.isNotEmpty()) out[k] = span.joinToString(" ").replace(" ' ", "'").replace(" - ", "-")
            kind = null
            span.clear()
        }
        for (w in encoded.words.indices) {
            val tag = wordTag[w] ?: "O"
            val k = tag.substringAfter('-', "")
            when {
                // A new kind starts a span; the same kind right after continues it ("lo" "-" "fi" -> "lo-fi").
                k.isNotEmpty() && k == kind -> span += encoded.words[w]
                k.isNotEmpty() -> { close(); kind = k; span += encoded.words[w] }
                else -> close()
            }
        }
        close()
        return out
    }

    fun classify(text: String): Understanding {
        val t0 = System.nanoTime()
        val encoded = tokenizer.encodeWords(text)
        val ids = LongArray(encoded.ids.size) { encoded.ids[it].toLong() }
        val shape = longArrayOf(1, ids.size.toLong())
        OnnxTensor.createTensor(env, LongBuffer.wrap(ids), shape).use { input ->
            OnnxTensor.createTensor(env, LongBuffer.wrap(LongArray(ids.size) { 1 }), shape).use { mask ->
                session.run(mapOf("input_ids" to input, "attention_mask" to mask)).use { out ->
                    @Suppress("UNCHECKED_CAST")
                    val probs = (out[0].value as Array<FloatArray>)[0]
                    val negated = (out[1].value as FloatArray)[0]
                    val best = probs.indices.maxBy { probs[it] }
                    val second = probs.indices.filter { it != best }.maxByOrNull { probs[it] }
                    @Suppress("UNCHECKED_CAST")
                    val tokenTags = (out[2].value as Array<LongArray>)[0]
                    return Understanding(labels[best], probs[best], negated, (System.nanoTime() - t0) / 1_000_000,
                        second?.let { IntentScore(labels[it], probs[it]) }, slots(encoded, tokenTags))
                }
            }
        }
    }
}
