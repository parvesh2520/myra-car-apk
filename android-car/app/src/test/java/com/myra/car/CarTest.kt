package com.myra.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CarTest {
    private fun u(intent: String, negated: Float = 0f) = Understanding(intent, 0.9f, negated, 1)

    @Test
    fun slots() {
        assertEquals(22, Car.temperature("Set the AC to 22 degrees."))
        assertEquals(24, Car.temperature("make it twenty-four"))
        assertNull(Car.temperature("set the temperature"))
        assertEquals(3, Car.amount("turn the volume up a lot"))
        assertEquals(1, Car.amount("a little warmer please"))
        assertEquals("Phoenix Marketcity", Car.place("Take me to Phoenix MarketCity, please."))
        assertEquals("Nearest Petrol Pump", Car.place("Navigate to the nearest petrol pump"))
        assertEquals("Home", Car.place("take me home"))
        assertEquals("Airport", Car.place("airport"))
    }

    @Test
    fun applies() {
        val car = Car()
        car.apply(u("climate_temperature_set"), "set it to 19")
        assertEquals(19, car.temp)
        car.apply(u("climate_temperature_up"), "a bit warmer")
        assertEquals(20, car.temp)
        car.apply(u("climate_temperature_down"), "much colder") // "much" = a lot
        assertEquals(17, car.temp)
        assertEquals(null, car.apply(u("climate_off", negated = 0.9f), "don't turn off the ac").command)
        assertEquals(true, car.acOn)
        val nav = car.apply(u("navigation_destination_request"), "take me to the airport")
        assertEquals("Airport", nav.command?.get("destination"))
        assertEquals("Airport", car.destination)
        assertNull(car.apply(Understanding("volume_up", 0.2f, 0f, 1), "mumble").command) // too unsure: nothing done
    }
}
