package ro.horizontal.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Alarmele se pierd la repornire, la update-ul aplicației și (la oprire
 * forțată) la unii producători; o schimbare de oră sau de fus le mută. În toate
 * cazurile: recalcul de la zero — ratatele din ultima oră sună, restul se armează.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Engine.reschedule(ctx)
        Hooks.afterBoot(ctx)
    }
}
