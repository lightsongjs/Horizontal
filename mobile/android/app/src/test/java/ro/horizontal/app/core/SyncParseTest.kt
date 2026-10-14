package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

class SyncParseTest {
    private val zone = ZoneId.of("Europe/Bucharest")
    private val now = parseIso("2026-10-02T09:00:00Z")!!

    @Test fun interogarea() {
        val q = syncQuery(now)
        assertTrue(q, q.startsWith("issues?select=id,title,due_at,all_day,remind_at,assignee_id,created_by,projects(name)"))
        assertTrue(q, "done=is.false" in q)
        // 24 h în urmă, nu 1 h: altfel o notificare neatinsă ar fi retrasă după o oră
        assertTrue(q, "remind_at=gte.2026-10-01T09%3A00%3A00.000Z" in q)
        assertTrue(q, "remind_at=lte.2026-10-09T09%3A00%3A00.000Z" in q)
        assertTrue(q, "order=remind_at.asc" in q && "limit=100" in q)
        assertTrue(q, "or=" !in q)   // fără identitate nu se taie nimic
    }
    @Test fun interogareaTaieLaServerDoarCuIdentitate() {
        val q = syncQuery(now, Me("a-me", "u-me"))
        assertTrue(q, "&or=%28assignee_id.eq.a-me%2Cand%28assignee_id.is.null%2Cor%28created_by.eq.u-me%2Ccreated_by.is.null%29%29%29&" in q)
        assertEquals(syncQuery(now), syncQuery(now, Me(null, "u-me")))
    }
    @Test fun parsareaSareCeNuEAlMeu() {
        val json = """[{"id":"HZ-1","title":"a","due_at":null,"all_day":true,"remind_at":"2026-10-02T09:20:00Z","assignee_id":"a-other","created_by":"u-me"},
                       {"id":"HZ-2","title":"b","due_at":null,"all_day":true,"remind_at":"2026-10-02T09:20:00Z","assignee_id":null,"created_by":"u-me"},
                       {"id":"HZ-3","title":"c","due_at":null,"all_day":true,"remind_at":"2026-10-02T09:20:00Z","assignee_id":null,"created_by":"u-other"},
                       {"id":"HZ-4","title":"d","due_at":null,"all_day":true,"remind_at":"2026-10-02T09:20:00Z","assignee_id":"a-me","created_by":"u-other"},
                       {"id":"HZ-5","title":"e","due_at":null,"all_day":true,"remind_at":"2026-10-02T09:20:00Z"}]"""
        assertEquals(listOf("HZ-2", "HZ-4", "HZ-5"), parseIssues(json, zone, Me("a-me", "u-me")).map { it.id })
        assertEquals(5, parseIssues(json, zone).size)   // cont nelegat: tot
    }
    @Test fun randulMeuDinAssignees() {
        assertEquals("assignees?select=id&user_id=eq.u-me&limit=1", meQuery("u-me"))
        assertEquals("a-1", parseMe("""[{"id":"a-1"}]"""))
        assertEquals(null, parseMe("[]"))
    }
    @Test fun randurileDevinMementouriCuTextulDinPort() {
        val json = """[{"id":"HZ-8","title":"Sună","due_at":"2026-10-02T09:30:00+00:00","all_day":false,"remind_at":"2026-10-02T09:20:00+00:00","projects":{"name":"Daily"}},
                       {"id":"HZ-9","title":"x","due_at":null,"all_day":true,"remind_at":"nu","projects":null}]"""
        val list = parseIssues(json, zone)
        assertEquals(1, list.size)   // rândul cu remind_at invalid e sărit, nu aruncă
        val r = list.single()
        assertEquals(reminderKey("HZ-8", parseIso("2026-10-02T09:20:00Z")!!), r.key)
        assertEquals("12:30 · Daily", r.body)
        assertEquals("2026-10-02T09:30:00+00:00", r.dueAt)
    }
}
