// Attachment-uri: metadatele în tabelul `attachments`, octeții în bucketul
// privat cu același nume. Browserul vorbește direct cu Supabase — nu există
// server pe traseu — deci RLS-ul e singura gardă, iar el e în
// supabase/migration-attachments.sql.
//
// Modulul ăsta NU intră în interfața `Repository`: aceea are și o implementare
// locală (localRepository), iar attachment-urile n-au sens în modul local seeded.

import { requireSupabase } from '../lib/supabase'

export interface Attachment {
  id: string
  issueId: string
  projectId: string
  /** Calea obiectului din Storage. Unică. */
  path: string
  /** Numele de afișat și de descărcat. */
  filename: string
  size: number
  contentType: string
  createdAt: string
}

export const BUCKET = 'attachments'

/**
 * 8 ore, nu o oră. Tokenul stă în query string, deci un URL nou e altă cheie de
 * cache HTTP — o expirare scurtă nu aduce securitate (obiectul e accesibil
 * oricum atâta timp), doar garantează ratări de cache la fiecare deschidere.
 */
export const SIGNED_TTL_SECONDS = 8 * 60 * 60

/** Cât timp înainte de expirare considerăm un URL memorat drept inutilizabil. */
const CACHE_SAFETY_MS = 60_000

/** Storage nu împarte singur, iar corpul cererii are plafon practic. */
const REMOVE_CHUNK = 100

interface AttachmentRow {
  id: string
  issue_id: string
  project_id: string
  path: string
  filename: string
  size: number
  content_type: string
  created_at: string
}

function rowToAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    issueId: r.issue_id,
    projectId: r.project_id,
    path: r.path,
    filename: r.filename,
    size: r.size,
    contentType: r.content_type,
    createdAt: r.created_at,
  }
}

/**
 * `projectId` e primul segment **intenționat**: politica RLS de pe
 * `storage.objects` compară `(storage.foldername(name))[1]` cu
 * `project_members`. Fără extensie — `content_type` real trăiește în DB.
 */
export function buildAttachmentPath(projectId: string, issueId: string, attachmentId: string): string {
  return `${projectId}/${issueId}/${attachmentId}`
}

/**
 * Ce se randează inline. Stocăm orice, dar afișăm doar tipurile din lista albă:
 * un `.svg` sau `.html` randat pe originea Supabase ar rula pe acel domeniu.
 */
const RENDERABLE = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

export function isRenderableImage(contentType: string): boolean {
  return RENDERABLE.has(contentType.toLowerCase())
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface CacheEntry {
  url: string
  expiresAt: number
}

const urlCache = new Map<string, CacheEntry>()

/**
 * Ce e deja memorat și ce trebuie cerut. Separat de rețea ca să fie testabil, și
 * ținut deloc degeaba: fără memorare, fiecare deschidere de tichet produce
 * URL-uri noi, deci chei de cache HTTP noi, deci redescarcă fiecare miniatură.
 */
export function cachedUrls(
  paths: readonly string[],
  now: number,
): { hits: Record<string, string>; misses: string[] } {
  const hits: Record<string, string> = {}
  const misses: string[] = []
  for (const path of paths) {
    const entry = urlCache.get(path)
    if (entry && entry.expiresAt - now > CACHE_SAFETY_MS) hits[path] = entry.url
    else misses.push(path)
  }
  return { hits, misses }
}

export function rememberUrls(
  entries: { path: string; url: string }[],
  now: number,
  ttlSeconds: number = SIGNED_TTL_SECONDS,
): void {
  for (const { path, url } of entries) {
    urlCache.set(path, { url, expiresAt: now + ttlSeconds * 1000 })
  }
}

export function resetUrlCache(): void {
  urlCache.clear()
}

export async function listAttachments(issueId: string): Promise<Attachment[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('attachments')
    .select('*')
    .eq('issue_id', issueId)
    .order('created_at')
  if (error) throw error
  return ((data ?? []) as AttachmentRow[]).map(rowToAttachment)
}

/**
 * Urcă octeții, apoi scrie rândul. Dacă rândul nu se poate scrie (RLS, rețea),
 * octeții urcați se retrag — altfel rămâne un obiect pe care nimic din
 * aplicație nu-l mai arată și nimic nu-l mai șterge.
 */
export async function uploadAttachment(input: {
  issueId: string
  projectId: string
  file: File
  filename: string
}): Promise<Attachment> {
  const db = requireSupabase()
  const id = crypto.randomUUID()
  const path = buildAttachmentPath(input.projectId, input.issueId, id)
  const contentType = input.file.type || 'application/octet-stream'

  const { error: upErr } = await db.storage.from(BUCKET).upload(path, input.file, {
    contentType,
    // Obiectele sunt imuabile: `id` e uuid nou la fiecare upload și nu folosim
    // niciodată upsert. Deci un cache de un an e onest, nu optimist.
    cacheControl: '31536000',
    upsert: false,
  })
  if (upErr) throw new Error(`Fișierul nu s-a putut urca: ${upErr.message}`)

  const { data, error } = await db
    .from('attachments')
    .insert({
      id,
      issue_id: input.issueId,
      project_id: input.projectId,
      path,
      filename: input.filename,
      size: input.file.size,
      content_type: contentType,
    })
    .select('*')
    .single()

  if (error || !data) {
    await removeObjects([path])
    throw new Error(`Fișierul nu s-a putut salva: ${error?.message ?? 'rând lipsă'}`)
  }
  return rowToAttachment(data as AttachmentRow)
}

/** Rândul întâi, octeții după. Vezi comentariul din `removeObjects`. */
export async function deleteAttachment(a: Attachment): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('attachments').delete().eq('id', a.id)
  if (error) throw error
  await removeObjects([a.path])
}

