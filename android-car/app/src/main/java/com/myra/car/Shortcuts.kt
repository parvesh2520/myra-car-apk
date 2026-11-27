package com.myra.car

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Voice shortcuts the driver teaches the car: "whenever I say chill mode, set the AC to 20 and play music".
 * A shortcut is a name and the actions it runs (each in [Car.run]'s JSON form). Stored in the app's private
 * shortcuts.json; saying the name later runs every action, before any model is asked.
 */
class Shortcuts(private val file: File) {
    data class Shortcut(val name: String, val actions: List<JSONObject>)

    private val items = mutableListOf<Shortcut>()
    val all: List<Shortcut> get() = items

    init {
        runCatching {
            val arr = JSONArray(file.readText())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val acts = o.getJSONArray("actions")
                items += Shortcut(o.getString("name"), List(acts.length()) { acts.getJSONObject(it) })
            }
        }
    }

    /** Saves (or replaces) a shortcut. False when the name or the actions are unusable. */
    fun save(name: String, actions: List<JSONObject>): Boolean {
        val key = normalize(name)
        if (key.isEmpty() || key.split(' ').size > 6 || actions.isEmpty()) return false
        items.removeAll { normalize(it.name) == key }
        items += Shortcut(key, actions)
        persist()
        return true
    }

    fun delete(name: String): Boolean {
        val key = normalize(name)
        val removed = items.removeAll { normalize(it.name) == key || distance(normalize(it.name), key) <= 1 }
        if (removed) persist()
        return removed
    }

    /** The shortcut a sentence calls: its name alone, or with a few words around it ("activate chill mode please"). */
    fun match(text: String): Shortcut? {
        val t = normalize(text)
        if (t.isEmpty()) return null
        val words = t.split(' ').size
        return items.filter { s ->
            val n = s.name
            val extra = words - n.split(' ').size
            when {
                t == n -> true
                extra in 1..3 && " $t ".contains(" $n ") -> true
                else -> extra == 0 && distance(t, n) <= maxOf(1, n.length / 8) // "chil mode", "chill mood"
            }
        }.maxByOrNull { it.name.length }
    }

    private fun persist() {
        val arr = JSONArray()
        for (s in items) arr.put(JSONObject().put("name", s.name).put("actions", JSONArray(s.actions)))
        val tmp = File(file.path + ".tmp")
        tmp.writeText(arr.toString())
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) } // rename-over fails on some file systems
    }

    companion object {
        private val DEFINE = Regex(
            """^(?:(?:from now on|okay|ok|hey|myra)[, ]+)*(?:whenever|when|every time|each time|if)(?: i (?:ever )?)?(?:say|tell you|speak)(?: the words?)? (.{2,40}?)(?:,| then| i want you to| you should| please)+ (.+)$""")
        private val DEFINE2 = Regex("""^(?:create|make|add|save)(?: a| new)? shortcut(?: called| named)? (.{2,40}?)(?::| that will| that| to| which does| which)+ (.+)$""")
        private val SPLIT = Regex(""",? and then |, then | and also |, and |, | and | then """)
        private val FILLER = Regex("""^(?:hey myra|hey|ok|okay|myra|please)\s+|\s+(?:please|now)$""")

        fun normalize(s: String): String {
            var t = s.lowercase().replace(Regex("""[^\p{L}\p{N}' ]"""), " ").replace(Regex("""\s+"""), " ").trim()
            while (true) { val next = FILLER.replace(t, "").trim(); if (next == t) break; t = next }
            return t
        }

        /** "whenever I say chill mode, set the AC to 20 and play music" -> ("chill mode", ["set the ac to 20", "play music"]). */
        fun parseDefinition(text: String): Pair<String, List<String>>? {
            val t = text.lowercase().trim().trimEnd('.', '!', '?').replace(Regex("""[“”"]"""), "")
            val m = DEFINE.find(t) ?: DEFINE2.find(t) ?: return null
            val name = normalize(m.groupValues[1])
            val parts = m.groupValues[2].split(SPLIT).map { it.trim(' ', ',') }.filter { it.isNotEmpty() }
            return if (name.isEmpty() || parts.isEmpty()) null else name to parts
        }

        fun isDelete(text: String): String? =
            Regex("""^(?:delete|remove|forget)(?: the)?(?: shortcut)?(?: called)? (.+?)(?: shortcut)?$""")
                .find(normalize(text))?.groupValues?.get(1)?.takeIf { it.isNotEmpty() }

        fun distance(a: String, b: String): Int {
            val d = IntArray(b.length + 1) { it }
            for (i in 1..a.length) {
                var prev = d[0]; d[0] = i
                for (j in 1..b.length) {
                    val cur = d[j]
                    d[j] = minOf(d[j] + 1, d[j - 1] + 1, prev + if (a[i - 1] == b[j - 1]) 0 else 1)
                    prev = cur
                }
            }
            return d[b.length]
        }
    }
}
