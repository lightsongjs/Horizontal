package ro.horizontal.app.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneId

/**
 * Sarcinile create din fereastra de quick add a telefonului, până ajung pe
 * server. Coadă SEPARATĂ de acțiunile din notificare: pagina preia acțiunile
 * (`take`) fără să știe ce sunt, iar o creare preluată de o pagină veche s-ar
 * fi pierdut.
 *
 * Regula care exclude dublurile: ID-ul (`attemptId`) se alege și se scrie pe
 * disc ÎNAINTE de POST. O retrimitere după o eroare de rețea sau după moartea
 * procesului folosește același ID, deci serverul răspunde 409, iar `conflictOf`
 * recunoaște rândul ca fiind al nostru.
 */
data class NativeFile(
    val path: String, val filename: String, val contentType: String, val size: Long,
    /** ID-ul fix al rândului din `attachments` și al obiectului: o retrimitere nu dublează. */
    val attachmentId: String, val uploaded: Boolean = false,
)

data class NativeCreate(
    val uid: String, val tempId: String, val projectId: String, val projectName: String?,
    val title: String, val desc: String, val dueAt: String?, val allDay: Boolean, val remindAt: String?,
    val rrule: String?, val urgent: Boolean, val assigneeId: String?, val createdAt: Long,
    val attemptId: String? = null, val realId: String? = null, val drainedAt: Long? = null,
    val inFlight: Boolean = false, val tries: Int = 0, val files: List<NativeFile> = emptyList(),
) {
    val id get() = realId ?: tempId
}

/** `nextIssueId` din `src/lib/issueId.ts`; fixtures comune în `issueId.fixtures.json`. */
fun nextIssueId(existing: List<String>, prefix: String): String {
    val max = existing.mapNotNull { it.drop(prefix.length + 1).trim().ifEmpty { "0" }.toDoubleOrNull() }
        .filter { it.isFinite() }.fold(0.0) { a, b -> maxOf(a, b) }.toLong()
    return "$prefix-${(max + 1).toString().padStart(2, '0')}"
}

/** Aceleași coloane ca `createIssueOnce` din pagină. Fără `created_by`: îl pune `default auth.uid()`. */
fun insertBody(c: NativeCreate, id: String, wave: Int): JSONObject = JSONObject()
    .put("id", id).put("project_id", c.projectId).put("title", c.title).put("details", c.desc)
    .put("theme", JSONObject.NULL).put("wave", wave).put("done", false)
    .put("selectors", JSONArray()).put("scenarios", JSONArray())
    .put("assignee_id", c.assigneeId ?: JSONObject.NULL).put("urgent", c.urgent)
    .put("due_at", c.dueAt ?: JSONObject.NULL).put("all_day", c.allDay)
    .put("remind_at", c.remindAt ?: JSONObject.NULL).put("rrule", c.rrule ?: JSONObject.NULL)

enum class Conflict { OURS, TAKEN }

/** După un 409: rândul cu ID-ul nostru e chiar al nostru (o retrimitere) sau l-a luat altcineva. */
fun conflictOf(row: JSONObject?, owner: String, c: NativeCreate): Conflict {
    if (row == null) return Conflict.TAKEN
    fun s(k: String) = if (!row.has(k) || row.isNull(k)) null else row.getString(k)
    return if (s("created_by") == owner && s("title") == c.title && s("project_id") == c.projectId) Conflict.OURS else Conflict.TAKEN
}

fun remapActions(q: List<NativeAction>, from: String, to: String) = q.map { if (it.id == from) it.copy(id = to) else it }
fun remapFired(fired: Set<String>, from: String, to: String) = fired.map { if (it.startsWith("$from@")) to + it.removePrefix(from) else it }.toSet()
fun remapShown(shown: Map<String, String>, from: String, to: String) =
    shown.entries.associate { (id, key) -> (if (id == from) to else id) to (if (key.startsWith("$from@")) to + key.removePrefix(from) else key) }

/**
 * Creările încă nevăzute de agendă: netrimise, sau trimise după citirea agendei
 * de acum. Așa sarcina apare în widget din clipa în care apeși Trimite.
 */
fun createsAsAgenda(creates: List<NativeCreate>, agendaReadAt: Long): List<AgendaItem> =
    creates.filter { it.dueAt != null && (it.drainedAt == null || it.drainedAt >= agendaReadAt) }.map {
        AgendaItem(it.id, it.title, it.projectName, isoJs(parseIso(it.dueAt)!!), it.allDay, it.remindAt != null, it.rrule != null, it.urgent)
    }

/** Ies doar creările trimise, cu fișierele urcate, pe care le-a văzut deja o agendă. */
fun pruneCreates(creates: List<NativeCreate>, agendaReadAt: Long) =
    creates.filterNot { it.drainedAt != null && it.drainedAt < agendaReadAt && it.files.all { f -> f.uploaded } }

/** Mementoul unei sarcini capturate offline sună și înainte să ajungă pe server. */
fun createReminders(creates: List<NativeCreate>, zone: ZoneId, latestReadAt: Long = Long.MAX_VALUE): List<Reminder> =
    // Trimise, dar încă necitite de o listă: altfel mementoul ar lipsi din plan până la sincronizare.
    creates.filter { it.drainedAt == null || it.drainedAt >= latestReadAt }.mapNotNull { c ->
    val at = parseIso(c.remindAt) ?: return@mapNotNull null
    val t = planNotification(c.id, c.title, c.dueAt, c.allDay, c.projectName, zone)
    Reminder(reminderKey(c.id, at), c.id, at, t.title, t.body, c.dueAt, c.allDay)
}
