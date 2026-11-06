package ro.horizontal.app.core

/**
 * Un memento din plan. `key` = `id@ISO`: unul amânat e ALT memento, nu același mutat.
 *
 * `every` = pasul unei serii de mementouri, în minute (`ping_every`): rândul e
 * atunci UNUL pe tichet, cu `at` = primul ping (ancora grilei) și `dueAt` =
 * capătul ferestrei; `planAlarms` îl desfășoară în pinguri (`core/Pings.kt`).
 * Un ping sunat poartă cheia și ora LUI, iar `anchor` = `at`-ul seriei — cu el
 * compară `DeferGate` `remind_at` de pe server, care nu se mișcă la fiecare ping.
 */
data class Reminder(
    val key: String, val id: String, val at: Long, val title: String, val body: String,
    val dueAt: String?, val allDay: Boolean,
    val every: Int? = null, val anchor: Long? = null,
    /** `issues.snoozed_from`: mementoul planificat, cât e amânat — baza unei a doua amânări (`snoozeBase`). */
    val snoozedFrom: Long? = null,
)

/** Pingurile seriei la momentul dat, sau `null` dacă rândul nu e o serie (sau n-are capăt). */
fun seriesPings(r: Reminder, at: Long): Pings? {
    val every = r.every ?: return null
    val end = parseIso(r.dueAt) ?: return null
    return pings(r.at, every, end, at)
}

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
    /** Doar la UNTIL: baza amânării (`snoozeBase`), scrisă în `snoozed_from`. `null` = nimic de ținut minte. */
    val snoozedFrom: Long? = null,
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
                byId[a.id] = Reminder(reminderKey(a.id, at), a.id, at, a.title, a.body, a.dueAt ?: prev?.dueAt ?: a.prevDueAt, a.allDay,
                    snoozedFrom = a.snoozedFrom ?: prev?.snoozedFrom)
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
    val keys = HashSet<String>()
    val fire = ArrayList<Reminder>()
    var next: Long? = null
    fun consider(r: Reminder, freshMs: Long) {
        if (r.key in fired) return
        if (r.at < minuteEnd) { if (now - r.at <= freshMs) fire += r; return }
        if (next == null || r.at < next!!) next = r.at
    }
    for (r in plan) {
        keys += r.key
        // O serie: pingul curent (ultimul dinaintea sfârșitului minutului) sună
        // ca orice memento, dar numai cât e proaspăt — min(pas, 10 min); cel
        // următor e alarma. Cheia pingului curent intră în plan, deci notificarea
        // lui nu se retrage cât seria e în plan (după capăt rămâne ultimul ping,
        // ca un memento obișnuit nebifat).
        val p = seriesPings(r, minuteEnd - 1)
        if (p == null) { consider(r, MISSED_WINDOW_MS); continue }
        p.current?.let { cur ->
            val ping = r.copy(key = reminderKey(r.id, cur), at = cur, anchor = r.at)
            keys += ping.key
            consider(ping, pingFreshMs(r.every!!))
        }
        p.next?.let { n -> if (next == null || n < next!!) next = n }
    }
    return AlarmPlan(fire, next, shown.filterValues { it !in keys }.keys)
}

/**
 * Pingurile deja depășite ale unei serii nu mai pot suna (sună doar cel curent),
 * deci cheile lor ies acum, nu peste 8 zile: o serie la un minut ar fi lăsat
 * altfel peste o mie de chei pe zi în `fired`.
 */
fun pruneSeriesFired(fired: Set<String>, plan: List<Reminder>, now: Long): Set<String> {
    val current = plan.mapNotNull { r -> seriesPings(r, now)?.current?.let { r.id to it } }.toMap()
    if (current.isEmpty()) return fired
    return fired.filterTo(HashSet()) { k ->
        val cur = current[k.substringBefore('@')] ?: return@filterTo true
        val t = parseIso(k.substringAfter('@', "")) ?: return@filterTo true
        t >= cur
    }
}

/** Cheile sunate mai vechi de 8 zile nu mai pot reapărea (orizontul e 7 zile în față, 24 h în urmă). */
fun pruneFired(fired: Set<String>, now: Long): Set<String> =
    fired.filterTo(HashSet()) { k -> parseIso(k.substringAfter('@', ""))?.let { now - it <= FIRED_KEEP_MS } ?: false }
