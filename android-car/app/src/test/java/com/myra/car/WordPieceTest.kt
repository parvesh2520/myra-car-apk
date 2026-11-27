package com.myra.car

import org.json.JSONArray
import org.junit.Assert.assertArrayEquals
import org.junit.Test
import java.io.File

/** The app's tokenizer must give exactly the ids Python's BERT tokenizer gave in training (tokenizer_fixture.json). */
class WordPieceTest {
    @Test
    fun matchesPythonTokenizer() {
        val vocab = File("src/main/assets/vocab.txt").readLines()
        val tok = WordPiece(vocab, 32)
        val cases = JSONArray(File("src/test/resources/tokenizer_fixture.json").readText())
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val want = c.getJSONArray("ids").let { a -> IntArray(a.length()) { a.getInt(it) } }
            assertArrayEquals(c.getString("text"), want, tok.encode(c.getString("text")))
        }
    }
}
