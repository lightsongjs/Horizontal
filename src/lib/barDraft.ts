import type { ManualPick } from './quickDraft'

/**
 * Ciorna barei de captură (Linux, `/quick-add`), ținută peste ascunderi.
 *
 * Bara se ascunde la orice click în afară (blur), iar omul se întoarce în ea
 * cu textul încă de scris: „user: ion", apoi copiază parola din pagina din
 * spate și revine să o lipească. Numai Esc și o trimitere reușită golesc.
 *
 * În `sessionStorage`, nu doar în memorie: `registerPWA` rulează și pe bară,
 * iar un build nou se aplică la revenirea în fereastră, adică reîncarcă pagina
 * exact când omul o redeschide. `sessionStorage` e al ferestrei, deci moare cu
 * ea — fără expirare, fără scurgere în altă fereastră.
 */
export interface BarDraft {
  text: string
  desc: string
  descOpen: boolean
  manual: ManualPick
  /** Fragmentele de dată refuzate (× pe jeton) — altfel s-ar reaprinde la revenire. */
  rejected: string[]
  /** Unde era cursorul: acolo revine, la sfârșit. */
  field: 'title' | 'desc'
}

export const BAR_DRAFT_KEY = 'hz.quickAddBar.draft'

export const EMPTY_BAR_DRAFT: BarDraft = { text: '', desc: '', descOpen: false, manual: {}, rejected: [], field: 'title' }

/** Nimic de păstrat: nici text, nici o alegere făcută de mână. */
export function isBlankBarDraft(d: BarDraft): boolean {
  return d.text === '' && d.desc === '' && !d.descOpen && Object.keys(d.manual).length === 0
}

/** Citire tolerantă: orice formă străină înseamnă „fără ciornă", nu o eroare. */
export function parseBarDraft(raw: string | null): BarDraft | null {
  if (!raw) return null
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.text !== 'string' || typeof o.desc !== 'string') return null
  const manual = o.manual && typeof o.manual === 'object' && !Array.isArray(o.manual) ? (o.manual as ManualPick) : {}
  const rejected = Array.isArray(o.rejected) ? o.rejected.filter((x): x is string => typeof x === 'string') : []
  const d: BarDraft = {
    text: o.text,
    desc: o.desc,
    descOpen: o.descOpen === true || o.desc !== '',
    manual,
    rejected,
    field: o.field === 'desc' ? 'desc' : 'title',
  }
  return isBlankBarDraft(d) ? null : d
}

export function loadBarDraft(): BarDraft | null {
  try { return parseBarDraft(sessionStorage.getItem(BAR_DRAFT_KEY)) } catch { return null }
}

export function saveBarDraft(d: BarDraft): void {
  try {
    if (isBlankBarDraft(d)) sessionStorage.removeItem(BAR_DRAFT_KEY)
    else sessionStorage.setItem(BAR_DRAFT_KEY, JSON.stringify(d))
  } catch { /* fără stocare: ciorna trăiește doar în memorie */ }
}

export function clearBarDraft(): void {
  try { sessionStorage.removeItem(BAR_DRAFT_KEY) } catch { /* idem */ }
}
