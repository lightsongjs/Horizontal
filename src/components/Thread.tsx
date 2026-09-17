import { useEffect, useRef, useState } from 'react'
import { repository } from '../data'
import {
  deleteAttachment,
  isRenderableImage,
  uploadAttachment,
  type Attachment,
} from '../data/attachments'
import { attachmentFilename, shrinkImage } from '../lib/shrinkImage'
import { pickFiles, rejectMessage } from '../lib/pickFiles'
import { errorMessage } from '../lib/errorMessage'
import { toTimeInput } from '../lib/schedule'
import { useAuth } from '../auth'
import { useHorizontal } from '../store'
import { useCanWrite } from '../hooks'
import { AttachmentPicker } from './AttachmentPicker'
import { Icon } from './Icon'
import type { Assignee, IssueEvent } from '../lib/types'

/** Doar în modul Supabase — la fel ca `Attachments.tsx`: attachment-urile n-au
 *  sens în modul local seeded. */
const ATTACHMENTS_ENABLED = import.meta.env.VITE_DATA_SOURCE === 'supabase'

/**
 * Numele de afișat al unui autor de eveniment. `authorId` e un id de cont
 * (`auth.users`), NU un id de assignee — se mapează prin `assignees.userId`.
 * `null` = notă migrată din vechiul câmp `notes` (vezi migration-comments.sql).
 */
function authorDisplay(
  authorId: string | null,
  assignees: readonly Assignee[],
  myUserId: string,
): { name: string; initials: string | null; mine: boolean } {
  if (authorId === null) return { name: 'Notă mutată', initials: null, mine: false }
  const mine = authorId === myUserId
  const found = assignees.find((a) => a.userId === authorId)
  if (found) return { name: found.name, initials: found.name.slice(0, 2).toUpperCase(), mine }
  return { name: mine ? 'Eu' : 'Cineva', initials: mine ? 'EU' : '?', mine }
}

/** Numele unui assignee pentru o pasă (`handoffFrom`/`handoffTo` sunt id-uri
 *  de ASSIGNEE, nu de cont — spre deosebire de `authorId`). */
function assigneeLabel(id: string | null, assignees: readonly Assignee[]): string {
  if (id === null) return 'Nimeni'
  return assignees.find((a) => a.id === id)?.name ?? 'necunoscut'
}

/**
 * Firul unui tichet: comentarii și pase, cronologic, plus caseta de scris.
 *
 * Trei lucruri pe care nu le face, deliberat:
 *  - NU are `overflow` propriu. În modal, coloana dreaptă se derulează deja; în
 *    panoul docat se derulează corpul întreg. Un al treilea scroller ar face
 *    firul inaccesibil în modal.
 *  - NU se randează pe un tichet nesalvat. `existing` e undefined până la
 *    primul save, iar salvarea remontează formularul.
 *  - NU salvează tichetul. „Trimite" scrie în fir; săgeata din antet salvează
 *    tichetul. Două butoane, două înțelesuri.
 */
