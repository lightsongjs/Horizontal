// functions/api/_thread-lib.ts
// Firul unui tichet pe API (comentarii + pase): regulile pure — corpul cererii,
// autorul și forma răspunsului. Rețeaua stă în `tickets/[id]/comments.ts`.
//
// Autorul: `author_id` e un cont (`auth.users`); numele vine din rândul
// `assignees` legat de cont (`user_id`), ca `authorDisplay` din src/lib/thread.ts.
// API-ul scrie MEREU în numele unui om (`author` din corp — `tk` trimite omul
// configurat pe calculator), deci un rând fără autor e numai o notă mutată din
// vechiul câmp `notes` (migration-comments.sql §10).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface EventRow {
  id: string
  kind: 'comment' | 'handoff'
  author_id: string | null
  body: string | null
  handoff_from: string | null
  handoff_to: string | null
  created_at: string
  edited_at: string | null
}

export interface AssigneeRow {
  id: string
  name: string
  user_id?: string | null
}

/** Cine a scris: numele omului (`authorId` = contul), sau „notă mutată” pentru vechiul `notes`. */
export function authorOf(row: Pick<EventRow, 'author_id'>, people: readonly AssigneeRow[]): { author: string; authorId: string | null } {
  if (row.author_id === null) return { author: 'notă mutată', authorId: null }
  const who = people.find((p) => p.user_id === row.author_id)
  return { author: who?.name ?? 'necunoscut', authorId: row.author_id }
}

/**
 * Omul în numele căruia scrie unealta, din `author` (corpul cererii): numele
 * (fără majuscule), id-ul rândului din `assignees` sau id-ul contului. Trebuie
 * să fie un rând LEGAT de un cont (`user_id`) — un nume fără cont n-are cum să
 * fie autorul unui comentariu (`author_id` e un cont).
 */
export function authorFilter(param: string): string {
  const enc = encodeURIComponent(param)
  return UUID_RE.test(param) ? `or=(id.eq.${enc},user_id.eq.${enc})` : `name=ilike.${enc}`
}

export function pickAuthor(rows: readonly AssigneeRow[]):
  { userId: string; assigneeId: string; name: string } | { error: 'author_not_found' | 'author_not_linked' } {
  if (!rows.length) return { error: 'author_not_found' }
  const linked = rows.find((r) => r.user_id)
  if (!linked) return { error: 'author_not_linked' }
  return { userId: linked.user_id!, assigneeId: linked.id, name: linked.name }
}

function personOut(id: string | null, people: readonly AssigneeRow[]) {
  if (id === null) return null
  return { id, name: people.find((p) => p.id === id)?.name ?? 'necunoscut' }
}

/**
 * Rândurile din `issue_events` → răspunsul API-ului, în ordinea dată (cronologic).
 * `files` = atașamentele fiecărui eveniment, deja semnate. O pasă `to: null`
 * înseamnă „înapoi la creator” (regula firului: `assignee_id` gol = al creatorului).
 */
export function eventsOut(
  rows: readonly EventRow[],
  people: readonly AssigneeRow[],
  files: ReadonlyMap<string, Array<Record<string, unknown>>> = new Map(),
) {
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    ...authorOf(r, people),
    body: r.body ?? '',
    createdAt: r.created_at,
    editedAt: r.edited_at ?? null,
    ...(r.kind === 'handoff'
      ? { handoff: { from: personOut(r.handoff_from, people), to: personOut(r.handoff_to, people) } }
      : {}),
    attachments: files.get(r.id) ?? [],
  }))
}

export interface CommentInput {
  /** Omul în numele căruia se scrie (nume / id assignee / id cont). */
  author: string
  body: string
  /** `true` = gestul pasează și el (cheia `to` a fost dată). */
  handoff: boolean
  /** Numele sau id-ul persoanei; `null` = înapoi la creator. Numai cu `handoff`. */
  to: string | null
  attachmentIds: string[]
}

/**
 * Corpul `POST /api/tickets/<id>/comments`:
 * `{ author: string, body?: string, to?: string | null, attachmentIds?: string[] }`.
 * `author` e obligatoriu: fără el comentariul n-ar avea al cui să fie.
 * Cheia `to` prezentă = pasează (`null` / `""` = înapoi la creator); lipsă = doar
 * comentariu. Un gest fără text, fără fișiere și fără pasă nu scrie nimic → `empty_comment`.
 */
export function parseCommentInput(raw: unknown): CommentInput | { error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'invalid_json' }
  const b = raw as Record<string, unknown>
  if (typeof b.author !== 'string' || !b.author.trim()) return { error: 'author_required' }
  if (b.body !== undefined && b.body !== null && typeof b.body !== 'string') return { error: 'invalid_body' }
  const body = typeof b.body === 'string' ? b.body : ''
  const handoff = 'to' in b
  if (handoff && b.to !== null && typeof b.to !== 'string') return { error: 'invalid_to' }
  const to = handoff && typeof b.to === 'string' && b.to.trim() ? b.to.trim() : null
  let attachmentIds: string[] = []
  if (b.attachmentIds !== undefined) {
    if (!Array.isArray(b.attachmentIds) || !b.attachmentIds.every((x) => typeof x === 'string' && UUID_RE.test(x))) {
      return { error: 'invalid_attachment_ids' }
    }
    attachmentIds = [...new Set(b.attachmentIds as string[])]
  }
  if (!body.trim() && !attachmentIds.length && !handoff) return { error: 'empty_comment' }
  return { author: b.author.trim(), body, handoff, to, attachmentIds }
}

/**
 * Eroarea RPC-ului → răspunsul API-ului. PostgREST dă `PGRST202` (404) când
 * funcția nu există: migrarea n-a fost rulată, deci spunem asta, nu „not found”.
 */
export function rpcFailure(status: number, detail: unknown): { status: number; body: Record<string, unknown> } {
  const code = typeof detail === 'object' && detail !== null ? (detail as { code?: unknown }).code : undefined
  if (code === 'PGRST202') {
    return { status: 501, body: { error: 'migration_missing', detail: 'Rulează supabase/migration-thread-api.sql.' } }
  }
  if (code === 'HZC01') return { status: 404, body: { error: 'not_found' } }
  if (code === 'HZC02') return { status: 400, body: { error: 'empty_comment' } }
  if (code === 'HZC03') return { status: 422, body: { error: 'author_not_found' } }
  return { status: 502, body: { error: 'db_error', ...(detail !== undefined ? { detail } : {}), status } }
}
