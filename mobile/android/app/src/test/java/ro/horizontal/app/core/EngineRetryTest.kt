package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineRetryTest {
    @Test fun dublareaPanaLaPlafon() {
        val r = EngineRetry()
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 15_000L, 15_000L), (1..6).map { r.failed(0) })
    }
    @Test fun asteaptaApoiPermite() {
        val r = EngineRetry()
        assertTrue(r.canTry(0))
        r.failed(100)
        assertFalse(r.canTry(1_099))
        assertTrue(r.canTry(1_100))
    }
    @Test fun reusitaStergeIstoricul() {
        val r = EngineRetry()
        r.failed(0); r.failed(0); r.failed(0)
        r.ok()
        assertTrue(r.canTry(0))
        assertEquals(1_000L, r.failed(0))
    }
}
