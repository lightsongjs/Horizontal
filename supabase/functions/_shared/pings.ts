// supabase/functions/_shared/pings.ts
//
// Seriile de mementouri („la fiecare 15 minute până la 10", „din oră în oră
// între 9 și 17") — pur, fără Deno, fără rețea. O serie e UN tichet: `remind_at`
// e primul ping și ancora grilei, `due_at` e capătul ferestrei (inclusiv), iar
// `ping_every` e pasul, în minute. Nimic nu se scrie în bază la fiecare ping:
// cine sună calculează singur unde e pe grilă. Importat de:
//   - `send-reminders` (web push: CE ping e acum, dacă l-a trimis deja),
//   - `src/lib/desktopBridge.ts` (pagina desfășoară seria pentru cutia de Linux),
//   - `src/lib/pingSeries.ts` (eticheta și restul regulilor din pagină).
// Port Kotlin: `core/Pings.kt`, cu aceleași `src/lib/pings.fixtures.json` — un
// caz nou se adaugă acolo, nu într-un test.
//
// Grila e în MILISECUNDE ABSOLUTE de la `remind_at`, nu în ore de ceas: în
// noaptea schimbării orei „din oră în oră" rămâne o oră reală între pinguri
// (fixtures: 29 martie și 25 octombrie 2026). Ora de pe ceas sare odată cu
// fusul, pasul nu.

/** Plafonul pasului: 12 ore. O serie trăiește într-o singură zi. */
export const PING_MAX_MINUTES = 720

const MIN = 60_000

export interface Pings {
  /** Ultimul ping ≤ acum din fereastră (după capăt rămâne ultimul), sau `null` înainte de primul. */
  current: number | null
  /** Următorul ping > acum din fereastră, sau `null` după ultimul. */
  next: number | null
}

/**
 * Unde e seria acum. Fereastra are cel puțin primul ping, chiar dacă `dueAt`
 * a ajuns (stricat, mutat de mână) înaintea lui — o serie care nu mai sună
 * deloc ar fi un memento pierdut în tăcere. Un pas invalid (< 1) lasă doar
 * primul ping: seria se poartă atunci ca un memento obișnuit.
 */
export function pings(remindAtMs: number, everyMin: number, dueAtMs: number, nowMs: number): Pings {
  const step = Number.isFinite(everyMin) && everyMin >= 1 ? Math.round(everyMin) * MIN : Infinity
  const last = Number.isFinite(dueAtMs) && dueAtMs >= remindAtMs && step !== Infinity
    ? Math.floor((dueAtMs - remindAtMs) / step)
    : 0
  if (nowMs < remindAtMs) return { current: null, next: remindAtMs }
  const k = step === Infinity ? 0 : Math.floor((nowMs - remindAtMs) / step)
  if (k >= last) return { current: remindAtMs + last * (step === Infinity ? 0 : step), next: null }
  return { current: remindAtMs + k * step, next: remindAtMs + (k + 1) * step }
}

/**
 * Cât de vechi poate fi un ping ca să mai sune: min(pas, 10 minute). Un ping
 * răsuflat nu mai e informație — iar la o serie, cel următor vine oricum. Fără
 * plafon, un telefon trezit la 9:40 ar suna pingul de 9:00 dintr-o serie din
 * oră în oră, iar la 10:00 încă o dată.
 */
export function pingFreshMs(everyMin: number): number {
  return Math.min(Math.max(1, everyMin), 10) * MIN
}

/** Toate pingurile din `[fromMs, toMs]`, cel mult `limit`. Pentru cutiile care armează câte un timer pe ping. */
export function pingsBetween(remindAtMs: number, everyMin: number, dueAtMs: number, fromMs: number, toMs: number, limit: number): number[] {
  const out: number[] = []
  let p = pings(remindAtMs, everyMin, dueAtMs, fromMs)
  let at = p.current !== null && p.current >= fromMs ? p.current : p.next
  while (at !== null && at <= toMs && out.length < limit) {
    out.push(at)
    p = pings(remindAtMs, everyMin, dueAtMs, at)
    at = p.next
  }
  return out
}
