import { describe, expect, it } from 'vitest'
import { PRESETS, presetOf } from './RecurrencePicker'

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
