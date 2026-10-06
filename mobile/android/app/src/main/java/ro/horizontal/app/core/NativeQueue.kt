package ro.horizontal.app.core

/**
 * Coada acțiunilor din notificare, ca transformări pure de listă — persistența
 * și lacătul sunt în `PlanStore`. Regula de care depinde tot: o acțiune e
 * executată de UN singur executant. Pagina PREIA (`take`) ce nu e în zbor;
 * workerul ia (`nextToDrain`) doar ce nu e preluat. Ambele marchează
 * `drainedAt`, iar acțiunea rămâne ca strat peste plan până la o listă mai nouă.
 */
object NativeQueue {
    /**
     * `nativeTemp`: ID-urile provizorii ale creărilor NATIVE (fereastra de quick add).
     * Pagina nu le cunoaște (`resolveId` ar întoarce tot provizoriul) și ar arunca
     * acțiunea; rămân în coadă până le remapează `DrainWorker`.
     */
    fun take(q: List<NativeAction>, now: Long, nativeTemp: Set<String> = emptySet()): Pair<List<NativeAction>, List<NativeAction>> {
        val taken = q.filter { it.drainedAt == null && !it.inFlight && it.id !in nativeTemp }
        val ids = taken.map { it.uid }.toSet()
        return taken to q.map { if (it.uid in ids) it.copy(drainedAt = now) else it }
    }
    /**
     * Una câte una, în ordine: o amânare și o bifă pe același tichet nu se depășesc.
     * Sare peste ID-urile provizorii (`HZ-~abc`, tichet creat offline): crearea e
     * încă în coada PAGINII, deci un PATCH ar găsi 0 rânduri — luat drept „făcut",
     * iar acțiunea s-ar pierde. Rămân pentru `take`: pagina traduce ID-ul
     * (`resolveId`) și scrie prin coada ei, DUPĂ creare. Sărite, nu oprire: o
     * pagină nedeschisă zile întregi n-are voie să țină pe loc restul cozii.
     */
    fun nextToDrain(q: List<NativeAction>): NativeAction? =
        if (q.any { it.inFlight }) null else q.firstOrNull { it.drainedAt == null && !isTempId(it.id) }
    /** Oglinda lui `isTempIssueId` din `src/lib/issueId.ts`: `PREFIX-~abc123`. */
    fun isTempId(id: String) = id.contains("-~")
    fun markInFlight(q: List<NativeAction>, uid: String) = q.map { if (it.uid == uid) it.copy(inFlight = true) else it }
    fun markDrained(q: List<NativeAction>, uid: String, now: Long) = q.map { if (it.uid == uid) it.copy(inFlight = false, drainedAt = now) else it }
    fun release(q: List<NativeAction>, uid: String) = q.map { if (it.uid == uid) it.copy(inFlight = false) else it }
    /**
     * La pornirea workerului: un `inFlight` rămas pe disc e de la o încercare omorâtă
     * (proces ucis, worker anulat de REPLACE). Lucrul `hz-drain` e unic, deci nimeni
     * altcineva nu zboară acum; retrimiterea e sigură — scrieri absolute, „Gata" cu gardă.
     */
    fun releaseAllInFlight(q: List<NativeAction>) = q.map { if (it.inFlight) it.copy(inFlight = false) else it }
    fun drop(q: List<NativeAction>, uid: String) = q.filterNot { it.uid == uid }
    fun prune(q: List<NativeAction>, latestReadAt: Long) = q.filterNot { it.drainedAt != null && it.drainedAt < latestReadAt }
    fun pending(q: List<NativeAction>) = q.count { it.drainedAt == null }
}
