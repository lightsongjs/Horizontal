import { describe, expect, it } from 'vitest'
import { paneIdFromSearch, paneViewKey } from './pane'

describe('paneIdFromSearch', () => {
  it('doar L / R', () => {
    expect(paneIdFromSearch('?pane=L')).toBe('L')
    expect(paneIdFromSearch('?x=1&pane=R')).toBe('R')
    expect(paneIdFromSearch('?pane=X')).toBeNull()
    expect(paneIdFromSearch('')).toBeNull()
  })
  it('cheile de ecran ale unui panou nu se ciocnesc cu ale aplicației', () => {
    expect(paneViewKey('L', 'horizontal:last-view')).toBe('horizontal:last-view:pane:L')
    expect(paneViewKey('L', 'horizontal:last-view')).not.toBe(paneViewKey('R', 'horizontal:last-view'))
  })
})
