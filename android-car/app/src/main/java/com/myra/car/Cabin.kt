package com.myra.car

import android.content.Context
import org.json.JSONObject

internal enum class CabinColor(val rgb: Int) {
    BLUE(0x589BFA), PINK(0xF477B7), PURPLE(0xA88AF9), RED(0xF36F79),
    GREEN(0x5FD1A0), AMBER(0xF8BA5C), WHITE(0xF2F4F8), CYAN(0x67DDE9),
    ORANGE(0xFF9867), YELLOW(0xF7D761);

    val key get() = name.lowercase()
    val label get() = key.replaceFirstChar { it.uppercase() }

    companion object {
        fun from(text: String) = entries.firstOrNull { it.key == text.lowercase() }
            ?: when (text.lowercase()) {
                "violet" -> PURPLE
                "teal", "turquoise" -> CYAN
                else -> null
            }
    }
}

internal data class Cabin(
    val acOn: Boolean = true,
    val temp: Int = 22,
    val fan: Int = 3,
    val light: CabinColor = CabinColor.BLUE,
    val seatHeight: Int = 3,
) {
    companion object {
        val TEMPERATURE_RANGE = 16..30
        val FAN_RANGE = 0..7
        val SEAT_HEIGHT_RANGE = 1..5
    }
}

internal class DriverCabins(context: Context) {
    private val prefs = context.getSharedPreferences("driver_cabins", Context.MODE_PRIVATE)

    fun load(driver: String): Cabin = runCatching {
        val obj = JSONObject(prefs.getString(driver, null) ?: return Cabin())
        Cabin(obj.optBoolean("acOn", true), obj.optInt("temp", 22).coerceIn(Cabin.TEMPERATURE_RANGE),
            obj.optInt("fan", 3).coerceIn(Cabin.FAN_RANGE), CabinColor.from(obj.optString("light")) ?: CabinColor.BLUE,
            obj.optInt("seatHeight", 3).coerceIn(Cabin.SEAT_HEIGHT_RANGE))
    }.getOrDefault(Cabin())

    fun save(driver: String, cabin: Cabin) {
        val obj = JSONObject().put("acOn", cabin.acOn).put("temp", cabin.temp).put("fan", cabin.fan)
            .put("light", cabin.light.key).put("seatHeight", cabin.seatHeight)
        prefs.edit().putString(driver, obj.toString()).apply()
    }

    fun forget(driver: String) { prefs.edit().remove(driver).apply() }
}
