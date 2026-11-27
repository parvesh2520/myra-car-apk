package com.myra.car

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtProvider
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import java.io.Closeable
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.channels.FileChannel
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sin

/** One analysed frame: whether a face was found, its eye-blink score (mean of both eyes) and jaw-open score, 0–1. */
internal data class FaceReading(val face: Boolean, val eyesClosed: Float, val jawOpen: Float)

/**
 * Face analysis on the head unit with ONNX Runtime (the runtime Myra AI already uses on this car), running
 * Google's MediaPipe Face Landmarker models converted to ONNX: BlazeFace detection, the 478-point face mesh and
 * the blendshape model. Pre- and post-processing follow MediaPipe's face landmarker graph. Like MediaPipe's
 * video mode, the face is detected once and then tracked from the previous frame's landmarks.
 */
internal class NativeFaceAnalysis(private val context: Context) : Closeable {
    private class Models(val detector: OrtSession, val landmarks: OrtSession, val blendshapes: OrtSession)
    /** A rotated square or rectangle in upright-image pixels. */
    private class Roi(val cx: Float, val cy: Float, val w: Float, val h: Float, val rotation: Float)

    private val env = OrtEnvironment.getEnvironment()
    private var models: Models? = null
    private var closed = false
    private var tracked: Roi? = null
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val facePoints = FloatArray(LANDMARKS * 2)
    private val blendData = directFloats(BLENDSHAPE_POINTS.size * 2)
    private var blendTensor: OnnxTensor? = null

    /** Per input size, reused every frame (the meter runs ~30 frames a second): crop bitmap, pixels, tensor data. */
    private class Scratch(env: OrtEnvironment, size: Int) {
        val crop: Bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(crop)
        val pixels = IntArray(size * size)
        val data = directFloats(size * size * 3)
        val rgb = FloatArray(size * size * 3)
        val tensor = OnnxTensor.createTensor(env, data, longArrayOf(1, size.toLong(), size.toLong(), 3))
        val matrix = Matrix()
    }
    private val scratch = HashMap<Int, Scratch>()

    /** Analyses one upright frame. The bitmap is only read. */
    @Synchronized
    fun read(image: CameraImage): FaceReading {
        check(!closed)
        val m = models ?: load().also { models = it }
        val face = tracked?.let { landmarks(m, image, it) } ?: detect(m, image)?.let { landmarks(m, image, it) }
        if (face == null) {
            tracked = null
            return FaceReading(false, 0f, 0f)
        }
        tracked = roiFromLandmarks(face)
        val shapes = blendshapes(m, face)
        return FaceReading(true, (shapes[EYE_BLINK_LEFT] + shapes[EYE_BLINK_RIGHT]) / 2f, shapes[JAW_OPEN])
    }

    /** Forget the tracked face, e.g. after the video was interrupted. */
    @Synchronized
    fun reset() { tracked = null }

    private fun load(): Models {
        fun session(name: String): OrtSession {
            val model = context.assets.openFd(name).use { asset ->
                FileInputStream(asset.fileDescriptor).use { file ->
                    file.channel.map(FileChannel.MapMode.READ_ONLY, asset.startOffset, asset.length)
                }
            }
            fun create(accelerated: Boolean) = OrtSession.SessionOptions().use { opts ->
                opts.setIntraOpNumThreads(if (accelerated) 1 else 2)
                opts.addConfigEntry("session.intra_op.allow_spinning", "0")
                if (accelerated) opts.addXnnpack(mapOf("intra_op_num_threads" to "2"))
                env.createSession(model, opts)
            }
            if (OrtProvider.XNNPACK in OrtEnvironment.getAvailableProviders()) {
                runCatching { create(true) }.getOrNull()?.let { return it }
            }
            return create(false)
        }
        val detector = session("face_detector.onnx")
        try {
            val landmarks = session("face_landmarks_detector.onnx")
            try {
                return Models(detector, landmarks, session("face_blendshapes.onnx"))
            } catch (error: Throwable) {
                landmarks.close()
                throw error
            }
        } catch (e: Throwable) {
            detector.close()
            throw e
        }
    }

