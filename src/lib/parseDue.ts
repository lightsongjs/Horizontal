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
import { firstOccurrence, formatRrule } from './recurrence'

export interface ParsedDue {
  /** Titlul cu fragmentele de dată scoase. Poate fi GOL — vezi mai jos. */
  title: string
  dueAt: string | null
  allDay: boolean
  /** RRULE recunoscut („în fiecare luni", „la 2 zile", „pe 15 ale lunii"). */
  rrule: string | null
  /** Intervalele `[start, end)` din textul ORIGINAL care au fost interpretate. */
  spans: [number, number][]
  /**
   * Textul a numit o ZI („mâine", „vineri", „peste 3 ore", prima apariție a lui
   * „vinerea"). Fals când ziua din `dueAt` e doar implicitul (azi, sau mâine
   * după rostogolirea unei ore trecute).
   */
  hasDay: boolean
  /** Textul a numit o ORĂ. Fals = `allDay`. */
  hasTime: boolean
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
 * Refuzurile care mai au acoperire în text.
 *
 * Un refuz ține cât ține fragmentul: ștergi „la 10", refuzul lui se uită; îl
 * scrii din nou, se recunoaște din nou. Altfel refuzul ar fi o pedeapsă pe
 * viață pentru un șir de caractere — un „la 10" refuzat o dată n-ar mai putea
 * deveni niciodată scadență în același titlu fără să golești tot.
 */
export function liveRejections(text: string, rejected: string[]): string[] {
  return rejected.filter((f) => text.includes(f))
}

/**
 * Toate fragmentele pe care parserul le-ar recunoaște în `raw`, pentru a le
 * refuza dinainte (`useTitleDate({ initialRejected })`). Se repetă cu
 * fragmentele găsite mascate, fiindcă o potrivire poate ascunde alta — la fel
 * cum le-ar dezgropa refuzul lor unul câte unul.
 */
export function dateFragments(raw: string, now: Date = new Date()): string[] {
  const out: string[] = []
  for (let i = 0; i < 8; i++) {
    const r = parseDue(maskRejected(raw, out), now)
    const fresh = r.spans.map(([s, e]) => raw.slice(s, e)).filter((f) => f && !out.includes(f))
    if (!r.dueAt || !fresh.length) break
    out.push(...fresh)
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

  // ── recurență. Se caută ÎNAINTE de ziua relativă și de ora liberă: „la 2
  //    zile" trebuie să fie o recurență, nu o scadență „peste 2 zile", iar
  //    fragmentul consumat de aici nu mai e disponibil pentru celelalte tipare.
  //
  //    Forma ARTICULATĂ e semnalul, în română: „luni" e o zi, „lunea" e o
  //    recurență. De aceea lista de mai jos e separată de `DAYS_RO`.
  //
  //    Indexul din listă E ziua săptămânii, deci rămân toate șapte — dar
  //    regexul de mai jos caută doar cinci; vezi comentariul de acolo.
  const DAYS_RO_ART = ['duminica', 'lunea', 'martea', 'miercurea', 'joia', 'vinerea', 'sambata']

  // „în zilele lucrătoare", „de luni până vineri", „every weekday" — PRIMUL:
  // „în fiecare zi lucrătoare" ar fi fost prins altfel ca „în fiecare zi"
  // (zilnic, cu tot cu weekendul). „luni"/„vineri" singure rămân date; numai
  // perechea legată e recurență. „o zi lucrătoare" nu e aici: e o durată.
  m = hay.match(/\b(?:(?:in\s+)?(?:fiecare\s+zi\s+lucratoare|zilele\s+lucratoare)|de\s+luni\s+(?:pana\s+)?(?:la\s+)?vineri|luni\s*-\s*vineri|(?:every|on)\s+(?:weekdays?|workdays?|(?:working|business)\s+days?)|weekdays|workdays|monday\s+(?:to|through|-)\s+friday|mon\s*-\s*fri)\b/)
  if (m) { rrule = formatRrule({ freq: 'WEEKLY', interval: 1, byday: [1, 2, 3, 4, 5], bymonthday: null }); hit(m) }

  // „la 2 zile", „din 3 în 3 zile", „every 2 days"
  //
  // Numărul e plafonat la trei cifre, nu din pedanterie: `INTERVAL=99999999999`
  // nu încape în `int4`, iar `next_occurrence()` din Postgres arunca pe el —
  // adică tichetul nu se mai putea bifa DELOC. Peste trei cifre fragmentul nu
  // se mai recunoaște ca recurență și rămâne text în titlu, ceea ce e onest:
  // „la 99999999999 zile" nu e o rată, e o greșeală de tastare.
  if (!rrule) {
    m = hay.match(/\b(?:la|every)\s+(\d{1,3})\s*(?:de\s+)?(zile|zi|days|day|saptamani|saptamana|weeks|week|luni|luna|months|month|ani|an|years|year)\b/)
      ?? hay.match(/\bdin\s+(\d{1,3})\s+in\s+\d+\s+(zile|zi|saptamani|saptamana|luni|luna|ani|an)\b/)
    if (m) {
      const n = Number(m[1])
      const unit = m[2]
      // Atenție: „luni" e ambiguu — ziua sau pluralul lui „lună". Aici, după un
      // număr („la 2 luni"), e unitatea; ca zi a săptămânii n-ar avea sens.
      const freq = /^(zile|zi|days|day)$/.test(unit) ? 'DAILY'
        : /^(saptamani|saptamana|weeks|week)$/.test(unit) ? 'WEEKLY'
        : /^(luni|luna|months|month)$/.test(unit) ? 'MONTHLY' : 'YEARLY'
      if (n >= 1) { rrule = formatRrule({ freq, interval: n, byday: [], bymonthday: null }); hit(m) }
    }
  }

  // „în fiecare luni", „every monday", „în fiecare zi/săptămână/lună/an"
  if (!rrule) {
    m = hay.match(/\b(?:in fiecare|fiecare|every)\s+([a-z]+)\b/)
    if (m) {
      const w = m[1]
      const dow = DAYS_RO.indexOf(w) >= 0 ? DAYS_RO.indexOf(w) : DAYS_EN.indexOf(w)
      if (dow >= 0) { rrule = formatRrule({ freq: 'WEEKLY', interval: 1, byday: [dow], bymonthday: null }); hit(m) }
      else if (/^(zi|day)$/.test(w)) { rrule = 'FREQ=DAILY'; hit(m) }
      else if (/^(saptamana|week)$/.test(w)) { rrule = 'FREQ=WEEKLY'; hit(m) }
      else if (/^(luna|month)$/.test(w)) { rrule = 'FREQ=MONTHLY'; hit(m) }
      else if (/^(an|year)$/.test(w)) { rrule = 'FREQ=YEARLY'; hit(m) }
    }
  }

  // Zilele articulate, una sau mai multe: „lunea", „lunea și joia",
  // „luni, miercuri și vineri" NU intră aici (neaticulate = date), dar
  // „lunea, miercurea si vinerea" da.
  //
  // Legătura dintre zile nu se caută separat în tot textul — un „si"/„and"
  // legitim, scris de om ÎNAINTE sau DUPĂ enumerare („trimite si primește,
  // lunea si joia sala"), ar fi prins și șters în locul lui, iar titlul ar
  // pierde cuvintele omului, nu doar recurența. Se închid în schimb GOLURILE
  // dintre potriviri consecutive: dacă tot ce e între două zile e spații,
  // virgule și cel mult un „si"/„and", golul se punte și cele două rămân un
  // singur fragment continuu. Orice altceva între ele înseamnă că nu fac
  // parte din aceeași enumerare — spanurile rămân separate, fără punte.
  //
  // DOAR CINCI din șapte zile intră aici. „sâmbătă"/„sâmbăta" și
  // „duminică"/„duminica" se scriu IDENTIC după `fold()` (diacriticele cad),
  // deci pentru ele forma articulată nu mai e un semnal — „sâmbătă tuns",
  // scris în adăugarea rapidă, ar fi devenit o sarcină care se repetă la
  // infinit și pe care o bifă n-o închide. Rămân date obișnuite; ca recurență
  // se cer explicit („în fiecare sâmbătă", „every saturday"), iar marcajul
  // acela e prins de blocul de mai sus, care nu depinde de articulare.
  if (!rrule) {
    const dayRe = /\b(lunea|martea|miercurea|joia|vinerea)\b/g
    const found: { start: number; end: number; day: number }[] = []
    let mm: RegExpExecArray | null
    while ((mm = dayRe.exec(hay))) {
      found.push({ start: mm.index, end: mm.index + mm[0].length, day: DAYS_RO_ART.indexOf(mm[1]) })
    }
    if (found.length) {
      const days: number[] = []
      const glueGap = /^[\s,]*(?:(?:si|and)[\s,]*)?$/
      let spanStart = found[0].start
      let spanEnd = found[0].end
      days.push(found[0].day)
      for (let i = 1; i < found.length; i++) {
        const between = hay.slice(spanEnd, found[i].start)
        if (glueGap.test(between)) {
          spanEnd = found[i].end
        } else {
          spans.push([spanStart, spanEnd])
          spanStart = found[i].start
          spanEnd = found[i].end
        }
        if (!days.includes(found[i].day)) days.push(found[i].day)
      }
      spans.push([spanStart, spanEnd])
      rrule = formatRrule({ freq: 'WEEKLY', interval: 1, byday: days.sort((a, b) => a - b), bymonthday: null })
    }
  }

  // „zilnic", „daily", „săptămânal", „lunar", „anual"
  if (!rrule) {
    m = hay.match(/\b(?:zilnic|daily)\b/)
    if (m) { rrule = 'FREQ=DAILY'; hit(m) }
    m = hay.match(/\b(?:saptamanal|weekly)\b/)
    if (m) { rrule = 'FREQ=WEEKLY'; hit(m) }
    m = hay.match(/\b(?:lunar|monthly)\b/)
    if (m) { rrule = 'FREQ=MONTHLY'; hit(m) }
    m = hay.match(/\b(?:anual|yearly|annually)\b/)
    if (m) { rrule = 'FREQ=YEARLY'; hit(m) }
  }

  // „pe 15 ale lunii", „on the 15th"
  if (!rrule) {
    m = hay.match(/\bpe\s+(\d{1,2})\s+ale\s+lunii\b/) ?? hay.match(/\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
    if (m) {
      const d = Number(m[1])
      if (d >= 1 && d <= 31) {
        rrule = formatRrule({ freq: 'MONTHLY', interval: 1, byday: [], bymonthday: d })
        hit(m)
      }
    }
  }

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
  //
  // Orele pot purta și minute, într-un singur fragment: „in 1h30", „peste 1 h
  // 15 min", „într-o oră și 30 de minute", „peste o oră și jumătate". Altfel
  // „în 1 oră și 30 min" lua doar ora și lăsa „și 30 min" lipit de titlu.
  m = hay.match(/\b(?:peste|in|intr-?o)\s+(?:(\d+|o|una|un|an|a)\s*(?:de\s+)?)?(?:hours|hour|ore|ora|h)(?:(\d{1,2})|\s*(?:(?:si|and)\s+)?(\d+)\s*(?:de\s+)?(?:minutes|minute|minut|mins|min|m)|\s+(?:si|and)\s+(?:jumatate|jumate|a half))?\b/)
  if (m) {
    const extra = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : /jumat|half/.test(m[0]) ? 30 : 0
    const d = new Date(now)
    d.setHours(d.getHours() + qty(m[1]), d.getMinutes() + extra, 0, 0)
    day = d
    time = [d.getHours(), d.getMinutes()]
    hit(m)
  }
  m = time ? null : hay.match(/\b(?:peste|in|intr-?o)\s+(?:(\d+|o|una|un|an|a)\s*(?:de\s+)?)?(?:minutes|minute|minut|mins|min|m)\b/)
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
    // Un nume de zi care e DEJA înăuntrul unui fragment de recurență nu e o
    // dată separată: „în fiecare joi" e un singur lucru. Potrivirea asta a
    // doua era, până acum, singurul motiv pentru care „în fiecare joi" nimerea
    // ziua corectă — o întâmplare, fiindcă „joia" nu se potrivește cu
    // `\bjoi\b` și rămânea fără zi. Acum ziua de start vine din motor, la fel
    // pentru amândouă formele.
    const insideRecurrence = !!m && m.index !== undefined
      && spans.some(([s, e]) => m!.index! >= s && m!.index! + m![0].length <= e)
    if (m && !insideRecurrence) {
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

  // ── prima apariție a unei recurențe care NUMEȘTE o zi
  //
  // „vinerea raport" e vinerea care vine, „pe 15 ale lunii factura" e pe 15 —
  // nu azi. Regula „recurență fără dată ⇒ azi" e pentru recurențele care nu
  // numesc nimic (zilnic, lunar simplu); peste una care numește, ea producea o
  // scadență pe care n-a cerut-o nimeni, în „Azi", și pe care omul o acționa.
  //
  // Ziua se cere motorului, nu se calculează aici: un al doilea „care e
  // următoarea vineri" ar fi driftat de `nextOccurrence` în tăcere, exact
  // clasa de bug pentru care există `test:recurrence-sql`. O zi scrisă
  // explicit învinge, ca peste tot în funcția asta.
  if (!day && rrule) {
    const first = firstOccurrence(rrule, now)
    if (first) day = new Date(first)
  }

  // ── oră militară lipită: „at 1500", „la 0830", „ora 900".
  //
  // Se încearcă ÎNAINTE de forma cu două puncte: aceea nu poate prinde „1500"
  // oricum (`\b` nu există între cifre), deci ordinea nu ia nimic de la ea.
  //
  // Prefixul `la|ora|at` e OBLIGATORIU aici, spre deosebire de „14:30" care se
  // recunoaște singur: patru cifre lipite sunt de obicei o cantitate, nu o oră.
  // „cumpără 1500 de șuruburi" n-are voie să devină o scadență.
  //
  // Excluderea de unități e aceeași ca la ora liberă de mai jos, și tot dintr-un
  // motiv măsurat: „la 1000 zile" nu mai e recunoscut ca recurență (plafonul de
  // trei cifre), iar fără lookahead cădea AICI și devenea „azi la 10:00" — o
  // scadență pe care omul n-a cerut-o. Un interval prea mare nu produce nimic:
  // nici repetare, nici oră.
  m = hay.match(/\b(?:la|ora|at)\s*(\d{3,4})\b(?!\s*(?:de\s+)?(?:zile|zi|days|day|saptamani|saptamana|weeks|week|luni|luna|months|month|ani|an|years|year)\b)/)
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
  //
  // Excluderea de mai jos e ce ține „la 2 zile" o recurență, nu ora 2: fără ea,
  // acest tipar prinde „la 2" din „la 2 zile udă florile" ca oră liberă,
  // fiindcă regexul de recurență a consumat deja fragmentul, dar hay-ul pe care
  // caută acesta e neschimbat.
  if (!time) {
    m = hay.match(/\b(?:la|ora|at)\s*(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?\b(?!\s*(?:de\s+)?(?:zile|zi|days|day|saptamani|saptamana|weeks|week|luni|luna|months|month|ani|an|years|year)\b)/)
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
    return { title: raw.trim(), dueAt: null, allDay: true, rrule: null, spans: [], hasDay: false, hasTime: false }
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
  // `hasDay`/`hasTime` spun CE a fost scris, nu ce a ieșit: peste un tichet care
  // are deja o scadență (`mergeTitleDue`), „la 17" înseamnă „ora 17 în ziua
  // lui", iar ziua implicită de aici (azi, sau mâine după rostogolire) ar fi
  // mutat sarcina fără să fi cerut-o nimeni.
  return { title, dueAt: base.toISOString(), allDay: !time, rrule, spans: merged, hasDay: day !== null, hasTime: time !== null }
}
