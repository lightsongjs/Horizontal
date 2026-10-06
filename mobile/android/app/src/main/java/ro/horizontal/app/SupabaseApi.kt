package ro.horizontal.app

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
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

    /**
     * URL-uri semnate pentru atașamente (o oră), într-o singură cerere. Întoarce
     * cale → URL absolut; `null` = fără sesiune. Storage dă URL-ul relativ la `/storage/v1`.
     */
    fun signStorage(ctx: Context, paths: List<String>, asUser: String): Map<String, String>? {
        val (url, anon) = NativeSession.config(ctx) ?: return null
        val (token, user) = NativeSession.session(ctx) ?: return null
        if (user != asUser) throw AccountChanged()
        val body = org.json.JSONObject().put("expiresIn", 3600).put("paths", org.json.JSONArray(paths)).toString()
        val r = raw("POST", "$url/storage/v1/object/sign/attachments", mapOf("apikey" to anon, "Authorization" to "Bearer $token"), body)
        if (r.status !in 200..299) return emptyMap()
        val a = org.json.JSONArray(r.body)
        return (0 until a.length()).mapNotNull { i -> a.getJSONObject(i).let { o ->
            val p = o.optString("path"); val u = o.optString("signedURL")
            if (p.isEmpty() || u.isEmpty() || o.has("error") && !o.isNull("error")) null else p to "$url/storage/v1$u"
        } }.toMap()
    }

    /** Descarcă un URL (semnat) într-un fișier. Excepția de rețea urcă. */
    fun download(url: String, out: java.io.File): Boolean {
        http.newCall(Request.Builder().url(url).build()).execute().use { r ->
            if (!r.isSuccessful) return false
            val tmp = java.io.File(out.path + ".part")
            r.body!!.byteStream().use { i -> tmp.outputStream().use { o -> i.copyTo(o) } }
            return tmp.renameTo(out)
        }
    }

    /**
     * Urcă un fișier în Storage (`attachments/<cale>`), cu sesiunea nativă. Fără
     * upsert: obiectele sunt imuabile, iar un „Duplicate" la o retrimitere e succes
     * (`storageDone`). Cache de un an, ca în pagină (`uploadAttachment`).
     */
    fun storage(ctx: Context, objectPath: String, file: java.io.File, contentType: String, asUser: String): Response? {
        val (url, anon) = NativeSession.config(ctx) ?: return null
        val (token, user) = NativeSession.session(ctx) ?: return null
        if (user != asUser) throw AccountChanged()
        val req = Request.Builder().url("$url/storage/v1/object/attachments/$objectPath")
            .header("apikey", anon).header("Authorization", "Bearer $token")
            .header("cache-control", "max-age=31536000").header("x-upsert", "false")
            .post(file.asRequestBody(contentType.toMediaType())).build()
        http.newBuilder().writeTimeout(120, TimeUnit.SECONDS).build().newCall(req).execute().use { r -> return Response(r.code, r.body?.string() ?: "") }
    }
}
