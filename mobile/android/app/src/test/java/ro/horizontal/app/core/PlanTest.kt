package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlanTest {
    private val t0 = parseIso("2026-10-02T09:00:00Z")!!
    private val min = 60_000L
    private fun r(id: String, at: Long) = Reminder(reminderKey(id, at), id, at, id, "b", null, false)
    private fun done(id: String, created: Long, drained: Long? = null) =
        NativeAction("u-$id", NativeAction.Kind.DONE, id, title = id, body = "b", createdAt = created, drainedAt = drained)

    @Test fun paginaMaiNouaCastigaIntegral() {
        val page = PageList(listOf(r("A", t0)), emptySet(), readAt = t0 + 10)
        val native = NativeList(listOf(r("B", t0)), readAt = t0)
        assertEquals(listOf("A"), mergePlan(page, native, emptyList()).map { it.id })
    }
    @Test fun nativaMaiNouaCastigaMaiPutinHeldIds() {
        // A e bifat offline pe pagină (coada ei îl ține): serverul încă îl are, nu-l învia.
        val page = PageList(listOf(r("B", t0 + 5 * min)), heldIds = setOf("A", "B"), readAt = t0)
        val native = NativeList(listOf(r("A", t0), r("B", t0), r("C", t0)), readAt = t0 + 10)
        val plan = mergePlan(page, native, emptyList())
        assertEquals(listOf("C", "B"), plan.map { it.id })
        assertEquals(t0 + 5 * min, plan.first { it.id == "B" }.at)
    }
    @Test fun paginaOfflineReadAtZeroPierde() {
        val page = PageList(listOf(r("A", t0)), emptySet(), readAt = 0)
        val native = NativeList(listOf(r("A", t0 + 30 * min)), readAt = 1)
        assertEquals(t0 + 30 * min, mergePlan(page, native, emptyList()).single().at)
    }
    @Test fun actiuneaLocalaSeVedePanaCandOListaCititaDupaEaOContine() {
        val native = NativeList(listOf(r("A", t0)), readAt = t0)
        assertEquals(emptyList<String>(), mergePlan(null, native, listOf(done("A", t0 + 1))).map { it.id })
        // trimisă la t0+2, dar lista e de la t0: tot se aplică
        assertEquals(emptyList<String>(), mergePlan(null, native, listOf(done("A", t0 + 1, drained = t0 + 2))).map { it.id })
        // o listă citită după trimitere o conține deja; acțiunea nu se mai aplică
        val fresh = NativeList(listOf(r("A", t0 + 60 * min)), readAt = t0 + 3)
        assertEquals(listOf("A"), mergePlan(null, fresh, listOf(done("A", t0 + 1, drained = t0 + 2))).map { it.id })
    }
    @Test fun untilMutaMementoulSiPastreazaTextul() {
        val native = NativeList(listOf(r("A", t0)), readAt = t0)
        val until = NativeAction("u", NativeAction.Kind.UNTIL, "A", remindAt = t0 + 15 * min, title = "A", body = "b", createdAt = t0)
        val plan = mergePlan(null, native, listOf(until)).single()
        assertEquals(reminderKey("A", t0 + 15 * min), plan.key)
    }

    @Test fun sunaCeleDinUltimaOraSiSareCeleMaiVechi() {
        val p = planAlarms(listOf(r("old", t0 - 61 * min), r("late", t0 - 59 * min), r("next", t0 + 10 * min)), t0, emptySet(), emptyMap())
        assertEquals(listOf("late"), p.fireNow.map { it.id })
        assertEquals(t0 + 10 * min, p.nextAt)
    }
    @Test fun acelasiMinutSunaImpreuna() {
        // limita Doze: ~o alarmă la 9 min; tot ce cade în minutul curent pleacă acum
        val p = planAlarms(listOf(r("A", t0), r("B", t0 + 40_000)), t0, emptySet(), emptyMap())
        assertEquals(listOf("A", "B"), p.fireNow.map { it.id })
        assertNull(p.nextAt)
    }
    @Test fun cheiaSunataDejaNuMaiSuna() {
        // aceeași cheie, indiferent pe ce cale a venit (pagină sau sincronizare)
        val p = planAlarms(listOf(r("A", t0)), t0, setOf(reminderKey("A", t0)), emptyMap())
        assertEquals(emptyList<Reminder>(), p.fireNow)
    }
    @Test fun retrageDoarNotificarileACarorCheieALipsit() {
        val shown = mapOf("A" to reminderKey("A", t0 - 90 * min), "B" to reminderKey("B", t0 - 5 * min))
        // A: încă în plan, cu aceeași cheie, deși a trecut de o oră → rămâne pe ecran
        // B: amânat pe laptop → cheie nouă → se retrage
        val p = planAlarms(listOf(r("A", t0 - 90 * min), r("B", t0 + 15 * min)), t0, setOf(reminderKey("A", t0 - 90 * min), reminderKey("B", t0 - 5 * min)), shown)
        assertEquals(setOf("B"), p.cancelIds)
    }
    @Test fun firedSeCurataDupaOptZile() {
        val keep = reminderKey("A", t0 - 2 * 24 * 60 * min)
        val drop = reminderKey("B", t0 - 9 * 24 * 60 * min)
        assertEquals(setOf(keep), pruneFired(setOf(keep, drop, "gunoi"), t0))
    }
}
