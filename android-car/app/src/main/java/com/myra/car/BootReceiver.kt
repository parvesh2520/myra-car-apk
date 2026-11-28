package com.myra.car

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Opens Myra when the head unit starts, so it is on screen with the model loading before the driver speaks.
 * Android 10+ lets a receiver open an activity only with "Display over other apps" (MainActivity asks once).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
