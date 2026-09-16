import { describe, expect, it } from 'vitest'
import { afterDelete, atEnd, step } from './gallery'

describe('step', () => {
  it('merge înainte și înapoi', () => {
    expect(step(5, 2, 1)).toBe(3)
    expect(step(5, 2, -1)).toBe(1)
  })

  it('se oprește la capete, nu ciclează', () => {
    expect(step(5, 4, 1)).toBe(4)
    expect(step(5, 0, -1)).toBe(0)
  })

  it('o galerie goală rămâne pe zero', () => {
    expect(step(0, 0, 1)).toBe(0)
    expect(step(0, 0, -1)).toBe(0)
  })
})

describe('atEnd', () => {
  it('doar ultima poziție', () => {
    expect(atEnd(3, 2)).toBe(true)
    expect(atEnd(3, 1)).toBe(false)
  })
})

describe('afterDelete', () => {
  it('ștergerea din mijloc lasă pe loc, adică pe următoarea', () => {
    // [a b c d] fără b → [a c d]; indexul 1 e acum c.
    expect(afterDelete(4, 1)).toBe(1)
  })

  it('ștergerea primei lasă pe prima din ce a rămas', () => {
    expect(afterDelete(4, 0)).toBe(0)
  })

  it('ștergerea ultimei dă înapoi cu una', () => {
    // [a b c] fără c → [a b]; ultimul index valid e 1.
    expect(afterDelete(3, 2)).toBe(1)
  })

  it('ștergerea singurei imagini închide vizualizatorul', () => {
    expect(afterDelete(1, 0)).toBeNull()
  })

  it('o listă deja goală n-are ce arăta', () => {
    expect(afterDelete(0, 0)).toBeNull()
  })
})
