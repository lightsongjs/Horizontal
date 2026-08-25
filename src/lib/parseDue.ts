// Recunoaște data dintr-un titlu scris liber: „mergi la cumpărături la 14:00"
// → titlu „mergi la cumpărături" + scadență azi 14:00. Română și engleză.
//
// Pur, fără dependențe. `chrono-node` ar fi fost varianta de la raft, dar nu
// are română — adică exact limba în care e scris restul aplicației.
//
// Contractul care face funcția folosibilă: pe lângă ce a înțeles, întoarce
// UNDE a înțeles-o (`spans`). Interfața evidențiază fragmentele în input și
// lasă userul să le respingă. Un parser care ghicește în silență devine dușman
// la primul „Întâlnire la Podul 5".

import { startOfLocalDay, addDays } from './schedule'

export interface ParsedDue {
  /** Titlul cu fragmentele de dată scoase. Poate fi GOL — vezi mai jos. */
  title: string
  dueAt: string | null
  allDay: boolean
  /** RRULE recunoscut („în fiecare luni"). Motorul de recurență vine mai târziu. */
  rrule: string | null
  /** Intervalele `[start, end)` din textul ORIGINAL care au fost interpretate. */
  spans: [number, number][]
}

const DAYS_RO = ['duminica', 'luni', 'marti', 'miercuri', 'joi', 'vineri', 'sambata']
const DAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Text fără diacritice, pentru potrivire. Lungimea se PĂSTREAZĂ: fiecare literă
 * precompusă se descompune în bază + semn, iar semnul se șterge. De asta
 * indicii găsiți aici sunt valizi și în textul original.
 */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Cantitatea unui decalaj. Absentă sau scrisă în litere („o oră", „an hour",
 * „într-o oră") înseamnă 1 — forma cea mai firească în ambele limbi și singura
 * pe care o scrie cineva care se grăbește.
 */
function qty(raw: string | undefined): number {
  if (!raw) return 1
  const n = Number(raw)
  return Number.isFinite(n) ? n : 1
}

/** Intervale sortate și unite — două tipare se pot suprapune („în fiecare luni"). */
function mergeSpans(spans: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const sp of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1]
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1])
    else out.push([sp[0], sp[1]])
  }
  return out
}

/**
 * Caracterul cu care se ascund fragmentele refuzate. Nu se poate tasta, deci nu
 * poate veni din text, și e non-cuvânt pentru regex — adică `\b` din tipare
 * continuă să funcționeze de-o parte și de alta a măștii.
 */
const MASK = '\u0001'

/**
 * Ascunde de parser fragmentele pe care omul le-a refuzat.
 *
 * Lungimea se PĂSTREAZĂ, ca indicii întorși de `parseDue` să rămână valizi în
 * textul original. Se maschează după conținut, nu după poziție: textul se
 * editează în continuare, iar un interval memorat ar aluneca la prima literă
 * scrisă înaintea lui.
 *
 * Consecința asumată: după ce ai refuzat „la 11", scrierea lui „la 11" mai
 * târziu în ACELAȘI titlu rămâne text. E prețul pentru ca refuzul să nu se
 * anuleze singur la următoarea tastă — bug-ul pe care îl repară.
 */
export function maskRejected(raw: string, rejected: string[]): string {
  let out = raw
  for (const frag of rejected) {
    if (!frag) continue
    let from = 0
    for (;;) {
      const i = out.indexOf(frag, from)
      if (i < 0) break
      out = out.slice(0, i) + MASK.repeat(frag.length) + out.slice(i + frag.length)
      from = i + frag.length
    }
  }
  return out
}

/**
 * Textul fără intervalele date, curățat de spațiile și de semnele rămase
 * atârnate. Aceeași funcție e folosită de parser pentru titlu și de interfață
 * pentru „curăță titlul" — două tăieturi diferite ar fi divergent în tăcere.
 */
