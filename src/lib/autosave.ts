/**
 * Salvarea fără buton, fără React: ce pleacă spre bază și când.
 *
 * Azi o folosește foaia de tichet de pe telefon (`EditSheet`); formularul
 * complet o va folosi când pierde și el butonul Salvează — de-aia e un modul
 * pur, cu hook-ul (`useAutosave` din `hooks.ts`) doar ca legătură cu React.
 *
 * Trei reguli, fiecare cu motivul ei:
 *
 * 1. **Pleacă doar ce s-a schimbat.** Patch-ul se calculează față de `base` —
 *    ultima valoare știută ca fiind în bază — nu față de tot tichetul. Un
 *    patch cu câmpuri neatinse ar rescrie în tăcere o schimbare venită între
 *    timp de pe alt dispozitiv (sau saltul unei recurențe făcut de trigger).
 * 2. **Textul așteaptă, butoanele nu.** Un câmp de text se salvează după o
 *    pauză (`delay`) și la închidere; o atingere pe un jeton e deja un gest
 *    încheiat, deci pleacă imediat. Ordinea dintre ele o ține coada per
 *    tichet din `store.tsx` (`enqueueWrite`), nu modulul ăsta.
 * 3. **Ce vine din bază nu calcă peste ce scrii.** Un câmp cu modificări
 *    nesalvate, sau unul încă în zbor, nu se rescrie la sosirea unei poze noi;
 *    unul curat o adoptă — dar numai dacă poza chiar e diferită de `base`.
 *    Altfel o reîmprospătare cu aceeași valoare ți-ar mânca spațiul de la
 *    capătul titlului pe care tocmai îl scrii.
 */

export type FieldValue = string | number | boolean | null
export type Fields = Record<string, FieldValue>

/**
 * Valoarea care s-ar trimite pentru un câmp, sau `undefined` dacă acum nu se
 * poate trimite deloc (un titlu golit: un tichet fără titlu e mai rău decât
 * o salvare amânată).
 */
export type Normalize<T extends Fields> = <K extends keyof T>(field: K, value: T[K]) => T[K] | undefined

const identity = <T extends Fields>(_f: keyof T, v: T[keyof T]) => v

/** Câmpurile de trimis: normalizate, diferite de `base`, trimisibile. */
export function patchOf<T extends Fields>(draft: T, base: T, normalize: Normalize<T> = identity as Normalize<T>): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(draft) as (keyof T)[]) {
    const v = normalize(k, draft[k])
    if (v === undefined) continue
    if (v !== base[k]) out[k] = v
  }
  return out
}

/**
 * Poza nouă din bază, așezată peste ciornă. Un câmp:
 * - în zbor → neatins (răspunsul salvării îl va aduce);
 * - neschimbat în bază (`incoming === base`) → neatins, ciorna rămâne cum e;
 * - schimbat în bază și curat local → ciorna îl adoptă;
 * - schimbat în bază dar murdar local → ciorna rămâne (scrii peste el), iar
 *   `base` avansează, ca patch-ul următor să se calculeze față de adevăr.
 */
export function rebase<T extends Fields>(
  draft: T,
  base: T,
  incoming: T,
  inflight: ReadonlySet<keyof T>,
  normalize: Normalize<T> = identity as Normalize<T>,
): { draft: T; base: T } {
  const d = { ...draft }
  const b = { ...base }
  for (const k of Object.keys(incoming) as (keyof T)[]) {
    if (inflight.has(k)) continue
    if (incoming[k] === base[k]) continue
    const dirty = normalize(k, draft[k]) !== base[k]
    if (!dirty) d[k] = incoming[k]
    b[k] = incoming[k]
  }
  return { draft: d, base: b }
}

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'error'

