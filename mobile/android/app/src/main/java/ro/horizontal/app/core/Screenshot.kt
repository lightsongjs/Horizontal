package ro.horizontal.app.core

/** O imagine din galerie, cum o dă MediaStore (`DATE_ADDED` e în secunde; aici e în ms). */
data class ShotCandidate(val id: Long, val addedAt: Long, val relativePath: String?, val bucket: String?, val mime: String?)

/** Cât de proaspătă trebuie să fie captura ca fereastra s-o ofere. */
const val SHOT_WINDOW_MS = 10 * 60_000L

/** HyperOS: `DCIM/Screenshots/`; Pixel: `Pictures/Screenshots/`; unele dau doar folderul (`bucket`). */
fun isScreenshot(c: ShotCandidate): Boolean =
    c.mime?.startsWith("image/") == true &&
        listOfNotNull(c.relativePath, c.bucket).any { it.contains("screenshot", ignoreCase = true) }

/**
 * Captura de oferit în fereastra de quick add, sau null. Doar CEA MAI NOUĂ captură
 * contează: dacă ea a fost deja tratată (`seenId` — atașată, sau sarcina a plecat
 * fără ea), nu se cade pe una mai veche. O captură se oferă o singură dată.
 */
fun screenshotOffer(candidates: List<ShotCandidate>, now: Long, seenId: Long?): ShotCandidate? {
    val newest = candidates.filter(::isScreenshot).maxByOrNull { it.addedAt } ?: return null
    if (newest.id == seenId) return null
    if (now - newest.addedAt > SHOT_WINDOW_MS) return null
    return newest
}
