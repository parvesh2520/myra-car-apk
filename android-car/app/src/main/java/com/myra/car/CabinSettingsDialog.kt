package com.myra.car

import android.app.AlertDialog
import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView

internal fun cabinSettingsDialog(
    context: Context,
    driver: String,
    cabin: Cabin,
    onSave: (Cabin) -> Unit,
): AlertDialog {
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()

    val form = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(24), dp(8), dp(24), dp(8))
    }

    fun choice(label: String, values: List<String>, selected: Int): Spinner {
        val spinner = Spinner(context, Spinner.MODE_DIALOG).apply {
            id = View.generateViewId()
            prompt = label
            adapter = ArrayAdapter(context, android.R.layout.simple_spinner_item, values).apply {
                setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
            }
            setSelection(selected)
            minimumHeight = dp(48)
        }
        form.addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(TextView(context).apply {
                text = label
                textSize = 16f
                labelFor = spinner.id
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(spinner, LinearLayout.LayoutParams(0, -2, 1f))
        })
        return spinner
    }

    val ac = CheckBox(context).apply {
        text = "AC on"
        textSize = 16f
        isChecked = cabin.acOn
        minimumHeight = dp(48)
    }
    form.addView(ac)

    val temperatures = Cabin.TEMPERATURE_RANGE
    val speeds = Cabin.FAN_RANGE
    val heights = Cabin.SEAT_HEIGHT_RANGE
    val temp = choice("AC temperature", temperatures.map { "$it°C" }, cabin.temp - temperatures.first)
    val fan = choice("Fan speed", speeds.map { if (it == 0) "Off" else it.toString() }, cabin.fan - speeds.first)
    val light = choice("Ambient light", CabinColor.entries.map { it.label }, cabin.light.ordinal)
    val seat = choice("Seat height", heights.map { "Level $it" }, cabin.seatHeight - heights.first)

    return AlertDialog.Builder(context)
        .setTitle("$driver · Cabin settings")
        .setView(ScrollView(context).apply { addView(form, -1, -2) })
        .setNegativeButton("Cancel", null)
        .setPositiveButton("Save") { _, _ ->
            onSave(Cabin(
                acOn = ac.isChecked,
                temp = temperatures.first + temp.selectedItemPosition,
                fan = speeds.first + fan.selectedItemPosition,
                light = CabinColor.entries[light.selectedItemPosition],
                seatHeight = heights.first + seat.selectedItemPosition,
            ))
        }
        .create()
}
