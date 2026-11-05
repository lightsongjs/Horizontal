/**
 * Când un text schimbat e „același" pentru butonul de salvare: spațiile goale
 * nu sunt o modificare. Un spațiu lăsat la capătul titlului, un rând gol după
 * descriere sau un CRLF devenit LF nu aprind săgeata de salvare și nu cer
 * confirmare la închidere.
 */

/** Titlul: un singur rând — capetele nu contează, iar orice șir de spații e unul. */
export function sameTitle(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\s+/g, ' ').trim()
  return n(a) === n(b)
}

/**
 * Descrierea: spațiile de la capăt de rând și rândurile goale de la început și
 * de la sfârșit nu contează. Indentarea și rândurile goale din mijloc contează
 * — în markdown ele schimbă ce se vede (o listă imbricată, un paragraf nou).
 */
export function sameDesc(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '')
  return n(a) === n(b)
}
