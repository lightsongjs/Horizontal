package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Test

class PatchTest {
    @Test fun gataPoartaGardaPeScadenta() {
        // Recurentă: trigger-ul sare la fiecare false→true și lasă done=false.
        // O retrimitere fără gardă ar sări încă o dată.
        val p = buildPatch(NativeAction("u", NativeAction.Kind.DONE, "HZ-1", prevDueAt = "2026-10-02T09:00:00.000Z", title = "t", body = "b", createdAt = 0))
        assertEquals("id=eq.HZ-1&or=%28due_at.eq.%222026-10-02T09%3A00%3A00.000Z%22%2Crrule.is.null%29", p.query)
        assertEquals(mapOf("done" to true), p.body)
    }
    @Test fun gataFaraScadentaGardaIsNull() {
        val p = buildPatch(NativeAction("u", NativeAction.Kind.DONE, "HZ-1", title = "t", body = "b", createdAt = 0))
        assertEquals("id=eq.HZ-1&or=%28due_at.is.null%2Crrule.is.null%29", p.query)
    }
    @Test fun amanareaEAbsolutaSiFaraGarda() {
        val at = parseIso("2026-10-02T09:15:00Z")!!
        val p = buildPatch(NativeAction("u", NativeAction.Kind.UNTIL, "HZ-1", remindAt = at, title = "t", body = "b", createdAt = 0))
        assertEquals("id=eq.HZ-1", p.query)
        assertEquals(mapOf("remind_at" to "2026-10-02T09:15:00.000Z"), p.body)
    }
    @Test fun maine9MutaSiScadenta() {
        val at = parseIso("2026-10-03T06:00:00Z")!!
        val p = buildPatch(NativeAction("u", NativeAction.Kind.UNTIL, "HZ-1", remindAt = at, dueAt = "2026-10-03T12:00:00.000Z", title = "t", body = "b", createdAt = 0))
        assertEquals(mapOf("remind_at" to "2026-10-03T06:00:00.000Z", "due_at" to "2026-10-03T12:00:00.000Z"), p.body)
    }
    @Test fun idCuCaractereSpecialeEsteCodat() {
        val p = buildPatch(NativeAction("u", NativeAction.Kind.UNTIL, "A&B", remindAt = 0, title = "t", body = "b", createdAt = 0))
        assertEquals("id=eq.A%26B", p.query)
    }
    @Test fun gataPeAltaPaginaPoartaScadentaAnterioara() {
        // Pagina refuză „Gata" pe o recurentă care a sărit între timp — are nevoie de scadența văzută.
        val a = NativeAction("u", NativeAction.Kind.DONE, "HZ-1", prevDueAt = "2026-10-02T09:00:00.000Z", title = "t", body = "b", createdAt = 0)
        val o = Json.actionToPage(a)
        assertEquals("done", o.getString("action"))
        assertEquals("2026-10-02T09:00:00.000Z", o.getString("prevDueAt"))
        val none = Json.actionToPage(a.copy(prevDueAt = null))
        assertEquals(true, none.has("prevDueAt") && none.isNull("prevDueAt"))
    }
}
