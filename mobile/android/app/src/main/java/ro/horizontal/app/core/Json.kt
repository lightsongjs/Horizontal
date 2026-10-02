package ro.horizontal.app.core

import org.json.JSONObject

/** Forma pe disc și pe punte. Cheia se RECALCULEAZĂ din id+at, nu se crede de la sursă. */
object Json {
    private fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) getString(k) else null

    fun reminderToJson(r: Reminder) = JSONObject().put("id", r.id).put("at", isoJs(r.at)).put("title", r.title).put("body", r.body).put("dueAt", r.dueAt ?: JSONObject.NULL).put("allDay", r.allDay)
    fun reminderFromJson(o: JSONObject): Reminder? {
        val id = o.str("id") ?: return null
        val at = parseIso(o.str("at")) ?: return null
        return Reminder(reminderKey(id, at), id, at, o.str("title") ?: return null, o.str("body") ?: return null, o.str("dueAt"), o.optBoolean("allDay", false))
    }
    fun actionToJson(a: NativeAction) = JSONObject().put("uid", a.uid).put("kind", a.kind.name).put("id", a.id)
        .put("remindAt", a.remindAt ?: JSONObject.NULL).put("dueAt", a.dueAt ?: JSONObject.NULL).put("prevDueAt", a.prevDueAt ?: JSONObject.NULL)
        .put("title", a.title).put("body", a.body).put("allDay", a.allDay).put("createdAt", a.createdAt)
        .put("drainedAt", a.drainedAt ?: JSONObject.NULL).put("inFlight", a.inFlight)
    fun actionFromJson(o: JSONObject): NativeAction? = try {
        NativeAction(o.getString("uid"), NativeAction.Kind.valueOf(o.getString("kind")), o.getString("id"),
            if (o.isNull("remindAt")) null else o.getLong("remindAt"), o.str("dueAt"), o.str("prevDueAt"),
            o.getString("title"), o.getString("body"), o.optBoolean("allDay"), o.getLong("createdAt"),
            if (o.isNull("drainedAt")) null else o.getLong("drainedAt"), o.optBoolean("inFlight"))
    } catch (e: Exception) { null }
    /** `DesktopAction` din `src/lib/desktopBridge.ts`. */
    fun actionToPage(a: NativeAction): JSONObject = when (a.kind) {
        // `prevDueAt`: pagina refuză un „Gata" pe o recurentă care a sărit între timp
        // (ar sări a doua oară) — aceeași gardă ca în `buildPatch`. `null` = fără scadență.
        NativeAction.Kind.DONE -> JSONObject().put("action", "done").put("id", a.id).put("prevDueAt", a.prevDueAt ?: JSONObject.NULL)
        NativeAction.Kind.UNTIL -> JSONObject().put("action", "until").put("id", a.id).put("at", isoJs(a.remindAt ?: 0)).also { o -> a.dueAt?.let { o.put("dueAt", it) } }
    }
}
