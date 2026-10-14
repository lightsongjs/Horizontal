import { fromRoman, toRoman } from './roman'
import type { Issue, Wave } from './types'

/**
 * Banda de valuri din „Listă" și „Cards" (`WaveTabs.tsx`). Regulile pure stau
 * aici, ca să aibă teste: când apare banda, ce scrie pe o pastilă, ce numără,
 * ordinea de comutare și reordonarea prin tragere.
 *
 * Valul are două texte: `name` e cifra romană pe care o scrie aplicația la
 * creare (I, II…), `label` e ce scrie omul („Extindere clase 7,8,12"). Pe
 * pastilă stă eticheta; cifra rămâne în tooltip și în foaia „Valuri" — și e
 * NUMELE valului, nu poziția lui: după ștergerea valului I, „II" rămâne „II".
 */

/** Pe pastilele inactive eticheta se taie după atâtea caractere. */
export const PILL_MAX = 18

export const SCRATCH = 0

export function deliveryWaves<W extends Pick<Wave, 'number'>>(waves: W[]): W[] {
  return waves.filter((w) => w.number !== SCRATCH)
}

/** Banda apare doar când ai între ce comuta: cel puțin două valuri de livrare. */
export function showWaveBand(waves: Pick<Wave, 'number'>[]): boolean {
  return deliveryWaves(waves).length >= 2
}

/** „Val III" din numele „III" — sau numele însuși, dacă scrie deja „Val …" (modul local). */
export function waveFallback(w: Pick<Wave, 'name'>): string {
  const name = w.name.trim()
  if (!name) return 'Val'
  return /^val\b/i.test(name) ? name : `Val ${name}`
}

/** Eticheta valului, sau „Val III" când n-are una. */
export function waveLabel(w: Pick<Wave, 'name' | 'label'>): string {
  return w.label.trim() || waveFallback(w)
}

/** Taie la `max` caractere (puncte de cod, nu unități UTF-16), cu „…". */
export function truncateLabel(s: string, max = PILL_MAX): string {
  const chars = Array.from(s)
  if (chars.length <= max) return s
  return chars.slice(0, max - 1).join('').trimEnd() + '…'
}

/** Textul pastilei: activul întreg, celelalte tăiate. */
export function pillText(w: Pick<Wave, 'name' | 'label'>, active: boolean): string {
  const label = waveLabel(w)
  return active ? label : truncateLabel(label)
}

/** Tooltipul: cifra, eticheta întreagă și cifrele (cu bifatele, dacă diferă). */
export function waveTitle(w: Pick<Wave, 'name' | 'label'>, open: number, total: number): string {
  const head = w.label.trim() ? `${w.name} · ${w.label.trim()}` : waveFallback(w)
  return `${head} · ${open} deschise${total !== open ? ` din ${total}` : ''}`
}

/** Tichetele DESCHISE pe val — aceeași cifră ca grupurile de sub bandă. */
export function openCounts(issues: Pick<Issue, 'wave' | 'done'>[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const i of issues) if (!i.done) m.set(i.wave, (m.get(i.wave) ?? 0) + 1)
  return m
}

export function totalCounts(issues: Pick<Issue, 'wave'>[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const i of issues) m.set(i.wave, (m.get(i.wave) ?? 0) + 1)
  return m
}

/**
 * Valul anterior / următor din bandă (tastele `,` și `.`). Ordinea e a benzii:
 * Notițele întâi, apoi valurile după poziție. Fără ocolire la capete — un `.`
 * apăsat de prea multe ori rămâne pe ultimul, nu sare înapoi pe Notițe.
 */
export function stepWave(waves: Pick<Wave, 'number'>[], active: number, dir: -1 | 1): number | null {
  const order = [
    ...waves.filter((w) => w.number === SCRATCH),
    ...deliveryWaves(waves),
  ].map((w) => w.number)
  const i = order.indexOf(active)
  if (i === -1) return order[0] ?? null
  const j = i + dir
  return j >= 0 && j < order.length ? order[j] : null
}

/**
 * Numele următorului val: cifra de după cea mai mare cifră folosită. Nu
 * „numărul de valuri + 1": după ștergerea lui I, cu II…IX în listă, acela ar
 * fi dat a doua oară „IX".
 */
export function nextWaveName(waves: Pick<Wave, 'number' | 'name'>[]): string {
  const delivery = deliveryWaves(waves)
  const max = delivery.reduce((m, w) => Math.max(m, fromRoman(w.name) ?? 0), 0)
  return toRoman(Math.max(max, delivery.length) + 1)
}

/**
 * Mută valul `number` pe indexul `to` (între valurile de livrare, în ordinea
 * dată) și întoarce DOAR pozițiile care se schimbă. Pozițiile existente se
 * refolosesc, redistribuite în noua ordine — așa Notițele (și orice altceva din
 * aceeași listă) nu se ating. Cu poziții duplicate (date vechi), se numără de
 * la cea mai mică în sus, ca ordinea să devină strictă.
 */
export function moveWave(
  delivery: Pick<Wave, 'number' | 'position'>[],
  number: number,
  to: number,
): { number: number; position: number }[] {
  const from = delivery.findIndex((w) => w.number === number)
  if (from === -1) return []
  const target = Math.max(0, Math.min(to, delivery.length - 1))
  if (target === from) return []
  const next = [...delivery]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  const sorted = delivery.map((w) => w.position).sort((a, b) => a - b)
  const strict = sorted.every((p, i) => i === 0 || p > sorted[i - 1])
  const slots = strict ? sorted : sorted.map((_, i) => sorted[0] + i)
  return next
    .map((w, i) => ({ number: w.number, position: slots[i] }))
    .filter((c) => delivery.find((w) => w.number === c.number)?.position !== c.position)
}

/**
 * Banda pe laptop e UN rând: ce nu încape intră în pastila „Încă N ▾".
 *
 * `widths[i]` = lățimea pastilei de val `i` plus spațiul de după ea, `avail` =
 * locul rămas valurilor (Notițele, „+" și jetoanele de mod sunt deja scăzute),
 * `overflowPillWidth` = pastila „Încă N" cu spațiul ei. Pastilele încap în
 * ordine; dacă nu încap toate, se lasă loc pastilei de preaplin. Valul activ
 * (`activeIdx`, -1 = niciunul: Notițele sunt active) se vede ÎNTOTDEAUNA: dacă
 * ar cădea în meniu, ia locul ultimei pastile vizibile (și al celor de dinainte,
 * cât e nevoie), iar acelea intră în meniu. Fără niciun loc, rămâne doar el.
 */
export function fitPills(
  widths: number[],
  avail: number,
  activeIdx: number,
  overflowPillWidth: number,
): { shown: number[]; overflow: number[] } {
  const all = widths.map((_, i) => i)
  const sum = widths.reduce((s, w) => s + w, 0)
  if (sum <= avail) return { shown: all, overflow: [] }
  const room = avail - overflowPillWidth
  const shown: number[] = []
  let used = 0
  for (const i of all) {
    if (used + widths[i] > room) break
    shown.push(i)
    used += widths[i]
  }
  if (activeIdx >= 0 && activeIdx < widths.length && !shown.includes(activeIdx)) {
    while (shown.length && used + widths[activeIdx] > room) used -= widths[shown.pop()!]
    shown.push(activeIdx)
  }
  return { shown, overflow: all.filter((i) => !shown.includes(i)) }
}
