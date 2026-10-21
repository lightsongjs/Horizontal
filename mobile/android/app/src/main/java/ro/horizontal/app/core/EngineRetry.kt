package ro.horizontal.app.core

/**
 * Când reîncearcă fereastra de quick add să pornească motorul de captură
 * după un eșec (D-227). Înainte, primul eșec — de obicei o pornire rece a
 * procesului sandbox peste pragul de 1,5 s, dimineața, după Doze — ținea
 * fereastra pe modul brut până la închidere. Acum: 1 s, 2 s, 4 s, 8 s, apoi
 * la 15 s, cât stă fereastra deschisă; o reușită șterge istoricul.
 */
class EngineRetry(private val baseMs: Long = 1_000, private val maxMs: Long = 15_000) {
    private var failures = 0
    private var notBefore = 0L

    fun canTry(now: Long) = now >= notBefore

    /** Înregistrează un eșec; întoarce cât se așteaptă până la următoarea încercare. */
    fun failed(now: Long): Long {
        failures++
        val wait = minOf(maxMs, baseMs shl minOf(failures - 1, 4))
        notBefore = now + wait
        return wait
    }

    fun ok() { failures = 0; notBefore = 0 }
}
