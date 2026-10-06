package ro.horizontal.app.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.ZoneId

class CreateTest {
    private val zone = ZoneId.of("Europe/Bucharest")
    private fun create(uid: String = "u1", title: String = "Raport", dueAt: String? = "2026-10-06T07:00:00.000Z", remindAt: String? = dueAt) =
        NativeCreate(uid = uid, tempId = "HZ-~$uid", projectId = "p", projectName = "✅Daily", title = title, desc = "", dueAt = dueAt, allDay = false,
            remindAt = remindAt, rrule = null, urgent = true, assigneeId = null, createdAt = 10)

    @Test fun nextIssueId_fixturesComuneCuPagina() {
        val all = JSONArray(File(System.getProperty("hz.repoRoot"), "src/lib/issueId.fixtures.json").readText())
        for (i in 0 until all.length()) {
            val f = all.getJSONObject(i); val ex = f.getJSONArray("existing")
            assertEquals(f.getString("name"), f.getString("want"), nextIssueId((0 until ex.length()).map { ex.getString(it) }, f.getString("prefix")))
        }
    }

    @Test fun corpulInsertului_caPagina_fărăCreatedBy() {
        val b = insertBody(create().copy(desc = "detalii", assigneeId = "a"), "HZ-07", 3)
        assertEquals("HZ-07", b.getString("id")); assertEquals("p", b.getString("project_id")); assertEquals("detalii", b.getString("details"))
        assertEquals(3, b.getInt("wave")); assertFalse(b.getBoolean("done")); assertTrue(b.isNull("theme"))
        assertEquals(0, b.getJSONArray("selectors").length()); assertEquals(0, b.getJSONArray("scenarios").length())
        assertEquals("a", b.getString("assignee_id")); assertTrue(b.getBoolean("urgent"))
        assertEquals("2026-10-06T07:00:00.000Z", b.getString("due_at")); assertFalse(b.getBoolean("all_day"))
        assertTrue(b.isNull("rrule")); assertFalse(b.has("created_by"))
    }

    @Test fun conflict_alNostru_eGata() {
        val row = JSONObject().put("title", "Raport").put("project_id", "p").put("created_by", "me")
        assertEquals(Conflict.OURS, conflictOf(row, "me", create()))
    }

    @Test fun conflict_alAltcuiva_reîncearcă() {
        assertEquals(Conflict.TAKEN, conflictOf(JSONObject().put("title", "Raport").put("project_id", "p").put("created_by", "alt"), "me", create()))
        assertEquals(Conflict.TAKEN, conflictOf(JSONObject().put("title", "Altul").put("project_id", "p").put("created_by", "me"), "me", create()))
        assertEquals(Conflict.TAKEN, conflictOf(null, "me", create()))
    }

    @Test fun remap_acțiunileȘiCheileTrecPeIdReal() {
        val q = listOf(NativeAction(uid = "a", kind = NativeAction.Kind.DONE, id = "HZ-~u1", title = "", body = "", createdAt = 1),
            NativeAction(uid = "b", kind = NativeAction.Kind.DONE, id = "HZ-03", title = "", body = "", createdAt = 1))
        assertEquals(listOf("HZ-09", "HZ-03"), remapActions(q, "HZ-~u1", "HZ-09").map { it.id })
        assertEquals(setOf("HZ-09@2026-10-06T07:00:00.000Z", "HZ-03@x"), remapFired(setOf("HZ-~u1@2026-10-06T07:00:00.000Z", "HZ-03@x"), "HZ-~u1", "HZ-09"))
        assertEquals(mapOf("HZ-09" to "HZ-09@t", "HZ-03" to "HZ-03@y"), remapShown(mapOf("HZ-~u1" to "HZ-~u1@t", "HZ-03" to "HZ-03@y"), "HZ-~u1", "HZ-09"))
    }

    @Test fun pagina_nuPreiaAcțiunileUneiCreăriNative() {
        val q = listOf(NativeAction(uid = "a", kind = NativeAction.Kind.DONE, id = "HZ-~u1", title = "", body = "", createdAt = 1),
            NativeAction(uid = "b", kind = NativeAction.Kind.DONE, id = "HZ-~pagina", title = "", body = "", createdAt = 1))
        val (taken, _) = NativeQueue.take(q, 5, nativeTemp = setOf("HZ-~u1"))
        assertEquals(listOf("HZ-~pagina"), taken.map { it.id })
    }

