import { describe, expect, it } from 'vitest'
import { connectErrorText, rowToEvent, rowsToAccounts, startErrorText } from './calendar'
import { OfflineError } from './offline/netError'

describe('rândurile din bază', () => {
  it('evenimentul: câmpuri lipsă devin null, nu undefined', () => {
    expect(rowToEvent({ id: 'e', calendar_id: 'c', title: null, all_day: true, start_date: '2026-10-12', end_date: '2026-10-13' })).toEqual({
      id: 'e', calendarId: 'c', title: '', allDay: true, startAt: null, endAt: null, startDate: '2026-10-12', endDate: '2026-10-13',
      location: null, meetUrl: null, htmlLink: null, response: null,
    })
  })
  it('conturile cu calendarele lor: principalul întâi, apoi alfabetic', () => {
    const a = rowsToAccounts(
      [{ id: 'a1', email: 'x@y.ro', status: 'reconnect' }, { id: 'a2', email: 'z@y.ro', status: 'ok' }],
      [
        { id: 'c3', account_id: 'a1', name: 'Zile', enabled: true, is_primary: false },
        { id: 'c1', account_id: 'a1', name: 'Mine', enabled: false, is_primary: true },
        { id: 'c2', account_id: 'a1', name: 'Echipa', enabled: true, is_primary: false, color: '#123456' },
      ],
    )
    expect(a.map((x) => [x.email, x.status, x.calendars.map((c) => c.id)])).toEqual([
      ['x@y.ro', 'reconnect', ['c1', 'c2', 'c3']],
      ['z@y.ro', 'ok', []],
    ])
    expect(a[0].calendars[1].color).toBe('#123456')
  })
})

describe('mesajele', () => {
  it('motivul întors de Google și erorile de start, în cuvinte', () => {
    expect(connectErrorText('denied')).toMatch(/anulat/)
    expect(connectErrorText(null)).toMatch(/n-a reușit/)
    expect(startErrorText(new OfflineError())).toMatch(/offline/)
    expect(startErrorText(new Error('not-configured'))).toMatch(/nu e configurată/)
  })
})
