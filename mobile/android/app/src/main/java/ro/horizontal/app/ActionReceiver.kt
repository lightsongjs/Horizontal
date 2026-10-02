package ro.horizontal.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import ro.horizontal.app.core.NativeAction
import ro.horizontal.app.core.SnoozeOption
import ro.horizontal.app.core.snoozeTarget
import java.time.ZoneId
import java.util.UUID

/** Butoanele notificării. Nu cer rețea: acțiunea pleacă la pagină sau în coadă (`Actions`). */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val id = i.getStringExtra("id") ?: return
        val now = System.currentTimeMillis()
        val base = NativeAction(UUID.randomUUID().toString(), NativeAction.Kind.DONE, id,
            prevDueAt = i.getStringExtra("dueAt"), title = i.getStringExtra("title") ?: "", body = i.getStringExtra("body") ?: "",
            allDay = i.getBooleanExtra("allDay", false), createdAt = now)
        val a = when (i.action) {
            DONE -> base
            SNOOZE15 -> base.copy(kind = NativeAction.Kind.UNTIL, remindAt = snoozeTarget(SnoozeOption.Minutes(15), now, base.prevDueAt, ZoneId.systemDefault()).remindAt)
            else -> return
        }
        Actions.dispatch(ctx, a, now)
    }
    companion object { const val DONE = "ro.horizontal.app.DONE"; const val SNOOZE15 = "ro.horizontal.app.SNOOZE15" }
}
