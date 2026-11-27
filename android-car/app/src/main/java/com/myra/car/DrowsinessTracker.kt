package com.myra.car

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Driver drowsiness from per-frame face measurements: PERCLOS (share of time the eyes are closed), long eye
 * closures (micro-sleeps), blink rate and yawning. Port of web/src/services/drowsiness.ts (Myra UI); keep both in step.
 * Times are milliseconds on any steady clock (the phone's capture clock here).
 */
internal class DrowsinessTracker {
    enum class Level(val label: String) {
        ALERT("Alert"), TIRING("Signs of fatigue"), DROWSY("Drowsiness detected"), ASLEEP("Prolonged eye closure"),
        NO_FACE("Face out of view"),
    }

    data class Metrics(
        val level: Level,
        val alertness: Int, // 0–100 combined score
        val eyeOpenness: Int, // 0–100, right now
        val closedMs: Long, // how long the eyes have been closed
        val perclos: Int, // share of the last 30 s with eyes closed, 0–100
        val blinksPerMin: Int,
        val yawns: Int, // in the last 3 minutes
        val mouthOpen: Int,
    )

    private class Sample(val t: Long, val closed: Boolean)

    private val samples = ArrayDeque<Sample>()
    private var closedCount = 0
    private val blinks = ArrayDeque<Long>()
    private val yawnTimes = ArrayDeque<Long>()
    private var closedSince: Long? = null
    private var jawSince: Long? = null
    private var yawnCounted = false
    private var lastFace: Long? = null
    /** Running open-eye baseline, so people whose eyes look "half closed" to the model are not flagged. */
    private var baseline = 0.15f

    fun update(t: Long, face: Boolean, eyeClosed: Float, jawOpen: Float): Metrics {
        if (!face) {
            closedSince = null
            jawSince = null
            val seen = lastFace ?: t.also { lastFace = it } // never seen a face: count from the first frame
            val m = metrics(t, 0, 0f, 0f)
            return if (t - seen > NO_FACE_MS) m.copy(level = Level.NO_FACE) else m
        }
        lastFace = t

        // Eye closure, relative to this driver's own open-eye baseline.
        if (eyeClosed < 0.5f) baseline += (eyeClosed - baseline) * 0.02f
        val closed = eyeClosed > max(0.5f, baseline + 0.3f)
        if (closed) closedSince = closedSince ?: t
        else closedSince?.let {
            if (t - it < 500) blinks.addLast(t) // a normal blink is short
            closedSince = null
        }
        samples.addLast(Sample(t, closed))
        if (closed) closedCount++

        // Yawns: mouth wide open for over a second.
        if (jawOpen > 0.55f) {
            val since = jawSince ?: t.also { jawSince = it }
            if (!yawnCounted && t - since > YAWN_MIN_MS) {
                yawnTimes.addLast(t)
                yawnCounted = true
            }
        } else {
            jawSince = null
            yawnCounted = false
        }

        return metrics(t, closedSince?.let { t - it } ?: 0, 1 - eyeClosed, jawOpen)
    }

    private fun metrics(t: Long, closedMs: Long, openness: Float, jawOpen: Float): Metrics {
        while (samples.isNotEmpty() && t - samples.first().t > PERCLOS_WINDOW_MS) if (samples.removeFirst().closed) closedCount--
        while (blinks.isNotEmpty() && t - blinks.first() > BLINK_WINDOW_MS) blinks.removeFirst()
        while (yawnTimes.isNotEmpty() && t - yawnTimes.first() > YAWN_WINDOW_MS) yawnTimes.removeFirst()

        val perclos = if (samples.isEmpty()) 0f else closedCount.toFloat() / samples.size
        val yawns = yawnTimes.size
        val blinksPerMin = blinks.size
        var alertness = 100f - min(60f, perclos * 300) - min(30f, yawns * 12f) - (if (blinksPerMin > 30) 10 else 0)
        if (closedMs >= MICROSLEEP_MS) alertness = 0f
        val score = max(0, alertness.roundToInt())

        val level = when {
            closedMs >= MICROSLEEP_MS -> Level.ASLEEP
            score < DROWSY_BELOW -> Level.DROWSY
            score < 70 -> Level.TIRING
            else -> Level.ALERT
        }
        return Metrics(level, score, (openness.coerceIn(0f, 1f) * 100).roundToInt(), closedMs, (perclos * 100).roundToInt(),
            blinksPerMin, yawns, (jawOpen * 100).roundToInt())
    }

    companion object {
        /** Eyes closed at least this long count as a micro-sleep. */
        const val MICROSLEEP_MS = 1500L
        const val DROWSY_BELOW = 40
        private const val PERCLOS_WINDOW_MS = 30_000L
        private const val BLINK_WINDOW_MS = 60_000L
        private const val YAWN_WINDOW_MS = 180_000L
        private const val YAWN_MIN_MS = 1200L
        private const val NO_FACE_MS = 2000L
    }
}
