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

    @Test fun capeteleDeGrup_fărăMajuscule_cuDataSauNumărul() {
        val today = LocalDate.of(2026, 10, 6)
        assertEquals(SectionHead("Restanțe", null), sectionHead(AgendaSection(true, 0, null, emptyList())))
        assertEquals(SectionHead("Azi", null), sectionHead(AgendaSection(false, 0, today, emptyList())))
        assertEquals(SectionHead("Mâine", "mie 7 oct"), sectionHead(AgendaSection(false, 1, today.plusDays(1), emptyList())))
        assertEquals(SectionHead("Joi", "8 oct"), sectionHead(AgendaSection(false, 2, today.plusDays(2), emptyList())))
        assertEquals(SectionHead("Sâmbătă", "10 oct"), sectionHead(AgendaSection(false, 4, today.plusDays(4), emptyList())))
        assertEquals("marți, 6 octombrie", todayLine(now, zone))
    }

    @Test fun antetul_numărăAziCuRestanțe_iarAziPrimulNuAreCap() {
        val today = LocalDate.of(2026, 10, 6)
        val late = AgendaSection(true, 0, null, listOf(item("A", "x"), item("B", "x")))
        val azi = AgendaSection(false, 0, today, listOf(item("C", "x")))
        val maine = AgendaSection(false, 1, today.plusDays(1), listOf(item("D", "x")))
        assertEquals(3, todayCount(listOf(late, azi, maine)))
        assertEquals(false, showsHead(0, azi))
        assertEquals(true, showsHead(1, azi))
        assertEquals(true, showsHead(0, late))
        assertEquals(true, showsHead(0, maine))
        assertEquals(true, freeToday(listOf(maine)))
        assertEquals(false, freeToday(listOf(late, maine)))
        assertEquals(false, freeToday(emptyList()))
    }

    @Test fun culoareaProiectului_hexScrisDeOm() {
        assertEquals(0xFFF2600C.toInt(), accentArgb("#F2600C"))
        assertEquals(0xFF00AAFF.toInt(), accentArgb("#0af"))
        assertEquals(0x80112233.toInt(), accentArgb("#80112233"))
        assertEquals(null, accentArgb("albastru"))
        assertEquals(null, accentArgb("#12345"))
        assertEquals(null, accentArgb(null))
    }

    @Test fun creareaÎșiIaCuloareaDeLaUnRândAlAceluiașiProiect() {
        val src = AgendaList(listOf(item("A", "2026-10-05T21:00:00.000Z").copy(project = "Casă", projectAccent = "#E5397B")), readAt = 10)
        val c = item("HZ-~1", "2026-10-05T21:00:00.000Z").copy(project = "Casă")
        val alt = item("HZ-~2", "2026-10-05T21:00:00.000Z").copy(project = "Altul")
        val got = visibleAgenda(src, null, emptyList(), creates = listOf(c, alt))!!.associate { it.id to it.projectAccent }
        assertEquals(mapOf("A" to "#E5397B", "HZ-~1" to "#E5397B", "HZ-~2" to null), got)
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
        // Fereastra ȘI fixatele (cu sau fără scadență), într-un singur `and`; fixatele întâi, ca plafonul să nu le taie.
        assertTrue(q, java.net.URLDecoder.decode(q, "UTF-8").contains("and=(or(due_at.lt.\"2026-10-12T21:00:00.000Z\",pinned_at.not.is.null))"))
        assertTrue(q, q.contains("pinned_at,"))
        assertTrue(q, q.contains("order=pinned_at.desc.nullslast,due_at.asc"))
        assertTrue(q, q.contains("limit=$AGENDA_LIMIT"))
        assertTrue(q, !q.contains("due_at=gte"))
    }

    @Test fun parsareaSareRândurileStricate() {
        val json = """[
          {"id":"HZ-1","title":"Raport","due_at":"2026-10-06T07:00:00+00:00","all_day":false,"remind_at":"2026-10-06T06:50:00+00:00","rrule":null,"urgent":true,"projects":{"name":"Daily","accent":"#2F6BFF"}},
          {"id":null,"title":"x","due_at":"2026-10-06T07:00:00+00:00"},
          {"id":"HZ-2","title":null,"due_at":null},
          {"id":"HZ-3","title":null,"due_at":"2026-10-06T07:00:00+00:00","all_day":true,"remind_at":null,"rrule":"FREQ=DAILY","urgent":null,"projects":null}
        ]"""
        assertEquals(listOf(
            AgendaItem("HZ-1", "Raport", "Daily", "2026-10-06T07:00:00.000Z", false, true, false, true, projectAccent = "#2F6BFF"),
            AgendaItem("HZ-3", "Sarcină fără titlu", null, "2026-10-06T07:00:00.000Z", true, false, true, false),
        ), parseAgenda(json))
    }

    @Test fun jsonDusÎntors() {
        val l = AgendaList(listOf(
            AgendaItem("HZ-1", "R", null, "2026-10-06T07:00:00.000Z", false, true, true, false),
            AgendaItem("R-1", "Vase", "Rutine", "2026-10-06T07:00:00.000Z", false, true, true, false, hiddenUntil = parseIso("2026-10-06T06:50:00.000Z"), projectAccent = "#0E9F8E"),
        ), 42)
        assertEquals(l, Json.agendaFromJson(Json.agendaToJson(l)))
    }

    @Test fun gataScosDinCoadă_rămâneAscunsPânăLaOAgendăCitităDupăTrimitere() {
        // Lista de mementouri a prunat „Gata", dar citirea agendei a picat: agenda e de dinainte.
        val sent = done("A", drainedAt = 50)
        val held = holdDone(before = listOf(sent), after = emptyList(), held = emptyMap(), agendaReadAt = 20)
        assertEquals(mapOf("A" to 50L), held)
        val stale = AgendaList(listOf(item("A", "2026-10-05T21:00:00.000Z"), item("B", "2026-10-05T21:00:00.000Z")), readAt = 20)
        assertEquals(listOf("B"), visibleAgenda(null, stale, emptyList(), held)!!.map { it.id })
        // O agendă citită după trimitere îl arată din nou (recurentă: la data nouă) și eliberează reținerea.
        val fresh = stale.copy(readAt = 60)
        assertEquals(listOf("A", "B"), visibleAgenda(null, fresh, emptyList(), held)!!.map { it.id })
        assertEquals(emptyMap<String, Long>(), holdDone(emptyList(), emptyList(), held, agendaReadAt = 60))
    }

    @Test fun rutinaDinCitireaNativă_ascunsăPânăLaMemento_altfelPânăLaScadență() {
        val json = """[
          {"id":"R-1","title":"Vase","due_at":"2026-10-06T18:00:00+00:00","all_day":false,"remind_at":"2026-10-06T17:50:00+00:00","rrule":"FREQ=DAILY","urgent":false,"projects":{"name":"Rutine","reminders_only":true}},
          {"id":"R-2","title":"Prânz","due_at":"2026-10-06T21:00:00+00:00","all_day":true,"remind_at":null,"rrule":null,"urgent":false,"projects":{"name":"Rutine","reminders_only":true}},
          {"id":"HZ-1","title":"Raport","due_at":"2026-10-06T18:00:00+00:00","all_day":false,"remind_at":"2026-10-06T17:50:00+00:00","rrule":null,"urgent":false,"projects":{"name":"Daily","reminders_only":false}}
        ]"""
        val got = parseAgenda(json).associate { it.id to it.hiddenUntil }
        assertEquals(mapOf("R-1" to parseIso("2026-10-06T17:50:00.000Z"), "R-2" to parseIso("2026-10-06T21:00:00.000Z"), "HZ-1" to null), got)
        assertTrue(agendaQuery(now, zone).contains("projects(name,accent,reminders_only)"))
    }

    @Test fun următoareaRedesenare_ePrimaRutinăCareIeseDinAscunzătoare() {
        val a = item("A", "2026-10-06T18:00:00.000Z").copy(hiddenUntil = parseIso("2026-10-06T17:00:00.000Z"))
        val b = item("B", "2026-10-06T18:00:00.000Z").copy(hiddenUntil = parseIso("2026-10-06T09:00:00.000Z"))
        val c = item("C", "2026-10-06T18:00:00.000Z").copy(hiddenUntil = parseIso("2026-10-06T07:00:00.000Z"))   // deja vizibilă
        assertEquals(parseIso("2026-10-06T09:00:00.000Z"), nextReveal(listOf(a, b, c, item("D", "2026-10-06T18:00:00.000Z")), now))
        assertEquals(null, nextReveal(listOf(c), now))
    }

    @Test fun agendaNativăAratăDoarCeEAlMeu_inclusivRutinele() {
        val json = """[
          {"id":"R-1","title":"Vase","due_at":"2026-10-06T18:00:00+00:00","all_day":false,"remind_at":"2026-10-06T17:50:00+00:00","assignee_id":null,"created_by":"u-me","projects":{"name":"Rutine","reminders_only":true}},
          {"id":"HZ-1","title":"Al lui","due_at":"2026-10-06T18:00:00+00:00","all_day":false,"assignee_id":null,"created_by":"u-other","projects":{"name":"Daily"}},
          {"id":"HZ-2","title":"Pasat mie","due_at":"2026-10-06T18:00:00+00:00","all_day":false,"assignee_id":"a-me","created_by":"u-other","projects":{"name":"Daily"}}
        ]"""
        val me = Me("a-me", "u-me")
        assertEquals(mapOf("R-1" to parseIso("2026-10-06T17:50:00.000Z"), "HZ-2" to null), parseAgenda(json, me).associate { it.id to it.hiddenUntil })
        assertEquals(3, parseAgenda(json).size)
        val q = agendaQuery(now, zone, me)
        // „Ale mele" stă în același `and` cu fereastra (nu a doua cheie `or=`), deci se aplică și fixatelor.
        assertTrue(q, q.contains("assignee_id,created_by") && !q.contains("&or="))
        assertTrue(q, java.net.URLDecoder.decode(q, "UTF-8").contains(
            "and=(or(due_at.lt.\"2026-10-12T21:00:00.000Z\",pinned_at.not.is.null),or(assignee_id.eq.a-me,and(assignee_id.is.null,or(created_by.eq.u-me,created_by.is.null))))"))
    }

    private fun pin(id: String, at: String, dueAt: String? = null, allDay: Boolean = true) =
        AgendaItem(id, id, null, dueAt, allDay, false, false, false, pinnedAt = at)

    @Test fun fixatele_primulGrup_cuCapȘiNumărate_nuȘiÎnZiuaLor() {
        val sections = buildAgenda(listOf(
            item("A", "2026-10-05T21:00:00.000Z"),                                       // azi
            pin("P1", "2026-10-06T07:00:00.000Z"),                                       // fără scadență
            pin("P2", "2026-10-06T07:30:00.000Z", "2026-10-07T07:00:00.000Z", false),    // mâine: NU și în „Mâine"
        ), now, zone)
        assertEquals(listOf(true, false), sections.map { it.pinned })
        assertEquals(listOf("P2", "P1"), sections[0].items.map { it.id })                // cel fixat cel mai recent primul
        assertEquals(SectionHead("Fixate", null), sectionHead(sections[0]))
        assertTrue(showsHead(0, sections[0]))
        assertTrue(showsHead(1, sections[1]))                                             // „Azi" după „Fixate" are cap
        assertEquals(3, todayCount(sections))
        assertEquals(false, freeToday(sections))                                          // o fixată ține ziua ocupată
    }

    @Test fun fixata_bateRutinaAdormită() {
        val r = item("R", "2026-10-06T18:00:00.000Z").copy(hiddenUntil = parseIso("2026-10-06T17:00:00.000Z"), pinnedAt = "2026-10-06T07:00:00.000Z")
        assertEquals(listOf("R"), buildAgenda(listOf(r), now, zone).single { it.pinned }.items.map { it.id })
        assertEquals(null, nextReveal(listOf(r), now))
    }

    @Test fun rândulFixat_îșiSpuneZiua() {
        assertEquals("Mâine 10:00", rowMeta(pin("P", "x", "2026-10-07T07:00:00.000Z", allDay = false), false, now, zone, pinned = true))
        assertEquals("Ieri", rowMeta(pin("P", "x", "2026-10-04T21:00:00.000Z"), true, now, zone, pinned = true))
        assertEquals("", rowMeta(pin("P", "x"), false, now, zone, pinned = true))
        assertTrue(isOverdueItem(pin("P", "x", "2026-10-04T21:00:00.000Z"), now, zone))
        assertEquals(false, isOverdueItem(pin("P", "x"), now, zone))
    }

    @Test fun parsareaȘiPuntea_fixataFărăScadență() {
        val json = """[
          {"id":"P-1","title":"Credențiale ANAF","due_at":null,"pinned_at":"2026-10-06T07:00:00+00:00","all_day":true,"projects":{"name":"Rutine","reminders_only":true}},
          {"id":"HZ-9","title":"Fără nimic","due_at":null,"pinned_at":null}
        ]"""
        val got = parseAgenda(json)
        assertEquals(listOf(AgendaItem("P-1", "Credențiale ANAF", "Rutine", null, true, false, false, false, null, null, "2026-10-06T07:00:00.000Z")), got)
        assertEquals(got[0], Json.agendaItemFromJson(Json.agendaItemToJson(got[0])))
        // Pe punte, un rând fără scadență și nefixat n-are unde sta.
        assertEquals(null, Json.agendaItemFromJson(org.json.JSONObject("""{"id":"X","title":"x","dueAt":null}""")))
    }
}
