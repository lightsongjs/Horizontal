import { describe, expect, it } from 'vitest'
import { notifyActions } from './notifyActions'
import type { Reminder } from './scheduler'

const base: Reminder = { key: 'D-1@2026-11-10T05:50:00.000Z', id: 'D-1', at: 0, title: 'M', body: '' }
/** Butoanele vizibile: perechi (cheie, etichetă), fără `default` (clicul pe corp). */
const buttons = (a: string[]) => a.reduce<string[]>((out, x, i) => (i % 2 === 0 && x !== 'default' ? [...out, x] : out), [])

describe('notifyActions', () => {
  // Bugul din 10 nov. 2026: notificarea seriei e rezidentă (stă pe ecran până
  // la un clic), iar singurul ei buton era „Gata azi". Clicul care „închide
  // notificarea" bifa tichetul și oprea toată seria după primul ping.
  it('un ping de serie are un buton care doar închide pingul, înaintea lui „Gata azi"', () => {
    const b = buttons(notifyActions({ ...base, series: true }))
    expect(b).toEqual(['seen', 'done'])
  })
  it('un memento obișnuit: Gata și cele două amânări (GNOME arată cel mult 3)', () => {
    expect(buttons(notifyActions(base))).toEqual(['done', 'snooze15', 'snooze30'])
  })
  it('un eveniment: doar deschiderea', () => {
    expect(buttons(notifyActions({ ...base, kind: 'event' }))).toEqual([])
  })
  it('perechile sunt (cheie, etichetă) și încep cu `default`', () => {
    const a = notifyActions({ ...base, series: true })
    expect(a.length % 2).toBe(0)
    expect(a.slice(0, 2)).toEqual(['default', 'Deschide'])
    expect(a).toContain('Am văzut')
    expect(a).toContain('Gata azi')
  })
})
