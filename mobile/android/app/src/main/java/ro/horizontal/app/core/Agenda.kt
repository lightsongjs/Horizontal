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

/** `compareDue`: ziua, apoi fără oră înaintea celor cu oră, ora, urgentul, id. */
private fun order(zone: ZoneId) = compareBy<Pair<AgendaItem, Long>>(
    { localDate(it.second, zone) }, { !it.first.allDay }, { it.second }, { !it.first.urgent }, { it.first.id },
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
    return agendaWithEdits(src.items + creates.filter { it.id !in known }, edits, src.readAt).filter { it.id !in done }
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
private val RO = Locale.forLanguageTag("ro")
private fun short(d: LocalDate) = "${ZILE[d.dayOfWeek.value - 1]} ${d.dayOfMonth} ${LUNI[d.monthValue - 1]}"

fun sectionLabel(s: AgendaSection): String {
    if (s.overdue) return "RESTANȚE"
    val d = s.date!!
    val text = when (s.offset) {
        0 -> "azi · ${short(d)}"
        1 -> "mâine · ${short(d)}"
        else -> "${ZILE_LUNGI[d.dayOfWeek.value - 1]} ${d.dayOfMonth} ${LUNI[d.monthValue - 1]}"
    }
    return text.uppercase(RO)
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
fun agendaQuery(now: Long, zone: ZoneId): String {
    val e = { s: String -> URLEncoder.encode(s, "UTF-8") }
    val end = localDate(now, zone).plusDays(AGENDA_DAYS.toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
    return "issues?select=id,title,due_at,all_day,remind_at,rrule,urgent,projects(name,reminders_only)" +
        "&done=is.false&due_at=lt.${e(isoJs(end))}&order=due_at.asc&limit=$AGENDA_LIMIT"
}

/** Un rând stricat e sărit, nu aruncă (ca `parseIssues`). `isNull` înainte de `optString`: vezi acolo. */
fun parseAgenda(json: String): List<AgendaItem> {
    val a = JSONArray(json)
    fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k)
    return (0 until a.length()).mapNotNull { i ->
        val o = a.optJSONObject(i) ?: return@mapNotNull null
        val id = o.str("id")?.ifEmpty { null } ?: return@mapNotNull null
        val due = parseIso(o.str("due_at")) ?: return@mapNotNull null
        val routine = o.optJSONObject("projects")?.optBoolean("reminders_only", false) == true
        AgendaItem(
            id, o.str("title")?.ifBlank { null } ?: "Sarcină fără titlu", o.optJSONObject("projects")?.str("name"),
            isoJs(due), if (o.isNull("all_day")) false else o.optBoolean("all_day", false),
            o.str("remind_at") != null, o.str("rrule") != null, if (o.isNull("urgent")) false else o.optBoolean("urgent", false),
            if (routine) parseIso(o.str("remind_at")) ?: due else null,
        )
    }
}
