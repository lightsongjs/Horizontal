// Lista de sugestii pentru semnele de captură: scrii `#` sau `@` și alegi
// proiectul sau omul, fără să-i știi numele exact. Pur, ca `captureTokens`:
// îl folosesc `QuickTitle` (bara de pe Linux, rândul de pe desktop, foaia de pe
// telefon) și, prin motorul JS, fereastra nativă de quick add.
//
// Ce se inserează trebuie să fie recunoscut de `parseCaptureTokens` fără
// ambiguitate — altfel alegerea din listă ar rămâne text în titlu.

import { INBOX_ALIASES, isInboxProject, normalizeName } from './captureTokens'

export interface TokenAt { sigil: '#' | '@'; query: string; start: number; end: number }
export interface Suggestion { id: string; label: string; insert: string }

const STOP = /[\s#@!]/

/** Semnul care conține cursorul, la început de cuvânt (`ion@firma.ro`, `C#` nu sunt semne). */
export function tokenAt(text: string, caret: number): TokenAt | null {
  let start = caret
  while (start > 0 && !STOP.test(text[start - 1])) start--
  const sigil = text[start - 1]
  if (sigil !== '#' && sigil !== '@') return null
  if (start - 1 > 0 && !/\s/.test(text[start - 2])) return null
  let end = caret
  while (end < text.length && !STOP.test(text[end])) end++
  return { sigil, query: text.slice(start, end), start: start - 1, end }
}

const words = (name: string) => name.split(/\s+/).map(normalizeName).filter(Boolean)

/** Începutul numelui, apoi începutul unui cuvânt, apoi oriunde. Ordinea din listă în rest. */
export function suggest(
  t: TokenAt,
  projects: { id: string; name: string }[],
  people: { id: string; name: string }[],
  limit = 8,
): Suggestion[] {
  const items = t.sigil === '#' ? projects : people
  const q = normalizeName(t.query)
  const rankOf = (name: string) => {
    if (!q) return 0
    const n = normalizeName(name)
    if (n.startsWith(q)) return 0
    if (words(name).some((w) => w.startsWith(q))) return 1
    return n.includes(q) ? 2 : -1
  }
  // Inbox se găsește și după rol (`#inb`, `#dai` — numele lui vechi), ca în `parseCaptureTokens`.
  const rank = (it: { id: string; name: string }) => {
    const names = t.sigil === '#' && isInboxProject(it) ? [it.name, ...INBOX_ALIASES] : [it.name]
    const rs = names.map(rankOf).filter((r) => r >= 0)
    return rs.length ? Math.min(...rs) : -1
  }
  const firsts = people.map((p) => words(p.name)[0])
  return items
    .map((it, i) => ({ it, i, r: rank(it) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map(({ it }) => {
      const whole = it.name.replace(/\s+/g, '')
      let insert = `${t.sigil}${whole}`
      if (t.sigil === '@') {
        // Prenumele ajunge doar dacă e unic; „@Ana" pentru două Ane ar fi ambiguu.
        const first = it.name.split(/\s+/)[0]
        if (firsts.filter((f) => f === normalizeName(first)).length === 1) insert = `@${first}`
      }
      return { id: it.id, label: it.name, insert }
    })
}

/** Înlocuiește semnul cu alegerea; un spațiu după, ca scrisul să continue. */
export function applySuggestion(text: string, t: TokenAt, s: Suggestion): { text: string; caret: number } {
  const after = text.slice(t.end)
  const glue = after.startsWith(' ') ? '' : ' '
  const head = text.slice(0, t.start) + s.insert + glue
  return { text: head + after, caret: head.length + (glue ? 0 : 1) }
}
