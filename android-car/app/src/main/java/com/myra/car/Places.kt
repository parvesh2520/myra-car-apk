package com.myra.car

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.osmdroid.util.GeoPoint
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Where the demo trip goes and the road it takes: the saved home, place names looked up on OpenStreetMap
 * (Nominatim) and a driving route from the public OSRM server. No Google services, no API key.
 * Network calls block: call them off the main thread.
 */
internal class Places(context: Context) {
    private val prefs = context.getSharedPreferences("places", Context.MODE_PRIVATE)
    private val agent = "MYRA-car-demo (${context.packageName})" // both services ask for an identifying User-Agent

    var home: GeoPoint?
        get() = if (prefs.contains("homeLat")) GeoPoint(prefs.getFloat("homeLat", 0f).toDouble(), prefs.getFloat("homeLon", 0f).toDouble()) else null
        set(p) { prefs.edit().apply { if (p == null) clear() else putFloat("homeLat", p.latitude.toFloat()).putFloat("homeLon", p.longitude.toFloat()) }.apply() }

    class Route(val points: List<GeoPoint>, val km: Double)

    /** The place nearest the car that matches [name], or null. */
    fun find(name: String, near: GeoPoint?): GeoPoint? = if (name == "Home") home else search(QUICK[name] ?: name, near)

    /**
     * An address, place name or kind of place ("fuel") on OpenStreetMap: the match nearest the car, looking
     * within ~10 km first, then ~45 km, then anywhere in India.
     */
    fun search(name: String, near: GeoPoint?): GeoPoint? {
        val q = "https://nominatim.openstreetmap.org/search?format=json&limit=10&countrycodes=in&q=" + URLEncoder.encode(name, "UTF-8")
        val boxes = near?.let { listOf(0.1, 0.4).map { d -> "&bounded=1&viewbox=${it.longitude - d},${it.latitude + d},${it.longitude + d},${it.latitude - d}" } }
        for (box in (boxes ?: emptyList()) + "") {
            val hits = JSONArray(get(q + box))
            val points = List(hits.length()) { hits.getJSONObject(it).let { h -> GeoPoint(h.getString("lat").toDouble(), h.getString("lon").toDouble()) } }
            if (points.isNotEmpty()) return if (near == null) points.first() else points.minBy { it.distanceToAsDouble(near) }
        }
        return null
    }

    /** Where the car is: the street (map label) and the area and city (weather widget). */
    class Spot(val road: String?, val area: String?)

    fun spot(at: GeoPoint): Spot {
        val a = JSONObject(get("https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${at.latitude}&lon=${at.longitude}"))
            .optJSONObject("address") ?: return Spot(null, null)
        fun first(vararg keys: String) = keys.firstNotNullOfOrNull { a.optString(it).takeIf(String::isNotBlank) }
        val area = listOfNotNull(first("suburb", "neighbourhood", "city_district"), first("city", "town", "village")).distinct()
        return Spot(first("road", "neighbourhood", "suburb"), area.joinToString(", ").ifEmpty { null })
    }

    class Weather(val temp: Int, val sky: String, val icon: Int, val high: Int, val low: Int, val humidity: Int, val windKmh: Int)

    /** Weather at the car from Open-Meteo (no key): now, plus today's high and low. */
    fun weather(at: GeoPoint): Weather {
        val j = JSONObject(get("https://api.open-meteo.com/v1/forecast?latitude=${at.latitude}&longitude=${at.longitude}" +
            "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day" +
            "&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1"))
        val c = j.getJSONObject("current")
        val d = j.getJSONObject("daily")
        val day = c.optInt("is_day", 1) == 1
        val (sky, icon) = when (c.getInt("weather_code")) {
            0 -> "Clear" to if (day) R.drawable.ic_sun else R.drawable.ic_moon
            1 -> "Mostly clear" to if (day) R.drawable.ic_sun else R.drawable.ic_moon
            2 -> "Partly cloudy" to R.drawable.ic_cloud
            3 -> "Overcast" to R.drawable.ic_cloud
            45, 48 -> "Fog" to R.drawable.ic_cloud
            in 51..57 -> "Drizzle" to R.drawable.ic_rain
            in 61..67, in 80..82 -> "Rain" to R.drawable.ic_rain
            in 71..77, 85, 86 -> "Snow" to R.drawable.ic_snow
            in 95..99 -> "Thunderstorm" to R.drawable.ic_bolt
            else -> "Weather" to R.drawable.ic_cloud
        }
        fun r(x: Double) = Math.round(x).toInt()
        return Weather(r(c.getDouble("temperature_2m")), sky, icon, r(d.getJSONArray("temperature_2m_max").getDouble(0)),
            r(d.getJSONArray("temperature_2m_min").getDouble(0)), r(c.getDouble("relative_humidity_2m")), r(c.getDouble("wind_speed_10m")))
    }

    companion object {
        /** The map's quick destination keys: the name shown, and what is searched for near the car. */
        val QUICK = linkedMapOf("Petrol pump" to "fuel", "Parking" to "parking", "Restaurant" to "restaurant", "Hospital" to "hospital")
    }

    /** Road route; a straight line if the routing server can't be reached, so the demo still shows a trip. */
    fun route(from: GeoPoint, to: GeoPoint): Route = runCatching {
        val r = JSONObject(get("https://router.project-osrm.org/route/v1/driving/" +
            "${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson"))
            .getJSONArray("routes").getJSONObject(0)
        val c = r.getJSONObject("geometry").getJSONArray("coordinates")
        Route(List(c.length()) { c.getJSONArray(it).let { p -> GeoPoint(p.getDouble(1), p.getDouble(0)) } }, r.getDouble("distance") / 1000)
    }.getOrElse { Route(listOf(from, to), from.distanceToAsDouble(to) / 1000) }

    private fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000
        c.readTimeout = 8000
        c.setRequestProperty("User-Agent", agent)
        try {
            if (c.responseCode != 200) error("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }
}
