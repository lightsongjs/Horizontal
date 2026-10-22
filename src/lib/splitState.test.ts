import { describe, expect, it } from 'vitest'
import { deepLinkForPane, isSentinel, otherPane, parseSplit, seedFor, sentinelState } from './splitState'

describe('parseSplit', () => {
  it('reîncărcarea reface DOUĂ panouri și focusul; orice altceva = un singur panou', () => {
    expect(parseSplit('{"panes":["L","R"],"focus":"R"}')).toEqual({ panes: ['L', 'R'], focus: 'R' })
    expect(parseSplit(null)).toBeNull() // pornire rece: sessionStorage gol
    expect(parseSplit('{"panes":["R"],"focus":"R"}')).toBeNull()
    expect(parseSplit('{"panes":["L","L"],"focus":"L"}')).toBeNull()
    expect(parseSplit('{"panes":["L","R"],"focus":"X"}')).toBeNull()
    expect(parseSplit('nu e json')).toBeNull()
  })
  it('otherPane', () => { expect(otherPane('L')).toBe('R'); expect(otherPane('R')).toBe('L') })
})

describe('santinela', () => {
  it('se recunoaște după marcaj, își poartă adâncimea', () => {
    expect(isSentinel(sentinelState(3))).toBe(true)
    expect(sentinelState(3).hzDepth).toBe(3)
    expect(isSentinel({ hzDepth: 3 })).toBe(false)
    expect(isSentinel(null)).toBe(false)
  })
})

describe('deepLinkForPane', () => {
  const ticket = (p: string) => /^\/[A-Z]+-\d+$/.test(p)
  it('o reîncărcare ignoră calea (e doar ruta panoului); o navigare cu tichet îl deschide în panou', () => {
    expect(deepLinkForPane('reload', '/HZ-12', ticket)).toBeNull()
    expect(deepLinkForPane('back_forward', '/HZ-12', ticket)).toBeNull()
    expect(deepLinkForPane('navigate', '/HZ-12', ticket)).toBe('/HZ-12')
    expect(deepLinkForPane('navigate', '/', ticket)).toBeNull()
  })
})

describe('seedFor', () => {
  it('tichetul trece în stânga, peste ecranul pe care era; dreapta = același ecran fără tichet', () => {
    const here = { screen: 'today', projectSlug: 'acasa', ticketId: 'HZ-12' }
    expect(seedFor(here, true)).toEqual({ path: '/HZ-12', state: { hzDepth: 0 }, lastView: 'smart:today', lastProject: 'acasa' })
    expect(seedFor(here, false)).toEqual({ path: '/', state: { hzDepth: 0, hzScreen: 'today' }, lastView: 'smart:today', lastProject: 'acasa' })
  })
  it('pe un proiect: calea proiectului, fără ecran memorat', () => {
    expect(seedFor({ screen: null, projectSlug: 'acasa', ticketId: null }, false))
      .toEqual({ path: '/project/acasa', state: { hzDepth: 0 }, lastView: null, lastProject: 'acasa' })
  })
})
