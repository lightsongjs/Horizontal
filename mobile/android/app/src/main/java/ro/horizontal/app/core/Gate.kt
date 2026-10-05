package ro.horizontal.app.core

import org.json.JSONArray
import java.net.URLEncoder

/**
 * Laptopul activ amână mementoul telefonului: dacă omul răspunde acolo („Gata",
 * „15 min"), telefonul nu mai sună deloc. Regula de aur: telefonul tace DOAR
 * la un răspuns sigur. Orice eroare, rețea lipsă sau Doze = sună la minut, ca
 * înainte — o regulă de confort n-are voie să piardă un memento.
 */
const val DEFER_MS = 30_000L

/**
 * La sunare. `desktopActive` = răspunsul lui `desktop_active()`, null la eroare.
 * În Doze nu se amână: acolo Android lasă ~o alarmă `AllowWhileIdle` la 9 minute,
 * deci reverificarea de la +30 s ar fi putut veni după minute întregi.
 */
fun shouldDefer(desktopActive: Boolean?, deviceIdle: Boolean): Boolean = desktopActive == true && !deviceIdle

/** Răspunsul RPC-ului: `true`/`false`, altceva = nu știu. */
fun parseDesktopActive(body: String): Boolean? = when (body.trim()) { "true" -> true; "false" -> false; else -> null }

fun recheckQuery(id: String): String = "issues?select=done,remind_at&id=eq.${URLEncoder.encode(id, "UTF-8")}"

/** Ce știe serverul despre tichet, după amânare. */
sealed class ServerState {
    data class Row(val done: Boolean, val remindAt: Long?) : ServerState()
    /** Tichetul nu mai există (sau nu mai e al tău). */
    object Gone : ServerState()
}

/** Null = răspuns ilizibil, tratat ca eroare (deci sună). */
fun parseRecheck(body: String): ServerState? = try {
    val a = JSONArray(body)
    if (a.length() == 0) ServerState.Gone
    else a.getJSONObject(0).let { o -> ServerState.Row(o.optBoolean("done", false), if (o.isNull("remind_at")) null else parseIso(o.optString("remind_at"))) }
} catch (e: Exception) { null }

/**
 * După amânare: sună doar dacă tichetul e tot nebifat și mementoul tot la ora
 * lui. `stillShown` = planul local nu l-a retras între timp (o listă nouă,
 * o acțiune). `server` null = eroare: sună.
 */
fun showAfterDefer(r: Reminder, server: ServerState?, stillShown: Boolean): Boolean = when {
    !stillShown -> false
    server == null -> true
    server is ServerState.Gone -> false
    server is ServerState.Row -> !server.done && server.remindAt == r.at
    else -> true
}
