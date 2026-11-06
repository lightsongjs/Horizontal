package ro.horizontal.app.core

/**
 * Port al lui `supabase/functions/_shared/pings.ts` — aceleași
 * `src/lib/pings.fixtures.json`. O serie de mementouri e UN rând: `at` (=
 * `remind_at`) e primul ping și ancora grilei, `dueAt` capătul ferestrei
 * (inclusiv), `every` pasul în minute. Grila e în milisecunde absolute, nu în
 * ore de ceas: în noaptea schimbării orei pasul rămâne o oră reală.
 */
data class Pings(val current: Long?, val next: Long?)

private const val MIN = 60_000L

/**
 * `current` = ultimul ping ≤ acum din fereastră (după capăt rămâne ultimul),
 * `next` = următorul > acum. Pas invalid (< 1) sau capăt înaintea primului
 * ping → doar primul ping: seria se poartă ca un memento obișnuit.
 */
fun pings(remindAt: Long, everyMin: Int, dueAt: Long, now: Long): Pings {
    val step = if (everyMin >= 1) everyMin * MIN else 0L
    val last = if (step > 0 && dueAt >= remindAt) (dueAt - remindAt) / step else 0L
    if (now < remindAt) return Pings(null, remindAt)
    val k = if (step > 0) Math.floorDiv(now - remindAt, step) else 0L
    if (k >= last) return Pings(remindAt + last * step, null)
    return Pings(remindAt + k * step, remindAt + (k + 1) * step)
}

/** Cât de vechi poate fi un ping ca să mai sune: min(pas, 10 minute) — cel următor vine oricum. */
fun pingFreshMs(everyMin: Int): Long = minOf(maxOf(1, everyMin), 10) * MIN
