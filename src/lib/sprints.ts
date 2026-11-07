// src/lib/sprints.ts
// Sprinturile (cerința omului, 2026-11-07): în interfață „valul” se cheamă
// sprint, iar un sprint nou se face dintr-o DATĂ și se numește cu ea,
// „dd/mm/yy” (19/11/26). Numele intern rămâne „wave” (tabela, câmpul, API-ul).
//
// Ordinea rămâne `position` — aceeași pe care o citesc banda, grila, API-ul și
// tragerea de mână. Data decide doar UNDE intră un sprint nou: înaintea
// primului sprint cu o dată mai târzie, altfel după ultimul sprint cu dată.
// Valurile fără dată (Backlog, „IV · Lansare”, Notițele) își păstrează ordinea:
// cel mult se dau cu un loc, ca să facă loc.
//
// Folosit de store (`createSprint`) și de `POST /api/waves` cu `date`.

import type { Wave } from './types'

/** Numele primului sprint al unui proiect nou: tot ce nu e programat. */
export const BACKLOG = 'Backlog'

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const DMY = /^(\d{2})\/(\d{2})\/(\d{2})$/

function valid(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-11-19` → `19/11/26`; o dată invalidă → null. */
export function sprintName(iso: string): string | null {
  const m = ISO.exec(iso.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (!valid(y, mo, d)) return null
  return `${pad(d)}/${pad(mo)}/${String(y).slice(-2)}`
}

function parseDmy(s: string): string | null {
  const m = DMY.exec(s.trim())
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), 2000 + Number(m[3])]
  return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null
}

/** Data sprintului (`AAAA-LL-ZZ`) din nume sau etichetă, sau null pentru unul fără dată. */
export function sprintDateOf(w: Pick<Wave, 'name' | 'label'>): string | null {
  return parseDmy(w.name) ?? parseDmy(w.label ?? '')
}

/** Sprintul care are deja data asta, sau null. */
export function duplicateSprint<W extends Pick<Wave, 'number' | 'name' | 'label'>>(waves: readonly W[], iso: string): W | null {
  return waves.find((w) => w.number !== 0 && sprintDateOf(w) === iso) ?? null
}

/**
 * Locul unui sprint nou cu data `iso`: poziția lui și pozițiile care se dau cu
 * unul ca să-i facă loc (de la coadă spre cap). Înaintea primului sprint mai
 * târziu; fără unul, imediat după ultimul sprint cu dată (ca sprinturile cu
 * dată să stea grămadă, chiar cu un Backlog pus la coadă, ca în ms); fără
 * niciun sprint cu dată, la coadă.
 */
export function placeSprint(
  waves: readonly Pick<Wave, 'number' | 'name' | 'label' | 'position'>[],
  iso: string,
): { position: number; shifts: { number: number; position: number }[] } {
  const sorted = [...waves].sort((a, b) => a.position - b.position || a.number - b.number)
  const dated = sorted.filter((w) => w.number !== 0 && sprintDateOf(w) !== null)
  const later = dated.find((w) => sprintDateOf(w)! > iso)
  const last = dated[dated.length - 1]
  const position = later
    ? later.position
    : last ? last.position + 1 : sorted.reduce((m, w) => Math.max(m, w.position), -1) + 1
  const shifts = sorted
    .filter((w) => w.position >= position)
    .map((w) => ({ number: w.number, position: w.position + 1 }))
    .reverse()
  return { position, shifts }
}
