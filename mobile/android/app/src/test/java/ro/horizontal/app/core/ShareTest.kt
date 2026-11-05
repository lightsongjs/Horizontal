package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShareTest {
    @Test fun youtube_doarLinkul() =
        assertEquals("https://youtu.be/abc?si=x", sharedTitle("", "https://youtu.be/abc?si=x", null))

    @Test fun subiectulInainteaLinkului() =
        assertEquals("Titlu articol https://ex.ro/a", sharedTitle("", "https://ex.ro/a", "Titlu articol"))

    @Test fun subiectulDejaInText_nuSeDubleaza() =
        assertEquals("Titlu articol https://ex.ro/a", sharedTitle("", "Titlu articol https://ex.ro/a", "Titlu articol"))

    @Test fun randurileDevinSpatii() =
        assertEquals("Titlu https://ex.ro", sharedTitle("", "Titlu\nhttps://ex.ro", null))

    @Test fun ciornaRamaneInFata() =
        assertEquals("de văzut https://youtu.be/abc", sharedTitle("de văzut ", "https://youtu.be/abc", null))

    @Test fun nimicDeLuat() = assertNull(sharedTitle("ceva", "  ", null))
}
