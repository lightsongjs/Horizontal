// functions/api/tickets/[id]/attachments.ts
//
// GET  /api/tickets/<id>/attachments — fișierele tichetului, cu URL-uri semnate (8 h).
// POST /api/tickets/<id>/attachments — atașează unul sau mai multe fișiere LA TICHET
//      (`event_id` null, ca bara de fișiere din formular), nu la un comentariu.
//
// Corpul POST: `multipart/form-data` cu câmpul `file` (se poate repeta), sau JSON
// `{ filename, data: <base64>, contentType? }` / `{ files: [...] }`.
//
// Același drum ca `uploadAttachment` din src/data/attachments.ts: octeții întâi,
// rândul după, iar un rând care nu se poate scrie își retrage octeții — altfel
// rămâne un obiect pe care nimic nu-l arată și nimic nu-l șterge. Fără micșorare:
// pe Workers nu există canvas (vezi `MAX_FILE_BYTES`).
//
// Regula API-ului („ce nu se poate anula se refuză”) nu oprește urcarea: un fișier
// se șterge din aplicație (Lightbox), iar o urcare nu atinge nimic existent.

interface Env {
  TICKETS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

import { sbHeaders } from '../../_tickets-lib'
import {
  ATTACHMENT_SELECT, MAX_REQUEST_BYTES, checkFiles, filesFromJson, resolveContentType, signAttachments,
  type AttachmentRow, type IncomingFile,
} from '../../_attachments-lib'
import { BUCKET, buildAttachmentPath, safeFilename } from '../../../../src/lib/attachmentPath'
import { isTempIssueId } from '../../../../src/lib/issueId'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)
  const enc = encodeURIComponent(id)

  const issueRes = await fetch(`${SUPABASE_URL}/rest/v1/issues?id=eq.${enc}&select=id&limit=1`, { headers })
  if (!issueRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  if (!(await issueRes.json() as unknown[]).length) return Response.json({ error: 'not_found' }, { status: 404 })

  const attRes = await fetch(
    `${SUPABASE_URL}/rest/v1/attachments?issue_id=eq.${enc}&select=${ATTACHMENT_SELECT}&order=created_at`,
    { headers },
  )
  if (!attRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const rows = await attRes.json() as AttachmentRow[]
  return Response.json({ id, attachments: await signAttachments(rows, SUPABASE_URL, headers) })
}

/** Corpul cererii → fișiere, sau un răspuns de eroare gata făcut. */
async function readFiles(request: Request): Promise<IncomingFile[] | Response> {
  const type = (request.headers.get('Content-Type') ?? '').toLowerCase()
  if (type.startsWith('multipart/form-data')) {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return Response.json({ error: 'invalid_form' }, { status: 400 })
    }
    const files: IncomingFile[] = []
    for (const entry of form.getAll('file')) {
      // Un câmp `file` cu text, nu cu fișier, e o greșeală a clientului, nu ceva de ignorat.
      if (typeof entry === 'string') return Response.json({ error: 'file_field_not_a_file' }, { status: 400 })
      const f = entry as unknown as File
      files.push({ filename: f.name, contentType: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })
    }
    return files
  }
  if (type.startsWith('application/json')) {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 })
    }
    const parsed = filesFromJson(body)
    if ('error' in parsed) {
      return Response.json({ ...parsed, expected: '{ filename, data: <base64>, contentType? } sau { files: [...] }' }, { status: 400 })
    }
    return parsed
  }
  return Response.json({ error: 'unsupported_content_type', expected: 'multipart/form-data sau application/json' }, { status: 415 })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const headers = sbHeaders(SUPABASE_SERVICE_ROLE_KEY)

  // Un ID provizoriu (`HZ-~abc123`) trăiește doar în coada offline a unui
  // dispozitiv; în bază nu există. Refuzat explicit, ca mesajul să spună de ce.
  if (isTempIssueId(id)) return Response.json({ error: 'temp_id' }, { status: 400 })

  // Înainte de a citi corpul: un corp uriaș n-are ce căuta în memoria workerului.
  const declared = Number(context.request.headers.get('Content-Length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return Response.json({ error: 'request_too_large', maxBytes: MAX_REQUEST_BYTES }, { status: 413 })
  }

  const files = await readFiles(context.request)
  if (files instanceof Response) return files
  const bad = checkFiles(files)
  if (bad) {
    const status = bad.error === 'file_too_large' || bad.error === 'request_too_large' ? 413 : 400
    return Response.json(bad, { status })
  }

  const issueRes = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?id=eq.${encodeURIComponent(id)}&select=id,project_id&limit=1`,
    { headers },
  )
  if (!issueRes.ok) return Response.json({ error: 'db_error' }, { status: 502 })
  const issue = (await issueRes.json() as Array<{ id: string; project_id: string }>)[0]
  if (!issue) return Response.json({ error: 'not_found' }, { status: 404 })

  // Secvențial, nu în paralel: la un eșec, ce s-a urcat deja e cunoscut exact și
  // se întoarce, iar restul nu mai pleacă.
  const created: AttachmentRow[] = []
  for (const f of files) {
    const attId = crypto.randomUUID()
    const path = buildAttachmentPath(issue.project_id, issue.id, attId)
    const filename = safeFilename(f.filename)
    const contentType = resolveContentType(f.contentType, filename)
    const objectUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`

    const up = await fetch(objectUrl, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': contentType,
        // Obiectele sunt imuabile (uuid nou la fiecare urcare, fără upsert) — ca în aplicație.
        'cache-control': 'max-age=31536000',
        'x-upsert': 'false',
      },
      body: f.bytes,
    })
    if (!up.ok) {
      return partialFailure('upload_failed', filename, created, await up.json().catch(() => undefined), SUPABASE_URL, headers)
    }

    const ins = await fetch(`${SUPABASE_URL}/rest/v1/attachments?select=${ATTACHMENT_SELECT}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: attId,
        issue_id: issue.id,
        project_id: issue.project_id,
        path,
        filename,
        size: f.bytes.byteLength,
        content_type: contentType,
      }),
    })
    const rows = ins.ok ? await ins.json().catch(() => []) as AttachmentRow[] : []
    if (!rows.length) {
      // Octeții fără rând nu-i vede nimeni: îi retragem. Dacă și asta pică, rămân
      // orfani — `scripts/storage-report.mjs` îi găsește.
      await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] }),
      }).catch(() => undefined)
      return partialFailure('db_error', filename, created, ins.ok ? undefined : await ins.json().catch(() => undefined), SUPABASE_URL, headers)
    }
    created.push(rows[0])
  }

  return Response.json(
    { id: issue.id, attachments: await signAttachments(created, SUPABASE_URL, headers) },
    { status: 201 },
  )
}

/** Un fișier a căzut: spune care, și ce s-a urcat deja (acelea rămân pe tichet). */
async function partialFailure(
  error: 'upload_failed' | 'db_error',
  filename: string,
  created: readonly AttachmentRow[],
  detail: unknown,
  supabaseUrl: string,
  headers: Record<string, string>,
): Promise<Response> {
  return Response.json({
    error,
    filename,
    ...(detail !== undefined ? { detail } : {}),
    attachments: await signAttachments(created, supabaseUrl, headers),
  }, { status: 502 })
}
