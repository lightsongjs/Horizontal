import type { Assignee, Project } from './types'

/**
 * Semnele barei de captură: `#proiect`, `@persoană`, `!` (urgent). Pur, ca
 * `parseDue` — data rămâne a lui; aici se citește doar ce nu e dată. Un semn
 * se recunoaște numai la început de cuvânt (`ion@firma.ro`, `C#` rămân text),
 * iar unul care nu se potrivește cu nimic RĂMÂNE în titlu și e raportat în
 * `unknown`: mai bine un titlu cu „#zzz" decât o sarcină pusă în alt proiect.
 */
export interface CaptureTokens {
  title: string
  projectId: string | null
  assigneeId: string | null
  urgent: boolean
  unknown: string[]
}

export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Potrivirea, în ordinea încrederii: exact, apoi un singur candidat care începe așa. */
function pick<T extends { id: string }>(key: string, items: T[], exact: (t: T) => string[], starts: (t: T) => string[]): T | null {
  if (!key) return null
  const hits = items.filter((t) => exact(t).includes(key))
  // Doi „Alex" nu se aleg la nimereală: sarcina ar ajunge la omul greșit, în
  // tăcere. Ambiguitatea cade în `unknown`, unde omul o vede.
  if (hits.length > 1) return null
  if (hits.length === 1) return hits[0]
  const cands = items.filter((t) => starts(t).some((n) => n.startsWith(key)))
  return cands.length === 1 ? cands[0] : null
}

const TOKEN = /(^|\s)(?:([#@])([^\s#@!]+)|!(?=\s|$))/g

export function parseCaptureTokens(
  raw: string,
  projects: Pick<Project, 'id' | 'name' | 'prefix'>[],
  assignees: Pick<Assignee, 'id' | 'name'>[],
): CaptureTokens {
  let projectId: string | null = null
  let assigneeId: string | null = null
  let urgent = false
  const unknown: string[] = []
  const cut: [number, number][] = []
  for (const m of raw.matchAll(TOKEN)) {
    const start = m.index! + m[1].length
    const end = m.index! + m[0].length
    if (!m[2]) { if (!urgent) { urgent = true; cut.push([start, end]) } continue }
    const key = normalizeName(m[3])
    if (m[2] === '#') {
      if (projectId !== null) continue
      // Inbox se cheamă și după rol (`#inbox`, `#daily` — numele lui vechi), nu
      // doar după numele afișat: degetele țin minte cuvântul, nu redenumirea.
      const alias = (x: Pick<Project, 'id' | 'name'>) => (isInboxProject(x) ? INBOX_ALIASES : [])
      const p = pick(key, projects, (x) => [normalizeName(x.name), normalizeName(x.prefix), ...alias(x)], (x) => [normalizeName(x.name), ...alias(x)])
      if (p) { projectId = p.id; cut.push([start, end]) } else unknown.push(raw.slice(start, end))
    } else {
      if (assigneeId !== null) continue
      const words = (x: { name: string }) => x.name.split(/\s+/).map(normalizeName).filter(Boolean)
      const a = pick(key, assignees, (x) => [normalizeName(x.name), ...words(x)], (x) => [normalizeName(x.name), ...words(x)])
      if (a) { assigneeId = a.id; cut.push([start, end]) } else unknown.push(raw.slice(start, end))
    }
  }
  let title = ''
  let at = 0
  for (const [s, e] of cut) { title += raw.slice(at, s); at = e }
  title += raw.slice(at)
  return { title: title.replace(/\s+/g, ' ').trim(), projectId, assigneeId, urgent, unknown }
}

/**
 * Inbox: proiectul în care cade o captură fără proiect ales (fost „✅Daily").
 * Recunoscut întâi după id — numele e al omului și se schimbă (s-a schimbat o
 * dată, din „✅Daily" în „Inbox") —, apoi după nume, pentru baze fără rândul
 * `d` (modul local, fixtures). Aceeași regulă e în `core/Capture.kt`.
 */
export const INBOX_PROJECT_ID = 'd'
/** Cuvintele după care se cheamă Inbox, oricum l-ar numi omul (`#inbox`, `#daily`). */
export const INBOX_ALIASES = ['inbox', 'daily']

export function isInboxProject(p: Pick<Project, 'id' | 'name'>): boolean {
  return p.id === INBOX_PROJECT_ID || INBOX_ALIASES.includes(normalizeName(p.name))
}

export function inboxProjectId(projects: Pick<Project, 'id' | 'name'>[]): string | null {
  return (projects.find((p) => p.id === INBOX_PROJECT_ID) ?? projects.find(isInboxProject))?.id ?? null
}
