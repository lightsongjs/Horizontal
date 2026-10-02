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
        assertTrue(q, q.startsWith("issues?select=id,title,due_at,all_day,remind_at,projects(name)"))
        assertTrue(q, "done=is.false" in q)
        // 24 h în urmă, nu 1 h: altfel o notificare neatinsă ar fi retrasă după o oră
        assertTrue(q, "remind_at=gte.2026-10-01T09%3A00%3A00.000Z" in q)
        assertTrue(q, "remind_at=lte.2026-10-09T09%3A00%3A00.000Z" in q)
        assertTrue(q, "order=remind_at.asc" in q && "limit=100" in q)
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
