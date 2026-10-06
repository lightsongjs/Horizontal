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
 *
 * Efectele (show/cancel) rulează tot SUB lacătul lui PlanStore. Două
 * reschedule-uri din fire diferite (o alarmă și o acțiune) altfel s-ar putea
 * intercala: al doilea calculează „retrage X", își face cancel-ul, iar abia
 * apoi primul ajunge la show(X) — notificare orfană pe ecran, pe care niciun
 * plan n-o mai retrage, fiindcă `shown` spune că nu e acolo.
 */
object Engine {
    /**
     * `hold`: ce e de sunat se întoarce, nu se arată — `DeferGate` decide (din
     * alarmă, cu rețea, în afara firului principal). E marcat totuși ca sunat
     * și ca afișat: o listă nouă care îl retrage îl scoate din `shown`, iar
     * poarta arată numai ce mai e acolo.
     */
    fun reschedule(ctx: Context, now: Long = System.currentTimeMillis(), hold: Boolean = false): List<Reminder> {
        Notifier.ensureChannels(ctx)
        val out = PlanStore.locked { effects(ctx, now, hold) }
        // În afara lacătului: desenul citește starea, nu o scrie.
        Widgets.refresh(ctx)
        return out
    }

    private fun effects(ctx: Context, now: Long, hold: Boolean): List<Reminder> {
        val (fire, cancel, _) = PlanStore.edit(ctx) { s ->
            val latest = maxOf(s.page?.readAt ?: 0, s.native?.readAt ?: 0)
            val queue = NativeQueue.prune(s.queue, latest)
            val agendaReadAt = maxOf(s.agendaPage?.readAt ?: 0, s.agendaNative?.readAt ?: 0)
            val held = holdDone(s.queue, queue, s.agendaHeld, agendaReadAt)
            val plan = mergePlan(s.page, s.native, queue).let { p ->
                val known = p.map { it.id }.toSet()
                p + createReminders(s.creates, java.time.ZoneId.systemDefault(), latest, queue).filter { it.id !in known }
            }
            val ap = planAlarms(plan, now, s.fired, s.shown)
            val shown = (s.shown - ap.cancelIds) + ap.fireNow.associate { it.id to it.key }
            val exact = AlarmScheduler.arm(ctx, ap.nextAt)
            s.copy(queue = queue, agendaHeld = held, creates = pruneCreates(s.creates, agendaReadAt), fired = pruneFired(s.fired + ap.fireNow.map { it.key }, now), shown = shown, nextAlarmAt = ap.nextAt, exactUsed = exact) to
                Triple(ap.fireNow, ap.cancelIds, ap.nextAt)
        }
        cancel.forEach { Notifier.cancel(ctx, it) }
        if (hold) return fire
        fire.forEach { Notifier.show(ctx, it) }
        return emptyList()
    }
}
