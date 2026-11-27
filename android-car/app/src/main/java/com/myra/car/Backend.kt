package com.myra.car

import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.io.DataOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.BlockingQueue
import java.util.concurrent.TimeUnit

/** [asrMs]: how long the recogniser itself took on the server (Sarvam speech-to-English), when it says. */
data class Transcript(val text: String, val engine: String?, val error: String?, val asrMs: Long? = null)

/**
 * The Render backend (backend/bhashadrive): Sarvam speech recognition in translate mode at /transcribe, and the
 * car log at /device/log. Audio is streamed while the driver speaks (chunked upload), so when the button is
 * released only the last fraction of a second still has to travel.
 */
class Backend : Closeable {
    private val connections = mutableSetOf<HttpURLConnection>()
    private var closed = false

    private fun connect(path: String): HttpURLConnection = synchronized(connections) {
        check(!closed) { "Myra AI is paused" }
        (URL("$BASE/$path").openConnection() as HttpURLConnection).also { connections.add(it) }
    }

    private fun disconnect(connection: HttpURLConnection) {
        synchronized(connections) { connections.remove(connection) }
        connection.disconnect()
    }

    override fun close() {
        val active = synchronized(connections) {
            closed = true
            connections.toList().also { connections.clear() }
        }
        active.forEach { it.disconnect() }
    }

    /** Uploads the audio [queue] receives until an empty chunk, then returns the server's transcript. */
    fun transcribe(queue: BlockingQueue<ByteArray>): Transcript {
        val c = connect("transcribe")
        try {
            c.requestMethod = "POST"
            c.doOutput = true
            c.connectTimeout = 10_000
            c.readTimeout = 30_000
            c.setChunkedStreamingMode(8192)
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=$BOUNDARY")
            DataOutputStream(c.outputStream.buffered(8192)).use { out ->
                out.writeBytes("--$BOUNDARY\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\n" +
                    "Content-Type: audio/wav\r\n\r\n")
                out.write(wavHeader())
                while (true) {
                    val chunk = queue.poll(15, TimeUnit.SECONDS) ?: break // the recorder never ended: send what we have
                    if (chunk.isEmpty()) break
                    out.write(chunk)
                    out.flush()
                }
                out.writeBytes("\r\n--$BOUNDARY--\r\n")
            }
            val ok = c.responseCode in 200..299
            val body = (if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.readText().orEmpty()
            if (!ok) return Transcript("", null, "Server error ${c.responseCode}")
            val j = JSONObject(body)
            return Transcript(j.optString("text"), j.optString("engine").ifEmpty { null },
                j.optString("error").takeIf { it.isNotEmpty() && it != "null" }, j.optLong("asr_ms", -1).takeIf { it >= 0 })
        } finally {
            disconnect(c)
        }
    }

    /** Keeps Render's free instance awake and the HTTPS connection warm. True when the server answered. */
    fun ping(): Boolean = runCatching {
        val c = connect("health")
        c.connectTimeout = 8_000
        c.readTimeout = 60_000 // a sleeping Render instance takes up to a minute to wake
        try { c.responseCode == 200 && c.inputStream.use { it.read() != -1 } } finally { disconnect(c) }
    }.getOrDefault(false)

    /** One entry in the server's car log ("[CAR] heard ..." in the Render log, GET /device/log). */
    fun log(transcript: String, commands: List<Map<String, Any>>, model: String, latencyMs: Long, asr: String?, reply: String) {
        runCatching {
            val body = JSONObject()
                .put("transcript", transcript.take(500))
                .put("commands", JSONArray().apply { commands.forEach { put(JSONObject(it)) } })
                .put("model", model)
                .put("latency_ms", latencyMs)
                .put("asr_engine", asr)
                .put("reply", reply.take(500))
                .toString().toByteArray()
            val c = connect("device/log")
            try {
                c.requestMethod = "POST"
                c.doOutput = true
                c.connectTimeout = 10_000
                c.readTimeout = 15_000
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body) }
                c.responseCode
            } finally {
                disconnect(c)
            }
        }
    }

    /** WAV header for 16 kHz mono 16-bit PCM of unknown length (the server reads to the end of the upload). */
    private fun wavHeader(): ByteArray = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
        put("RIFF".toByteArray()); putInt(-1); put("WAVE".toByteArray())
        put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
        putInt(Recorder.SAMPLE_RATE); putInt(Recorder.SAMPLE_RATE * 2); putShort(2); putShort(16)
        put("data".toByteArray()); putInt(-1)
    }.array()

    companion object {
        private const val BASE = "https://myra-car-backend-gs1p.onrender.com/api"
        private const val BOUNDARY = "myra-car-audio"
    }
}