    /** BlazeFace (short range): the best face over 0.5, as the landmark model's region of interest. */
    private fun detect(m: Models, image: CameraImage): Roi? {
        val side = max(image.width, image.height).toFloat()
        val input = tensor(image, Roi(image.width / 2f, image.height / 2f, side, side, 0f), DETECTOR_SIZE, DETECTOR_COLORS)
        val (regressors, scores) = m.detector.run(mapOf(m.detector.inputNames.first() to input)).use { out ->
            (out[0] as OnnxTensor).floatBuffer to (out[1] as OnnxTensor).floatBuffer
        }
        var best = 0
        for (i in 1 until scores.limit()) if (scores.get(i) > scores.get(best)) best = i
        if (sigmoid(scores.get(best).coerceIn(-100f, 100f)) < MIN_SCORE) return null
        fun r(index: Int) = regressors.get(best * 16 + index)
        val ax = ANCHORS[2 * best]
        val ay = ANCHORS[2 * best + 1]
        // Letterboxed 128x128 coordinates back to image pixels.
        fun px(u: Float) = image.width / 2f + (u - 0.5f) * side
        fun py(v: Float) = image.height / 2f + (v - 0.5f) * side
        val eye0x = px(r(4) / DETECTOR_SIZE + ax)
        val eye0y = py(r(5) / DETECTOR_SIZE + ay)
        val eye1x = px(r(6) / DETECTOR_SIZE + ax)
        val eye1y = py(r(7) / DETECTOR_SIZE + ay)
        return Roi(px(r(0) / DETECTOR_SIZE + ax), py(r(1) / DETECTOR_SIZE + ay), r(2) / DETECTOR_SIZE * side * 1.5f,
            r(3) / DETECTOR_SIZE * side * 1.5f, -atan2(-(eye1y - eye0y), eye1x - eye0x))
    }

    /** The 478 face-mesh points in image pixels (x0, y0, x1, ...), or null when the model sees no face. */
    private fun landmarks(m: Models, image: CameraImage, roi: Roi): FloatArray? {
        val input = tensor(image, roi, LANDMARK_SIZE, LANDMARK_COLORS)
        val points = m.landmarks.run(mapOf(m.landmarks.inputNames.first() to input)).use { out ->
            if (sigmoid((out[1] as OnnxTensor).floatBuffer.get(0)) < MIN_SCORE) return null
            (out[0] as OnnxTensor).floatBuffer
        }
        val c = cos(roi.rotation)
        val s = sin(roi.rotation)
        for (i in 0 until LANDMARKS) {
            val x = (points.get(i * 3) / LANDMARK_SIZE - 0.5f) * roi.w
            val y = (points.get(i * 3 + 1) / LANDMARK_SIZE - 0.5f) * roi.h
            facePoints[i * 2] = roi.cx + c * x - s * y
            facePoints[i * 2 + 1] = roi.cy + s * x + c * y
        }
        return facePoints
    }

    private fun blendshapes(m: Models, face: FloatArray): FloatArray {
        val input = blendTensor ?: OnnxTensor.createTensor(env, blendData, longArrayOf(1, BLENDSHAPE_POINTS.size.toLong(), 2))
            .also { blendTensor = it }
        blendData.clear()
        BLENDSHAPE_POINTS.forEach { p ->
            blendData.put(face[2 * p])
            blendData.put(face[2 * p + 1])
        }
        blendData.rewind()
        return m.blendshapes.run(mapOf(m.blendshapes.inputNames.first() to input)).use { out -> out[0].value as FloatArray }
    }

    /** Next frame's region: the face rotated upright by its eye line (points 33 and 263), squared and scaled 1.5x. */
    private fun roiFromLandmarks(face: FloatArray): Roi {
        val rotation = -atan2(-(face[2 * 263 + 1] - face[2 * 33 + 1]), face[2 * 263] - face[2 * 33])
        val c = cos(rotation)
        val s = sin(rotation)
        var minU = Float.MAX_VALUE; var maxU = -Float.MAX_VALUE; var minV = Float.MAX_VALUE; var maxV = -Float.MAX_VALUE
        for (i in 0 until LANDMARKS) {
            val x = face[2 * i]
            val y = face[2 * i + 1]
            val u = c * x + s * y // into the face's upright frame
            val v = -s * x + c * y
            minU = minOf(minU, u); maxU = maxOf(maxU, u); minV = minOf(minV, v); maxV = maxOf(maxV, v)
        }
        val u = (minU + maxU) / 2
        val v = (minV + maxV) / 2
        val side = max(maxU - minU, maxV - minV) * 1.5f
        return Roi(c * u - s * v, s * u + c * v, side, side, rotation)
    }

