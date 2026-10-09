package ro.horizontal.app.core

import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Fereastra de quick add de pe telefon. Regulile de captură NU sunt aici: le
 * aplică `computeDraft` din pagină, rulat în motorul JS (`CaptureEngine`). Aici
 * stau doar forma datelor, intrarea și ieșirea motorului, și modul BRUT — ce
 * face fereastra când motorul lipsește: titlul e textul, jetoanele merg.
 */
data class CaptureProject(val id: String, val name: String, val prefix: String, val type: String?)
data class CapturePerson(val id: String, val name: String)
/** Proiectele în care se poate scrie și oamenii, împinse de pagină (`setCaptureData`). */
data class CaptureData(val projects: List<CaptureProject>, val people: List<CapturePerson>, val readAt: Long)

/** Ce a atins omul. `*Set` = jetonul a fost folosit (un `null` ales e diferit de „neatins"). */
data class Manual(
    val projectId: String? = null,
    val assigneeSet: Boolean = false, val assigneeId: String? = null,
    val urgent: Boolean? = null,
    val dueSet: Boolean = false, val dueAt: String? = null, val allDay: Boolean = true,
)

/** `CaptureResult` din `src/lib/quickDraft.ts`, plus `raw` (modul fără motor). */
data class Draft(
    val title: String, val spans: List<IntRange>, val live: List<String>,
    val projectId: String?, val assigneeId: String?, val urgent: Boolean, val unknown: List<String>,
    val dueAt: String?, val allDay: Boolean, val rrule: String?, val remindAt: String?,
    val error: String?, val raw: Boolean,
    /** Jetonul de dată („Azi", „Mâine 10:00"); `null` = fără dată. Din motor, `dueLabelParts`. */
    val label: String? = null,
)

private fun normalizeName(s: String) =
    Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}"), "").lowercase().replace(Regex("[^a-z0-9]"), "")

/**
 * `inboxProjectId` din `captureTokens.ts`: unde cade o captură fără proiect ales.
 * Întâi după id — numele e al omului și s-a schimbat („✅Daily" → „Inbox") —,
 * apoi după nume, pentru baze fără rândul `d`.
 */
const val INBOX_PROJECT_ID = "d"
private val INBOX_ALIASES = setOf("inbox", "daily")

fun isInboxProject(p: CaptureProject): Boolean = p.id == INBOX_PROJECT_ID || normalizeName(p.name) in INBOX_ALIASES

fun inboxProjectId(projects: List<CaptureProject>): String? =
    (projects.firstOrNull { it.id == INBOX_PROJECT_ID } ?: projects.firstOrNull(::isInboxProject))?.id

private fun startOfDayIso(nowMs: Long, zone: ZoneId) =
    isoJs(Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli())

/** `reminderAt(dueAt, defaultReminder(allDay))`: cu oră sună la scadență, toată ziua nu sună. */
fun defaultRemindAt(dueAt: String?, allDay: Boolean): String? = if (dueAt == null || allDay) null else isoJs(parseIso(dueAt)!!)

/** Data aleasă din calendar (și, opțional, ora). Fără zi = „Fără dată". */
fun manualDue(date: LocalDate?, time: LocalTime?, zone: ZoneId): Pair<String?, Boolean> {
    if (date == null) return null to true
    val at = if (time == null) date.atStartOfDay(zone) else date.atTime(time).atZone(zone)
    return isoJs(at.toInstant().toEpochMilli()) to (time == null)
}

private val DAYS = listOf("Lun", "Mar", "Mie", "Joi", "Vin", "Sâm", "Dum")

/** `dueLabelParts` din `quickDraft.ts`, pentru modul brut (fără motor). */
fun rawLabel(dueAt: String?, allDay: Boolean, nowMs: Long, zone: ZoneId): String? {
    val at = parseIso(dueAt) ?: return null
    val d = Instant.ofEpochMilli(at).atZone(zone)
    val off = java.time.temporal.ChronoUnit.DAYS.between(Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate(), d.toLocalDate())
    val day = when (off) { 0L -> "Azi"; 1L -> "Mâine"; -1L -> "Ieri"
        else -> "${DAYS[d.dayOfWeek.value - 1]} ${"%02d/%02d".format(d.dayOfMonth, d.monthValue)}" }
    return if (allDay) day else "$day ${"%02d:%02d".format(d.hour, d.minute)}"
}

