package ro.horizontal.app.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/**
 * „Ți-a dat cineva un tichet" (decizia omului, 2026-11-23): în APK nu există web
 * push, deci `SyncWorker` verifică la fiecare rulare ce tichete deschise sunt pe
 * mine — aceeași regulă ca „Ale mele" (`inbox_rows`: `assignee_id` = rândul meu,
 * nebifat) — și le compară cu ce știa data trecută. Ce apare nou e o sosire.
 *
 * De ce mulțimea, nu evenimentele: toate drumurile de scriere se termină în
 * `issues.assignee_id` (pasa din fir, `tk comment --to`, formularul, `PATCH`/`POST
 * /api/tickets`), dar numai pasele lasă un `issue_events.handoff`. Mulțimea le prinde
 * pe toate; evenimentele, sesiunea mea și crearea spun doar CINE și dacă am fost eu.
 * Fără migrare.
 */

/** Ce știe cutia: contul, tichetele care erau pe mine la ultima verificare și când a pornit ea. */
data class HandoffState(val owner: String, val known: Set<String>, val checkedAt: Long)

/**
 * Câte tichete pot fi pe mine într-o citire. Un răspuns plin poate fi tăiat, iar un
 * tichet tăiat azi și prezent mâine ar arăta ca o sosire — atunci nu se anunță nimic.
 */
const val HANDOFF_LIMIT = 1000

/** Cel mult atâtea notificări dintr-o rulare: o mutare în masă nu umple bara. Restul se vede pe bulina roșie. */
const val HANDOFF_MAX_NOTICES = 5

/**
 * Ceasul telefonului față de al serverului: momentele din bază sunt ale serverului,
 * `checkedAt` e al telefonului. Două minute de toleranță, în favoarea anunțului.
 */
const val HANDOFF_SKEW_MS = 2 * 60_000L

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
/** `in.("MS-1","MS-2")` — ghilimele, ca o virgulă sau o paranteză dintr-un id să nu rupă lista. */
private fun inList(ids: Collection<String>) = enc("(" + ids.joinToString(",") { "\"" + it.replace("\"", "") + "\"" } + ")")

/** Tichetele deschise de pe mine — doar id-urile: rularea obișnuită (nimic nou) costă o singură cerere mică. */
fun mineOpenQuery(assigneeId: String): String =
    "issues?select=id&done=is.false&assignee_id=eq.${enc(assigneeId)}&limit=$HANDOFF_LIMIT"

/** Titlul, creatorul și crearea sosirilor. */
fun arrivalsQuery(ids: Collection<String>): String =
    "issues?select=id,title,created_by,created_at&id=in.${inList(ids)}"

/** Pasele către mine pe sosiri, cele mai noi întâi. */
fun handoffEventsQuery(ids: Collection<String>, assigneeId: String): String =
    "issue_events?select=issue_id,author_id,created_at&kind=eq.handoff&handoff_to=eq.${enc(assigneeId)}" +
        "&issue_id=in.${inList(ids)}&order=created_at.desc"

/** Vizita mea pe sosiri (RLS: doar rândurile mele; filtrul pe cont e o plasă). */
fun seenQuery(ids: Collection<String>, userId: String): String =
    "issue_seen?select=issue_id,seen_at&user_id=eq.${enc(userId)}&issue_id=in.${inList(ids)}"

/** Numele celor care au dat tichetele (`author_id`/`created_by` sunt conturi, nu assignees). */
fun actorNamesQuery(userIds: Collection<String>): String =
    "assignees?select=user_id,name&user_id=in.${inList(userIds)}"

private fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k).ifEmpty { null }

/** `null` = răspuns ilizibil sau plin (posibil tăiat): nu se compară nimic. */
fun parseMineOpen(json: String): Set<String>? {
    val a = JSONArray(json)
    if (a.length() >= HANDOFF_LIMIT) return null
    return (0 until a.length()).mapNotNull { a.optJSONObject(it)?.str("id") }.toSet()
}

/**
 * Ce e nou față de data trecută. `null` = prima rulare pentru contul ăsta (instalare,
 * login, alt cont): se învață mulțimea în tăcere, fără un potop de notificări.
 */
fun newlyMine(prev: HandoffState?, owner: String, current: Set<String>): Set<String> =
    if (prev == null || prev.owner != owner) emptySet() else current - prev.known

