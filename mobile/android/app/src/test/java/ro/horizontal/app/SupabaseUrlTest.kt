package ro.horizontal.app

import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `PatchRequest.query` iese din core deja codat (URLEncoder). `SupabaseApi.rest`
 * construiește URL-ul ca string și-l dă lui `Request.Builder().url(String)`;
 * proba că OkHttp păstrează %XX așa cum sunt, fără să le codeze a doua oară
 * (`%3A` → `%253A` ar face filtrul `due_at=eq.` să nu mai găsească rândul).
 */
class SupabaseUrlTest {
    @Test fun okHttpNuRecodeazaQueryul() {
        val q = "id=eq.A%26B&due_at=eq.2026-10-02T09%3A00%3A00.000Z&title=eq.a+b%2Bc"
        val url = Request.Builder().url("https://x.supabase.co/rest/v1/issues?$q").build().url
        assertEquals("https://x.supabase.co/rest/v1/issues?$q", url.toString())
        assertEquals("A&B", url.queryParameter("id")!!.removePrefix("eq."))
    }
}
