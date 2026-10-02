package ro.horizontal.app

import android.content.Context
import androidx.work.*
import org.json.JSONObject
import ro.horizontal.app.core.*
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Trimite coada nativă, câte un element, în ordine. Un element e marcat „în
 * zbor" ÎNAINTE de cerere, sub lacătul lui PlanStore: pagina nu-l mai poate
 * prelua cât e pe drum (o acțiune, un singur executant).
 */
class DrainWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
    override fun doWork(): Result {
        val ctx = applicationContext
        var changed = false
        while (true) {
            val a = PlanStore.edit(ctx) { s ->
                val next = NativeQueue.nextToDrain(s.queue)
                (if (next != null) s.copy(queue = NativeQueue.markInFlight(s.queue, next.uid)) else s) to next
            } ?: break
            val req = buildPatch(a)
            val body = JSONObject(req.body).toString()
            val outcome = try {
                val r = SupabaseApi.rest(ctx, "PATCH", "issues?${req.query}", body, prefer = "return=representation")
                if (r == null) outcomeOf(null, false, true) else outcomeOf(r.status, false, false)
            } catch (e: IOException) { outcomeOf(null, true, false) }
            // Cererea a durat (până la 20s); între timp omul s-a putut deloga — `signOut`
            // golește coada. Decizia (`afterAttempt`) e luată SUB lacăt, ca un logout să
            // nu se strecoare între verificare și scriere. Element dispărut = nu scriem
            // nimic și ne oprim: nici `finish`, nici o sincronizare pe o stare golită.
            val ours = PlanStore.edit(ctx) { s ->
                val q = afterAttempt(s.queue, a.uid, outcome, NativeSession.isSignedIn(ctx), System.currentTimeMillis())
                    ?: return@edit null to false
                s.copy(queue = q) to true
            }
            if (!ours) return Result.success()
            when (outcome) {
                Outcome.DONE, Outcome.DROP -> changed = true
                Outcome.RETRY -> { finish(ctx, changed); return Result.retry() }
                Outcome.KEEP_NO_SESSION -> { finish(ctx, changed); return Result.success() }
            }
        }
        finish(ctx, changed)
        return Result.success()
    }

    private fun finish(ctx: Context, changed: Boolean) {
        Engine.reschedule(ctx)
        if (changed) { HorizontalAndroidPlugin.notifyChanged(); SyncWorker.now(ctx) }
    }

    companion object {
        fun enqueue(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<DrainWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("hz-drain", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
        }
    }
}
