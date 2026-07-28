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

/** Path-ul canonic al unui ticket. */
export function ticketPath(issueId: string): string {
  return `/${issueId}`
}

/** URL absolut, pentru clipboard. */
export function ticketUrl(origin: string, issueId: string): string {
  return `${origin.replace(/\/$/, '')}${ticketPath(issueId)}`
}
