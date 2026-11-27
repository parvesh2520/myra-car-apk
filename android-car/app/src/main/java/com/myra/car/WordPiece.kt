package com.myra.car

import java.text.Normalizer

/**
 * BERT uncased WordPiece tokenizer (the one MiniLM-L6 was trained with): clean, lowercase, strip accents, split
 * on whitespace and punctuation, then greedy longest-match subwords ("##" continuations). Produces
 * [CLS] ... [SEP] ids truncated to [maxLen]. Checked against Python's tokenizer in WordPieceTest.
 */
class WordPiece(vocabLines: List<String>, private val maxLen: Int) {
    private val vocab: Map<String, Int> = vocabLines.withIndex().associate { (i, w) -> w to i }
    private val unk = id("[UNK]")
    private val cls = id("[CLS]")
    private val sep = id("[SEP]")

    private fun id(token: String) = vocab[token] ?: error("vocab has no $token")

    /** Token ids, the words they came from, and for each token the index of its word (-1 for [CLS]/[SEP]). */
    class Encoded(val ids: IntArray, val words: List<String>, val wordOf: IntArray)

    fun encode(text: String): IntArray = encodeWords(text).ids

    fun encodeWords(text: String): Encoded {
        val ids = ArrayList<Int>()
        val wordOf = ArrayList<Int>()
        ids.add(cls); wordOf.add(-1)
        val words = basicTokens(text)
        for ((w, word) in words.withIndex()) {
            for (piece in wordPieces(word)) {
                if (ids.size == maxLen - 1) break
                ids.add(piece); wordOf.add(w)
            }
        }
        ids.add(sep); wordOf.add(-1)
        return Encoded(ids.toIntArray(), words, wordOf.toIntArray())
    }

    private fun basicTokens(text: String): List<String> {
        val cleaned = StringBuilder()
        for (ch in text) {
            when {
                ch.code == 0 || ch.code == 0xFFFD || isControl(ch) -> {}
                ch.isWhitespace() -> cleaned.append(' ')
                isCjk(ch.code) -> cleaned.append(' ').append(ch).append(' ')
                else -> cleaned.append(ch)
            }
        }
        val out = ArrayList<String>()
        for (raw in cleaned.split(' ')) {
            if (raw.isEmpty()) continue
            val word = Normalizer.normalize(raw.lowercase(), Normalizer.Form.NFD)
                .filter { Character.getType(it) != Character.NON_SPACING_MARK.toInt() }
            val current = StringBuilder()
            for (ch in word) {
                if (isPunctuation(ch)) {
                    if (current.isNotEmpty()) { out.add(current.toString()); current.clear() }
                    out.add(ch.toString())
                } else current.append(ch)
            }
            if (current.isNotEmpty()) out.add(current.toString())
        }
        return out
    }

    private fun wordPieces(word: String): List<Int> {
        if (word.length > 100) return listOf(unk)
        val pieces = ArrayList<Int>()
        var start = 0
        while (start < word.length) {
            var end = word.length
            var found: Int? = null
            while (start < end) {
                val sub = (if (start > 0) "##" else "") + word.substring(start, end)
                val v = vocab[sub]
                if (v != null) { found = v; break }
                end--
            }
            if (found == null) return listOf(unk)
            pieces.add(found)
            start = end
        }
        return pieces
    }

    private fun isControl(ch: Char): Boolean {
        if (ch == '\t' || ch == '\n' || ch == '\r') return false
        val t = Character.getType(ch)
        return t == Character.CONTROL.toInt() || t == Character.FORMAT.toInt()
    }

    private fun isPunctuation(ch: Char): Boolean {
        val c = ch.code
        if (c in 33..47 || c in 58..64 || c in 91..96 || c in 123..126) return true
        return when (Character.getType(ch)) {
            Character.CONNECTOR_PUNCTUATION.toInt(), Character.DASH_PUNCTUATION.toInt(), Character.START_PUNCTUATION.toInt(),
            Character.END_PUNCTUATION.toInt(), Character.INITIAL_QUOTE_PUNCTUATION.toInt(),
            Character.FINAL_QUOTE_PUNCTUATION.toInt(), Character.OTHER_PUNCTUATION.toInt() -> true
            else -> false
        }
    }

    private fun isCjk(c: Int) = c in 0x4E00..0x9FFF || c in 0x3400..0x4DBF || c in 0xF900..0xFAFF || c in 0x2F800..0x2FA1F
}
