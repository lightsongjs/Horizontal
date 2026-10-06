package ro.horizontal.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import org.json.JSONObject
import ro.horizontal.app.core.Draft
import ro.horizontal.app.core.parseEngineResult
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Codul de captură al paginii (`src/capture/engine.ts`, împachetat în
 * `assets/capture-engine.js`), rulat în motorul JS al sistemului — fără WebView.
 * Proba pe Redmi: conectarea ~110 ms o dată, apoi 2–6 ms pe apel.
 *
 * Nu aruncă și nu blochează firul principal: orice eșec (motor nesuportat,
 * proces mort, depășire) întoarce `null`, iar fereastra trece pe modul brut.
 * Pornit de fereastră (`warm` în `onCreate`), oprit la închiderea ei — nu în
 * `Application`: fiecare receiver și worker ar fi pornit altfel un proces.
 */
object CaptureEngine {
    private const val READY_MS = 1500L
    private const val CALL_MS = 500L
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var sandbox: JavaScriptSandbox? = null
    @Volatile private var isolate: JavaScriptIsolate? = null
    @Volatile private var failed = false

    fun warm(ctx: Context) {
        val app = ctx.applicationContext
        worker.execute { try { ensure(app) } catch (e: Exception) { fail(e) } }
    }

    private fun ensure(ctx: Context): JavaScriptIsolate? {
        if (failed) return null
        isolate?.let { return it }
        if (!JavaScriptSandbox.isSupported()) { failed = true; return null }
        val sb = JavaScriptSandbox.createConnectedInstanceAsync(ctx).get(READY_MS, TimeUnit.MILLISECONDS)
        val iso = sb.createIsolate()
        iso.evaluateJavaScriptAsync(ctx.assets.open("capture-engine.js").bufferedReader().use { it.readText() }).get(READY_MS, TimeUnit.MILLISECONDS)
        sandbox = sb; isolate = iso
        return iso
    }

    private fun fail(e: Exception) {
        Log.w("hz-capture", "motorul de captură indisponibil", e)
        // Rămâne `failed` până la închiderea ferestrei: altfel fiecare tastă ar
        // reîncerca o conectare (până la 1,5 s), iar apelurile s-ar strânge la coadă.
        failed = true
        try { isolate?.close() } catch (_: Exception) {}
        try { sandbox?.close() } catch (_: Exception) {}
        isolate = null; sandbox = null
    }

    /** `cb` pe firul principal: draftul, sau `null` → mod brut. */
    fun compute(ctx: Context, input: JSONObject, cb: (Draft?) -> Unit) = call(ctx, "HzCapture.captureDraft(${JSONObject.quote(input.toString())})", { parseEngineResult(it) }, cb)

    /** `shrinkPlan` din `src/lib/shrinkImage.ts`, ca JSON. */
    fun shrinkPlan(ctx: Context, input: JSONObject, cb: (JSONObject?) -> Unit) = call(ctx, "HzCapture.shrinkPlan(${JSONObject.quote(input.toString())})", { JSONObject(it) }, cb)

    /** Lista de la `#` / `@` sub cursor (`tokenSuggest.ts`). Gol = nicio listă. */
    fun suggest(ctx: Context, input: JSONObject, cb: (List<ro.horizontal.app.core.CaptureSuggestion>?) -> Unit) =
        call(ctx, "HzCapture.suggest(${JSONObject.quote(input.toString())})", { ro.horizontal.app.core.parseSuggestions(it) }, cb)

    fun attachmentFilename(ctx: Context, name: String, outputType: String?, cb: (String?) -> Unit) =
        call(ctx, "HzCapture.attachmentFilename(${JSONObject.quote(name)}, ${outputType?.let { JSONObject.quote(it) } ?: "null"})", { it }, cb)

    private fun <T> call(ctx: Context, code: String, parse: (String) -> T, cb: (T?) -> Unit) {
        val app = ctx.applicationContext
        worker.execute {
            val out = try {
                ensure(app)?.evaluateJavaScriptAsync(code)?.get(CALL_MS, TimeUnit.MILLISECONDS)?.let(parse)
            } catch (e: Exception) { fail(e); null }
            main.post { cb(out) }
        }
    }

    /** La închiderea ferestrei. Următoarea deschidere reconectează (și reîncearcă după un eșec). */
    fun close() {
        worker.execute {
            try { isolate?.close() } catch (_: Exception) {}
            try { sandbox?.close() } catch (_: Exception) {}
            isolate = null; sandbox = null; failed = false
        }
    }
}