/** Fără motor: nimic nu se citește din text. Proiectul, data, omul și urgența vin doar din jetoane. */
fun rawDraft(text: String, manual: Manual, data: CaptureData, nowMs: Long, zone: ZoneId): Draft {
    val project = data.projects.firstOrNull { it.id == (manual.projectId ?: inboxProjectId(data.projects)) }
        ?: data.projects.firstOrNull { it.type == "personal" } ?: data.projects.firstOrNull()
    val dueAt = if (manual.dueSet) manual.dueAt else startOfDayIso(nowMs, zone)
    val allDay = if (manual.dueSet) manual.allDay else true
    return Draft(
        text.trim(), emptyList(), emptyList(), project?.id, if (manual.assigneeSet) manual.assigneeId else null,
        manual.urgent ?: false, emptyList(), dueAt, allDay, null, defaultRemindAt(dueAt, allDay),
        if (text.isBlank()) "empty" else null, raw = true, label = rawLabel(dueAt, allDay, nowMs, zone),
    )
}

/** `CaptureInput` din `quickDraft.ts`. */
fun engineInput(text: String, desc: String, rejected: List<String>, manual: Manual, data: CaptureData, defaultProjectId: String?, nowMs: Long): JSONObject {
    val m = JSONObject()
    manual.projectId?.let { m.put("projectId", it) }
    if (manual.assigneeSet) m.put("assigneeId", manual.assigneeId ?: JSONObject.NULL)
    manual.urgent?.let { m.put("urgent", it) }
    if (manual.dueSet) m.put("due", JSONObject().put("dueAt", manual.dueAt ?: JSONObject.NULL).put("allDay", manual.allDay))
    return JSONObject()
        .put("text", text).put("desc", desc).put("rejected", JSONArray(rejected)).put("manual", m)
        .put("projects", JSONArray().also { a -> data.projects.forEach { p ->
            a.put(JSONObject().put("id", p.id).put("name", p.name).put("prefix", p.prefix).put("type", p.type ?: JSONObject.NULL)) } })
        .put("assignees", JSONArray().also { a -> data.people.forEach { a.put(JSONObject().put("id", it.id).put("name", it.name)) } })
        .put("defaultProjectId", defaultProjectId ?: JSONObject.NULL)
        .put("nowMs", nowMs).put("tokens", true)
}

fun parseEngineResult(json: String): Draft {
    val o = JSONObject(json)
    fun str(k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    fun strings(k: String) = o.optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
    val spans = o.optJSONArray("spans")?.let { a -> (0 until a.length()).map { val p = a.getJSONArray(it); p.getInt(0) until p.getInt(1) } }.orEmpty()
    return Draft(
        o.getString("title"), spans, strings("live"), str("projectId"), str("assigneeId"), o.optBoolean("urgent"),
        strings("unknown"), str("dueAt"), o.optBoolean("allDay", true), str("rrule"), str("remindAt"), str("error"), raw = false,
        label = o.optJSONObject("label")?.let { l -> l.getString("day") + (if (l.isNull("time")) "" else " " + l.getString("time")) },
    )
}

object CaptureJson {
    fun toJson(d: CaptureData) = JSONObject().put("readAt", d.readAt)
        .put("projects", JSONArray().also { a -> d.projects.forEach { p ->
            a.put(JSONObject().put("id", p.id).put("name", p.name).put("prefix", p.prefix).put("type", p.type ?: JSONObject.NULL)) } })
        .put("assignees", JSONArray().also { a -> d.people.forEach { a.put(JSONObject().put("id", it.id).put("name", it.name)) } })

    /** Și forma de pe punte (`setCaptureData`). Un rând stricat e sărit. */
    fun fromJson(o: JSONObject): CaptureData? = try {
        fun JSONObject.s(k: String): String? = if (!has(k) || isNull(k)) null else getString(k)
        val ps = o.getJSONArray("projects"); val people = o.optJSONArray("assignees") ?: JSONArray()
        CaptureData(
            (0 until ps.length()).mapNotNull { val p = ps.getJSONObject(it)
                CaptureProject(p.s("id") ?: return@mapNotNull null, p.s("name") ?: "", p.s("prefix") ?: return@mapNotNull null, p.s("type")) },
            (0 until people.length()).mapNotNull { val p = people.getJSONObject(it)
                CapturePerson(p.s("id") ?: return@mapNotNull null, p.s("name") ?: "") },
            o.optLong("readAt", 0L),
        )
    } catch (e: Exception) { null }
}

/** O alegere din lista de la `#` / `@` (`tokenSuggest.ts`, prin motor): textul și cursorul de după ea. */
data class CaptureSuggestion(val sigil: String, val label: String, val text: String, val caret: Int)

fun parseSuggestions(json: String): List<CaptureSuggestion> {
    val o = JSONObject(json)
    val sigil = o.optJSONObject("token")?.optString("sigil") ?: return emptyList()
    val a = o.optJSONArray("items") ?: return emptyList()
    return (0 until a.length()).map { a.getJSONObject(it) }.map { i ->
        val ap = i.getJSONObject("apply")
        CaptureSuggestion(sigil, i.getString("label"), ap.getString("text"), ap.getInt("caret"))
    }
}