    @Test fun agenda_arată_creareaPânăOVedeOAgendăMaiNouă() {
        val pending = create()
        val sent = create(uid = "u2", title = "Trimisă").copy(realId = "HZ-09", drainedAt = 50)
        val agenda = AgendaList(listOf(AgendaItem("HZ-01", "Vechi", null, "2026-10-06T07:00:00.000Z", false, false, false, false)), readAt = 20)
        val extra = createsAsAgenda(listOf(pending, sent), agendaReadAt = 20)
        assertEquals(listOf("HZ-~u1", "HZ-09"), extra.map { it.id })
        assertEquals(listOf("HZ-01", "HZ-~u1", "HZ-09"), visibleAgenda(null, agenda, emptyList(), emptyMap(), extra)!!.map { it.id })
        // Agenda citită după trimitere o conține deja: nu se dublează.
        assertEquals(listOf("HZ-~u1"), createsAsAgenda(listOf(pending, sent), agendaReadAt = 60).map { it.id })
        assertEquals(listOf("HZ-01", "HZ-09"), visibleAgenda(null, AgendaList(listOf(agenda.items[0], agenda.items[0].copy(id = "HZ-09")), 60), emptyList(), emptyMap(),
            createsAsAgenda(listOf(sent), 60))!!.map { it.id })
    }

    @Test fun curățarea_păstreazăCeNuS_aTerminat() {
        val sent = create(uid = "u2").copy(realId = "HZ-09", drainedAt = 50)
        val withFile = sent.copy(uid = "u3", files = listOf(NativeFile("/p", "a.jpg", "image/jpeg", 3, "f1")))
        assertEquals(listOf("u1", "u3"), pruneCreates(listOf(create(), sent, withFile), agendaReadAt = 60).map { it.uid })
    }

    @Test fun mementoulUneiCreăriSunăȘiOffline() {
        val r = createReminders(listOf(create(), create(uid = "u2", remindAt = null)), zone)
        assertEquals(listOf("HZ-~u1@2026-10-06T07:00:00.000Z"), r.map { it.key })
    }

    @Test fun jsonDusÎntors() {
        val c = create().copy(attemptId = "HZ-08", files = listOf(NativeFile("/p", "a.jpg", "image/jpeg", 3, "f1", uploaded = true)), tries = 2)
        assertEquals(c, Json.createFromJson(Json.createToJson(c)))
    }

    @Test fun urcarea_unDuplicatEraDejaAcolo() {
        assertTrue(storageDone(200, "{}"))
        assertTrue(storageDone(409, """{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}"""))
        assertTrue(storageDone(400, """{"statusCode":"409","error":"Duplicate"}"""))
        assertFalse(storageDone(400, """{"error":"Invalid key"}"""))
        assertFalse(storageDone(500, ""))
    }

    @Test fun rândulAtașamentului_caPagina() {
        val f = NativeFile("/c/a.jpg", "tabla.jpg", "image/jpeg", 1234, "f-1")
        val o = attachmentRow(f, "p", "HZ-09")
        assertEquals("f-1", o.getString("id")); assertEquals("HZ-09", o.getString("issue_id")); assertEquals("p", o.getString("project_id"))
        assertEquals("p/HZ-09/f-1", o.getString("path")); assertEquals("tabla.jpg", o.getString("filename"))
        assertEquals(1234, o.getLong("size")); assertEquals("image/jpeg", o.getString("content_type"))
        assertEquals("p/HZ-09/f-1", attachmentPath("p", "HZ-09", "f-1"))
    }

    @Test fun fișierele_seAbandoneazăDupăOOră() {
        val c = create().copy(realId = "HZ-09", drainedAt = 1_000, files = listOf(NativeFile("/p", "a", "x", 1, "f")))
        assertFalse(filesExpired(c, now = 1_000 + 3_599_000))
        assertTrue(filesExpired(c, now = 1_000 + 3_600_001))
    }

    @Test fun doiWorkeri_folosescAcelașiIdSalvat() {
        // Primul a salvat deja X: al doilea, care calculase X+1, trebuie să folosească X.
        val saved = listOf(create().copy(attemptId = "HZ-07"))
        val (after, id) = claimAttempt(saved, "u1", "HZ-08")
        assertEquals("HZ-07", id); assertEquals("HZ-07", after[0].attemptId)
        val (after2, id2) = claimAttempt(listOf(create()), "u1", "HZ-08")
        assertEquals("HZ-08", id2); assertEquals("HZ-08", after2[0].attemptId)
    }

    @Test fun oSarcinăBifatăÎnainteSăPlece_nuMaiSună() {
        val done = listOf(NativeAction(uid = "a", kind = NativeAction.Kind.DONE, id = "HZ-~u1", title = "", body = "", createdAt = 1))
        assertEquals(emptyList<String>(), createReminders(listOf(create()), zone, queue = done).map { it.key })
    }
}
