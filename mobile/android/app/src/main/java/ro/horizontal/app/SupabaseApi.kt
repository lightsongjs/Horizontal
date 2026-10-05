package ro.horizontal.app

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Sesiunea e acum a altui cont decât cel pentru care s-a pregătit cererea. */
class AccountChanged : Exception()

object SupabaseApi {
    data class Response(val status: Int, val body: String)

    // OkHttp, nu HttpURLConnection: acela refuză verbul PATCH, iar PostgREST
    // nu acceptă X-HTTP-Method-Override.
    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
    private val JSON = "application/json".toMediaType()
    /** Pentru poarta din alarmă: un receiver are ~10 s, iar un răspuns întârziat valorează cât unul lipsă. */
    private val quick = http.newBuilder().callTimeout(4, TimeUnit.SECONDS).build()

    /** Excepția de rețea urcă (IOException): cine cheamă decide dacă reîncearcă. */
    fun raw(method: String, url: String, headers: Map<String, String>, body: String?, fast: Boolean = false): Response {
        val b = Request.Builder().url(url)
        headers.forEach { (k, v) -> b.header(k, v) }
        b.method(method, body?.toRequestBody(JSON) ?: if (method == "GET") null else "".toRequestBody(JSON))
        (if (fast) quick else http).newCall(b.build()).execute().use { r -> return Response(r.code, r.body?.string() ?: "") }
    }

    /**
     * Cerere REST cu sesiunea nativă. `null` = sesiune moartă.
     *
     * `pathAndQuery` vine DEJA codat (`PatchRequest.query` din core trece prin
     * URLEncoder). De-aia URL-ul se lipește ca string și intră prin
     * `Request.Builder().url(String)`: OkHttp păstrează secvențele %XX valide
     * cum sunt. Un `HttpUrl.Builder().addQueryParameter` le-ar coda a doua oară
     * (`%3A` → `%253A`) și filtrul n-ar mai prinde rândul. Proba: `SupabaseUrlTest`.
     */
    fun rest(ctx: Context, method: String, pathAndQuery: String, body: String? = null, prefer: String? = null, asUser: String? = null, fast: Boolean = false): Response? {
        val (url, anon) = NativeSession.config(ctx) ?: return null
        val (token, user) = NativeSession.session(ctx) ?: return null
        // Cererea e a contului `asUser`; dacă între timp s-a logat altcineva, nu pleacă deloc.
        if (asUser != null && user != asUser) throw AccountChanged()
        val h = mutableMapOf("apikey" to anon, "Authorization" to "Bearer $token")
        prefer?.let { h["Prefer"] = it }
        return raw(method, "$url/rest/v1/$pathAndQuery", h, body, fast)
    }
}
