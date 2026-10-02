package ro.horizontal.app.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TimeTest {
    // Cheia trebuie să fie identică octet cu octet cu cea din pagină
    // (`toISOString()`), altfel același memento venit pe două căi sună de două ori.
    @Test fun isoJsAreMilisecundeSiZ() {
        assertEquals("2026-10-02T06:00:00.000Z", isoJs(parseIso("2026-10-02T09:00:00+03:00")!!))
        assertEquals("2026-10-02T06:00:00.123Z", isoJs(parseIso("2026-10-02T06:00:00.123Z")!!))
    }
    @Test fun parseIsoAcceptaFormaPostgres() {
        assertEquals(parseIso("2026-10-02T09:30:00.000Z"), parseIso("2026-10-02T09:30:00+00:00"))
        assertEquals(parseIso("2026-10-02T09:30:00.123Z"), parseIso("2026-10-02T09:30:00.123456+00:00"))
    }
    @Test fun parseIsoInvalidDaNull() { assertNull(parseIso("nu-i dată")); assertNull(parseIso(null)) }
    @Test fun cheia() { assertEquals("HZ-1@2026-10-02T06:00:00.000Z", reminderKey("HZ-1", parseIso("2026-10-02T06:00:00Z")!!)) }

    @Test fun reminderDusIntors() {
        val at = parseIso("2026-10-02T06:00:00.123Z")!!
        val r = Reminder(reminderKey("HZ-1", at), "HZ-1", at, "t", "b", "2026-10-02T07:00:00.000Z", true)
        assertEquals(r, Json.reminderFromJson(Json.reminderToJson(r)))
    }
    @Test fun actiuneDusaIntorsa() {
        val a = NativeAction("u", NativeAction.Kind.UNTIL, "HZ-1", remindAt = 5, dueAt = "d", prevDueAt = "p",
            title = "t", body = "b", allDay = true, createdAt = 7, drainedAt = 9, inFlight = true)
        assertEquals(a, Json.actionFromJson(Json.actionToJson(a)))
        val min = NativeAction("u", NativeAction.Kind.DONE, "HZ-1", title = "t", body = "b", createdAt = 7)
        assertEquals(min, Json.actionFromJson(Json.actionToJson(min)))
    }
    @Test fun cheiaGresitaDeLaSursaEIgnorata() {
        val o = JSONObject("""{"key":"x","id":"HZ-1","at":"2026-10-02T06:00:00Z","title":"t","body":"b"}""")
        assertEquals("HZ-1@2026-10-02T06:00:00.000Z", Json.reminderFromJson(o)!!.key)
    }
}
