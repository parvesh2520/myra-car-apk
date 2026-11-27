package com.myra.car

import android.Manifest
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.CheckBox
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import java.util.concurrent.LinkedBlockingQueue

/**
 * MYRA car app: hold the mic (or tap to start, tap to send), Sarvam turns the speech into English on
 * the Render backend, and the car's own models decide what to do: a saved shortcut first, then the MiniLM
 * classifier, and the SmolLM2 language model (once downloaded) for shortcut definitions, several requests in one
 * sentence, and anything the classifier is unsure about. Every step is timed.
 */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor() // model loading and inference, off the UI thread
    private var net: ExecutorService? = null
    private var backend: Backend? = null
    private val recorder = Recorder()
    private val car = Car()
    private lateinit var carAudio: CarAudio
    private lateinit var shortcuts: Shortcuts // main thread only
    private var classifier: Classifier? = null // Accessed only by work.
    private var llm: Llm? = null // Accessed only by work.
    private var modelReady = false
    private var classifierFailed = false
    private var llmReady = false
    private var llmLoadMs = 0L
    private var llmError: String? = null
    @Volatile private var downloading = false
    @Volatile private var cancelDownload = false
    private var llmAlways = false
    @Volatile private var generation = 0
    private var tab = MYRA // MYRA and SHORTCUTS share Myra's models; METER and VOICE run alone
    private var inForeground = false
    private var askedForMic = false
    private var monitor: MonitorView? = null
    private var voiceId: VoiceIdView? = null
    private lateinit var myraPane: View
    private lateinit var shortcutsPane: View
    private lateinit var meterPane: FrameLayout
    private lateinit var voicePane: FrameLayout
    private lateinit var tabs: List<Pair<View, Int>>
    private lateinit var location: CarLocation
    private var places: List<Place>? = null // the last search's results, while the driver picks one
    private var navTarget: Place? = null // the destination the driver picked

    private lateinit var mic: View
    private lateinit var ring: View
    private lateinit var status: TextView
    private lateinit var system: TextView
    private lateinit var log: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var stateBox: LinearLayout
    private lateinit var llmState: TextView
    private lateinit var llmDetail: TextView
    private lateinit var llmProgress: ProgressBar
    private lateinit var llmButton: TextView
    private lateinit var llmAlwaysBox: CheckBox
    private lateinit var shortcutCount: TextView
    private lateinit var shortcutSummary: TextView
    private lateinit var shortcutList: LinearLayout
    private var pulse: ValueAnimator? = null

    private var recording = false
    private var toggleMode = false
    private var busy = false
    private var tPress = 0L
    private var serverUp: Boolean? = null
    private var freeMb = 0L

    private val llmFile by lazy { Llm.modelFile(filesDir) }
    private val prefs by lazy { getSharedPreferences("myra", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.car_shell)
        carAudio = CarAudio(this)
        car.syncVolume(carAudio.volume)
        shortcuts = Shortcuts(File(filesDir, "shortcuts.json"))
        llmAlways = prefs.getBoolean("llmAlways", false)
        myraPane = findViewById(R.id.myraPane)
        shortcutsPane = findViewById(R.id.shortcutsPane)
        meterPane = findViewById(R.id.meterPane)
        voicePane = findViewById(R.id.voicePane)
        location = CarLocation(this)
        tabs = listOf(findViewById<View>(R.id.myraTab) to MYRA, findViewById<View>(R.id.shortcutsTab) to SHORTCUTS,
            findViewById<View>(R.id.meterTab) to METER, findViewById<View>(R.id.voiceTab) to VOICE)
        for ((view, id) in tabs) view.setOnClickListener { select(id) }
        tab = savedInstanceState?.getInt("tab") ?: MYRA
        if (packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT)) {
            findViewById<View>(R.id.openPhoneCamera).apply {
                visibility = View.VISIBLE
                setOnClickListener { startActivity(Intent(this@MainActivity, PhoneCameraActivity::class.java)) }
            }
        }
        mic = findViewById(R.id.mic)
        ring = findViewById(R.id.micRing)
        status = findViewById(R.id.status)
        system = findViewById(R.id.system)
        log = findViewById(R.id.log)
        scroll = findViewById(R.id.scroll)
        stateBox = findViewById(R.id.state)
        llmState = findViewById(R.id.llmState)
        llmDetail = findViewById(R.id.llmDetail)
        llmProgress = findViewById(R.id.llmProgress)
        llmButton = findViewById(R.id.llmButton)
        llmAlwaysBox = findViewById(R.id.llmAlways)
        shortcutCount = findViewById(R.id.shortcutCount)
        shortcutSummary = findViewById(R.id.shortcutSummary)
        shortcutList = findViewById(R.id.shortcutList)

        mic.setOnTouchListener { _, e -> onMicTouch(e); true }
        llmButton.setOnClickListener { onLlmButton() }
        llmAlwaysBox.isChecked = llmAlways
        llmAlwaysBox.setOnCheckedChangeListener { _, on -> llmAlways = on; prefs.edit().putBoolean("llmAlways", on).apply() }
        val chips = findViewById<LinearLayout>(R.id.chips)
        for (text in EXAMPLES) {
            chips.addView(TextView(this).apply {
                this.text = text
                setTextColor(getColor(R.color.ink2))
                textSize = 13f
                setBackgroundResource(R.drawable.chip)
                setPadding(dp(14), dp(9), dp(14), dp(9))
                layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(8) }
                setOnClickListener { if (!busy && !recording) typed(text) }
            })
        }
        renderState()
        renderTabs()
        renderLlm()
        renderShortcuts()
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(online)
    }

    /** Fetches the language model from Hugging Face whenever the car gets internet, resuming a partial download. */
    private val online = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            main.post { if (!llmFile.exists() && !downloading && !userPaused) startDownload() }
        }
    }
    private var userPaused = false

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt("tab", tab)
        super.onSaveInstanceState(outState)
    }

    private fun usesMyra(t: Int) = t == MYRA || t == SHORTCUTS

    private fun select(next: Int) {
        if (next == tab) {
            // Tapping Assistant again retries a model that failed to load, without restarting the app.
            if (next == MYRA && !modelReady && !busy && !recording && classifierFailed) { pauseMyra(); startMyra() }
            return
        }
        if (usesMyra(tab) && usesMyra(next)) { // same models: just switch the screen
            if (recording) send()
            tab = next
            renderTabs()
            return
        }
        when (tab) {
            MYRA, SHORTCUTS -> pauseMyra()
            METER -> { generation++; closeMonitor() }
            VOICE -> { generation++; closeVoiceId() }
        }
        tab = next
        renderTabs()
        openTab()
    }

    private fun openTab() = when (tab) {
        METER -> openAfterRelease(meterPane) { MonitorView(this).also { monitor = it } }
        VOICE -> openAfterRelease(voicePane) { VoiceIdView(this).also { voiceId = it } }
        else -> startMyra()
    }

    private fun renderTabs() {
        myraPane.visibility = if (tab == MYRA) View.VISIBLE else View.GONE
        shortcutsPane.visibility = if (tab == SHORTCUTS) View.VISIBLE else View.GONE
        meterPane.visibility = if (tab == METER) View.VISIBLE else View.GONE
        voicePane.visibility = if (tab == VOICE) View.VISIBLE else View.GONE
        for ((view, id) in tabs) view.isSelected = tab == id
    }

    private fun startMyra() {
        val id = ++generation
        backend = Backend()
        net = Executors.newCachedThreadPool()
        status.text = "Loading Myra…"
        freeMemory()
        work.execute {
            if (id != generation) return@execute
            val t = SystemClock.elapsedRealtime()
            val c = runCatching { Classifier(this) }
            classifier = c.getOrNull()
            main.post {
                if (id != generation) return@post
                modelReady = c.isSuccess
                classifierFailed = c.isFailure
                c.exceptionOrNull()?.let { status.text = "Model failed to load: ${it.message}. Tap Assistant to retry." }
                    ?: run { status.text = "Hold the mic and speak"; modelLoadMs = SystemClock.elapsedRealtime() - t }
                renderSystem()
            }
        }
        loadLlm()
        location.start()
        val missing = listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (Manifest.permission.RECORD_AUDIO !in missing) openMic()
        if (missing.isNotEmpty() && !askedForMic) {
            askedForMic = true
            requestPermissions(missing.toTypedArray(), 1)
        }
        main.post(keepAlive)
    }

    /** Loads the language model on `work` if it is downloaded and not loaded yet. */
    private fun loadLlm() {
        if (!llmFile.exists() || !usesMyra(tab)) return
        val id = generation
        llmError = null
        renderLlm()
        work.execute {
            if (id != generation || llm != null) return@execute
            val t = SystemClock.elapsedRealtime()
            val l = runCatching { Llm(llmFile) }
            llm = l.getOrNull()
            main.post {
                if (id != generation) { if (l.isSuccess) work.execute { llm?.close(); llm = null }; return@post }
                llmReady = l.isSuccess
                llmLoadMs = SystemClock.elapsedRealtime() - t
                llmError = l.exceptionOrNull()?.message
                renderLlm()
                renderSystem()
            }
        }
    }

    private fun pauseMyra() {
        generation++
        main.removeCallbacks(keepAlive)
        main.removeCallbacks(autoSend)
        val oldBackend = backend
        backend = null
        net?.shutdownNow()
        net = null
        recorder.close()
        recording = false
        toggleMode = false
        busy = false
        heardSpeech = false
        pendingTranscript = null
        modelReady = false
        classifierFailed = false
        llmReady = false
        location.stop()
        stopPulse()
        renderLlm()
        work.execute {
            classifier?.close()
            classifier = null
            llm?.close()
            llm = null
            oldBackend?.close()
        }
    }

    /** Opens a tab's view once `work` has closed Myra's models, so two screens' models are never in memory together. */
    private fun openAfterRelease(pane: FrameLayout, create: () -> View) {
        val id = generation
        val want = tab
        pane.removeAllViews()
        pane.addView(TextView(this).apply {
            text = "Releasing Myra…"
            setTextColor(getColor(R.color.ink2))
            setPadding(dp(16), dp(16), dp(16), dp(16))
        })
        work.execute {
            main.post {
                if (id != generation || !inForeground || tab != want) return@post
                pane.removeAllViews()
                pane.addView(create(), -1, -1)
            }
        }
    }

    private fun closeVoiceId() {
        voicePane.removeAllViews()
        voiceId?.destroy()
        voiceId = null
    }

    private fun closeMonitor() {
        meterPane.removeAllViews()
        monitor?.let {
            it.destroy()
            // Not on `work`: a frame still in analysis holds the model lock and would delay loading Myra.
            Thread({ runCatching { it.analysis.close() } }, "close-face-analysis").start()
        }
        monitor = null
    }

    private var modelLoadMs = 0L

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 1 || !usesMyra(tab) || !inForeground) return
        location.start()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) openMic()
        else status.text = "Microphone permission is needed to talk to Myra."
    }

    private fun openMic() {
        if (!recorder.open()) status.text = "Couldn't open the microphone."
    }

    override fun onStart() {
        super.onStart()
        inForeground = true
        car.syncVolume(carAudio.volume)
        renderState()
        openTab()
    }

    override fun onStop() {
        inForeground = false
        when (tab) {
            MYRA, SHORTCUTS -> pauseMyra()
            METER -> { generation++; closeMonitor() }
            VOICE -> { generation++; closeVoiceId() }
        }
        super.onStop()
    }

    override fun onDestroy() {
        cancelDownload = true
        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(online) }
        main.removeCallbacksAndMessages(null)
        work.shutdown()
        super.onDestroy()
    }

    /* ---------- language model download ---------- */

    private fun onLlmButton() {
        when {
            downloading -> { cancelDownload = true; userPaused = true }
            llmFile.exists() && llmError != null -> { llmFile.delete(); llmError = null; userPaused = false; startDownload() } // unusable file: fetch again
            !llmFile.exists() -> { userPaused = false; startDownload() }
        }
    }

    private fun startDownload() {
        downloading = true
        cancelDownload = false
        llmError = null
        renderLlm()
        Thread({
            val r = runCatching {
                Llm.download(llmFile, { have, total ->
                    main.post { if (downloading) showProgress(have, total) }
                }, { cancelDownload })
            }
            main.post {
                downloading = false
                llmError = r.exceptionOrNull()?.let { if (cancelDownload) "Download paused" else it.message ?: it.javaClass.simpleName }
                renderLlm()
                if (r.isSuccess) loadLlm()
            }
        }, "llm-download").start()
    }

    private fun showProgress(have: Long, total: Long) {
        llmProgress.visibility = View.VISIBLE
        llmProgress.progress = if (total > 0) (have * 1000 / total).toInt() else 0
        llmState.text = if (total > 0) "${have * 100 / total}%" else "${have shr 20} MB"
        llmDetail.text = "Downloading ${have shr 20} of ${total shr 20} MB. You can keep using Myra."
    }

    private fun renderLlm() {
        val partMb = File(llmFile.path + ".part").let { if (it.exists()) it.length() shr 20 else 0 }
        llmAlwaysBox.visibility = if (llmReady) View.VISIBLE else View.GONE
        llmProgress.visibility = if (downloading) View.VISIBLE else View.GONE
        llmButton.isEnabled = true
        llmButton.visibility = View.VISIBLE
        llmState.setTextColor(getColor(if (llmError != null && !downloading) R.color.warn else R.color.ink3))
        when {
            downloading -> { llmState.text = "Downloading"; llmButton.text = "Pause download" }
            llmReady -> {
                llmState.text = "Ready"
                llmState.setTextColor(getColor(R.color.accent))
                llmDetail.text = "${Llm.NAME} runs on this car (loaded in $llmLoadMs ms). It handles shortcuts, several requests at once, and anything MiniLM is unsure of."
                llmButton.visibility = View.GONE
            }
            llmFile.exists() && llmError != null -> {
                llmState.text = "Failed"
                llmDetail.text = "Couldn't load the model: $llmError"
                llmButton.text = "Download again"
            }
            llmFile.exists() -> { llmState.text = "Loading…"; llmDetail.text = "Loading ${Llm.NAME} into memory."; llmButton.visibility = View.GONE }
            else -> {
                llmState.text = if (partMb > 0) "Paused" else "Not installed"
                llmDetail.text = (llmError?.let { "$it. " } ?: "") +
                    "${Llm.NAME} runs on the car for shortcuts and longer requests. ${Llm.SIZE shr 20} MB from Hugging Face; it downloads by itself when the car is online."
                llmButton.text = if (partMb > 0) "Resume download ($partMb MB done)" else "Download"
            }
        }
    }

    /* ---------- voice ---------- */

    private fun onMicTouch(e: MotionEvent) {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                mic.isPressed = true
                if (recording && toggleMode) return send() // tap mode: second tap sends
                if (!recording && !busy) startRecording()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                mic.isPressed = false
                if (!recording || toggleMode) return
                if (SystemClock.elapsedRealtime() - tPress < 350) { // a tap, not a hold: keep listening until the next tap
                    toggleMode = true
                    status.text = "Listening… tap to send"
                } else send()
            }
        }
    }

    private fun startRecording() {
        if (!modelReady) { status.text = "The model is still loading…"; return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
            return
        }
        // The head unit can refuse the mic right after the meter released it: open it again on press.
        if (!recorder.open()) { status.text = "Couldn't open the microphone. Try again."; return }
        val executor = net ?: return
        val api = backend ?: return
        val id = generation
        pendingTranscript = null
        tPress = SystemClock.elapsedRealtime()
        recording = true
        toggleMode = false
        val queue = LinkedBlockingQueue<ByteArray>()
        recorder.start(queue)
        status.text = "Listening… release to send"
        startPulse()
        // The upload starts now and runs while the driver speaks.
        executor.execute {
            val transcript = runCatching { api.transcribe(queue) }
                .getOrElse { Transcript("", null, "Can't reach the speech service (${it.javaClass.simpleName}).") }
            val tHeard = SystemClock.elapsedRealtime()
            main.post {
                if (id != generation) return@post
                if (recording) pendingTranscript = transcript to tHeard else heard(transcript, tHeard)
            }
        }
        main.postDelayed(autoSend, MAX_COMMAND_MS)
    }

    private val autoSend = Runnable { if (recording) send() }

    private var tReleased = 0L
    private var heardSpeech = false
    private var pendingTranscript: Pair<Transcript, Long>? = null

    private fun send() {
        main.removeCallbacks(autoSend)
        recording = false
        toggleMode = false
        busy = true
        tReleased = SystemClock.elapsedRealtime()
        recorder.stop()
        heardSpeech = recorder.peakRms >= Recorder.SPEECH_RMS
        stopPulse()
        status.text = "Recognising…"
        pendingTranscript?.let { (transcript, _) -> heard(transcript, tReleased) }
        pendingTranscript = null
    }

    private fun heard(t: Transcript, tHeard: Long) {
        if (!heardSpeech) { // only silence was recorded: whatever came back was not said
            busy = false
            status.text = "I didn't hear anything. Hold the mic and speak."
            return
        }
        if (t.text.isBlank()) {
            busy = false
            status.text = t.error?.take(120) ?: "I didn't hear anything. Try again."
            return
        }
        addBubble(t.text, user = true)
        understand(t.text, t.engine) { r -> timeline(t, tHeard, r.ms) }
    }

    /**
     * Where the time went, from pressing the mic to the car acting: how long the driver spoke, how long
     * speech-to-English took after release (Sarvam's own time and the network/server rest), and the car's model.
     */
    private fun timeline(t: Transcript, tHeard: Long, modelMs: Long): String {
        val done = SystemClock.elapsedRealtime()
        val toEnglish = (tHeard - tReleased).coerceAtLeast(0)
        val split = t.asrMs?.let { " (Sarvam ${secs(it)} + network ${secs((toEnglish - it).coerceAtLeast(0))})" } ?: ""
        return "Total ${secs(done - tPress)} from button press · ${secs(done - tReleased)} after release\n" +
            "Speaking ${secs(tReleased - tPress)} · Speech → English ${secs(toEnglish)}$split\n" +
            "Understanding on the car ${secs(modelMs)}"
    }

    private fun secs(ms: Long) = if (ms < 1000) "$ms ms" else "%.1f s".format(ms / 1000.0)

    private fun typed(text: String) {
        if (!modelReady) return
        addBubble(text, user = true)
        understand(text, null) { null }
    }

    /** What one sentence did: the reply, which model decided, how long it took, and the commands to log. */
    private class Reply(val text: String, val model: String, val detail: String, val ms: Long, val commands: List<Map<String, Any>>)

    /** Runs actions in [Car.run]'s form, including saving or deleting shortcuts, and joins their replies. */
    private fun runActions(actions: List<JSONObject>): Pair<String, List<Map<String, Any>>> {
        if (actions.isEmpty()) return "Sorry, I didn't catch that. Please say it again." to emptyList()
        val replies = mutableListOf<String>()
        val commands = mutableListOf<Map<String, Any>>()
        car.syncVolume(carAudio.volume)
        for (a in actions) {
            when (a.optString("type")) {
                "shortcut.save" -> {
                    val name = a.optString("name")
                    val arr = a.optJSONArray("do")
                    val acts = if (arr == null) emptyList() else List(arr.length()) { arr.optJSONObject(it) }.filterNotNull()
                        .filter { !it.optString("type").startsWith("shortcut") }
                    if (shortcuts.save(name, acts)) {
                        replies += "Saved. Say “${Shortcuts.normalize(name)}” to ${acts.joinToString(", ") { Car.label(it).lowercase() }}."
                        commands += mapOf("type" to "shortcut.save", "name" to Shortcuts.normalize(name), "actions" to acts.size)
                        renderShortcuts()
                    } else replies += "I couldn't save that shortcut. Say the name, then what it should do."
                }
                "shortcut.delete" -> {
                    val name = a.optString("name")
                    if (shortcuts.delete(name)) {
                        replies += "Deleted the “${Shortcuts.normalize(name)}” shortcut."
                        commands += mapOf("type" to "shortcut.delete", "name" to Shortcuts.normalize(name))
                        renderShortcuts()
                    } else replies += "There's no shortcut called “${Shortcuts.normalize(name)}”."
                }
                else -> {
                    val out = car.run(a)
                    out.audio?.let { runCatching { carAudio.apply(it, car) } }
                    replies += out.reply
                    out.command?.let { commands += it }
                }
            }
        }
        return replies.joinToString(" ") to commands
    }

    /**
     * Decides what [text] means and does it. Order: a saved shortcut (instant), MiniLM, then the LLM when the
     * sentence defines or deletes a shortcut, asks for several things, or MiniLM is unsure (or "every command" is on).
     */
    private fun understand(text: String, asr: String?, timing: (Reply) -> String?) {
        val id = generation
        val executor = net ?: return
        val api = backend ?: return
        busy = true
        fun finish(r: Reply) {
            busy = false
            status.text = "Hold the mic and speak"
            val note = listOfNotNull("${r.model} · ${r.detail}", timing(r)).joinToString("\n")
            addBubble(r.text, user = false, note = note)
            renderState()
            executor.execute { api.log(text, r.commands, r.model, r.ms, asr, r.text) }
            r.commands.lastOrNull { it["type"] == Car.NAV_REQUEST }?.let { searchPlaces(it["destination"].toString()) }
            if (r.commands.any { it["type"] == "navigation_stop" }) endRoute()
        }
        // "The second one" / "the one in Bandra" right after a place search picks that place.
        places?.let { found ->
            places = null
            val p = if (text.split(' ').size <= 10) Navigation.pick(text, found) else null
            if (p != null) {
                busy = false
                status.text = "Hold the mic and speak"
                return go(p, text, "Choice ${found.indexOf(p) + 1} of ${found.size}\n" + (timing(Reply("", "", "", 0, emptyList())) ?: ""))
            }
        }
        shortcuts.match(text)?.let { s ->
            val t0 = SystemClock.elapsedRealtime()
            val (reply, commands) = runActions(s.actions)
            val ms = SystemClock.elapsedRealtime() - t0
            return finish(Reply("${s.name.replaceFirstChar { it.uppercase() }}: $reply", "Shortcut", "${s.actions.size} actions · $ms ms", ms, commands))
        }
        status.text = "Understanding on the car…"
        val always = llmAlways
        // "remove the X" is only a shortcut deletion when it says so or names a saved shortcut.
        val deletion = Shortcuts.isDelete(text)?.takeIf { n -> "shortcut" in text.lowercase() || shortcuts.all.any { it.name == Shortcuts.normalize(n) } }
        work.execute {
            if (id != generation) return@execute
            val c = classifier
            if (c == null) {
                main.post { if (id == generation) { busy = false; status.text = "The model isn't loaded. Tap Assistant." } }
                return@execute
            }
            val u = runCatching { c.classify(text) }.getOrNull()
            val definition = Shortcuts.parseDefinition(text)
            val lm = llm
            val needsLlm = always || definition != null || deletion != null || MULTI.containsMatchIn(text.lowercase()) ||
                u == null || u.confidence < Car.MIN_CONFIDENCE || u.intent == "ambiguous" || u.intent == "unsupported"
            if (lm != null && needsLlm) {
                if (id == generation) main.post { if (id == generation) status.text = "Thinking with ${Llm.NAME}…" }
                val a = runCatching { lm.ask(text) }.getOrNull()
                val actions = a?.actions
                if (a != null && actions != null) {
                    main.post {
                        if (id != generation) return@post
                        val (reply, commands) = runActions(actions)
                        val ms = a.promptMs + a.genMs
                        finish(Reply(reply, Llm.NAME, "%.1f s · %d in, %d out tokens".format(ms / 1000.0, a.promptTokens, a.tokens), ms, commands))
                    }
                    return@execute
                }
            }
            // Without the LLM (or if it wrote no valid JSON): shortcuts from MiniLM per clause, else MiniLM alone.
            val defActions = definition?.second?.mapNotNull { part -> runCatching { c.classify(part) }.getOrNull()?.let { r ->
                if (r.confidence >= Car.MIN_CONFIDENCE && r.negated < 0.5f) Car.action(r.intent, part) else null } }
            main.post {
                if (id != generation) return@post
                when {
                    definition != null && !defActions.isNullOrEmpty() -> {
                        val (reply, commands) = runActions(listOf(JSONObject().put("type", "shortcut.save").put("name", definition.first)
                            .put("do", org.json.JSONArray(defActions))))
                        finish(Reply(reply, MODEL, "shortcut from ${definition.second.size} parts", u?.latencyMs ?: 0, commands))
                    }
                    deletion != null -> {
                        val (reply, commands) = runActions(listOf(JSONObject().put("type", "shortcut.delete").put("name", deletion)))
                        finish(Reply(reply, MODEL, "rule", 0, commands))
                    }
                    u == null -> { busy = false; status.text = "Myra couldn't understand the command. Try again." }
                    else -> {
                        car.syncVolume(carAudio.volume)
                        val outcome = car.apply(u, text)
                        if (outcome.command != null) runCatching { carAudio.apply(u.intent, car) }
                        val detail = "${u.latencyMs} ms · ${u.intent} ${(u.confidence * 100).toInt()}%" + if (u.negated > 0.5f) " · negated" else ""
                        finish(Reply(outcome.reply, MODEL, detail, u.latencyMs, listOfNotNull(outcome.command)))
                    }
                }
            }
        }
    }

    /* ---------- navigation ---------- */

    /** Finds [query] on Google Places near the car and lists up to 3 to pick from (1 result: navigates straight away). */
    private fun searchPlaces(query: String) {
        val id = generation
        val executor = net ?: return
        val api = backend ?: return
        val here = location.last
        status.text = "Searching Google Maps for $query…"
        val t0 = SystemClock.elapsedRealtime()
        executor.execute {
            val r = runCatching { api.places(query, here?.latitude, here?.longitude) }
            val note = "Google Places search ${secs(SystemClock.elapsedRealtime() - t0)}" + if (here == null) " · no GPS fix yet" else ""
            main.post {
                if (id != generation) return@post
                status.text = "Hold the mic and speak"
                val found = r.getOrElse { addBubble(it.message ?: "Place search failed.", user = false, note = note); return@post }
                when (found.size) {
                    0 -> addBubble("I couldn't find “$query” on Google Maps. Try another name.", user = false, note = note)
                    1 -> go(found[0], query, note)
                    else -> { places = found; addPlaces(query, found, note) }
                }
            }
        }
    }

    private fun addPlaces(query: String, found: List<Place>, note: String) {
        addBubble("I found ${found.size} places for “$query”. Say “the first one”, “the second one”… or tap one.", user = false, note = note)
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        found.forEachIndexed { i, p ->
            val km = Navigation.km(location.last, p)?.let { " · %.1f km".format(it) } ?: ""
            list.addView(TextView(this).apply {
                text = "${i + 1}.  ${p.name}\n${p.address}$km"
                setTextColor(getColor(R.color.ink))
                textSize = 14f
                setBackgroundResource(R.drawable.chip)
                setPadding(dp(14), dp(10), dp(14), dp(10))
                maxWidth = dp(460)
                layoutParams = LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(6) }
                setOnClickListener { if (places === found && !busy && !recording) go(p, "tapped ${i + 1}", "Tapped choice ${i + 1} of ${found.size}") }
            })
        }
        log.addView(list)
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    /** The driver chose [p]: the car's Navigation tile shows it as the destination, and the server log records it. */
    private fun go(p: Place, said: String, note: String) {
        places = null
        val reply = "Destination set: ${p.name}."
        addBubble(reply, user = false, note = note.trimEnd())
        navTarget = p
        car.navigate(p.name)
        renderState()
        val api = backend
        net?.execute { api?.log(said, listOf(mapOf("type" to "navigation_start", "destination" to p.name, "address" to p.address,
            "lat" to p.lat, "lng" to p.lng)), "Google Places", 0, null, reply) }
    }

    private fun endRoute() {
        navTarget = null
        car.navigate(null)
        renderState()
    }

    /* ---------- screen ---------- */

    private fun addBubble(text: String, user: Boolean, note: String? = null) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(-2, -2).apply {
                topMargin = dp(10)
                gravity = if (user) Gravity.END else Gravity.START
            }
        }
        box.addView(TextView(this).apply {
            this.text = text
            setTextColor(getColor(R.color.ink))
            textSize = 16f
            setLineSpacing(dp(2).toFloat(), 1f)
            setBackgroundResource(if (user) R.drawable.bubble_user else R.drawable.bubble_myra)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            maxWidth = dp(460)
        })
        if (note != null) box.addView(TextView(this).apply {
            this.text = note
            setTextColor(getColor(R.color.ink3))
            textSize = 11f
            setPadding(dp(4), dp(4), 0, 0)
            maxWidth = dp(460)
        })
        log.addView(box)
        while (log.childCount > MAX_BUBBLES + 2) log.removeViewAt(2) // keep the two intro lines
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun tile(label: String, value: String, sub: String?, accent: Boolean = false): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundResource(R.drawable.tile)
        setPadding(dp(12), dp(10), dp(12), dp(10))
        addView(TextView(context).apply { text = label; setTextColor(getColor(R.color.ink3)); textSize = 11f })
        addView(TextView(context).apply {
            text = value
            setTextColor(getColor(if (accent) R.color.accent else R.color.ink))
            textSize = 20f
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 2
        })
        if (sub != null) addView(TextView(context).apply { text = sub; setTextColor(getColor(R.color.ink2)); textSize = 12f })
    }

    private fun renderState() {
        while (stateBox.childCount > 1) stateBox.removeViewAt(1)
        fun row(vararg tiles: View) = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            tiles.forEachIndexed { i, t -> addView(t, LinearLayout.LayoutParams(0, -2, 1f).apply { if (i > 0) marginStart = dp(8) }) }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) }
        }
        stateBox.addView(row(tile("Climate", "${car.temp}°", if (car.acOn) "AC on" else "AC off", car.acOn),
            tile("Fan", if (car.fan == 0) "Off" else "${car.fan}", "of 7")))
        stateBox.addView(row(tile("Volume", "${car.volume}", "of 30"), tile("Music", if (car.playing) "Playing" else "Paused", null, car.playing)))
        val to = navTarget
        val km = to?.let { Navigation.km(location.last, it) }?.let { " · %.1f km away".format(it) } ?: ""
        stateBox.addView(row(tile("Navigation", car.destination ?: "No route", to?.let { it.address + km }, to != null)))
    }

    private fun renderShortcuts() {
        val all = shortcuts.all
        shortcutCount.text = "${all.size}"
        shortcutSummary.text = when (all.size) {
            0 -> "None saved yet."
            1 -> "1 shortcut saved on this car."
            else -> "${all.size} shortcuts saved on this car."
        }
        shortcutList.removeAllViews()
        if (all.isEmpty()) {
            shortcutList.addView(TextView(this).apply {
                text = "Shortcuts you teach Myra show up here, with what each one does."
                setTextColor(getColor(R.color.ink3))
                textSize = 14f
                setPadding(0, dp(24), 0, 0)
            })
            return
        }
        for (s in all.asReversed()) {
            shortcutList.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setBackgroundResource(R.drawable.panel)
                setPadding(dp(16), dp(12), dp(12), dp(12))
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) }
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(TextView(context).apply { text = "“${s.name}”"; setTextColor(getColor(R.color.ink)); textSize = 16f; setTypeface(typeface, Typeface.BOLD) })
                    addView(TextView(context).apply {
                        text = s.actions.joinToString("  ·  ") { Car.label(it) }
                        setTextColor(getColor(R.color.ink2))
                        textSize = 13f
                        setPadding(0, dp(3), 0, 0)
                    })
                }, LinearLayout.LayoutParams(0, -2, 1f))
                addView(smallButton("Run", primary = true) {
                    if (busy || recording || !modelReady) return@smallButton
                    select(MYRA)
                    addBubble(s.name, user = true)
                    understand(s.name, null) { null }
                })
                addView(smallButton("Delete", primary = false) {
                    shortcuts.delete(s.name)
                    renderShortcuts()
                }, LinearLayout.LayoutParams(-2, dp(40)).apply { marginStart = dp(8) })
            })
        }
    }

    private fun smallButton(label: String, primary: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = label
        gravity = Gravity.CENTER
        textSize = 13f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(getColor(if (primary) R.color.bg else R.color.ink2))
        setBackgroundResource(if (primary) R.drawable.button else R.drawable.button_quiet)
        setPadding(dp(16), 0, dp(16), 0)
        layoutParams = LinearLayout.LayoutParams(-2, dp(40))
        setOnClickListener { onClick() }
    }

    private fun renderSystem() {
        val server = when (serverUp) { true -> "Server online"; false -> "Server unreachable"; null -> "Checking server…" }
        val mini = if (modelReady) "MiniLM ready · $modelLoadMs ms" else "MiniLM not loaded"
        val lm = if (llmReady) "${Llm.NAME} ready" else if (llmFile.exists()) "${Llm.NAME} not loaded" else "${Llm.NAME} not installed"
        system.text = "$server\n$mini\n$lm\n$freeMb MB RAM free"
    }

    private fun startPulse() {
        ring.visibility = View.VISIBLE
        pulse = ObjectAnimator.ofPropertyValuesHolder(ring,
            PropertyValuesHolder.ofFloat(View.SCALE_X, 0.8f, 1.1f), PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.8f, 1.1f),
            PropertyValuesHolder.ofFloat(View.ALPHA, 1f, 0.15f)).apply {
            duration = 1100
            repeatCount = ValueAnimator.INFINITE
            start()
        }
    }

    private fun stopPulse() {
        pulse?.cancel()
        pulse = null
        ring.visibility = View.INVISIBLE
    }

    /* ---------- resources ---------- */

    private fun freeMemory() {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        freeMb = info.availMem / (1024 * 1024)
        renderSystem()
    }

    private val keepAlive = object : Runnable {
        override fun run() {
            val id = generation
            val api = backend ?: return
            if (!recording && !busy) net?.execute {
                val up = api.ping()
                main.post {
                    if (id == generation) {
                        serverUp = up
                        freeMemory()
                    }
                }
            }
            main.postDelayed(this, 25_000)
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val MODEL = "MiniLM-L6"
        const val MYRA = 0
        const val METER = 1
        const val VOICE = 2
        const val SHORTCUTS = 3
        const val MAX_COMMAND_MS = 8_000L
        const val MAX_BUBBLES = 30
        /** Several requests in one sentence: MiniLM picks one intent, so these go to the LLM. */
        private val MULTI = Regex("""\b(and|then|also|plus)\b""")
        val EXAMPLES = listOf("Set the AC to 22", "It's too hot in here", "Turn up the volume and play music",
            "Whenever I say chill mode, set the AC to 20 and play music", "Next song", "Take me to the airport",
            "Turn the fan down", "Don't turn off the AC")
    }
}
