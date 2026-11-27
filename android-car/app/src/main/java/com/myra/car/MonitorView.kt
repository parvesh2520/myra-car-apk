package com.myra.car

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.net.ConnectivityManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import java.io.IOException
import java.io.EOFException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean

internal enum class MonitorMode(val title: String, val camera: String, val analysis: String) {
    DROWSINESS("Drowsiness meter", "front", "Face analysis"),
    SAFE_EXIT("Safe Exit", "rear", "Object analysis"),
}

internal class CameraPairing(var code: String = "")

internal class MonitorView(context: Context, private val mode: MonitorMode, private val pairing: CameraPairing) : LinearLayout(context) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val prefs = context.getSharedPreferences("meter", Context.MODE_PRIVATE)

    private val host = field("Phone IP", 150, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI).apply {
        setText(prefs.getString("host", ""))
    }
    private val code = field("Camera code", 140, InputType.TYPE_CLASS_NUMBER).apply { setText(pairing.code) }
    private val start = button("Start", primary = true) { startMonitor() }
    private val stop = button("Stop") { stopMonitor("Camera stopped.") }
    private val status = label("Share the ${mode.camera} camera on your phone, then enter its IP and camera code.", 14f, R.color.ink2)
    private val preview = FrameView(context)
    private val side = Spinner(context, Spinner.MODE_DIALOG).apply {
        prompt = "Door zone in the camera view"
        adapter = ArrayAdapter(context, android.R.layout.simple_spinner_item, listOf("Left door zone", "Right door zone")).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        setSelection(prefs.getInt("doorSide", DoorSide.RIGHT.ordinal).coerceIn(DoorSide.entries.indices))
        minimumHeight = dp(40)
    }
    private val level = label("Camera off", 20f, R.color.accent).apply { setTypeface(typeface, android.graphics.Typeface.BOLD) }
    private val details = (if (mode == MonitorMode.DROWSINESS) listOf(
        "Alertness score", "Eyes closed now", "Eyes closed over 30 s",
    ) else listOf("Objects detected")).associateWith { label("—", 14f, R.color.ink) }
    private var session: Session? = null
    private var tone: ToneGenerator? = null

    init {
        orientation = VERTICAL
        setBackgroundColor(context.getColor(R.color.bg))
        setPadding(dp(4), dp(8), dp(16), dp(16))
        addView(label(mode.title, 22f, R.color.ink).apply { typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL) })
        addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, 0)
            addView(host)
            addView(code)
            addView(start)
            addView(stop)
        })
        addView(status.apply { setPadding(0, dp(4), 0, dp(8)) })
        addView(LinearLayout(context).apply {
            addView(preview.apply { setBackgroundResource(R.drawable.panel) }, LayoutParams(0, -1, 3f))
            addView(ScrollView(context).apply {
                setBackgroundResource(R.drawable.panel)
                addView(LinearLayout(context).apply {
                    orientation = VERTICAL
                    setPadding(dp(12), dp(12), dp(12), dp(12))
                    addView(level)
                    addView(label("Parked demonstration", 12f, R.color.ink2))
                    if (mode == MonitorMode.SAFE_EXIT) {
                        addView(side, LayoutParams(-1, -2))
                        addView(label("Check your surroundings before opening.", 12f, R.color.ink2))
                    }
                    for ((name, value) in details) addView(metric(name, value))
                }, -1, -2)
            }, LayoutParams(0, -1, 2f).apply { marginStart = dp(12) })
        }, LayoutParams(-1, 0, 1f))
        if (mode == MonitorMode.SAFE_EXIT) preview.overlay(DoorSide.entries[side.selectedItemPosition].zone, null)
        stop.isEnabled = false
    }

    private data class Reading(
        val drowsiness: DrowsinessTracker.Metrics? = null,
        val exit: ExitReading? = null,
        val facePresent: Boolean = false,
    )

    private class AnalysisError(cause: Exception) : RuntimeException(cause)

    private inner class Session(val phone: PhoneEndpoint, val door: DoorSide) {
        private val running = AtomicBoolean(true)
        @Volatile private var stream: PhoneStream? = null

        fun start() = worker.execute(::run) // one session's models at a time on the head unit's small memory

        fun close() {
            running.set(false)
            runCatching { stream?.close() }
        }

        /** Ask the phone for one photo, analyze it, show it, wait out the rest of [SNAPSHOT_MS], repeat. */
        private fun run() {
            var face: NativeFaceAnalysis? = null
            var objects: NativeExitAnalysis? = null
            var failingSince = 0L
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
            try {
                while (running.get()) {
                    var paired = false
                    var firstPhoto = true
                    try {
                        val preferred = runCatching { cameraNetwork(connectivity, phone) }.getOrNull()
                        val connection = if (preferred == null) PhoneStream(phone) else try {
                            PhoneStream(phone, preferred)
                        } catch (error: IOException) {
                            if (!running.get()) throw error
                            PhoneStream(phone)
                        }
                        stream = connection
                        if (!running.get()) break
                        paired = true
                        // A new connection may come from a restarted phone clock, so tracking starts over.
                        val drowsiness = DrowsinessTracker()
                        val safeExit = SafeExitTracker(door.zone)
                        var lastBeep: Long? = null
                        if (failingSince == 0L) post { status.text = "Phone paired. Waiting for the first ${mode.camera} camera photo…" }
                        while (running.get()) {
                            val asked = SystemClock.elapsedRealtime()
                            val frame = connection.next()
                            val bitmap = BitmapFactory.decodeByteArray(frame.jpeg, 0, frame.jpeg.size)
                                ?: throw IOException("The phone sent an unreadable photo.")
                            val image = CameraImage(bitmap, frame.rotation)
                            failingSince = 0
                            val reading = try {
                                if (mode == MonitorMode.DROWSINESS) {
                                    val analysis = face ?: NativeFaceAnalysis(context.applicationContext).also { face = it }
                                    val result = analysis.read(image)
                                    Reading(drowsiness.update(frame.id, result.face, result.eyesClosed, result.jawOpen), facePresent = result.face)
                                } else {
                                    val detector = objects ?: NativeExitAnalysis(context.applicationContext).also { objects = it }
                                    Reading(exit = safeExit.update(frame.id, detector.read(image)))
                                }
                            } catch (e: Exception) {
                                bitmap.recycle()
                                throw AnalysisError(e)
                            }
                            val interval = when (reading.drowsiness?.level) {
                                DrowsinessTracker.Level.ASLEEP -> 1L // every photo
                                DrowsinessTracker.Level.DROWSY -> 4_000L
                                else -> 0L
                            }
                            val fatigueAlert = reading.facePresent && interval > 0 && (lastBeep?.let { frame.id - it >= interval } ?: true)
                            if (fatigueAlert) lastBeep = frame.id
                            val beepNow = fatigueAlert || reading.exit?.alert == true
                            val first = firstPhoto
                            firstPhoto = false
                            val queued = post {
                                if (first) status.text = "Phone camera connected · the car analyzes one photo at a time"
                                preview.show(image)
                                reading.drowsiness?.let { if (reading.facePresent) showDrowsiness(it) else showState("Face out of view") }
                                reading.exit?.let { showExit(it); preview.overlay(door.zone, it) }
                                if (beepNow) beep(reading.drowsiness?.level == DrowsinessTracker.Level.ASLEEP || reading.exit != null)
                            }
                            if (!queued) bitmap.recycle()
                            val wait = SNAPSHOT_MS - (SystemClock.elapsedRealtime() - asked)
                            if (wait > 0 && running.get()) Thread.sleep(wait)
                        }
                    } catch (e: IllegalStateException) {
                        fail(e.message ?: "Check the camera code.")
                        return
                    } catch (error: IOException) {
                        if (!running.get()) break
                        val now = SystemClock.elapsedRealtime()
                        if (failingSince == 0L) failingSince = now
                        val problem = when {
                            paired && error is EOFException -> "The phone stopped sharing. Reopen Myra Phone Camera and check its code."
                            paired && firstPhoto -> "Phone paired, but no photo arrived. Keep the camera preview open and check the connection."
                            paired -> "Phone paired, but photos stopped. Keep the camera preview open and check the connection."
                            error is NoRouteToHostException -> "No route to the phone. Connect the car to the phone's hotspot or USB tethering."
                            error is ConnectException -> "Phone refused the connection. Start sharing and check the IP and port shown."
                            error is SocketTimeoutException -> "Phone did not answer. Check that the car is on the phone's hotspot or USB tethering and verify the IP."
                            else -> error.message ?: "Can't reach the phone camera."
                        }
                        if (now - failingSince > 6_000) {
                            fail(problem)
                            return
                        }
                        post {
                            status.text = "$problem Retrying…"
                            showState("Signal interrupted")
                            preview.show(null)
                        }
                        Thread.sleep(450)
                    } finally {
                        runCatching { stream?.close() }
                        stream = null
                    }
                }
            } catch (e: InterruptedException) {
            } catch (e: Throwable) {
                if (e is VirtualMachineError) throw e
                val cause = (e as? AnalysisError)?.cause ?: e
                Log.e("MyraCameraAnalysis", "${mode.analysis} failed", cause)
                fail("${mode.analysis} unavailable: ${cause.message.orEmpty().take(150).ifBlank { cause.javaClass.simpleName }}")
            } finally {
                face?.close()
                objects?.close()
            }
        }

        /** Runs [block] on the main thread while this session is still showing; false if it could not be queued. */
        private fun post(block: () -> Unit) = main.post { if (session === this) block() }

        private fun fail(message: String) {
            main.post { if (session === this) stopMonitor(message) }
        }
    }

    private fun startMonitor() {
        if (session != null) return
        val phone = PhoneEndpoint.parse(host.text.toString(), code.text.toString()) ?: run {
            status.text = "Enter the Phone IP and 8-digit code shown on the phone. Include the port if shown."
            return
        }
        pairing.code = code.text.toString().trim()
        val door = DoorSide.entries[side.selectedItemPosition]
        prefs.edit().putString("host", host.text.toString().trim()).putInt("doorSide", door.ordinal).apply()
        host.isEnabled = false
        code.isEnabled = false
        start.isEnabled = false
        stop.isEnabled = true
        side.isEnabled = false
        status.text = "Connecting to the phone camera…"
        showState("Connecting")
        session = Session(phone, door).also { it.start() }
    }

    private fun stopMonitor(message: String) {
        session?.close()
        session = null
        tone?.release()
        tone = null
        preview.show(null)
        preview.overlay(if (mode == MonitorMode.SAFE_EXIT) DoorSide.entries[side.selectedItemPosition].zone else null, null)
        host.isEnabled = true
        code.isEnabled = true
        start.isEnabled = true
        stop.isEnabled = false
        side.isEnabled = true
        status.text = message
        showState("Camera off")
    }

    private fun showState(message: String) {
        level.text = message
        level.setTextColor(context.getColor(R.color.accent))
        details.values.forEach { it.text = "—" }
    }

    private fun showDrowsiness(m: DrowsinessTracker.Metrics) {
        val warning = m.level in listOf(DrowsinessTracker.Level.ASLEEP, DrowsinessTracker.Level.DROWSY, DrowsinessTracker.Level.TIRING)
        level.text = m.level.label
        level.setTextColor(context.getColor(if (warning) R.color.warn else R.color.accent))
        val shown = listOf("${m.alertness}%", "%.1f s".format(m.closedMs / 1000.0), "${m.perclos}%")
        details.values.zip(shown).forEach { (view, value) -> view.text = value }
    }

    private fun showExit(reading: ExitReading) {
        val candidate = reading.candidate
        level.text = when {
            candidate == null -> "Monitoring door zone"
            reading.approaching -> "${candidate.label} approaching door zone"
            else -> "${candidate.label} in door zone"
        }
        level.setTextColor(context.getColor(if (candidate == null) R.color.accent else R.color.warn))
        details.getValue("Objects detected").text = reading.objects.size.toString()
    }

    private fun beep(urgent: Boolean) {
        runCatching {
            val player = tone ?: ToneGenerator(AudioManager.STREAM_MUSIC, 55).also { tone = it }
            player.startTone(if (urgent) ToneGenerator.TONE_PROP_BEEP2 else ToneGenerator.TONE_PROP_BEEP, 200)
        }
    }

    fun destroy(): Future<*> {
        stopMonitor("")
        val closed = worker.submit { }
        worker.shutdown()
        return closed
    }

    private fun metric(title: String, value: TextView) = LinearLayout(context).apply {
        setPadding(0, dp(5), 0, dp(5))
        addView(label(title, 13f, R.color.ink2), LayoutParams(0, -2, 1f))
        addView(value)
    }

    private fun field(hint: String, widthDp: Int, type: Int) = EditText(context).apply {
        this.hint = hint
        inputType = type
        setSingleLine()
        setTextColor(context.getColor(R.color.ink))
        setHintTextColor(context.getColor(R.color.ink3))
        textSize = 15f
        setBackgroundResource(R.drawable.field)
        setPadding(dp(14), 0, dp(14), 0)
        layoutParams = LayoutParams(dp(widthDp), dp(44)).apply { marginEnd = dp(10) }
    }

    private fun button(text: String, primary: Boolean = false, onClick: () -> Unit) = Button(context).apply {
        this.text = text
        layoutParams = LayoutParams(-2, dp(44)).apply { marginEnd = dp(8) }
        isAllCaps = false
        background = context.getDrawable(if (primary) R.drawable.button else R.drawable.button_quiet)
        setTextColor(context.getColorStateList(if (primary) R.color.button_ink else R.color.button_quiet_ink))
        textSize = 14f
        typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
        stateListAnimator = null
        minHeight = 0
        minimumHeight = 0
        setPadding(dp(18), 0, dp(18), 0)
        setOnClickListener { onClick() }
    }

    private fun label(text: String, size: Float, color: Int) = TextView(context).apply {
        this.text = text
        textSize = size
        setTextColor(context.getColor(color))
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private companion object {
        /** One photo per this interval, or slower when analysis takes longer. */
        const val SNAPSHOT_MS = 1_000L
    }
}
private class FrameView(context: Context) : View(context) {
    private var shot: CameraImage? = null
    private var zone: ExitBox? = null
    private var exit: ExitReading? = null
    private val imagePaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val overlayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeWidth = 2f * resources.displayMetrics.density
        textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 13f, resources.displayMetrics)
    }
    private val dst = RectF()
    private val overlay = RectF()
    private val previewMatrix = Matrix()

    fun show(next: CameraImage?) {
        shot?.bitmap?.recycle()
        shot = next
        invalidate()
    }

    fun overlay(zone: ExitBox?, exit: ExitReading?) {
        if (this.zone == zone && this.exit === exit) return
        this.zone = zone
        this.exit = exit
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val b = shot ?: return
        val k = minOf(width.toFloat() / b.width, height.toFloat() / b.height)
        val w = b.width * k
        val h = b.height * k
        dst.set((width - w) / 2, (height - h) / 2, (width + w) / 2, (height + h) / 2)
        canvas.drawBitmap(b.bitmap, previewMatrix.apply {
            setScale(k, k)
            postTranslate(dst.left, dst.top)
            preConcat(b.upright)
        }, imagePaint)
        val reading = exit
        zone?.let { drawBox(canvas, it, if (reading?.candidate == null) context.getColor(R.color.accent) else 0xffe8a33d.toInt(), fill = true) }
        reading?.objects?.forEach { obj ->
            val color = if (obj == reading.candidate) 0xffe8a33d.toInt() else 0xffbfe7f4.toInt()
            drawBox(canvas, obj.box, color, fill = false)
            overlayPaint.style = Paint.Style.FILL
            canvas.drawText(obj.label, overlay.left + 2f, maxOf(dst.top + overlayPaint.textSize, overlay.top - 3f), overlayPaint)
        }
    }

    private fun drawBox(canvas: Canvas, box: ExitBox, color: Int, fill: Boolean) {
        overlay.set(dst.left + box.left * dst.width(), dst.top + box.top * dst.height(),
            dst.left + box.right * dst.width(), dst.top + box.bottom * dst.height())
        overlayPaint.color = color
        if (fill) {
            overlayPaint.alpha = 36
            overlayPaint.style = Paint.Style.FILL
            canvas.drawRect(overlay, overlayPaint)
            overlayPaint.alpha = 255
        }
        overlayPaint.style = Paint.Style.STROKE
        canvas.drawRect(overlay, overlayPaint)
    }
}
