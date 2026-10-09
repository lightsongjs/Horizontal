package ro.horizontal.app.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

class CaptureTest {
    private val zone = ZoneId.of("Europe/Bucharest")
    private val now = parseIso("2026-10-06T08:00:00.000Z")!!
    private val data = CaptureData(
        listOf(CaptureProject("p-pers", "Personal", "FIN", "personal"), CaptureProject("p-daily", "✅Daily", "HZ", "team")),
        listOf(CapturePerson("a-ana", "Ana Pop")), readAt = 1,
    )

    @Test fun inboxDupăIdApoiDupăNume() {
        assertEquals("p-daily", inboxProjectId(data.projects))
        assertEquals("d", inboxProjectId(listOf(CaptureProject("x", "Daily", "X", null), CaptureProject("d", "Cutia mea", "D", null))))
        assertEquals("i", inboxProjectId(listOf(CaptureProject("i", "Inbox", "I", null))))
        assertNull(inboxProjectId(listOf(CaptureProject("x", "Altceva", "X", null))))
    }

    @Test fun modulBrut_titlulETextul_DailyȘiAzi() {
        val d = rawDraft("mâine la 10 #daily", Manual(), data, now, zone)
        assertEquals("mâine la 10 #daily", d.title)
        assertEquals("p-daily", d.projectId)
        assertEquals("2026-10-05T21:00:00.000Z", d.dueAt)
        assertEquals(true, d.allDay)
        assertNull(d.remindAt)
        assertNull(d.error)
        assertEquals(true, d.raw)
        assertEquals("Azi", d.label)
    }

    @Test fun modulBrut_jetoaneleBatImplicitul() {
        val d = rawDraft("plată", Manual(projectId = "p-pers", assigneeSet = true, assigneeId = "a-ana", urgent = true,
            dueSet = true, dueAt = "2026-10-07T07:00:00.000Z", allDay = false), data, now, zone)
        assertEquals("p-pers", d.projectId); assertEquals("a-ana", d.assigneeId); assertEquals(true, d.urgent)
        assertEquals("2026-10-07T07:00:00.000Z", d.dueAt); assertEquals("2026-10-07T07:00:00.000Z", d.remindAt)
        assertEquals("Mâine 10:00", d.label)
    }

    @Test fun modulBrut_golȘiFărăDaily() {
        assertEquals("empty", rawDraft("   ", Manual(), data, now, zone).error)
        val noDaily = data.copy(projects = listOf(CaptureProject("w", "Work", "W", "team"), CaptureProject("p", "Eu", "E", "personal")))
        assertEquals("p", rawDraft("x", Manual(), noDaily, now, zone).projectId)
    }

    @Test fun dataAleasăDinCalendar() {
        assertEquals("2026-10-06T21:00:00.000Z" to true, manualDue(LocalDate.of(2026, 10, 7), null, zone))
        assertEquals("2026-10-07T07:00:00.000Z" to false, manualDue(LocalDate.of(2026, 10, 7), LocalTime.of(10, 0), zone))
        assertEquals(null to true, manualDue(null, null, zone))
    }

    @Test fun intrareaMotorului_șiRezultatul() {
        val m = Manual(projectId = "p-pers", dueSet = true, dueAt = null, allDay = true)
        val inp = engineInput("x", "d", listOf("la 10"), m, data, "p-daily", now)
        assertEquals("p-pers", inp.getJSONObject("manual").getString("projectId"))
        assertEquals(true, inp.getJSONObject("manual").getJSONObject("due").isNull("dueAt"))
        assertEquals(false, inp.getJSONObject("manual").has("assigneeId"))
        assertEquals(now, inp.getLong("nowMs"))
        assertEquals(true, inp.getBoolean("tokens"))

        val r = parseEngineResult(JSONObject("""{"live":["la 10"],"spans":[[8,13]],"title":"Ședință","projectId":"p-daily","assigneeId":null,
            "urgent":true,"unknown":[],"dueAt":"2026-10-07T07:00:00.000Z","allDay":false,"rrule":null,"remindAt":"2026-10-07T07:00:00.000Z","label":{"day":"Mâine","time":"10:00"},"issue":{},"error":null}""").toString())
        assertEquals(listOf(8 until 13), r.spans); assertEquals("Ședință", r.title); assertEquals(true, r.urgent); assertNull(r.error)
        assertEquals(listOf("la 10"), r.live); assertEquals(false, r.raw); assertEquals("Mâine 10:00", r.label)
    }

    @Test fun sugestiile_dinMotor() {
        val json = """{"token":{"sigil":"#","query":"pe","start":7,"end":10},"items":[
            {"id":"p-pers","label":"Personal","insert":"#Personal","apply":{"text":"raport #Personal ","caret":17}}]}"""
        assertEquals(listOf(CaptureSuggestion("#", "Personal", "raport #Personal ", 17)), parseSuggestions(json))
        assertEquals(emptyList<CaptureSuggestion>(), parseSuggestions("""{"token":null,"items":[]}"""))
    }
}
