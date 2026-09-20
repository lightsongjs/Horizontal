import { describe, expect, it } from 'vitest'
import { FIXTURES } from './recurrence.fixtures'
import { describeRrule, didJumpOnComplete, formatRrule, jumpNotice, nextOccurrence, parseRrule } from './recurrence'

// Luni, 24 august 2026 — aceeași ancoră ca în `schedule.test.ts`.
const NOW = new Date(2026, 7, 24, 8, 40)

/** Ce zi locală a ieșit, în forma `2026-08-25 09:00`. Compararea de ISO-uri ar
 *  fi ascuns exact bug-ul de fus pe care testele astea îl caută. */
function local(s: string | null): string | null {
  if (!s) return null
  const d = new Date(s)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

describe('parseRrule', () => {
  it('citește subsetul acceptat', () => {
    expect(parseRrule('FREQ=DAILY')).toEqual({ freq: 'DAILY', interval: 1, byday: [], bymonthday: null })
    expect(parseRrule('FREQ=DAILY;INTERVAL=2')).toMatchObject({ freq: 'DAILY', interval: 2 })
    expect(parseRrule('FREQ=WEEKLY;BYDAY=MO,TH')).toMatchObject({ freq: 'WEEKLY', byday: [1, 4] })
    expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=15')).toMatchObject({ freq: 'MONTHLY', bymonthday: 15 })
    expect(parseRrule('FREQ=YEARLY')).toMatchObject({ freq: 'YEARLY' })
  })

  it('refuză ce nu tratează — un RRULE nerecunoscut e ca unul absent', () => {
    expect(parseRrule(null)).toBeNull()
    expect(parseRrule('')).toBeNull()
    expect(parseRrule('FREQ=HOURLY')).toBeNull()
    // UNTIL/COUNT ar mărgini seria; a le ignora ar transforma o serie finită
    // într-una infinită — mai rău decât a nu o repeta deloc.
    expect(parseRrule('FREQ=DAILY;UNTIL=20261231T000000Z')).toBeNull()
    expect(parseRrule('FREQ=DAILY;COUNT=10')).toBeNull()
    expect(parseRrule('FREQ=MONTHLY;BYSETPOS=3;BYDAY=TU')).toBeNull()
    expect(parseRrule('FREQ=DAILY;INTERVAL=0')).toBeNull()
  })

  it('face drumul dus-întors', () => {
    for (const s of ['FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=WEEKLY;BYDAY=MO,TH',
                     'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', 'FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=YEARLY']) {
      expect(formatRrule(parseRrule(s)!)).toBe(s)
    }
  })
})

describe('describeRrule', () => {
  it('spune în română ce s-a ales', () => {
    expect(describeRrule('FREQ=DAILY')).toBe('zilnic')
    expect(describeRrule('FREQ=DAILY;INTERVAL=2')).toBe('la 2 zile')
    expect(describeRrule('FREQ=WEEKLY')).toBe('săptămânal')
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO')).toBe('lunea')
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO,TH')).toBe('lunea și joia')
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('lunea, miercurea și vinerea')
    expect(describeRrule('FREQ=WEEKLY;INTERVAL=2')).toBe('la 2 săptămâni')
    expect(describeRrule('FREQ=MONTHLY')).toBe('lunar')
    expect(describeRrule('FREQ=MONTHLY;BYMONTHDAY=15')).toBe('pe 15 ale lunii')
    expect(describeRrule('FREQ=YEARLY')).toBe('anual')
    expect(describeRrule('FREQ=HOURLY')).toBe('')
  })
})

describe('nextOccurrence', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      expect(local(nextOccurrence(f.rrule, new Date(f.from), f.due))).toBe(f.want)
    })
  }

  it('fără scadență nu are de unde pleca', () => {
    expect(nextOccurrence('FREQ=DAILY', NOW, null)).toBeNull()
  })
})

describe('jumpNotice', () => {
  it('spune când revine', () => {
    // `toShortDate` dă `zz/ll`, verificat o dată la scriere — nu ghicit.
    expect(jumpNotice(new Date(2026, 7, 25, 9, 0).toISOString())).toBe('Gata · revine 25/08')
  })
})

describe('didJumpOnComplete', () => {
  const AZI = '2026-08-24T06:00:00.000Z'
  const MAINE = '2026-08-25T06:00:00.000Z'

  it('un salt real: cerut done, întors nu-done, scadență nouă', () => {
    expect(didJumpOnComplete(true, AZI, { done: false, dueAt: MAINE })).toBe(true)
  })

  it('o bifă obișnuită, pe o sarcină fără recurență: rândul rămâne done', () => {
    expect(didJumpOnComplete(true, AZI, { done: true, dueAt: AZI })).toBe(false)
  })

  it('serverul normalizează dueAt fără să sară — done rămâne true', () => {
    // Scadența s-a schimbat (fus, rotunjire), dar triggerul nu s-a declanșat:
    // fără `done: false` în răspuns, o simplă diferență de dată nu e un salt.
    expect(didJumpOnComplete(true, AZI, { done: true, dueAt: MAINE })).toBe(false)
  })

  it('o scriere picată: niciun răspuns, niciun salt', () => {
    expect(didJumpOnComplete(true, AZI, null)).toBe(false)
  })

  it('o debifare nu sare niciodată, chiar dacă scadența diferă', () => {
    expect(didJumpOnComplete(false, AZI, { done: false, dueAt: MAINE })).toBe(false)
  })
})
