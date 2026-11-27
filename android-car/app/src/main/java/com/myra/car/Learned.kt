package com.myra.car

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * What the driver meant when Myra had to ask: "it's a bit stuffy" + "Yes" to "Should I raise the fan speed?" is
 * stored as that sentence -> that action, so the same or a very similar sentence later just works. Stored in the
 * app's private learned.json; the newest [MAX] are kept.
 */
internal class Learned(private val file: File) {
    data class Example(val text: String, val action: JSONObject)

    private val items = mutableListOf<Example>()
    /** A snapshot for the work thread. */
    val all: Memory get() = Memory(items.toList())

    init {
        runCatching {
            val arr = JSONArray(file.readText())
            for (i in 0 until arr.length()) arr.getJSONObject(i).let { items += Example(it.getString("text"), it.getJSONObject("action")) }
        }
    }

    fun remember(text: String, action: JSONObject) {
        val key = Shortcuts.normalize(text)
        if (key.isEmpty() || action.optString("type").isEmpty()) return
        items.removeAll { it.text == key }
        items += Example(key, action)
        while (items.size > MAX) items.removeAt(0)
        val arr = JSONArray()
        for (e in items) arr.put(JSONObject().put("text", e.text).put("action", e.action))
        val tmp = File(file.path + ".tmp")
        tmp.writeText(arr.toString())
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) } // rename-over fails on some file systems
    }

    class Memory(private val items: List<Example>) {
        /** The remembered action for the same wording, else for the closest wording above [MIN_SIMILARITY]. */
        fun recall(text: String, embed: (String) -> FloatArray?): JSONObject? {
            if (items.isEmpty()) return null
            val key = Shortcuts.normalize(text)
            items.lastOrNull { it.text == key }?.let { return JSONObject(it.action.toString()) }
            val query = embed(key) ?: return null
            var best: Example? = null
            var bestScore = MIN_SIMILARITY
            for (e in items) {
                val v = vectors[e.text] ?: embed(e.text)?.also { vectors[e.text] = it } ?: continue
                if (v.size != query.size) continue
                var dot = 0f
                for (i in v.indices) dot += v[i] * query[i] // unit vectors: dot product is cosine similarity
                if (dot >= bestScore) { bestScore = dot; best = e }
            }
            return best?.let { JSONObject(it.action.toString()) }
        }
    }

    companion object {
        const val MAX = 200
        const val MIN_SIMILARITY = .9f
        private val vectors = ConcurrentHashMap<String, FloatArray>()
    }
}
