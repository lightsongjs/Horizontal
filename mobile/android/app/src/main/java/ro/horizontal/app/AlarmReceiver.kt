package ro.horizontal.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Alarma a sunat. Planul e local (în Doze rețeaua e oprită); singura cerere de
 * rețea e a porții (`DeferGate`, „laptopul e activ?"), iar orice eșec al ei
 * înseamnă „sună acum".
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) = DeferGate.async(this) {
        DeferGate.onAlarm(ctx)
        Hooks.afterAlarm(ctx)
    }
}
