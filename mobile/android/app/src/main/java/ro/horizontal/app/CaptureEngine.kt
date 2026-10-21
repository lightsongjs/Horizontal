package ro.horizontal.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import org.json.JSONObject
import ro.horizontal.app.core.Draft
import ro.horizontal.app.core.EngineRetry
import ro.horizontal.app.core.parseEngineResult
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Codul de captură al paginii (`src/capture/engine.ts`, împachetat în
 * `assets/capture-engine.js`), rulat în motorul JS al sistemului — fără WebView.
 * Proba pe Redmi: conectarea ~110 ms o dată, apoi 2–6 ms pe apel.
 *
 * Nu aruncă și nu blochează firul principal: cât motorul nu e gata, un apel
 * întoarce `null` și fereastra desenează draftul brut. Pornit de fereastră
 * (`warm` în `onCreate`), oprit la închiderea ei — nu în `Application`:
 * fiecare receiver și worker ar fi pornit altfel un proces.
 *
 * D-227: pornirea are firul ei (`setup`) și un prag larg, deci apelurile nu
 * stau la coadă în spatele ei; un eșec (pornire peste prag, proces mort) nu
 * mai ține fereastra pe modul brut până la închidere — se reîncearcă după
 * `EngineRetry`, iar la reușită fereastra e anunțată (`onReady`) și recalculează.
 */
object CaptureEngine {
    // Conectarea e rapidă la cald (~110 ms), dar o pornire rece a procesului
    // sandbox după Doze poate trece de câteva secunde. Nu blochează nimic.
    private const val CONNECT_MS = 10_000L
    private const val CALL_MS = 500L
    private val worker = Executors.newSingleThreadExecutor()
    private val setup = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val retry = EngineRetry()
    @Volatile private var sandbox: JavaScriptSandbox? = null
    @Volatile private var isolate: JavaScriptIsolate? = null
    @Volatile private var starting = false
    @Volatile private var unsupported = false
    @Volatile private var ready = CompletableFuture<JavaScriptIsolate?>()
    @Volatile private var onReady: (() -> Unit)? = null
    // O închidere urmată repede de o deschidere: `close` e pus pe `setup`, iar
    // fără generație ar fi închis motorul abia pornit pentru fereastra nouă.
    @Volatile private var gen = 0

    /**
     * Motorul chiar lipsește (nesuportat, sau între două reîncercări după un eșec),
     * nu doar pornește. Numai atunci fereastra spune că recunoașterea datei e indisponibilă.
     */
    val down: Boolean get() = unsupported || (isolate == null && !starting)

    fun warm(ctx: Context, ready: () -> Unit) {
        gen++
        onReady = ready
        start(ctx.applicationContext)
    }

    @Synchronized private fun start(app: Context) {
        if (isolate != null || starting || unsupported || onReady == null) return
        if (!retry.canTry(System.currentTimeMillis())) return
        starting = true
        val attempt = CompletableFuture<JavaScriptIsolate?>()
        ready = attempt
        setup.execute { connect(app, attempt) }
    }

    private fun connect(app: Context, attempt: CompletableFuture<JavaScriptIsolate?>) {
        var sb: JavaScriptSandbox? = null
        try {
            if (!JavaScriptSandbox.isSupported()) {
                unsupported = true; starting = false; attempt.complete(null); return
            }
            val pending = JavaScriptSandbox.createConnectedInstanceAsync(app)
            sb = try { pending.get(CONNECT_MS, TimeUnit.MILLISECONDS) } catch (e: TimeoutException) { pending.cancel(true); throw e }
            val iso = sb.createIsolate()
            iso.evaluateJavaScriptAsync(app.assets.open("capture-engine.js").bufferedReader().use { it.readText() }).get(CONNECT_MS, TimeUnit.MILLISECONDS)
            synchronized(this) { sandbox = sb; isolate = iso; starting = false; retry.ok() }
            attempt.complete(iso)
            main.post { onReady?.invoke() }
        } catch (e: Exception) {
            Log.w("hz-capture", "motorul de captură nu a pornit", e)
            try { sb?.close() } catch (_: Exception) {}
            val wait = synchronized(this) { starting = false; retry.failed(System.currentTimeMillis()) }
            attempt.complete(null)
            // `down` e acum adevărat: fereastra își arată nota, apoi reîncercăm.
            main.post { onReady?.invoke() }
            main.postDelayed({ start(app) }, wait + 50)
        }
    }