export function Thread({ issueId, projectId, onDirtyChange }: {
  issueId: string
  projectId: string
  onDirtyChange(dirty: boolean): void
}) {
  const { assignees, myAssigneeId, byId, upsertIssue } = useHorizontal()
  const { session } = useAuth()
  const canWrite = useCanWrite()
  // `localRepository` semnează firul cu 'local' (vezi `postToThread` de-acolo)
  // cât timp nu există sesiune Supabase — aceeași convenție ține și aici, ca
  // „e al meu" să răspundă corect în ambele moduri.
  const myUserId = session?.user.id ?? 'local'

  const [events, setEvents] = useState<IssueEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [body, setBody] = useState('')
  const [to, setTo] = useState<string | null | undefined>(undefined)
  const [toOpen, setToOpen] = useState(false)
  const [pending, setPending] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(0)
  const [attMessage, setAttMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(null)
    repository.listEvents(issueId)
      .then((evs) => { if (alive) setEvents(evs) })
      .catch((e) => { if (alive) setLoadError(errorMessage(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [issueId])

  const updateBody = (v: string) => {
    setBody(v)
    onDirtyChange(v.trim() !== '')
  }

  const pickAttachments = async (files: File[]) => {
    const picked = pickFiles({ types: ['Files'], files })
    const msg = rejectMessage(picked.rejected)
    if (msg) setAttMessage(msg)
    if (picked.accept.length === 0) return
    setBusy((n) => n + picked.accept.length)
    for (const [index, original] of picked.accept.entries()) {
      try {
        const small = await shrinkImage(original)
        const base = picked.renamed[index] ?? original.name
        const changed = small !== original
        const filename = attachmentFilename(base, changed ? (small.type as 'image/jpeg' | 'image/webp') : null)
        const saved = await uploadAttachment({ issueId, projectId, file: small, filename })
        setPending((prev) => [...prev, saved])
      } catch (e) {
        setAttMessage(errorMessage(e))
      } finally {
        setBusy((n) => n - 1)
      }
    }
  }

  const removePending = (a: Attachment) => {
    setPending((prev) => prev.filter((x) => x.id !== a.id))
    // Cel mai bun efort: dacă ștergerea eșuează, fișierul rămâne orfan (fără
    // event_id), găsit mai târziu de `scripts/storage-report.mjs` — nu de ce
    // să blocăm scoaterea din compunere pe o eroare de rețea.
    void deleteAttachment(a).catch(() => {})
  }

  const canSubmit = canWrite && !sending && (body.trim() !== '' || pending.length > 0 || to !== undefined)

  const send = async () => {
    if (!canSubmit) return
    setSending(true)
    setSendError(null)
    try {
      const res = await repository.postToThread({
        issueId,
        projectId,
        body: body.trim(),
        handoff: to !== undefined,
        to: to ?? null,
        attachmentIds: pending.map((a) => a.id),
      })
      setEvents((prev) => [...prev, ...res.events])
      // `res.issue` NU poartă `deps` (`to_jsonb(i)` din `post_to_thread` citește
      // doar tabela `issues`) — păstrăm `deps` din tichetul vechi al store-ului,
      // altfel dependențele dispar din interfață fără nicio eroare.
      const prevIssue = byId[issueId]
      upsertIssue({ ...res.issue, deps: prevIssue?.deps ?? [] })
      setBody('')
      setTo(undefined)
      setPending([])
      onDirtyChange(false) // altfel formularul rămâne murdar și clipește la orice click în listă
    } catch (e) {
      setSendError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="thread">
      <span className="if-field-label" style={{ display: 'block', marginBottom: 8 }}>Fir</span>

      {loading && <p className="thread-loading">Se încarcă…</p>}
      {loadError && <div className="banner">{loadError}</div>}

      {!loading && !loadError && (
        <div className="thread-events">
          {events.length === 0 && <p className="thread-empty">Niciun comentariu încă.</p>}
          {events.map((e) => {
            if (e.kind === 'handoff') {
              return (
                <div key={e.id} className="thread-handoff">
                  {assigneeLabel(e.handoffFrom, assignees)} → {assigneeLabel(e.handoffTo, assignees)}
                  <span className="thread-handoff-time">{toTimeInput(e.createdAt)}</span>
                </div>
              )
            }
            const author = authorDisplay(e.authorId, assignees, myUserId)
            return (
              <div key={e.id} className={`thread-comment${author.mine ? ' mine' : ''}`}>
                <span className={`thread-avatar${author.initials === null ? ' empty' : ''}`}>
                  {author.initials}
                </span>
                <div className="thread-comment-body">
                  <div className="thread-comment-card">
                    <div className="thread-comment-head">
                      <span className="thread-comment-name">{author.name}</span>
                      <span className="thread-comment-time">{toTimeInput(e.createdAt)}</span>
                    </div>
                    <div className="thread-comment-text">{e.body}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="thread-compose">
        {pending.length > 0 && (
          <div className="thread-pending">
            {pending.map((a) => (
              <span key={a.id} className="thread-pending-chip">
                <Icon name={isRenderableImage(a.contentType) ? 'fileImage' : 'attachment'} size={13} />
                <span className="thread-pending-name">{a.filename}</span>
                <button type="button" onClick={() => removePending(a)} aria-label={`Scoate ${a.filename}`}>
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        {attMessage && (
          <div className="thread-att-msg" role="status">
            {attMessage}
            <button type="button" onClick={() => setAttMessage(null)} aria-label="Închide mesajul">
              <Icon name="close" size={13} />
            </button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="thread-textarea"
          value={body}
          onChange={(e) => updateBody(e.target.value)}
          readOnly={!canWrite}
          placeholder={canWrite ? 'Scrie un comentariu…' : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
          }}
        />

        {sendError && <div className="banner">{sendError}</div>}

        {canWrite && (
          <div className="thread-actions">
            {ATTACHMENTS_ENABLED && (
              <AttachmentPicker onPick={(files) => void pickAttachments(files)} disabled={busy > 0} />
            )}

            <div className="thread-to-wrap">
              <button
                type="button"
                className={`thread-to-btn${to !== undefined ? ' set' : ''}`}
                onClick={() => setToOpen((v) => !v)}
                onBlur={() => setTimeout(() => setToOpen(false), 150)}
              >
                <Icon name="forward" size={13} />
                {to === undefined ? 'către…' : to === null ? 'către Nimeni' : `către ${assignees.find((a) => a.id === to)?.name ?? '?'}`}
              </button>
              {toOpen && (
                <div className="dep-dropdown thread-to-menu">
                  <button
                    type="button"
                    className="dep-dd-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setTo(null); setToOpen(false) }}
                  >
                    <span className="dep-dd-title">
                      Nimănui
                      <span className="thread-to-sub">rămâne la creator</span>
                    </span>
                  </button>
                  {assignees.length === 0 && <div className="dep-dd-empty">Niciun coleg încă.</div>}
                  {assignees.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="dep-dd-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setTo(a.id); setToOpen(false) }}
                    >
                      <span className="dep-dd-title">{a.name}{a.id === myAssigneeId ? ' (eu)' : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button type="button" className="thread-send-btn" disabled={!canSubmit} onClick={() => void send()}>
              {sending ? 'Se trimite…' : to !== undefined ? 'Trimite și pasează' : 'Trimite'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
