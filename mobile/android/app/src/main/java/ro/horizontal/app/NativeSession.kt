package ro.horizontal.app

import android.content.Context
import org.json.JSONObject
import ro.horizontal.app.core.Failure
import ro.horizontal.app.core.Tokens
import ro.horizontal.app.core.accountSwitched
import ro.horizontal.app.core.classifyAuth
import ro.horizontal.app.core.parseTokens
import java.io.IOException

/**
 * A doua sesiune a aceluiași utilizator, a cutiei. NU sesiunea WebView-ului:
 * refresh token-ul se rotește la fiecare reîmprospătare, iar doi clienți care
 * și-l împart se deloghează unul pe altul. Refresh-ul e serializat pe proces
 * din același motiv — două refresh-uri simultane cu același token ar omorî sesiunea.
 *
 * Parola nu se păstrează: intră o dată, la login, și pleacă doar spre GoTrue.
 */
object NativeSession {
    private const val PREFS = "hz-session"
    /**
     * Ultimul cont, în afara lui PREFS: `dropSession` și `signOut` șterg acolo, iar
     * comparația de la login trebuie să supraviețuiască exact acelor ștergeri.
     * Nu e un secret (un uuid), deci nu stă în cutia criptată.
     */
    private const val ACCOUNT_PREFS = "hz-account"
    private val lock = Any()

    fun config(ctx: Context): Pair<String, String>? {
        val p = ctx.getSharedPreferences(PREFS, 0)
        return p.getString("url", null)?.let { u -> p.getString("anon", null)?.let { u to it } }
    }

    fun isSignedIn(ctx: Context) = ctx.getSharedPreferences(PREFS, 0).contains("box")

    private fun save(ctx: Context, t: Tokens) {
        val json = JSONObject().put("a", t.access).put("r", t.refresh).put("e", t.expiresAt).put("u", t.userId).toString()
        ctx.getSharedPreferences(PREFS, 0).edit().putString("box", KeystoreBox.encrypt(json)).commit()
    }

    private sealed interface Loaded { object Missing : Loaded; object Broken : Loaded; data class Ok(val t: Tokens) : Loaded }

    private fun load(ctx: Context): Loaded {
        val box = ctx.getSharedPreferences(PREFS, 0).getString("box", null) ?: return Loaded.Missing
        val plain = KeystoreBox.decrypt(box) ?: return Loaded.Broken
        return try {
            val o = JSONObject(plain); Loaded.Ok(Tokens(o.getString("a"), o.getString("r"), o.getLong("e"), o.getString("u")))
        } catch (e: Exception) { Loaded.Broken }
    }

    /** Aruncă `IOException` (rețea) sau `IllegalStateException` (refuz). */
    fun signIn(ctx: Context, url: String, anon: String, email: String, password: String) = synchronized(lock) {
        val r = SupabaseApi.raw("POST", "$url/auth/v1/token?grant_type=password", mapOf("apikey" to anon),
            JSONObject().put("email", email).put("password", password).toString())
        val t = (if (r.status == 200) parseTokens(r.body) else null) ?: throw IllegalStateException("login refuzat (${r.status})")
        // Alt cont decât ultimul: planul și coada sunt ale celuilalt. Golite ÎNAINTE de
        // a salva sesiunea nouă, ca workerul să nu apuce să trimită coada veche cu ea.
        val acct = ctx.getSharedPreferences(ACCOUNT_PREFS, 0)
        if (accountSwitched(acct.getString("lastUserId", null), t.userId)) {
            PlanStore.clear(ctx)
            AlarmScheduler.arm(ctx, null)
            Notifier.cancelAll(ctx)
        }
        acct.edit().putString("lastUserId", t.userId).commit()
        ctx.getSharedPreferences(PREFS, 0).edit().putString("url", url).putString("anon", anon).commit()
        save(ctx, t)
        Notifier.cancelStatus(ctx)
    }

    /** Un access token valid, reîmprospătat la nevoie. `null` = sesiune moartă (șters + notificare „Reconectează"). */
    fun accessToken(ctx: Context, now: Long = System.currentTimeMillis()): String? = session(ctx, now)?.first

    /** Contul sesiunii, fără rețea. `null` = fără sesiune (sau cutie ilizibilă). */
    fun userId(ctx: Context): String? = synchronized(lock) { (load(ctx) as? Loaded.Ok)?.t?.userId }

    /** Tokenul ȘI contul căruia îi aparține, citite împreună — vezi `DrainWorker` (schimbarea de cont). */
    fun session(ctx: Context, now: Long = System.currentTimeMillis()): Pair<String, String>? = synchronized(lock) {
        val t = when (val l = load(ctx)) {
            Loaded.Missing -> return null
            // Cutie care nu se mai deschide (cheia din Keystore s-a pierdut — restaurare
            // pe alt telefon, Keystore resetat): e la fel de moartă ca un token revocat.
            // Fără ramura asta `isSignedIn` ar spune „ok" la nesfârșit, iar mementourile
            // n-ar mai ajunge niciodată pe server fără ca omul să afle de ce.
            Loaded.Broken -> { dropSession(ctx); Notifier.showReconnect(ctx); return null }
            is Loaded.Ok -> l.t
        }
        // Un minut de rezervă: un token care expiră în timpul cererii ar da 401 pe PATCH.
        if (t.expiresAt - 60_000 > now) return t.access to t.userId
        val (url, anon) = config(ctx) ?: return null
        val r = SupabaseApi.raw("POST", "$url/auth/v1/token?grant_type=refresh_token", mapOf("apikey" to anon), JSONObject().put("refresh_token", t.refresh).toString())
        // Un 200 care nu se citește (corp trunchiat, proxy) nu e o sesiune moartă: `null`
        // ar fi citit de apelanți ca „reconectează-te". E o problemă de drum — reîncearcă.
        if (r.status == 200) { val n = parseTokens(r.body) ?: throw IOException("refresh: răspuns ilizibil"); save(ctx, n); return n.access to n.userId }
        if (classifyAuth(r.status, r.body) == Failure.AUTH_DEAD) { dropSession(ctx); Notifier.showReconnect(ctx); return null }
        // 5xx: sesiunea poate fi încă bună; cine cheamă tratează ca rețea și reîncearcă.
        throw IOException("refresh ${r.status}")
    }

    private fun dropSession(ctx: Context) { ctx.getSharedPreferences(PREFS, 0).edit().remove("box").commit() }

    /** Logout: sesiunea, planul, coada, alarmele, notificările. Cererea de logout e best effort. */
    fun signOut(ctx: Context) {
        // Orice eșec aici (rețea, URL stricat) nu are voie să oprească ștergerea de mai jos:
        // după logout, mementourile contului vechi n-au ce mai căuta pe telefon.
        try {
            val cfg = config(ctx); val l = synchronized(lock) { load(ctx) }
            if (cfg != null && l is Loaded.Ok) SupabaseApi.raw("POST", "${cfg.first}/auth/v1/logout?scope=local",
                mapOf("apikey" to cfg.second, "Authorization" to "Bearer ${l.t.access}"), null)
        } catch (e: Exception) {}
        synchronized(lock) { ctx.getSharedPreferences(PREFS, 0).edit().clear().commit() }
        PlanStore.clear(ctx)
        AlarmScheduler.arm(ctx, null)
        Notifier.cancelAll(ctx)
    }
}
