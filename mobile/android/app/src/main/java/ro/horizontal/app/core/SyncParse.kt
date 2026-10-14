package ro.horizontal.app.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.ZoneId

/**
 * Citirea nativă: doar rânduri și ore. Recurențele, listele inteligente,
 * layerele rămân pe server și în pagină — Kotlin nu calculează nimic din ele.
 * Trece prin RLS cu sesiunea nativă, deci vede exact ce vede omul.
 *
 * Fereastra în trecut e LOOKBACK_MS (24 h), nu MISSED_WINDOW_MS (1 h): planul
 * retrage notificările ale căror chei lipsesc din listă, deci o fereastră de o
 * oră ar retrage un memento sunat și neatins la o oră după ce a sunat.
 */
fun syncQuery(now: Long, me: Me = Me.UNKNOWN): String {
    val e = { s: String -> URLEncoder.encode(s, "UTF-8") }
    return "issues?select=id,title,due_at,all_day,remind_at,assignee_id,created_by,projects(name)" +
        "&done=is.false&remind_at=gte.${e(isoJs(now - LOOKBACK_MS))}&remind_at=lte.${e(isoJs(now + HORIZON_MS))}" +
        mineFilter(me) + "&order=remind_at.asc&limit=100"
}

/**
 * Un rând stricat (fără id, `remind_at` ilizibil) e sărit, nu aruncă: un singur
 * tichet ciudat n-are voie să oprească toată sincronizarea și, odată cu ea,
 * toate celelalte mementouri. Ce nu e al meu (`isMine`) e sărit, ca în pagină.
 */
fun parseIssues(json: String, zone: ZoneId, me: Me = Me.UNKNOWN): List<Reminder> {
    val a = JSONArray(json)
    // `isNull` înainte de `optString`: pe Android, `optString` pe un JSON null
    // întoarce textul "null" (pe JVM, în teste, întoarce gol) — ar ieși un tichet
    // cu id-ul „null” sau proiectul „null” doar pe telefon.
    fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k)
    return (0 until a.length()).mapNotNull { i ->
        val o = a.optJSONObject(i) ?: return@mapNotNull null
        val id = o.str("id")?.ifEmpty { null } ?: return@mapNotNull null
        if (!isMine(o.str("assignee_id"), o.str("created_by"), me)) return@mapNotNull null
        val at = parseIso(o.str("remind_at")) ?: return@mapNotNull null
        val due = o.str("due_at")
        val allDay = o.optBoolean("all_day", false)
        val project = o.optJSONObject("projects")?.str("name")
        val t = planNotification(id, o.str("title"), due, allDay, project, zone)
        Reminder(reminderKey(id, at), id, at, t.title, t.body, due, allDay)
    }
}
