package ro.horizontal.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Alarma a sunat. Decide DOAR din planul local: în Doze rețeaua e oprită. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Engine.reschedule(ctx)
        Hooks.afterAlarm(ctx)
    }
}
