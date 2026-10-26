// Regulile pure ale unui fișier atașat: bucketul, calea din Storage și numele de
// afișat. Separate de `data/attachments.ts` (care trage clientul Supabase) și de
// `shrinkImage.ts` (care trage canvas-ul), ca să le poată importa și API-ul
// (`functions/api/tickets/[id]/attachments.ts`, pe Workers, fără DOM): un fișier
// urcat de o unealtă trebuie să arate în aplicație exact ca unul urcat de om.

export const BUCKET = 'attachments'

/**
 * `projectId` e primul segment **intenționat**: politica RLS de pe
 * `storage.objects` compară `(storage.foldername(name))[1]` cu
 * `project_members`. Fără extensie — `content_type` real trăiește în DB.
 */
export function buildAttachmentPath(projectId: string, issueId: string, attachmentId: string): string {
  return `${projectId}/${issueId}/${attachmentId}`
}

/**
 * Nume pentru AFIȘARE (coloana `filename`). Scoate calea, caracterele de
 * control, limitează lungimea. NU se folosește niciodată în calea din Storage —
 * aceea e construită doar din id-uri.
 */
export function safeFilename(name: string): string {
  const base = (name ?? '').split(/[/\\]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex -- match intenționat de caractere de control
  const cleaned = base.replace(/[\x00-\x1f]/g, '_').trim()
  if (!cleaned) return 'fisier'
  return cleaned.slice(0, 200)
}
