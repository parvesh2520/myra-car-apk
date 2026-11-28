package com.myra.car

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
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
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * Voice recognition screen: enroll a driver's voice under a name, then tap to find out who is speaking.
 * Runs alone: Myra AI and the drowsiness meter are released while it is open, and [destroy] releases its model.
 */
internal class VoiceIdView(
    private val activity: Activity,
    private val onCabinSaved: (String, Cabin) -> Unit,
) : FrameLayout(activity) {
    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor()
    private val recorder = Recorder()
    private val cabins = DriverCabins(activity)
    private var cabinEditor: AlertDialog? = null
    private var speaker: SpeakerId? = null // accessed only by work
    private var ready = false
    private var busy = false
    private var recording: String? = null // "" = identifying, otherwise the profile being enrolled
    @Volatile private var alive = true

    private val status = text("Loading the voice model…", 16f, R.color.ink)
    private val detail = text("", 12f, R.color.ink3)
    private val identifyBtn = button("Who is speaking?", primary = true) { toggle("") }
    private val name = EditText(activity).apply {
        hint = "Driver name"
        setSingleLine()
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
        setTextColor(activity.getColor(R.color.ink))
        setHintTextColor(activity.getColor(R.color.ink3))
        textSize = 15f
        setBackgroundResource(R.drawable.field)
        setPadding(dp(14), 0, dp(14), 0)
        minHeight = dp(48)
    }
    private val enrollBtn = button("Record voice sample", primary = false) {
        val n = name.text.toString().trim()
        if (recording == null && n.isEmpty()) status.text = "Type the driver's name first." else toggle(n)
    }
    private val list = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }

    init {
        setBackgroundColor(activity.getColor(R.color.bg))
        val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(24), dp(20), dp(24), dp(20)) }
        row.addView(column(1f).apply {
            gravity = Gravity.CENTER
            addView(identifyBtn, LinearLayout.LayoutParams(-2, dp(52)).apply { gravity = Gravity.CENTER_HORIZONTAL })
            addView(status.apply { gravity = Gravity.CENTER; setPadding(0, dp(14), 0, 0) })
            addView(detail.apply { gravity = Gravity.CENTER; setPadding(0, dp(8), 0, 0) })
        })
        row.addView(column(1f).apply {
            setPadding(dp(24), 0, dp(24), 0)
            addView(text("Enroll a driver", 18f, R.color.ink).apply { typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL) })
            addView(text("Tap record, read the sentence below, then tap again. 3 samples give the best recognition.", 13f, R.color.ink2))
            addView(text("“Hello Myra, set the temperature to twenty two degrees and play my favourite music.”", 14f, R.color.ink).apply { setPadding(0, dp(10), 0, dp(10)) })
            addView(name)
            addView(enrollBtn, LinearLayout.LayoutParams(-2, dp(48)).apply { topMargin = dp(16) })
        })
        row.addView(column(1f).apply {
            setBackgroundResource(R.drawable.panel)
            setPadding(dp(20), dp(20), dp(20), dp(20))
            addView(text("Driver profiles", 18f, R.color.ink).apply { typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL) })
            addView(ScrollView(activity).apply { addView(list, -1, -2) }, LinearLayout.LayoutParams(-1, 0, 1f))
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
        recorder.start(captureVoice = true)
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
        val pcm = recorder.takeVoice()
        recorder.close() // free the mic between recordings
        if (pcm == null) return
        busy = true
        setButtons()
        status.text = "Analysing the voice on the car…"
        work.execute {
            val audio = Recorder.samples(pcm)
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
        busy = true
        setButtons()
        work.execute {
            val result = runCatching {
                checkNotNull(speaker).forget(profile)
                cabins.forget(profile)
            }
            val counts = speaker?.prints?.counts().orEmpty()
            main.post {
                if (alive) {
                    busy = false
                    setButtons()
                    renderList(counts)
                    status.text = if (result.isSuccess) "Forgot $profile's voice and cabin settings." else "Couldn't forget $profile. Try again."
                }
            }
        }
    }

    private fun editCabin(profile: String, summary: TextView) {
        if (busy || recording != null || cabinEditor != null) return
        val dialog = cabinSettingsDialog(activity, profile, cabins.load(profile)) { updated ->
            cabins.save(profile, updated)
            summary.text = cabinSummary(updated)
            status.text = "Saved cabin settings for $profile."
            onCabinSaved(profile, updated)
        }
        cabinEditor = dialog
        dialog.setOnDismissListener { cabinEditor = null }
        dialog.show()
    }

    private fun cabinSummary(cabin: Cabin): String =
        "${if (cabin.acOn) "AC ${cabin.temp}°C" else "AC off"} · Fan ${if (cabin.fan == 0) "off" else cabin.fan}\n" +
            "${cabin.light.label} light · Seat ${cabin.seatHeight}"

    private fun renderList(counts: Map<String, Int>) {
        list.removeAllViews()
        if (counts.isEmpty()) list.addView(text("None yet.", 13f, R.color.ink3))
        for ((p, n) in counts) {
            list.addView(LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, dp(8), 0, dp(8))
                addView(LinearLayout(activity).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    addView(text("$p · $n sample${if (n == 1) "" else "s"}", 14f, R.color.ink), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(button("Forget") { forget(p) })
                })
                val summary = text(cabinSummary(cabins.load(p)), 13f, R.color.ink2)
                addView(summary)
                addView(button("Cabin settings") { editCabin(p, summary) }.apply {
                    contentDescription = "Cabin settings for $p"
                }, LinearLayout.LayoutParams(-1, dp(48)))
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

    fun destroy(): Future<*> {
        alive = false
        cabinEditor?.dismiss()
        main.removeCallbacksAndMessages(null)
        recording = null
        recorder.close()
        val released = work.submit { speaker?.close(); speaker = null }
        work.shutdown()
        return released
    }

    private fun column(weight: Float) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(0, -1, weight)
    }

    private fun text(s: String, size: Float, color: Int) = TextView(activity).apply {
        text = s; textSize = size; setTextColor(activity.getColor(color))
    }

    private fun button(label: String, primary: Boolean = false, onClick: () -> Unit) = Button(activity).apply {
        text = label
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

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val MAX_IDENTIFY_MS = 8_000L
        const val MAX_ENROLL_MS = 12_000L
    }
}
