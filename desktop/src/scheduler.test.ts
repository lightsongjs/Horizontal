import { describe, expect, it } from 'vitest'
import { HORIZON_MS, MISSED_WINDOW_MS, parseReminders, planReminders, type Reminder } from './scheduler'

const now = Date.parse('2026-10-02T10:00:00.000Z')
const r = (id: string, at: number): Reminder => ({ key: `${id}@${new Date(at).toISOString()}`, id, at, title: id, body: '' })
const none = new Set<string>()

describe('planReminders', () => {
  it('unul din viitor se armează cu întârzierea exactă', () => {
    const p = planReminders([r('A', now + 60_000)], now, none, none)
    expect(p.arm).toEqual([{ reminder: r('A', now + 60_000), delayMs: 60_000 }])
    expect(p.fireNow).toEqual([])
  })
  it('unul ratat de mai puțin de o oră sună acum', () => {
    expect(planReminders([r('A', now - 30 * 60_000)], now, none, none).fireNow.map((x) => x.id)).toEqual(['A'])
  })
  it('unul ratat de peste o oră se sare', () => {
    const p = planReminders([r('A', now - MISSED_WINDOW_MS - 1)], now, none, none)
    expect(p.fireNow).toEqual([])
    expect(p.arm).toEqual([])
  })
  it('unul deja sunat nu sună a doua oară, nici dacă pagina retrimite lista', () => {
    const a = r('A', now - 60_000)
    expect(planReminders([a], now, new Set([a.key]), none).fireNow).toEqual([])
  })
  it('unul dincolo de orizont nu se armează (pagina îl retrimite mai târziu)', () => {
    expect(planReminders([r('A', now + HORIZON_MS + 1)], now, none, none).arm).toEqual([])
  })
  it('o notificare afișată a cărei cheie a dispărut (bifată, amânată) se închide', () => {
    const old = r('A', now - 60_000)
    const snoozed = r('A', now + 5 * 60_000)
    const p = planReminders([snoozed], now, new Set([old.key]), new Set([old.key]))
    expect(p.close).toEqual([old.key])
    expect(p.arm.map((x) => x.reminder.key)).toEqual([snoozed.key])
  })
  it('o notificare nebifată, mai veche de o oră, încă în listă, nu se închide și nu sună iar', () => {
    const a = r('A', now - 2 * MISSED_WINDOW_MS)
    const p = planReminders([a], now, new Set([a.key]), new Set([a.key]))
    expect(p.close).toEqual([])
    expect(p.fireNow).toEqual([])
  })
  it('o notificare afișată încă în listă rămâne', () => {
    const a = r('A', now - 60_000)
    expect(planReminders([a], now, new Set([a.key]), new Set([a.key])).close).toEqual([])
  })
})

describe('parseReminders', () => {
  it('acceptă forma din pagină și convertește ora', () => {
    expect(parseReminders([{ key: 'A@x', id: 'A', at: '2026-10-02T10:00:00.000Z', title: 't', body: 'b' }]))
      .toEqual([{ key: 'A@x', id: 'A', at: now, title: 't', body: 'b' }])
  })
  it('păstrează `kind: event` (fără butoane), ignoră orice altă valoare', () => {
    expect(parseReminders([{ key: 'cal:e@x', id: 'cal:e', at: '2026-10-02T10:00:00.000Z', title: 't', body: 'b', kind: 'event' }]))
      .toEqual([{ key: 'cal:e@x', id: 'cal:e', at: now, title: 't', body: 'b', kind: 'event' }])
    expect(parseReminders([{ key: 'A@x', id: 'A', at: '2026-10-02T10:00:00.000Z', title: 't', body: 'b', kind: 'altceva' }])[0])
      .not.toHaveProperty('kind')
  })
  it('aruncă tot ce nu are forma — IPC-ul e o graniță', () => {
    expect(parseReminders('nu')).toEqual([])
    expect(parseReminders([{ id: 'A' }, null, { key: 'k', id: 'A', at: 'nu e dată', title: '', body: '' }])).toEqual([])
  })
})
