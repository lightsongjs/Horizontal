/** Convert a positive integer to a Roman numeral (I, II, III, IV, …). */
export function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let out = ''
  for (const [value, symbol] of map) {
    while (n >= value) {
      out += symbol
      n -= value
    }
  }
  return out
}

/**
 * Inversul lui `toRoman`, pentru numele valurilor (I, II, …). Un șir care nu e
 * cifră romană validă (gol, „MVP”, „IIII”) dă `null` — numele e text liber în
 * bază, deci nu orice val are o cifră.
 */
export function fromRoman(s: string): number | null {
  const t = s.trim().toUpperCase()
  if (!/^[MDCLXVI]+$/.test(t)) return null
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  let n = 0
  for (let i = 0; i < t.length; i++) {
    const cur = v[t[i]]
    const next = i + 1 < t.length ? v[t[i + 1]] : 0
    n += cur < next ? -cur : cur
  }
  // Forma canonică doar: „IIII” sau „VX” nu sunt cifre pe care le-am fi scris noi.
  return n > 0 && toRoman(n) === t ? n : null
}