/** Tot ce trebuie despre o sosire, adunat din cele patru citiri. Momentele în ms. */
data class Arrival(
    val id: String,
    val title: String,
    val createdBy: String?,
    val createdAt: Long?,
    /** Ultima pasă către mine: cine și când. */
    val handoffAuthor: String?,
    val handoffAt: Long?,
    /** `issue_seen.seen_at` al meu. */
    val seenAt: Long?,
)

/** Ce se anunță. `actor` = contul celui care l-a dat; `null` = nu știm cine. */
data class HandoffNotice(val id: String, val title: String, val actor: String?)

/**
 * Sosirea se anunță? `since` = pornirea verificării precedente (tichetul a ajuns pe
 * mine după ea).
 *
 * - O pasă către mine de după `since` spune cine: eu → tac (mi l-am luat singur din
 *   fir sau cu `tk comment --to`); altcineva → el.
 * - Fără pasă (formularul, API-ul, o creare directă pe numele meu): creat de mine →
 *   tac (mi l-am pus singur). Altfel: creat de curând de altcineva → creatorul; creat
 *   demult → nu știm cine (formularul nu lasă urme) — se anunță fără nume.
 * - L-am văzut deja după ce a ajuns (`issue_seen`: l-am deschis pe laptop înainte să
 *   ruleze telefonul) → tac: notificarea ar anunța ceva știut.
 */
fun decideArrival(a: Arrival, myUserId: String, since: Long): HandoffNotice? {
    val floor = since - HANDOFF_SKEW_MS
    val pass = a.handoffAt != null && a.handoffAt >= floor
    val arrivedAt: Long
    val actor: String?
    if (pass) {
        if (a.handoffAuthor == myUserId) return null
        arrivedAt = a.handoffAt!!
        actor = a.handoffAuthor
    } else {
        if (a.createdBy == myUserId) return null
        arrivedAt = floor
        actor = if (a.createdAt != null && a.createdAt >= floor) a.createdBy else null
    }
    if (a.seenAt != null && a.seenAt >= arrivedAt) return null
    return HandoffNotice(a.id, a.title, actor)
}

/** Strânge cele trei răspunsuri în sosiri, în ordinea id-urilor cerute. Un id lipsă (șters între timp) e sărit. */
fun parseArrivals(ids: List<String>, issuesJson: String, eventsJson: String, seenJson: String): List<Arrival> {
    val issues = JSONArray(issuesJson).let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.associateBy { it.str("id") } }
    // Cele mai noi întâi (`order=created_at.desc`), deci primul văzut pe tichet e ultima pasă.
    val passes = mutableMapOf<String, Pair<String?, Long?>>()
    JSONArray(eventsJson).let { a ->
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            val id = o.str("issue_id") ?: continue
            val at = parseIso(o.str("created_at"))
            val prev = passes[id]
            if (prev == null || (at != null && (prev.second == null || at > prev.second!!))) passes[id] = o.str("author_id") to at
        }
    }
    val seen = JSONArray(seenJson).let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }
        .mapNotNull { o -> o.str("issue_id")?.let { it to parseIso(o.str("seen_at")) } }.toMap() }
    return ids.mapNotNull { id ->
        val o = issues[id] ?: return@mapNotNull null
        val p = passes[id]
        Arrival(id, o.str("title") ?: id, o.str("created_by"), parseIso(o.str("created_at")), p?.first, p?.second, seen[id])
    }
}

/** cont → nume. */
fun parseActorNames(json: String): Map<String, String> {
    val a = JSONArray(json)
    return (0 until a.length()).mapNotNull { a.optJSONObject(it) }
        .mapNotNull { o -> o.str("user_id")?.let { u -> o.str("name")?.let { u to it } } }.toMap()
}

/** Titlul notificării: „Mihai ți-a dat MS-270", altfel „Tichet nou pe tine: MS-270". */
fun handoffTitle(id: String, actorName: String?): String =
    if (actorName.isNullOrBlank()) "Tichet nou pe tine: $id" else "$actorName ți-a dat $id"

/**
 * Ce a văzut pagina (API 8, `setInboxSeen`): tichetele din „Ale mele" de pe ecranul
 * aplicației sunt deja știute, deci nu se mai anunță — inclusiv unul pe care mi l-am
 * pus singur din formular, unde nu rămâne nicio urmă pe server. Doar pentru același
 * cont și doar peste o mulțime deja învățată (prima învățare rămâne a workerului).
 */
fun mergePageSeen(prev: HandoffState?, owner: String, ids: Collection<String>): HandoffState? =
    if (prev == null || prev.owner != owner) null else prev.copy(known = prev.known + ids)
