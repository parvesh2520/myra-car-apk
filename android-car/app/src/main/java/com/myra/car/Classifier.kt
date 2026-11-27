package com.myra.car

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import org.json.JSONObject
import java.io.Closeable
import java.nio.LongBuffer

/** One English sentence -> intent (V2 taxonomy), its probability, and the probability that it is negated. */
data class Understanding(val intent: String, val confidence: Float, val negated: Float, val latencyMs: Long)

/**
 * The on-device classifier: MiniLM-L6 fine-tuned on the cockpit intents, 8-bit ONNX, run by ONNX Runtime.
 * Files in assets/: model.int8.onnx, vocab.txt, labels.json (backend/bhashadrive/training/train_car_classifier.py).
 */
class Classifier(context: Context) : Closeable {
    private val env = OrtEnvironment.getEnvironment()
    private val labels: List<String>
    private val tokenizer: WordPiece
    private val session: OrtSession

    init {
        val assets = context.assets
        val meta = JSONObject(assets.open("labels.json").bufferedReader().use { it.readText() })
        val arr = meta.getJSONArray("labels")
        labels = List(arr.length()) { arr.getString(it) }
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

    override fun close() = session.close()

    fun classify(text: String): Understanding {
        val t0 = System.nanoTime()
        val ids = tokenizer.encode(text).map { it.toLong() }.toLongArray()
        val shape = longArrayOf(1, ids.size.toLong())
        OnnxTensor.createTensor(env, LongBuffer.wrap(ids), shape).use { input ->
            OnnxTensor.createTensor(env, LongBuffer.wrap(LongArray(ids.size) { 1 }), shape).use { mask ->
                session.run(mapOf("input_ids" to input, "attention_mask" to mask)).use { out ->
                    @Suppress("UNCHECKED_CAST")
                    val probs = (out[0].value as Array<FloatArray>)[0]
                    val negated = (out[1].value as FloatArray)[0]
                    val best = probs.indices.maxBy { probs[it] }
                    return Understanding(labels[best], probs[best], negated, (System.nanoTime() - t0) / 1_000_000)
                }
            }
        }
    }
}
