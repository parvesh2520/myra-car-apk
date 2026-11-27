package com.myra.car

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import java.io.Closeable
import java.io.FileInputStream
import java.nio.LongBuffer
import java.nio.channels.FileChannel
import kotlin.math.sqrt

/** Quantized all-MiniLM-L6-v2 sentence embeddings for matching shortcut meaning on the car. */
internal class ShortcutEncoder(context: Context, private val tokenizer: WordPiece) : Closeable {
    private val env = OrtEnvironment.getEnvironment()
    private val session = context.assets.openFd("shortcut_minilm.int8.onnx").use { asset ->
        FileInputStream(asset.fileDescriptor).use { model ->
            val bytes = model.channel.map(FileChannel.MapMode.READ_ONLY, asset.startOffset, asset.length)
            OrtSession.SessionOptions().use { options ->
                options.setIntraOpNumThreads(2)
                options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
                options.setCPUArenaAllocator(false)
                options.addConfigEntry("session.intra_op.allow_spinning", "0")
                env.createSession(bytes, options)
            }
        }
    }

    fun embed(phrase: String): FloatArray? {
        val ids = tokenizer.encode(phrase)
        val shape = longArrayOf(1, ids.size.toLong())
        fun tensor(values: LongArray) = OnnxTensor.createTensor(env, LongBuffer.wrap(values), shape)
        return tensor(LongArray(ids.size) { ids[it].toLong() }).use { tokens ->
            tensor(LongArray(ids.size) { 1L }).use { mask ->
                tensor(LongArray(ids.size)).use { types ->
                    session.run(mapOf("input_ids" to tokens, "attention_mask" to mask, "token_type_ids" to types)).use { out ->
                        val states = (out[0] as OnnxTensor).floatBuffer
                        val dimensions = states.remaining() / ids.size
                        val pooled = FloatArray(dimensions)
                        // Every token in this unpadded sequence participates in mean pooling. Unit normalization
                        // cancels the common division by sequence length.
                        repeat(ids.size) { for (i in pooled.indices) pooled[i] += states.get() }
                        val norm = sqrt(pooled.sumOf { it.toDouble() * it })
                        if (norm == 0.0 || !norm.isFinite()) null else {
                            for (i in pooled.indices) pooled[i] = (pooled[i] / norm).toFloat()
                            pooled
                        }
                    }
                }
            }
        }
    }

    override fun close() = session.close()
}
