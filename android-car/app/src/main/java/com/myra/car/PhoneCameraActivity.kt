package com.myra.car

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.hardware.Camera
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

@Suppress("DEPRECATION") // Preview callbacks deliver NV21 directly on Android 7 and newer.
class PhoneCameraActivity : Activity(), SurfaceHolder.Callback {
    private val main = Handler(Looper.getMainLooper())
    private var camera: Camera? = null
    private var server: PhoneFrameServer? = null
    private var encoder: HandlerThread? = null
    @Volatile private var capturedPerSecond = 0
    private lateinit var preview: SurfaceView
    private lateinit var status: TextView
    private lateinit var button: Button
    private lateinit var lens: Spinner
    private var surfaceReady = false
    private var startRequested = false
    private var captureStarted = 0L

    private val updateAddress = object : Runnable {
        override fun run() {
            val share = server ?: return
            if (!share.isListening) {
                stopSharing("Phone camera sharing stopped. Tap Start phone camera to try again.")
                return
            }
            val now = SystemClock.elapsedRealtime()
            val lastFrame = share.latest?.id ?: captureStarted
            if (now - lastFrame > 5000) {
                stopSharing("The camera stopped sending frames. Close other camera apps and tap Start phone camera again.")
                return
            }
            val addresses = runCatching { phoneAddresses() }.getOrDefault(emptyList())
            status.text = when {
                share.latest == null -> "Waiting for the camera preview…"
                addresses.isEmpty() -> "Camera ready. Turn on your Wi-Fi hotspot or USB tethering to get a phone address."
                else -> {
                    val shown = addresses.joinToString("  •  ") { if (share.port == CAMERA_PORT) it else "$it:${share.port}" }
                    val sending = when {
                        share.paired && now - share.lastSent < 5000 -> "Sending photos to the car\n"
                        share.paired -> "Car paired · waiting for a photo request\n"
                        else -> "Waiting for the car to pair\n"
                    }
                    "Camera ready · $capturedPerSecond fps\nPhone IP: $shown\nCamera code: ${share.code}\n$sending" +
                        "Keep this screen open while the car is analyzing video."
                }
            }
            main.postDelayed(this, 400)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(TextView(context).apply {
                text = "Myra Phone Camera"
                textSize = 24f
            })
            status = TextView(context).apply {
                text = "Enable USB tethering or a password-protected hotspot, then start the camera."
                setPadding(0, pad, 0, pad)
                textSize = 16f
            }
            addView(status)
            lens = Spinner(context, Spinner.MODE_DIALOG).apply {
                prompt = "Choose a camera"
                adapter = ArrayAdapter(context, android.R.layout.simple_spinner_item,
                    listOf("Front camera · Drowsiness meter", "Rear camera · Safe Exit")).apply {
                    setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
                }
            }
            addView(lens)
            preview = SurfaceView(context).also { it.holder.addCallback(this@PhoneCameraActivity) }
            addView(preview, LinearLayout.LayoutParams(-1, 0, 1f))
            button = Button(context).apply {
                text = "Start phone camera"
                isEnabled = false
                setOnClickListener {
                    if (camera != null) stopSharing("Camera stopped.")
                    else {
                        startRequested = true
                        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startSharing()
                        else requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION)
                    }
                }
            }
            addView(button)
        })
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CAMERA_PERMISSION) return
        startRequested = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        if (startRequested) startSharing()
        else status.text = "Allow camera access and tap Start phone camera."
    }

    private fun startSharing() {
        if (!startRequested || !surfaceReady || camera != null) return
        startRequested = false
        val facing = if (lens.selectedItemPosition == 1) Camera.CameraInfo.CAMERA_FACING_BACK else Camera.CameraInfo.CAMERA_FACING_FRONT
        status.text = "Opening the camera…"
        var failure = "The selected camera could not open. Check camera access and close other camera apps."
        val result = runCatching {
            val info = Camera.CameraInfo()
            val id = (0 until Camera.getNumberOfCameras()).firstOrNull {
                Camera.getCameraInfo(it, info)
                info.facing == facing
            }
            if (id == null) {
                failure = "The selected camera is unavailable on this phone."
                error(failure)
            }
            val source = Camera.open(id).also { camera = it }
            val parameters = source.parameters
            val size = parameters.supportedPreviewSizes.minBy { abs(it.width - 352) + abs(it.height - 288) }
            parameters.setPreviewSize(size.width, size.height)
            parameters.previewFormat = ImageFormat.NV21
            // 30 fps: the fixed 30 range if there is one, else the range reaching 30 with the highest floor.
            parameters.supportedPreviewFpsRange.minWithOrNull(compareBy<IntArray>({ abs(it[1] - 30_000) }, { -it[0] }))
                ?.let { parameters.setPreviewFpsRange(it[0], it[1]) }
            source.parameters = parameters
            failure = "The phone could not start camera sharing. Turn on Wi-Fi hotspot or reconnect USB tethering, then try again."
            val share = PhoneFrameServer().also { server = it }
            failure = "The phone could not start the camera preview. Close other camera apps and try again."
            val crop = Rect(0, 0, size.width, size.height)
            val bytes = ByteArrayOutputStream()
            val jpegThread = HandlerThread("phone-camera-jpeg").also { it.start(); encoder = it }
            val jpeg = Handler(jpegThread.looper)
            val encoding = AtomicBoolean(false)
            var count = 0
            var second = SystemClock.elapsedRealtime()
            var nextSend = 0.0
            val frameIntervalMs = 1000.0 / SEND_FPS
            source.setDisplayOrientation(if (facing == Camera.CameraInfo.CAMERA_FACING_FRONT) (360 - info.orientation) % 360 else info.orientation)
            source.setPreviewDisplay(preview.holder)
            source.setErrorCallback { _, _ -> stopSharing("Camera disconnected. Tap Start to try again.") }
            // Preview buffers are recycled; JPEG encoding runs on its own thread so the camera never waits for it.
            repeat(3) { source.addCallbackBuffer(ByteArray(size.width * size.height * 3 / 2)) }
            source.setPreviewCallbackWithBuffer { data, cam ->
                if (data == null) return@setPreviewCallbackWithBuffer
                val now = SystemClock.elapsedRealtime()
                count++
                if (now - second >= 1000) { capturedPerSecond = count; count = 0; second = now }
                // Send SEND_FPS of the camera's ~30: a steady rate the head unit can analyse frame by frame.
                if (now < nextSend || !encoding.compareAndSet(false, true)) { cam.addCallbackBuffer(data); return@setPreviewCallbackWithBuffer }
                nextSend = if (now - nextSend > frameIntervalMs) now + frameIntervalMs else nextSend + frameIntervalMs
                val posted = jpeg.post {
                    try {
                        bytes.reset()
                        if (YuvImage(data, ImageFormat.NV21, size.width, size.height, null).compressToJpeg(crop, 65, bytes)) {
                            share.publish(CameraFrame(now, info.orientation, bytes.toByteArray()))
                        }
                    } finally {
                        encoding.set(false)
                        runCatching { cam.addCallbackBuffer(data) } // the camera may be released by now
                    }
                }
                if (!posted) {
                    encoding.set(false)
                    runCatching { cam.addCallbackBuffer(data) }
                }
            }
            source.startPreview()
            captureStarted = SystemClock.elapsedRealtime()
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            button.text = "Stop sharing"
            lens.isEnabled = false
            main.post(updateAddress)
        }
        result.exceptionOrNull()?.let {
            Log.w("MyraPhoneCamera", failure, it)
            stopSharing(failure)
        }
    }

    private fun stopSharing(message: String) {
        startRequested = false
        main.removeCallbacks(updateAddress)
        runCatching { server?.close() }
        server = null
        camera?.let {
            runCatching { it.setPreviewCallbackWithBuffer(null) }
            runCatching { it.stopPreview() }
            runCatching { it.release() }
        }
        camera = null
        encoder?.quitSafely()
        encoder = null
        capturedPerSecond = 0
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        status.text = message
        button.text = "Start phone camera"
        lens.isEnabled = true
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        surfaceReady = true
        button.isEnabled = true
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startSharing()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceReady = false
        button.isEnabled = false
        if (camera != null) stopSharing("Camera stopped.")
    }

    override fun onStop() {
        if (camera != null) stopSharing("Camera stopped. Start again to get a new code.")
        super.onStop()
    }

    companion object {
        private const val CAMERA_PERMISSION = 1
        const val SEND_FPS = 24
    }
}
