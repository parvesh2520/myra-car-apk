package com.myra.car

internal sealed interface ShortcutMatch {
    data class Found(val shortcut: Shortcuts.Shortcut) : ShortcutMatch
    data class Ambiguous(val names: List<String>) : ShortcutMatch
}

/** Considers paraphrases after literal shortcut names have been checked. */
internal class ShortcutMatcher(private val encode: (String) -> FloatArray?) {
    private val embeddings = mutableMapOf<String, FloatArray>()

    fun match(text: String, shortcuts: List<Shortcuts.Shortcut>): ShortcutMatch? {
        if (shortcuts.isEmpty()) return null
        val message = Shortcuts.normalize(text)
        val requested = Shortcuts.invocation(message)
        if (requested == null && CONTROL.matches(message)) return null
        val query = phrase(requested ?: message)
        if (query.text.isBlank() || query.words.size > 16 || COMPOUND.containsMatchIn(query.text)) return null

        val names = shortcuts.map { it to phrase(it.name) }
        embeddings.keys.retainAll(names.map { it.second.text }.toSet())
        val candidates = names.filter { (_, name) -> compatible(query, name) }
        val direct = candidates.filter { (_, name) -> query.text == name.text }
        if (direct.isNotEmpty()) return choose(direct.map { it.first })

        // ASR can drop a repeated letter in a short name, e.g. "chil mode".
        val typos = candidates.filter { (_, name) ->
            query.words.size <= 3 && name.words.size <= 3 &&
                REPEATED_LETTER.replace(query.text, "$1") == REPEATED_LETTER.replace(name.text, "$1")
        }
        if (typos.isNotEmpty()) return choose(typos.map { it.first })

        if (candidates.isEmpty()) return null
        val vector = encode(query.text) ?: return null
        val ranked = candidates.mapNotNull { (shortcut, name) ->
            val target = embeddings[name.text] ?: encode(name.text)?.also { embeddings[name.text] = it } ?: return@mapNotNull null
            val score = similarity(vector, target)
            val minimum = when {
                query.keywords.any { it in name.keywords } || requested != null -> .64f
                maxOf(query.keywords.size, name.keywords.size) <= 1 && query.subject == null -> .80f
                else -> .68f
            }
            if (score.isFinite()) Scored(shortcut, score, minimum) else null
        }.sortedByDescending { it.score }
        val first = ranked.firstOrNull()?.takeIf { it.score >= it.minimum } ?: return null
        return choose(ranked.takeWhile { first.score - it.score < .06f }.map { it.shortcut })
    }

    private data class Scored(val shortcut: Shortcuts.Shortcut, val score: Float, val minimum: Float)

    private data class Phrase(val text: String) {
        val words = text.split(' ')
        val keywords = words.filter { it.isNotBlank() && it !in FILLER }.toSet()
        val subject = SUBJECT.find(text)?.value
        val negated = NEGATION.containsMatchIn(text)
        val numbers = words.mapNotNull { word -> WORD_NUMBERS[word] ?: word.takeIf { it.isNotEmpty() && it.all(Char::isDigit) } }
    }

    private fun choose(matches: List<Shortcuts.Shortcut>): ShortcutMatch =
        if (matches.size == 1) ShortcutMatch.Found(matches.single())
        else ShortcutMatch.Ambiguous(matches.take(3).map { it.name })

    private fun compatible(query: Phrase, name: Phrase): Boolean {
        if (query.subject != null && name.subject != null && query.subject != name.subject) return false
        if (query.negated != name.negated || query.numbers != name.numbers) return false
        return OPPOSITES.none { (a, b) ->
            (query.keywords.any { it in a } && name.keywords.any { it in b }) ||
                (query.keywords.any { it in b } && name.keywords.any { it in a })
        }
    }

    private fun phrase(text: String): Phrase {
        val normalized = Shortcuts.normalize(text.replace('’', '\'')).replace(FEELING, "i am ")
        val canonical = if (normalized.startsWith("i am ")) "i am " + INTENSITY.replace(normalized.removePrefix("i am "), "")
            else normalized
        return Phrase(canonical)
    }

    private fun similarity(a: FloatArray, b: FloatArray): Float {
        if (a.size != b.size) return Float.NaN
        // The encoder returns unit-length vectors, so the dot product is cosine similarity.
        var dot = 0f
        for (i in a.indices) dot += a[i] * b[i]
        return dot
    }

    private companion object {
        val REPEATED_LETTER = Regex("""(\p{L})\1+""")
        val FEELING = Regex("""^(?:(?:i am|i'm) feeling|i feel|i'm|im|feeling) +""")
        val INTENSITY = Regex("""^(?:(?:very|really|so|quite|extremely|pretty) +)+""")
        val SUBJECT = Regex("""^(?:i|we|you|he|she|they|it)\b""")
        val NEGATION = Regex("""\b(?:not|no|never|without|neither|nor|cannot|dont|wont|cant|isnt|arent)\b|n't\b""")
        val COMPOUND = Regex("""\b(?:and then|but|except|whenever|every time)\b|^(?:if|when|what|why|how|who|where|am i|are you|tell me)\b""")
        val CONTROL = Regex("""^(?:(?:can|could|would|will) you (?:please )?)?(?:set|change|turn|switch|play|start|stop|pause|resume|navigate|drive to|go to|take me|take us|raise|lower|increase|decrease|cancel|delete|remove|forget|save|create|make)\b.*$""")
        val WORD_NUMBERS = listOf("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")
            .mapIndexed { i, word -> word to i.toString() }.toMap()
        val FILLER = setOf("i", "am", "me", "my", "the", "a", "an", "to", "in", "for", "some", "mode", "shortcut", "preset")
        val OPPOSITES = listOf(
            setOf("awake", "alert", "energized", "rested") to setOf("tired", "sleepy", "exhausted", "drowsy", "fatigued"),
            setOf("hot", "warm", "warmer") to setOf("cold", "cool", "cooler", "freezing"),
        )
    }
}
