package ro.horizontal.app

import android.content.Context
import androidx.work.*
import org.json.JSONObject
import ro.horizontal.app.core.*
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
        // O încercare omorâtă (proces ucis, worker anulat de REPLACE) lasă `inFlight`
        // pe disc, iar cât un element zboară `nextToDrain` și `take` nu mai dau nimic.
        PlanStore.edit(ctx) { s -> s.copy(queue = NativeQueue.releaseAllInFlight(s.queue)) to Unit }
        while (true) {
            // REPLACE (vezi `enqueue`) poate anula un worker în plină buclă. Anularea doar
            // ridică `isStopped`, nu oprește firul: fără verificarea asta, cel vechi ar
            // continua să trimită PATCH-uri în paralel cu cel nou, pe aceeași coadă.
            // Ce a rămas îl ia cel nou (care eliberează și „în zbor"-ul de la pornire).
            if (isStopped) return Result.success()
            val a = PlanStore.edit(ctx) { s ->
                val next = NativeQueue.nextToDrain(s.queue)
                (if (next != null) s.copy(queue = NativeQueue.markInFlight(s.queue, next.uid)) else s) to next
            } ?: break
            // Contul pentru care pleacă elementul. Un login pe alt cont între marcare și
            // cerere ar da altfel tokenul NOULUI cont unei acțiuni a celui vechi;
            // `AccountChanged` o oprește înainte de PATCH (coada o golește oricum `signIn`).
            val owner = NativeSession.userId(ctx)
            val req = buildPatch(a)
            val body = JSONObject(req.body).toString()
            val outcome = try {
                val r = SupabaseApi.rest(ctx, "PATCH", "issues?${req.query}", body, prefer = "return=representation", asUser = owner)
                if (r == null) outcomeOf(null, false, true) else outcomeOf(r.status, false, false)
            } catch (e: AccountChanged) {
                PlanStore.edit(ctx) { s -> (if (s.queue.any { it.uid == a.uid }) s.copy(queue = NativeQueue.release(s.queue, a.uid)) else null) to Unit }
                return Result.success()
            } catch (e: Exception) {
                // Orice altă excepție (IOException, dar și un bug, un URL stricat): elementul
                // se eliberează și se reîncearcă — rămas „în zbor", ar bloca coada.
                outcomeOf(null, true, false)
            }
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
            // REPLACE, nu APPEND_OR_REPLACE: o atingere nouă nu stă la coadă după o rundă
            // în backoff (exponențial, până la 5 h). Dacă anulează un worker în plină
            // cerere, elementul lui rămas „în zbor" e eliberat la pornirea celui nou.
            // LINEAR 30s: o coadă de mementouri nu are ce câștiga din pauze de ore.
            val req = OneTimeWorkRequestBuilder<DrainWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("hz-drain", ExistingWorkPolicy.REPLACE, req)
        }
    }
}
