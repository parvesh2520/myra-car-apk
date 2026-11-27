package com.myra.car

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.PI
import kotlin.math.sin

/** A decoded, upright camera frame shared by the screen and the analysis; recycled once both let go. */
private class Shot(val bitmap: Bitmap, val t: Long) {
    private val refs = AtomicInteger(2)
    fun release() { if (refs.decrementAndGet() == 0) bitmap.recycle() }
}

/**
 * Drowsiness meter, native: the phone streams its front camera (~30 fps) and every received frame is shown.
 * Face analysis runs on its own thread on the newest frame each time it is free, so the video never waits for it;
 * on a head unit fast enough for 30 analyses a second, every frame is analysed. The tracker uses the phone's capture
 * times, so blink and closure durations stay right at any analysis rate.
 */
internal class MonitorView(context: Context) : LinearLayout(context) {
    val analysis = NativeFaceAnalysis(context.applicationContext)
    private val main = Handler(Looper.getMainLooper())
    private val prefs = context.getSharedPreferences("meter", Context.MODE_PRIVATE)

    private val host = field("Phone IP", 150, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI).apply { setText(prefs.getString("host", "")) }
    private val code = field("Camera code", 120, InputType.TYPE_CLASS_NUMBER)
    private val start = button("Start meter") { startMeter() }
    private val stop = button("Stop") { stopMeter("Meter stopped.") }
    private val status = label("Start Myra Phone Camera on the phone, then enter the IP and code shown there.", 14f, R.color.ink2)
    private val preview = FrameView(context)
    private val level = label("Meter off", 20f, R.color.accent).apply { setTypeface(typeface, android.graphics.Typeface.BOLD) }
    private val values = listOf("Alertness", "Eyes closed now", "Eyes closed over 30 s", "Blinks over 60 s", "Yawns over 3 min",
        "Video", "Face analysis").associateWith { label("—", 14f, R.color.ink) }

    private var session: Session? = null

