package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EditTest {
    private fun edit(id: String = "HZ-03", fields: Map<String, String> = mapOf("title" to "Nou"), uid: String = "e1", inFlight: Boolean = false, drainedAt: Long? = null) =
        NativeEdit(uid, id, fields, createdAt = 1, inFlight = inFlight, drainedAt = drainedAt)
    private fun create(attemptId: String? = null, inFlight: Boolean = false) =
        NativeCreate(uid = "c1", tempId = "HZ-~c1", projectId = "p", projectName = null, title = "Vechi", desc = "", dueAt = null, allDay = true,
            remindAt = null, rrule = null, urgent = false, assigneeId = null, createdAt = 1, attemptId = attemptId, inFlight = inFlight)

    @Test fun patchOf_doarCeS_aSchimbat() {
        val base = mapOf("title" to "Raport", "details" to "a")
        assertEquals(emptyMap<String, String>(), patchOf(base, base))
        assertEquals(mapOf("title" to "Raport lunar"), patchOf(mapOf("title" to "Raport lunar", "details" to "a"), base))
        // Un titlu gol nu se trimite; spațiile de la capete nu sunt o schimbare.
        assertEquals(emptyMap<String, String>(), patchOf(mapOf("title" to "   ", "details" to "a"), base))
        assertEquals(emptyMap<String, String>(), patchOf(mapOf("title" to " Raport ", "details" to "a"), base))
        assertEquals(mapOf("details" to ""), patchOf(mapOf("title" to "Raport", "details" to ""), base))
    }

    @Test fun editărileSeContopesc_ultimaValoareCâștigă() {
        val (_, q1) = applyEdit(emptyList(), emptyList(), edit(fields = mapOf("title" to "A")))
        val (_, q2) = applyEdit(emptyList(), q1, edit(uid = "e2", fields = mapOf("title" to "B", "details" to "d")))
        assertEquals(1, q2.size); assertEquals(mapOf("title" to "B", "details" to "d"), q2[0].fields)
        // Una deja în zbor nu se mai atinge: a doua pleacă după ea.
        val (_, q3) = applyEdit(emptyList(), listOf(edit(inFlight = true)), edit(uid = "e2", fields = mapOf("title" to "C")))
        assertEquals(2, q3.size)
    }

    @Test fun peOCreareNetrimisă_seSchimbăCrearea() {
        val (cs, q) = applyEdit(listOf(create()), emptyList(), edit(id = "HZ-~c1", fields = mapOf("title" to "Nou", "details" to "d")))
        assertEquals("Nou", cs[0].title); assertEquals("d", cs[0].desc); assertTrue(q.isEmpty())
        // Cu ID deja ales, titlul crearii e garda lui `conflictOf`: editarea merge la coadă, nu peste creare.
        val (cs2, q2) = applyEdit(listOf(create(attemptId = "HZ-07")), emptyList(), edit(id = "HZ-~c1"))
        assertEquals("Vechi", cs2[0].title); assertEquals(1, q2.size)
    }

    @Test fun cozile_IdProvizoriuAșteaptăRemaparea() {
        val q = listOf(edit(id = "HZ-~c1"), edit(uid = "e2", id = "HZ-04"))
        assertEquals("e2", nextEditToDrain(q)?.uid)
        assertNull(nextEditToDrain(listOf(edit(inFlight = true), edit(uid = "e2", id = "HZ-04"))))
        assertEquals(listOf("HZ-09", "HZ-04"), remapEdits(q, "HZ-~c1", "HZ-09").map { it.id })
    }

    @Test fun cererea_doarCâmpurileSchimbate() {
        val r = buildEditPatch(edit(id = "HZ-03", fields = mapOf("details" to "x")))
        assertEquals("id=eq.HZ-03", r.query); assertEquals(mapOf("details" to "x"), r.body)
    }

    @Test fun widgetulArată_titlulNouPânăLaOAgendăMaiNouă() {
        val items = listOf(AgendaItem("HZ-03", "Vechi", null, "2026-10-06T07:00:00.000Z", false, false, false, false))
        assertEquals("Nou", agendaWithEdits(items, listOf(edit()), readAt = 5)[0].title)
        assertEquals("Nou", agendaWithEdits(items, listOf(edit(drainedAt = 10)), readAt = 5)[0].title)
        assertEquals("Vechi", agendaWithEdits(items, listOf(edit(drainedAt = 3)), readAt = 5)[0].title)
        assertEquals(listOf("e1"), pruneEdits(listOf(edit(), edit(uid = "e2", drainedAt = 3)), agendaReadAt = 5).map { it.uid })
    }

    @Test fun jsonDusÎntors() {
        val e = edit(fields = mapOf("title" to "T", "details" to "D"), drainedAt = 4)
        assertEquals(e, Json.editFromJson(Json.editToJson(e)))
    }
}
