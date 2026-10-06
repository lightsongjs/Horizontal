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
        /** Sunate cât laptopul era activ: așteaptă reverificarea de la +30 s (`DeferGate`). */
        val deferred: List<Reminder> = emptyList(),
        /** Agenda widget-ului, din cele două surse; câștigă `readAt` mai mare (`visibleAgenda`). */
        val agendaPage: AgendaList? = null,
        val agendaNative: AgendaList? = null,
        /** „Gata" prunate din coadă, încă nevăzute de o agendă mai nouă (`holdDone`). */
        val agendaHeld: Map<String, Long> = emptyMap(),
        /** Sarcinile din fereastra de quick add, până ajung pe server (`core/Create.kt`). */
        val creates: List<NativeCreate> = emptyList(),
        /** Proiectele și oamenii pentru fereastră, împinși de pagină (`setCaptureData`). */
        val capture: CaptureData? = null,
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

    /**
     * O stare ilizibilă (JSON stricat — scriere întreruptă, format schimbat între
     * versiuni) ar arunca în FIECARE receiver și worker, pe veci: nicio alarmă,
     * nicio acțiune. Starea goală e mai bună: următoarea listă a paginii sau
     * sincronizare nativă o repopulează, iar următoarea scriere o suprascrie.
     */
    private fun load(ctx: Context): State = try { loadOrThrow(ctx) } catch (e: Exception) {
        android.util.Log.w("hz-plan", "stare ilizibilă, pornesc de la zero", e)
        State()
    }

    private fun loadOrThrow(ctx: Context): State {
        val p = ctx.getSharedPreferences(PREFS, 0)
        val page = p.getString("page", null)?.let { JSONObject(it) }?.let { o ->
            PageList(reminders(o.optJSONArray("list")), (0 until o.getJSONArray("held").length()).map { o.getJSONArray("held").getString(it) }.toSet(), o.getLong("readAt"))
        }
        val native = p.getString("native", null)?.let { JSONObject(it) }?.let { o -> NativeList(reminders(o.optJSONArray("list")), o.getLong("readAt")) }
        val queue = p.getString("queue", null)?.let { JSONArray(it) }?.let { a -> (0 until a.length()).mapNotNull { Json.actionFromJson(a.getJSONObject(it)) } }.orEmpty()
        val shown = p.getString("shown", null)?.let { JSONObject(it) }?.let { o -> o.keys().asSequence().associateWith { o.getString(it) } }.orEmpty()
        val agendaPage = p.getString("agendaPage", null)?.let { Json.agendaFromJson(JSONObject(it)) }
        val agendaNative = p.getString("agendaNative", null)?.let { Json.agendaFromJson(JSONObject(it)) }
        val creates = p.getString("creates", null)?.let { JSONArray(it) }?.let { a -> (0 until a.length()).mapNotNull { Json.createFromJson(a.getJSONObject(it)) } }.orEmpty()
        val capture = p.getString("capture", null)?.let { CaptureJson.fromJson(JSONObject(it)) }
        val agendaHeld = p.getString("agendaHeld", null)?.let { JSONObject(it) }?.let { o -> o.keys().asSequence().associateWith { o.getLong(it) } }.orEmpty()
        return State(page, native, queue, p.getStringSet("fired", emptySet())!!.toSet(), shown,
            p.getLong("nextAlarmAt", -1).takeIf { it >= 0 }, p.getBoolean("exactUsed", true), p.getLong("lastSyncAt", -1).takeIf { it >= 0 },
            reminders(p.getString("deferred", null)?.let { JSONArray(it) }), agendaPage, agendaNative, agendaHeld, creates, capture)
    }

    private fun save(ctx: Context, s: State) {
        ctx.getSharedPreferences(PREFS, 0).edit()
            .putString("page", s.page?.let { JSONObject().put("list", arr(it.reminders)).put("held", JSONArray(it.heldIds.toList())).put("readAt", it.readAt).toString() })
            .putString("native", s.native?.let { JSONObject().put("list", arr(it.reminders)).put("readAt", it.readAt).toString() })
            .putString("queue", JSONArray().also { j -> s.queue.forEach { j.put(Json.actionToJson(it)) } }.toString())
            .putStringSet("fired", s.fired)
            .putString("shown", JSONObject(s.shown).toString())
            .putLong("nextAlarmAt", s.nextAlarmAt ?: -1).putBoolean("exactUsed", s.exactUsed).putLong("lastSyncAt", s.lastSyncAt ?: -1)
            .putString("deferred", arr(s.deferred).toString())
            .putString("agendaPage", s.agendaPage?.let { Json.agendaToJson(it).toString() })
            .putString("agendaNative", s.agendaNative?.let { Json.agendaToJson(it).toString() })
            .putString("agendaHeld", JSONObject(s.agendaHeld as Map<*, *>).toString())
            .putString("creates", JSONArray().also { a -> s.creates.forEach { a.put(Json.createToJson(it)) } }.toString())
            .putString("capture", s.capture?.let { CaptureJson.toJson(it).toString() })
            .commit()
    }
}
