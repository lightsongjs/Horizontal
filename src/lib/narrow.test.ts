import { describe, expect, it } from 'vitest'
import { isNarrow, NARROW_QUERY } from './narrow'
import css from '../styles.css?raw'

describe('isNarrow', () => {
  it('urmează viewportul, dar un panou al panoului dublu nu e niciodată telefon', () => {
    expect(isNarrow(true, false)).toBe(true)
    expect(isNarrow(false, false)).toBe(false)
    expect(isNarrow(true, true)).toBe(false)
    expect(isNarrow(false, true)).toBe(false)
  })
  it('pragul e cel de dinainte', () => expect(NARROW_QUERY).toBe('(max-width: 899px)'))
})

describe('styles.css nu mai întreabă viewportul pentru telefon/desktop', () => {
  // În panoul dublu un iframe de ~570px ar fi „telefon" pentru un @media.
  // Regulile noi: `:where(html[data-narrow]) …` / `:where(html:not([data-narrow])) …`.
  it('niciun @media cu 899px / 900px', () => {
    const bad = css.split('\n').filter((l) => /@media[^{]*\b(899|900)px/.test(l))
    expect(bad).toEqual([])
  })
})

describe('componentele întreabă useNarrow, nu viewportul', () => {
  it('niciun matchMedia / useMediaQuery cu 899px în .tsx', () => {
    const files = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const bad = Object.entries(files).filter(([f, src]) => !f.includes('.test.') && /(useMediaQuery|matchMedia)\(\s*['"]\(max-width: 899px\)/.test(src)).map(([f]) => f)
    expect(bad).toEqual([])
  })
})
