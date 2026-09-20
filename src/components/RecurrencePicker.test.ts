import { describe, expect, it } from 'vitest'
import { formatRrule } from '../lib/recurrence'
import { PRESETS, intervalFromText, presetOf, sanitizeIntervalText } from './RecurrencePicker'

describe('preseturi de repetare', () => {
  it('recunoaște presetul unui RRULE simplu', () => {
    expect(presetOf(null)).toBe('none')
    expect(presetOf('FREQ=DAILY')).toBe('FREQ=DAILY')
    expect(presetOf('FREQ=WEEKLY')).toBe('FREQ=WEEKLY')
    expect(presetOf('FREQ=MONTHLY')).toBe('FREQ=MONTHLY')
    expect(presetOf('FREQ=YEARLY')).toBe('FREQ=YEARLY')
  })

  it('orice altceva e „personalizat" — inclusiv un RRULE nerecunoscut', () => {
    expect(presetOf('FREQ=DAILY;INTERVAL=2')).toBe('custom')
    expect(presetOf('FREQ=WEEKLY;BYDAY=MO,TH')).toBe('custom')
    expect(presetOf('FREQ=DAILY;COUNT=3')).toBe('custom')
  })

  it('preseturile sunt exact cele cinci de pe rând', () => {
    expect(PRESETS.map((p) => p.value)).toEqual([null, 'FREQ=DAILY', 'FREQ=WEEKLY', 'FREQ=MONTHLY', 'FREQ=YEARLY'])
  })
})

describe('câmpul de interval — golul e un stadiu intermediar, nu se rotunjește', () => {
  it('golește complet, nu rămâne cu „1" rezidual', () => {
    expect(sanitizeIntervalText('')).toBe('')
  })

  it('regresie: șterge, apoi scrie „3" — trebuie „3", nu „13"', () => {
    // Înainte de fix, un câmp golit se rotunjea imediat la „1" (valoare
    // controlată), deci tasta următoare ateriza lângă „1" rezidual.
    let text = sanitizeIntervalText('') // userul șterge tot
    expect(text).toBe('')
    text = sanitizeIntervalText('3') // userul scrie „3" pe câmpul gol afișat
    expect(text).toBe('3')
    expect(intervalFromText(text)).toBe(3)
    expect(formatRrule({ freq: 'DAILY', interval: intervalFromText(text), byday: [], bymonthday: null }))
      .toBe('FREQ=DAILY;INTERVAL=3')
  })

  it('ține doar cifre, cel mult două', () => {
    expect(sanitizeIntervalText('12a3')).toBe('12')
    expect(sanitizeIntervalText('abc')).toBe('')
  })

  it('la compunerea RRULE, un gol sau „0" cade pe 1 — „Gata" nu rămâne mort', () => {
    expect(intervalFromText('')).toBe(1)
    expect(intervalFromText('0')).toBe(1)
    expect(intervalFromText('00')).toBe(1)
    expect(intervalFromText('3')).toBe(3)
  })
})
