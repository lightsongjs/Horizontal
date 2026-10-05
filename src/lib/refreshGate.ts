/**
 * Cât de veche are voie să fie o încărcare ca revenirea în tab să nu mai ceară
 * datele din nou.
 *
 * Revenirile sunt dese și scurte — treci pe alt tab să copiezi un link și te
 * întorci — iar fiecare cerere costă o rundă completă către Supabase pentru
 * ceva ce s-a citit acum trei secunde. Pragul e destul de mic încât „am făcut
 * un tichet pe telefon” să fie vizibil când chiar revii la lucru, și destul de
 * mare încât ping-pong-ul între taburi să nu bată serverul degeaba.
 */
export const REFRESH_MIN_INTERVAL_MS = 30_000

/**
 * Merită cerute datele la revenirea în tab?
 *
 * Pură și testată separat fiindcă e singura regulă a pragului; refresh-ul
 * EXPLICIT (butonul din header, tragerea în jos) n-o consultă niciodată — acolo
 * omul a cerut datele, iar un refuz tăcut ar arăta ca un buton stricat.
 */
export function shouldRefreshOnVisible(
  lastRefreshAt: number | null,
  now: number,
  minIntervalMs: number = REFRESH_MIN_INTERVAL_MS,
): boolean {
  if (lastRefreshAt === null) return true
  // Ceasul sistemului poate sări înapoi (sincronizare NTP, trezire din somn).
  // Atunci vechimea datelor e necunoscută, nu zero — și necunoscut înseamnă
  // cerem, nu sărim.
  if (now < lastRefreshAt) return true
  return now - lastRefreshAt >= minIntervalMs
}

type QueueState = { offline: boolean; pending: number }

/**
 * Cere starea cozii o reîncărcare completă, peste prag?
 *
 * Reconectarea (offline → online) și golirea cozii rămase de offline (N → 0)
 * sunt momentele în care ce e pe ecran poate fi altă versiune decât serverul:
 * listele au venit din baza locală, iar ce s-a scris offline abia a ajuns.
 * Pragul de mai sus e pentru ping-pong între taburi, nu pentru asta.
 *
 * `owed` ține minte că există o coadă rămasă de offline. Fără el, orice
 * adăugare rapidă (trece prin coadă și online: 1 → 0) ar fi cerut o rundă
 * completă către Supabase.
 */
export function syncRefreshStep(owed: boolean, prev: QueueState, next: QueueState): { owed: boolean; refresh: boolean } {
  if (next.offline) return { owed: owed || next.pending > 0 || prev.pending > 0, refresh: false }
  if (prev.offline) return { owed: next.pending > 0, refresh: true }
  if (owed && next.pending === 0) return { owed: false, refresh: true }
  return { owed, refresh: false }
}
