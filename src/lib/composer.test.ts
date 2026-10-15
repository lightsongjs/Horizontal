import { describe, expect, it } from 'vitest'
import { composerOpen, type ComposerState } from './composer'

const rest: ComposerState = { focused: false, body: '', pending: 0, busy: 0, to: undefined }

describe('composerOpen', () => {
  it('în repaus, goală și fără focus: un rând', () => {
    expect(composerOpen(rest)).toBe(false)
  })
  it('focusul o deschide', () => {
    expect(composerOpen({ ...rest, focused: true })).toBe(true)
  })
  it('numai spații nu țin caseta deschisă la blur', () => {
    expect(composerOpen({ ...rest, body: '  \n ' })).toBe(false)
  })
  it.each<[string, Partial<ComposerState>]>([
    ['text nescris', { body: 'ciornă' }],
    ['fișiere în așteptare', { pending: 1 }],
    ['o urcare în curs', { busy: 1 }],
    ['un destinatar ales', { to: 'a1' }],
    ['„Nimănui" ales (null e o alegere)', { to: null }],
  ])('rămâne deschisă la blur cu %s', (_, extra) => {
    expect(composerOpen({ ...rest, ...extra })).toBe(true)
  })
})