export interface AutosaverOptions<T extends Fields> {
  initial: T
  save(patch: Partial<T>): Promise<void>
  normalize?: Normalize<T>
  /** Pauza de după ultima tastă, în ms. */
  delay?: number
  /** Chemat la orice schimbare de stare (ciornă, status) — React re-randează. */
  onChange?(): void
}

/**
 * Starea unei ciorne care se salvează singură. `set(patch, 'debounce')` pentru
 * tastare, `set(patch, 'now')` pentru jetoane; `flush()` la închidere.
 */
export class Autosaver<T extends Fields> {
  draft: T
  base: T
  status: AutosaveStatus = 'idle'
  private readonly opts: AutosaverOptions<T>
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Câte salvări în zbor poartă fiecare câmp. */
  private readonly flying = new Map<keyof T, number>()
  private chain: Promise<boolean> = Promise.resolve(true)

  constructor(opts: AutosaverOptions<T>) {
    this.opts = opts
    this.draft = { ...opts.initial }
    this.base = { ...opts.initial }
  }

  private get normalize(): Normalize<T> {
    return this.opts.normalize ?? (identity as Normalize<T>)
  }

  private emit() { this.opts.onChange?.() }

  /** Ce ar pleca acum. */
  pending(): Partial<T> {
    return patchOf(this.draft, this.base, this.normalize)
  }

  set(patch: Partial<T>, when: 'debounce' | 'now'): Promise<boolean> {
    this.draft = { ...this.draft, ...patch }
    if (when === 'now') return this.flush()
    this.clearTimer()
    if (Object.keys(this.pending()).length) {
      this.status = 'pending'
      this.timer = setTimeout(() => { this.timer = null; void this.flush() }, this.opts.delay ?? 800)
    } else if (this.status === 'pending') {
      this.status = 'idle'
    }
    this.emit()
    return Promise.resolve(true)
  }

  /** O poză nouă a tichetului, din store. */
  receive(incoming: T) {
    const inflight = new Set([...this.flying.keys()])
    const next = rebase(this.draft, this.base, incoming, inflight, this.normalize)
    this.draft = next.draft
    this.base = next.base
    this.emit()
  }

  /**
   * Trimite ce e de trimis. Întoarce `false` dacă salvarea a eșuat — ciorna
   * rămâne murdară, deci următoarea modificare (sau închiderea) reîncearcă.
   * Salvările se înșiră una după alta; ordinea spre bază o ține oricum coada
   * din store, iar aici înșiruirea ține `base` corect între ele.
   */
  flush(): Promise<boolean> {
    this.clearTimer()
    const run = async (): Promise<boolean> => {
      const patch = this.pending()
      const keys = Object.keys(patch) as (keyof T)[]
      if (!keys.length) {
        if (this.status !== 'error') this.status = 'idle'
        this.emit()
        return true
      }
      const prevBase = { ...this.base }
      // `base` avansează ÎNAINTE de răspuns: ce se tastează între timp se
      // compară cu ce e deja pe drum, nu cu ce era înainte, deci nu pleacă de
      // două ori.
      this.base = { ...this.base, ...patch }
      for (const k of keys) this.flying.set(k, (this.flying.get(k) ?? 0) + 1)
      this.status = 'saving'
      this.emit()
      try {
        await this.opts.save(patch)
        this.status = this.timer ? 'pending' : 'idle'
        return true
      } catch {
        // Înapoi doar câmpurile pe care nu le-a mișcat nimic între timp.
        for (const k of keys) if (this.base[k] === patch[k]) this.base[k] = prevBase[k]
        this.status = 'error'
        return false
      } finally {
        for (const k of keys) {
          const n = (this.flying.get(k) ?? 1) - 1
          if (n <= 0) this.flying.delete(k)
          else this.flying.set(k, n)
        }
        this.emit()
      }
    }
    const next = this.chain.then(run, run)
    this.chain = next
    return next
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Oprește pauza în curs fără să trimită (folosit doar de teste și de demontare după flush). */
  dispose() { this.clearTimer() }
}
