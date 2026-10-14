package ro.horizontal.app.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Widget-ul de agendă: restanțele și zilele 0..6. Regula e `buildSmartLists`
 * din `src/lib/schedule.ts`, scrisă a doua oară; fixtures comune în
 * `src/lib/agenda.fixtures.json`. Un caz nou se adaugă acolo.
 */
data class AgendaItem(
    val id: String, val title: String, val project: String?, val dueAt: String, val allDay: Boolean,
    val hasReminder: Boolean, val recurring: Boolean, val urgent: Boolean,
    /** Rutină (proiect „doar mementouri"): ascunsă până atunci = `remind_at ?: due_at`. `src/lib/routines.ts`. */
    val hiddenUntil: Long? = null,
    /** Culoarea proiectului (`projects.accent`, hex al omului) — inelul bifei. `null`: inel gri (o pagină veche n-o trimite). */
    val projectAccent: String? = null,
)
/** `readAt` = PORNIREA citirii (ca `NativeList`); al paginii, 0 offline. */
data class AgendaList(val items: List<AgendaItem>, val readAt: Long)
data class AgendaSection(val overdue: Boolean, val offset: Int, val date: LocalDate?, val items: List<AgendaItem>)

sealed interface AgendaState {
    /** Nicio listă încă (instalare proaspătă, nelogat): „gol" ar minți. */
    object NoData : AgendaState
    data class Ready(val sections: List<AgendaSection>, val count: Int) : AgendaState
}

const val AGENDA_DAYS = 7
const val AGENDA_LIMIT = 200

private fun localDate(ms: Long, zone: ZoneId): LocalDate = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()
private fun offset(ms: Long, now: Long, zone: ZoneId) = ChronoUnit.DAYS.between(localDate(now, zone), localDate(ms, zone)).toInt()

private fun overdue(it: AgendaItem, due: Long, now: Long, zone: ZoneId) =
    if (it.allDay) offset(due, now, zone) < 0 else due < now

/** `compareDue`: urgentul, ziua, cu oră înaintea celor fără oră, ora, id. */
private fun order(zone: ZoneId) = compareBy<Pair<AgendaItem, Long>>(
    { !it.first.urgent }, { localDate(it.second, zone) }, { it.first.allDay }, { it.second }, { it.first.id },
)

fun buildAgenda(items: List<AgendaItem>, now: Long, zone: ZoneId): List<AgendaSection> {
    val timed = items.filter { (it.hiddenUntil ?: 0) <= now }.mapNotNull { i -> parseIso(i.dueAt)?.let { i to it } }.sortedWith(order(zone))
    val late = timed.filter { (i, at) -> overdue(i, at, now, zone) }
    val out = mutableListOf<AgendaSection>()
    if (late.isNotEmpty()) out += AgendaSection(true, 0, null, late.map { it.first })
    val today = localDate(now, zone)
    for (d in 0 until AGENDA_DAYS) {
        val rows = timed.filter { (i, at) -> !overdue(i, at, now, zone) && offset(at, now, zone) == d }
        if (rows.isNotEmpty()) out += AgendaSection(false, d, today.plusDays(d.toLong()), rows.map { it.first })
    }
    return out
}

/**
 * Lista citită mai recent (la egalitate, a paginii); fără niciuna, `null`.
 * Un id cu „Gata" în coadă nu se arată, trimis sau nu: rămâne ascuns până
 * o listă citită după trimitere prunează coada (`NativeQueue.prune`) — o
 * recurentă reapare atunci la data nouă.
 */
fun visibleAgenda(page: AgendaList?, native: AgendaList?, queue: List<NativeAction>, held: Map<String, Long> = emptyMap(),
                  creates: List<AgendaItem> = emptyList(), edits: List<NativeEdit> = emptyList()): List<AgendaItem>? {
    val src = listOfNotNull(page, native).maxByOrNull { it.readAt } ?: return null
    val done = queue.filter { it.kind == NativeAction.Kind.DONE }.map { it.id }.toSet() +
        held.filterValues { it >= src.readAt }.keys
    val known = src.items.map { it.id }.toSet()
    // O creare nu știe culoarea proiectului; o ia de la un rând al aceluiași proiect, dacă există.
    val accents = src.items.filter { it.project != null && it.projectAccent != null }.associate { it.project to it.projectAccent }
    val fresh = creates.filter { it.id !in known }.map { c -> if (c.projectAccent == null) c.copy(projectAccent = accents[c.project]) else c }
    return agendaWithEdits(src.items + fresh, edits, src.readAt).filter { it.id !in done }
}

