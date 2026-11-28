package com.myra.car

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Collections

/**
 * Streams scenes from tools/wake_word/device_cases.py through the real HandsFree (assets/wake models, ONNX
 * Runtime on this device) at real-time pace, and checks it wakes on the same chunk and trims at the same sample
 * as the PC reference (features.py), and that sound-alike scenes don't wake it.
 */
@RunWith(AndroidJUnit4::class)
class HandsFreeDeviceTest {
    @Test fun wakesAndTrimsLikeThePcReference() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val cases = JSONObject(inst.context.assets.open("wake_cases.json").bufferedReader().readText()).getJSONArray("cases")
        val failures = mutableListOf<String>()
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val pcm = inst.context.assets.open(case.getString("pcm")).readBytes()
            val woke = Collections.synchronizedList(mutableListOf<Long>())
            val hf = HandsFree(inst.targetContext, onWake = { woke.add(it / 2) }, onEnd = {})
            var pos = 0L
            while (pos + 3200 <= pcm.size) {
                hf.onAudio(pcm.copyOfRange(pos.toInt(), pos.toInt() + 3200), pos)
                pos += 3200
                Thread.sleep(100)
            }
            Thread.sleep(1500)
            hf.close()
            val want = if (case.isNull("cut")) null else case.getLong("cut")
            val got = woke.firstOrNull()
            if (got != want) failures.add("${case.getString("pcm")}: want $want got $got")
        }
        assertEquals(emptyList<String>(), failures)
    }

    /** Logs (tag HandsFreeCost) what one 80 ms step costs on this CPU: features + Myra model, then Silero. */
    @Test fun logsTheCostOfOneStep() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val env = ai.onnxruntime.OrtEnvironment.getEnvironment()
        fun session(name: String) = ai.onnxruntime.OrtSession.SessionOptions().use { o ->
            o.setIntraOpNumThreads(1)
            o.setOptimizationLevel(ai.onnxruntime.OrtSession.SessionOptions.OptLevel.ALL_OPT)
            env.createSession(ctx.assets.open("wake/$name").use { it.readBytes() }, o)
        }
        val (mel, emb, wake) = listOf("melspectrogram.onnx", "embedding_model.onnx", "myra_wake.onnx").map(::session)
        val f = WakeFeatures()
        val chunk = FloatArray(WakeFeatures.CHUNK) { (Math.sin(it * 0.05) * 3000).toFloat() }
        repeat(20) { f.push(chunk, mel, emb, wake, env) } // warm-up
        val t = System.nanoTime()
        repeat(200) { f.push(chunk, mel, emb, wake, env) }
        val ms = (System.nanoTime() - t) / 200 / 1e6
        android.util.Log.i("HandsFreeCost", "wake step %.2f ms per 80 ms (%.1f%% of one core)".format(ms, ms / 80 * 100))
        listOf(mel, emb, wake).forEach { it.close() }
    }
}
