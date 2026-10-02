package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DrainTest {
    @Test fun okSauZeroRanduriEFacut() {
        assertEquals(Outcome.DONE, outcomeOf(200, false, false))   // 0 rânduri cu gardă = deja făcut
        assertEquals(Outcome.DONE, outcomeOf(204, false, false))
    }
    @Test fun reteauaReincearcaFaraSaPiardaElementul() { assertEquals(Outcome.RETRY, outcomeOf(null, true, false)) }
    // Fără sesiune, refuzul RLS nu e un refuz al acțiunii — elementul rămâne; pagina îl poate prelua.
    @Test fun sesiuneMoartaPastreaza() { assertEquals(Outcome.KEEP_NO_SESSION, outcomeOf(null, false, true)) }
    @Test fun autentificareaNuArunca() { assertEquals(Outcome.KEEP_NO_SESSION, outcomeOf(401, false, false)) }
    @Test fun cinciSuteReincearca() { assertEquals(Outcome.RETRY, outcomeOf(503, false, false)) }
    // Refuz real (tichetul nu mai există, constrângere): iese din coadă, ca să n-o blocheze.
    @Test fun refuzulIeseDinCoada() { assertEquals(Outcome.DROP, outcomeOf(400, false, false)); assertEquals(Outcome.DROP, outcomeOf(404, false, false)) }

    private fun a(uid: String, inFlight: Boolean = true) = NativeAction(uid, NativeAction.Kind.DONE, "HZ-1", title = "t", body = "", createdAt = 0, inFlight = inFlight)

    // Coada golită în timpul cererii (logout, sau login pe alt cont): nimic de scris, workerul se oprește.
    @Test fun elementDisparutNuSeScrieInapoi() { assertNull(afterAttempt(listOf(a("u2")), "u1", Outcome.DONE, signedIn = true, now = 5)) }
    @Test fun dupaLogoutCoadaGoalaRamaneGoala() { assertNull(afterAttempt(emptyList(), "u1", Outcome.DONE, signedIn = false, now = 5)) }
    // Sesiunea a murit în cerere: elementul se ELIBEREAZĂ, altfel „în zbor" ar bloca coada pe veci.
    @Test fun sesiuneMoartaElibereazaNuBlocheaza() {
        assertEquals(listOf(a("u1", inFlight = false)), afterAttempt(listOf(a("u1")), "u1", Outcome.KEEP_NO_SESSION, signedIn = false, now = 5))
    }
    // Fără sesiune nu se marchează nimic trimis, chiar dacă răspunsul a fost 200.
    @Test fun faraSesiuneNuMarcheazaTrimis() {
        assertEquals(listOf(a("u1", inFlight = false)), afterAttempt(listOf(a("u1")), "u1", Outcome.DONE, signedIn = false, now = 5))
    }
    @Test fun normalSeMarcheazaTrimis() {
        assertEquals(listOf(a("u1", inFlight = false).copy(drainedAt = 5)), afterAttempt(listOf(a("u1")), "u1", Outcome.DONE, signedIn = true, now = 5))
    }
    @Test fun refuzulScoate() { assertEquals(emptyList<NativeAction>(), afterAttempt(listOf(a("u1")), "u1", Outcome.DROP, signedIn = true, now = 5)) }
    @Test fun reincercareaElibereaza() {
        assertEquals(listOf(a("u1", inFlight = false)), afterAttempt(listOf(a("u1")), "u1", Outcome.RETRY, signedIn = true, now = 5))
    }

    // Un worker omorât în cerere lasă `inFlight` pe disc; la pornire se eliberează, altfel coada s-ar bloca pe veci.
    @Test fun inFlightRamasEEliberatLaPornire() {
        val q = listOf(a("u1", inFlight = true), a("u2", inFlight = false).copy(drainedAt = 3))
        assertEquals(listOf(a("u1", inFlight = false), a("u2", inFlight = false).copy(drainedAt = 3)), NativeQueue.releaseAllInFlight(q))
        assertEquals(a("u1", inFlight = false), NativeQueue.nextToDrain(NativeQueue.releaseAllInFlight(q)))
    }
}