    /** Un apel a găsit motorul mort (proces ucis, izolat închis): îl repornim după `EngineRetry`. */
    private fun broken(app: Context, e: Exception) {
        Log.w("hz-capture", "motorul de captură a căzut", e)
        val wait = synchronized(this) {
            try { isolate?.close() } catch (_: Exception) {}
            try { sandbox?.close() } catch (_: Exception) {}
            isolate = null; sandbox = null
            retry.failed(System.currentTimeMillis())
        }
        main.postDelayed({ start(app) }, wait + 50)
    }

    /** `cb` pe firul principal: draftul, sau `null` → mod brut. `waitMs`: cât așteaptă o pornire în curs (trimiterea). */
    fun compute(ctx: Context, input: JSONObject, waitMs: Long = 0, cb: (Draft?) -> Unit) =
        call(ctx, "HzCapture.captureDraft(${JSONObject.quote(input.toString())})", { parseEngineResult(it) }, cb, waitMs)

    /** `shrinkPlan` din `src/lib/shrinkImage.ts`, ca JSON. */
    fun shrinkPlan(ctx: Context, input: JSONObject, cb: (JSONObject?) -> Unit) = call(ctx, "HzCapture.shrinkPlan(${JSONObject.quote(input.toString())})", { JSONObject(it) }, cb)

    /** Lista de la `#` / `@` sub cursor (`tokenSuggest.ts`). Gol = nicio listă. */
    fun suggest(ctx: Context, input: JSONObject, cb: (List<ro.horizontal.app.core.CaptureSuggestion>?) -> Unit) =
        call(ctx, "HzCapture.suggest(${JSONObject.quote(input.toString())})", { ro.horizontal.app.core.parseSuggestions(it) }, cb)

    fun attachmentFilename(ctx: Context, name: String, outputType: String?, cb: (String?) -> Unit) =
        call(ctx, "HzCapture.attachmentFilename(${JSONObject.quote(name)}, ${outputType?.let { JSONObject.quote(it) } ?: "null"})", { it }, cb)

    private fun <T> call(ctx: Context, code: String, parse: (String) -> T, cb: (T?) -> Unit, waitMs: Long = 0) {
        val app = ctx.applicationContext
        start(app)
        val pending = ready
        worker.execute {
            val iso = isolate ?: if (waitMs > 0 && starting) {
                try { pending.get(waitMs, TimeUnit.MILLISECONDS) } catch (_: Exception) { null }
            } else null
            val out = iso?.let {
                try { it.evaluateJavaScriptAsync(code).get(CALL_MS, TimeUnit.MILLISECONDS)?.let(parse) }
                // Un apel lent (primul, la rece) nu înseamnă un motor mort: tasta asta merge brut, următoarea îl reîncearcă.
                catch (_: TimeoutException) { null }
                catch (e: Exception) { if (isolate === it) broken(app, e); null }
            }
            main.post { cb(out) }
        }
    }

    /** La închiderea ferestrei. Următoarea deschidere reconectează de la zero. */
    fun close() {
        onReady = null
        val g = ++gen
        setup.execute {
            if (gen != g) return@execute
            synchronized(this) {
                try { isolate?.close() } catch (_: Exception) {}
                try { sandbox?.close() } catch (_: Exception) {}
                isolate = null; sandbox = null; unsupported = false; retry.ok()
            }
        }
    }
}
