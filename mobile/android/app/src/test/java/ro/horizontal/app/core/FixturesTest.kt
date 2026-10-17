package ro.horizontal.app.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
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
                // `routine`: ascunsă până la `remindAt ?: dueAt`, ca `revealAt` din `src/lib/routines.ts`.
                val due = if (o.has("dueAt")) o.getString("dueAt") else null
                val hidden = if (o.optBoolean("routine", false)) parseIso(if (o.has("remindAt")) o.getString("remindAt") else due) else null
                // `pinnedAt`: fixată („Fixate", primul grup), cu sau fără `dueAt`.
                AgendaItem(o.getString("id"), o.getString("id"), null, due, o.optBoolean("allDay", false), false, false, o.optBoolean("urgent", false), hidden,
                    if (o.has("accent")) o.getString("accent") else null, if (o.has("pinnedAt")) o.getString("pinnedAt") else null)
            } }
            // `accent`: culoarea proiectului trece neatinsă (vitest verifică același lucru în `agendaItems`) și se citește ca culoare.
            for (it in items) {
                assertEquals(f.getString("name"), it, Json.agendaItemFromJson(Json.agendaItemToJson(it)))
                if (it.projectAccent != null) assertNotNull(f.getString("name"), accentArgb(it.projectAccent))
            }
            val sections = buildAgenda(items, parseIso(f.getString("now"))!!, zone)
            val got = sections.map { s ->
                if (s.pinned) "pinned:${s.items.joinToString(",") { it.id }}"
                else if (s.overdue) "overdue:${s.items.joinToString(",") { it.id }}" else "day${s.offset}:${s.items.joinToString(",") { it.id }}"
            }
            val want = f.getJSONArray("want").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { w ->
                val ids = w.getJSONArray("ids").let { x -> (0 until x.length()).joinToString(",") { x.getString(it) } }
                when (w.getString("section")) { "pinned" -> "pinned:$ids"; "overdue" -> "overdue:$ids"; else -> "day${w.getInt("offset")}:$ids" }
            } }
            assertEquals(f.getString("name"), want, got)
            // Numărul „Azi" (antetul widget-ului, notificarea din bară) = `listCount` din `App.tsx`.
            if (f.has("todayCount")) assertEquals(f.getString("name"), f.getInt("todayCount"), todayCount(sections))
        }
    }

    @Test fun dueChipDay() {
        val all = load("dueChipDay.fixtures.json")
        for (i in 0 until all.length()) {
            val f = all.getJSONObject(i)
            assertEquals(f.getString("name"), f.getString("want"), dueChipDay(parseIso(f.getString("dueAt"))!!, parseIso(f.getString("now"))!!, zone))
        }
    }

    @Test fun ownership() {
        val all = load("ownership.fixtures.json")
        for (i in 0 until all.length()) {
            val f = all.getJSONObject(i); val me = f.getJSONObject("me"); val issue = f.getJSONObject("issue")
            val got = isMine(issue.str("assigneeId"), issue.str("createdBy"), Me(me.str("assigneeId"), me.str("userId")))
            assertEquals(f.getString("name"), f.getBoolean("want"), got)
        }
    }
}
