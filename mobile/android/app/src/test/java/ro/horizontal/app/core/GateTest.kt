package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GateTest {
    private val at = parseIso("2026-10-05T09:30:00Z")!!
    private val r = Reminder(reminderKey("HZ-1", at), "HZ-1", at, "t", "b", null, false)

    @Test fun amanaDoarLaUnDaSigurSiInAfaraDoze() {
        assertTrue(shouldDefer(true, deviceIdle = false))
        assertFalse(shouldDefer(false, deviceIdle = false))
        assertFalse(shouldDefer(null, deviceIdle = false))   // eroare: sună la minut
        assertFalse(shouldDefer(true, deviceIdle = true))    // Doze: reverificarea ar întârzia
    }
    @Test fun raspunsulRpc() {
        assertEquals(true, parseDesktopActive("true"))
        assertEquals(false, parseDesktopActive(" false\n"))
        assertEquals(null, parseDesktopActive("""{"message":"x"}"""))
    }
    @Test fun interogareaReverificarii() {
        assertEquals("issues?select=done,remind_at&id=eq.HZ-1", recheckQuery("HZ-1"))
    }
    @Test fun dupaAmanare() {
        val same = ServerState.Row(false, at)
        assertTrue(showAfterDefer(r, same, stillShown = true))
        assertFalse(showAfterDefer(r, ServerState.Row(true, at), true))          // „Gata" pe laptop
        assertFalse(showAfterDefer(r, ServerState.Row(false, at + 900_000), true)) // „15 min" pe laptop
        assertFalse(showAfterDefer(r, ServerState.Row(false, null), true))       // memento scos
        assertFalse(showAfterDefer(r, ServerState.Gone, true))                   // tichet șters
        assertTrue(showAfterDefer(r, null, true))                                // eroare: sună
        assertFalse(showAfterDefer(r, same, stillShown = false))                 // planul l-a retras
    }
    @Test fun citireaReverificarii() {
        assertEquals(ServerState.Row(false, at), parseRecheck("""[{"done":false,"remind_at":"2026-10-05T09:30:00+00:00"}]"""))
        assertEquals(ServerState.Row(true, null), parseRecheck("""[{"done":true,"remind_at":null}]"""))
        assertEquals(ServerState.Gone, parseRecheck("[]"))
        assertEquals(null, parseRecheck("""{"code":"PGRST301"}"""))
    }
}
