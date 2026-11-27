package com.myra.car

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.pow

/**
 * 80-bin Kaldi log-mel filterbank, the exact features sherpa-onnx feeds the CAM++ speaker model on the backend
 * (kaldi-native-fbank defaults: 16 kHz, 25 ms povey window, 10 ms shift, dither 0, DC removal, pre-emphasis 0.97,
 * 512-point power spectrum, mel 20..7600 Hz, snip_edges=false), followed by the model's "global-mean" normalisation.
 * Input: samples in [-1, 1] (the model's normalize_samples=1). Output: T frames of [BINS] floats, row-major.
 */
object Fbank {
    const val BINS = 80
    private const val RATE = 16000
    private const val LEN = 400
    private const val SHIFT = 160
    private const val FFT = 512
    private const val EPS = 1.1920929e-7 // FLT_EPSILON, Kaldi's log floor

    private val window = DoubleArray(LEN) { (0.5 - 0.5 * cos(2 * PI * it / (LEN - 1))).pow(0.85) }
    private val cosT = DoubleArray(FFT / 2) { cos(2 * PI * it / FFT) }
    private val sinT = DoubleArray(FFT / 2) { -kotlin.math.sin(2 * PI * it / FFT) }

    /** Mel triangle weights over FFT bins 0 until FFT/2 (Kaldi leaves the Nyquist bin out). */
    private val mel: Array<DoubleArray> = run {
        fun scale(f: Double) = 1127.0 * ln(1.0 + f / 700.0)
        val lo = scale(20.0)
        val hi = scale(RATE / 2.0 - 400.0)
        val delta = (hi - lo) / (BINS + 1)
        Array(BINS) { b ->
            val left = lo + b * delta
            val center = lo + (b + 1) * delta
            val right = lo + (b + 2) * delta
            DoubleArray(FFT / 2) { i ->
                val m = scale(RATE.toDouble() / FFT * i)
                when {
                    m <= left || m >= right -> 0.0
                    m <= center -> (m - left) / (center - left)
                    else -> (right - m) / (right - center)
                }
            }
        }
    }

    fun frames(samples: Int) = (samples + SHIFT / 2) / SHIFT

    fun compute(wave: FloatArray): FloatArray {
        val n = wave.size
        val t = frames(n)
        val out = FloatArray(t * BINS)
        val re = DoubleArray(FFT)
        val im = DoubleArray(FFT)
        val power = DoubleArray(FFT / 2)
        for (f in 0 until t) {
            // snip_edges=false: frame f is centred on f*SHIFT + SHIFT/2; samples outside the clip are mirrored.
            val start = f * SHIFT + SHIFT / 2 - LEN / 2
            var mean = 0.0
            for (i in 0 until LEN) {
                var s = start + i
                while (s < 0 || s >= n) s = if (s < 0) -s - 1 else 2 * n - 1 - s
                re[i] = wave[s].toDouble()
                mean += re[i]
            }
            mean /= LEN
            for (i in 0 until LEN) re[i] -= mean
            for (i in LEN - 1 downTo 1) re[i] -= 0.97 * re[i - 1]
            re[0] -= 0.97 * re[0]
            for (i in 0 until LEN) re[i] *= window[i]
            re.fill(0.0, LEN, FFT)
            im.fill(0.0)
            fft(re, im)
            for (i in 0 until FFT / 2) power[i] = re[i] * re[i] + im[i] * im[i]
            for (b in 0 until BINS) {
                val w = mel[b]
                var e = 0.0
                for (i in w.indices) if (w[i] != 0.0) e += w[i] * power[i]
                out[f * BINS + b] = ln(max(e, EPS)).toFloat()
            }
        }
        // global-mean: subtract each bin's mean over the utterance.
        for (b in 0 until BINS) {
            var m = 0.0
            for (f in 0 until t) m += out[f * BINS + b]
            m /= max(t, 1)
            for (f in 0 until t) out[f * BINS + b] -= m.toFloat()
        }
        return out
    }

    /** In-place iterative radix-2 FFT of length [FFT]. */
    private fun fft(re: DoubleArray, im: DoubleArray) {
        var j = 0
        for (i in 1 until FFT) {
            var bit = FFT shr 1
            while (j and bit != 0) { j = j xor bit; bit = bit shr 1 }
            j = j xor bit
            if (i < j) { var x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x }
        }
        var len = 2
        while (len <= FFT) {
            val step = FFT / len
            for (i in 0 until FFT step len) for (k in 0 until len / 2) {
                val c = cosT[k * step]; val s = sinT[k * step]
                val a = i + k; val b = a + len / 2
                val xr = re[b] * c - im[b] * s
                val xi = re[b] * s + im[b] * c
                re[b] = re[a] - xr; im[b] = im[a] - xi
                re[a] += xr; im[a] += xi
            }
            len = len shl 1
        }
    }
}
