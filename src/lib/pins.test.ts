import { describe, expect, it } from 'vitest'
import { dragShift, dropIndex, isPinned, livePins, movePin, nextPinPosition, pinKey, withPin, withoutPin, withPositions, type Pin } from './pins'

describe('pins', () => {
  it('fixarea adaugă la coadă, în ordinea fixării', () => {
    let pins: Pin[] = []
    pins = withPin(pins, 'project', 'hz')
    pins = withPin(pins, 'filter', 'f1')
    expect(pins.map((p) => [p.ref, p.position])).toEqual([['hz', 0], ['f1', 1]])
  })

  it('o a doua fixare a aceluiași lucru nu-l mută', () => {
    const pins = withPin(withPin([], 'project', 'hz'), 'filter', 'f1')
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
    expect(livePins(pins, { projects: ['b'], filters: ['f1'] }).map((p) => p.ref)).toEqual(['f1', 'b'])
  })

  it('listele fixate înainte (7 zile, Ale mele) ies din „Fixate", ordinea proiectelor rămâne', () => {
    // Așa arăta un cont pe 2026-11-06: navigarea amestecată printre proiecte.
    const pins: Pin[] = [
      { kind: 'project', ref: 'colleg', position: 0 },
      { kind: 'list', ref: 'week', position: 1 },
      { kind: 'project', ref: 'neveon', position: 2 },
      { kind: 'list', ref: 'inbox', position: 3 },
      { kind: 'project', ref: 'inbox', position: 4 },
      { kind: 'filter', ref: 'f1', position: 5 },
      { kind: 'list', ref: 'viitor', position: 6 },
    ]
    const known = { projects: ['colleg', 'neveon', 'inbox'], filters: ['f1'] }
    const shown = livePins(pins, known)
    expect(shown.map(pinKey)).toEqual(['project:colleg', 'project:neveon', 'project:inbox', 'filter:f1'])
    // Tras de mână după asta: renumerotează doar ce se vede, listele vechi
    // rămân neatinse în bază și tot nu se arată.
    const moved = movePin(shown, 'filter:f1', 0)
    expect(moved.map(pinKey)).not.toContain('project:c')
    expect(livePins(withPositions(pins, moved), known).map(pinKey))
      .toEqual(['filter:f1', 'project:colleg', 'project:neveon', 'project:inbox'])
  })

  describe('movePin (ordinea trasă de mână)', () => {
    const live: Pin[] = [
      { kind: 'project', ref: 'a', position: 0 },
      { kind: 'project', ref: 'c', position: 1 },
      { kind: 'filter', ref: 'f', position: 2 },
      { kind: 'project', ref: 'd', position: 5 },
    ]
    const keys = (ps: Pin[]) => [...ps].sort((x, y) => x.position - y.position).map(pinKey)

    it('mutat sus: ordinea nouă, scrise doar pozițiile schimbate', () => {
      const moved = movePin(live, 'filter:f', 0)
      expect(keys(withPositions(live, moved))).toEqual(['filter:f', 'project:a', 'project:c', 'project:d'])
      expect(moved).toEqual([
        { kind: 'filter', ref: 'f', position: 0 },
        { kind: 'project', ref: 'a', position: 1 },
        { kind: 'project', ref: 'c', position: 2 },
        { kind: 'project', ref: 'd', position: 3 },
      ])
    })

    it('mutat jos și la mijloc', () => {
      expect(keys(withPositions(live, movePin(live, 'project:a', 3)))).toEqual(['project:c', 'filter:f', 'project:d', 'project:a'])
      expect(keys(withPositions(live, movePin(live, 'project:a', 1)))).toEqual(['project:c', 'project:a', 'filter:f', 'project:d'])
    })

    it('pe loc, sau o cheie necunoscută: nicio scriere', () => {
      expect(movePin(live, 'project:c', 1)).toEqual([])
      expect(movePin(live, 'project:zz', 0)).toEqual([])
    })

    it('un loc în afara listei se taie la capăt', () => {
      expect(keys(withPositions(live, movePin(live, 'project:a', 99)))[3]).toBe('project:a')
      expect(keys(withPositions(live, movePin(live, 'project:d', -4)))[0]).toBe('project:d')
    })

    it('o fixare nouă după mutare rămâne la coadă, orfanele nu se scriu', () => {
      const all: Pin[] = [...live, { kind: 'project', ref: 'gone', position: 3 }]
      const shown = livePins(all, { projects: ['a', 'c', 'd'], filters: ['f'] })
      const moved = movePin(shown, 'project:d', 0)
      expect(moved.map(pinKey)).not.toContain('project:gone')
      const after = withPin(withPositions(all, moved), 'project', 'new')
      expect(livePins(after, { projects: ['a', 'c', 'd', 'new'], filters: ['f'] }).map(pinKey).slice(-1)[0]).toBe('project:new')
    })
  })

  it('dropIndex / dragShift: ținta și locul făcut celorlalți', () => {
    const mids = [10, 30, 50, 70]
    expect(dropIndex(mids, 0, 55)).toBe(2)
    expect(dropIndex(mids, 3, 5)).toBe(0)
    expect([0, 1, 2, 3].map((j) => dragShift(j, 0, 2, 20))).toEqual([0, -20, -20, 0])
    expect([0, 1, 2, 3].map((j) => dragShift(j, 3, 1, 20))).toEqual([0, 20, 20, 0])
  })
})