/**
 * Coada se prunează după listele de MEMENTOURI; agenda e o a doua citire, care
 * poate pica singură. Un „Gata" scos din coadă rămâne reținut (id → trimis la)
 * până sosește o agendă citită după trimitere — altfel rândul bifat reapărea la
 * data veche. `before`/`after` = coada înainte și după prunare.
 */
fun holdDone(before: List<NativeAction>, after: List<NativeAction>, held: Map<String, Long>, agendaReadAt: Long): Map<String, Long> {
    val removed = before.filter { a -> a.kind == NativeAction.Kind.DONE && after.none { it.uid == a.uid } }
        .associate { it.id to (it.drainedAt ?: it.createdAt) }
    return (held + removed).filterValues { it >= agendaReadAt }
}

fun agendaState(page: AgendaList?, native: AgendaList?, queue: List<NativeAction>, now: Long, zone: ZoneId, held: Map<String, Long> = emptyMap(),
                creates: List<AgendaItem> = emptyList(), edits: List<NativeEdit> = emptyList()): AgendaState {
    val items = visibleAgenda(page, native, queue, held, creates, edits) ?: return AgendaState.NoData
    val sections = buildAgenda(items, now, zone)
    return AgendaState.Ready(sections, sections.sumOf { it.items.size })
}

/** Când iese din ascunzătoare cea mai apropiată rutină — widget-ul se redesenează atunci. */
fun nextReveal(items: List<AgendaItem>, now: Long): Long? = items.mapNotNull { it.hiddenUntil }.filter { it > now }.minOrNull()

private val ZILE = listOf("lun", "mar", "mie", "joi", "vin", "sâm", "dum")
private val ZILE_LUNGI = listOf("luni", "marți", "miercuri", "joi", "vineri", "sâmbătă", "duminică")
private val LUNI = listOf("ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec")
private val LUNI_LUNGI = listOf("ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august",
    "septembrie", "octombrie", "noiembrie", "decembrie")
private fun short(d: LocalDate) = "${ZILE[d.dayOfWeek.value - 1]} ${d.dayOfMonth} ${LUNI[d.monthValue - 1]}"

/**
 * Capul unui grup („Senin"): eticheta în litere obișnuite, plus data — sau, unde
 * data n-ar spune nimic (Restanțe, Azi), numărul. `date == null` ⇒ se arată numărul.
 */
data class SectionHead(val label: String, val date: String?)

fun sectionHead(s: AgendaSection): SectionHead {
    if (s.overdue) return SectionHead("Restanțe", null)
    val d = s.date!!
    return when (s.offset) {
        0 -> SectionHead("Azi", null)
        1 -> SectionHead("Mâine", short(d))
        else -> SectionHead(ZILE_LUNGI[d.dayOfWeek.value - 1].replaceFirstChar { it.titlecase(Locale.ROOT) }, "${d.dayOfMonth} ${LUNI[d.monthValue - 1]}")
    }
}

/** „Azi" n-are cap când e primul grup: antetul widget-ului îl spune deja. */
fun showsHead(index: Int, s: AgendaSection) = !(index == 0 && !s.overdue && s.offset == 0)

/** Numărul din antet: ce e de făcut azi, restanțele incluse. */
fun todayCount(sections: List<AgendaSection>) = sections.filter { it.overdue || it.offset == 0 }.sumOf { it.items.size }

/** Rândul „Nimic pe azi": nimic restant, nimic azi, dar urmează ceva (altfel e starea goală a widget-ului). */
fun freeToday(sections: List<AgendaSection>) = sections.isNotEmpty() && sections.none { it.overdue || it.offset == 0 }

