package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeQueueTest {
    private fun a(uid: String, drained: Long? = null, inFlight: Boolean = false) =
        NativeAction(uid, NativeAction.Kind.DONE, "HZ-$uid", title = "t", body = "b", createdAt = 1, drainedAt = drained, inFlight = inFlight)

    @Test fun paginaPreiaDoarCeNuEInZborSiNuETrimis() {
        val (taken, rest) = NativeQueue.take(listOf(a("1"), a("2", inFlight = true), a("3", drained = 5)), now = 10)
        assertEquals(listOf("1"), taken.map { it.uid })
        assertEquals(10L, rest.first { it.uid == "1" }.drainedAt)   // rămâne ca strat peste plan
        assertEquals(true, rest.first { it.uid == "2" }.inFlight)
    }
    @Test fun workerulNuIaCePaginaAPreluat() {
        val (_, rest) = NativeQueue.take(listOf(a("1")), now = 10)
        assertNull(NativeQueue.nextToDrain(rest))
    }
    @Test fun inOrdineUnaCateUna() {
        val q = listOf(a("1"), a("2"))
        assertEquals("1", NativeQueue.nextToDrain(q)!!.uid)
        assertNull(NativeQueue.nextToDrain(NativeQueue.markInFlight(q, "1")))
    }
    @Test fun eliberareaDupaEroareDeReteaOFaceDinNouEligibila() {
        val q = NativeQueue.release(NativeQueue.markInFlight(listOf(a("1")), "1"), "1")
        assertEquals("1", NativeQueue.nextToDrain(q)!!.uid)
    }
    @Test fun pruneScoateDoarCeOListaMaiNouaAConfirmat() {
        val q = listOf(a("1", drained = 5), a("2", drained = 20), a("3"))
        assertEquals(listOf("2", "3"), NativeQueue.prune(q, latestReadAt = 10).map { it.uid })
    }
}
