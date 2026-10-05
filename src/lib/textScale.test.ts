import { describe, it, expect } from 'vitest'
import css from '../styles.css?raw'
import { parseTextScale } from './textScale'

describe('parseTextScale', () => {
  it('citește o treaptă cunoscută', () => {
    expect(parseTextScale('1.3')).toBe(1.3)
  })

  it('nimic salvat, sau o valoare străină → Normal', () => {
    expect(parseTextScale(null)).toBe(1)
    expect(parseTextScale('2')).toBe(1)
    expect(parseTextScale('mare')).toBe(1)
  })
})

describe('styles.css', () => {
  // Un `font-size` în px fix nu crește odată cu setarea — iar textul acela
  // rămâne mic exact pentru omul care a cerut să-l mărească.
  it('orice font-size în px trece prin --text-scale', () => {
    const fixed = css.match(/font-size:\s*[\d.]+px/g) ?? []
    expect(fixed).toEqual([])
  })

  it('și stilurile inline din componente', () => {
    const files = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const fixed = Object.entries(files).flatMap(([f, src]) =>
      (src.match(/fontSize:\s*[^,}]+/g) ?? []).filter((m) => !m.includes('var(--text-scale)')).map((m) => `${f}: ${m}`),
    )
    expect(fixed).toEqual([])
  })
})
