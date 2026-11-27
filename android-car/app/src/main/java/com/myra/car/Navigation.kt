package com.myra.car

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper

/** One Google Places result (backend /api/nav/places). */
data class Place(val name: String, val address: String, val lat: Double, val lng: Double)

/** Picking one of a Google Places search's results, and its distance from the car. */
object Navigation {
    private val ORDINALS = listOf(
        Regex("""\b(first|1st|number one|option one|1)\b"""),
        Regex("""\b(second|2nd|two|number 2|2)\b"""),
        Regex("""\b(third|3rd|three|number 3|3)\b"""),
    )
    private val STOP = setOf("the", "one", "that", "this", "take", "me", "to", "go", "navigate", "please", "select",
        "choose", "pick", "want", "start", "near", "wala", "and", "with", "for", "lets", "let's")

    /**
     * Which of [places] the driver means: "the second one", "number 3", "the last one", or words of one place's
     * name or address ("the one in Bandra"). Null: the sentence is not a choice between them.
     */
    fun pick(text: String, places: List<Place>): Place? {
        if (places.isEmpty()) return null
        val t = text.lowercase()
        if (Regex("""\b(last|final)\b""").containsMatchIn(t)) return places.last()
        ORDINALS.forEachIndexed { i, r -> if (i < places.size && r.containsMatchIn(t)) return places[i] }
        val words = t.split(Regex("""[^a-z0-9']+""")).filter { it.length > 2 && it !in STOP }.toSet()
        if (words.isEmpty()) return null
        val scored = places.map { p -> p to "${p.name} ${p.address}".lowercase().split(Regex("""[^a-z0-9']+""")).toSet().count { it in words } }
        val best = scored.maxOf { it.second }
        return scored.singleOrNull { it.second == best }?.first?.takeIf { best > 0 }
    }

    fun km(from: Location?, p: Place): Double? = from?.let {
        val out = FloatArray(1)
        Location.distanceBetween(it.latitude, it.longitude, p.lat, p.lng, out)
        out[0] / 1000.0
    }
}

/** The head unit's own GPS (LocationManager, no Play Services), kept fresh while Myra listens. */
class CarLocation(private val ctx: Context) : LocationListener {
    @Volatile var last: Location? = null; private set
    private val lm = ctx.getSystemService(LocationManager::class.java)

    fun allowed() = ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun start() {
        if (!allowed()) return
        val providers = lm.getProviders(true)
        last = providers.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }
        for (p in providers.filter { it != LocationManager.PASSIVE_PROVIDER })
            runCatching { lm.requestLocationUpdates(p, 30_000L, 50f, this, Looper.getMainLooper()) }
    }

    fun stop() { runCatching { lm.removeUpdates(this) } }

    override fun onLocationChanged(location: Location) {
        val l = last
        if (l == null || location.time >= l.time) last = location
    }

    @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
}
