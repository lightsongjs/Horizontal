package ro.horizontal.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ro.horizontal.app.core.Reminder

/**
 * Canalele și notificarea. Setările unui canal NU se mai pot schimba din cod
 * după creare (sunetul, importanța) — un sunet nou cere un id nou
 * (`mementouri-v2`), nu o modificare aici.
 */
object Notifier {
    const val CH_REMINDERS = "mementouri-v1"
    const val CH_STATUS = "stare"
    const val EXTRA_OPEN = "hz-open"

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val sound = Uri.parse("android.resource://${ctx.packageName}/${R.raw.chime}")
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        nm.createNotificationChannel(NotificationChannel(CH_REMINDERS, "Mementouri", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(sound, attrs); enableVibration(true)
            // Respectă „Nu deranja": fără setBypassDnd. Un memento care trezește
            // noaptea te învață să-l ignori (răspunsul omului, 2026-10-02).
        })
        nm.createNotificationChannel(NotificationChannel(CH_STATUS, "Stare", NotificationManager.IMPORTANCE_LOW))
    }

    private fun extras(i: Intent, r: Reminder) = i.putExtra("id", r.id).putExtra("key", r.key).putExtra("at", r.at)
        .putExtra("title", r.title).putExtra("body", r.body).putExtra("dueAt", r.dueAt).putExtra("allDay", r.allDay)

    private fun broadcast(ctx: Context, r: Reminder, action: String) = PendingIntent.getBroadcast(ctx, "${r.id}|$action".hashCode(),
        extras(Intent(ctx, ActionReceiver::class.java).setAction(action), r), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun openIntent(ctx: Context, id: String): PendingIntent = PendingIntent.getActivity(ctx, "$id|open".hashCode(),
        Intent(ctx, MainActivity::class.java).putExtra(EXTRA_OPEN, id).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** Al treilea buton, „Amână…", vine în Task 9 (SnoozeActivity); `extraActions` îl lasă să se adauge fără a rescrie asta. */
    var extraActions: (Context, Reminder, NotificationCompat.Builder) -> Unit = { _, _, _ -> }

    fun show(ctx: Context, r: Reminder) {
        val n = NotificationCompat.Builder(ctx, CH_REMINDERS)
            .setSmallIcon(R.drawable.ic_stat_hz)
            .setContentTitle(r.title).setContentText(r.body)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setWhen(r.at).setShowWhen(true)
            .setContentIntent(openIntent(ctx, r.id))
            .addAction(0, "Gata", broadcast(ctx, r, ActionReceiver.DONE))
            .addAction(0, "15 min", broadcast(ctx, r, ActionReceiver.SNOOZE15))
        extraActions(ctx, r, n)
        // tag = id: același tichet ÎNLOCUIEȘTE notificarea, ca pe web.
        try { NotificationManagerCompat.from(ctx).notify(r.id, 1, n.build()) } catch (e: SecurityException) { /* permisiunea lipsește: cardul din pagină o spune */ }
    }

    private const val STATUS_ID = 2

    /** Sesiunea nativă a murit: fără ea coada nu mai ajunge pe server, deci omul trebuie să afle. */
    fun showReconnect(ctx: Context) {
        val n = NotificationCompat.Builder(ctx, CH_STATUS).setSmallIcon(R.drawable.ic_stat_hz)
            .setContentTitle("Reconectează mementourile")
            .setContentText("Deschide Horizontal și scrie parola o dată.")
            .setContentIntent(PendingIntent.getActivity(ctx, 7, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
            .setAutoCancel(true)
        try { NotificationManagerCompat.from(ctx).notify("stare", STATUS_ID, n.build()) } catch (e: SecurityException) {}
    }
    fun cancelStatus(ctx: Context) = NotificationManagerCompat.from(ctx).cancel("stare", STATUS_ID)

    fun cancel(ctx: Context, id: String) = NotificationManagerCompat.from(ctx).cancel(id, 1)
    fun cancelAll(ctx: Context) = NotificationManagerCompat.from(ctx).cancelAll()
}
