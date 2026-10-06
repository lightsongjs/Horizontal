package ro.horizontal.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import java.time.LocalDate
import java.time.ZoneId

/** Widget-urile de pe ecranul de start. `refresh` e chemat din `Engine.reschedule` și din `setAgenda`. */
object Widgets {
    const val EXTRA_OPEN = "hz-widget-open"
    const val EXTRA_QUICK = "hz-widget-quick"

    /**
     * Nu aruncă, niciodată: e chemat din `Engine.reschedule`, după ce mementourile
     * au fost marcate ca sunate — o excepție de aici (binder, o listă prea mare
     * pentru launcher) le-ar pierde în `DeferGate`. Un widget vechi e confort
     * pierdut; un memento pierdut nu.
     */
    fun refresh(ctx: Context) {
        try {
            val ids = AgendaWidget.ids(ctx)
            if (ids.isEmpty()) return
            val views = AgendaWidget.render(ctx, PlanStore.read(ctx))
            AppWidgetManager.getInstance(ctx).updateAppWidget(ids, views)
            armMidnight(ctx)
        } catch (e: Exception) {
            android.util.Log.w("hz-widget", "redesenarea a eșuat", e)
        }
    }

    /**
     * La miezul nopții gruparea se schimbă fără date noi („mâine" devine „azi").
     * Inexactă: câteva minute de întârziere în Doze sunt acceptabile, iar alarma
     * exactă e rezervată mementourilor. Același `PendingIntent` → se suprascrie.
     */
    private fun armMidnight(ctx: Context) {
        val zone = ZoneId.systemDefault()
        val at = LocalDate.now(zone).plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() + 60_000
        val pi = PendingIntent.getBroadcast(ctx, 3, Intent(ctx, AgendaWidget::class.java).setAction(AgendaWidget.ACTION_MIDNIGHT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).set(AlarmManager.RTC, at, pi)
    }

    fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(ctx, 4,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)

    fun quick(ctx: Context): PendingIntent = PendingIntent.getActivity(ctx, 5,
        Intent(ctx, MainActivity::class.java).putExtra(EXTRA_QUICK, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}
