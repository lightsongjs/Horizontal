package ro.horizontal.app

import android.content.Context
import ro.horizontal.app.core.Json
import ro.horizontal.app.core.NativeAction

/**
 * Unde merge o acțiune din notificare — la UN singur executant. Cu aplicația
 * vizibilă, pagina (prin store, deci prin coada offline, și își actualizează
 * interfața). Altfel coada nativă. Fiindcă pagina a primit-o, acțiunea intră
 * oricum în coadă, dar ca deja-trimisă (`drainedAt`): doar ca strat peste plan,
 * ca „15 min" să sune la noua oră chiar înainte ca pagina să retrimită lista.
 */
object Actions {
    fun dispatch(ctx: Context, a: NativeAction, now: Long = System.currentTimeMillis()) {
        Notifier.cancel(ctx, a.id)
        val toPage = HorizontalAndroidPlugin.deliverIfVisible(Json.actionToPage(a))
        PlanStore.edit(ctx) { s -> s.copy(queue = s.queue + if (toPage) a.copy(drainedAt = now) else a) to Unit }
        Engine.reschedule(ctx, now)
        if (!toPage) Hooks.afterQueued(ctx)
    }
}
