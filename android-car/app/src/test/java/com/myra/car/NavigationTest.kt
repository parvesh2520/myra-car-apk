package com.myra.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NavigationTest {
    private val found = listOf(
        Place("Starbucks", "Linking Road, Bandra West, Mumbai", 19.06, 72.83),
        Place("Starbucks Reserve", "Juhu Tara Road, Juhu, Mumbai", 19.1, 72.82),
        Place("Starbucks", "Phoenix Palladium, Lower Parel, Mumbai", 18.99, 72.82),
    )

    @Test
    fun picksByOrdinal() {
        assertEquals(found[1], Navigation.pick("The second one.", found))
        assertEquals(found[0], Navigation.pick("first", found))
        assertEquals(found[2], Navigation.pick("Take me to number 3", found))
        assertEquals(found[2], Navigation.pick("the last one please", found))
        assertNull(Navigation.pick("the third one", found.take(2))) // there is no third
    }

    @Test
    fun picksByNameOrArea() {
        assertEquals(found[0], Navigation.pick("the one in Bandra", found))
        assertEquals(found[1], Navigation.pick("Juhu wala", found))
        assertEquals(found[2], Navigation.pick("Lower Parel", found))
        assertNull(Navigation.pick("Starbucks", found)) // all three match: still ambiguous
        assertNull(Navigation.pick("set the AC to 22", found)) // another command, not a choice
    }
}
