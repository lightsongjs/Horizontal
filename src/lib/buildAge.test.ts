import { describe, expect, it } from 'vitest'
import { buildTitle, formatBuildAge } from './buildAge'

// Date LOCALE (constructorul cu componente), ca „ieri” să fie pe calendarul local.
const at = (d: number, h: number, m = 0, s = 0) => new Date(2026, 9, d, h, m, s)

describe('formatBuildAge', () => {
  const now = at(26, 14, 30)
  const cases: [Date, string][] = [
    [at(26, 14, 31), 'chiar acum'], // ceasul dispozitivului în urmă
    [at(26, 14, 30), 'chiar acum'],
    [at(26, 14, 29, 1), 'chiar acum'],
    [at(26, 14, 29), 'acum 1 min'],
    [at(26, 14, 28), 'acum 2 min'],
    [at(26, 14, 10), 'acum 20 min'],
    [at(26, 13, 31), 'acum 59 min'],
    [at(26, 13, 30), 'acum 1 oră'],
    [at(26, 12, 31), 'acum 1 oră'],
    [at(26, 12, 30), 'acum 2 ore'],
    [at(26, 0, 0), 'acum 14 ore'],
    [at(25, 23, 59), 'ieri'],
    [at(25, 0, 0), 'ieri'],
    [at(24, 23, 59), 'acum 2 zile'],
    [at(23, 15, 0), 'acum 3 zile'],
    [at(6, 15, 0), 'acum 20 de zile'],
  ]
  for (const [built, want] of cases) {
    it(`${built.toString().slice(4, 24)} → ${want}`, () => expect(formatBuildAge(built, now)).toBe(want))
  }

  it('peste miezul nopții, sub 6 ore rămân ore, nu „ieri”', () => {
    expect(formatBuildAge(at(25, 22, 0), at(26, 1, 0))).toBe('acum 3 ore')
    expect(formatBuildAge(at(25, 18, 0), at(26, 1, 0))).toBe('ieri')
  })

  it('20–23 de ore', () => {
    expect(formatBuildAge(at(26, 0, 0), at(26, 20, 0))).toBe('acum 20 de ore')
  })

  it('o dată invalidă nu scrie nimic', () => {
    expect(formatBuildAge(new Date('x'), now)).toBe('')
  })
})

describe('buildTitle', () => {
  it('data + commitul', () => {
    const t = buildTitle(at(26, 14, 5), 'c51486c')
    expect(t).toMatch(/^Versiunea construită pe .*26.*2026.*14:05 · c51486c$/)
  })
  it('fără commit', () => {
    expect(buildTitle(at(26, 14, 5), '')).not.toContain('·')
  })
  it('dată invalidă', () => {
    expect(buildTitle(new Date('x'), 'abc')).toBe('Versiune necunoscută')
  })
})
