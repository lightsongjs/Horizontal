package ro.horizontal.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import ro.horizontal.app.core.*
import kotlin.concurrent.thread

/**
 * Laptopul activ amână mementoul telefonului cu 30 s; dacă omul răspunde acolo,
 * telefonul nu mai sună. Regula, pură și testată, e în `core/Gate.kt`; aici
 * sunt doar rețeaua, alarma de reverificare și notificarea.
 *
 * Totul rulează în afara firului principal (`goAsync`): firul principal nu are
 * voie la rețea, iar un receiver are ~10 s — de-aia cererile au 4 s.
 */
object DeferGate {
    private fun deviceIdle(ctx: Context): Boolean {
        val pm = ctx.getSystemService(PowerManager::class.java)
        return pm.isDeviceIdleMode || (Build.VERSION.SDK_INT >= 33 && pm.isDeviceLightIdleMode)
    }

    private fun desktopActive(ctx: Context): Boolean? = try {
        SupabaseApi.rest(ctx, "POST", "rpc/desktop_active", "{}", fast = true)?.takeIf { it.status == 200 }?.let { parseDesktopActive(it.body) }
    } catch (e: Exception) { null }

    private fun serverState(ctx: Context, id: String): ServerState? = try {
        SupabaseApi.rest(ctx, "GET", recheckQuery(id), fast = true)?.takeIf { it.status == 200 }?.let { parseRecheck(it.body) }
    } catch (e: Exception) { null }

    /** Arată doar ce planul mai ține afișat (sub lacăt, ca `Engine`: altfel o retragere paralelă ar lăsa o notificare orfană). */
    private fun showIfStillShown(ctx: Context, r: Reminder, server: ServerState?) = PlanStore.locked {
        if (showAfterDefer(r, server, PlanStore.read(ctx).shown[r.id] == r.key)) Notifier.show(ctx, r)
    }

    /** Alarma a sunat. */
    fun onAlarm(ctx: Context) {
        val fire = Engine.reschedule(ctx, hold = true)
        if (fire.isEmpty()) return
        val idle = deviceIdle(ctx)
        if (!shouldDefer(if (idle) null else desktopActive(ctx), idle)) {
            fire.forEach { showIfStillShown(ctx, it, null) }
            return
        }
        PlanStore.edit(ctx) { s -> s.copy(deferred = s.deferred + fire) to Unit }
        arm(ctx, System.currentTimeMillis() + DEFER_MS)
    }

    /** +30 s: ce a rămas nebifat și neamânat pe laptop sună acum. */
    fun onRecheck(ctx: Context) {
        val taken = PlanStore.edit(ctx) { s -> s.copy(deferred = emptyList()) to s.deferred }
        taken.forEach { showIfStillShown(ctx, it, serverState(ctx, it.id)) }
    }

    /** Repornire în mijlocul celor 30 s: alarma s-a pierdut, deci sună fără reverificare. */
    fun flush(ctx: Context) {
        val taken = PlanStore.edit(ctx) { s -> (if (s.deferred.isEmpty()) null else s.copy(deferred = emptyList())) to s.deferred }
        taken.forEach { showIfStillShown(ctx, it, null) }
    }

    private fun pi(ctx: Context) = PendingIntent.getBroadcast(ctx, 3, Intent(ctx, RecheckReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun arm(ctx: Context, at: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        if (AlarmScheduler.canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(ctx))
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(ctx))
    }

    /** `goAsync` + fir: rețeaua n-are voie pe firul principal. */
    fun async(receiver: BroadcastReceiver, fn: () -> Unit) {
        val pending = receiver.goAsync()
        thread(name = "hz-gate") { try { fn() } finally { pending.finish() } }
    }
}

class RecheckReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) = DeferGate.async(this) {
        DeferGate.onRecheck(ctx)
        Hooks.afterAlarm(ctx)
    }
}
