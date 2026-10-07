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
    fun agendaItemToJson(i: AgendaItem) = JSONObject().put("id", i.id).put("title", i.title).put("project", i.project ?: JSONObject.NULL)
        .put("dueAt", i.dueAt).put("allDay", i.allDay).put("hasReminder", i.hasReminder).put("recurring", i.recurring).put("urgent", i.urgent)
        .put("hiddenUntil", i.hiddenUntil?.let { isoJs(it) } ?: JSONObject.NULL)
    /** Și forma de pe punte (`AgendaItem` din `src/lib/agenda.ts`). */
    fun agendaItemFromJson(o: JSONObject): AgendaItem? {
        val id = o.str("id") ?: return null
        val due = parseIso(o.str("dueAt")) ?: return null
        return AgendaItem(id, o.str("title") ?: return null, o.str("project"), isoJs(due), o.optBoolean("allDay", false),
            o.optBoolean("hasReminder", false), o.optBoolean("recurring", false), o.optBoolean("urgent", false),
            parseIso(o.str("hiddenUntil")))
    }
    fun agendaToJson(l: AgendaList) = JSONObject().put("readAt", l.readAt)
        .put("items", org.json.JSONArray().also { a -> l.items.forEach { a.put(agendaItemToJson(it)) } })
    fun agendaFromJson(o: JSONObject): AgendaList? = try {
        val a = o.getJSONArray("items")
        AgendaList((0 until a.length()).mapNotNull { agendaItemFromJson(a.getJSONObject(it)) }, o.getLong("readAt"))
    } catch (e: Exception) { null }
    fun createToJson(c: NativeCreate) = JSONObject().put("uid", c.uid).put("tempId", c.tempId).put("projectId", c.projectId)
        .put("projectName", c.projectName ?: JSONObject.NULL).put("title", c.title).put("desc", c.desc)
        .put("dueAt", c.dueAt ?: JSONObject.NULL).put("allDay", c.allDay).put("remindAt", c.remindAt ?: JSONObject.NULL)
        .put("rrule", c.rrule ?: JSONObject.NULL).put("urgent", c.urgent).put("assigneeId", c.assigneeId ?: JSONObject.NULL)
        .put("createdAt", c.createdAt).put("attemptId", c.attemptId ?: JSONObject.NULL).put("realId", c.realId ?: JSONObject.NULL)
        .put("drainedAt", c.drainedAt ?: JSONObject.NULL).put("inFlight", c.inFlight).put("tries", c.tries)
        .put("files", org.json.JSONArray().also { a -> c.files.forEach { f -> a.put(JSONObject().put("path", f.path).put("filename", f.filename)
            .put("contentType", f.contentType).put("size", f.size).put("attachmentId", f.attachmentId).put("uploaded", f.uploaded)) } })
    fun createFromJson(o: JSONObject): NativeCreate? = try {
        val fs = o.optJSONArray("files") ?: org.json.JSONArray()
        NativeCreate(o.getString("uid"), o.getString("tempId"), o.getString("projectId"), o.str("projectName"), o.getString("title"),
            o.optString("desc", ""), o.str("dueAt"), o.optBoolean("allDay", true), o.str("remindAt"), o.str("rrule"), o.optBoolean("urgent"),
            o.str("assigneeId"), o.getLong("createdAt"), o.str("attemptId"), o.str("realId"),
            if (o.isNull("drainedAt")) null else o.getLong("drainedAt"), o.optBoolean("inFlight"), o.optInt("tries"),
            (0 until fs.length()).map { val f = fs.getJSONObject(it)
                NativeFile(f.getString("path"), f.getString("filename"), f.getString("contentType"), f.getLong("size"), f.getString("attachmentId"), f.optBoolean("uploaded")) })
    } catch (e: Exception) { null }
    fun editToJson(e: NativeEdit) = JSONObject().put("uid", e.uid).put("id", e.id).put("fields", JSONObject(e.fields as Map<*, *>))
        .put("createdAt", e.createdAt).put("inFlight", e.inFlight).put("drainedAt", e.drainedAt ?: JSONObject.NULL)
    fun editFromJson(o: JSONObject): NativeEdit? = try {
        val f = o.getJSONObject("fields")
        NativeEdit(o.getString("uid"), o.getString("id"), f.keys().asSequence().associateWith { f.getString(it) }, o.getLong("createdAt"),
            o.optBoolean("inFlight"), if (o.isNull("drainedAt")) null else o.getLong("drainedAt"))
    } catch (e: Exception) { null }
}