    /** The region [roi] resampled to normalized RGB, NHWC (MediaPipe's ImageToTensor). */
    private fun tensor(image: CameraImage, roi: Roi, size: Int, colors: FloatArray): OnnxTensor {
        val s = scratch.getOrPut(size) { Scratch(env, size) }
        s.crop.eraseColor(0)
        s.canvas.drawBitmap(image.bitmap, s.matrix.apply {
            setTranslate(-roi.cx, -roi.cy)
            postRotate(Math.toDegrees(-roi.rotation.toDouble()).toFloat())
            postScale(size / roi.w, size / roi.h)
            postTranslate(size / 2f, size / 2f)
            preConcat(image.upright)
        }, paint)
        val pixels = s.pixels
        s.crop.getPixels(pixels, 0, size, 0, 0, size, size)
        var index = 0
        for (p in pixels) {
            s.rgb[index++] = colors[(p shr 16) and 0xff]
            s.rgb[index++] = colors[(p shr 8) and 0xff]
            s.rgb[index++] = colors[p and 0xff]
        }
        s.data.clear()
        s.data.put(s.rgb).rewind()
        return s.tensor
    }

    @Synchronized
    override fun close() {
        closed = true
        models?.run { detector.close(); landmarks.close(); blendshapes.close() }
        models = null
        blendTensor?.close()
        blendTensor = null
        scratch.values.forEach { it.tensor.close(); it.crop.recycle() }
        scratch.clear()
    }

    companion object {
        private const val DETECTOR_SIZE = 128
        private const val LANDMARK_SIZE = 256
        private const val LANDMARKS = 478
        private const val MIN_SCORE = 0.5f
        private const val EYE_BLINK_LEFT = 9
        private const val EYE_BLINK_RIGHT = 10
        private const val JAW_OPEN = 25
        private val DETECTOR_COLORS = FloatArray(256) { it * (2f / 255f) - 1f }
        private val LANDMARK_COLORS = FloatArray(256) { it * (1f / 255f) }

        private fun directFloats(size: Int): FloatBuffer =
            ByteBuffer.allocateDirect(size * Float.SIZE_BYTES).order(ByteOrder.nativeOrder()).asFloatBuffer()

        private fun sigmoid(x: Float) = 1f / (1f + exp(-x))

        /** SSD anchors of the short-range BlazeFace: 16x16 cells x 2, then 8x8 cells x 6, centres only. */
        private val ANCHORS = FloatArray(896 * 2).also { a ->
            var i = 0
            for ((cells, perCell) in listOf(16 to 2, 8 to 6)) {
                for (y in 0 until cells) for (x in 0 until cells) repeat(perCell) {
                    a[i++] = (x + 0.5f) / cells
                    a[i++] = (y + 0.5f) / cells
                }
            }
        }

        /** The 146 face-mesh points the blendshape model reads (MediaPipe face_blendshapes_graph.cc). */
        private val BLENDSHAPE_POINTS = intArrayOf(
            0, 1, 4, 5, 6, 7, 8, 10, 13, 14, 17, 21, 33, 37, 39, 40, 46, 52, 53, 54, 55, 58, 61, 63, 65, 66, 67, 70, 78, 80,
            81, 82, 84, 87, 88, 91, 93, 95, 103, 105, 107, 109, 127, 132, 133, 136, 144, 145, 146, 148, 149, 150, 152, 153,
            154, 155, 157, 158, 159, 160, 161, 162, 163, 168, 172, 173, 176, 178, 181, 185, 191, 195, 197, 234, 246, 249,
            251, 263, 267, 269, 270, 276, 282, 283, 284, 285, 288, 291, 293, 295, 296, 297, 300, 308, 310, 311, 312, 314,
            317, 318, 321, 323, 324, 332, 334, 336, 338, 356, 361, 362, 365, 373, 374, 375, 377, 378, 379, 380, 381, 382,
            384, 385, 386, 387, 388, 389, 390, 397, 398, 400, 402, 405, 409, 415, 454, 466, 468, 469, 470, 471, 472, 473,
            474, 475, 476, 477,
        )
    }
}
