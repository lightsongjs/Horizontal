package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HandoffsTest {
    private val me = "u-me"
    private val since = parseIso("2026-11-23T10:00:00Z")!!
    private fun at(s: String) = parseIso(s)!!
    private fun arrival(
        createdBy: String? = "u-alex", createdAt: Long? = at("2026-11-01T08:00:00Z"),
        handoffAuthor: String? = null, handoffAt: Long? = null, seenAt: Long? = null,
    ) = Arrival("MS-270", "Factura lui Popescu", createdBy, createdAt, handoffAuthor, handoffAt, seenAt)

    // ── mulțimea ────────────────────────────────────────────────────────────
    @Test fun primaRulareInvataInTacere() {
        assertEquals(emptySet<String>(), newlyMine(null, me, setOf("MS-1", "MS-2")))
    }
    @Test fun altContInvataDinNouInTacere() {
        val prev = HandoffState("u-alt", setOf("MS-1"), since)
        assertEquals(emptySet<String>(), newlyMine(prev, me, setOf("MS-1", "MS-2")))
    }
    @Test fun doarCeEApărutNou() {
        val prev = HandoffState(me, setOf("MS-1", "MS-2"), since)
        assertEquals(setOf("MS-3"), newlyMine(prev, me, setOf("MS-2", "MS-3")))
    }
    @Test fun unRaspunsPlinNuSeCompara() {
        val full = (1..HANDOFF_LIMIT).joinToString(",", "[", "]") { """{"id":"MS-$it"}""" }
        assertNull(parseMineOpen(full))
        assertEquals(setOf("MS-1", "HZ-2"), parseMineOpen("""[{"id":"MS-1"},{"id":"HZ-2"},{"id":null}]"""))
    }
    @Test fun paginaAdaugaDoarPesteOMultimeInvatata() {
        assertNull(mergePageSeen(null, me, listOf("MS-9")))
        assertNull(mergePageSeen(HandoffState("u-alt", emptySet(), since), me, listOf("MS-9")))
        assertEquals(setOf("MS-1", "MS-9"), mergePageSeen(HandoffState(me, setOf("MS-1"), since), me, listOf("MS-9"))!!.known)
    }

    // ── decizia ─────────────────────────────────────────────────────────────
    @Test fun pasaDeLaAltcinevaSeAnuntaCuNumeleLui() {
        val n = decideArrival(arrival(handoffAuthor = "u-mihai", handoffAt = at("2026-11-23T10:05:00Z")), me, since)
        assertEquals(HandoffNotice("MS-270", "Factura lui Popescu", "u-mihai"), n)
    }
    @Test fun pasaMeaNuSeAnunta() {
        assertNull(decideArrival(arrival(handoffAuthor = me, handoffAt = at("2026-11-23T10:05:00Z")), me, since))
    }
    @Test fun oPasaVecheNuSpuneCineL_aDatAcum() {
        // Pasat mie luna trecută, plecat din formular, întors din formular: pasa veche nu e a lui de acum.
        val n = decideArrival(arrival(handoffAuthor = me, handoffAt = at("2026-10-01T10:00:00Z")), me, since)
        assertEquals(HandoffNotice("MS-270", "Factura lui Popescu", null), n)
    }
    @Test fun ceasulTelefonuluiPoateFiInainte() {
        val n = decideArrival(arrival(handoffAuthor = "u-mihai", handoffAt = since - 60_000), me, since)
        assertEquals("u-mihai", n!!.actor)
    }
    @Test fun creatDeMineFaraPasaNuSeAnunta() {
        assertNull(decideArrival(arrival(createdBy = me), me, since))
        assertNull(decideArrival(arrival(createdBy = me, createdAt = at("2026-11-23T10:03:00Z")), me, since))
    }
    @Test fun creatAcumPeNumeleMeuDeAltcineva() {
        val n = decideArrival(arrival(createdBy = "u-alex", createdAt = at("2026-11-23T10:03:00Z")), me, since)
        assertEquals("u-alex", n!!.actor)
    }
    @Test fun formularulNuLasaUrme_seAnuntaFaraNume() {
        val n = decideArrival(arrival(createdBy = "u-alex"), me, since)
        assertEquals(HandoffNotice("MS-270", "Factura lui Popescu", null), n)
        // Fără creator (API fără `author`) — tot o sosire, tot fără nume.
        assertEquals(null, decideArrival(arrival(createdBy = null), me, since)!!.actor)
    }
    @Test fun vazutDejaDupaSosireNuSeAnunta() {
        assertNull(decideArrival(arrival(handoffAuthor = "u-mihai", handoffAt = at("2026-11-23T10:05:00Z"), seenAt = at("2026-11-23T10:06:00Z")), me, since))
        assertNull(decideArrival(arrival(seenAt = at("2026-11-23T10:01:00Z")), me, since))
    }
    @Test fun vazutInainteDeSosireSeAnunta() {
        val n = decideArrival(arrival(handoffAuthor = "u-mihai", handoffAt = at("2026-11-23T10:05:00Z"), seenAt = at("2026-11-20T09:00:00Z")), me, since)
        assertEquals("u-mihai", n!!.actor)
    }

    // ── citirile ────────────────────────────────────────────────────────────
    @Test fun interogarile() {
        assertEquals("issues?select=id&done=is.false&assignee_id=eq.a-me&limit=1000", mineOpenQuery("a-me"))
        val q = handoffEventsQuery(listOf("MS-1", "HZ-2"), "a-me")
        assertTrue(q, q.startsWith("issue_events?select=issue_id,author_id,created_at&kind=eq.handoff&handoff_to=eq.a-me&issue_id=in."))
        assertTrue(q, "in.%28%22MS-1%22%2C%22HZ-2%22%29" in q && q.endsWith("&order=created_at.desc"))
        assertEquals("issues?select=id,title,created_by,created_at&id=in.%28%22MS-1%22%29", arrivalsQuery(listOf("MS-1")))
        assertEquals("issue_seen?select=issue_id,seen_at&user_id=eq.u-me&issue_id=in.%28%22MS-1%22%29", seenQuery(listOf("MS-1"), "u-me"))
        assertEquals("assignees?select=user_id,name&user_id=in.%28%22u-1%22%29", actorNamesQuery(listOf("u-1")))
    }
    @Test fun sosirileDinCeleTreiRaspunsuri() {
        val issues = """[{"id":"MS-1","title":"Unu","created_by":"u-alex","created_at":"2026-11-01T08:00:00+00:00"},
                         {"id":"MS-2","title":null,"created_by":null,"created_at":null}]"""
        val events = """[{"issue_id":"MS-1","author_id":"u-mihai","created_at":"2026-11-23T10:05:00.123456+00:00"},
                         {"issue_id":"MS-1","author_id":"u-alex","created_at":"2026-11-10T10:00:00+00:00"}]"""
        val seen = """[{"issue_id":"MS-1","seen_at":"2026-11-20T09:00:00+00:00"}]"""
        val a = parseArrivals(listOf("MS-1", "MS-2", "MS-3"), issues, events, seen)
        assertEquals(listOf("MS-1", "MS-2"), a.map { it.id })   // MS-3 șters între timp: sărit
        assertEquals("u-mihai", a[0].handoffAuthor)
        assertEquals(at("2026-11-20T09:00:00Z"), a[0].seenAt)
        assertEquals("MS-2", a[1].title)   // fără titlu: id-ul
        assertNull(a[1].handoffAt)
    }
    @Test fun numeleSiTitlul() {
        assertEquals(mapOf("u-1" to "Mihai"), parseActorNames("""[{"user_id":"u-1","name":"Mihai"},{"user_id":null,"name":"X"}]"""))
        assertEquals("Mihai ți-a dat MS-270", handoffTitle("MS-270", "Mihai"))
        assertEquals("Tichet nou pe tine: MS-270", handoffTitle("MS-270", null))
    }
}
