package ro.horizontal.app.core

enum class Outcome { DONE, RETRY, KEEP_NO_SESSION, DROP }

/**
 * Soarta unui element după o încercare — aceeași împărțire ca `netError.ts`
 * din coada paginii: rețea → rămâne; autentificare → rămâne (fără sesiune
 * RLS respinge tot, iar luat drept refuz ar fi golit coada); refuz → iese.
 */
fun outcomeOf(status: Int?, networkError: Boolean, sessionDead: Boolean): Outcome = when {
    sessionDead -> Outcome.KEEP_NO_SESSION
    networkError || status == null -> Outcome.RETRY
    status in 200..299 -> Outcome.DONE
    status == 401 || status == 403 -> Outcome.KEEP_NO_SESSION
    status >= 500 || status == 408 || status == 429 -> Outcome.RETRY
    else -> Outcome.DROP
}

/**
 * Coada după răspuns. `null` = nu se scrie nimic înapoi: elementul nu mai e în
 * coadă, deci între timp a avut loc un logout (`signOut` golește coada) sau un
 * login pe alt cont — răspunsul nu mai are al cui să fie, iar workerul se oprește.
 *
 * Elementul încă acolo, dar fără sesiune (a murit chiar în cererea asta, sau
 * logout-ul a șters sesiunea și abia urmează să golească planul): DOAR se
 * eliberează. Rămas „în zbor", ar bloca pe veci coada — `nextToDrain` și
 * `take` sar peste tot cât un element zboară — exact când reconectarea
 * aceluiași cont ar trebui să-l trimită.
 */
fun afterAttempt(queue: List<NativeAction>, uid: String, outcome: Outcome, signedIn: Boolean, now: Long): List<NativeAction>? = when {
    queue.none { it.uid == uid } -> null
    !signedIn -> NativeQueue.release(queue, uid)
    outcome == Outcome.DONE -> NativeQueue.markDrained(queue, uid, now)
    outcome == Outcome.DROP -> NativeQueue.drop(queue, uid)
    else -> NativeQueue.release(queue, uid)
}

/**
 * Login pe alt cont decât ultimul: planul și coada sunt ale celuilalt. O coadă
 * moștenită ar bifa, cu sesiunea noului cont, tichete pe care el le vede prin
 * RLS doar din întâmplare. Același cont (reconectare după o sesiune moartă)
 * își păstrează coada — exact ce trebuie să plece acum.
 */
fun accountSwitched(lastUserId: String?, newUserId: String): Boolean = lastUserId != null && lastUserId != newUserId
