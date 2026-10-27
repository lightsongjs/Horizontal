// functions/api/tickets/[id]/comments.ts
//
// GET  /api/tickets/<id>/comments — firul tichetului: comentarii și pase,
//      cronologic, cu autorul, ora, „editat” și fișierele fiecărui comentariu
//      (URL-uri semnate, 8 h).
// POST /api/tickets/<id>/comments — `{ author, body?, to?, attachmentIds? }`:
//      un comentariu și, cu `to`, pasarea tichetului — UN gest, ca în aplicație
//      (`post_to_thread`), prin `post_to_thread_api` (migration-thread-api.sql).
//      Cheia de serviciu n-are utilizator, deci autorul vine explicit: omul în
//      numele căruia scrie unealta (`tk` trimite omul configurat pe calculator).
//      În aplicație comentariul e al lui, ca scris de el.
//
// Fișierele unui comentariu se urcă întâi pe tichet
// (`POST /api/tickets/<id>/attachments`), apoi id-urile lor vin în
// `attachmentIds` — drumul aplicației (`uploadPicked`, apoi `post_to_thread`).

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

import { sbHeaders, resolveAssignee, resolveAuthor } from '../../_tickets-lib'
import { ATTACHMENT_SELECT, signAttachments, type AttachmentRow } from '../../_attachments-lib'
import { eventsOut, parseCommentInput, rpcFailure, type AssigneeRow, type EventRow } from '../../_thread-lib'
import { isTempIssueId } from '../../../../src/lib/issueId'

type Headers = Record<string, string>

async function getRows<T>(url: string, headers: Headers): Promise<T[] | null> {
  const res = await fetch(url, { headers })
  return res.ok ? await res.json() as T[] : null
}

/** Fișierele evenimentelor date, semnate, grupate pe eveniment. */
async function eventFiles(sb: string, headers: Headers, issueId: string, eventIds: readonly string[]) {
  const files = new Map<string, Array<Record<string, unknown>>>()
  if (!eventIds.length) return files
  const rows = await getRows<AttachmentRow>(
    `${sb}/rest/v1/attachments?issue_id=eq.${encodeURIComponent(issueId)}&event_id=not.is.null` +
      `&select=${ATTACHMENT_SELECT},event_id&order=created_at`,
    headers,
  )
  if (!rows) return null
  const mine = rows.filter((r) => r.event_id && eventIds.includes(r.event_id))
  // `signAttachments` păstrează ordinea, deci al i-lea semnat e al i-lea rând.
  const signed = await signAttachments(mine, sb, headers)
  mine.forEach((r, i) => files.set(r.event_id!, [...(files.get(r.event_id!) ?? []), signed[i]]))
  return files
}

const people = (sb: string, headers: Headers) =>
  getRows<AssigneeRow>(`${sb}/rest/v1/assignees?select=id,name,user_id`, headers)

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const enc = encodeURIComponent(id)
  const { SUPABASE_URL: sb, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  const issue = await getRows<{ id: string }>(`${sb}/rest/v1/issues?id=eq.${enc}&select=id&limit=1`, headers)
  if (!issue) return Response.json({ error: 'db_error' }, { status: 502 })
  if (!issue.length) return Response.json({ error: 'not_found' }, { status: 404 })

  const [events, who] = await Promise.all([
    getRows<EventRow>(`${sb}/rest/v1/issue_events?issue_id=eq.${enc}&select=*&order=created_at.asc,kind.asc`, headers),
    people(sb, headers),
  ])
  if (!events || !who) return Response.json({ error: 'db_error' }, { status: 502 })
  const files = await eventFiles(sb, headers, id, events.map((e) => e.id))
  if (!files) return Response.json({ error: 'db_error' }, { status: 502 })
  return Response.json({ id, comments: eventsOut(events, who, files) })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const enc = encodeURIComponent(id)
  const { SUPABASE_URL: sb, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  let raw: unknown
  try {
    raw = await context.request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const input = parseCommentInput(raw)
  if ('error' in input) return Response.json(input, { status: 400 })
  // Un ID provizoriu (`HZ-~abc`) trăiește doar în coada unui dispozitiv.
  if (isTempIssueId(id)) return Response.json({ error: 'temp_id' }, { status: 400 })

  const issue = await getRows<{ id: string; assignee_id: string | null }>(
    `${sb}/rest/v1/issues?id=eq.${enc}&select=id,assignee_id&limit=1`, headers,
  )
  if (!issue) return Response.json({ error: 'db_error' }, { status: 502 })
  if (!issue.length) return Response.json({ error: 'not_found' }, { status: 404 })

  const author = await resolveAuthor(input.author, sb, headers)
  if (!author) return Response.json({ error: 'db_error' }, { status: 502 })
  if ('error' in author) return Response.json({ ...author, author: input.author }, { status: 422 })

  let to: string | null = null
  if (input.handoff && input.to !== null) {
    const who = await resolveAssignee(input.to, sb, headers)
    if (!who) return Response.json({ error: 'assignee_not_found' }, { status: 422 })
    to = who.id
  }

  // Fișierele trebuie să fie ale tichetului și încă nelegate de alt comentariu;
  // altfel RPC-ul le-ar sări în tăcere și comentariul ar pleca fără ele.
  if (input.attachmentIds.length) {
    const ids = input.attachmentIds.join(',')
    const rows = await getRows<{ id: string }>(
      `${sb}/rest/v1/attachments?id=in.(${ids})&issue_id=eq.${enc}&event_id=is.null&select=id`, headers,
    )
    if (!rows) return Response.json({ error: 'db_error' }, { status: 502 })
    const ok = new Set(rows.map((r) => r.id))
    const unknown = input.attachmentIds.filter((x) => !ok.has(x))
    if (unknown.length) return Response.json({ error: 'invalid_attachments', unknown }, { status: 422 })
  }

  // Nimic de scris: pasă către cine îl are deja, fără text și fără fișiere.
  if (!input.body.trim() && !input.attachmentIds.length && issue[0].assignee_id === to) {
    return Response.json({ id, comments: [], assigneeId: to, unchanged: true })
  }

  const rpc = await fetch(`${sb}/rest/v1/rpc/post_to_thread_api`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_issue_id: id,
      p_author: author.userId,
      p_body: input.body,
      p_handoff: input.handoff,
      p_to: to,
      p_attachment_ids: input.attachmentIds,
    }),
  })
  if (!rpc.ok) {
    const fail = rpcFailure(rpc.status, await rpc.json().catch(() => undefined))
    return Response.json(fail.body, { status: fail.status })
  }
  const result = await rpc.json() as { events: EventRow[]; assignee_id: string | null }
  const [who, files] = await Promise.all([
    people(sb, headers),
    // Numai gestul cu fișiere are ce semna.
    input.attachmentIds.length ? eventFiles(sb, headers, id, result.events.map((e) => e.id)) : new Map(),
  ])
  // Scrierea a reușit; un nume sau un link care nu se poate citi nu o face eșec.
  return Response.json(
    { id, comments: eventsOut(result.events, who ?? [], files ?? new Map()), assigneeId: result.assignee_id ?? null },
    { status: 201 },
  )
}
