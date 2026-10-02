package ro.horizontal.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * O singură alarmă armată: cea mai apropiată. Când sună, `Engine` recalculează
 * tot din planul de pe disc și armează următoarea. `setExactAndAllowWhileIdle`
 * sună și în Doze, fără rețea — de-aia nimic din `AlarmReceiver` nu cere rețea.
 */
object AlarmScheduler {
    private fun pi(ctx: Context) = PendingIntent.getBroadcast(ctx, 1, Intent(ctx, AlarmReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun canExact(ctx: Context): Boolean {
        val am = ctx.getSystemService(AlarmManager::class.java)
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
    }

    /** Întoarce `true` dacă alarma e exactă; altfel e `setAndAllowWhileIdle`, aproximativă (minute). */
    fun arm(ctx: Context, at: Long?): Boolean {
        val am = ctx.getSystemService(AlarmManager::class.java)
        if (at == null) { am.cancel(pi(ctx)); return canExact(ctx) }
        return if (canExact(ctx)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(ctx)); true
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(ctx)); false
        }
    }
}
