/**
 * Linkurile dintr-un titlu: „Vezi https://youtu.be/AvHjix2TpH4?si=…" se
 * deschide cu o atingere pe rând, nu cu copy-paste.
 *
 * Aceleași scheme ca descrierea (`safeHref`): `http:`, `https:`, `www.`. Un
 * titlu vine și de la unelte (tk, ticket-kit), deci orice altceva rămâne text.
 */
import { safeHref } from './markdown/safeUrl'

export type TitlePart =
  | { text: string }
  | { text: string; href: string }

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi
// Punctuația de la capăt e a frazei, nu a linkului: „vezi https://x.ro." sau
// „(https://x.ro)". O paranteză închisă rămâne dacă linkul și-a deschis-o
// (Wikipedia: `…/Foo_(bar)`).
const TRAIL = /[.,;:!?'"»”’)\]]$/

function trimTrail(url: string): string {
  let u = url
  while (TRAIL.test(u)) {
    if (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) >= (u.match(/\)/g)?.length ?? 0)) break
    u = u.slice(0, -1)
  }
  return u
}

/** Ce se arată în rând: fără `https://` și fără `www.` — linkul se vede oricum. */
export function linkLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
}

/** Unde stau linkurile în text: `[from, to)` în titlul original, cu ținta. */
export function linkRanges(title: string): { from: number; to: number; href: string }[] {
  const out: { from: number; to: number; href: string }[] = []
  for (const m of title.matchAll(URL_RE)) {
    const raw = trimTrail(m[0])
    const href = safeHref(raw)
    if (href && m.index !== undefined) out.push({ from: m.index, to: m.index + raw.length, href })
  }
  return out
}

/** Titlul tăiat în bucăți de text și linkuri. Fără link → o singură bucată. */
export function titleParts(title: string): TitlePart[] {
  const out: TitlePart[] = []
  let last = 0
  for (const r of linkRanges(title)) {
    if (r.from > last) out.push({ text: title.slice(last, r.from) })
    out.push({ text: linkLabel(title.slice(r.from, r.to)), href: r.href })
    last = r.to
  }
  if (last < title.length || !out.length) out.push({ text: title.slice(last) })
  return out
}

/**
 * Bucățile oglinzii unui titlu editabil (evidențierea datei), tăiate mai
 * departe la marginile linkurilor — ca oglinda să sublinieze linkul și să
 * știe unde cade o atingere. Textul concatenat rămâne identic.
 */
export function withLinks<P extends { text: string }>(pieces: P[], title: string): (P & { href?: string })[] {
  const ranges = linkRanges(title)
  if (!ranges.length) return pieces
  const out: (P & { href?: string })[] = []
  let at = 0
  for (const p of pieces) {
    const end = at + p.text.length
    let cut = at
    for (const r of ranges) {
      const s = Math.max(r.from, at), e = Math.min(r.to, end)
      if (s >= e) continue
      if (s > cut) out.push({ ...p, text: title.slice(cut, s) })
      out.push({ ...p, text: title.slice(s, e), href: r.href })
      cut = e
    }
    if (cut < end) out.push({ ...p, text: title.slice(cut, end) })
    at = end
  }
  return out
}
