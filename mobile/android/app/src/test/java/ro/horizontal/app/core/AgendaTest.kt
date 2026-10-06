package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class AgendaTest {
    private val zone = ZoneId.of("Europe/Bucharest")
    private val now = parseIso("2026-10-06T08:00:00.000Z")!!   // marți, 11:00
    private fun item(id: String, dueAt: String, allDay: Boolean = true) = AgendaItem(id, id, null, dueAt, allDay, false, false, false)
    private fun done(id: String, drainedAt: Long? = null) = NativeAction(uid = "u-$id", kind = NativeAction.Kind.DONE, id = id, title = "", body = "", createdAt = 1, drainedAt = drainedAt)

    @Test fun câștigăListaMaiProaspătă_șiBifeleDinCoadăSuntAscunse() {
        val page = AgendaList(listOf(item("A", "2026-10-05T21:00:00.000Z")), readAt = 10)
        val native = AgendaList(listOf(item("A", "2026-10-05T21:00:00.000Z"), item("B", "2026-10-05T21:00:00.000Z")), readAt = 20)
        assertEquals(listOf("A", "B"), visibleAgenda(page, native, emptyList())!!.map { it.id })
        assertEquals(listOf("A"), visibleAgenda(page.copy(readAt = 30), native, emptyList())!!.map { it.id })
        // Ascunsă și după trimitere: rămâne ascunsă până o listă nouă (fără ea) prunează coada.
        assertEquals(listOf("B"), visibleAgenda(null, native, listOf(done("A", drainedAt = 25)))!!.map { it.id })
    }

    @Test fun fărăNicioListă_eNoData_nuGol() {
        assertEquals(AgendaState.NoData, agendaState(null, null, emptyList(), now, zone))
        val empty = agendaState(null, AgendaList(emptyList(), 1), emptyList(), now, zone)
        assertEquals(AgendaState.Ready(emptyList(), 0), empty)
    }

    @Test fun etichete() {
        val today = LocalDate.of(2026, 10, 6)
        assertEquals("RESTANȚE", sectionLabel(AgendaSection(true, 0, null, emptyList())))
        assertEquals("AZI · MAR 6 OCT", sectionLabel(AgendaSection(false, 0, today, emptyList())))
        assertEquals("MÂINE · MIE 7 OCT", sectionLabel(AgendaSection(false, 1, today.plusDays(1), emptyList())))
        assertEquals("JOI 8 OCT", sectionLabel(AgendaSection(false, 2, today.plusDays(2), emptyList())))
        assertEquals("SÂMBĂTĂ 10 OCT", sectionLabel(AgendaSection(false, 4, today.plusDays(4), emptyList())))
    }

    @Test fun metadateleRândului() {
        assertEquals("14:30", rowMeta(item("A", "2026-10-06T11:30:00.000Z", allDay = false), false, now, zone))
        assertEquals("", rowMeta(item("A", "2026-10-05T21:00:00.000Z"), false, now, zone))
        assertEquals("10:00", rowMeta(item("A", "2026-10-06T07:00:00.000Z", allDay = false), true, now, zone))   // restanță de azi: ora
        assertEquals("ieri", rowMeta(item("A", "2026-10-04T21:00:00.000Z"), true, now, zone))
        assertEquals("vin 2", rowMeta(item("A", "2026-10-01T21:00:00.000Z"), true, now, zone))
        assertEquals("29 sep", rowMeta(item("A", "2026-09-28T21:00:00.000Z"), true, now, zone))           // ≥ 7 zile: data, nu ziua
    }

    @Test fun interogareaÎncepeDeLaOriceRestanțăȘiSeOpreșteLaZiua7() {
        val q = agendaQuery(now, zone)
        assertTrue(q, q.contains("done=is.false"))
        assertTrue(q, q.contains("due_at=lt.2026-10-12T21%3A00%3A00.000Z"))
        assertTrue(q, q.contains("limit=$AGENDA_LIMIT"))
        assertTrue(q, !q.contains("due_at=gte"))
    }

    @Test fun parsareaSareRândurileStricate() {
        val json = """[
          {"id":"HZ-1","title":"Raport","due_at":"2026-10-06T07:00:00+00:00","all_day":false,"remind_at":"2026-10-06T06:50:00+00:00","rrule":null,"urgent":true,"projects":{"name":"Daily"}},
          {"id":null,"title":"x","due_at":"2026-10-06T07:00:00+00:00"},
          {"id":"HZ-2","title":null,"due_at":null},
          {"id":"HZ-3","title":null,"due_at":"2026-10-06T07:00:00+00:00","all_day":true,"remind_at":null,"rrule":"FREQ=DAILY","urgent":null,"projects":null}
        ]"""
        assertEquals(listOf(
            AgendaItem("HZ-1", "Raport", "Daily", "2026-10-06T07:00:00.000Z", false, true, false, true),
            AgendaItem("HZ-3", "Sarcină fără titlu", null, "2026-10-06T07:00:00.000Z", true, false, true, false),
        ), parseAgenda(json))
    }

    @Test fun jsonDusÎntors() {
        val l = AgendaList(listOf(AgendaItem("HZ-1", "R", null, "2026-10-06T07:00:00.000Z", false, true, true, false)), 42)
        assertEquals(l, Json.agendaFromJson(Json.agendaToJson(l)))
    }
}
