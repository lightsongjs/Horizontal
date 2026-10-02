package ro.horizontal.app

import android.content.Context
import android.util.Log
import androidx.work.*
import org.json.JSONException
import ro.horizontal.app.core.NativeList
import ro.horizontal.app.core.parseIssues
import ro.horizontal.app.core.syncQuery
import java.io.IOException
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Sursa 2 a planului, când pagina nu rulează: un memento pus pe laptop ajunge
 * pe telefon fără ca aplicația să fi fost deschisă. Pornește la 15 min (minimul
 * WorkManager), la revenirea rețelei, după fiecare alarmă și acțiune, la boot.
 * În Doze WorkManager amână până la ferestrele de mentenanță — golul asumat din
 * întrebarea 3 a spec-ului; ieșirea e FCM, cu server.
 */
class SyncWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
    override fun doWork(): Result {
        val ctx = applicationContext
        // `readAt` = PORNIREA cererii: o acțiune trimisă în timpul ei nu e încă în răspuns.
        val startedAt = System.currentTimeMillis()
        // Contul pentru care pleacă cererea. Lista lui n-are voie să ajungă în planul
        // altui cont: un login pe alt cont în timpul cererii golește planul (`signIn`),
        // iar o scriere întârziată l-ar umple la loc cu mementourile celui vechi.
        val owner = NativeSession.userId(ctx) ?: return Result.success()
        val r = try { SupabaseApi.rest(ctx, "GET", syncQuery(startedAt), asUser = owner) }
            catch (e: AccountChanged) { return Result.success() }
            catch (e: IOException) { return Result.retry() }
            ?: return Result.success()   // fără sesiune: nimic de citit; pagina rămâne sursa
        if (r.status !in 200..299) return if (r.status >= 500) Result.retry() else Result.success()
        val list = try { parseIssues(r.body, ZoneId.systemDefault()) } catch (e: JSONException) {
            // Un 200 cu corp ilizibil (proxy, portal captiv) nu e o listă goală: o listă
            // goală ar retrage toate notificările de pe ecran. Planul vechi rămâne.
            Log.w("hz-sync", "răspuns ilizibil", e); return Result.retry()
        }
        // Verificat SUB lacătul planului, ca un logout sau o schimbare de cont să nu se
        // strecoare între verificare și scriere. `lastAccount`, nu `userId`: vezi acolo.
        val written = PlanStore.edit(ctx) { s ->
            if (!NativeSession.isSignedIn(ctx) || NativeSession.lastAccount(ctx) != owner) return@edit null to false
            s.copy(native = NativeList(list, startedAt), lastSyncAt = System.currentTimeMillis()) to true
        }
        if (written) Engine.reschedule(ctx)
        return Result.success()
    }

    companion object {
        private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        /** O singură sincronizare în așteptare: zece alarme la rând nu fac zece cereri. */
        fun now(ctx: Context) = WorkManager.getInstance(ctx).enqueueUniqueWork("hz-sync-now", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(net).build())
        fun schedulePeriodic(ctx: Context) = WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("hz-sync", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(net).build())
    }
}
