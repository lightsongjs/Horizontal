package ro.horizontal.app.core

import java.net.URLEncoder

/**
 * Editările de titlu și descriere din foaia nativă a tichetului (`TicketActivity`).
 * Coadă proprie, ca `creates`: pagina preia acțiunile (`take`) fără să le știe
 * felul, iar o pagină veche ar fi aruncat o editare. Câmpurile sunt coloanele
 * PostgREST (`title`, `details`); se trimit DOAR cele schimbate față de ultima
 * valoare știută de pe server — o editare de pe alt dispozitiv la alt câmp
 * rămâne neatinsă (regula din `src/lib/autosave.ts`).
 */
data class NativeEdit(
    val uid: String, val id: String, val fields: Map<String, String>, val createdAt: Long,
    val inFlight: Boolean = false, val drainedAt: Long? = null,
)

/** Ce s-a schimbat față de `base`. Titlul se taie la capete și nu pleacă gol (ca `EditSheet`). */
fun patchOf(draft: Map<String, String>, base: Map<String, String>): Map<String, String> = buildMap {
    for ((k, v0) in draft) {
        val v = if (k == "title") v0.trim().ifEmpty { null } ?: continue else v0
        if (v != (if (k == "title") base[k]?.trim() else base[k])) put(k, v)
    }
}

/**
 * O editare nouă. Pe o creare încă fără ID ales: se schimbă direct crearea. Cu ID
 * ales, titlul crearii e garda lui `conflictOf` — schimbat, un 409 al nostru ar
 * părea al altcuiva și ar ieși o dublură — deci editarea stă la coadă, pe ID-ul
 * provizoriu, și pleacă după remapare. Altfel se contopește cu ultima editare
 * netrimisă a aceluiași tichet (ultima valoare câștigă).
 */
fun applyEdit(creates: List<NativeCreate>, edits: List<NativeEdit>, e: NativeEdit): Pair<List<NativeCreate>, List<NativeEdit>> {
    val c = creates.firstOrNull { it.realId == null && it.tempId == e.id }
    if (c != null && c.attemptId == null && !c.inFlight) {
        return creates.map { if (it.uid == c.uid) it.copy(title = e.fields["title"] ?: it.title, desc = e.fields["details"] ?: it.desc) else it } to edits
    }
    val last = edits.lastOrNull { it.id == e.id && !it.inFlight && it.drainedAt == null }
    return creates to if (last != null) edits.map { if (it.uid == last.uid) it.copy(fields = it.fields + e.fields) else it } else edits + e
}

/** Una câte una; ID-urile provizorii așteaptă remaparea crearii lor. */
fun nextEditToDrain(edits: List<NativeEdit>): NativeEdit? =
    if (edits.any { it.inFlight }) null else edits.firstOrNull { it.drainedAt == null && !NativeQueue.isTempId(it.id) }

fun remapEdits(edits: List<NativeEdit>, from: String, to: String) = edits.map { if (it.id == from) it.copy(id = to) else it }

fun buildEditPatch(e: NativeEdit) = PatchRequest("id=eq.${URLEncoder.encode(e.id, "UTF-8")}", e.fields)

/** Widget-ul arată titlul nou până când o agendă citită după trimitere îl are deja. */
fun agendaWithEdits(items: List<AgendaItem>, edits: List<NativeEdit>, readAt: Long): List<AgendaItem> {
    val titles = edits.filter { (it.drainedAt == null || it.drainedAt >= readAt) && it.fields.containsKey("title") }
        .associate { it.id to it.fields.getValue("title") }
    return items.map { i -> titles[i.id]?.let { i.copy(title = it) } ?: i }
}

fun pruneEdits(edits: List<NativeEdit>, agendaReadAt: Long) = edits.filterNot { it.drainedAt != null && it.drainedAt < agendaReadAt }
