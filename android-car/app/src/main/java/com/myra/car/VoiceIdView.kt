package com.myra.car

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue

/**
 * Voice recognition screen: enroll a driver's voice under a name, then tap to find out who is speaking.
 * Runs alone: Myra AI and the drowsiness meter are released while it is open, and [destroy] releases its model.
 */
class VoiceIdView(private val activity: Activity) : FrameLayout(activity) {
    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor()
    private val recorder = Recorder()
    private var speaker: SpeakerId? = null // accessed only by work
    private var ready = false
    private var busy = false
    private var recording: String? = null // "" = identifying, otherwise the profile being enrolled
    private var pcm: ByteArrayOutputStream? = null
    @Volatile private var alive = true

    private val status = text("Loading the voice model…", 16f, R.color.ink)
    private val detail = text("", 12f, R.color.ink3)
    private val identifyBtn = button("Who is speaking?") { toggle("") }
    private val name = EditText(activity).apply {
        hint = "Driver name"
        setSingleLine()
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
        setTextColor(activity.getColor(R.color.ink))
        setHintTextColor(activity.getColor(R.color.ink3))
    }
    private val enrollBtn = button("Record voice sample") {
        val n = name.text.toString().trim()
        if (recording == null && n.isEmpty()) status.text = "Type the driver's name first." else toggle(n)
    }
    private val list = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }

    init {
        setBackgroundColor(activity.getColor(R.color.bg))
        val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(16), dp(16), dp(16), dp(16)) }
        row.addView(column(1f).apply {
            gravity = Gravity.CENTER
            addView(identifyBtn, LinearLayout.LayoutParams(-1, dp(88)))
            addView(status.apply { gravity = Gravity.CENTER; setPadding(0, dp(14), 0, 0) })
            addView(detail.apply { gravity = Gravity.CENTER; setPadding(0, dp(8), 0, 0) })
        })
        row.addView(column(1f).apply {
            setPadding(dp(12), 0, dp(12), 0)
            addView(text("Enroll a driver", 18f, R.color.ink).apply { setTypeface(typeface, android.graphics.Typeface.BOLD) })
            addView(text("Tap record, read the sentence below, then tap again. 3 samples give the best recognition.", 13f, R.color.ink2))
            addView(text("“Hello Myra, set the temperature to twenty two degrees and play my favourite music.”", 14f, R.color.ink).apply { setPadding(0, dp(10), 0, dp(10)) })
            addView(name)
            addView(enrollBtn, LinearLayout.LayoutParams(-1, dp(60)).apply { topMargin = dp(8) })
        })
        row.addView(column(1f).apply {
            setBackgroundResource(R.drawable.panel)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            addView(text("Enrolled voices", 14f, R.color.ink2).apply { setTypeface(typeface, android.graphics.Typeface.BOLD) })
            addView(list)
        })
        addView(row, -1, -1)
        setButtons()

        val t = SystemClock.elapsedRealtime()
        work.execute {
            val s = runCatching { SpeakerId(activity) }
            if (!alive) { s.getOrNull()?.close(); return@execute }
            speaker = s.getOrNull()
            val counts = speaker?.prints?.counts().orEmpty()
            main.post {
                if (!alive) return@post
                ready = s.isSuccess
                status.text = s.exceptionOrNull()?.let { "Voice model failed to load: ${it.message}" }
                    ?: if (counts.isEmpty()) "Enroll a driver's voice to start." else "Tap “Who is speaking?” and talk."
                detail.text = if (ready) "CAM++ voice model ready (${SystemClock.elapsedRealtime() - t} ms) · runs on the car" else ""
                renderList(counts)
                setButtons()
            }
        }
    }

    /** Starts recording for [profile] ("" = identify), or stops and processes it. */
    private fun toggle(profile: String) {
        if (recording != null) return finish()
        if (!ready || busy) return
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2)
            return
        }
        if (!recorder.open()) { status.text = "Couldn't open the microphone. Try again."; return }
        recording = profile
        val out = ByteArrayOutputStream().also { pcm = it }
        val queue = LinkedBlockingQueue<ByteArray>()
        recorder.start(queue)
        Thread({ while (true) { val b = queue.take(); if (b.isEmpty()) break; synchronized(out) { out.write(b) } } }, "voice-id-pcm").start()
        status.text = if (profile.isEmpty()) "Listening… speak, then tap to stop" else "Recording $profile… tap to stop"
        detail.text = ""
        setButtons()
        main.postDelayed(autoStop, if (profile.isEmpty()) MAX_IDENTIFY_MS else MAX_ENROLL_MS)
    }

    private val autoStop = Runnable { if (recording != null) finish() }

    private fun finish() {
        main.removeCallbacks(autoStop)
        val profile = recording ?: return
        recording = null
        recorder.stop()
        val loud = recorder.peakRms >= Recorder.SPEECH_RMS
        recorder.close() // free the mic between recordings
        val out = pcm ?: return
        pcm = null
        busy = true
        setButtons()
        status.text = "Analysing the voice on the car…"
        work.execute {
            val audio = synchronized(out) { out.toByteArray() }.let { b -> FloatArray(b.size / 2) { ((b[2 * it].toInt() and 0xFF) or (b[2 * it + 1].toInt() shl 8)) / 32768f } }
            val t0 = System.nanoTime()
            val s = speaker
            val result: Result<String> = runCatching {
                checkNotNull(s) { "the voice model is not loaded" }
                if (!loud) error("I didn't hear anything. Speak a little louder.")
                if (profile.isEmpty()) {
                    if (s.prints.isEmpty()) error("No voices enrolled yet.")
                    s.identify(audio)?.let { "It's ${it.profile}  (score %.2f · lead %.2f)".format(it.score, it.margin) }
                        ?: "I don't recognise this voice. Speak for longer, or enroll it."
                } else {
                    val n = s.enroll(profile, audio)
                    "Saved voice sample $n for $profile." + if (n < 3) " Record ${3 - n} more for best results." else ""
                }
            }
            val ms = (System.nanoTime() - t0) / 1_000_000
            val counts = s?.prints?.counts().orEmpty()
            main.post {
                if (!alive) return@post
                busy = false
                status.text = result.getOrElse { it.message ?: it.javaClass.simpleName }
                detail.text = "%.1f s recorded · analysed in %d ms".format(audio.size / 16000.0, ms)
                renderList(counts)
                setButtons()
            }
        }
    }

    private fun forget(profile: String) {
        if (busy || recording != null) return
        work.execute {
            runCatching { speaker?.forget(profile) }
            val counts = speaker?.prints?.counts().orEmpty()
            main.post { if (alive) { renderList(counts); status.text = "Forgot $profile's voice." } }
        }
    }

    private fun renderList(counts: Map<String, Int>) {
        list.removeAllViews()
        if (counts.isEmpty()) list.addView(text("None yet.", 13f, R.color.ink3))
        for ((p, n) in counts) {
            list.addView(LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(6), 0, dp(6))
                addView(text("$p · $n sample${if (n == 1) "" else "s"}", 14f, R.color.ink), LinearLayout.LayoutParams(0, -2, 1f))
                addView(button("Forget") { forget(p) })
            })
        }
    }

    private fun setButtons() {
        identifyBtn.text = if (recording == "") "Stop and identify" else "Who is speaking?"
        enrollBtn.text = if (recording != null && recording != "") "Stop and save" else "Record voice sample"
        identifyBtn.isEnabled = ready && !busy && (recording == null || recording == "")
        enrollBtn.isEnabled = ready && !busy && recording != ""
        name.isEnabled = recording == null && !busy
    }

    fun destroy() {
        alive = false
        main.removeCallbacksAndMessages(null)
        recording = null
        recorder.close()
        work.execute { speaker?.close(); speaker = null }
        work.shutdown()
    }

    private fun column(weight: Float) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(0, -1, weight)
    }

    private fun text(s: String, size: Float, color: Int) = TextView(activity).apply {
        text = s; textSize = size; setTextColor(activity.getColor(color))
    }

    private fun button(label: String, onClick: () -> Unit) = Button(activity).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val MAX_IDENTIFY_MS = 8_000L
        const val MAX_ENROLL_MS = 12_000L
    }
}
