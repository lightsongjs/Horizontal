import { describe, expect, it } from 'vitest'
import { addMenuItems, datePresets, recurChipLabel, visibleChips, type ChipInput } from './formChips'

const empty: ChipInput = {
  hasDue: false, hasTime: false, reminder: 'none', rrule: null,
  waveCount: 1, hasTheme: false, hasAssignee: false, urgent: false,
}

describe('visibleChips', () => {
  it('un tichet gol din Inbox arată doar jetonul-fantomă de dată', () => {
    expect(visibleChips(empty)).toEqual(['due'])
  })

  it('valul apare doar când există ce alege', () => {
    expect(visibleChips({ ...empty, waveCount: 2 })).toEqual(['due', 'wave'])
  })

  it('mementoul apare numai peste o scadență CU oră și cu memento pus', () => {
    expect(visibleChips({ ...empty, hasDue: true, hasTime: false, reminder: 'due' })).toEqual(['due'])
    expect(visibleChips({ ...empty, hasDue: true, hasTime: true, reminder: 'none' })).toEqual(['due'])
    expect(visibleChips({ ...empty, hasDue: true, hasTime: true, reminder: 'm30' })).toEqual(['due', 'reminder'])
  })

  it('recurența fără dată nu se arată (nu se salvează nici ea)', () => {
    expect(visibleChips({ ...empty, rrule: 'FREQ=DAILY' })).toEqual(['due'])
    expect(visibleChips({ ...empty, hasDue: true, rrule: 'FREQ=DAILY' })).toEqual(['due', 'recur'])
  })

  it('tot setat, în ordinea din rând', () => {
    expect(visibleChips({
      hasDue: true, hasTime: true, reminder: 'due', rrule: 'FREQ=WEEKLY',
      waveCount: 3, hasTheme: true, hasAssignee: true, urgent: true,
    })).toEqual(['due', 'reminder', 'recur', 'wave', 'theme', 'assignee', 'urgent'])
  })
})

describe('addMenuItems', () => {
  it('oferă doar ce lipsește; urgentul e mereu un comutator', () => {
    expect(addMenuItems({ hasTheme: false, hasAssignee: false })).toEqual(['theme', 'assignee', 'urgent'])
    expect(addMenuItems({ hasTheme: true, hasAssignee: true })).toEqual(['urgent'])
  })
})

describe('etichete', () => {
  it('recurența, cu majusculă; una nerecunoscută rămâne „Se repetă"', () => {
    expect(recurChipLabel('FREQ=WEEKLY')).toBe('Săptămânal')
    expect(recurChipLabel('FREQ=DAILY;COUNT=3')).toBe('Se repetă')
  })

  it('valul: nume scurte primesc „Val", cele lungi rămân', () => {
  })
})

describe('datePresets', () => {
  // Miercuri, 14 octombrie 2026, 15:00 (ora locală).
  const NOW = new Date(2026, 9, 14, 15)
  it('Azi · Mâine · Luni · +1 săpt., la miezul nopții local', () => {
    const p = datePresets(NOW)
    expect(p.map((x) => x.label)).toEqual(['Azi', 'Mâine', 'Luni', '+1 săpt.'])
    expect(p.map((x) => x.sub)).toEqual(['mie 14', 'joi 15', '19 oct', '21 oct'])
    expect(p[0].date).toEqual(new Date(2026, 9, 14))
    expect(p[2].date).toEqual(new Date(2026, 9, 19))
  })
})
