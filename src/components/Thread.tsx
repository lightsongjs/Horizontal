import { useEffect, useMemo, useRef, useState } from 'react'
import { repository } from '../data'
import {
  deleteAttachment,
  isRenderableImage,
  listAttachments,
  signedDownloadUrl,
  signedUrls,
  uploadAttachment,
  type Attachment,
} from '../data/attachments'
import { attachmentFilename, shrinkImage } from '../lib/shrinkImage'
import { pickFiles, rejectMessage } from '../lib/pickFiles'
import { errorMessage } from '../lib/errorMessage'
import { dayOffset, toShortDate, toTimeInput } from '../lib/schedule'
import { useAuth } from '../auth'
import { useHorizontal } from '../store'
import { useCanWrite } from '../hooks'
import { AttachmentPicker } from './AttachmentPicker'
import { humanSize, iconFor } from './Attachments'
import { Lightbox } from './Lightbox'
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
 * Ora unui eveniment din fir, cu data în față dacă nu e de azi. Fără asta, un
 * schimb de replici pe mai multe zile — exact cazul de utilizare al firului —
 * arăta „14:32" la tot, inclusiv la cele 266 de note migrate din vechiul câmp
 * de notițe. Aceleași `toShortDate`/`toTimeInput` ca peste tot în aplicație
 * (`DueChip.tsx`) — nu un al treilea format de dată.
 */
