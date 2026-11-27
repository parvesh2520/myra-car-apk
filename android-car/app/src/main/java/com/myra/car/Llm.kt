package com.myra.car

import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * The on-device command LLM: SmolLM2-135M-Instruct fine-tuned on the cockpit commands and shortcut sentences
 * (backend/bhashadrive/training/train_car_llm.py), 8-bit GGUF, run by llama.cpp through libmyrallm.so.
 * It writes the actions as a JSON list, e.g. `[{"type":"climate.setTemp","value":20},{"type":"media.play"}]`.
 */
class Llm(file: File) : Closeable {
    data class Answer(val actions: List<JSONObject>?, val raw: String, val promptTokens: Long, val tokens: Long, val promptMs: Long, val genMs: Long)

    init { System.loadLibrary("myrallm") } // here, not in the companion, so unit tests can use parse() and prompt()

    private var handle = nativeLoad(file.path, THREADS, CONTEXT)

    init {
        check(handle != 0L) { "llama.cpp could not load ${file.name}" }
    }

    @Synchronized
    fun ask(text: String): Answer {
        check(handle != 0L) { "closed" }
        val timing = LongArray(4)
        val raw = nativeGenerate(handle, prompt(text), MAX_TOKENS, timing) ?: error("generation failed")
        return Answer(parse(raw), raw, timing[0], timing[1], timing[2], timing[3])
    }

    @Synchronized
    override fun close() {
        if (handle != 0L) nativeFree(handle)
        handle = 0
    }

    companion object {
        const val NAME = "SmolLM2-135M"
        const val FILE = "myra-smollm2-135m.q8_0.gguf"
        const val URL = "https://huggingface.co/Parvesh2520/myra-smollm2-135m-car/resolve/main/$FILE"
        const val SIZE = 144811008L
        const val SHA256 = "8cb6ce3318c7c9b29d26a67f0b46f475ed6ffc1e531bed9d89f396afe8434864"
        private const val CONTEXT = 512
        private const val MAX_TOKENS = 160
        private val THREADS = Runtime.getRuntime().availableProcessors().coerceIn(1, 4)

        @JvmStatic private external fun nativeLoad(path: String, threads: Int, nCtx: Int): Long
        @JvmStatic private external fun nativeGenerate(handle: Long, prompt: String, maxTokens: Int, timing: LongArray): String?
        @JvmStatic private external fun nativeFree(handle: Long)

        /** The chat turn the model was trained on (train_car_llm.py PROMPT): no system prompt, so it stays short. */
        fun prompt(text: String) = "<|im_start|>user\n${text.split(Regex("""\s+""")).filter { it.isNotEmpty() }.joinToString(" ").take(300)}<|im_end|>\n<|im_start|>assistant\n"

        /** The model's JSON list of actions; null when it wrote something else. */
        fun parse(raw: String): List<JSONObject>? = runCatching {
            val arr = JSONArray(raw.trim())
            List(arr.length()) { arr.getJSONObject(it) }
        }.getOrNull()

        fun modelFile(dir: File) = File(dir, "llm/$FILE")

        /**
         * Downloads the model to [dest] (resuming a partial download), checks its SHA-256, then moves it in place.
         * [progress] gets (bytes so far, total). [cancelled] is polled between chunks.
         */
        fun download(dest: File, progress: (Long, Long) -> Unit, cancelled: () -> Boolean) {
            dest.parentFile?.mkdirs()
            val part = File(dest.path + ".part")
            var have = if (part.exists()) part.length() else 0L
            if (SIZE > 0 && have > SIZE) { part.delete(); have = 0 }
            var url = URL(URL)
            var conn: HttpURLConnection
            var redirects = 0
            while (true) { // Hugging Face redirects to its CDN; follow by hand so the Range header survives
                conn = url.openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = false
                conn.connectTimeout = 15_000
                conn.readTimeout = 30_000
                if (have > 0) conn.setRequestProperty("Range", "bytes=$have-")
                val code = conn.responseCode
                if (code in 300..399 && redirects++ < 5) {
                    url = URL(url, conn.getHeaderField("Location"))
                    conn.disconnect()
                    continue
                }
                if (code == 200) have = 0 // server ignored the range: start over
                else if (code != 206) error("download failed: HTTP $code")
                break
            }
            val total = if (SIZE > 0) SIZE else have + conn.contentLengthLong
            try {
                conn.inputStream.use { input ->
                    java.io.FileOutputStream(part, have > 0).use { out ->
                        val buf = ByteArray(64 * 1024)
                        var last = 0L
                        while (true) {
                            if (cancelled()) error("cancelled")
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            have += n
                            if (have - last > 512 * 1024) { progress(have, total); last = have }
                        }
                    }
                }
            } finally {
                conn.disconnect()
            }
            progress(have, total)
            if (SHA256.isNotEmpty() && sha256(part) != SHA256) {
                part.delete()
                error("the downloaded file is corrupt; tap Download to try again")
            }
            if (!part.renameTo(dest)) error("could not save the model")
        }

        private fun sha256(f: File): String {
            val md = MessageDigest.getInstance("SHA-256")
            f.inputStream().use { input ->
                val buf = ByteArray(256 * 1024)
                while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) }
            }
            return md.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