/**
 * Șterge octeții. **Nu aruncă niciodată.**
 *
 * Se cheamă mereu după ce rândurile au fost șterse, iar ordinea e intenționată:
 * dacă pică pasul ăsta rămân fișiere orfane — invizibile, costă doar spațiu, iar
 * `scripts/storage-report.mjs` le găsește. Invers, rânduri care arată către
 * obiecte inexistente dau URL-uri semnate care întorc 404 și miniaturi rupte,
 * adică stricăciune vizibilă. Se preferă eșecul invizibil.
 *
 * Iar dacă ar arunca, apelantul (`deleteIssue`) ar raporta eșec pentru o
 * operație care a reușit, și reîncercarea ar eșua altfel — tichetul nu mai există.
 */
export async function removeObjects(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  const db = requireSupabase()
  for (const batch of chunk(paths, REMOVE_CHUNK)) {
    try {
      const { error } = await db.storage.from(BUCKET).remove(batch as string[])
      if (error) console.warn('Fișiere rămase în stocare:', error.message, batch)
    } catch (e) {
      console.warn('Fișiere rămase în stocare:', e, batch)
    }
  }
}

/** URL-uri de afișare, cerute într-un singur apel și memorate. */
export async function signedUrls(paths: readonly string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const now = Date.now()
  const { hits, misses } = cachedUrls(paths, now)
  if (misses.length === 0) return hits

  const db = requireSupabase()
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(misses, SIGNED_TTL_SECONDS)
  if (error) throw error

  const fresh: { path: string; url: string }[] = []
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) fresh.push({ path: row.path, url: row.signedUrl })
  }
  rememberUrls(fresh, now)
  const out = { ...hits }
  for (const { path, url } of fresh) out[path] = url
  return out
}

/**
 * URL de DESCĂRCARE, generat la cerere pentru un singur fișier. Opțiunea
 * `download` pune `Content-Disposition: attachment`, deci browserul descarcă în
 * loc să încerce să randeze — obligatoriu pentru orice non-imagine, altfel un
 * `.svg` sau `.html` stocat s-ar executa pe originea Supabase.
 */
export async function signedDownloadUrl(a: Attachment): Promise<string | null> {
  const db = requireSupabase()
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(a.path, SIGNED_TTL_SECONDS, { download: a.filename })
  if (error) return null
  return data?.signedUrl ?? null
}

/** Căile fișierelor mai multor tichete, ÎNAINTE de ștergerea rândurilor. */
export async function pathsForIssues(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const db = requireSupabase()
  const { data, error } = await db.from('attachments').select('path').in('issue_id', ids as string[])
  if (error) throw error
  return ((data ?? []) as { path: string }[]).map((r) => r.path)
}

/**
 * Căile unui proiect întreg. Merge pe `project_id` denormalizat, nu prin
 * `storage.list()`: politica RLS nu e indexabilă pe scanări de prefix, iar
 * Storage n-are ștergere recursivă și paginează la 100.
 */
export async function pathsForProject(projectId: string): Promise<string[]> {
  const db = requireSupabase()
  const { data, error } = await db.from('attachments').select('path').eq('project_id', projectId)
  if (error) throw error
  return ((data ?? []) as { path: string }[]).map((r) => r.path)
}
