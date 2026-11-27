package com.myra.car

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Matrix
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel

/** Quantized SSD MobileNet v1, with bounding-box decoding and NMS in the bundled TensorFlow Lite graph. */
internal class NativeExitAnalysis(private val context: Context) : Closeable {
    private var interpreter: Interpreter? = null
    private val image = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
    private val canvas = Canvas(image)
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val crop = Matrix()
    private val pixels = IntArray(SIZE * SIZE)
    private val input = ByteBuffer.allocateDirect(SIZE * SIZE * 3).order(ByteOrder.nativeOrder())
    private val rgb = ByteArray(SIZE * SIZE * 3)
    private val boxes = Array(1) { Array(MAX_DETECTIONS) { FloatArray(4) } }
    private val classes = Array(1) { FloatArray(MAX_DETECTIONS) }
    private val scores = Array(1) { FloatArray(MAX_DETECTIONS) }
    private val count = FloatArray(1)
    private val outputs = mapOf<Int, Any>(0 to boxes, 1 to classes, 2 to scores, 3 to count)
    private val inputs = arrayOf<Any>(input)

    fun read(frame: CameraImage): List<ExitDetection> {
        val model = interpreter ?: load().also { interpreter = it }
        val scale = SIZE.toFloat() / maxOf(frame.width, frame.height)
        val width = frame.width * scale
        val height = frame.height * scale
        val x = (SIZE - width) * .5f
        val y = (SIZE - height) * .5f
        canvas.drawColor(Color.BLACK)
        canvas.drawBitmap(frame.bitmap, crop.apply {
            setScale(scale, scale)
            postTranslate(x, y)
            preConcat(frame.upright)
        }, paint)
        image.getPixels(pixels, 0, SIZE, 0, 0, SIZE, SIZE)
        var index = 0
        for (p in pixels) {
            rgb[index++] = (p shr 16).toByte()
            rgb[index++] = (p shr 8).toByte()
            rgb[index++] = p.toByte()
        }
        input.clear()
        input.put(rgb)
        input.rewind()
        model.runForMultipleInputsOutputs(inputs, outputs)

        return buildList {
            for (i in 0 until count[0].toInt().coerceIn(0, MAX_DETECTIONS)) {
                val confidence = scores[0][i]
                if (!confidence.isFinite() || confidence < .3f) continue
                val label = LABELS[classes[0][i].toInt()] ?: continue
                val b = boxes[0][i]
                val box = ExitBox(
                    ((b[1] * SIZE - x) / width).coerceIn(0f, 1f),
                    ((b[0] * SIZE - y) / height).coerceIn(0f, 1f),
                    ((b[3] * SIZE - x) / width).coerceIn(0f, 1f),
                    ((b[2] * SIZE - y) / height).coerceIn(0f, 1f),
                )
                if (box.area > 0f) add(ExitDetection(label, confidence, box))
            }
        }
    }

    private fun load(): Interpreter {
        val data = context.assets.openFd("safe_exit_ssd_mobilenet.tflite").use { asset ->
            FileInputStream(asset.fileDescriptor).use { file ->
                file.channel.map(FileChannel.MapMode.READ_ONLY, asset.startOffset, asset.length)
            }
        }
        val model = Interpreter(data, Interpreter.Options().setNumThreads(3).setUseXNNPACK(true))
        try {
            val tensor = model.getInputTensor(0)
            check(tensor.shape().contentEquals(intArrayOf(1, SIZE, SIZE, 3)) && tensor.dataType() == DataType.UINT8)
            return model
        } catch (error: Exception) {
            model.close()
            throw error
        }
    }

    override fun close() {
        interpreter?.close()
        interpreter = null
        image.recycle()
    }

    private companion object {
        const val SIZE = 300
        const val MAX_DETECTIONS = 10
        // The bundled COCO label map includes blanks at unused IDs.
        val LABELS = mapOf(0 to "Person", 1 to "Bicycle", 2 to "Car", 3 to "Motorcycle", 5 to "Bus", 7 to "Truck")
    }
}
