import { describe, expect, it } from 'vitest'
import { isPinned, livePins, nextPinPosition, withPin, withoutPin, type Pin } from './pins'

describe('pins', () => {
  it('fixarea adaugă la coadă, în ordinea fixării', () => {
    let pins: Pin[] = []
    pins = withPin(pins, 'project', 'hz')
    pins = withPin(pins, 'list', 'week')
    expect(pins.map((p) => [p.ref, p.position])).toEqual([['hz', 0], ['week', 1]])
  })

  it('o a doua fixare a aceluiași lucru nu-l mută', () => {
    const pins = withPin(withPin([], 'project', 'hz'), 'list', 'week')
    expect(withPin(pins, 'project', 'hz')).toEqual(pins)
  })

  it('desprinderea scoate doar ce trebuie', () => {
    const pins = withPin(withPin([], 'project', 'hz'), 'filter', 'hz')
    expect(withoutPin(pins, 'project', 'hz')).toEqual([{ kind: 'filter', ref: 'hz', position: 1 }])
    expect(isPinned(withoutPin(pins, 'project', 'hz'), 'project', 'hz')).toBe(false)
  })

  it('poziția nouă vine după cea mai mare, nu după număr', () => {
    expect(nextPinPosition([])).toBe(0)
    expect(nextPinPosition([{ kind: 'list', ref: 'week', position: 7 }])).toBe(8)
  })

  it('livePins ascunde ce nu mai există și sortează după poziție', () => {
    const pins: Pin[] = [
      { kind: 'filter', ref: 'f-gone', position: 0 },
      { kind: 'project', ref: 'b', position: 3 },
      { kind: 'list', ref: 'week', position: 1 },
      { kind: 'list', ref: 'today', position: 2 },
      { kind: 'project', ref: 'gone', position: 4 },
      { kind: 'filter', ref: 'f1', position: 2 },
    ]
    expect(livePins(pins, { projects: ['b'], filters: ['f1'] }).map((p) => p.ref)).toEqual(['week', 'f1', 'b'])
  })
})