export function stripSpans(raw: string, spans: [number, number][]): string {
  let out = raw
  // De la dreapta la stânga, ca indicii să rămână valizi după fiecare tăietură.
  for (let i = spans.length - 1; i >= 0; i--) {
    out = out.slice(0, spans[i][0]) + out.slice(spans[i][1])
  }
  return out.replace(/\s{2,}/g, ' ').trim().replace(/^[,–-]\s*|[,–-]\s*$/g, '').trim()
}

export function parseDue(raw: string, now: Date = new Date()): ParsedDue {
  const hay = fold(raw)
  const spans: [number, number][] = []
  const hit = (m: RegExpMatchArray) => {
    if (m.index !== undefined) spans.push([m.index, m.index + m[0].length])
  }

  let day: Date | null = null
  let time: [number, number] | null = null
  let rrule: string | null = null
  let m: RegExpMatchArray | null

  // ── recurență. Recunoscută chiar dacă motorul nu există încă: altfel „în
  //    fiecare luni" ar rămâne în titlu și ar arăta ca o eroare de parsare.
  m = hay.match(/\b(?:in fiecare|fiecare|every)\s+([a-z]+)\b/)
  if (m) {
    const w = m[1]
    if (DAYS_RO.includes(w) || DAYS_EN.includes(w)) { rrule = 'FREQ=WEEKLY'; hit(m) }
    else if (/^(zi|day|saptamana|week)$/.test(w)) { rrule = 'FREQ=DAILY'; hit(m) }
  }
  m = hay.match(/\b(?:zilnic|daily)\b/)
  if (m) { rrule = 'FREQ=DAILY'; hit(m) }

  // ── zi relativă
  m = hay.match(/\b(?:azi|astazi|today)\b/)
  if (m) { day = startOfLocalDay(now); hit(m) }
  m = hay.match(/\b(?:maine|tomorrow)\b/)
  if (m) { day = addDays(startOfLocalDay(now), 1); hit(m) }
  m = hay.match(/\bpoimaine\b/)
  if (m) { day = addDays(startOfLocalDay(now), 2); hit(m) }
  m = hay.match(/\b(?:peste|in)\s+(\d+|o|una|un)\s*(?:zile|zi|days|day)\b/)
  if (m) { day = addDays(startOfLocalDay(now), qty(m[1])); hit(m) }
  // ── decalaje de la ACUM: „peste 3 ore", „in 1 hour", „într-o oră",
  //    „mergi la baie in 5 min", „peste 20 de minute".
  //
  // `setMinutes`/`setHours` cu depășire rostogolesc data corect, deci „in 30
  // min" la 23:50 cade mâine la 00:20 fără nicio aritmetică de calendar.
  //
  // Cantitatea e opțională fiindcă „într-o oră" o poartă în prefix: după
  // „intr-o" urmează direct unitatea. Prefixul `intr-?o` NU e admis pentru zile,
  // ca să nu transformăm idiomul „într-o zi" (= cândva) într-o scadență.
  m = hay.match(/\b(?:peste|in|intr-?o)\s+(?:(\d+|o|una|un|an|a)\s*(?:de\s+)?)?(?:hours|hour|ore|ora|h)\b/)
  if (m) {
    const d = new Date(now)
    d.setHours(d.getHours() + qty(m[1]), d.getMinutes(), 0, 0)
    day = d
    time = [d.getHours(), d.getMinutes()]
    hit(m)
  }
  m = hay.match(/\b(?:peste|in|intr-?o)\s+(?:(\d+|o|una|un|an|a)\s*(?:de\s+)?)?(?:minutes|minute|minut|mins|min|m)\b/)
  if (m) {
    const d = new Date(now)
    d.setMinutes(d.getMinutes() + qty(m[1]), 0, 0)
    day = d
    time = [d.getHours(), d.getMinutes()]
    hit(m)
  }

  // ── zi a săptămânii: cea mai apropiată din viitor
  if (!day) {
    m = hay.match(
      /\b(?:(?:in|pe)\s+)?(duminica|luni|marti|miercuri|joi|vineri|sambata|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s+viitoare|\s+viitor)?\b/,
    )
    if (m) {
      const name = m[1]
      const idx = DAYS_RO.indexOf(name) >= 0 ? DAYS_RO.indexOf(name) : DAYS_EN.indexOf(name)
      let delta = (idx - now.getDay() + 7) % 7
      if (delta === 0) delta = 7 // „luni" spus luni înseamnă lunea viitoare
      // „vineri viitoare" = vinerea de săptămâna viitoare. Dar dacă ziua goală a
      // aterizat deja la +7, e chiar aceea — un +7 în plus ar sări două săptămâni.
      if (m[2] && delta < 7) delta += 7
      day = addDays(startOfLocalDay(now), delta)
      hit(m)
    }
  }

  // ── oră militară lipită: „at 1500", „la 0830", „ora 900".
  //
  // Se încearcă ÎNAINTE de forma cu două puncte: aceea nu poate prinde „1500"
  // oricum (`\b` nu există între cifre), deci ordinea nu ia nimic de la ea.
  //
  // Prefixul `la|ora|at` e OBLIGATORIU aici, spre deosebire de „14:30" care se
  // recunoaște singur: patru cifre lipite sunt de obicei o cantitate, nu o oră.
  // „cumpără 1500 de șuruburi" n-are voie să devină o scadență.
  m = hay.match(/\b(?:la|ora|at)\s*(\d{3,4})\b/)
  if (m) {
    const digits = m[1]
    const h = Number(digits.length === 4 ? digits.slice(0, 2) : digits.slice(0, 1))
    const min = Number(digits.slice(-2))
    // Validarea e ce ține „at 2500" în afara scadențelor.
    if (h < 24 && min < 60) { time = [h, min]; hit(m) }
  }

  // ── oră cu separator sau cu am/pm: „la 14:00", „la 14", „ora 9", „9:30",
  //    „9am", „at 5pm", „at 8 am".
  //
  // `(?:\s*(am|pm))?` și nu `\s*(am|pm)?`: al doilea consumă spațiul de după oră
  // chiar și când nu urmează am/pm, iar span-ul ar evidenția un caracter în plus.
  if (!time) {
    m = hay.match(/\b(?:la|ora|at)\s*(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?\b/)
      ?? hay.match(/\b(\d{1,2}):(\d{2})\b/)
      ?? hay.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
    if (m) {
      let h = Number(m[1])
      const min = m[2] ? Number(m[2]) : 0
      const ap = m[3]
      if (ap === 'pm' && h < 12) h += 12
      if (ap === 'am' && h === 12) h = 0
      if (h <= 24 && min < 60) { time = [h % 24, min]; hit(m) }
    }
  }

  if (spans.length === 0) {
    return { title: raw.trim(), dueAt: null, allDay: true, rrule: null, spans: [] }
  }

  const base = day ? new Date(day) : startOfLocalDay(now)
  if (time) base.setHours(time[0], time[1], 0, 0)
  // „la 8" spus la 09:00 înseamnă mâine la 8. Altfel sarcina s-ar naște
  // restantă. O zi scrisă explicit învinge: „azi la 8" rămâne azi.
  if (!day && time && base.getTime() < now.getTime()) base.setDate(base.getDate() + 1)

  const merged = mergeSpans(spans)
  const title = stripSpans(raw, merged)

  // Titlul are voie să rămână GOL: „azi la 8" e numai dată. NU întoarcem textul
  // brut ca titlu — ar salva o sarcină numită „azi la 8". Apelantul decide;
  // quick add blochează Enter și cere ce e de făcut.
  return { title, dueAt: base.toISOString(), allDay: !time, rrule, spans: merged }
}
