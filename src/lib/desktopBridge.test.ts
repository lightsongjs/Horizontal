import { describe, expect, it } from 'vitest'
import { upcomingReminders } from './desktopBridge'
import type { Issue } from './types'

const now = new Date('2026-10-02T10:00:00.000Z')
const base: Issue = {
  id: 'HZ-1', projectId: 'p1', title: 'Sună la bancă', desc: '', theme: '', wave: 1, deps: [], done: false,
  selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-10-01T00:00:00.000Z',
  urgent: false, dueAt: '2026-10-02T12:00:00.000Z', allDay: false, remindAt: '2026-10-02T12:00:00.000Z', rrule: null,
}
const projects = [{ id: 'p1', name: 'Personal' }]
const at = (iso: string): Issue => ({ ...base, remindAt: iso })

describe('upcomingReminders', () => {
  it('un memento în următoarele 24 h intră, cu textul de pe web', () => {
    const [r] = upcomingReminders([base], projects, now)
    expect(r.id).toBe('HZ-1')
    expect(r.at).toBe('2026-10-02T12:00:00.000Z')
    expect(r.key).toBe('HZ-1@2026-10-02T12:00:00.000Z')
    expect(r.title).toBe('Sună la bancă')
    expect(r.body).toContain('Personal')
  })
  it('unul trecut, nebifat, intră — notificarea lui poate fi încă pe ecran', () => {
    expect(upcomingReminders([at('2026-10-02T07:00:00.000Z')], projects, now)).toHaveLength(1)
  })
  it('unul trecut de peste 24 h nu intră', () => {
    expect(upcomingReminders([at('2026-10-01T09:59:00.000Z')], projects, now)).toHaveLength(0)
  })
  it('unul peste mai mult de 24 h nu intră încă', () => {
    expect(upcomingReminders([at('2026-10-03T10:01:00.000Z')], projects, now)).toHaveLength(0)
  })
  it('o sarcină bifată sau fără memento nu intră', () => {
    expect(upcomingReminders([{ ...base, done: true }, { ...base, id: 'HZ-2', remindAt: null }], projects, now)).toHaveLength(0)
  })
  it('aceeași sarcină venită de două ori (dueIssues + proiect) dă un singur memento', () => {
    expect(upcomingReminders([base, { ...base }], projects, now)).toHaveLength(1)
  })
  it('sortate după oră', () => {
    const list = upcomingReminders([{ ...base, id: 'HZ-2', remindAt: '2026-10-02T15:00:00.000Z' }, base], projects, now)
    expect(list.map((r) => r.id)).toEqual(['HZ-1', 'HZ-2'])
  })
})

describe('upcomingReminders — fereastra Android', () => {
  const now2 = new Date('2026-10-02T09:00:00Z')
  const atH = (h: number) => new Date(now2.getTime() + h * 3_600_000).toISOString()
  const mk = (id: string, remindAt: string, extra: Partial<Issue> = {}) =>
    ({ id, title: id, projectId: 'p', done: false, remindAt, dueAt: remindAt, allDay: false, ...extra }) as Issue

  it('implicit rămâne 24 h, ca pe Linux', () => {
    expect(upcomingReminders([mk('A', atH(30))], [], now2)).toEqual([])
  })
  it('cu orizont de 7 zile ia și ce e peste 5 zile', () => {
    expect(upcomingReminders([mk('A', atH(120))], [], now2, { horizonMs: 7 * 24 * 3_600_000 }).map((r) => r.id)).toEqual(['A'])
  })
  it('plafonul păstrează cele mai APROPIATE, nu primele din listă', () => {
    const list = upcomingReminders([mk('C', atH(3)), mk('A', atH(1)), mk('B', atH(2))], [], now2, { limit: 2 })
    expect(list.map((r) => r.id)).toEqual(['A', 'B'])
  })
  it('poartă scadența și ziua întreagă, pentru amânarea din cutie', () => {
    const [r] = upcomingReminders([mk('A', atH(1), { dueAt: '2026-10-01T21:00:00.000Z', allDay: true })], [], now2)
    expect(r).toMatchObject({ dueAt: '2026-10-01T21:00:00.000Z', allDay: true })
  })
})
