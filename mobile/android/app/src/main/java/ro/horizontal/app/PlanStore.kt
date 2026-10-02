package ro.horizontal.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import ro.horizontal.app.core.*

/**
 * Starea cutiei, pe disc (SharedPreferences, `commit()` — procesul poate muri
 * imediat după un receiver). Un singur lacăt pe proces: receiverele, workerii
 * și pluginul scriu aceeași stare din fire diferite.
 */
object PlanStore {
    data class State(
        val page: PageList? = null,
        val native: NativeList? = null,
        val queue: List<NativeAction> = emptyList(),
        val fired: Set<String> = emptySet(),
        val shown: Map<String, String> = emptyMap(),
        val nextAlarmAt: Long? = null,
        val exactUsed: Boolean = true,
        val lastSyncAt: Long? = null,
    )

    private const val PREFS = "hz-plan"
    private val lock = Any()

    fun read(ctx: Context): State = synchronized(lock) { load(ctx) }

    /** `fn` întoarce starea nouă; `null` = nimic de scris (vezi `DrainWorker`, după logout). */
    fun <T> edit(ctx: Context, fn: (State) -> Pair<State?, T>): T = synchronized(lock) {
        val (next, out) = fn(load(ctx))
        if (next != null) save(ctx, next)
        out
    }

    /**
     * Lacătul stării, ținut și peste efectele care decurg din ea (notificări).
     * Reentrant (`synchronized`), deci `edit` dinăuntru nu se blochează singur.
     */
    fun <T> locked(fn: () -> T): T = synchronized(lock) { fn() }

    fun clear(ctx: Context) = synchronized(lock) { ctx.getSharedPreferences(PREFS, 0).edit().clear().commit() }

    private fun reminders(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { Json.reminderFromJson(a!!.getJSONObject(it)) }
    private fun arr(list: List<Reminder>) = JSONArray().also { j -> list.forEach { j.put(Json.reminderToJson(it)) } }

    private fun load(ctx: Context): State {
        val p = ctx.getSharedPreferences(PREFS, 0)
        val page = p.getString("page", null)?.let { JSONObject(it) }?.let { o ->
            PageList(reminders(o.optJSONArray("list")), (0 until o.getJSONArray("held").length()).map { o.getJSONArray("held").getString(it) }.toSet(), o.getLong("readAt"))
        }
        val native = p.getString("native", null)?.let { JSONObject(it) }?.let { o -> NativeList(reminders(o.optJSONArray("list")), o.getLong("readAt")) }
        val queue = p.getString("queue", null)?.let { JSONArray(it) }?.let { a -> (0 until a.length()).mapNotNull { Json.actionFromJson(a.getJSONObject(it)) } }.orEmpty()
        val shown = p.getString("shown", null)?.let { JSONObject(it) }?.let { o -> o.keys().asSequence().associateWith { o.getString(it) } }.orEmpty()
        return State(page, native, queue, p.getStringSet("fired", emptySet())!!.toSet(), shown,
            p.getLong("nextAlarmAt", -1).takeIf { it >= 0 }, p.getBoolean("exactUsed", true), p.getLong("lastSyncAt", -1).takeIf { it >= 0 })
    }

    private fun save(ctx: Context, s: State) {
        ctx.getSharedPreferences(PREFS, 0).edit()
            .putString("page", s.page?.let { JSONObject().put("list", arr(it.reminders)).put("held", JSONArray(it.heldIds.toList())).put("readAt", it.readAt).toString() })
            .putString("native", s.native?.let { JSONObject().put("list", arr(it.reminders)).put("readAt", it.readAt).toString() })
            .putString("queue", JSONArray().also { j -> s.queue.forEach { j.put(Json.actionToJson(it)) } }.toString())
            .putStringSet("fired", s.fired)
            .putString("shown", JSONObject(s.shown).toString())
            .putLong("nextAlarmAt", s.nextAlarmAt ?: -1).putBoolean("exactUsed", s.exactUsed).putLong("lastSyncAt", s.lastSyncAt ?: -1)
            .commit()
    }
}