    init {
        orientation = VERTICAL
        setBackgroundColor(context.getColor(R.color.bg))
        setPadding(dp(14), dp(10), dp(14), dp(10))
        addView(label("Drowsiness meter", 20f, R.color.ink).apply { setTypeface(typeface, android.graphics.Typeface.BOLD) })
        addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(host); addView(code); addView(start); addView(stop)
        })
        addView(status.apply { setPadding(0, dp(4), 0, dp(8)) })
        addView(LinearLayout(context).apply {
            addView(preview.apply { setBackgroundResource(R.drawable.panel) }, LayoutParams(0, -1, 3f))
            addView(LinearLayout(context).apply {
                orientation = VERTICAL
                setBackgroundResource(R.drawable.panel)
                setPadding(dp(12), dp(12), dp(12), dp(12))
                addView(level)
                for ((name, value) in values) addView(LinearLayout(context).apply {
                    setPadding(0, dp(5), 0, dp(5))
                    addView(label(name, 14f, R.color.ink2), LayoutParams(0, -2, 1f))
                    addView(value)
                })
            }, LayoutParams(0, -1, 2f).apply { marginStart = dp(12) })
        }, LayoutParams(-1, 0, 1f))
        stop.isEnabled = false
    }

    /** One connection to the phone: a receiver thread, an analysis thread and the readings they feed. */
    private inner class Session(val phone: PhoneEndpoint) {
        val running = AtomicBoolean(true)
        @Volatile var stream: PhoneStream? = null
        val toShow = AtomicReference<Shot?>()
        val toAnalyse = AtomicReference<Shot?>()
        private val wake = Object()
        val drawPosted = AtomicBoolean(false)
        var tracker = DrowsinessTracker()
        var lastBeep = 0L
        var received = 0; var analysed = 0; var analysisMs = 0L; var second = SystemClock.elapsedRealtime()

        fun start() {
            Thread(::receive, "meter-receive").apply { priority = Thread.MAX_PRIORITY }.start()
            Thread(::analyse, "meter-analysis").start()
        }

        fun close() {
            running.set(false)
            runCatching { stream?.close() }
            synchronized(wake) { wake.notifyAll() }
            toShow.getAndSet(null)?.release()
            toAnalyse.getAndSet(null)?.release()
        }

        private fun receive() = try { receiveLoop() } finally {
            // Frames handed over after close() would otherwise never be recycled.
            if (!running.get()) { toShow.getAndSet(null)?.release(); toAnalyse.getAndSet(null)?.release() }
        }

        private fun receiveLoop() {
            var failingSince = 0L
            while (running.get()) {
                try {
                    val s = PhoneStream(phone)
                    stream = s
                    if (!running.get()) { s.close(); break }
                    main.post { if (session === this) status.text = "Phone camera connected · analysis running on this head unit" }
                    failingSince = 0
                    while (running.get()) {
                        val frame = s.next()
                        val shot = decode(frame) ?: continue
                        failingSince = 0
                        toAnalyse.getAndSet(shot)?.release() // an older frame the analysis never got to
                        synchronized(wake) { wake.notifyAll() }
                        toShow.getAndSet(shot)?.release()
                        if (drawPosted.compareAndSet(false, true)) main.post(::draw)
                    }
                } catch (e: IllegalStateException) {
                    return fail(e.message ?: "Check the camera code on the phone.")
                } catch (e: IOException) {
                    if (!running.get()) break
                    val now = SystemClock.elapsedRealtime()
                    if (failingSince == 0L) failingSince = now
                    if (now - failingSince > 15_000) return fail(if (e is SocketTimeoutException)
                        "The phone camera timed out. Check that the car is connected to the phone hotspot or USB tethering."
                        else "Can't reach the phone camera. Check the Phone IP and keep Myra Phone Camera open.")
                    main.post { if (session === this) interrupted() }
                    Thread.sleep(450)
                } finally {
                    stream?.close()
                    stream = null
                }
            }
        }

        private fun decode(frame: CameraFrame): Shot? {
            val jpeg = BitmapFactory.decodeByteArray(frame.jpeg, 0, frame.jpeg.size) ?: return null
            val upright = if (frame.rotation == 0) jpeg else Bitmap.createBitmap(jpeg, 0, 0, jpeg.width, jpeg.height,
                Matrix().apply { postRotate(frame.rotation.toFloat()) }, false).also { jpeg.recycle() }
            return Shot(upright, frame.id)
        }

        private fun analyse() {
            while (running.get()) {
                val shot = toAnalyse.getAndSet(null) ?: run {
                    synchronized(wake) { if (running.get() && toAnalyse.get() == null) wake.wait(500) }
                    null
                } ?: continue
                val t0 = SystemClock.elapsedRealtime()
                val reading = try {
                    analysis.read(shot.bitmap)
                } catch (e: Throwable) {
                    if (e is VirtualMachineError) throw e
                    if (!running.get()) return
                    Log.e("MyraMonitor", "Face analysis failed on the car", e)
                    return fail("Camera connected. Face analysis failed on the car: ${e.javaClass.simpleName}: ${e.message.orEmpty().take(160)}")
                } finally {
                    shot.release()
                }
                val ms = SystemClock.elapsedRealtime() - t0
                main.post { if (session === this) onReading(shot.t, reading, ms) }
            }
        }

        private fun draw() {
            drawPosted.set(false)
            val shot = toShow.getAndSet(null) ?: return
            if (session !== this) return shot.release()
            preview.show(shot)
            received++
            tick()
        }

        fun onReading(t: Long, r: FaceReading, ms: Long) {
            analysed++
            analysisMs += ms
            val m = tracker.update(t, r.face, r.eyesClosed, r.jawOpen)
            showReadings(if (r.face) m else null, "Face out of view")
            val now = SystemClock.elapsedRealtime()
            val every = when (m.level) { DrowsinessTracker.Level.ASLEEP -> 450L; DrowsinessTracker.Level.DROWSY -> 4000L; else -> 0L }
            if (r.face && every > 0 && now - lastBeep >= every) {
                beep(if (m.level == DrowsinessTracker.Level.ASLEEP) 1050.0 else 660.0)
                lastBeep = now
            }
            tick()
        }

        private fun tick() {
            val now = SystemClock.elapsedRealtime()
            if (now - second < 1000) return
            val s = (now - second) / 1000.0
            values.getValue("Video").text = "%.0f fps".format(received / s)
            values.getValue("Face analysis").text = if (analysed == 0) "—" else "%.0f fps · %d ms".format(analysed / s, analysisMs / analysed)
            received = 0; analysed = 0; analysisMs = 0; second = now
        }

        /** The video stopped: readings from before the gap would be wrong after it. */
        fun interrupted() {
            tracker = DrowsinessTracker()
            analysis.reset()
            preview.show(null)
            status.text = "Waiting for the phone camera. Retrying…"
            showReadings(null, "Signal interrupted")
        }

        private fun fail(message: String) {
            main.post { if (session === this) stopMeter(message) }
        }
    }

    private fun startMeter() {
        if (session != null) return
        val phone = PhoneEndpoint.parse(host.text.toString(), code.text.toString())
            ?: run { status.text = "Enter the Phone IP and 8-digit code shown on the phone. Include the port if the phone shows one."; return }
        prefs.edit().putString("host", host.text.toString().trim()).apply()
        host.isEnabled = false; code.isEnabled = false; start.isEnabled = false; stop.isEnabled = true
        status.text = "Connecting to the phone camera…"
        showReadings(null, "Connecting")
        session = Session(phone).also { it.start() }
    }

    private fun stopMeter(message: String) {
        session?.close()
        session = null
        analysis.reset()
        preview.show(null)
        host.isEnabled = true; code.isEnabled = true; start.isEnabled = true; stop.isEnabled = false
        status.text = message
        showReadings(null, "Meter off")
        values.getValue("Video").text = "—"
        values.getValue("Face analysis").text = "—"
    }

    private fun showReadings(m: DrowsinessTracker.Metrics?, message: String) {
        level.text = m?.level?.label ?: message
        level.setTextColor(when (m?.level) {
            DrowsinessTracker.Level.ASLEEP, DrowsinessTracker.Level.DROWSY -> 0xffffad99.toInt()
            DrowsinessTracker.Level.TIRING, DrowsinessTracker.Level.NO_FACE -> 0xffffdb93.toInt()
            else -> context.getColor(R.color.accent)
        })
        val shown = m?.let { listOf("${it.alertness}%", "%.1f s".format(it.closedMs / 1000.0), "${it.perclos}%", "${it.blinksPerMin}", "${it.yawns}") }
        values.values.take(5).forEachIndexed { i, v -> v.text = shown?.get(i) ?: "—" }
    }

    private fun beep(hz: Double) = Thread({
        val rate = 22050
        val pcm = ShortArray(rate * 22 / 100) { (sin(2 * PI * hz * it / rate) * 0.3 * Short.MAX_VALUE).toInt().toShort() }
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(pcm.size * 2).setTransferMode(AudioTrack.MODE_STATIC).build()
        try {
            track.write(pcm, 0, pcm.size)
            track.play()
            Thread.sleep(260)
        } catch (_: Exception) { // visual alerts are still shown
        } finally {
            track.release()
        }
    }, "meter-beep").start()

    fun destroy() {
        session?.close()
        session = null
        preview.show(null)
    }

    private fun field(hint: String, widthDp: Int, type: Int) = EditText(context).apply {
        this.hint = hint
        inputType = type
        setSingleLine()
        setTextColor(context.getColor(R.color.ink))
        setHintTextColor(context.getColor(R.color.ink3))
        layoutParams = LayoutParams(dp(widthDp), -2).apply { marginEnd = dp(8) }
    }

    private fun button(text: String, onClick: () -> Unit) = Button(context).apply {
        this.text = text
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    private fun label(text: String, size: Float, color: Int) = TextView(context).apply {
        this.text = text; textSize = size; setTextColor(context.getColor(color))
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}

/** Draws the newest frame, fitted and centred. Holds one [Shot] and releases it when the next arrives. */
private class FrameView(context: Context) : View(context) {
    private var shot: Shot? = null
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val dst = RectF()

    fun show(next: Shot?) {
        shot?.release()
        shot = next
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val b = shot?.bitmap ?: return
        val k = minOf(width.toFloat() / b.width, height.toFloat() / b.height)
        val w = b.width * k; val h = b.height * k
        dst.set((width - w) / 2, (height - h) / 2, (width + w) / 2, (height + h) / 2)
        canvas.drawBitmap(b, null, dst, paint)
    }
}
