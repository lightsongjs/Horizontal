// Deep links pentru tickete: URL-ul unui ticket e doar id-ul lui, la rădăcină
// (ex. /MS-03). Vezi docs/superpowers/specs/2026-07-28-ticket-deep-links-design.md
//
// Id-urile de issue au forma PREFIX-SUFIX (TUR-01, MS-03, TUR-API) — exact o
// cratimă, doar litere și cifre. Regexul e deliberat strict ca un slug de
// proiect (my-super-project) să nu fie confundat cu un id de ticket.

const TICKET_PATH = /^\/([A-Za-z0-9]+-[A-Za-z0-9]+)\/?$/

/** Id-ul ticketului din pathname, normalizat uppercase, sau null. */
export function parseTicketPath(pathname: string): string | null {
  const match = TICKET_PATH.exec(pathname)
  return match ? match[1].toUpperCase() : null
}

/** Prefixul de proiect al unui id de issue: 'MS-03' -> 'MS'. */
export function prefixOf(issueId: string): string {
  const dash = issueId.indexOf('-')
  return (dash === -1 ? issueId : issueId.slice(0, dash)).toUpperCase()
}

/**
 * Proiectul căruia îi aparține un id de ticket, dedus din prefix. Un path de
 * ticket (/MS-03) nu conține proiectul, deci asta e singura cale de la URL la
 * proiect. Comparația ignoră caps-ul.
 *
 * Ambiguitate acceptată: dacă două proiecte împart prefixul, câștigă primul din
 * listă. În practică nu se poate întâmpla — `id`-ul unui proiect **este**
 * `prefix.toLowerCase()` și e cheie primară.
 */
export function resolveTicketProject<P extends { prefix: string }>(
  projects: readonly P[],
  ticketId: string,
): P | null {
  const prefix = prefixOf(ticketId)
  return projects.find((p) => p.prefix.toUpperCase() === prefix) ?? null
}

/** Path-ul canonic al unui ticket. */
export function ticketPath(issueId: string): string {
  return `/${issueId}`
}

/** URL absolut, pentru clipboard. */
export function ticketUrl(origin: string, issueId: string): string {
  return `${origin.replace(/\/$/, '')}${ticketPath(issueId)}`
}
