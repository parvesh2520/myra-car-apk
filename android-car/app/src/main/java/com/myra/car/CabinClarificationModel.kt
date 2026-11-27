package com.myra.car

import android.content.Context
import org.json.JSONObject
import kotlin.math.exp

/** A locally trained classification head over the sentence vectors already used by Shortcuts. */
internal class CabinClarificationModel(context: Context) {
    private val data = JSONObject(context.assets.open("cabin_clarifications.json").bufferedReader().use { it.readText() })
    private val labels = data.getJSONArray("labels")
    private val rows = data.getJSONArray("weights")
    private val bias = data.getJSONArray("bias")
    private val weights = Array(labels.length()) { index ->
        val values = rows.getJSONArray(index)
        FloatArray(values.length()) { values.getDouble(it).toFloat() }
    }
    private val intercepts = DoubleArray(labels.length()) { bias.getDouble(it) }
    private val minimum = data.getDouble("min_score")
    private val lead = data.getDouble("min_lead")

    fun predict(vector: FloatArray): CabinSuggestion? {
        if (weights.any { it.size != vector.size }) return null
        val scores = DoubleArray(weights.size) { row ->
            var dot = intercepts[row]
            for (i in vector.indices) dot += weights[row][i] * vector[i]
            dot
        }
        val top = scores.indices.sortedByDescending { scores[it] }
        val best = top.first()
        val mass = scores.sumOf { exp(it - scores[best]) }
        val share = 1 / mass
        val margin = share - exp(scores[top[1]] - scores[best]) / mass
        if (share < minimum || margin < lead) return null
        return CabinSuggestion.entries.firstOrNull { it.label == labels.getString(best) }
    }
}
