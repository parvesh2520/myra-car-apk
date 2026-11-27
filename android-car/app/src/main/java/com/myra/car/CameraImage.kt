package com.myra.car

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.RectF

/** Upright coordinates without allocating a second, rotated bitmap for every camera frame. */
internal class CameraImage(val bitmap: Bitmap, rotation: Int) {
    val width = if (rotation % 180 == 0) bitmap.width else bitmap.height
    val height = if (rotation % 180 == 0) bitmap.height else bitmap.width
    val upright = Matrix().apply {
        if (rotation != 0) {
            val bounds = RectF(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat())
            setRotate(rotation.toFloat())
            mapRect(bounds)
            postTranslate(-bounds.left, -bounds.top)
        }
    }
}
