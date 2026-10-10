import { describe, expect, it } from 'vitest'
import {
  decideEventReminder, eventIdFromReminderId, eventNotificationTitle, eventReminderId, eventReminderTimes,
  type EventReminderRow,
} from './eventReminders'

const START = Date.parse('2026-10-12T07:00:00Z')
const MIN = 60_000
const row = (o: Partial<EventReminderRow> = {}): EventReminderRow => ({
  id: 'e1', all_day: false, start_at: new Date(START).toISOString(), response: null,
  pre_sent_at: null, start_sent_at: null, ...o,
})

describe('decideEventReminder', () => {
  const cases: { name: string; row: EventReminderRow; at: number; want: ReturnType<typeof decideEventReminder> }[] = [
    { name: 'prea devreme', row: row(), at: START - 11 * MIN, want: { send: null, mark: { pre: false, start: false } } },
    { name: 'exact cu 10 min înainte', row: row(), at: START - 10 * MIN, want: { send: 'pre', mark: { pre: true, start: false } } },
    { name: 'pre deja trimis', row: row({ pre_sent_at: 'x' }), at: START - 5 * MIN, want: { send: null, mark: { pre: false, start: false } } },
    { name: 'la start', row: row({ pre_sent_at: 'x' }), at: START, want: { send: 'now', mark: { pre: false, start: true } } },
    { name: 'la start fără pre: marchează și pre', row: row(), at: START + MIN, want: { send: 'now', mark: { pre: true, start: true } } },
    { name: 'start deja trimis', row: row({ pre_sent_at: 'x', start_sent_at: 'y' }), at: START + 2 * MIN, want: { send: null, mark: { pre: false, start: false } } },
    { name: 'răsuflat: marcat, nu trimis', row: row(), at: START + 10 * MIN, want: { send: null, mark: { pre: true, start: true } } },
    { name: 'toată ziua: niciodată', row: row({ all_day: true }), at: START, want: { send: null, mark: { pre: false, start: false } } },
    { name: 'refuzat: niciodată', row: row({ response: 'declined' }), at: START, want: { send: null, mark: { pre: false, start: false } } },
    { name: 'tentativ: da', row: row({ response: 'tentative' }), at: START, want: { send: 'now', mark: { pre: true, start: true } } },
    { name: 'fără start', row: row({ start_at: null }), at: START, want: { send: null, mark: { pre: false, start: false } } },
  ]
  for (const c of cases) it(c.name, () => expect(decideEventReminder(c.row, c.at)).toEqual(c.want))
})

describe('textul și id-ul', () => {
  it('titlurile', () => {
    expect(eventNotificationTitle('pre', 'Ședință')).toBe('Peste 10 min: Ședință')
    expect(eventNotificationTitle('now', '  ')).toBe('Acum: Eveniment fără titlu')
  })
  it('momentele', () => {
    expect(eventReminderTimes('2026-10-12T07:00:00Z')).toEqual([
      { stage: 'pre', at: START - 10 * MIN }, { stage: 'now', at: START },
    ])
    expect(eventReminderTimes('nu')).toEqual([])
  })
  it('id-ul dus-întors', () => {
    expect(eventIdFromReminderId(eventReminderId('abc'))).toBe('abc')
    expect(eventIdFromReminderId('HZ-1')).toBeNull()
  })
})
