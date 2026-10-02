package ro.horizontal.app

import android.content.Context
import ro.horizontal.app.core.*

/**
 * Un singur loc care trece de la stare la efecte: îmbină sursele, sună ce e
 * de sunat, retrage ce nu mai e în plan, armează următoarea alarmă. Chemat de
 * la zero la fiecare listă nouă, alarmă, acțiune, repornire — fără stare în
 * memorie care să se poată desincroniza de disc.
 *
 * Ordinea contează: întâi se scrie pe disc (`fired`), apoi se arată
 * notificarea. Un proces omorât între cele două pierde o notificare, dar nu
 * sună de două ori la repornire — una ratată se vede oricum în „Azi", una
 * dublă e zgomot.
 */
object Engine {
    fun reschedule(ctx: Context, now: Long = System.currentTimeMillis()) {
        Notifier.ensureChannels(ctx)
        val (fire, cancel, _) = PlanStore.edit(ctx) { s ->
            val latest = maxOf(s.page?.readAt ?: 0, s.native?.readAt ?: 0)
            val queue = NativeQueue.prune(s.queue, latest)
            val plan = mergePlan(s.page, s.native, queue)
            val ap = planAlarms(plan, now, s.fired, s.shown)
            val shown = (s.shown - ap.cancelIds) + ap.fireNow.associate { it.id to it.key }
            val exact = AlarmScheduler.arm(ctx, ap.nextAt)
            s.copy(queue = queue, fired = pruneFired(s.fired + ap.fireNow.map { it.key }, now), shown = shown, nextAlarmAt = ap.nextAt, exactUsed = exact) to
                Triple(ap.fireNow, ap.cancelIds, ap.nextAt)
        }
        cancel.forEach { Notifier.cancel(ctx, it) }
        fire.forEach { Notifier.show(ctx, it) }
    }
}
