import { describe, expect, it } from 'vitest'
import { isHostToPane, isPaneToHost, paneSwitchTarget, sidebarMarks, type PaneRoute } from './paneProtocol'

const key = (code: string, key: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) =>
  ({ code, key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })

describe('paneSwitchTarget', () => {
  it('Ctrl+Shift+[ / ] după poziție: US `{ }`, RO `Ă Î` — aceeași tastă', () => {
    for (const k of ['{', 'Ă', 'ă']) expect(paneSwitchTarget(key('BracketLeft', k, { ctrlKey: true, shiftKey: true }))).toBe('L')
    for (const k of ['}', 'Î', 'î']) expect(paneSwitchTarget(key('BracketRight', k, { ctrlKey: true, shiftKey: true }))).toBe('R')
  })
  it('fără Ctrl+Shift, cu Alt (AltGr) sau Meta — nu e comutare; `[` simplu rămâne al valurilor', () => {
    expect(paneSwitchTarget(key('BracketLeft', '[', {}))).toBeNull()
    expect(paneSwitchTarget(key('BracketLeft', '[', { ctrlKey: true }))).toBeNull()
    expect(paneSwitchTarget(key('BracketLeft', '{', { shiftKey: true }))).toBeNull()
    expect(paneSwitchTarget(key('BracketLeft', '{', { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull()
    expect(paneSwitchTarget(key('BracketLeft', '{', { ctrlKey: true, shiftKey: true, metaKey: true }))).toBeNull()
    expect(paneSwitchTarget(key('KeyA', '[', { ctrlKey: true, shiftKey: true }))).toBeNull()
  })
})

describe('mesajele', () => {
  it('acceptă doar forma cunoscută', () => {
    expect(isPaneToHost({ hz: 'pane', kind: 'focus' })).toBe(true)
    expect(isPaneToHost({ hz: 'pane', kind: 'switch', to: 'R' })).toBe(true)
    expect(isPaneToHost({ hz: 'pane', kind: 'switch', to: 'X' })).toBe(false)
    expect(isPaneToHost({ hz: 'pane', kind: 'route', route: { path: '/', label: 'Azi' } })).toBe(true)
    expect(isPaneToHost({ hz: 'host', kind: 'focus' })).toBe(false)
    expect(isPaneToHost('focus')).toBe(false)
    expect(isPaneToHost(null)).toBe(false)
    expect(isHostToPane({ hz: 'host', kind: 'back' })).toBe(true)
    expect(isHostToPane({ hz: 'host', kind: 'open-path', path: 'https://rau.example/' })).toBe(false)
    expect(isHostToPane({ hz: 'host', kind: 'nav', action: { type: 'screen', screen: 'today' } })).toBe(true)
    expect(isHostToPane({ hz: 'host', kind: 'peer', otherTicketId: null, split: true, focused: false })).toBe(true)
    expect(isHostToPane({ type: 'reminder-action' })).toBe(false)
  })
})

describe('sidebarMarks', () => {
  const r = (screen: string | null, projectId: string | null): PaneRoute => ({ screen, projectId, ticketId: null, path: '/', state: null, label: '' })
  it('„on” = panoul cu focus, punct gri = celălalt; proiectul de sub o listă nu e „pe ecran”', () => {
    expect(sidebarMarks(r('today', 'p1'), r(null, 'p2'))).toEqual({ screen: 'today', projectId: null, otherScreen: null, otherProjectId: 'p2' })
    expect(sidebarMarks(r(null, 'p1'), null)).toEqual({ screen: null, projectId: 'p1', otherScreen: null, otherProjectId: null })
  })
})
