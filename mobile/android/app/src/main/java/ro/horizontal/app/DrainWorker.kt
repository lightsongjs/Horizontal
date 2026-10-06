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
        PlanStore.edit(ctx) { s -> s.copy(queue = NativeQueue.releaseAllInFlight(s.queue), creates = s.creates.map { it.copy(inFlight = false) }) to Unit }
        // Creările întâi: o bifă din widget pe o sarcină abia capturată pleacă pe ID-ul
        // real doar după ce sarcina există (remaparea din `sendCreate`).
        when (drainCreates(ctx)) {
            Outcome.RETRY -> { finish(ctx, true); return Result.retry() }
            Outcome.KEEP_NO_SESSION -> { finish(ctx, true); return Result.success() }
            else -> {}
        }
        if (isStopped) return Result.success()
        when (try { drainFiles(ctx) } catch (e: AccountChanged) { Outcome.KEEP_NO_SESSION } catch (e: Exception) { Outcome.RETRY }) {
            Outcome.RETRY -> { finish(ctx, true); return Result.retry() }
            Outcome.KEEP_NO_SESSION -> { finish(ctx, true); return Result.success() }
            else -> {}
        }
        changed = changed || createdAny
        while (true) {
            // REPLACE (vezi `enqueue`) poate anula un worker în plină buclă. Anularea doar
            // ridică `isStopped`, nu oprește firul: fără verificarea asta, cel vechi ar
            // continua să trimită PATCH-uri în paralel cu cel nou, pe aceeași coadă.
            // Ce a rămas îl ia cel nou (care eliberează și „în zbor"-ul de la pornire).
            if (isStopped) return Result.success()
            // Contul pentru care pleacă elementul, citit în ACEEAȘI editare care îl marchează
            // „în zbor": `signIn` pe alt cont golește coada sub lacătul ăsta, deci contul
            // citit aici e sigur cel căruia îi aparține coada. Citit după, un login strecurat
            // între cele două ar fi dat tokenul NOULUI cont unei acțiuni a celui vechi.
            // `lastAccount`, nu `userId`: sub lacătul planului, vezi `NativeSession.lastAccount`.
            // `AccountChanged` oprește cererea dacă sesiunea e acum a altcuiva.
            val (a, owner) = PlanStore.edit(ctx) { s ->
                val next = NativeQueue.nextToDrain(s.queue)
                (if (next != null) s.copy(queue = NativeQueue.markInFlight(s.queue, next.uid)) else s) to (next to NativeSession.lastAccount(ctx))
            }
            if (a == null) break
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

    private var createdAny = false

    /** `DONE` = coada de creări e goală (sau a rămas doar ce nu se mai poate trimite acum). */
    private fun drainCreates(ctx: Context): Outcome {
        while (true) {
            if (isStopped) return Outcome.DONE
            val (c, owner) = PlanStore.edit(ctx) { s ->
                val next = s.creates.firstOrNull { it.realId == null }
                (if (next != null) s.copy(creates = s.creates.map { if (it.uid == next.uid) it.copy(inFlight = true) else it }) else s) to (next to NativeSession.lastAccount(ctx))
            }
            if (c == null) return Outcome.DONE
            val outcome = try { sendCreate(ctx, c, owner ?: return release(ctx, c, Outcome.KEEP_NO_SESSION)) }
                catch (e: AccountChanged) { return release(ctx, c, Outcome.KEEP_NO_SESSION) }
                catch (e: Exception) { Outcome.RETRY }
            when (outcome) {
                Outcome.DONE -> createdAny = true
                Outcome.DROP -> {
                    PlanStore.edit(ctx) { s -> s.copy(creates = s.creates.filterNot { it.uid == c.uid }) to Unit }
                    Notifier.showCreateFailed(ctx, c.title)
                    createdAny = true
                }
                else -> return release(ctx, c, outcome)
            }
        }
    }

    /**
     * Fișierele sarcinilor deja create: întâi obiectul (cale fixă), apoi rândul (ID
     * fix) — o retrimitere dă „Duplicate"/409, nu dubluri. Peste o oră, abandonate.
     */
    private fun drainFiles(ctx: Context): Outcome {
        val owner = NativeSession.lastAccount(ctx) ?: return Outcome.KEEP_NO_SESSION
        for (c in PlanStore.read(ctx).creates.filter { it.realId != null && it.files.any { f -> !f.uploaded } }) {
            if (isStopped) return Outcome.DONE
            val issueId = c.realId!!
            if (filesExpired(c, System.currentTimeMillis())) {
                c.files.filter { !it.uploaded }.forEach { java.io.File(it.path).delete() }
                setFiles(ctx, c.uid) { fs -> fs.map { it.copy(uploaded = true) } }
                Notifier.showFilesFailed(ctx, c.title)
                continue
            }
            for (f in c.files.filter { !it.uploaded }) {
                val file = java.io.File(f.path)
                if (!file.exists()) { setFiles(ctx, c.uid) { fs -> fs.map { if (it.attachmentId == f.attachmentId) it.copy(uploaded = true) else it } }; continue }
                val up = SupabaseApi.storage(ctx, attachmentPath(c.projectId, issueId, f.attachmentId), file, f.contentType, owner) ?: return Outcome.KEEP_NO_SESSION
                if (!storageDone(up.status, up.body)) return outcomeOf(up.status, false, false).let { if (it == Outcome.DROP) Outcome.RETRY else it }
                val row = SupabaseApi.rest(ctx, "POST", "attachments", attachmentRow(f, c.projectId, issueId).toString(), prefer = "return=minimal", asUser = owner)
                    ?: return Outcome.KEEP_NO_SESSION
                if (row.status !in 200..299 && row.status != 409) return outcomeOf(row.status, false, false).let { if (it == Outcome.DROP) Outcome.RETRY else it }
                file.delete()
                setFiles(ctx, c.uid) { fs -> fs.map { if (it.attachmentId == f.attachmentId) it.copy(uploaded = true) else it } }
                createdAny = true
            }
        }
        return Outcome.DONE
    }

    private fun setFiles(ctx: Context, uid: String, f: (List<NativeFile>) -> List<NativeFile>) =
        PlanStore.edit(ctx) { s -> s.copy(creates = s.creates.map { if (it.uid == uid) it.copy(files = f(it.files)) else it }) to Unit }

    private fun release(ctx: Context, c: NativeCreate, o: Outcome): Outcome {
        PlanStore.edit(ctx) { s -> s.copy(creates = s.creates.map { if (it.uid == c.uid) it.copy(inFlight = false) else it }) to Unit }
        return o
    }

    /**
     * O creare: ID ales și SALVAT înainte de POST (`attemptId`), deci o retrimitere
     * după rețea căzută sau proces omorât folosește același ID și nu dublează.
     * 409 → al nostru (retrimitere) = gata; al altcuiva → ID nou, max 5 încercări.
     */
    private fun sendCreate(ctx: Context, c0: NativeCreate, owner: String): Outcome {
        var c = c0
        while (true) {
            val proj = SupabaseApi.rest(ctx, "GET", "projects?id=eq.${c.projectId}&select=prefix,current_wave", asUser = owner) ?: return Outcome.KEEP_NO_SESSION
            if (proj.status !in 200..299) return outcomeOf(proj.status, false, false)
            val p = org.json.JSONArray(proj.body).optJSONObject(0) ?: return Outcome.DROP   // proiect șters / fără acces
            val id = c.attemptId ?: run {
                val ex = SupabaseApi.rest(ctx, "GET", "issues?project_id=eq.${c.projectId}&select=id", asUser = owner) ?: return Outcome.KEEP_NO_SESSION
                if (ex.status !in 200..299) return outcomeOf(ex.status, false, false)
                val a = org.json.JSONArray(ex.body)
                val next = nextIssueId((0 until a.length()).map { a.getJSONObject(it).getString("id") }, p.getString("prefix"))
                PlanStore.edit(ctx) { s -> s.copy(creates = s.creates.map { if (it.uid == c.uid) it.copy(attemptId = next) else it }) to Unit }
                c = c.copy(attemptId = next)
                next
            }
            val r = SupabaseApi.rest(ctx, "POST", "issues", insertBody(c, id, p.optInt("current_wave", 1)).toString(), prefer = "return=minimal", asUser = owner)
                ?: return Outcome.KEEP_NO_SESSION
            val done = when {
                r.status in 200..299 -> true
                r.status == 409 -> {
                    val g = SupabaseApi.rest(ctx, "GET", "issues?id=eq.$id&select=title,created_by,project_id", asUser = owner) ?: return Outcome.KEEP_NO_SESSION
                    if (g.status !in 200..299) return outcomeOf(g.status, false, false)
                    conflictOf(org.json.JSONArray(g.body).optJSONObject(0), owner, c) == Conflict.OURS
                }
                else -> return outcomeOf(r.status, false, false)
            }
            if (done) { markCreated(ctx, c, id); return Outcome.DONE }
            // Numărul l-a luat altcineva între citire și insert: altul, de la zero.
            if (c.tries + 1 >= 5) return Outcome.DROP
            c = c.copy(attemptId = null, tries = c.tries + 1)
            PlanStore.edit(ctx) { s -> s.copy(creates = s.creates.map { if (it.uid == c.uid) it.copy(attemptId = null, tries = c.tries) else it }) to Unit }
        }
    }

    /** Sub lacăt: ID-ul provizoriu devine cel real peste tot unde îl ține cutia. */
    private fun markCreated(ctx: Context, c: NativeCreate, id: String) {
        val now = System.currentTimeMillis()
        PlanStore.edit(ctx) { s ->
            s.copy(
                creates = s.creates.map { if (it.uid == c.uid) it.copy(realId = id, attemptId = id, drainedAt = now, inFlight = false) else it },
                queue = remapActions(s.queue, c.tempId, id),
                fired = remapFired(s.fired, c.tempId, id),
                shown = remapShown(s.shown, c.tempId, id),
            ) to Unit
        }
        // O notificare deja afișată pe ID-ul provizoriu (tag = id) ar rămâne orfană.
        Notifier.cancel(ctx, c.tempId)
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
