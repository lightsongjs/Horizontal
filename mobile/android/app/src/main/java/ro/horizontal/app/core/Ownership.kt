package ro.horizontal.app.core

import org.json.JSONArray
import java.net.URLEncoder

/**
 * Cine sunt, pentru regula „al meu" — `Me` din `src/lib/ownership.ts`.
 * `assigneeId` = rândul meu din `assignees` (`user_id` = contul); `userId` = contul.
 * Oricare `null` = nu știm cine ești → nu se taie nimic.
 */
data class Me(val assigneeId: String?, val userId: String?) {
    val known get() = assigneeId != null && userId != null
    companion object { val UNKNOWN = Me(null, null) }
}

/**
 * `isMine` din `src/lib/ownership.ts`, scrisă a doua oară; fixtures comune în
 * `src/lib/ownership.fixtures.json`. Pasată mie → da; pasată altcuiva → nu;
 * nepasată → a creatorului: da dacă eu am creat-o sau n-are autor.
 */
fun isMine(assigneeId: String?, createdBy: String?, me: Me): Boolean {
    if (!me.known) return true
    if (assigneeId != null) return assigneeId == me.assigneeId
    return createdBy == null || createdBy == me.userId
}

/** Rândul meu din `assignees` (RLS: orice cont autentificat le citește). Contul nelegat → nimic. */
fun meQuery(userId: String): String = "assignees?select=id&user_id=eq.${URLEncoder.encode(userId, "UTF-8")}&limit=1"

/** `null` = contul nu e legat de niciun nume (atunci nu se taie nimic, ca în pagină). */
fun parseMe(json: String): String? {
    val a = JSONArray(json)
    val o = a.optJSONObject(0) ?: return null
    return if (o.isNull("id")) null else o.optString("id").ifEmpty { null }
}

/**
 * Aceeași regulă ca filtru PostgREST, ca plafonul citirii (100 / 200 de rânduri)
 * să numere doar ce e al meu — altfel restanțele altora l-ar umple. Doar o
 * îngustare: `isMine` din parsare rămâne regula; filtrul n-are voie să lase
 * afară ceva ce ea ar păstra. Gol fără identitate.
 */
fun mineFilter(me: Me): String {
    if (!me.known) return ""
    return "&or=" + URLEncoder.encode(mineCond(me)!!.removePrefix("or"), "UTF-8")
}

/** Aceeași condiție, ca termen într-un `and=(…)` (agenda o combină cu fereastra ei). Necunoscut → `null`, nu taie. */
fun mineCond(me: Me): String? = if (!me.known) null else
    "or(assignee_id.eq.${me.assigneeId},and(assignee_id.is.null,or(created_by.eq.${me.userId},created_by.is.null)))"

