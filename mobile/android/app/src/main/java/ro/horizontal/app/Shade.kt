package ro.horizontal.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ro.horizontal.app.core.shadeText
import java.time.ZoneId

/**
 * Notificarea fixă din bara de notificări (D-185, „ca TickTick"): numărul de azi,
 * prima sarcină și „+" spre fereastra nativă de quick add. Textul e `core/Shade.kt`,
 * datele sunt agenda widget-ului (`AgendaWidget.stateOf`), redesenarea vine odată
 * cu a widget-urilor (`Widgets.refresh`: listă nouă, alarmă, acțiune, miezul nopții,
 * repornire). Preferința e a DISPOZITIVULUI, pornită implicit, și supraviețuiește
 * deconectării (`PlanStore.clear` nu o atinge).
 *
 * Pe canal propriu, LOW: fără sunet, fără vibrație, fără să urce peste mementouri.
 * „Ongoing": pe Android 14+ omul o poate totuși da la o parte; revine la următoarea
 * redesenare, ca la TickTick. Cine n-o vrea o oprește din setări.
 */
object Shade {
    const val CHANNEL = "bara-azi"
    private const val TAG = "bara"
    private const val ID = 3
    private const val PREFS = "hz-shade"
    const val EXTRA_TODAY = "hz-shade-today"

    fun enabled(ctx: Context) = ctx.getSharedPreferences(PREFS, 0).getBoolean("on", true)

    fun setEnabled(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences(PREFS, 0).edit().putBoolean("on", on).commit()
        last = null
        Widgets.refresh(ctx)
    }

    fun channel(ctx: Context) = NotificationChannel(CHANNEL, "Azi în bara de notificări", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Câte sarcini ai azi și butonul de adăugare, mereu în bară."
        setShowBadge(false); setSound(null, null); enableVibration(false)
    }

    /** Ultimul conținut arătat: o redesenare identică nu mai trece prin `notify` (HyperOS reordonează bara la fiecare). */
    @Volatile private var last: String? = null

    /** Nu aruncă: e chemat din `Widgets.refresh`, deci din `Engine.reschedule`. */
    fun refresh(ctx: Context, s: PlanStore.State, now: Long = System.currentTimeMillis()) {
        try {
            val nm = NotificationManagerCompat.from(ctx)
            val text = if (enabled(ctx) && nm.areNotificationsEnabled())
                shadeText(AgendaWidget.stateOf(s, now, ZoneId.systemDefault()), now, ZoneId.systemDefault()) else null
            if (text == null) { last = null; nm.cancel(TAG, ID); return }
            val key = "${text.count}|${text.title}|${text.sub}"
            val active = ctx.getSystemService(NotificationManager::class.java).activeNotifications.any { it.tag == TAG && it.id == ID }
            if (active && key == last) return

            val v = RemoteViews(ctx.packageName, R.layout.notif_shade)
            v.setTextViewText(R.id.n_count, if (text.count > 0) text.count.toString() else "")
            v.setViewVisibility(R.id.n_count, if (text.count > 0) View.VISIBLE else View.GONE)
            v.setViewVisibility(R.id.n_star, if (text.count > 0) View.GONE else View.VISIBLE)
            v.setTextViewText(R.id.n_title, text.title)
            v.setTextViewText(R.id.n_sub, text.sub)
            v.setOnClickPendingIntent(R.id.n_add, Widgets.quick(ctx))

            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_hz)
                // Titlul și textul rămân și ca text simplu: ecranul de blocare, cititorul de ecran, un launcher care n-arată RemoteViews.
                .setContentTitle(if (text.count > 0) "${text.count} azi · ${text.title}" else text.title)
                .setContentText(text.sub)
                .setStyle(NotificationCompat.DecoratedCustomViewStyle())
                .setCustomContentView(v)
                .setContentIntent(today(ctx))
                .addAction(0, "Adaugă", Widgets.quick(ctx))
                .setOngoing(true).setSilent(true).setOnlyAlertOnce(true).setShowWhen(false).setLocalOnly(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setGroup("bara")   // separată de mementouri: nu se strâng împreună într-un pachet
                .build()
            nm.notify(TAG, ID, n)
            last = key
        } catch (e: Exception) {
            android.util.Log.w("hz-shade", "notificarea din bară a eșuat", e)
        }
    }

    /** Atingerea pe notificare: aplicația, pe „Azi" (pagina ascultă `shade`). */
    private fun today(ctx: Context): PendingIntent = PendingIntent.getActivity(ctx, 11,
        Intent(ctx, MainActivity::class.java).putExtra(EXTRA_TODAY, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}

/**
 * Ținta alarmei de la miezul nopții / ieșirea unei rutine (`Widgets.armNext`).
 * Nu mai e `AgendaWidget`: acela e dezactivat sub Android 12, iar notificarea din
 * bară trebuie redesenată și fără widget.
 */
class RefreshReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) { Widgets.refresh(ctx) }
}
