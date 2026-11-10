package ro.horizontal.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import ro.horizontal.app.core.NativeAction
import ro.horizontal.app.core.SnoozeOption
import ro.horizontal.app.core.snoozeTarget
import java.time.ZoneId
import java.util.UUID

/** Butoanele notificării. Nu cer rețea: acțiunea pleacă la pagină sau în coadă (`Actions`). */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val id = i.getStringExtra("id") ?: return
        // „Gata" pe un ping de serie: doar închide notificarea (tag = id, ca în
        // `Notifier.show`). Nimic de scris — seria continuă, pingul următor sună.
        if (i.action == SEEN) { NotificationManagerCompat.from(ctx).cancel(id, 1); return }
        val now = System.currentTimeMillis()
        val base = NativeAction(UUID.randomUUID().toString(), NativeAction.Kind.DONE, id,
            prevDueAt = i.getStringExtra("dueAt"), title = i.getStringExtra("title") ?: "", body = i.getStringExtra("body") ?: "",
            allDay = i.getBooleanExtra("allDay", false), createdAt = now)
        val a = when (i.action) {
            DONE -> base
            SNOOZE15 -> {
                // `at` = mementoul care a sunat; `snoozedFrom` = baza, dacă era deja amânat. Din ele, `snoozeBase`.
                val t = snoozeTarget(SnoozeOption.Minutes(15), now, base.prevDueAt, ZoneId.systemDefault(), i.longExtra("at"), i.longExtra("snoozedFrom"))
                base.copy(kind = NativeAction.Kind.UNTIL, remindAt = t.remindAt, snoozedFrom = t.snoozedFrom)
            }
            else -> return
        }
        Actions.dispatch(ctx, a, now)
    }
    private fun Intent.longExtra(k: String): Long? = if (hasExtra(k)) getLongExtra(k, 0L) else null

    companion object { const val DONE = "ro.horizontal.app.DONE"; const val SNOOZE15 = "ro.horizontal.app.SNOOZE15"; const val SEEN = "ro.horizontal.app.SEEN" }
}
