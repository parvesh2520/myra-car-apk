package com.myra.car

import android.Manifest
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.EditText
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import org.json.JSONArray
import org.osmdroid.config.Configuration
import org.osmdroid.util.GeoPoint
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import java.util.concurrent.LinkedBlockingQueue

/**
 * MYRA car app: say "Okay Myra …" (see [HandsFree]), hold the mic, or tap to start and tap to send; Sarvam turns the speech into English on the Render
 * backend, and the car's MiniLM classifier decides what to do: a saved shortcut first, then a shortcut being taught
 * or deleted, then each request in the sentence ("set the AC to 22 and play music"). Every step is timed.
 */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor() // model loading and inference, off the UI thread
    private var net: ExecutorService? = null
    private var backend: Backend? = null
    private val recorder = Recorder()
    @Volatile private var handsFree: HandsFree? = null // made on work, used on main and the mic thread
    private var ignoreWakeBefore = 0L // stream position where Myra last stopped speaking: her own "Myra" doesn't count
    private val car = Car()
    private val cameraPairing = CameraPairing()
    private lateinit var carAudio: CarAudio
    private lateinit var cabinVoice: CabinVoice
    private lateinit var cabins: DriverCabins
    private var speaker: SpeakerId? = null // work thread only
    private var activeDriver: String? = null
    private var voiceMatchAvailable = false
    private var announcedUnknownVoice = false
    private var greeted = false
    private var speakReplies = true // the driver's "Speak replies" switch, kept across launches
    private lateinit var shortcuts: Shortcuts // main thread only
    private lateinit var learned: Learned // main thread only; what the driver meant when Myra had to ask
    private var classifier: Classifier? = null // Accessed only by work.
    private var modelReady = false
    private var classifierFailed = false
    @Volatile private var generation = 0
    private var tab = MYRA // MYRA and SHORTCUTS share Myra's model; METER and VOICE run alone
    private var inForeground = false
    private var askedForMic = false
    private var monitor: MonitorView? = null
    private var voiceId: VoiceIdView? = null
    private lateinit var myraPane: View
    private lateinit var shortcutsPane: View
    private lateinit var meterPane: FrameLayout
    private lateinit var safeExitPane: FrameLayout
    private lateinit var voicePane: FrameLayout
    private lateinit var tabs: List<Pair<View, Int>>

    private lateinit var mic: View
    private lateinit var ring: View
    private lateinit var status: TextView
    private lateinit var system: TextView
    private lateinit var log: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var mediaState: TextView
    private lateinit var mediaSub: TextView
    private lateinit var mediaArt: ImageView
    private lateinit var mediaCover: View
    private lateinit var mediaProgressRow: View
    private lateinit var mediaProgress: ProgressBar
    private lateinit var mediaElapsed: TextView
    private lateinit var mediaTotal: TextView
    private var lastTrack = DemoTrack.CALM
    /** Moves the home player's progress bar once a second while a demo track plays. */
    private val progressTick = object : Runnable {
        override fun run() {
            renderProgress()
            if (carAudio.track != null && car.playing) main.postDelayed(this, 1000)
        }
    }
    private lateinit var mediaPlay: ImageView
    private lateinit var greeting: TextView
    private lateinit var greetingSub: TextView
    private lateinit var tryText: TextView
    private lateinit var driver: TextView
    private lateinit var acControl: View
    private lateinit var acIcon: ImageView
    private lateinit var ambientLine: View
    private lateinit var map: HomeMap
    private lateinit var mapNote: TextView
    private lateinit var saveHome: TextView
    private lateinit var roadName: TextView
    private lateinit var weatherIcon: ImageView
    private lateinit var weatherTemp: TextView
    private lateinit var weatherSky: TextView
    private lateinit var weatherPlace: TextView
    private lateinit var weatherRange: TextView
    private lateinit var weatherMore: TextView
    // Road label and weather widget, refreshed from GPS fixes (main thread).
    private var roadAt: Location? = null
    private var roadBusy = false
    private var weatherAt = 0L
    private val places by lazy { Places(this) }
    private var shownDestination: String? = null // the destination the map is showing a trip to
    private var tripNote: String? = null
    private var tripId = 0
    private val locations by lazy { getSystemService(LocationManager::class.java) }
    private val onLocation = object : LocationListener {
        override fun onLocationChanged(l: Location) {
            val first = map.position == null
            map.show(l)
            drove(l)
            if (shownDestination == null) mapNote.text = ""
            else if (first) showTrip() // the trip was asked for before the car knew where it was
        }
        // Android 10 has no default bodies for these: leaving them out crashes when a provider toggles.
        @Deprecated("") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }
    private lateinit var volumeText: TextView
    private lateinit var navDest: TextView
    private lateinit var navSub: TextView
    private lateinit var acState: TextView
    private lateinit var tempValue: TextView
    private lateinit var fanBars: LinearLayout
    private lateinit var fanText: TextView
    private lateinit var seatText: TextView
    private lateinit var ambientSwatch: View
    private lateinit var ambientLabel: TextView
    private lateinit var shortcutSummary: TextView
    private lateinit var shortcutList: LinearLayout
    private var pulse: ValueAnimator? = null

    private var recording = false
    private var toggleMode = false
    private var busy = false
    private class PendingQuestion(val question: CabinQuestion, val controls: View, val source: String)
    private var pendingQuestion: PendingQuestion? = null
    private var queuedQuestion: CabinQuestion? = null
    private val questionTimeout = Runnable {
        clearQuestion()
        if (!busy && !recording && modelReady) readyStatus()
    }
    private var tPress = 0L
    private var serverUp: Boolean? = null
    private var freeMb = 0L
    private var modelLoadMs = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Configuration.getInstance().apply { // before the map view is inflated
            userAgentValue = packageName
            osmdroidBasePath = File(cacheDir, "osm")
            osmdroidTileCache = File(cacheDir, "osm/tiles")
        }
        setContentView(R.layout.car_shell)
        carAudio = CarAudio(this)
        cabinVoice = CabinVoice(this) { speaking ->
            carAudio.duck(speaking || recording)
            if (!speaking) {
                recorder.clearPreroll()
                ignoreWakeBefore = recorder.position
                if (modelReady && !busy && !recording) readyStatus()
                queuedQuestion?.let { question ->
                    queuedQuestion = null
                    cabinVoice.speak(question.spoken)
                }
            }
        }
        cabins = DriverCabins(this)
        greeted = savedInstanceState?.getBoolean("greeted") ?: false
        activeDriver = savedInstanceState?.getString("activeDriver")
        activeDriver?.let { car.restore(cabins.load(it)) }
        car.syncVolume(carAudio.volume)
        shortcuts = Shortcuts(File(filesDir, "shortcuts.json"))
        learned = Learned(File(filesDir, "learned.json"))
        myraPane = findViewById(R.id.myraPane)
        shortcutsPane = findViewById(R.id.shortcutsPane)
        meterPane = findViewById(R.id.meterPane)
        safeExitPane = findViewById(R.id.safeExitPane)
        voicePane = findViewById(R.id.voicePane)
        tabs = listOf(findViewById<View>(R.id.myraTab) to MYRA, findViewById<View>(R.id.shortcutsTab) to SHORTCUTS,
            findViewById<View>(R.id.meterTab) to METER, findViewById<View>(R.id.safeExitTab) to SAFE_EXIT,
            findViewById<View>(R.id.voiceTab) to VOICE)
        for ((view, id) in tabs) view.setOnClickListener { select(id) }
        tab = savedInstanceState?.getInt("tab") ?: MYRA
        if (packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
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
        mediaState = findViewById(R.id.mediaState)
        mediaSub = findViewById(R.id.mediaSub)
        mediaArt = findViewById(R.id.mediaArt)
        mediaCover = findViewById(R.id.mediaCover)
        mediaProgressRow = findViewById(R.id.mediaProgressRow)
        mediaProgress = findViewById(R.id.mediaProgress)
        mediaElapsed = findViewById(R.id.mediaElapsed)
        mediaTotal = findViewById(R.id.mediaTotal)
        mediaPlay = findViewById(R.id.mediaPlay)
        driver = findViewById(R.id.driver)
        acControl = findViewById(R.id.acControl)
        acIcon = findViewById(R.id.acIcon)
        ambientLine = findViewById(R.id.ambientLine)
        map = findViewById(R.id.map)
        mapNote = findViewById(R.id.mapNote)
        // The map note only shows while it has something to say.
        mapNote.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) { mapNote.visibility = if (s.isNullOrEmpty()) View.GONE else View.VISIBLE }
        })
        saveHome = findViewById(R.id.saveHome)
        roadName = findViewById(R.id.roadName)
        weatherIcon = findViewById(R.id.weatherIcon)
        weatherTemp = findViewById(R.id.weatherTemp)
        weatherSky = findViewById(R.id.weatherSky)
        weatherPlace = findViewById(R.id.weatherPlace)
        weatherRange = findViewById(R.id.weatherRange)
        weatherMore = findViewById(R.id.weatherMore)
        val quickKeys = findViewById<LinearLayout>(R.id.quickKeys)
        val quickIcons = listOf(R.drawable.ic_fuel, R.drawable.ic_parking, R.drawable.ic_food, R.drawable.ic_hospital)
        for ((place, icon) in Places.QUICK.keys.zip(quickIcons)) {
            quickKeys.addView(TextView(this).apply {
                text = place
                textSize = 13f
                setTextColor(getColor(R.color.home_ink))
                gravity = Gravity.CENTER_VERTICAL
                setBackgroundResource(R.drawable.home_chip_map)
                maxLines = 1
                setCompoundDrawablesRelative(getDrawable(icon)!!.mutate().apply {
                    setTint(getColor(R.color.home_ink2)); setBounds(0, 0, dp(16), dp(16))
                }, null, null, null)
                compoundDrawablePadding = dp(8)
                setPadding(dp(12), 0, dp(14), 0)
                contentDescription = "Route to the nearest ${place.lowercase()}"
                setOnClickListener { tap(JSONObject().put("type", "nav.start").put("destination", place)) }
            }, LinearLayout.LayoutParams(-2, -1).apply { marginEnd = dp(8) })
        }
        map.home = places.home
        car.homeSaved = map.home != null
        saveHome.setOnClickListener { setHome() }
        volumeText = findViewById(R.id.volumeText)
        navDest = findViewById(R.id.navDest)
        navSub = findViewById(R.id.navSub)
        acState = findViewById(R.id.acState)
        tempValue = findViewById(R.id.tempValue)
        fanBars = findViewById(R.id.fanBars)
        fanText = findViewById(R.id.fanText)
        seatText = findViewById(R.id.seatText)
        ambientSwatch = findViewById(R.id.ambientSwatch)
        ambientLabel = findViewById(R.id.ambientLabel)
        findViewById<View>(R.id.ambientControl).setOnClickListener {
            if (!recording && !busy) chooseAmbient()
        }
        // Touch controls run the same actions Myra runs for a spoken request.
        acControl.setOnClickListener { tap(JSONObject().put("type", "climate.power").put("on", !car.acOn)) }
        findViewById<View>(R.id.tempDown).setOnClickListener { tap(JSONObject().put("type", "climate.adjustTemp").put("delta", -1)) }
        findViewById<View>(R.id.tempUp).setOnClickListener { tap(JSONObject().put("type", "climate.adjustTemp").put("delta", 1)) }
        findViewById<View>(R.id.fanDown).setOnClickListener { tap(JSONObject().put("type", "climate.fan").put("delta", -1)) }
        findViewById<View>(R.id.fanUp).setOnClickListener { tap(JSONObject().put("type", "climate.fan").put("delta", 1)) }
        // With no track loaded, the home player's keys start the app's demo music.
        findViewById<View>(R.id.mediaPrev).setOnClickListener { tap(if (carAudio.track == null) playDemo() else JSONObject().put("type", "media.skip").put("dir", -1)) }
        findViewById<View>(R.id.mediaNext).setOnClickListener { tap(if (carAudio.track == null) playDemo() else JSONObject().put("type", "media.skip").put("dir", 1)) }
        findViewById<View>(R.id.volumeDown).setOnClickListener { tap(JSONObject().put("type", "media.volume").put("delta", -2)) }
        findViewById<View>(R.id.volumeUp).setOnClickListener { tap(JSONObject().put("type", "media.volume").put("delta", 2)) }
        mediaPlay.setOnClickListener {
            tap(when {
                car.playing -> JSONObject().put("type", "media.pause")
                carAudio.track == null -> playDemo()
                else -> JSONObject().put("type", "media.play")
            })
        }
        shortcutSummary = findViewById(R.id.shortcutSummary)
        shortcutList = findViewById(R.id.shortcutList)
        for (i in 0 until 7) fanBars.addView(View(this), LinearLayout.LayoutParams(dp(6), dp(8 + 3 * i)).apply { marginEnd = dp(3) })

        val prefs = getSharedPreferences("myra", Context.MODE_PRIVATE)
        speakReplies = prefs.getBoolean("speakReplies", true)
        findViewById<Switch>(R.id.speakReplies).apply {
            isChecked = speakReplies
            setOnCheckedChangeListener { _, on ->
                speakReplies = on
                prefs.edit().putBoolean("speakReplies", on).apply()
                if (!on && pendingQuestion == null) cabinVoice.stop()
            }
        }
        if (!android.provider.Settings.canDrawOverlays(this) && !prefs.getBoolean("askedAutoStart", false)) {
            prefs.edit().putBoolean("askedAutoStart", true).apply()
            AlertDialog.Builder(this)
                .setTitle("Open Myra when the car starts?")
                .setMessage("Allow “Display over other apps” for MYRA, and it will open by itself every time the car turns on.")
                .setPositiveButton("Allow") { _, _ ->
                    runCatching { startActivity(Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        android.net.Uri.parse("package:$packageName"))) }
                }
                .setNegativeButton("Not now", null)
                .show()
        }
        mic.setOnTouchListener { _, e -> onMicTouch(e); true }
        val chips = findViewById<LinearLayout>(R.id.chips)
        for (text in EXAMPLES) {
            chips.addView(TextView(this).apply {
                this.text = text
                setTextColor(getColor(R.color.home_ink2))
                textSize = 13f
                setBackgroundResource(R.drawable.home_chip)
                setPadding(dp(14), dp(8), dp(14), dp(8))
                layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(8) }
                setOnClickListener { if (!busy && !recording) typed(text) }
            })
        }
        greeting = findViewById(R.id.greeting)
        greetingSub = findViewById(R.id.greetingSub)
        tryText = findViewById(R.id.tryText)
        findViewById<View>(R.id.tryCard).setOnClickListener { if (!busy && !recording) typed(tryText.tag as String) }
        findViewById<View>(R.id.navCard).clipToOutline = true // round the map's corners to the card
        renderState()
        renderTabs()
        renderShortcuts()
        renderSystem()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt("tab", tab)
        outState.putBoolean("greeted", greeted)
        outState.putString("activeDriver", activeDriver)
        super.onSaveInstanceState(outState)
    }

    private fun usesMyra(t: Int) = t == MYRA || t == SHORTCUTS

    private fun select(next: Int) {
        if (next == tab) {
            // Tapping Myra again retries a model that failed to load, without restarting the app.
            if (next == MYRA && !modelReady && !busy && !recording && classifierFailed) { pauseMyra(); startMyra() }
            return
        }
        if (usesMyra(tab) && usesMyra(next)) { // same model: just switch the screen
            if (recording) send()
            tab = next
            renderTabs()
            return
        }
        when (tab) {
            MYRA, SHORTCUTS -> pauseMyra()
            METER, SAFE_EXIT -> { generation++; closeMonitor() }
            VOICE -> { generation++; closeVoiceId() }
        }
        tab = next
        renderTabs()
        openTab()
    }

    private fun openTab() = when (tab) {
        METER -> openAfterRelease(meterPane) { MonitorView(this, MonitorMode.DROWSINESS, cameraPairing).also { monitor = it } }
        SAFE_EXIT -> openAfterRelease(safeExitPane) { MonitorView(this, MonitorMode.SAFE_EXIT, cameraPairing).also { monitor = it } }
        VOICE -> openAfterRelease(voicePane) {
            VoiceIdView(this) { driver, cabin ->
                if (driver == activeDriver) {
                    car.restore(cabin)
                    renderState()
                }
            }.also { voiceId = it }
        }
        else -> startMyra()
    }

    private fun renderTabs() {
        myraPane.visibility = if (tab == MYRA) View.VISIBLE else View.GONE
        shortcutsPane.visibility = if (tab == SHORTCUTS) View.VISIBLE else View.GONE
        meterPane.visibility = if (tab == METER) View.VISIBLE else View.GONE
        safeExitPane.visibility = if (tab == SAFE_EXIT) View.VISIBLE else View.GONE
        voicePane.visibility = if (tab == VOICE) View.VISIBLE else View.GONE
        for ((view, id) in tabs) view.isSelected = tab == id
    }

    private fun startMyra() {
        val id = ++generation
        backend = Backend()
        net = Executors.newCachedThreadPool()
        status.text = "Loading Myra…"
        freeMemory()
        val previousDriver = activeDriver
        work.execute {
            if (id != generation) return@execute
            val t = SystemClock.elapsedRealtime()
            val c = runCatching { Classifier(this) }
            classifier = c.getOrNull()
            val enrolled = if (c.isSuccess) runCatching { SpeakerId.enrolledDrivers(this) }.getOrDefault(emptySet()) else emptySet()
            val driver = previousDriver?.takeIf { it in enrolled }
            if (driver == null && enrolled.isNotEmpty() && id == generation) {
                speaker = runCatching { SpeakerId(this) }.getOrNull()
            }
            val canMatch = speaker != null
            main.post {
                if (id != generation) return@post
                modelReady = c.isSuccess
                classifierFailed = c.isFailure
                if (c.isSuccess && previousDriver != null && driver == null) {
                    activeDriver = null
                    car.restore(Cabin())
                    renderState()
                }
                voiceMatchAvailable = canMatch
                c.exceptionOrNull()?.let { status.text = "Model failed to load: ${it.message}. Tap Home to retry." }
                    ?: run { readyStatus(); modelLoadMs = SystemClock.elapsedRealtime() - t }
                renderSystem()
                if (modelReady && !greeted) greet()
            }
            if (c.isFailure || id != generation) return@execute
            // Loaded after Myra is ready: the first launch also copies the 68 MB model out of the APK.
            val hf = runCatching {
                HandsFree(this, onWake = { pos -> main.post { if (id == generation) wake(pos) } },
                    onEnd = { main.post { if (id == generation && recording && handsFreeCommand) send() } })
            }.onFailure { android.util.Log.w("Myra", "wake word unavailable", it) }.getOrNull()
            main.post {
                if (id != generation) { hf?.let { work.execute { it.close() } }; return@post }
                handsFree = hf
                recorder.tap = hf?.let { it::onAudio }
                if (!busy && !recording) readyStatus()
            }
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) openMic()
        // One dialog for both: Android drops a second request made while the first is showing.
        val missing = arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.ACCESS_FINE_LOCATION)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty() && !askedForMic) {
            askedForMic = true
            requestPermissions(missing.toTypedArray(), 1)
        }
        main.post(keepAlive)
    }

    private fun pauseMyra() {
        generation++
        main.removeCallbacks(keepAlive)
        main.removeCallbacks(autoSend)
        val oldBackend = backend
        backend = null
        net?.shutdownNow()
        net = null
        recorder.tap = null
        val oldHandsFree = handsFree
        handsFree = null
        recorder.close()
        recording = false
        toggleMode = false
        handsFreeCommand = false
        busy = false
        heardSpeech = false
        voiceSample = null
        voiceMatchAvailable = false
        pendingTranscript = null
        clearQuestion()
        modelReady = false
        classifierFailed = false
        stopPulse()
        cabinVoice.stop()
        carAudio.duck(false)
        work.execute {
            classifier?.close()
            classifier = null
            speaker?.close()
            speaker = null
            oldBackend?.close()
            oldHandsFree?.close()
        }
    }

    /** Opens a tab's view once `work` has closed Myra's model, so two screens' models are never in memory together. */
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
        voiceId?.destroy()?.let { released -> work.execute { runCatching { released.get() } } }
        voiceId = null
    }

    private fun closeMonitor() {
        meterPane.removeAllViews()
        safeExitPane.removeAllViews()
        monitor?.destroy()?.let { closed -> work.execute { runCatching { closed.get() } } }
        monitor = null
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 1 || !inForeground) return
        if (Manifest.permission.ACCESS_FINE_LOCATION in permissions) startLocation()
        val mic = permissions.indexOf(Manifest.permission.RECORD_AUDIO)
        if (mic < 0 || !usesMyra(tab)) return
        if (grantResults.getOrNull(mic) == PackageManager.PERMISSION_GRANTED) openMic()
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
        startLocation()
    }

    /** Home for "take me home": an address searched on the map, or where the car is now. */
    private fun setHome() {
        val field = EditText(this).apply {
            hint = "Home address, e.g. Hill Road, Bandra"
            setSingleLine()
            setBackgroundResource(R.drawable.field)
            setTextColor(getColor(R.color.ink))
            setHintTextColor(getColor(R.color.ink3))
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        val here = map.position
        val box = FrameLayout(this).apply { setPadding(dp(24), dp(8), dp(24), 0); addView(field) }
        AlertDialog.Builder(this)
            .setTitle(if (places.home == null) "Set home" else "Change home")
            .setMessage(if (here != null) "Search for your home address, or save where the car is now." else "Search for your home address.")
            .setView(box)
            .setPositiveButton("Search") { _, _ ->
                val query = field.text.toString().trim()
                if (query.isEmpty()) return@setPositiveButton
                mapNote.text = "Finding $query…"
                Thread {
                    val found = runCatching { places.search(query, map.position) }
                    main.post {
                        val p = found.getOrNull()
                        if (p != null) saveHomeAt(p)
                        else mapNote.text = if (found.isFailure) "Couldn't reach the map service" else "Couldn't find “$query”"
                    }
                }.start()
            }
            .apply { if (here != null) setNeutralButton("Use current location") { _, _ -> saveHomeAt(here) } }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun saveHomeAt(p: GeoPoint) {
        places.home = p
        map.home = p
        car.homeSaved = true
        map.look(p)
        mapNote.text = "Home saved"
        renderState()
    }

    /** Shows the trip to [shownDestination] on the home map: looked up and routed off the main thread, then animated. */
    private fun showTrip() {
        val id = ++tripId
        val dest = shownDestination
        tripNote = null
        if (dest == null) {
            map.clearTrip()
            mapNote.text = if (map.position != null) "" else "Finding your location"
            return
        }
        val from = map.position
        if (from == null) { tripNote = "Waiting for your location"; return }
        mapNote.text = "Finding $dest…"
        Thread {
            val found = runCatching {
                places.find(dest, from)?.let { to ->
                    // Demo: already there (home saved where the car stands), so the trip starts ~3 km away.
                    val start = if (from.distanceToAsDouble(to) < 500) GeoPoint(from.latitude + 0.02, from.longitude + 0.015) else from
                    places.route(start, to)
                }
            }
            main.post {
                if (id != tripId) return@post
                val route = found.getOrNull()
                tripNote = when {
                    found.isFailure -> "Couldn't reach the map service"
                    route == null -> "Couldn't find $dest on the map"
                    else -> "%.1f km · demo trip".format(route.km)
                }
                if (route == null) mapNote.text = ""
                else {
                    mapNote.text = "Route to $dest"
                    map.drive(route.points)
                }
                renderState()
            }
        }.start()
    }

    /** One GPS fix: throttled, off the main thread, the map's road name and the weather widget. */
    private fun drove(l: Location) {
        val here = GeoPoint(l.latitude, l.longitude)
        if (!roadBusy && (roadAt?.distanceTo(l) ?: Float.MAX_VALUE) > 150) {
            roadBusy = true
            Thread {
                val spot = runCatching { places.spot(here) }.getOrNull()
                main.post {
                    roadBusy = false
                    if (spot == null) return@post
                    roadAt = l
                    spot.road?.let { roadName.text = it; roadName.visibility = View.VISIBLE }
                    spot.area?.let { weatherPlace.text = it }
                }
            }.start()
        }
        val now = SystemClock.elapsedRealtime()
        if (weatherAt == 0L || now - weatherAt > 15 * 60_000) {
            weatherAt = now
            Thread {
                val w = runCatching { places.weather(here) }.getOrNull()
                main.post {
                    if (w == null) { weatherAt = now - 14 * 60_000; return@post } // retry in a minute
                    weatherIcon.setImageResource(w.icon)
                    weatherTemp.text = "${w.temp}°"
                    weatherSky.text = w.sky
                    weatherRange.text = "High ${w.high}° · Low ${w.low}°"
                    weatherMore.text = "Humidity ${w.humidity}% · Wind ${w.windKmh} km/h"
                }
            }.start()
        }
    }

    /** Follows the car on the home map with GPS and network fixes, whichever arrives. */
    private fun startLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            mapNote.text = "Location permission is off"
            return
        }
        locations.removeUpdates(onLocation)
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { locations.isProviderEnabled(it) }
        if (providers.isEmpty()) { mapNote.text = "Location is turned off"; return }
        providers.mapNotNull { locations.getLastKnownLocation(it) }.maxByOrNull { it.time }?.let(onLocation::onLocationChanged)
        for (p in providers) locations.requestLocationUpdates(p, 2000L, 5f, onLocation, Looper.getMainLooper())
    }

    override fun onStop() {
        inForeground = false
        locations.removeUpdates(onLocation)
        when (tab) {
            MYRA, SHORTCUTS -> pauseMyra()
            METER, SAFE_EXIT -> { generation++; closeMonitor() }
            VOICE -> { generation++; closeVoiceId() }
        }
        if (carAudio.track != null) {
            carAudio.close()
            car.run(JSONObject().put("type", "media.pause"))
        }
        super.onStop()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        cabinVoice.close()
        carAudio.close()
        work.shutdown()
        super.onDestroy()
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

    /** The wake word ended at stream byte [pos]: record the command from there, as if the mic had been tapped. */
    private fun wake(pos: Long) {
        if (!inForeground || !usesMyra(tab) || recording || busy || cabinVoice.speaking) return
        if (pos < ignoreWakeBefore && ignoreWakeBefore <= recorder.position) return // still Myra's own voice
        startRecording(pos)
    }

    /** [from]: hands-free, the command starts at this stream position and ends when the driver stops speaking. */
    private fun startRecording(from: Long? = null) {
        if (!modelReady) { status.text = "The model is still loading…"; return }
        if (cabinVoice.speaking) {
            status.text = "Myra is speaking… try the mic when she finishes."
            return
        }
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
        toggleMode = from != null // hands-free: a tap on the mic sends at once
        handsFreeCommand = from != null
        val queue = LinkedBlockingQueue<ByteArray>()
        val captureVoice = activeDriver == null && voiceMatchAvailable
        // The first hands-free words before a profile is set ("Hi Myra"): voice ID also hears the wake word, and
        // when nothing follows within FIRST_WAKE_WAIT_MS it was a greeting ([greetFromWake]).
        firstWake = from != null && captureVoice
        val cmd = ++commandSeq
        if (from != null) {
            handsFree?.beginCommand(from, if (firstWake) FIRST_WAKE_WAIT_MS else Endpointer.NO_SPEECH_MS)
            recorder.startAt(from, queue, captureVoice, voiceFrom = maxOf(from - WAKE_LOOKBACK_MS * 32, ignoreWakeBefore))
        } else recorder.start(queue, captureVoice)
        carAudio.duck(true)
        status.text = if (from != null) "Listening… I’ll send when you stop speaking" else "Listening… release to send"
        startPulse()
        // The upload starts now and runs while the driver speaks.
        executor.execute {
            val transcript = runCatching { api.transcribe(queue) }
                .getOrElse { Transcript("", null, "Can't reach the speech service (${it.javaClass.simpleName}).") }
            val tHeard = SystemClock.elapsedRealtime()
            main.post {
                if (id != generation || cmd == droppedCommand) return@post
                if (recording) pendingTranscript = transcript to tHeard else heard(transcript, tHeard)
            }
        }
        main.postDelayed(autoSend, MAX_COMMAND_MS)
    }

    private val autoSend = Runnable { if (recording) send() }

    private var handsFreeCommand = false
    private var firstWake = false
    private var commandSeq = 0
    private var droppedCommand = -1 // a command answered without its transcript
    private var tReleased = 0L
    private var heardSpeech = false
    private var voiceSample: ByteArray? = null
    private var pendingTranscript: Pair<Transcript, Long>? = null

    private fun send() {
        main.removeCallbacks(autoSend)
        handsFree?.endCommand()
        recording = false
        toggleMode = false
        handsFreeCommand = false
        busy = true
        tReleased = SystemClock.elapsedRealtime()
        recorder.stop()
        voiceSample = recorder.takeVoice()
        carAudio.duck(false)
        heardSpeech = recorder.peakRms >= Recorder.SPEECH_RMS
        stopPulse()
        val sample = voiceSample
        if (firstWake && !heardSpeech && sample != null) {
            firstWake = false
            voiceSample = null
            droppedCommand = commandSeq
            pendingTranscript = null
            return greetFromWake(sample)
        }
        firstWake = false
        status.text = "Recognising…"
        pendingTranscript?.let { (transcript, _) -> heard(transcript, tReleased) }
        pendingTranscript = null
    }

    private fun heard(raw: Transcript, tHeard: Long) {
        val sample = voiceSample.also { voiceSample = null }
        val t = raw.copy(text = Wake.strip(raw.text))
        if (!heardSpeech) { // only silence was recorded: whatever came back was not said
            busy = false
            status.text = "I didn't hear anything. Say “Okay Myra” or hold the mic."
            return
        }
        if (t.text.isBlank()) {
            busy = false
            status.text = t.error?.take(120) ?: "I didn't hear anything. Try again."
            return
        }
        val id = generation
        if (sample == null) {
            understand(t.text, t.engine) { r -> timeline(t, tHeard, r.ms) }
            return
        }
        status.text = "Recognising your voice…"
        work.execute {
            if (id != generation) return@execute
            val match = runCatching { speaker?.identify(Recorder.samples(sample)) }.getOrNull()
            if (match != null) {
                speaker?.close()
                speaker = null
            }
            // "Hi Myra" as the first words: the profile line is the whole reply.
            val greeting = match != null && runCatching { classifier?.classify(t.text) }.getOrNull()
                ?.let { it.intent == "greeting" && it.confidence >= Car.MIN_CONFIDENCE } == true
            main.post {
                if (id != generation) return@post
                if (match != null) {
                    val line = setProfile(match.profile, if (greeting) t.text else "Driver profile · ${match.profile}", greeting)
                    if (greeting) {
                        busy = false
                        readyStatus()
                        net?.execute { backend?.log(t.text, emptyList(), MODEL, 0, t.engine, line) }
                        return@post
                    }
                } else if (!announcedUnknownVoice) {
                    announcedUnknownVoice = true
                    val message = VoiceLines.DRIVER_UNKNOWN
                    showReply(addCommand("Voice ID"), message, null)
                    cabinVoice.speak(message)
                }
                understand(t.text, t.engine) { r -> timeline(t, tHeard, r.ms) }
            }
        }
    }

    /**
     * Loads the recognised driver's cabin and says so; returns the spoken line. A greeting gets the whole
     * "I have set your profile" line; before a command only "Hi Kanishk.", then the command (which wins over the
     * profile: "set the AC to 20" with 22 saved ends at 20).
     */
    private fun setProfile(profile: String, entry: String, greeting: Boolean): String {
        activeDriver = profile
        voiceMatchAvailable = false
        car.restore(cabins.load(profile))
        val cabin = "AC ${if (car.acOn) "on" else "off"} · ${car.temp}°C · fan ${car.fan} · " +
            "${car.light.key} light · seat ${car.seatHeight}"
        val line = if (greeting) VoiceLines.driverMatched(profile) else VoiceLines.hiDriver(profile)
        showReply(addCommand(entry), if (greeting) line.replace("Hi,", "Hi $profile,") else "Hi $profile, your profile is loaded.", cabin)
        renderState()
        cabinVoice.speak(line)
        return line
    }

    /** The first wake word with nothing after it ("Hi Myra"): recognise the voice from it and greet the driver. */
    private fun greetFromWake(sample: ByteArray) {
        status.text = "Recognising your voice…"
        val id = generation
        work.execute {
            if (id != generation) return@execute
            val match = runCatching { speaker?.identify(Recorder.samples(sample)) }.getOrNull()
            if (match != null) {
                speaker?.close()
                speaker = null
            }
            main.post {
                if (id != generation) return@post
                busy = false
                readyStatus()
                val line = match?.let { setProfile(it.profile, "Hi Myra", greeting = true) }
                    ?: VoiceLines.hello(null).also { showReply(addCommand("Hi Myra"), it, null); cabinVoice.speak(it) }
                net?.execute { backend?.log("Hi Myra", emptyList(), MODEL, 0, null, line) }
            }
        }
    }

    private fun greet() {
        greeted = true
        val greeting = VoiceLines.greeting(Calendar.getInstance().get(Calendar.HOUR_OF_DAY))
        showReply(addCommand("Myra"), greeting, null)
        cabinVoice.speak(greeting)
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
        understand(text, null) { null }
    }

    private fun readyStatus() {
        val how = if (handsFree != null) "Say “Okay Myra” or hold the mic" else "Hold the mic"
        status.text = if (pendingQuestion == null) "$how and speak" else "$how to answer"
    }

    private fun clearQuestion() {
        main.removeCallbacks(questionTimeout)
        pendingQuestion?.controls?.let { (it.parent as? LinearLayout)?.removeView(it) }
        pendingQuestion = null
        queuedQuestion = null
    }

    private fun showQuestion(question: CabinQuestion, row: LinearLayout, source: String) {
        clearQuestion()
        if (question.buttons.isNotEmpty()) {
            val controls = HorizontalScrollView(this)
            val pending = PendingQuestion(question, controls, source)
            pendingQuestion = pending
            main.postDelayed(questionTimeout, 30_000L)
            val picker = LinearLayout(this).apply {
                for ((label, answer) in question.buttons) {
                    addView(smallButton(label, primary = false) {
                        if (pendingQuestion === pending && !busy && !recording) typed(answer)
                    }, LinearLayout.LayoutParams(-2, dp(44)).apply { marginEnd = dp(8) })
                }
            }
            controls.addView(picker)
            row.addView(controls)
            scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
        }
        readyStatus()
        if (cabinVoice.speaking) queuedQuestion = question else cabinVoice.speak(question.spoken)
    }

    /** What one sentence did: the reply, which model decided, how long it took, and the commands to log. */
    /** [spoken]: what Myra says aloud, when it differs from the [text] on screen. */
    private class Reply(val text: String, val detail: String, val ms: Long, val commands: List<Map<String, Any>>, val spoken: String = text)

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
                    val audioResult = out.audio?.let { runCatching { carAudio.apply(it, car, out.genre) } }
                    if (out.genre != null && audioResult?.isFailure == true) {
                        car.run(JSONObject().put("type", "media.pause"))
                        replies += "I couldn't play that track. Please try again."
                        continue
                    }
                    replies += out.reply
                    out.command?.let { commands += it }
                }
            }
        }
        return replies.joinToString(" ") to commands
    }

    /**
     * Decides what [text] means and does it, all with MiniLM on the car. Order: a saved shortcut (instant), a
     * shortcut being taught ("whenever I say chill mode, set the AC to 20 and play music": each action classified on
     * its own) or deleted, several requests in one sentence (each part classified), else the sentence as one request.
     */
    private fun understand(text: String, asr: String?, timing: (Reply) -> String?) {
        val id = generation
        val executor = net ?: return
        val api = backend ?: return
        busy = true
        val entry = addCommand(text)
        val before = car.cabin()
        fun finish(r: Reply) {
            busy = false
            readyStatus()
            showReply(entry, r.text, listOfNotNull("$MODEL · ${r.detail}", timing(r)).joinToString("\n"))
            if (speakReplies && r.detail != "clarification") cabinVoice.speakAfter(VoiceLines.forReply(r.spoken)) // a question speaks itself
            saveCabinChange(before)
            renderState()
            executor.execute { api.log(text, r.commands, MODEL, r.ms, asr, r.text) }
        }
        fun runShortcut(shortcut: Shortcuts.Shortcut, match: String, ms: Long) {
            val (reply, commands) = runActions(shortcut.actions)
            val name = shortcut.name.replaceFirstChar { it.uppercase() }
            finish(Reply("$name: $reply", "$match, ${shortcut.actions.size} actions", ms, commands, spoken = reply))
        }
        fun ask(question: CabinQuestion, ms: Long) {
            finish(Reply(question.text, "clarification", ms, emptyList()))
            showQuestion(question, entry, text)
        }
        pendingQuestion?.let { pending ->
            when (val answer = CabinDialogue.answer(pending.question, text)) {
                is CabinAnswer.Apply -> {
                    learned.remember(pending.source, answer.action) // next time this wording just works
                    clearQuestion()
                    cabinVoice.stop()
                    val (reply, commands) = runActions(listOf(answer.action))
                    return finish(Reply(reply, "confirmed action", 0, commands))
                }
                CabinAnswer.Decline -> {
                    clearQuestion()
                    cabinVoice.stop()
                    return finish(Reply("Okay, I’ll leave it as it is.", "clarification declined", 0, emptyList()))
                }
                CabinAnswer.Repeat -> return ask(pending.question, 0)
                CabinAnswer.NewRequest -> clearQuestion()
            }
        }
        // "remove the X" is only a shortcut deletion when it says so or names a saved shortcut.
        val deletion = Shortcuts.isDelete(text)?.takeIf { n -> "shortcut" in text.lowercase() || shortcuts.all.any { it.name == Shortcuts.normalize(n) } }
        val definition = Shortcuts.parseDefinition(text)
        val shortcut = if (deletion == null && definition == null) shortcuts.match(text) else null
        if (shortcut != null) return runShortcut(shortcut, "shortcut", 0)
        val savedShortcuts = if (deletion == null && definition == null) shortcuts.all.toList() else emptyList()
        val memory = learned.all
        status.text = "Understanding…"
        work.execute {
            if (id != generation) return@execute
            val c = classifier
            if (c == null) {
                main.post { if (id == generation) { busy = false; status.text = "The model isn't loaded. Tap Home." } }
                return@execute
            }
            val t0 = SystemClock.elapsedRealtime()
            // The model also recognises shortcut definitions and deletions the fixed patterns miss, by the name it tags.
            val whole = if (definition == null && deletion == null) runCatching { c.classify(text) }.getOrNull() else null
            val name = whole?.takeIf { it.confidence >= Car.MIN_CONFIDENCE && it.negated < .5f }?.slots?.get("NAME")
            val shortcutDefinition = definition ?: name?.takeIf { whole.intent == "shortcut_define" }?.let { Shortcuts.definitionAfter(text, it) }
            val shortcutDeletion = deletion ?: name?.takeIf { whole.intent == "shortcut_delete" }
            // Shortcut steps are saved, not run now, so no clarifying questions: take each step's best action.
            val defActions = shortcutDefinition?.second?.mapNotNull { part -> runCatching {
                CockpitRequests.parse(part) ?: c.classify(part).let { r ->
                    if (r.confidence >= Car.MIN_CONFIDENCE && r.negated < 0.5f) Car.action(r.intent, part, r.slots) else null }
            }.getOrNull() }
            val plain = shortcutDefinition == null && shortcutDeletion == null
            val recalled = if (plain) memory.recall(text, c::meaning) else null
            val parts = if (plain && recalled == null) Shortcuts.clauses(text) else emptyList()
            // Several requests: only when every part is a clear request on its own ("navigate to Bandra and Juhu" is one).
            val partRequests = if (parts.size < 2) null else parts.map { p -> runCatching { c.resolve(p) }.getOrNull() }
            val multi = partRequests?.map { it?.action }?.takeIf { acts -> acts.all { it != null } }?.filterNotNull()
            val needsSeparateRequests = partRequests?.any { it?.question != null && it.question != CabinQuestion.Rephrase } == true
            val relatedShortcut = if (plain && recalled == null && savedShortcuts.isNotEmpty() && parts.size <= 1 && CockpitRequests.parse(text) == null) {
                c.matchShortcut(text, savedShortcuts)
            } else null
            val request = if (plain && recalled == null && multi == null && !needsSeparateRequests && relatedShortcut == null) {
                runCatching { c.resolve(text) }.getOrNull()
            } else null
            val u = request?.understanding
            val ms = SystemClock.elapsedRealtime() - t0
            main.post {
                if (id != generation) return@post
                when {
                    shortcutDefinition != null && !defActions.isNullOrEmpty() -> {
                        val (reply, commands) = runActions(listOf(JSONObject().put("type", "shortcut.save").put("name", shortcutDefinition.first)
                            .put("do", JSONArray(defActions))))
                        finish(Reply(reply, "new shortcut, ${defActions.size} of ${shortcutDefinition.second.size} actions understood", ms, commands))
                    }
                    shortcutDefinition != null -> finish(Reply("I couldn't tell what “${shortcutDefinition.first}” should do. Try: whenever I say ${shortcutDefinition.first}, set the AC to 20 and play music.",
                        "new shortcut, no action understood", ms, emptyList()))
                    shortcutDeletion != null -> {
                        val (reply, commands) = runActions(listOf(JSONObject().put("type", "shortcut.delete").put("name", shortcutDeletion)))
                        finish(Reply(reply, "delete shortcut", ms, commands))
                    }
                    recalled != null -> {
                        val (reply, commands) = runActions(listOf(recalled))
                        finish(Reply(reply, "remembered from an earlier answer", ms, commands))
                    }
                    multi != null -> {
                        val (reply, commands) = runActions(multi)
                        finish(Reply(reply, "${multi.size} requests in one sentence", ms, commands))
                    }
                    needsSeparateRequests -> finish(Reply("Could you say those requests one at a time?", "multiple requests need clarification", ms, emptyList()))
                    relatedShortcut is ShortcutMatch.Found -> {
                        if (relatedShortcut.shortcut in shortcuts.all) runShortcut(relatedShortcut.shortcut, "similar shortcut phrase", ms)
                        else finish(Reply("That shortcut changed. Try saying it again.", "shortcut changed", ms, emptyList()))
                    }
                    relatedShortcut is ShortcutMatch.Ambiguous -> {
                        val names = relatedShortcut.names.joinToString(" or ") { "“$it”" }
                        finish(Reply("Which shortcut did you mean? Say $names.", "similar shortcut names", ms, emptyList()))
                    }
                    request?.question != null -> ask(request.question, ms)
                    request?.action != null -> {
                        val (reply, commands) = runActions(listOf(request.action))
                        val detail = u?.let { "${it.intent} ${(it.confidence * 100).toInt()}%" + it.slots.entries.joinToString("") { (k, v) -> " · $k: $v" } }
                        finish(Reply(reply, detail ?: request.action.optString("type"), ms, commands))
                    }
                    u == null -> finish(Reply("I couldn't understand the command. Try again.", "no action understood", ms, emptyList()))
                    else -> {
                        car.syncVolume(carAudio.volume)
                        val outcome = car.apply(u, text).let {
                            if (u.intent == "greeting" && u.confidence >= Car.MIN_CONFIDENCE) it.copy(reply = VoiceLines.hello(activeDriver)) else it
                        }
                        if (outcome.command != null) runCatching { carAudio.apply(u.intent, car) }
                        val detail = "${u.intent} ${(u.confidence * 100).toInt()}%" + if (u.negated > 0.5f) " · negated" else ""
                        finish(Reply(outcome.reply, detail, ms, listOfNotNull(outcome.command)))
                    }
                }
            }
        }
    }

    /* ---------- screen ---------- */

    /** One row of the command log: what was heard now, the reply and timing once [showReply] fills them in. */
    private fun addCommand(text: String): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(14), 0, 0)
        }
        row.addView(TextView(this).apply {
            this.text = text
            setTextColor(getColor(R.color.home_ink2))
            textSize = 14f
        })
        log.addView(row)
        while (log.childCount > MAX_ENTRIES) log.removeViewAt(0)
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
        return row
    }

    private fun showReply(row: LinearLayout, reply: String, note: String?) {
        row.addView(TextView(this).apply {
            text = reply
            setTextColor(getColor(R.color.home_ink))
            textSize = 16f
            setPadding(0, dp(4), 0, 0)
        })
        if (note != null) row.addView(TextView(this).apply {
            text = note
            setTextColor(getColor(R.color.home_ink3))
            textSize = 11f
            setLineSpacing(dp(1).toFloat(), 1f)
            setPadding(0, dp(4), 0, 0)
        })
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun renderState() {
        acState.text = if (car.acOn) "On" else "Off"
        acControl.isActivated = car.acOn
        acIcon.setColorFilter(getColor(if (car.acOn) R.color.accent else R.color.ink3))
        tempValue.text = "${car.temp}°"
        for (i in 0 until fanBars.childCount) fanBars.getChildAt(i).setBackgroundColor(getColor(if (i < car.fan) R.color.ink else R.color.line))
        fanText.text = if (car.fan == 0) "Off" else "${car.fan}"
        seatText.text = "Level ${car.seatHeight}"
        val light = car.light
        ambientSwatch.background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0xFF000000.toInt() or light.rgb)
        }
        ambientLabel.text = light.label
        val track = carAudio.track
        mediaState.text = track?.title ?: if (car.playing) "Bluetooth audio" else "Nothing playing"
        mediaSub.text = when {
            car.playing -> "Bluetooth · Playing"
            track != null -> "Bluetooth · Paused"
            else -> "Bluetooth audio"
        }
        if (track != null) {
            lastTrack = track
            mediaSub.text = "Demo music · ${track.mood}" + if (car.playing) "" else " · Paused"
            mediaCover.background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(track.art) }
            mediaArt.setColorFilter(getColor(R.color.home_ink))
        } else {
            mediaCover.setBackgroundResource(R.drawable.home_tile)
            mediaArt.setColorFilter(getColor(if (car.playing) R.color.home_ink else R.color.home_ink3))
        }
        mediaProgressRow.visibility = if (track != null) View.VISIBLE else View.GONE
        main.removeCallbacks(progressTick)
        progressTick.run()
        mediaPlay.setImageResource(if (car.playing) R.drawable.ic_pause else R.drawable.ic_play)
        mediaPlay.contentDescription = if (car.playing) "Pause" else "Play"
        volumeText.text = "${car.volume}"
        val destination = car.destination
        navDest.text = destination ?: "Where to?"
        if (destination != shownDestination) {
            shownDestination = destination
            showTrip()
        }
        saveHome.text = if (map.home == null) "Set home" else "Change home"
        navSub.text = tripNote ?: if (destination != null) "Finding the route…" else "Say “take me to …”"
        ambientLine.setBackgroundColor(0xB0000000.toInt() or light.rgb)
        navSub.setTextColor(getColor(if (destination != null) R.color.home_accent else R.color.home_ink2))
        driver.text = activeDriver ?: "Guest"
        val now = Calendar.getInstance()
        greeting.text = "${VoiceLines.salutation(now.get(Calendar.HOUR_OF_DAY))}, ${activeDriver ?: "Guest"}"
        greetingSub.text = java.text.SimpleDateFormat("EEEE, d MMMM", java.util.Locale.getDefault()).format(now.time) + " · Welcome back"
        // Like Myra UI's banner: a new example every quarter hour.
        val example = EXAMPLES[(now.get(Calendar.HOUR_OF_DAY) * 4 + now.get(Calendar.MINUTE) / 15) % EXAMPLES.size]
        tryText.tag = example
        tryText.text = "“$example”"
    }

    /** The demo track the home player starts when nothing is loaded: the last one played. */
    private fun playDemo() = JSONObject().put("type", "media.play").put("genre", lastTrack.key)

    private fun renderProgress() {
        val length = carAudio.duration
        if (carAudio.track == null || length <= 0) return
        val at = carAudio.position.coerceIn(0, length)
        mediaProgress.progress = (at * 1000L / length).toInt()
        mediaElapsed.text = clock(at)
        mediaTotal.text = clock(length)
    }

    private fun clock(ms: Int) = "%d:%02d".format(ms / 60000, ms / 1000 % 60)

    /** A tap on the climate bar or media card: the action, the cabin saved for the driver, the screen refreshed. */
    private fun tap(action: JSONObject) {
        if (busy || recording) return
        val before = car.cabin()
        car.syncVolume(carAudio.volume)
        runActions(listOf(action))
        saveCabinChange(before)
        renderState()
    }

    private fun saveCabinChange(before: Cabin) {
        val after = car.cabin()
        if (after != before) activeDriver?.let { cabins.save(it, after) }
    }

    private fun chooseAmbient() {
        val colors = CabinColor.entries
        AlertDialog.Builder(this)
            .setTitle("Ambient light")
            .setSingleChoiceItems(colors.map { it.label }.toTypedArray(), car.light.ordinal) { dialog, selected ->
                if (!busy && !recording) {
                    val before = car.cabin()
                    car.run(JSONObject().put("type", "ambient.color").put("color", colors[selected].key))
                    saveCabinChange(before)
                    renderState()
                }
                dialog.dismiss()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun renderShortcuts() {
        val all = shortcuts.all
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
                    addView(TextView(context).apply { text = "“${s.name}”"; setTextColor(getColor(R.color.ink)); textSize = 17f; setTypeface(typeface, Typeface.BOLD) })
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
                    understand(s.name, null) { null }
                })
                addView(smallButton("Delete", primary = false) {
                    shortcuts.delete(s.name)
                    renderShortcuts()
                }, LinearLayout.LayoutParams(-2, dp(44)).apply { marginStart = dp(8) })
            })
        }
    }

    private fun smallButton(label: String, primary: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = label
        gravity = Gravity.CENTER
        textSize = 14f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(getColor(if (primary) R.color.bg else R.color.ink2))
        setBackgroundResource(if (primary) R.drawable.button else R.drawable.button_quiet)
        setPadding(dp(18), 0, dp(18), 0)
        layoutParams = LinearLayout.LayoutParams(-2, dp(44))
        setOnClickListener { onClick() }
    }

    private fun renderSystem() {
        val server = when (serverUp) { true -> "Server online"; false -> "Server offline"; null -> "Connecting…" }
        val model = if (modelReady) "MiniLM ready" else "MiniLM loading"
        system.text = "$server   ·   $model   ·   $freeMb MB free"
        system.setTextColor(getColor(if (serverUp == false) R.color.warn else R.color.ink3))
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
        const val SAFE_EXIT = 4
        const val MAX_COMMAND_MS = 10_000L
        const val FIRST_WAKE_WAIT_MS = 1_000L // "Hi Myra" and nothing more: a greeting
        const val WAKE_LOOKBACK_MS = 1_500L // audio before the wake cut that voice ID hears ("Hi Myra")
        const val MAX_ENTRIES = 20
        val EXAMPLES = listOf("Take me home", "Set the AC to 22","Turn up the volume and play music",
            "Play some calm music", "Change the ambient light to pink",
            "The temperature is high", "Set the temperature",
            "Whenever I say I am very tired, play some calm music", "I feel exhausted",
            "Whenever I say chill mode, set the AC to 20 and play calm music", "Chill mode", "Take me to Phoenix Mall",
            "Next song", "It's too hot in here", "Don't turn off the AC")
    }
}
