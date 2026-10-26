// functions/api/_attachments-lib.ts
// Fișierele unui tichet pe API: citirea (cu URL-uri semnate) și regulile pure ale
// urcării. Bucketul, calea și numele vin din aplicație (`src/lib/attachmentPath.ts`),
// ca un fișier urcat de o unealtă să fie, în bază și în Storage, identic cu unul
// urcat din aplicație.
//
// Cel care citește un tichet pe API e un agent, iar un agent nu vede un URL: își
// descarcă fișierul și îl citește. Deci răspunsul dă linkul direct, semnat, și
// se oprește acolo — unde salvează e treaba lui.

import { BUCKET } from '../../src/lib/attachmentPath'

/** 8 ore, ca `SIGNED_TTL_SECONDS` din src/data/attachments.ts. */
export const SIGNED_TTL_SECONDS = 8 * 60 * 60

/**
 * Plafonul pe fișier. Aplicația micșorează pozele în browser (3072px, de obicei
 * sub 1 MB) înainte să le urce; pe Workers nu există canvas, deci API-ul urcă
 * octeții așa cum vin — o poză de cameră brută are 5–15 MB. 25 MB o lasă să
 * treacă, rămâne sub plafonul de proiect al Supabase (50 MB pe planul gratuit,
 * care altfel ar răspunde cu o eroare mai puțin clară) și nu umple bucketul de
 * 1 GB cu câteva fișiere scăpate din greșeală.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024

/**
 * Plafonul pe cerere. Workerul ține tot corpul în memorie (128 MB), iar un corp
 * JSON cu base64 e de ~1,33× mai mare și se decodează în încă o copie.
 */
export const MAX_REQUEST_BYTES = 50 * 1024 * 1024

/** Câte fișiere într-o cerere. Fiecare înseamnă două scrieri secvențiale. */
export const MAX_FILES = 10

export interface AttachmentRow {
  id: string
  path: string
  filename: string
  size: number
  content_type: string
  created_at: string
  event_id?: string | null
}

export interface SignedRow {
  path?: string | null
  signedURL?: string | null
}

/**
 * Storage întoarce `signedURL` **relativ** (`/object/sign/attachments/...?token=`),
 * deci trebuie prefixat cu `${SUPABASE_URL}/storage/v1` — asta face și supabase-js
 * pe dinăuntru, și e singura parte care se poate strica silențios.
 *
 * Un fișier pentru care semnarea a eșuat se întoarce **fără** `url`, nu deloc:
 * „există o poză, n-am putut să ți-o dau" e informație, iar restul listei rămâne
 * bună.
 */
export function attachmentsPayload(
  rows: readonly AttachmentRow[],
  signed: readonly SignedRow[],
  storageBase: string,
): Array<Record<string, unknown>> {
  const urls = new Map<string, string>()
  for (const s of signed) {
    if (s.path && s.signedURL) urls.set(s.path, `${storageBase}${s.signedURL}`)
  }
  return rows.map(r => {
    const url = urls.get(r.path)
    return {
      id: r.id,
      filename: r.filename,
      contentType: r.content_type,
      size: r.size,
      createdAt: r.created_at,
      ...(url ? { url } : {}),
    }
  })
}

export const ATTACHMENT_SELECT = 'id,path,filename,size,content_type,created_at'

/**
 * Semnează toate căile într-un singur apel. Zero rânduri ⇒ zero apeluri; o
 * semnare căzută nu strică răspunsul — rândurile pleacă fără `url`.
 */
export async function signAttachments(
  rows: readonly AttachmentRow[],
  supabaseUrl: string,
  headers: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  let signed: SignedRow[] = []
  if (rows.length) {
    const signRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: SIGNED_TTL_SECONDS, paths: rows.map(r => r.path) }),
    })
    if (signRes.ok) signed = await signRes.json().catch(() => []) as SignedRow[]
  }
  return attachmentsPayload(rows, signed, `${supabaseUrl}/storage/v1`)
}

// ── Urcarea ─────────────────────────────────────────────────────────────────

const BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  svg: 'image/svg+xml',
}

/**
 * Tipul fișierului: cel declarat, dacă spune ceva; altfel după extensie. `curl -F`
 * și multe biblioteci trimit `application/octet-stream` pentru orice, iar
 * aplicația randează inline doar după `content_type` (lista albă din
 * `isRenderableImage`) — o poză declarată „octeți" ar apărea ca fișier de
 * descărcat, nu ca miniatură.
 */
export function resolveContentType(declared: string | null | undefined, filename: string): string {
  const d = (declared ?? '').split(';')[0].trim().toLowerCase()
  if (d && d !== 'application/octet-stream') return d
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase()
  return (ext && BY_EXT[ext]) || 'application/octet-stream'
}

export interface IncomingFile {
  filename: string
  contentType: string
  bytes: Uint8Array
}

export type FilesError =
  | { error: 'no_files' }
  | { error: 'too_many_files'; max: number }
  | { error: 'empty_file'; filename: string }
  | { error: 'file_too_large'; filename: string; maxBytes: number }
  | { error: 'request_too_large'; maxBytes: number }

/** Verificările de formă, înainte de orice scriere. Ordinea: număr, apoi fiecare fișier, apoi totalul. */
export function checkFiles(files: readonly IncomingFile[]): FilesError | null {
  if (!files.length) return { error: 'no_files' }
  if (files.length > MAX_FILES) return { error: 'too_many_files', max: MAX_FILES }
  let total = 0
  for (const f of files) {
    if (f.bytes.byteLength === 0) return { error: 'empty_file', filename: f.filename }
    if (f.bytes.byteLength > MAX_FILE_BYTES) return { error: 'file_too_large', filename: f.filename, maxBytes: MAX_FILE_BYTES }
    total += f.bytes.byteLength
  }
  if (total > MAX_REQUEST_BYTES) return { error: 'request_too_large', maxBytes: MAX_REQUEST_BYTES }
  return null
}

/** base64 (sau un data: URL) → octeți; `null` dacă nu e base64 valid. */
export function decodeBase64(input: string): Uint8Array | null {
  const raw = input.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(raw)) return null
  try {
    const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * Corpul JSON, pentru clienții care nu fac multipart:
 * `{ "filename": "a.png", "data": "<base64>", "contentType"?: "image/png" }`
 * sau `{ "files": [ {...}, {...} ] }`.
 */
export function filesFromJson(body: unknown): IncomingFile[] | { error: 'invalid_file'; index: number } {
  const b = (body ?? {}) as Record<string, unknown>
  const list = Array.isArray(b.files) ? b.files : [b]
  const out: IncomingFile[] = []
  for (let i = 0; i < list.length; i++) {
    const f = (list[i] ?? {}) as Record<string, unknown>
    if (typeof f.filename !== 'string' || typeof f.data !== 'string') return { error: 'invalid_file', index: i }
    if (f.contentType !== undefined && typeof f.contentType !== 'string') return { error: 'invalid_file', index: i }
    const bytes = decodeBase64(f.data)
    if (!bytes) return { error: 'invalid_file', index: i }
    out.push({ filename: f.filename, contentType: (f.contentType as string | undefined) ?? '', bytes })
  }
  return out
}
