package ro.horizontal.app

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import ro.horizontal.app.core.*
import java.io.IOException

/**
 * Tichetele care au ajuns pe mine, verificate din `SyncWorker` (regula: `core/Handoffs.kt`).
 * Starea stă separat de plan: un eșec aici n-are voie să atingă mementourile, iar
 * planul se golește la schimbarea de cont pe drumul lui.
 */
object HandoffWatch {
    private const val PREFS = "hz-handoffs"
    private val lock = Any()

    private fun load(ctx: Context): HandoffState? {
        val raw = ctx.getSharedPreferences(PREFS, 0).getString("state", null) ?: return null
        return try {
            val o = JSONObject(raw)
            val a = o.getJSONArray("known")
            HandoffState(o.getString("owner"), (0 until a.length()).map { a.getString(it) }.toSet(), o.getLong("checkedAt"))
        } catch (e: JSONException) { null }
    }

    private fun save(ctx: Context, s: HandoffState) {
        val json = JSONObject().put("owner", s.owner).put("known", JSONArray(s.known.sorted())).put("checkedAt", s.checkedAt).toString()
        ctx.getSharedPreferences(PREFS, 0).edit().putString("state", json).commit()
    }

    /** Logout / alt cont: următoarea verificare învață din nou, în tăcere. */
    fun reset(ctx: Context) = synchronized(lock) { ctx.getSharedPreferences(PREFS, 0).edit().clear().commit() }

    /** API 8: pagina a arătat aceste tichete în „Ale mele" — nu se mai anunță. */
    fun pageSeen(ctx: Context, ids: Collection<String>) = synchronized(lock) {
        val owner = NativeSession.lastAccount(ctx) ?: return@synchronized
        mergePageSeen(load(ctx), owner, ids)?.let { save(ctx, it) }
    }

    /**
     * O verificare. `startedAt` = pornirea rulării: devine `since` pentru următoarea.
     * Excepțiile de rețea urcă la `SyncWorker`, care le înghite — mementourile au
     * fost deja scrise, iar următoarea rulare reia comparația de unde a rămas.
     */
    fun check(ctx: Context, owner: String, me: Me, startedAt: Long) {
        val assigneeId = me.assigneeId ?: return   // cont nelegat: „Ale mele" e gol și în pagină
        val r = SupabaseApi.rest(ctx, "GET", mineOpenQuery(assigneeId), asUser = owner) ?: return
        if (r.status !in 200..299) return
        val current = try { parseMineOpen(r.body) } catch (e: JSONException) { null } ?: return
        val prev = synchronized(lock) { load(ctx) }
        val fresh = newlyMine(prev, owner, current)
        val notices = if (fresh.isEmpty() || prev == null) emptyList() else try {
            arrivals(ctx, owner, assigneeId, fresh.sorted(), prev.checkedAt)
        } catch (e: JSONException) { Log.w("hz-handoff", "răspuns ilizibil", e); return }
        synchronized(lock) {
            // Alt cont între timp: mulțimea asta nu mai e a nimănui.
            if (NativeSession.lastAccount(ctx) != owner) return
            // Ce a raportat pagina între citire și acum rămâne știut (`pageSeen`).
            val seenMeanwhile = load(ctx)?.takeIf { it.owner == owner }?.known.orEmpty() - prev?.known.orEmpty()
            save(ctx, HandoffState(owner, current, startedAt))
            for (n in notices.filter { it.id !in seenMeanwhile }.take(HANDOFF_MAX_NOTICES)) Notifier.showHandoff(ctx, n.id, n.title, n.actorName)
        }
    }

    data class Notice(val id: String, val title: String, val actorName: String?)

    private fun arrivals(ctx: Context, owner: String, assigneeId: String, ids: List<String>, since: Long): List<Notice> {
        fun get(q: String): String? = SupabaseApi.rest(ctx, "GET", q, asUser = owner)?.takeIf { it.status in 200..299 }?.body
        val issues = get(arrivalsQuery(ids)) ?: throw IOException("sosiri")
        val events = get(handoffEventsQuery(ids, assigneeId)) ?: throw IOException("pase")
        // Fără vizite (eșec) se anunță oricum: mai bine o notificare în plus decât o pasă pierdută.
        val seen = get(seenQuery(ids, owner)) ?: "[]"
        val decided = parseArrivals(ids, issues, events, seen).mapNotNull { decideArrival(it, owner, since) }
        val actors = decided.mapNotNull { it.actor }.toSet()
        val names = if (actors.isEmpty()) emptyMap() else get(actorNamesQuery(actors))?.let(::parseActorNames).orEmpty()
        return decided.map { Notice(it.id, it.title, it.actor?.let(names::get)) }
    }
}