/** Linia de sub „Azi": „miercuri, 14 octombrie". */
fun todayLine(now: Long, zone: ZoneId): String {
    val d = localDate(now, zone)
    return "${ZILE_LUNGI[d.dayOfWeek.value - 1]}, ${d.dayOfMonth} ${LUNI_LUNGI[d.monthValue - 1]}"
}

/** `#RGB` / `#RRGGBB` / `#AARRGGBB` → ARGB; orice altceva `null` (inel gri). Accentul e scris de om, deci nu se presupune valid. */
fun accentArgb(hex: String?): Int? {
    val h = hex?.trim()?.removePrefix("#") ?: return null
    if (!h.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
    return when (h.length) {
        3 -> (0xFF000000.toInt()) or h.map { "$it$it" }.joinToString("").toInt(16)
        6 -> (0xFF000000.toInt()) or h.toInt(16)
        8 -> h.toLong(16).toInt()
        else -> null
    }
}

private val HM = DateTimeFormatter.ofPattern("HH:mm")

/** Dreapta rândului. Restanțe: cât de veche e; altfel ora, DOAR dacă are una (`DueChip`). */
fun rowMeta(item: AgendaItem, overdue: Boolean, now: Long, zone: ZoneId): String {
    val at = parseIso(item.dueAt) ?: return ""
    val time = if (item.allDay) "" else ZonedDateTime.ofInstant(Instant.ofEpochMilli(at), zone).format(HM)
    if (!overdue) return time
    val off = offset(at, now, zone)
    val d = localDate(at, zone)
    return when {
        off == 0 -> time
        off == -1 -> "ieri"
        off > -7 -> "${ZILE[d.dayOfWeek.value - 1]} ${d.dayOfMonth}"
        else -> "${d.dayOfMonth} ${LUNI[d.monthValue - 1]}"
    }
}

/**
 * Fără limită inferioară: o restanță de luna trecută e tot restanță. Ordonat
 * crescător, deci plafonul taie din viitor, nu din restanțe.
 */
fun agendaQuery(now: Long, zone: ZoneId, me: Me = Me.UNKNOWN): String {
    val e = { s: String -> URLEncoder.encode(s, "UTF-8") }
    val end = localDate(now, zone).plusDays(AGENDA_DAYS.toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
    return "issues?select=id,title,due_at,all_day,remind_at,rrule,urgent,assignee_id,created_by,projects(name,accent,reminders_only)" +
        "&done=is.false&due_at=lt.${e(isoJs(end))}" + mineFilter(me) + "&order=due_at.asc&limit=$AGENDA_LIMIT"
}

/** Un rând stricat e sărit, nu aruncă (ca `parseIssues`), la fel ce nu e al meu. `isNull` înainte de `optString`: vezi acolo. */
fun parseAgenda(json: String, me: Me = Me.UNKNOWN): List<AgendaItem> {
    val a = JSONArray(json)
    fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k)
    return (0 until a.length()).mapNotNull { i ->
        val o = a.optJSONObject(i) ?: return@mapNotNull null
        val id = o.str("id")?.ifEmpty { null } ?: return@mapNotNull null
        if (!isMine(o.str("assignee_id"), o.str("created_by"), me)) return@mapNotNull null
        val due = parseIso(o.str("due_at")) ?: return@mapNotNull null
        val routine = o.optJSONObject("projects")?.optBoolean("reminders_only", false) == true
        AgendaItem(
            id, o.str("title")?.ifBlank { null } ?: "Sarcină fără titlu", o.optJSONObject("projects")?.str("name"),
            isoJs(due), if (o.isNull("all_day")) false else o.optBoolean("all_day", false),
            o.str("remind_at") != null, o.str("rrule") != null, if (o.isNull("urgent")) false else o.optBoolean("urgent", false),
            if (routine) parseIso(o.str("remind_at")) ?: due else null,
            o.optJSONObject("projects")?.str("accent")?.ifBlank { null },
        )
    }
}
