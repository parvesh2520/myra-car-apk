package com.myra.car

import kotlin.math.hypot

internal data class ExitBox(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val centerX get() = (left + right) * 0.5f
    val centerY get() = (top + bottom) * 0.5f
    val area get() = (right - left).coerceAtLeast(0f) * (bottom - top).coerceAtLeast(0f)

    fun intersection(other: ExitBox): Float =
        (minOf(right, other.right) - maxOf(left, other.left)).coerceAtLeast(0f) *
            (minOf(bottom, other.bottom) - maxOf(top, other.top)).coerceAtLeast(0f)

    fun offset(x: Float, y: Float) = ExitBox(left + x, top + y, right + x, bottom + y)

    fun blend(other: ExitBox, alpha: Float) = ExitBox(
        left + (other.left - left) * alpha, top + (other.top - top) * alpha,
        right + (other.right - right) * alpha, bottom + (other.bottom - bottom) * alpha,
    )
}

internal enum class DoorSide(val zone: ExitBox) {
    LEFT(ExitBox(.06f, .18f, .44f, .84f)),
    RIGHT(ExitBox(.56f, .18f, .94f, .84f)),
}

internal data class ExitDetection(val label: String, val confidence: Float, val box: ExitBox)

internal data class ExitReading(
    val objects: List<ExitDetection>,
    val candidate: ExitDetection?,
    val approaching: Boolean,
    val alert: Boolean,
)

/** The COE image-space zone and confirmation, with occupancy and short image-space projection. */
internal class SafeExitTracker(private val zone: ExitBox) {
    private class Track(var detection: ExitDetection, var time: Long) {
        var dx = 0f
        var dy = 0f
        var expansion = 0f
        var hits = 0
        var riskFrames = 0

        fun update(next: ExitDetection, now: Long) {
            val old = detection.box
            val dt = ((now - time) / 1000f).coerceAtLeast(.016f)
            val box = old.blend(next.box, .45f)
            dx += .38f * ((box.centerX - old.centerX) / dt - dx)
            dy += .38f * ((box.centerY - old.centerY) / dt - dy)
            expansion += .4f * ((box.area - old.area) / old.area.coerceAtLeast(.0001f) / dt - expansion)
            detection = next.copy(box = box)
            time = now
            hits++
        }
    }

    private val tracks = mutableListOf<Track>()
    private var lastAlert: Long? = null

    fun update(now: Long, detections: List<ExitDetection>): ExitReading {
        tracks.removeAll { now <= it.time || now - it.time > TRACK_GAP_MS }
        val unmatched = tracks.toMutableList()
        var candidate: ExitDetection? = null
        var approaching = false
        val observed = detections.sortedByDescending { it.confidence }.map { detection ->
            val track = unmatched.mapNotNull { old ->
                if (old.detection.label != detection.label) return@mapNotNull null
                val elapsed = (now - old.time) / 1000f
                val predicted = old.detection.box.offset(old.dx * elapsed, old.dy * elapsed)
                val overlap = predicted.intersection(detection.box)
                val iou = overlap / (predicted.area + detection.box.area - overlap).coerceAtLeast(.0001f)
                val distance = hypot(predicted.centerX - detection.box.centerX, predicted.centerY - detection.box.centerY)
                if (iou < .03f && distance > .16f) null else old to (iou - distance)
            }.maxByOrNull { it.second }?.first
            val current = if (track == null) Track(detection, now).also { tracks += it } else track.also {
                unmatched.remove(it)
                it.update(detection, now)
            }
            val box = current.detection.box
            val occupied = overlap(box) >= MIN_OVERLAP
            val near = current.hits >= 2 && projectsIntoZone(current)
            val risk = detection.confidence >= MIN_CONFIDENCE && (occupied || near)
            current.riskFrames = if (risk) current.riskFrames + 1 else 0
            if (current.riskFrames >= CONFIRMATION_FRAMES && candidate == null) {
                candidate = current.detection
                approaching = near && !occupied
            }
            current.detection
        }
        // An occluded or missing observation breaks the risk confirmation sequence.
        unmatched.forEach { it.riskFrames = 0 }
        val alert = candidate != null && (lastAlert?.let { now - it >= ALERT_COOLDOWN_MS } ?: true)
        if (alert) lastAlert = now
        return ExitReading(observed, candidate, approaching, alert)
    }

    private fun overlap(box: ExitBox) = box.intersection(zone) / box.area.coerceAtLeast(.0001f)

    private fun projectsIntoZone(track: Track): Boolean {
        val box = track.detection.box
        val toward = track.dx * (zone.centerX - box.centerX) + track.dy * (zone.centerY - box.centerY)
        if (toward <= 0f || hypot(track.dx, track.dy) < .025f) return false
        for (i in 1..3) {
            val dt = i * .5f // up to 1.5 s ahead: the time to the next photos
            val scale = (1f + track.expansion * dt * .5f).coerceIn(.8f, 1.4f)
            val w = (box.right - box.left) * scale / 2f
            val h = (box.bottom - box.top) * scale / 2f
            val x = box.centerX + track.dx * dt
            val y = box.centerY + track.dy * dt
            if (overlap(ExitBox(x - w, y - h, x + w, y + h)) >= MIN_OVERLAP) return true
        }
        return false
    }

    private companion object {
        const val MIN_CONFIDENCE = .55f
        const val MIN_OVERLAP = .12f
        const val CONFIRMATION_FRAMES = 2 // two photos in a row, about a second apart
        const val TRACK_GAP_MS = 5_000L
        const val ALERT_COOLDOWN_MS = 6_000L
    }
}
