package ro.horizontal.app

import android.app.Application

/**
 * Locul hook-urilor (`Hooks`): `Application.onCreate` rulează înaintea oricărui
 * receiver sau activități, deci un receiver pornit la rece de o alarmă vede
 * hook-urile deja puse, indiferent de ordinea în care se încarcă obiectele.
 */
class HorizontalApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.ensureChannels(this)
        Hooks.afterQueued = { DrainWorker.enqueue(it) }
        Hooks.afterAlarm = { SyncWorker.now(it) }
        Hooks.afterBoot = { DrainWorker.enqueue(it); SyncWorker.now(it); SyncWorker.schedulePeriodic(it) }
        // KEEP: o pornire nu resetează ceasul de 15 min. Pus aici, nu doar la boot: după
        // instalare (sau „Force stop" + redeschidere) nu vine niciun BOOT_COMPLETED.
        SyncWorker.schedulePeriodic(this)
        Notifier.extraActions = { ctx, r, b -> b.addAction(0, "Amână…", SnoozeActivity.pendingIntent(ctx, r)) }
    }
}
