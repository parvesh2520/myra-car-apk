package com.myra.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CabinClarificationTest {
    @Test
    fun highTemperatureStatementRequiresConfirmation() {
        val car = Car()
        assertTrue(CabinDialogue.isObservation("The temperature is high"))
        val suggestion = checkNotNull(CabinDialogue.temperatureCue("The temperature is high"))
        val question = CabinQuestion.Confirm(suggestion)
        assertEquals("Should I lower the temperature?", question.text)
        assertEquals(22, car.temp)
        assertEquals(CabinAnswer.Decline, CabinDialogue.answer(question, "No thanks"))
        assertEquals(22, car.temp)
        val confirm = CabinDialogue.answer(question, "Yes, go ahead") as CabinAnswer.Apply
        car.run(confirm.action)
        assertEquals(21, car.temp)
        assertFalse(CabinDialogue.canSuggest("The engine temperature is high"))
        assertNull(CabinDialogue.temperatureCue("The temperature is high outside"))
    }

    @Test
    fun confirmsAnExplicitValueAndLeavesNewOrdersToNormalProcessing() {
        val question = CabinQuestion.Temperature
        assertTrue(CabinDialogue.needsTemperature("Could you set the temperature?"))
        assertFalse(CabinDialogue.needsTemperature("Set the temperature to 21"))
        val numeric = CabinDialogue.answer(question, "Make it twenty one degrees") as CabinAnswer.Apply
        assertEquals("climate.setTemp", numeric.action.getString("type"))
        assertEquals(21, numeric.action.getInt("value"))
        assertEquals(CabinAnswer.Repeat, CabinDialogue.answer(question, "31"))
        assertEquals(CabinAnswer.NewRequest, CabinDialogue.answer(question, "Play calm music"))
    }

    @Test
    fun asksForOneOfTwoClosePredictionsAndAcceptsTheChosenSetting() {
        val result = Understanding("climate_temperature_down", .47f, .05f, 8, IntentScore("climate_fan_speed_up", .41f))
        val question = CabinDialogue.questionFor(result, "It's stuffy") as CabinQuestion.Choose
        assertEquals("Should I lower the temperature or raise the fan speed?", question.text)
        assertEquals(CabinAnswer.Repeat, CabinDialogue.answer(question, "Yes"))
        val selected = CabinDialogue.answer(question, "Increase the fan") as CabinAnswer.Apply
        assertEquals("climate.fan", selected.action.getString("type"))
        assertEquals(1, selected.action.getInt("delta"))
        assertNull(CabinDialogue.questionFor(result.copy(negated = .92f), "Don't change anything"))
        assertNull(CabinDialogue.questionFor(result.copy(confidence = .91f, runnerUp = null), "Lower the temperature"))
    }
}
