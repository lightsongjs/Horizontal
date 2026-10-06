package ro.horizontal.app.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.time.ZoneId

/** Aceleași fixtures ca vitest (fișierele `*.fixtures.json` din `src/lib`). Un caz nou se adaugă acolo. */
class FixturesTest {
    private val zone = ZoneId.of("Europe/Bucharest")
    private fun load(name: String) = JSONArray(File(System.getProperty("hz.repoRoot"), "src/lib/$name").readText())
    private fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) getString(k) else null

    @Test fun planNotification() {
        val all = load("pushPayload.fixtures.json")
        for (i in 0 until all.length()) {
            val f = all.getJSONObject(i); val inp = f.getJSONObject("input"); val want = f.getJSONObject("want")
            val got = planNotification(inp.getString("id"), inp.str("title"), inp.str("dueAt"), inp.optBoolean("allDay", false), inp.str("projectName"), zone)
            assertEquals(f.getString("name"), NotificationText(want.getString("title"), want.getString("body"), want.getString("tag")), got)
        }
    }

    @Test fun snoozeTarget() {
        val all = load("reminderAction.fixtures.json")
        for (i in 0 until all.length()) {
            val f = all.getJSONObject(i); val o = f.getJSONObject("option"); val want = f.getJSONObject("want")
            val option = when (o.getString("kind")) {
                "minutes" -> SnoozeOption.Minutes(o.getInt("minutes"))
                "tomorrow9" -> SnoozeOption.Tomorrow9
                else -> SnoozeOption.At(parseIso(o.getString("at"))!!)
            }
            val got = snoozeTarget(option, parseIso(f.getString("now"))!!, f.getJSONObject("issue").str("dueAt"), zone)
            assertEquals(f.getString("name"), want.getString("remindAt"), isoJs(got.remindAt))
            assertEquals(f.getString("name"), want.str("dueAt"), got.dueAt?.let(::isoJs))
        }
    }

    @Test fun agenda() {
        val all = load("agenda.fixtures.json")
        for (i in 0 until all.length()) {
            val f = all.getJSONObject(i)
            val items = f.getJSONArray("items").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
                AgendaItem(o.getString("id"), o.getString("id"), null, o.getString("dueAt"), o.getBoolean("allDay"), false, false, o.getBoolean("urgent"))
            } }
            val got = buildAgenda(items, parseIso(f.getString("now"))!!, zone).map { s ->
                if (s.overdue) "overdue:${s.items.joinToString(",") { it.id }}" else "day${s.offset}:${s.items.joinToString(",") { it.id }}"
            }
            val want = f.getJSONArray("want").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { w ->
                val ids = w.getJSONArray("ids").let { x -> (0 until x.length()).joinToString(",") { x.getString(it) } }
                if (w.getString("section") == "overdue") "overdue:$ids" else "day${w.getInt("offset")}:$ids"
            } }
            assertEquals(f.getString("name"), want, got)
        }
    }
}