function eventTime(iso: string, now: Date): string {
  return dayOffset(iso, now) === 0 ? toTimeInput(iso) : `${toShortDate(iso)} ${toTimeInput(iso)}`
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
export function Thread({ issueId, projectId, onDirtyChange, onHandoff }: {
  issueId: string
  projectId: string
  onDirtyChange(dirty: boolean): void
  /**
   * Cine ține tichetul ACUM, după o pasă reușită din fir. `IssueForm` ține
   * propriul `assigneeId` local (folosit și la salvare) — fără raportarea
   * asta, o pasă mută baza dar nu și starea locală: formularul rămâne murdar
   * pe veci, iar o atingere pe săgeata de salvare ar retrimite assignee-ul
   * VECHI, anulând pasa în tăcere. Chemat DOAR când chiar s-a cerut o pasă
   * (nu la un comentariu simplu), ca să nu suprascrie o alegere nesalvată din
   * selectorul „Assigned to" al formularului.
   */
  onHandoff(to: string | null): void
}) {
  const { assignees, myAssigneeId, byId, upsertIssue, refreshInbox } = useHorizontal()
  const { session } = useAuth()
  const canWrite = useCanWrite()
  // `localRepository` semnează firul cu 'local' (vezi `postToThread` de-acolo)
  // cât timp nu există sesiune Supabase — aceeași convenție ține și aici, ca
  // „e al meu" să răspundă corect în ambele moduri.
  const myUserId = session?.user.id ?? 'local'

  const [events, setEvents] = useState<IssueEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Atașamentele TUTUROR evenimentelor tichetului — o singură cerere, grupată
  // în client pe `eventId`. Bara tichetului (`Attachments.tsx`, montată mai
  // sus în `IssueForm`) le arată pe toate laolaltă; aici arătăm doar cele
  // legate de comentariul respectiv. Un fișier nu dispare din bară când
  // capătă `eventId` — „am atașat ceva" trebuie să rămână adevărat acolo unde
  // omul se uită dintâi, iar bara e singurul loc care numără TOATE fișierele
  // tichetului.
  const [allAttachments, setAllAttachments] = useState<Attachment[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<{ images: Attachment[]; id: string } | null>(null)

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

  const loadAttachments = async () => {
    if (!ATTACHMENTS_ENABLED) return
    try {
      const list = await listAttachments(issueId)
      setAllAttachments(list)
      const images = list.filter((a) => isRenderableImage(a.contentType))
      // Un singur apel pentru toate căile — la fel ca `Attachments.tsx`.
      // `signedUrls` însuși memorează rezultatul (vezi `rememberUrls`), deci a
      // doua cerere pentru aceleași poze (bara tichetului, deja randată mai
      // sus) nu mai lovește rețeaua.
      if (images.length) setUrls(await signedUrls(images.map((a) => a.path)))
    } catch {
      // Atașamentele de sub comentarii sunt un plus, nu calea critică a
      // firului: un eșec aici nu trebuie să ascundă comentariile deja
      // încărcate cu succes.
    }
  }

  useEffect(() => { void loadAttachments() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [issueId])

  // Murdăria draftului se calculează într-UN SINGUR loc, din toate trei:
  // textul netrimis, atașamentele deja urcate (`pending`) și destinatarul ales
  // (`to`). Înainte doar textul conta — un fișier urcat sau un „către…" ales
  // treceau formularul drept curat, iar un click pe alt rând din listă comuta
  // firul fără nicio avertizare, lăsând fișierul orfan în storage (event_id
  // null). `to !== undefined` e starea „am ales ceva", inclusiv „către Nimeni"
  // (`to === null`) — vezi `canSubmit`.
  useEffect(() => {
    onDirtyChange(body.trim() !== '' || pending.length > 0 || to !== undefined)
  }, [body, pending, to, onDirtyChange])

  const attachmentsByEvent = useMemo(() => {
    const map = new Map<string, Attachment[]>()
    for (const a of allAttachments) {
      if (!a.eventId) continue
      const arr = map.get(a.eventId)
      if (arr) arr.push(a)
      else map.set(a.eventId, [a])
    }
    return map
  }, [allAttachments])

  const openAttachment = async (a: Attachment, group: Attachment[]) => {
    if (isRenderableImage(a.contentType)) {
      setLightbox({ images: group.filter((x) => isRenderableImage(x.contentType)), id: a.id })
      return
    }
    try {
      const url = await signedDownloadUrl(a)
      if (url) window.location.href = url
      else setAttMessage('Fișierul nu s-a putut descărca.')
    } catch (e) {
      setAttMessage(errorMessage(e))
    }
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

  // `busy > 0` = un upload de atașament încă în zbor: fără gardă, „Trimite"
  // pleca înaintea răspunsului de upload, iar comentariul ajungea pe fir fără
  // fișierul pe care omul tocmai îl alesese.
  const canSubmit = canWrite && !sending && busy === 0 && (body.trim() !== '' || pending.length > 0 || to !== undefined)

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
      // doar tabela `issues`) — păstrăm `deps` din tichetul vechi al store-ului.
      // Dacă tichetul vechi lipsește din store (n-ar trebui, dar dacă totuși),
      // NU scriem un tichet fără dependențe — mai bine store-ul rămâne
      // neschimbat decât să inventăm `deps: []` peste unul real.
      const prevIssue = byId[issueId]
      if (prevIssue) upsertIssue({ ...res.issue, deps: prevIssue.deps })
      // Firul e sursa de adevăr pentru cine ține tichetul acum. Dacă am CERUT
      // o pasă (`to !== undefined`), `IssueForm` trebuie să-și resincronizeze
      // `assigneeId` local — altfel formularul rămâne murdar pe veci ȘI o
      // atingere pe săgeata de salvare ar retrimite assignee-ul vechi peste
      // pasa abia făcută. La un comentariu simplu (`to === undefined`) NU
      // atingem nimic: am suprascrie o alegere nesalvată din „Assigned to".
      if (to !== undefined) onHandoff(res.issue.assigneeId)
      setBody('')
      setTo(undefined)
      setPending([]) // cele trei resetări de mai sus curăță și murdăria — vezi efectul unificat
      void loadAttachments() // atașamentele proaspăt trimise capătă acum un event_id
      // Cutia de pase (badge + listă „Pe mine") nu se atinge de `upsertIssue`:
      // fără reîmprospătare, un tichet trimis înapoi rămâne vizibil acolo până
      // la un refresh întreg. Best-effort: un eșec aici nu anulează trimiterea.
      void refreshInbox()
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
          {(() => { const now = new Date(); return events.map((e) => {
            if (e.kind === 'handoff') {
              return (
                <div key={e.id} className="thread-handoff">
                  {assigneeLabel(e.handoffFrom, assignees)} → {assigneeLabel(e.handoffTo, assignees)}
                  <span className="thread-handoff-time">{eventTime(e.createdAt, now)}</span>
                </div>
              )
            }
            const author = authorDisplay(e.authorId, assignees, myUserId)
            const group = attachmentsByEvent.get(e.id) ?? []
            return (
              <div key={e.id} className={`thread-comment${author.mine ? ' mine' : ''}`}>
                <span className={`thread-avatar${author.initials === null ? ' empty' : ''}`}>
                  {author.initials}
                </span>
                <div className="thread-comment-body">
                  <div className="thread-comment-card">
                    <div className="thread-comment-head">
                      <span className="thread-comment-name">{author.name}</span>
                      <span className="thread-comment-time">{eventTime(e.createdAt, now)}</span>
                    </div>
                    {e.body && <div className="thread-comment-text">{e.body}</div>}
                    {group.length > 0 && (
                      <div className="att-strip thread-comment-atts">
                        {group.map((a) => {
                          const isImg = isRenderableImage(a.contentType)
                          const url = urls[a.path]
                          const shown = isImg && url && !broken.has(a.path)
                          return (
                            <span key={a.id} className={`att-chip ${isImg ? 'img' : 'file'}`}>
                              <button
                                className="att-open"
                                onClick={() => void openAttachment(a, group)}
                                title={`${a.filename} · ${humanSize(a.size)}`}
                              >
                                {shown ? (
                                  <img
                                    src={url}
                                    alt={a.filename}
                                    loading="lazy"
                                    onError={() => setBroken((prev) => new Set(prev).add(a.path))}
                                  />
                                ) : isImg ? (
                                  <span className="att-ic off"><Icon name="fileImage" size={20} /></span>
                                ) : (
                                  <>
                                    <span className="att-ic"><Icon name={iconFor(a.contentType, a.filename)} size={20} /></span>
                                    <span className="att-name">{a.filename}</span>
                                  </>
                                )}
                              </button>
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          }) })()}
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
          onChange={(e) => setBody(e.target.value)}
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

      {lightbox && (() => {
        const idx = lightbox.images.findIndex((x) => x.id === lightbox.id)
        if (idx < 0) return null
        return (
          <Lightbox
            items={lightbox.images}
            index={idx}
            urlFor={(a) => (broken.has(a.path) ? undefined : urls[a.path])}
            canDelete={false}
            onIndex={(i) => setLightbox({ images: lightbox.images, id: lightbox.images[i]?.id ?? lightbox.id })}
            onClose={() => setLightbox(null)}
            onError={setAttMessage}
          />
        )
      })()}
    </div>
  )
}
