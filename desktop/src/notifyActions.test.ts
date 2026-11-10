import { describe, expect, it } from 'vitest'
import { notifyActions } from './notifyActions'
import type { Reminder } from './scheduler'

const base: Reminder = { key: 'D-1@2026-11-10T05:50:00.000Z', id: 'D-1', at: 0, title: 'M', body: '' }
/** Butoanele vizibile, ca perechi [cheie, etichetă], fără `default` (clicul pe corp). */
const buttons = (a: string[]) => {
  const out: [string, string][] = []
  for (let i = 0; i < a.length; i += 2) if (a[i] !== 'default') out.push([a[i], a[i + 1]])
  return out
}

describe('notifyActions', () => {
  // Bugul din 10 nov. 2026: notificarea seriei e rezidentă (stă pe ecran până
  // la un clic), iar singurul ei buton era „Gata azi", care bifa tichetul —
  // seria murea după primul ping. „Gata" pe un ping = am văzut pingul ăsta.
  it('un ping de serie: un singur buton, „Gata", care doar închide pingul (nu bifează)', () => {
    expect(buttons(notifyActions({ ...base, series: true }))).toEqual([['seen', 'Gata']])
  })
  it('un memento obișnuit: „Gata" bifează, plus cele două amânări (GNOME arată cel mult 3)', () => {
    expect(buttons(notifyActions(base))).toEqual([['done', 'Gata'], ['snooze15', '15 min'], ['snooze30', '30 min']])
  })
  it('un eveniment: doar deschiderea', () => {
    expect(buttons(notifyActions({ ...base, kind: 'event' }))).toEqual([])
  })
  it('clicul pe corp deschide tichetul', () => {
    expect(notifyActions({ ...base, series: true }).slice(0, 2)).toEqual(['default', 'Deschide'])
  })
})
