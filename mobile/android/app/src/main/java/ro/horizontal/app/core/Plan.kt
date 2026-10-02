package ro.horizontal.app.core

/** Un memento din plan. `key` = `id@ISO`: unul amânat e ALT memento, nu același mutat. */
data class Reminder(
    val key: String, val id: String, val at: Long, val title: String, val body: String,
    val dueAt: String?, val allDay: Boolean,
)

/** Ultima listă a paginii. `readAt` = 0 când pagina era offline (cache, poate vechi). */
data class PageList(val reminders: List<Reminder>, val heldIds: Set<String>, val readAt: Long)

/** Ultima citire nativă. `readAt` = momentul în care a PORNIT cererea, nu cel al răspunsului. */
data class NativeList(val reminders: List<Reminder>, val readAt: Long)

/**
 * O acțiune din notificare. `drainedAt` = trimisă (de worker) sau preluată (de
 * pagină). Rămâne în coadă, aplicată peste plan, până sosește o listă citită
 * DUPĂ ea — altfel între trimitere și următoarea sincronizare planul vechi
 * ar fi readus mementoul amânat la ora veche.
 */
data class NativeAction(
    val uid: String, val kind: Kind, val id: String,
    val remindAt: Long? = null,
    /** Noua scadență, ISO, doar când amânarea o mută. */
    val dueAt: String? = null,
    /** Scadența din notificare — garda lui „Gata" (vezi `buildPatch`). */
    val prevDueAt: String? = null,
    val title: String, val body: String, val allDay: Boolean = false,
    val createdAt: Long, val drainedAt: Long? = null, val inFlight: Boolean = false,
) { enum class Kind { DONE, UNTIL } }

/** Aceeași regulă ca `TTL: 3600` la push și ca pe Linux: un memento răsuflat e zgomot. */
const val MISSED_WINDOW_MS = 3_600_000L
/** Fereastra în trecut a citirii native. NU e regula de sunet: e cea de retragere (ca REMINDER_LOOKBACK_MS). */
const val LOOKBACK_MS = 24 * 3_600_000L
const val HORIZON_MS = 7 * 24 * 3_600_000L
const val FIRED_KEEP_MS = 8 * 24 * 3_600_000L

/**
 * Planul curent, din două surse. Câștigă lista citită mai recent; excepția sunt
 * `heldIds` (scrieri încă în coada offline a paginii), pentru care ultima listă
 * a paginii câștigă — serverul încă n-a aflat de ele. Peste rezultat se aplică
 * acțiunile native încă neconfirmate de o listă mai nouă.
 */
fun mergePlan(page: PageList?, native: NativeList?, actions: List<NativeAction>): List<Reminder> {
    val base = when {
        page == null -> native?.reminders.orEmpty()
        native == null || page.readAt >= native.readAt -> page.reminders
        else -> native.reminders.filter { it.id !in page.heldIds } + page.reminders.filter { it.id in page.heldIds }
    }
    val latest = maxOf(page?.readAt ?: 0L, native?.readAt ?: 0L)
    val byId = LinkedHashMap<String, Reminder>()
    for (r in base) byId.putIfAbsent(r.id, r)
    for (a in actions) {
        if (a.drainedAt != null && a.drainedAt < latest) continue
        when (a.kind) {
            NativeAction.Kind.DONE -> byId.remove(a.id)
            NativeAction.Kind.UNTIL -> {
                val at = a.remindAt ?: continue
                val prev = byId[a.id]
                byId[a.id] = Reminder(reminderKey(a.id, at), a.id, at, a.title, a.body, a.dueAt ?: prev?.dueAt ?: a.prevDueAt, a.allDay)
            }
        }
    }
    return byId.values.sortedBy { it.at }
}

data class AlarmPlan(val fireNow: List<Reminder>, val nextAt: Long?, val cancelIds: Set<String>)

/**
 * Ce sună acum, când e următoarea alarmă și ce notificare afișată se retrage.
 * O singură alarmă armată la un moment dat (cea mai apropiată): când sună,
 * se recheamă asta. Tot ce cade în minutul curent sună împreună — Doze lasă
 * ~o alarmă `AllowWhileIdle` la 9 minute, deci două alarme în același minut
 * ar întârzia-o pe a doua. `shown`: id → cheia notificării de pe ecran.
 */
fun planAlarms(plan: List<Reminder>, now: Long, fired: Set<String>, shown: Map<String, String>): AlarmPlan {
    val minuteEnd = (now / 60_000L + 1) * 60_000L
    val keys = plan.map { it.key }.toSet()
    val fire = ArrayList<Reminder>()
    var next: Long? = null
    for (r in plan) {
        if (r.key in fired) continue
        if (r.at < minuteEnd) { if (now - r.at <= MISSED_WINDOW_MS) fire += r; continue }
        if (next == null || r.at < next) next = r.at
    }
    return AlarmPlan(fire, next, shown.filterValues { it !in keys }.keys)
}

/** Cheile sunate mai vechi de 8 zile nu mai pot reapărea (orizontul e 7 zile în față, 24 h în urmă). */
fun pruneFired(fired: Set<String>, now: Long): Set<String> =
    fired.filterTo(HashSet()) { k -> parseIso(k.substringAfter('@', ""))?.let { now - it <= FIRED_KEEP_MS } ?: false }
