import { describe, expect, it } from 'vitest'
import { dateItems, itemForKey, moveItems, pushDigit, rootItems, timeFromDigits, waveItems, type MenuTargets } from './actionMenu'

const base: MenuTargets = {
  count: 1, allUrgent: false, allPinned: false, allDone: false,
  waves: [{ number: 1, label: 'MVP' }, { number: 2, label: 'Next' }], wavesWhy: null,
  projects: [{ id: 'd', name: 'Inbox' }, { id: 'p', name: 'Apollo' }], moveWhy: null,
}

describe('rootItems', () => {
  it('literele = tastele directe, în ordinea machetei', () => {
    expect(rootItems(base).map((i) => i.key)).toEqual(['t', 'D', '-', '!', 'F', 'w', 'M', '@', 'r', 'x', 'y', 'Del'])
  })
  it('pe mai multe ținte, ce merge doar pe unul e stins cu motivul', () => {
    const it3 = rootItems({ ...base, count: 3 })
    const off = it3.filter((i) => i.disabled).map((i) => i.key)
    expect(off).toEqual(['M', '@', 'r', 'y'])
    expect(it3.find((i) => i.key === 'M')?.disabled).toBe('doar pe un tichet')
  })
  it('etichetele spun ce face rândul acum', () => {
    const all = rootItems({ ...base, allUrgent: true, allPinned: true, allDone: true })
    expect(all.find((i) => i.key === '!')?.label).toBe('Nu mai e urgent')
    expect(all.find((i) => i.key === 'F')?.label).toBe('Scoate de sus')
    expect(all.find((i) => i.key === 'x')?.label).toBe('Redeschide')
  })
  it('valul e stins fără valuri, cu motivul dat', () => {
    expect(rootItems({ ...base, waves: [], wavesWhy: 'tichete din proiecte diferite' }).find((i) => i.key === 'w')?.disabled)
      .toBe('tichete din proiecte diferite')
  })
  it('Del (și tasta Delete) e ștergerea', () => {
    expect(itemForKey(rootItems(base), 'Delete')?.action.kind).toBe('delete')
    expect(itemForKey(rootItems(base), 'Del')?.danger).toBe(true)
  })
})

describe('sub-meniuri', () => {
  it('data: a m l s c z -', () => {
    expect(dateItems(new Date(2026, 9, 18, 10)).map((i) => i.key)).toEqual(['a', 'm', 'l', 's', 'c', 'z', '-'])
  })
  it('+1 săptămână = azi + 7 zile, ora păstrată', () => {
    const s = dateItems(new Date(2026, 9, 18, 10)).find((i) => i.key === 's')!
    expect(s.action).toMatchObject({ kind: 'date', preset: { kind: 'pick', time: null } })
    const d = (s.action as { preset: { date: Date } }).preset.date
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 25])
  })
  it('valurile și proiectele, pe cifre', () => {
    expect(waveItems(base).map((i) => `${i.key}:${i.label}`)).toEqual(['1:MVP', '2:Next'])
    expect(moveItems(base).map((i) => i.key)).toEqual(['1', '2'])
  })
})

describe('ora din cifre', () => {
  const cases: [string, string | null][] = [
    ['9', '09:00'], ['15', '15:00'], ['930', '09:30'], ['1530', '15:30'], ['0', '00:00'],
    ['2400', null], ['1260', null], ['25', null], ['', null], ['12345', null],
  ]
  for (const [d, want] of cases) it(`${d || '(gol)'} → ${want}`, () => expect(timeFromDigits(d)).toBe(want))
  it('a cincea cifră o împinge afară pe prima', () => {
    expect(pushDigit('1530', '7')).toBe('5307')
    expect(pushDigit('15', '3')).toBe('153')
  })
})
