import { describe, it, expect } from 'vitest'
import { fillFromTitle, type FillMemo } from './titleDueFill'

const F = (date: string, time: string) => ({ date, time })
const EMPTY = F('', '')

describe('fillFromTitle — tichet nou', () => {
  it('completează câmpurile goale din titlu și ține minte că erau goale', () => {
    const r = fillFromTitle(EMPTY, F('14/09/2026', '14:00'), null)
    expect(r.fields).toEqual(F('14/09/2026', '14:00'))
    expect(r.memo).toEqual({ wrote: F('14/09/2026', '14:00'), before: EMPTY })
  })

  it('golește câmpurile când titlul rămâne fără dată', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: EMPTY }
    const r = fillFromTitle(F('14/09/2026', '14:00'), null, memo)
    expect(r.fields).toEqual(EMPTY)
    expect(r.memo).toBeNull()
  })
})

describe('fillFromTitle — tichet cu scadență', () => {
  it('suprascrie scadența existentă și o ține minte ca bază', () => {
    const r = fillFromTitle(F('08/09/2026', '10:00'), F('14/09/2026', '14:00'), null)
    expect(r.fields).toEqual(F('14/09/2026', '14:00'))
    expect(r.memo).toEqual({
      wrote: F('14/09/2026', '14:00'),
      before: F('08/09/2026', '10:00'),
    })
  })

  it('revine la scadența dinainte când fragmentul dispare din titlu', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: F('08/09/2026', '10:00') }
    const r = fillFromTitle(F('14/09/2026', '14:00'), null, memo)
    expect(r.fields).toEqual(F('08/09/2026', '10:00'))
    expect(r.memo).toBeNull()
  })

  it('păstrează baza peste o a doua recunoaștere', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: F('08/09/2026', '10:00') }
    const r = fillFromTitle(F('14/09/2026', '14:00'), F('15/09/2026', ''), memo)
    expect(r.fields).toEqual(F('15/09/2026', ''))
    expect(r.memo).toEqual({ wrote: F('15/09/2026', ''), before: F('08/09/2026', '10:00') })
  })
})

describe('fillFromTitle — câmpul schimbat cu mâna', () => {
  it('nu retrage nimic dacă valorile nu mai sunt cele scrise de recunoaștere', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: EMPTY }
    const r = fillFromTitle(F('20/09/2026', '09:00'), null, memo)
    expect(r.fields).toEqual(F('20/09/2026', '09:00'))
    expect(r.memo).toBeNull()
  })

  it('ia valoarea scrisă cu mâna ca bază nouă', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: EMPTY }
    const r = fillFromTitle(F('20/09/2026', '09:00'), F('15/09/2026', ''), memo)
    expect(r.memo).toEqual({ wrote: F('15/09/2026', ''), before: F('20/09/2026', '09:00') })
  })
})

describe('fillFromTitle — fără memorie', () => {
  it('fără dată în titlu și fără memorie, câmpurile rămân neatinse', () => {
    const r = fillFromTitle(F('08/09/2026', '10:00'), null, null)
    expect(r.fields).toEqual(F('08/09/2026', '10:00'))
    expect(r.memo).toBeNull()
  })
})
