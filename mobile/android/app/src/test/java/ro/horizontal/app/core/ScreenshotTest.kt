package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScreenshotTest {
    private val now = 1_800_000_000_000L
    private fun shot(id: Long, agoMin: Long, path: String? = "DCIM/Screenshots/", bucket: String? = null, mime: String? = "image/jpeg") =
        ShotCandidate(id, now - agoMin * 60_000, path, bucket, mime)

    @Test fun ceaMaiNouaCapturaProaspata() {
        assertEquals(2L, screenshotOffer(listOf(shot(1, 3), shot(2, 1)), now, null)?.id)
    }
    @Test fun preaVecheNuSeOfera() {
        assertNull(screenshotOffer(listOf(shot(1, 11)), now, null))
        assertEquals(1L, screenshotOffer(listOf(shot(1, 10)), now, null)?.id)
    }
    @Test fun tratataNuSeMaiOferaSiNuCadePeOVeche() {
        assertNull(screenshotOffer(listOf(shot(1, 3), shot(2, 1)), now, seenId = 2))
    }
    @Test fun doarCapturiDeEcran() {
        // O poză din cameră, mai nouă, nu ascunde captura și nu e ea oferta.
        assertEquals(1L, screenshotOffer(listOf(shot(1, 2), shot(2, 1, path = "DCIM/Camera/")), now, null)?.id)
        assertEquals(3L, screenshotOffer(listOf(shot(3, 1, path = null, bucket = "Screenshots")), now, null)?.id)
        assertNull(screenshotOffer(listOf(shot(4, 1, mime = "video/mp4")), now, null))
    }
}
