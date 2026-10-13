/**
 * Singurele scheme pe care le deschidem — aceeași regulă ca `openExternal` din
 * cutia Linux. Textul vine și de la unelte (ticket-kit), deci un
 * `javascript:` scris acolo rămâne text, nu link.
 */
export function safeHref(raw: string): string | null {
  const s = raw.trim()
  if (/^www\./i.test(s)) return `https://${s}`
  return /^(https?:|mailto:)/i.test(s) ? s : null
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `PREFIX-N` pentru prefixele cunoscute; un ID provizoriu (`HZ-~…`) nu se potrivește. */
export function refPattern(prefixes: readonly string[]): RegExp | null {
  const ps = prefixes.filter(Boolean)
  if (!ps.length) return null
  return new RegExp(`\\b(?:${ps.map(esc).join('|')})-\\d+\\b`, 'g')
}
