import { useRef, useState, useEffect, useLayoutEffect, useCallback, type ChangeEvent } from 'react'
import { detectCycle, requiredDepWave } from '../lib/engine'
import { buildAssigneeOptions, type AssigneeOption } from '../lib/assigneeOptions'
import { useAuth } from '../auth'
import { useHorizontal } from '../store'
import { useUI, type IssueDraft } from '../ui'
import { useCanWrite, useCoarsePointer, useMediaQuery, useTitleDate } from '../hooks'
import { ticketUrl } from '../lib/deepLink'
import { stripSpans } from '../lib/parseDue'
import { fold } from '../lib/text'
import { fillFromTitle, titleToSave, type FillMemo } from '../lib/titleDueFill'
import {
  DATE_PLACEHOLDER, NO_SCHEDULE, TIME_PLACEHOLDER, defaultReminder, displayFromInputDate,
  fromDisplayDate, fromInputs, fromTimeText, isOverdue, maskDateInput, maskTimeInput, reminderAt,
  reminderKindOf, toDateInput, toDisplayDate, toShortDate, toTimeInput, type ReminderKind,
} from '../lib/schedule'
import { dueLabelParts } from '../lib/quickDraft'
import {
  REMINDER_CHIP, REMINDER_OPTIONS, addMenuItems, datePresets, recurChipLabel, visibleChips,
} from '../lib/formChips'
import { Attachments } from './Attachments'
import { Thread } from './Thread'
import { DescField } from './DescField'
import type { EditorHandle } from './MarkdownEditor'
import { describeRrule } from '../lib/recurrence'
import { ChipPop } from './ChipPop'
import { attachBlocked } from './SheetFiles'
import type { Issue, TestScenario } from '../lib/types'
import { Icon } from './Icon'
import { waveLabel } from '../lib/waveBar'
import { displayIssueId, isTempIssueId } from '../lib/issueId'
import { repository } from '../data'
import { errorMessage } from '../lib/errorMessage'
import { OfflineError } from '../data/offline/netError'

const PALETTE = ['#0284C7', '#059669', '#D97706', '#EA580C', '#E11D48', '#7C3AED', '#06B6D4']

/**
 * Formularul e murdar de obstacole când setul de id-uri reale diferă de ce e
 * salvat — ordinea nu contează. Extrasă pură ca să fie testabilă fără randare.
 */
export function obstaclesDirty(current: string[], saved: string[]): boolean {
  return current.slice().sort().join(',') !== saved.slice().sort().join(',')
}

/**
 * Pe ce id scrie salvarea: `null` = tichet nou, se creează. O creare reușită
 * urmată de un pas care cade (offline, de obicei) lasă formularul deschis tot
 * pe „tichet nou" — fără `createdId`, a doua apăsare pe Salvează ar fi pus în
 * coadă A DOUA creare provizorie, adică un duplicat. Id-ul creat poate fi unul
 * provizoriu (`HZ-~…`) care între timp și-a primit numărul real, deci trece
 * prin `resolveId` la fiecare încercare, nu o singură dată.
 */
export function saveTargetId(
  existingId: string | undefined,
  createdId: string | null,
  resolveId: (id: string) => string,
): string | null {
  if (existingId) return existingId
  return createdId ? resolveId(createdId) : null
}

type DraftIssue = { tempId: string; title: string }
let draftCounter = 0
const newTempId = () => `__draft_${++draftCounter}__`

function depCols(n: number): number {
  if (n <= 2) return 1
  if (n <= 4) return 2
  return 3
}

export interface FormDirtyState {
  isEdit: boolean
  existing: Issue | undefined
  activeWave: number
  /** Tichetele care depind azi de `existing` (blocante) — gol la creare. */
  existingBlockerIds: string[]
  /** Obstacolele curente ale lui `existing` — gol la creare. */
  existingObstacleIds: string[]
  title: string
  desc: string
  theme: string
  wave: number
  assigneeId: string | null
  deps: string[]
  draftDeps: DraftIssue[]
  blocks: string[]
  draftBlocks: DraftIssue[]
  obstIds: string[]
  draftObstacles: DraftIssue[]
  selectors: string[]
  scenarios: TestScenario[]
  /**
   * Corpul netrimis din caseta firului (`Thread.tsx`). Contează DOAR la
   * editare — un tichet nesalvat n-are fir încă.
   */
  commentDraft: string
  urgent: boolean
  dueAt: string | null
  remindAt: string | null
  rrule: string | null
}

/**
 * Murdăria formularului, extrasă din randare ca să fie testabilă fără DOM —
 * aceeași comparație câmp cu câmp care trăia inline în `IssueForm`, doar
 * parametrizată. `obstaclesDirty` de mai sus rămâne separată: e testată și
 * folosită independent.
 */
export function isFormDirty(s: FormDirtyState): boolean {
  if (s.isEdit) {
    const existing = s.existing
    return (
      s.title !== (existing?.title ?? '') ||
      s.desc !== (existing?.desc ?? '') ||
      s.theme !== (existing?.theme ?? '') ||
      s.wave !== (existing?.wave ?? s.activeWave) ||
      s.assigneeId !== (existing?.assigneeId ?? null) ||
      s.deps.filter((d) => !d.startsWith('__draft_')).slice().sort().join(',') !== (existing?.deps ?? []).slice().sort().join(',') ||
      s.draftDeps.filter((d) => s.deps.includes(d.tempId)).length > 0 ||
      s.draftBlocks.filter((d) => s.blocks.includes(d.tempId)).length > 0 ||
      s.blocks.filter((b) => !b.startsWith('__draft_')).slice().sort().join(',') !== s.existingBlockerIds.slice().sort().join(',') ||
      obstaclesDirty(
        s.obstIds.filter((o) => !o.startsWith('__obst_draft_')),
        s.existingObstacleIds,
      ) ||
      s.draftObstacles.filter((d) => s.obstIds.includes(d.tempId)).length > 0 ||
      JSON.stringify(s.selectors) !== JSON.stringify(existing?.selectors ?? []) ||
      JSON.stringify(s.scenarios) !== JSON.stringify(existing?.scenarios ?? []) ||
      s.commentDraft.trim() !== '' ||
      s.urgent !== (existing?.urgent ?? false) ||
      s.dueAt !== (existing?.dueAt ?? null) ||
      s.remindAt !== (existing?.remindAt ?? null) ||
      s.rrule !== (existing?.rrule ?? null)
    )
  }
  return (
    s.title.trim() !== '' || s.desc.trim() !== '' || s.deps.length > 0 || s.blocks.length > 0 || s.obstIds.length > 0 ||
    s.selectors.length > 0 || s.scenarios.length > 0 || s.urgent || s.dueAt !== null || s.rrule !== null
  )
}

function AssigneeSearch({ assigneeId, assignees, members, myAssigneeId, myUserId, onSelect, onSelectMember, onCreateAndSelect }: {
  assigneeId: string | null
  assignees: import('../lib/types').Assignee[]
  /** Conturile cu acces la proiectul curent — vezi `src/lib/assigneeOptions.ts`. */
  members: import('../lib/types').ProjectMember[]
  myAssigneeId: string | null
  myUserId: string | null
  onSelect(id: string | null): void
  /** Un membru fără rând încă în `assignees` — creează rândul, apoi selectează-l. */
  onSelectMember(userId: string): Promise<void>
  onCreateAndSelect(name: string): Promise<void>
}) {
  const [q, setQ] = useState('')
  const [hlIdx, setHlIdx] = useState(0)
  const [creating, setCreating] = useState(false)
  const [linking, setLinking] = useState(false)
  /**
   * Lista se deschide la FOCUS, nu la prima literă: oamenii proiectului sunt
   * câțiva, nu o mie, deci a cere un termen de căutare ca să vezi trei nume e
   * o taxă pe nimic — și pe telefon înseamnă tastatură scoasă degeaba.
   * Căutarea rămâne pentru când lista chiar e lungă.
   */
  const [open, setOpen] = useState(false)

  const options = buildAssigneeOptions(assignees, members, myUserId)
  const filtered = q.trim() ? options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())) : options
  const hasExact = options.some((o) => o.name.toLowerCase() === q.toLowerCase().trim())
  const showCreate = q.trim() && !hasExact
  const optionCount = filtered.length + (showCreate ? 1 : 0)

  const selected = assigneeId ? assignees.find((a) => a.id === assigneeId) : null

  // Câmpul ține O SINGURĂ persoană, deci alegerea e și sfârșitul căutării:
  // lista se închide, spre deosebire de selectorul de dependențe, unde rămâne
  // deschisă fiindcă urmează de obicei încă una.
  const selectOption = async (opt: AssigneeOption) => {
    if (opt.kind === 'assignee') { onSelect(opt.id); setQ(''); setHlIdx(0); setOpen(false); return }
    if (linking) return
    setLinking(true)
    try { await onSelectMember(opt.userId); setQ(''); setHlIdx(0); setOpen(false) } finally { setLinking(false) }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!optionCount) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx((p) => Math.min(p + 1, optionCount - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHlIdx((p) => Math.max(p - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (hlIdx < filtered.length) void selectOption(filtered[hlIdx])
      else if (showCreate) handleCreate()
    } else if (e.key === 'Escape') { setQ(''); setHlIdx(0); setOpen(false) }
  }

  const handleCreate = async () => {
    const name = q.trim(); if (!name || creating) return
    setCreating(true)
    try { await onCreateAndSelect(name); setQ(''); setHlIdx(0); setOpen(false) } finally { setCreating(false) }
  }

  return (
    <div className="dep-search-block">
      <label className="if-field-label">Assigned to</label>
      {selected && (
        <div className="dep-selected">
          <button className="dep-chip on" onClick={() => onSelect(null)}>
            <span className="dep-chip-title">{selected.name}{selected.id === myAssigneeId ? ' (me)' : ''}</span>
            <span className="dep-chip-x"><Icon name="close" size={12} /></span>
          </button>
        </div>
      )}
      <div className="dep-search-wrap">
        <input value={q} onChange={(e) => { setQ(e.target.value); setHlIdx(0); setOpen(true) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          // Întârzierea lasă clickul pe un rând să se termine: pe unele
          // browsere blur-ul ajunge înaintea lui, iar `onMouseDown` de pe
          // rânduri (care păstrează focusul) nu acoperă atingerea pe touch.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search or add person…"
          className="dep-search-input" autoComplete="off" autoCorrect="off" inputMode="text" />
      </div>
      {(open || q.trim()) && (
        <div className="dep-results">
          {filtered.map((o, idx) => {
            const key = o.kind === 'assignee' ? o.id : `member:${o.userId}`
            const on = o.kind === 'assignee' && o.id === assigneeId
            return (
              <button key={key} className={`dep-result-row ${on ? 'on' : ''} ${idx === hlIdx ? 'hl' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void selectOption(o)}
                disabled={o.kind === 'member' && linking}>
                <span className={`ic ${on ? 'ok' : 'ext'}`}><Icon name={on ? 'check' : 'add'} size={14} /></span>
                <span className="dep-result-title">{o.name}{o.mine ? ' (me)' : ''}</span>
              </button>
            )
          })}
          {filtered.length === 0 && !showCreate && <p className="dep-no-results">No one found.</p>}
          {showCreate && (
            <button className={`dep-create-btn ${hlIdx === filtered.length ? 'hl' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCreate} disabled={creating}>
              <span className="dep-create-plus">+</span>
              Add <strong>«{q.trim()}»</strong>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * @param docked Formularul stă în panoul lateral, nu în foaia modală. Două
 *   diferențe, amândouă din faptul că lista rămâne pe ecran lângă el: nu fură
 *   focusul la fiecare click în listă, și își raportează starea „nesalvat”
 *   către `ui.tsx`, care oprește prima comutare pe alt tichet.
 */
export function IssueForm({ issueId, docked = false, draft, revealThread = false }: {
  issueId?: string
  docked?: boolean
  draft?: IssueDraft
  /** Deschis din rândul de fir al foii de telefon: derulează la fir, fără focus. */
  revealThread?: boolean
}) {
  const { project, projects, waves, themes, issues, byId, activeWave, toggleDone, createIssue, updateIssue, deleteIssue, createTheme, assignees, myAssigneeId, createAssignee, assigneeShort, projectMembers, ensureAssigneeForMember, obstacles, obstaclesOf, createObstacle, setIssueObstacles, reportError } = useHorizontal()
  const { closeSheet, setCloseGuard, pushSheet, openEditIssue, setDockedDirty, saveNudge, showToast, popOutIssue } = useUI()
  const { session } = useAuth()
  const myUserId = session?.user.id ?? null
  const canWrite = useCanWrite()
  const existing = issueId ? byId[issueId] : undefined
  const isEdit = !!existing

  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyResetTimer.current) clearTimeout(copyResetTimer.current) }, [])

  // Copiază link-ul absolut al ticketului. Necesar în PWA instalat, unde nu
  // există bară de adrese. clipboard.writeText cere context securizat (https
  // sau localhost) — fallback pe un textarea ascuns dacă lipsește. execCommand
  // e deprecat și poate eșua în silență, deci îi verificăm rezultatul: bifa se
  // arată doar la o copiere confirmată.
  const copyLink = useCallback(async (id: string | undefined) => {
    if (!id) return
    // Un tichet creat offline n-are încă număr: linkul `/HZ-~…` n-ar deschide
    // nimic pe alt dispozitiv. Se refuză vizibil, nu în tăcere.
    // Cronometrul de revenire e același ca la o copiere eșuată, altfel „fail"
    // ar rămâne agățat pe buton.
    if (isTempIssueId(id)) {
      setCopyState('fail')
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
      copyResetTimer.current = setTimeout(() => setCopyState('idle'), 4000)
      return
    }
    const url = ticketUrl(window.location.origin, id)
    let ok = false
    try {
      await navigator.clipboard.writeText(url)
      ok = true
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { ok = document.execCommand('copy') } catch { ok = false }
      document.body.removeChild(ta)
    }
    setCopyState(ok ? 'ok' : 'fail')
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
    copyResetTimer.current = setTimeout(() => setCopyState('idle'), ok ? 1600 : 4000)
  }, [])

  // Tasta `y` (convenția GitHub/Linear). Handler-ul global de shortcuts din
  // App.tsx nu se aplică aici — iese devreme când un sheet e deschis.
  useEffect(() => {
    if (!isEdit) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        void copyLink(existing?.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // Doar `existing?.id`: o dependență pe tot `existing` ar reînregistra
    // listener-ul la fiecare mutație de ticket.
  }, [isEdit, copyLink, existing?.id])

  // `draft`: ce a scris omul în foaia rapidă înainte de „…” — numai pentru un
  // tichet nou; unul existent se citește din store, ca până acum.
  const seed = existing ? undefined : draft
  const [title, setTitle] = useState(existing?.title ?? seed?.title ?? '')
  const [desc, setDesc] = useState(existing?.desc ?? seed?.desc ?? '')
  const [theme, setTheme] = useState(existing?.theme ?? '')
  // Un val activ care nu (mai) există nu e o alegere: primul val real.
  const [wave, setWave] = useState(existing?.wave
    ?? (waves.some((w) => w.number === activeWave) ? activeWave : (waves.find((w) => w.number !== 0) ?? waves[0])?.number ?? activeWave))
  const [assigneeId, setAssigneeId] = useState<string | null>(existing?.assigneeId ?? seed?.assigneeId ?? null)
  const [deps, setDeps] = useState<string[]>(existing?.deps ?? [])
  const [blocks, setBlocks] = useState<string[]>(
    existing ? issues.filter((i) => i.deps?.includes(existing.id)).map((i) => i.id) : []
  )
  const [draftDeps, setDraftDeps] = useState<DraftIssue[]>([])
  const [draftBlocks, setDraftBlocks] = useState<DraftIssue[]>([])
  const [obstIds, setObstIds] = useState<string[]>(
    existing ? obstaclesOf(existing.id).map((o) => o.id) : [],
  )
  /** Obstacole scrise în selector dar încă necreate. Același tipar ca DraftIssue. */
  const [draftObstacles, setDraftObstacles] = useState<DraftIssue[]>([])

  // QA (selectori, scenarii) nu se mai editează din interfață: testele le face
  // agentul, iar un scenariu de care e nevoie se scrie în descriere. Valorile
  // vechi trec neatinse la salvare, ca un tichet salvat să nu le șteargă.
  const [selectors] = useState<string[]>(existing?.selectors ?? [])
  const [scenarios] = useState<TestScenario[]>(existing?.scenarios ?? [])
  /**
   * Nu ținem textul firului aici — ăla trăiește în `Thread.tsx`, care își
   * gestionează singur trimiterea. Aici contează doar SEMNALUL de murdărie,
   * ca `isDirty` să știe că există ceva netrimis. Vezi `isFormDirty`.
   */
  const [commentDraftDirty, setCommentDraftDirty] = useState(false)
  const [urgent, setUrgent] = useState(existing?.urgent ?? seed?.urgent ?? false)
  // Scadența trăiește în formular ca cele două valori pe care le scrie userul,
  // nu ca ISO: inputurile native vorbesc local, iar conversia stă în
  // `lib/schedule`. Ora goală = toată ziua, deci `allDay` nu are stare proprie.
  // Textul scris de utilizator, în `zz/ll/aaaa`. Valoarea canonică se derivă din
  // el — o singură stare, deci textul din câmp și data salvată nu pot diverge.
  const seedDue = existing ?? (seed?.dueAt ? { dueAt: seed.dueAt, allDay: seed.allDay } : undefined)
  const [dueText, setDueText] = useState(seedDue?.dueAt ? toDisplayDate(seedDue.dueAt) : '')
  const dueDate = fromDisplayDate(dueText) ?? ''
  // Text scris pe jumătate: nu e o eroare, doar nu e încă o dată. Semnalul e
  // discret, ca să nu certe pe cineva care tocmai a apăsat prima cifră.
  const dueIncomplete = dueText.trim() !== '' && dueDate === ''
  const nativeDateRef = useRef<HTMLInputElement>(null)
  // Ca la dată: textul e starea, valoarea validată se derivă. `dueTime` rămâne
  // numele valorii validate, ca `fromInputs` să primească exact ce primea.
  const [timeText, setTimeText] = useState(
    seedDue?.dueAt && !seedDue.allDay ? toTimeInput(seedDue.dueAt) : '',
  )
  const dueTime = fromTimeText(timeText) ?? ''
  const timeIncomplete = timeText.trim() !== '' && dueTime === ''
  const nativeTimeRef = useRef<HTMLInputElement>(null)
  /**
   * A atins omul câmpul de titlu în această deschidere a formularului?
   *
   * Singura poartă a recunoașterii, în locul vechilor `isEdit` și „scadența e
   * a utilizatorului".
   * Titlul e stăpânul scadenței — o dată scrisă în titlu rescrie și o scadență
   * aleasă cândva din calendar — dar numai ca URMARE A UNEI TASTĂRI. Fără
   * condiția asta, deschiderea unui tichet vechi i-ar muta scadența singură:
   * fragmentul „la 2p" rămas în titlu se recalculează față de ziua de azi, nu
   * față de ziua în care a fost scris.
   */
  const [titleTyped, setTitleTyped] = useState(false)
  /** Ce am completat noi și peste ce — vezi `lib/titleDueFill`. */
  const fillMemo = useRef<FillMemo | null>(null)
  /**
   * Recunoașterea datei din titlu, cu evidențiere în input și refuz pe fragment
   * — același hook ca la adăugarea rapidă, ca gestul să fie unul singur în toată
   * aplicația. O singură condiție: să fi tastat cineva în titlu. La un tichet
   * nou asta e oricum adevărat înainte să existe o dată de recunoscut.
   */
  const titleDate = useTitleDate(title, {
    enabled: canWrite && titleTyped,
    onChange: (next) => {
      setTitleTyped(true)
      setTitle(next)
    },
  })
  const [reminder, setReminder] = useState<ReminderKind>(
    existing ? reminderKindOf(existing.dueAt, existing.remindAt) : 'none',
  )
  // Mementoul implicit urmează forma scadenței cât timp userul nu l-a atins.
  const [reminderTouched, setReminderTouched] = useState(false)
  const [rrule, setRrule] = useState<string | null>(existing?.rrule ?? seed?.rrule ?? null)
  const schedule = (() => {
    const { dueAt, allDay } = fromInputs(dueDate, dueTime)
    // Un tichet existent își păstrează mementoul salvat cât scadența are aceeași
    // formă (cu / fără oră): implicitul „la oră" pus peste un tichet cu oră și
    // fără memento îl făcea „nesalvat" la simpla deschidere, iar orice salvare
    // îi adăuga în tăcere un memento.
    const kind = reminderTouched ? reminder
      : existing?.dueAt && dueAt && existing.allDay === allDay ? reminder
      : defaultReminder(allDay)
    return { dueAt, allDay, remindAt: reminderAt(dueAt, kind), kind }
  })()
  /**
   * Recurența care chiar se salvează. O repetare fără dată de start nu înseamnă
   * nimic — motorul pleacă de la scadență — iar rândul „Repetare" nici nu se
   * mai vede fără ea (`dueDate && …`, mai jos). Fără regula asta, un tichet
   * căruia i-ai șters scadența rămânea cu un `rrule` salvat, invizibil și
   * nescoatabil din interfață: o stare din care nu se mai iese.
   *
   * Se DERIVĂ, nu se șterge din stare: pui data la loc și repetarea revine cu
   * ea. Golirea scadenței nu e o ștergere a recurenței, e dispariția lucrului
   * peste care recurența avea sens.
   */
  const rruleOut = dueDate ? rrule : null

  /**
   * Rândul de jetoane are UN singur popover deschis odată (data, valul, „+",
   * tema, persoana, agrafa). O singură stare, nu un boolean pe fiecare: două
   * meniuri deschise unul peste altul nu au ce căuta într-un rând de 30px.
   */
  const [openPop, setOpenPop] = useState<null | 'date' | 'wave' | 'add' | 'theme' | 'who' | 'attach'>(null)
  /** Jetonul care a deschis popoverul: aliniere și întoarcerea focusului la Esc. */
  const popAnchor = useRef<HTMLElement | null>(null)
  const chipRowRef = useRef<HTMLDivElement>(null)
  /** Drumul de urcare al barei de fișiere, chemat de agrafa din rând. */
  const addFilesRef = useRef<((files: File[]) => void) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const coarse = useCoarsePointer()
  const [showNewTheme, setShowNewTheme] = useState(false)
  const [newThemeName, setNewThemeName] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [cycleMsg, setCycleMsg] = useState<string | null>(null)
  const [waveError, setWaveError] = useState<string | null>(null)
  const [obstacleError, setObstacleError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [depTab, setDepTab] = useState<'necesita' | 'permite' | 'obstacole'>('necesita')

  const [depSearchQ, setDepSearchQ] = useState('')
  const [depSearchHl, setDepSearchHl] = useState(0)
  const [depDropdownOpen, setDepDropdownOpen] = useState(false)


  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const descRef = useRef<EditorHandle>(null)
  const prefixes = projects.map((p) => p.prefix)
  // `#HZ-12` din descriere: cardul tichetului, dacă e încărcat (ca în EditSheet).
  const openRef = (id: string) => (byId[id] ? pushSheet({ kind: 'issue', issueId: id }) : showToast(`${id} nu e încărcat — deschide-i proiectul.`))
  /** Coloana de descriere, ca zonă de drop pentru fișiere. Bara de atașamente
   *  e prea subțire ca să fie o țintă nimerită cu mouse-ul. */
  const descColRef = useRef<HTMLDivElement>(null)
  const [dropActive, setDropActive] = useState(false)

  useEffect(() => {
    if (isEdit && titleInputRef.current) {
      titleInputRef.current.setSelectionRange(0, 0)
      titleInputRef.current.scrollTop = 0
    }
  }, [])

  /**
   * Titlul crește pe cât are nevoie.
   *
   * Un `<input>` nu se rupe pe rânduri: pe telefon, un titlu lung se tăia la
   * marginea ecranului fără niciun semn că mai e text — și nicăieri altundeva
   * nu se putea citi întreg (bulina de hover cu titlul complet nu există pe
   * atingere). De-aia e `<textarea>`, iar înălțimea se măsoară aici, nu din
   * CSS: `field-sizing: content` n-are încă suport în Safari/iOS, adică exact
   * pe dispozitivul pentru care s-a făcut schimbarea.
   *
   * `useLayoutEffect`, nu `useEffect`: măsurarea trebuie făcută înainte de
   * pictare, altfel la deschiderea unui tichet cu titlu lung s-ar vedea un
   * cadru cu rândul de 26px, apoi saltul.
   */
  useLayoutEffect(() => {
    const el = titleInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])

  /**
   * Titlul → câmpurile de scadență.
   *
   * Decizia nu e aici: e în `fillFromTitle`, ca să fie testabilă fără DOM. Aici
   * rămâne doar traducerea — ISO-ul parserului în textul câmpurilor, și înapoi.
   *
   * `dueText`/`timeText` se citesc din randarea curentă, dar NU sunt dependențe:
   * efectul trebuie să reacționeze la titlu, nu la propriile scrieri, altfel se
   * învârte. `rejectedKey` E dependență: un fragment refuzat trebuie să retragă
   * imediat ce completase.
   */
  useEffect(() => {
    if (!canWrite || !titleTyped) return
    const parsed = titleDate.parsed
    const recognized =
      titleDate.active && parsed.dueAt
        ? { date: toDisplayDate(parsed.dueAt), time: parsed.allDay ? '' : toTimeInput(parsed.dueAt) }
        : null
    const next = fillFromTitle({ date: dueText, time: timeText }, recognized, fillMemo.current)
    fillMemo.current = next.memo
    setDueText(next.fields.date)
    setTimeText(next.fields.time)
    if (titleDate.active && parsed.rrule) setRrule(parsed.rrule)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, titleDate.rejectedKey, canWrite, titleTyped])

  /** Scoate din titlu fragmentele care au devenit scadență. */
  const cleanTitleFromDate = () => {
    const next = stripSpans(title, titleDate.parsed.spans)
    // Uităm ce am completat: scadența aplicată devine definitivă, exact ca una
    // scrisă cu mâna. Uitarea e de ajuns — efectul nu mai are ce retrage când
    // titlul rămâne fără dată, iar o altă dată scrisă mai târziu în titlu se
    // aplică din nou.
    fillMemo.current = null
    setTitle(next)
  }

  /**
   * „Nu e o dată." Refuză fragmentele evidențiate ACUM, nu recunoașterea în
   * general: efectul de mai sus retrage singur ce completase, iar o dată scrisă
   * mai târziu în titlu se recunoaște din nou. Un refuz global s-ar fi întins
   * peste tot restul cardului, după un singur „Podul 5".
   */
  const refuseTitleDate = () => titleDate.rejectAll()

  /**
   * Titlul care se salvează — fără fragmentele devenite scadență. Decizia e în
   * `titleToSave`; aici rămâne doar folosirea ei, în locul lui `title.trim()`.
   * Butonul „curăță titlul" nu dispare: el face tăietura ACUM, ca s-o vezi
   * înainte de salvare.
   */
  const { title: saveTitle, bare: bareTitle } = titleToSave(title, titleDate.title)

  const isDirty = isFormDirty({
    isEdit,
    existing,
    activeWave,
    existingBlockerIds: existing ? issues.filter((i) => i.deps?.includes(existing.id)).map((i) => i.id) : [],
    existingObstacleIds: existing ? obstaclesOf(existing.id).map((o) => o.id) : [],
    title, desc, theme, wave, assigneeId, deps, draftDeps, blocks, draftBlocks,
    obstIds, draftObstacles, selectors, scenarios,
    // Thread ține propriul text; aici trecem doar semnalul de murdărie, sub
    // forma cerută de isFormDirty — orice șir nevid înseamnă "ceva netrimis".
    commentDraft: commentDraftDirty ? 'draft' : '',
    urgent,
    dueAt: schedule.dueAt,
    remindAt: schedule.remindAt,
    rrule: rruleOut,
  })

  useEffect(() => {
    if (isDirty) {
      setCloseGuard(() => { setConfirmClose(true); return false })
    } else {
      setCloseGuard(null)
    }
    return () => setCloseGuard(null)
  }, [isDirty, setCloseGuard])

  // Garda de close de mai sus prinde doar închiderea explicită (X, Escape).
  // Comutarea pe alt tichet din listă nu trece pe acolo, deci panoul are
  // nevoie de starea asta separat — vezi `openEditIssue` din `ui.tsx`.
  useEffect(() => {
    if (!docked) return
    setDockedDirty(isDirty)
    return () => setDockedDirty(false)
  }, [docked, isDirty, setDockedDirty])

  // Semnalul „ți-am oprit comutarea": săgeata de salvare clipește o dată.
  // Fără el, refuzul ar fi fost tăcut, adică s-ar fi citit ca un click pierdut.
  const [nudging, setNudging] = useState(false)
  useEffect(() => {
    if (!docked || saveNudge === 0) return
    setNudging(true)
    const t = setTimeout(() => setNudging(false), 900)
    return () => clearTimeout(t)
  }, [docked, saveNudge])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canWrite) return
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'Enter') { e.preventDefault(); void save({ close: true }) }
        else if (e.key.toLowerCase() === 's') { e.preventDefault(); void save({ close: false }) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* Aceeași limită ca media query-ul de telefon din `styles.css` — sub ea,
     popoverele jetoanelor devin foi de jos. Sus, cu celelalte hook-uri: sub
     `if (!project) return null` ar fi fost un hook condiționat, deci numărul
     lor s-ar fi schimbat de la o randare la alta. */
  const narrow = useMediaQuery('(max-width: 899px)')

  // Ce a reușit deja să se creeze la o salvare care a căzut pe drum: tichetul
  // însuși și ciornele (dependențe, „permite", obstacole), cheie = id-ul
  // `__draft_…`. Refs, nu state: trebuie să supraviețuiască exact între două
  // apăsări pe Salvează, fără să remonteze și fără să facă formularul „murdar".
  // Tot deasupra lui `if (!project)`, din același motiv ca `narrow`.
  const createdIdRef = useRef<string | null>(null)
  const createdDraftsRef = useRef<Record<string, string>>({})

  if (!project) return null

  const candidates = issues.filter((i) => i.id !== issueId)

  const toggleDraft = (ds: DraftIssue[], setDs: (v: DraftIssue[]) => void, ids: string[], setIds: (v: string[]) => void, d: DraftIssue) => {
    if (ids.includes(d.tempId)) { setIds(ids.filter((x) => x !== d.tempId)); setDs(ds.filter((x) => x.tempId !== d.tempId)) }
  }

  const createDraftDep = (t: string) => { const d = { tempId: newTempId(), title: t }; setDraftDeps((p) => [...p, d]); setDeps((p) => [...p, d.tempId]) }
  const createDraftBlock = (t: string) => { const d = { tempId: newTempId(), title: t }; setDraftBlocks((p) => [...p, d]); setBlocks((p) => [...p, d.tempId]) }
  /**
   * Prefixul e `__obst_draft_`, nu `__draft_o_`: `__draft_o_` tot ar începe cu
   * `__draft_`, adică ar cădea în filtrele care taie ciornele de tichet — o
   * ciornă de obstacol ar ajunge la `createIssue`. `__obst_draft_` nu e prefixat
   * de `__draft_`, deci scapă de toate cele opt filtre existente.
   */
  const createDraftObstacle = (t: string) => {
    const tempId = `__obst_draft_${Date.now()}`
    setDraftObstacles((p) => [...p, { tempId, title: t }])
    setObstIds((p) => [...p, tempId])
  }

  // Dep section helpers (inline design)
  const necRealIds = deps.filter((d) => !d.startsWith('__draft_'))
  const necDraftItems = draftDeps.filter((d) => deps.includes(d.tempId))
  const necCount = necRealIds.length + necDraftItems.length

  const perRealIds = blocks.filter((b) => !b.startsWith('__draft_'))
  const perDraftItems = draftBlocks.filter((d) => blocks.includes(d.tempId))
  const perCount = perRealIds.length + perDraftItems.length

  const obstRealIds = obstIds.filter((o) => !o.startsWith('__obst_draft_'))
  const obstDraftItems = draftObstacles.filter((d) => obstIds.includes(d.tempId))

  const currentRealIds = depTab === 'necesita' ? necRealIds : depTab === 'permite' ? perRealIds : obstRealIds
  const currentDraftItems = depTab === 'necesita' ? necDraftItems : depTab === 'permite' ? perDraftItems : obstDraftItems
  const totalCurrentCount = currentRealIds.length + currentDraftItems.length

  // Sursa de căutare depinde de tab: tichete pentru „Necesită"/„Permite",
  // obstacole pentru „Obstacole" — amândouă au id/title, deci restul (dropdown,
  // navigare cu săgeți) rămâne un singur cod, tab-agnostic.
  const depFiltered: { id: string; title: string }[] = depSearchQ.trim()
    ? depTab === 'obstacole'
      ? obstacles.filter((o) => fold(o.title).includes(fold(depSearchQ)) || fold(o.id).includes(fold(depSearchQ)))
      : candidates.filter((i) => i.title.toLowerCase().includes(depSearchQ.toLowerCase()))
    : []
  const depHasExact = depTab === 'obstacole'
    ? depFiltered.some((o) => fold(o.title) === fold(depSearchQ.trim()))
    : depFiltered.some((i) => i.title.toLowerCase() === depSearchQ.toLowerCase().trim())
  const depShowCreate = !!depSearchQ.trim() && !depHasExact
  const depOptionCount = depFiltered.length + (depShowCreate ? 1 : 0)

  const addCurrentDep = (id: string) => {
    const alreadyIn = depTab === 'necesita' ? deps.includes(id) : depTab === 'permite' ? blocks.includes(id) : obstIds.includes(id)
    if (alreadyIn) return
    if (depTab === 'necesita') setDeps((p) => [...p, id])
    else if (depTab === 'permite') setBlocks((p) => [...p, id])
    else setObstIds((p) => [...p, id])
    setDepSearchQ(''); setDepDropdownOpen(false); setDepSearchHl(0)
  }

  const removeCurrentDep = (id: string) => {
    if (depTab === 'necesita') setDeps(deps.filter((d) => d !== id))
    else if (depTab === 'permite') setBlocks(blocks.filter((b) => b !== id))
    else setObstIds(obstIds.filter((o) => o !== id))
  }

  const removeCurrentDraft = (d: DraftIssue) => {
    if (depTab === 'necesita') toggleDraft(draftDeps, setDraftDeps, deps, setDeps, d)
    else if (depTab === 'permite') toggleDraft(draftBlocks, setDraftBlocks, blocks, setBlocks, d)
    else toggleDraft(draftObstacles, setDraftObstacles, obstIds, setObstIds, d)
  }

  const createCurrentDraft = (t: string) => {
    if (depTab === 'necesita') createDraftDep(t)
    else if (depTab === 'permite') createDraftBlock(t)
    else createDraftObstacle(t)
    setDepSearchQ(''); setDepDropdownOpen(false); setDepSearchHl(0)
  }

  const handleDepKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!depOptionCount) {
      if (e.key === 'Escape') { setDepSearchQ(''); setDepDropdownOpen(false); setDepSearchHl(0) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setDepSearchHl((p) => Math.min(p + 1, depOptionCount - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setDepSearchHl((p) => Math.max(p - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (depSearchHl < depFiltered.length) addCurrentDep(depFiltered[depSearchHl].id)
      else if (depShowCreate) createCurrentDraft(depSearchQ.trim())
    }
    else if (e.key === 'Escape') { setDepSearchQ(''); setDepDropdownOpen(false); setDepSearchHl(0) }
  }

  const themeObj = theme ? themes.find((t) => t.key === theme) : undefined
  const assigneeName = assigneeId ? (assignees.find((a) => a.id === assigneeId)?.name ?? null) : null

  const addTheme = async () => {
    if (!canWrite) return
    const name = newThemeName.trim(); if (!name) return
    const created = await createTheme(name, PALETTE[themes.length % PALETTE.length])
    if (created) setTheme(created.key)
    setNewThemeName(''); setShowNewTheme(false); closePop(true)
  }

  const cycleAfterSave = (): string | null => {
    const targetId = existing?.id ?? '__new__'
    const titleOf = (id: string) => id === targetId ? title.trim() || '(nou)' : byId[id]?.title ?? id
    const prospective: Issue[] = issues.map((i) => ({ ...i, deps: [...(i.deps ?? [])] }))
    let target = prospective.find((i) => i.id === targetId)
    if (!target) {
      target = { id: targetId, projectId: project.id, title, desc: '', theme, wave, deps: [], done: false, selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: new Date().toISOString(), urgent: false, ...NO_SCHEDULE }
      prospective.push(target)
    }
    target.deps = [...deps.filter((d) => !d.startsWith('__draft_'))]
    for (const p of prospective) {
      if (p.id === targetId) continue
      const realBlocks = blocks.filter((b) => !b.startsWith('__draft_'))
      const shouldDepend = realBlocks.includes(p.id)
      const has = p.deps.includes(targetId)
      if (shouldDepend && !has) p.deps = [...p.deps, targetId]
      if (!shouldDepend && has) p.deps = p.deps.filter((d) => d !== targetId)
    }
    const cycle = detectCycle(prospective)
    return cycle ? cycle.map(titleOf).join(' → ') : null
  }

  const save = async ({ close }: { close: boolean }) => {
    if (!canWrite || !saveTitle || saving || waves.length === 0) return
    const cyc = cycleAfterSave()
    if (cyc) { setCycleMsg(cyc); return }
    setCycleMsg(null); setObstacleError(null); setSaving(true)
    // Câmpul urmează ce s-a salvat, altfel formularul ar rămâne „murdar" pe o
    // diferență invizibilă. Uităm și memoria completării: scadența aplicată
    // devine definitivă, exact ca la „curăță titlul".
    if (saveTitle !== title) { fillMemo.current = null; setTitle(saveTitle) }
    try {
      const resolveId = repository.sync?.resolveId ?? ((id: string) => id)
      // O ciornă creată la o încercare anterioară nu se mai creează o dată.
      const draftIssue = async (d: DraftIssue): Promise<string> => {
        const done = createdDraftsRef.current[d.tempId]
        if (done) return resolveId(done)
        const created = await createIssue({ projectId: project.id, title: d.title, desc: '', theme, wave, deps: [] })
        createdDraftsRef.current[d.tempId] = created.id
        return created.id
      }
      const draftDepMap: Record<string, string> = {}
      for (const d of draftDeps) {
        if (deps.includes(d.tempId)) draftDepMap[d.tempId] = await draftIssue(d)
      }
      const draftBlockMap: Record<string, string> = {}
      for (const d of draftBlocks) {
        if (blocks.includes(d.tempId)) draftBlockMap[d.tempId] = await draftIssue(d)
      }
      // `deps`/`blocks` sunt capturate la montare și pot ține ID-ul provizoriu
      // al unui tichet care între timp a primit numărul real (cheia formularului
      // rămâne stabilă peste remapare). Repository-ul traduce ce TRIMITE, dar
      // aici se și COMPARĂ cu tichetele de acum, care au deja ID-ul real: fără
      // traducere, „HZ-~…" n-ar fi găsit în `currentBlockers`, iar „HZ-13"
      // ar fi părut scos de om — legătura s-ar fi șters în tăcere.
      const realDeps = (deps.map((id) => draftDepMap[id] ?? (id.startsWith('__draft_') ? null : id)).filter(Boolean) as string[]).map(resolveId)
      const qaPayload = {
        selectors: selectors.filter(Boolean), scenarios, assigneeId, urgent,
        dueAt: schedule.dueAt, allDay: schedule.allDay, remindAt: schedule.remindAt, rrule: rruleOut,
      }
      const ticketFields = { title: saveTitle, desc: desc.trim() === '' ? '' : desc, theme, wave, deps: realDeps, ...qaPayload }
      const prior = saveTargetId(existing?.id, createdIdRef.current, resolveId)
      let targetId: string
      if (prior !== null) {
        await updateIssue(prior, ticketFields)
        targetId = prior
      } else {
        targetId = (await createIssue({ projectId: project.id, ...ticketFields })).id
        // Imediat, înaintea oricărui pas care cere rețea: de aici încolo o
        // reîncercare actualizează tichetul acesta, nu creează altul.
        createdIdRef.current = targetId
      }

      // Obstacolele vin DUPĂ tichet și au plasa lor: crearea și legarea lor
      // cer rețea (nu trec prin coadă), iar sarcina capturată offline trebuie
      // să se salveze oricum — un obstacol pierdut se pune la loc dintr-un
      // click, o sarcină pierdută nu. Se scrie doar dacă setul chiar s-a
      // schimbat față de ce avea tichetul: un apel cu lista neschimbată (sau
      // goală, la un tichet nou) ar fi căzut offline fără să aibă ce trimite.
      // `prior`, nu `isEdit`: un tichet creat la o încercare anterioară are deja
      // obstacolele legate atunci, iar scoaterea lor trebuie să se vadă ca schimbare.
      const obstaclesBefore = prior !== null ? obstaclesOf(targetId).map((o) => o.id) : []
      const realObstIds: string[] = []
      let obstaclesFailed = false
      try {
        for (const id of obstIds) {
          const draft = draftObstacles.find((d) => d.tempId === id)
          if (!draft) { realObstIds.push(id); continue }
          const done = createdDraftsRef.current[id]
          if (done) { realObstIds.push(done); continue }
          // `null` doar fără proiect activ — practic inatins cât formularul e
          // randat, dar nu trecem tăcut peste: legarea nu se face cu un set parțial.
          const created = await createObstacle({ title: draft.title })
          if (!created) throw new Error(`Nu am putut crea obstacolul „${draft.title}".`)
          createdDraftsRef.current[id] = created.id
          realObstIds.push(created.id)
        }
        if (obstaclesDirty(realObstIds, obstaclesBefore)) {
          // Pe semnal slab captura întoarce ecoul provizoriu după 3 s, cu
          // crearea încă în coadă; legarea merge direct la server, care n-ar
          // cunoaște `HZ-~…` și ar răspunde cu o constrângere de neînțeles.
          if (isTempIssueId(targetId)) {
            throw repository.sync?.status().offline
              ? new OfflineError()
              : new Error('tichetul încă își așteaptă numărul — salvează din nou după sincronizare.')
          }
          await setIssueObstacles(targetId, realObstIds)
        }
      } catch (e) {
        obstaclesFailed = true
        setObstacleError(`Tichetul s-a salvat, obstacolele nu: ${errorMessage(e)}`)
      }
      const realBlocks = (blocks.map((id) => draftBlockMap[id] ?? (id.startsWith('__draft_') ? null : id)).filter(Boolean) as string[]).map(resolveId)
      const currentBlockers = issues.filter((i) => i.deps?.includes(targetId)).map((i) => i.id)
      for (const b of realBlocks.filter((b) => !currentBlockers.includes(b))) {
        const bi = byId[b]; if (bi) await updateIssue(b, { deps: [...(bi.deps ?? []), targetId] })
      }
      for (const b of currentBlockers.filter((b) => !realBlocks.includes(b))) {
        const bi = byId[b]; if (bi) await updateIssue(b, { deps: (bi.deps ?? []).filter((d) => d !== targetId) })
      }
      for (const [tempId, realId] of Object.entries(draftBlockMap)) {
        if (blocks.includes(tempId)) await updateIssue(realId, { deps: [targetId] })
      }

      let snap = issues.map((i) => {
        if (i.id === targetId) return { ...i, wave, deps: realDeps }
        if (realBlocks.includes(i.id) && !currentBlockers.includes(i.id))
          return { ...i, deps: [...(i.deps ?? []), targetId] }
        if (currentBlockers.includes(i.id) && !realBlocks.includes(i.id))
          return { ...i, deps: (i.deps ?? []).filter((d) => d !== targetId) }
        return i
      })
      if (!snap.find((i) => i.id === targetId)) {
        snap = [...snap, { id: targetId, projectId: project.id, title: saveTitle, desc: desc.trim() === '' ? '' : desc, theme, wave, deps: realDeps, done: false, selectors: selectors.filter(Boolean), scenarios, assigneeId, createdBy: null, createdAt: new Date().toISOString(), urgent, dueAt: schedule.dueAt, allDay: schedule.allDay, remindAt: schedule.remindAt, rrule: rruleOut }]
      }
      const cascadeQueue = [...realDeps]
      const cascadeSeen = new Set<string>()
      while (cascadeQueue.length > 0) {
        const depId = cascadeQueue.shift()!
        if (cascadeSeen.has(depId)) continue
        cascadeSeen.add(depId)
        const dep = snap.find((i) => i.id === depId)
        if (!dep) continue
        const req = requiredDepWave(depId, snap)
        if (req !== null && dep.wave !== req) {
          await updateIssue(depId, { wave: req })
          snap = snap.map((i) => (i.id === depId ? { ...i, wave: req } : i))
          for (const d of dep.deps ?? []) cascadeQueue.push(d)
        }
      }

      if (obstaclesFailed) {
        // Formularul rămâne deschis cu bannerul obstacolelor și cu selecția
        // omului intactă; ciornele deja create își iau id-ul real ca o nouă
        // apăsare să nu le dubleze. Fără remontare (`openEditIssue`): ar citi
        // obstacolele din store, adică exact setul care n-a ajuns la server.
        setDeps(realDeps)
        setBlocks(realBlocks)
        setDraftDeps([])
        setDraftBlocks([])
        setObstIds(obstIds.map((id) => createdDraftsRef.current[id] ?? id))
        setDraftObstacles(draftObstacles.filter((d) => !createdDraftsRef.current[d.tempId]))
        return
      }
      setCloseGuard(null)
      if (close) {
        closeSheet()
      } else {
        // Stay open: reconcile inline drafts to their real ids so their cards
        // become clickable and the form is no longer dirty.
        setDeps(realDeps)
        setBlocks(realBlocks)
        setDraftDeps([])
        setDraftBlocks([])
        setObstIds(realObstIds)
        setDraftObstacles([])
        // A brand-new card must adopt the id it was just created under, so a
        // second save updates it instead of creating a duplicate. Switching the
        // sheet's issueId remounts the form in edit mode (SheetHost keys it by
        // issueId). Existing cards already have the right id — leave the sheet
        // (and any navigation stack) as-is.
        // `full`: pe telefon, fără el, tichetul abia creat ar sări din
        // formularul complet în foaia scurtă (`compactIssueIdFrom`).
        if (!isEdit) openEditIssue(targetId, { full: true })
      }
    } catch (e) {
      // Fără `catch`, o eroare de aici era o promisiune respinsă pe care n-o
      // vedea nimeni: formularul rămânea deschis și murdar, fără niciun mesaj.
      // Rămâne deschis în continuare (nimic nu e pierdut), dar acum spune de ce.
      reportError(errorMessage(e))
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!canWrite || !existing || saving) return
    setSaving(true)
    try { await deleteIssue(existing.id); setCloseGuard(null); closeSheet() }
    finally { setSaving(false) }
  }



  /* ── Rândul de jetoane (design/form-compact) ─────────────────────────────
     Între titlu și descriere stă un singur rând, cu NUMAI ce e setat: data
     (singura cu jeton-fantomă, fiindcă e cea mai des pusă), mementoul,
     repetarea, valul, tema, persoana, urgentul — apoi agrafa și „+". Fiecare
     jeton își deschide popoverul; `openPop` e o singură stare. Datele curg
     exact ca înainte (aceleași `set*`), s-a schimbat doar unde stau controalele. */

  const now = new Date()
  const togglePop = (kind: NonNullable<typeof openPop>, anchor: HTMLElement) => {
    if (openPop === kind) { setOpenPop(null); return }
    popAnchor.current = anchor
    setShowNewTheme(false)
    setOpenPop(kind)
  }
  /** Din „+" într-un sub-popover: ancora rămâne „+", ca Esc să se întoarcă acolo. */
  const switchPop = (kind: NonNullable<typeof openPop>) => {
    setShowNewTheme(false)
    setOpenPop(kind)
  }
  function closePop(returnFocus: boolean) {
    setOpenPop(null)
    setShowNewTheme(false)
    if (returnFocus) popAnchor.current?.focus()
  }

  /** Valul, cu aceeași gardă de dependențe ca înainte. Întoarce dacă a mers. */
  const chooseWave = (n: number): boolean => {
    if (isEdit && existing) {
      const dependants = issues.filter((i) => (i.deps ?? []).includes(existing.id))
      if (dependants.length > 0) {
        const required = Math.min(...dependants.map((d) => d.wave))
        if (n !== required) {
          const names = dependants.map((d) => `„${d.title}" (val ${d.wave})`).join(', ')
          setWaveError(`„${title}" este o dependență a ${names}. Nu poți muta tichetul.`)
          return false
        }
      }
    }
    setWave(n)
    setWaveError(null)
    return true
  }

  const clearDue = () => { setDueText(''); setTimeText(''); setReminderTouched(false) }

  /** Agrafa: refuzul spus pe față (local, offline, tichet nesalvat), altfel
   *  fișierul nativ — cu meniu cameră/fișier pe ecranele tactile. */
  const pickAttach = (anchor: HTMLElement) => {
    const why = attachBlocked(existing?.id) ?? (existing ? null : 'Salvează tichetul, apoi atașează fișiere.')
    if (why) { showToast(why); return }
    if (coarse) { togglePop('attach', anchor); return }
    fileInputRef.current?.click()
  }
  const onFilesChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    // Resetul e obligatoriu: același fișier ales a doua oară n-ar mai declanșa `change`.
    e.target.value = ''
    if (files.length) addFilesRef.current?.(files)
  }

  const chips = visibleChips({
    hasDue: !!dueDate,
    hasTime: !!dueTime,
    reminder: schedule.kind,
    rrule: rruleOut,
    waveCount: waves.length,
    hasTheme: !!theme,
    hasAssignee: !!assigneeId,
    urgent,
  })
  const addItems = addMenuItems({ hasTheme: !!theme, hasAssignee: !!assigneeId })
  const dueParts = schedule.dueAt ? dueLabelParts(schedule.dueAt, schedule.allDay, now) : null
  const late = !!schedule.dueAt && isOverdue({ dueAt: schedule.dueAt, allDay: schedule.allDay, done: existing?.done ?? false }, now)
  const reminderLabel = schedule.kind === 'none' ? '' : REMINDER_CHIP[schedule.kind]
  const waveObj = waves.find((w) => w.number === wave)
  // Același text ca în bandă: eticheta valului, „Val III" fără ea, „Notițe"
  // pentru valul 0 — niciodată numărul brut.
  const waveText = (w: typeof waveObj) => !w ? `Val ${wave}` : w.number === 0 ? (w.label.trim() || 'Notițe') : waveLabel(w)
  const waveChipText = waveText(waveObj)

  /** Săgețile ←/→ se mută între jetoanele rândului (rolul `toolbar`). */
  const onRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const target = e.target as HTMLElement
    if (!target.hasAttribute('data-chip')) return
    const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(':scope [data-chip]'))
    const i = list.indexOf(target)
    if (i < 0) return
    e.preventDefault()
    list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length].focus()
  }

  /* Scadența: câmpul scris (zz/ll/aaaa + oră) cu selectoarele native la un
     click distanță. Aceeași stare și aceeași validare ca înainte — doar s-a
     mutat din bară în popoverul datei. */
  const dueField = (
    <div className={`due-inputs${dueText ? '' : ' unset'}`} title="Scadență">
      <input
        type="text"
        inputMode="numeric"
        className={`due-input due-input-date ${dueIncomplete ? 'incomplete' : ''}`}
        value={dueText}
        onChange={(e) => setDueText(maskDateInput(e.target.value))}
        placeholder={DATE_PLACEHOLDER}
        maxLength={10}
        aria-label="Data scadenței, zi/lună/an"
      />
      {/* Selectorul nativ rămâne la un click distanță — pe telefon e
          calendarul sistemului, care bate orice am construi noi. E
          ascuns vizual, nu absent: `showPicker()` are nevoie de el în
          document. */}
      <input
        ref={nativeDateRef}
        type="date"
        className="due-native"
        tabIndex={-1}
        aria-hidden="true"
        value={dueDate}
        onChange={(e) => setDueText(displayFromInputDate(e.target.value))}
      />
      <button
        type="button"
        className="due-pick"
        title="Alege din calendar"
        aria-label="Alege data din calendar"
        onClick={() => {
          const el = nativeDateRef.current
          if (!el) return
          // `showPicker` lipsește în browsere mai vechi; atunci un
          // click pe inputul nativ face aceeași treabă.
          if (typeof el.showPicker === 'function') el.showPicker()
          else el.click()
        }}
      >
        <Icon name="due" size={13} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        className={`due-input due-input-time ${timeIncomplete ? 'incomplete' : ''}`}
        value={timeText}
        onChange={(e) => setTimeText(maskTimeInput(e.target.value))}
        disabled={!dueDate}
        placeholder={TIME_PLACEHOLDER}
        maxLength={5}
        aria-label="Ora scadenței, 24 de ore"
        title={dueDate ? 'Lasă gol pentru toată ziua' : 'Alege întâi o zi'}
      />
      {/* Ceasul nativ, la un click distanță — pe telefon e cel al sistemului. */}
      <input
        ref={nativeTimeRef}
        type="time"
        className="due-native"
        tabIndex={-1}
        aria-hidden="true"
        value={dueTime}
        onChange={(e) => setTimeText(e.target.value)}
      />
      <button
        type="button"
        className="due-pick"
        title="Alege ora"
        aria-label="Alege ora din ceas"
        disabled={!dueDate}
        onClick={() => {
          const el = nativeTimeRef.current
          if (!el) return
          if (typeof el.showPicker === 'function') el.showPicker()
          else el.click()
        }}
      >
        <Icon name="reminderTime" size={13} />
      </button>
    </div>
  )

  const presets = datePresets(now)
  const datePop = (
    <>
      <h4 className="fc-h">Ziua</h4>
      <div className="fc-presets">
        {presets.map((p) => {
          const on = dueDate === toDateInput(p.date.toISOString())
          return (
            <button
              key={p.key}
              type="button"
              className={`fc-pre${on ? ' on' : ''}`}
              aria-pressed={on}
              data-autofocus={on || undefined}
              onClick={() => setDueText(toDisplayDate(p.date.toISOString()))}
            >
              {p.label}
              <small>{p.sub}</small>
            </button>
          )
        })}
      </div>
      <div className="fc-fields">
        {dueField}
        {dueText && (
          <button type="button" className="fc-link" onClick={clearDue} title="Fără dată">
            scoate
          </button>
        )}
      </div>
      {(dueIncomplete || timeIncomplete) && (
        <p className="fc-note warn">{dueIncomplete ? 'Scrie data ca zi/lună/an.' : 'Ora, de la 00:00 la 23:59.'}</p>
      )}
      {/* Mementoul apare numai când are ce să însemne. Pentru o sarcină de
          zi întreagă ar suna la miezul nopții, deci acolo tace și treaba
          o face rezumatul de dimineață. */}
      {dueDate && !dueTime && !dueIncomplete && <p className="fc-note">Toată ziua — fără memento.</p>}
      {dueDate && dueTime && (
        <>
          <h4 className="fc-h">Memento</h4>
          <div className="fc-seg" role="group" aria-label="Memento">
            {REMINDER_OPTIONS.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className={schedule.kind === kind ? 'on' : ''}
                aria-pressed={schedule.kind === kind}
                onClick={() => { setReminder(kind); setReminderTouched(true) }}
              >
                {schedule.kind === kind && <Icon name="check" size={12} />}
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {/* Repetarea nu se alege de aici: se scrie în titlu („în fiecare luni"),
          iar `parseDue` o recunoaște. Aici doar se vede și se scoate. */}
      {rruleOut && (
        <p className="fc-recur">
          <Icon name="recurring" size={13} />
          <span>Se repetă: {describeRrule(rruleOut) || 'personalizat'}</span>
          <span aria-hidden="true">·</span>
          <button type="button" className="fc-link" onClick={() => setRrule(null)}>scoate</button>
        </p>
      )}
      {!narrow && (
        <div className="fc-foot"><kbd>Esc</kbd> închide, înapoi pe jeton</div>
      )}
    </>
  )

  const waveMenu = (
    <>
      {waves.map((w) => (
        <button
          key={w.number}
          type="button"
          role="menuitem"
          className={`fc-mi${wave === w.number ? ' on' : ''}`}
          onClick={() => { if (chooseWave(w.number)) closePop(true) }}
        >
          <span className="fc-mi-r">{w.number === 0 ? '' : w.name}</span>
          <span className="fc-mi-t">{waveText(w)}</span>
          {w.number === activeWave && <span className="fc-mi-hint">activ</span>}
          {wave === w.number && <Icon name="check" size={14} />}
        </button>
      ))}
      {waveError && <p className="fc-warn">{waveError}</p>}
    </>
  )

  const themeMenu = (
    <>
      {theme && (
        <button type="button" role="menuitem" className="fc-mi" onClick={() => { setTheme(''); closePop(true) }}>
          <span className="fc-mi-t">Fără temă</span>
        </button>
      )}
      {themes.map((t) => (
        <button
          key={t.key}
          type="button"
          role="menuitem"
          className={`fc-mi${theme === t.key ? ' on' : ''}`}
          onClick={() => { setTheme(t.key); closePop(true) }}
        >
          <span className="fc-dot" style={{ background: t.color }} />
          <span className="fc-mi-t">{t.name}</span>
          {theme === t.key && <Icon name="check" size={14} />}
        </button>
      ))}
      {canWrite && !showNewTheme && (
        <button type="button" role="menuitem" className="fc-mi dim" onClick={() => setShowNewTheme(true)}>
          <Icon name="add" size={14} />
          <span className="fc-mi-t">Temă nouă</span>
        </button>
      )}
      {showNewTheme && (
        <div className="fc-new">
          <input
            className="fc-input"
            value={newThemeName}
            onChange={(e) => setNewThemeName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addTheme() } }}
            placeholder="Nume temă nouă…"
            aria-label="Nume temă nouă"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            inputMode="text"
          />
          <button type="button" className="fc-ok" onClick={() => void addTheme()} disabled={!newThemeName.trim()}>OK</button>
        </div>
      )}
    </>
  )

  const whoPop = (
    <AssigneeSearch
      assigneeId={assigneeId}
      assignees={assignees}
      members={projectMembers}
      myAssigneeId={myAssigneeId}
      myUserId={myUserId}
      onSelect={(id) => { setAssigneeId(id); closePop(true) }}
      onSelectMember={async (userId) => {
        if (!project) return
        const a = await ensureAssigneeForMember(project.id, userId)
        setAssigneeId(a.id)
        closePop(true)
      }}
      onCreateAndSelect={async (name) => {
        const a = await createAssignee(name)
        setAssigneeId(a.id)
        closePop(true)
      }}
    />
  )

  const addMenu = (
    <>
      {addItems.map((item) =>
        item === 'theme' ? (
          <button key={item} type="button" role="menuitem" className="fc-mi" onClick={() => switchPop('theme')}>
            <Icon name="tag" size={15} /><span className="fc-mi-t">Temă</span>
          </button>
        ) : item === 'assignee' ? (
          <button key={item} type="button" role="menuitem" className="fc-mi" onClick={() => switchPop('who')}>
            <Icon name="people" size={15} /><span className="fc-mi-t">Persoană</span>
          </button>
        ) : (
          <button key={item} type="button" role="menuitem" className="fc-mi" onClick={() => { setUrgent((v) => !v); closePop(true) }}>
            <Icon name="urgent" size={15} /><span className="fc-mi-t">{urgent ? 'Scoate urgent' : 'Urgent'}</span>
          </button>
        ),
      )}
    </>
  )

  const attachMenu = (
    <>
      <button type="button" role="menuitem" className="fc-mi" onClick={() => { closePop(false); cameraInputRef.current?.click() }}>
        <Icon name="camera" size={15} /><span className="fc-mi-t">Fă o poză</span>
      </button>
      <button type="button" role="menuitem" className="fc-mi" onClick={() => { closePop(false); fileInputRef.current?.click() }}>
        <Icon name="attachment" size={15} /><span className="fc-mi-t">Alege fișier</span>
      </button>
    </>
  )

  const POPS = {
    date: { role: 'dialog', label: 'Scadență', body: datePop },
    wave: { role: 'menu', label: 'Val', body: waveMenu },
    theme: { role: 'menu', label: 'Temă', body: themeMenu },
    who: { role: 'dialog', label: 'Persoană', body: whoPop },
    add: { role: 'menu', label: 'Adaugă', body: addMenu },
    attach: { role: 'menu', label: 'Atașează', body: attachMenu },
  } as const

  const chipProps = (kind: NonNullable<typeof openPop>, first = false) => ({
    type: 'button' as const,
    'data-chip': '',
    tabIndex: first ? 0 : -1,
    'aria-haspopup': (POPS[kind].role === 'menu' ? 'menu' : 'dialog') as 'menu' | 'dialog',
    'aria-expanded': openPop === kind,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => togglePop(kind, e.currentTarget),
  })
  const isOpen = (kind: NonNullable<typeof openPop>) => (openPop === kind ? ' open' : '')
  // Un jeton deschis din „+" (temă, persoană) n-are jeton propriu încă: „+"
  // rămâne marcat cât stă deschis ce a pornit din el.
  const plusOpen = openPop === 'add' || ((openPop === 'theme' || openPop === 'who') && popAnchor.current?.dataset.plus === '1')

  const chipRow = (
    <div
      className="fc-row"
      role="toolbar"
      aria-label="Proprietățile tichetului"
      ref={chipRowRef}
      onKeyDown={onRowKeyDown}
    >
      {chips.map((kind, idx) => {
        const first = idx === 0
        if (kind === 'due') {
          const label = dueParts
            ? `Scadență: ${dueParts.day}${dueParts.time ? ' ' + dueParts.time : ''}${late ? ', restantă' : ''}${reminderLabel ? `, memento ${reminderLabel}` : ''}`
            : dueIncomplete ? `Scadență incompletă: ${dueText}` : 'Pune o dată'
          return (
            <button
              key={kind}
              {...chipProps('date', first)}
              disabled={!canWrite}
              className={`fc-chip due${dueParts ? '' : dueIncomplete ? ' warn' : ' ghost'}${late ? ' late' : ''}${titleDate.active ? ' pending' : ''}${isOpen('date')}`}
              aria-label={label}
              title={titleDate.active ? `${label} · recunoscută din titlu` : label}
            >
              <Icon name="due" size={14} />
              {dueParts ? (
                <>
                  {dueParts.day}
                  {dueParts.time && <span className="fc-t">{dueParts.time}</span>}
                </>
              ) : dueIncomplete ? (
                <span className="fc-t">{dueText}</span>
              ) : 'Dată'}
            </button>
          )
        }
        if (kind === 'reminder') {
          return (
            <button key={kind} {...chipProps('date', first)} disabled={!canWrite} className="fc-chip" aria-label={`Memento ${reminderLabel}`} title={`Memento ${reminderLabel}`}>
              <Icon name="bell" size={14} />
              {reminderLabel}
            </button>
          )
        }
        if (kind === 'recur') {
          const label = recurChipLabel(rruleOut)
          return (
            <button key={kind} {...chipProps('date', first)} disabled={!canWrite} className="fc-chip" aria-label={`Se repetă: ${label}`} title={`Se repetă: ${label}`}>
              <Icon name="recurring" size={14} />
              {label}
            </button>
          )
        }
        if (kind === 'wave') {
          return (
            <button
              key={kind}
              {...chipProps('wave', first)}
              disabled={!canWrite}
              className={`fc-chip${isOpen('wave')}`}
              aria-label={`Val: ${waveObj?.name ?? wave}`}
              title={waveObj?.name}
            >
              <Icon name="wave" size={14} />
              {waveChipText}
            </button>
          )
        }
        if (kind === 'theme') {
          return (
            <button
              key={kind}
              {...chipProps('theme', first)}
              disabled={!canWrite}
              className={`fc-chip${isOpen('theme') && !plusOpen ? ' open' : ''}`}
              aria-label={`Temă: ${themeObj?.name ?? theme}`}
              title={`Temă: ${themeObj?.name ?? theme}`}
            >
              <span className="fc-dot" style={{ background: themeObj?.color ?? 'var(--txt-faint)' }} />
              <span className="fc-chip-t">{themeObj?.name ?? theme}</span>
            </button>
          )
        }
        if (kind === 'assignee' && assigneeId) {
          const name = assigneeName ?? assigneeShort[assigneeId] ?? '?'
          return (
            <button
              key={kind}
              {...chipProps('who', first)}
              disabled={!canWrite}
              className={`fc-chip who${isOpen('who') && !plusOpen ? ' open' : ''}`}
              aria-label={`Pasat lui ${name}`}
              title={`Pasat lui ${name}`}
            >
              <span className="fc-av">{assigneeShort[assigneeId] ?? name.slice(0, 2).toUpperCase()}</span>
              <span className="fc-chip-t">{name}</span>
            </button>
          )
        }
        if (kind === 'urgent') {
          return (
            <button
              key={kind}
              type="button"
              data-chip=""
              tabIndex={first ? 0 : -1}
              disabled={!canWrite}
              className="fc-chip urgent"
              aria-pressed
              aria-label="Urgent — apasă ca să scoți"
              title="Urgent — apasă ca să scoți"
              onClick={() => setUrgent(false)}
            >
              <Icon name="urgent" size={14} />
              Urgent
            </button>
          )
        }
        return null
      })}
      {/* Data venită din titlu, cu cele două ieșiri: curăță textul rămas în
          titlu, sau refuză de tot. Fără ele, recunoașterea ar fi o ghicire pe
          care n-o poți contrazice. */}
      {titleDate.active && (
        <>
          <button type="button" data-chip="" tabIndex={-1} className="fc-chip ghost" title="Scoate textul datei din titlu" onClick={cleanTitleFromDate}>
            <Icon name="fromTitle" size={14} />
            Curăță titlul
          </button>
          <button type="button" data-chip="" tabIndex={-1} className="fc-chip icon" title="Nu e o dată — lasă titlul în pace" aria-label="Refuză data din titlu" onClick={refuseTitleDate}>
            <Icon name="close" size={14} />
          </button>
        </>
      )}
      {/* Titlul era numai dată: salvarea e stinsă, deci spune de ce. */}
      {bareTitle && <span className="fc-hint warn">și ce ai de făcut?</span>}
      {canWrite && (
        // Agrafa și „+" trec pe rândul următor numai împreună: un „+" singur
        // pe un rând ar fi exact zgomotul pe care rândul îl elimină.
        <span className="fc-tail">
          <button
            type="button"
            data-chip=""
            tabIndex={-1}
            className={`fc-chip icon${isOpen('attach')}`}
            aria-label="Atașează fișier"
            title={coarse ? 'Fă o poză sau alege un fișier' : 'Atașează fișier — sau lipește (Ctrl+V) ori trage peste descriere'}
            aria-haspopup={coarse ? 'menu' : undefined}
            aria-expanded={coarse ? openPop === 'attach' : undefined}
            onClick={(e) => pickAttach(e.currentTarget)}
          >
            <Icon name="attachment" size={16} />
          </button>
          <button
            type="button"
            data-chip=""
            data-plus="1"
            tabIndex={-1}
            className={`fc-chip icon${plusOpen ? ' open' : ''}`}
            aria-label="Adaugă proprietate"
            title="Temă, persoană, urgent"
            aria-haspopup="menu"
            aria-expanded={openPop === 'add'}
            onClick={(e) => togglePop('add', e.currentTarget)}
          >
            <Icon name="add" size={16} />
          </button>
          {/* `capture` exclude `multiple`: camera pornește pentru un singur cadru. */}
          <input ref={cameraInputRef} className="att-pick-input" type="file" accept="image/*" capture="environment" onChange={onFilesChosen} tabIndex={-1} aria-hidden="true" />
          <input ref={fileInputRef} className="att-pick-input" type="file" multiple onChange={onFilesChosen} tabIndex={-1} aria-hidden="true" />
        </span>
      )}
      {openPop && (
        <ChipPop
          key={openPop}
          anchor={popAnchor.current}
          rowRef={chipRowRef}
          sheet={narrow}
          role={POPS[openPop].role}
          label={POPS[openPop].label}
          className={`fc-pop-${openPop}`}
          onClose={closePop}
        >
          {POPS[openPop].body}
        </ChipPop>
      )}
    </div>
  )

  return (
    <>
      {/* HEADER */}
      <div className={`sh-header${isEdit ? '' : ' is-new'}`}>
        {isEdit && existing && <span className="sh-id">{displayIssueId(existing.id)}</span>}
        <button className="sh-close" onClick={closeSheet} aria-label="Închide"><Icon name="close" size={16} /></button>
        {docked && isEdit && (
          <button
            tabIndex={-1}
            className="sh-copy"
            onClick={popOutIssue}
            aria-label="Deschide mare"
            title="Deschide mare, peste listă"
          >
            <Icon name="popOut" size={15} />
          </button>
        )}
        {isEdit && (
          <button
            tabIndex={-1}
            className={`sh-copy${copyState === 'ok' ? ' copied' : ''}${copyState === 'fail' ? ' copy-failed' : ''}`}
            onClick={() => void copyLink(existing?.id)}
            aria-label={copyState === 'fail' ? 'Copierea a eșuat' : 'Copiază link'}
            title={existing && isTempIssueId(existing.id)
              ? 'Linkul apare după sincronizare'
              : copyState === 'fail'
              ? 'Nu am putut copia link-ul — copiază-l din bara de adrese'
              : 'Copiază link către ticket (y)'}
          >
            {copyState === 'ok' ? (
              <Icon name="check" size={15} />
            ) : copyState === 'fail' ? (
              <Icon name="close" size={15} />
            ) : (
              <Icon name="copy" size={15} />
            )}
          </button>
        )}
        {isEdit && canWrite && (
          <button
            tabIndex={-1}
            className={`sh-delete${confirmDel ? ' confirming' : ''}`}
            onClick={() => confirmDel ? void remove() : setConfirmDel(true)}
            onBlur={() => setTimeout(() => setConfirmDel(false), 200)}
            title={confirmDel ? 'Apasă din nou ca să confirmi ștergerea' : 'Șterge tichetul'}
          >
            {confirmDel ? (
              <Icon name="danger" size={15} />
            ) : (
              <Icon name="delete" size={14} />
            )}
          </button>
        )}
        {/* Bifa în culoarea proiectului, înaintea titlului („Senin"). Bifează
            direct, ca în listă — nu e un câmp al formularului. */}
        <span className="sh-break" aria-hidden="true" />
        {isEdit && existing && (
          <button
            type="button"
            tabIndex={-1}
            className="sh-check"
            role="checkbox"
            aria-checked={existing.done}
            aria-label={existing.done ? 'Marchează nefăcut' : 'Marchează gata'}
            disabled={!canWrite}
            style={project?.accent ? ({ ['--pc' as string]: project.accent }) : undefined}
            onClick={() => void toggleDone(existing.id)}
          >
            <span className={`ck${existing.done ? ' on' : ''}${existing.urgent && !existing.done ? ' urg' : ''}`}>
              {existing.done && <Icon name="check" size={13} />}
            </span>
          </button>
        )}
        {/* Aceleași două straturi ca la adăugarea rapidă: oglinda desenează
            evidențierea sub un input transparent. Metricile TREBUIE să fie
            identice — orice diferență de font decalează marcajul. */}
        <span
          className={`sh-title-wrap ${titleDate.onDate ? 'on-date' : ''}`}
          title={titleDate.onDate ? 'Nu e o dată — atinge ca să rămână text în titlu' : undefined}
        >
          <span className="sh-title-mirror" ref={titleDate.mirrorRef} aria-hidden="true">
            {titleDate.pieces.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
          </span>
          <textarea
            ref={titleInputRef}
            className="sh-title-input"
            rows={1}
            value={title}
            onChange={(e) => {
              setTitleTyped(true)
              setTitle(e.target.value)
            }}
            readOnly={!canWrite}
            placeholder={isEdit ? existing!.id : 'Titlu tichet…'}
            // Două motive pentru care nu se ia focusul singur:
            // În panou — focusul ar sări în titlu la fiecare rând atins din
            // listă, iar tastele de navigare ar ajunge în câmp în loc de listă.
            // Pe telefon, la un tichet EXISTENT — acolo deschizi cardul ca
            // să-l citești, iar tastatura ar acoperi jumătate din el ca să
            // scrie ceva ce nu voiai să scrii. La un tichet nou rămâne:
            // singurul motiv să-l deschizi e să scrii titlul.
            autoFocus={!docked && (!narrow || !isEdit)}
            autoComplete="off"
            autoCorrect="off"
            inputMode="text"
            // Enter SALVEAZĂ, nu rupe rândul: un titlu nu are rânduri, iar
            // `<textarea>` e aici pentru afișare, nu pentru text pe mai multe
            // linii. Ctrl+Enter (salvează și închide) rămâne la handlerul de
            // fereastră, deci se lasă să treacă.
            enterKeyHint="done"
            spellCheck={false}
            // O atingere PE fragmentul recunoscut înseamnă „nu e o dată".
            {...titleDate.inputProps}
            // Peste plafonul de înălțime din CSS câmpul se derulează, iar
            // oglinda trebuie să meargă cu el — altfel marcajul de dată rămâne
            // pe textul de deasupra.
            onScroll={(e) => {
              if (titleDate.mirrorRef.current) titleDate.mirrorRef.current.scrollTop = e.currentTarget.scrollTop
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault()
                descRef.current?.focus()
              } else if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault()
                if (canWrite && saveTitle && !saving && waves.length > 0) void save({ close: false })
              }
            }}
          />
        </span>
        {chipRow}
        {canWrite && (
          <button
            tabIndex={-1}
            className={`sh-save${isDirty ? ' dirty' : ''}${nudging ? ' nudge' : ''}`}
            onClick={() => void save({ close: false })}
            disabled={!saveTitle || saving || waves.length === 0}
            title={saving ? 'Se salvează…' : 'Salvează (Ctrl+S) · Ctrl+Enter salvează și închide'}
          >
            <Icon name="arrowUp" size={16} />
          </button>
        )}
      </div>

      {/* BODY */}
      <div className="sheet-scroll if-body">

        {/* MAIN FORM — 2 cols */}
        <div className="form-cols">

          {/* LEFT — descriere, fără etichetă: textul de sub titlu ESTE
              descrierea. Fișierele stau deasupra ei, într-o bară de o linie
              care apare numai când există fișiere (agrafa e în rândul de
              jetoane). Coloana întreagă e zona de drop — vezi `dropZone` în
              Attachments; cât se trage un fișier, bara reapare. */}
          <div className={`form-col form-col-desc ${dropActive ? 'att-dropping' : ''}`} ref={descColRef}>
            {project && (
              <Attachments
                issueId={existing?.id}
                projectId={project.id}
                title={existing?.title ?? title}
                readOnly={!canWrite}
                dropZone={descColRef}
                onDropActive={setDropActive}
                hideEmpty
                addRef={addFilesRef}
              />
            )}
            {/* Formularul are butonul Salvează: bifa schimbă doar `desc` local
                (formularul devine „murdar"), salvarea rămâne explicită. */}
            <DescField
              ref={descRef}
              className="desc-fixed"
              value={desc}
              readOnly={!canWrite}
              placeholder="Cerințe, notițe, context…"
              ariaLabel="Descrierea tichetului"
              prefixes={prefixes}
              onRef={openRef}
              onChange={setDesc}
              onCommit={setDesc}
            />
          </div>

          {/* RIGHT — deps + fir */}
          <div className="form-col form-col-right">

            {/* DEPS ZONE */}
            <div className="deps-zone">
              <div className="deps-bar">
                <button
                  className={`dep-tab-btn ${depTab === 'necesita' ? 'on' : ''}`}
                  onClick={() => { setDepTab('necesita'); setDepSearchQ(''); setDepDropdownOpen(false) }}
                >
                  <Icon name="back" size={13} /> Necesită{necCount > 0 && <span className="dep-tab-count">{necCount}</span>}
                </button>
                <button
                  className={`dep-tab-btn ${depTab === 'permite' ? 'on' : ''}`}
                  onClick={() => { setDepTab('permite'); setDepSearchQ(''); setDepDropdownOpen(false) }}
                >
                  <Icon name="forward" size={13} /> Permite{perCount > 0 && <span className="dep-tab-count">{perCount}</span>}
                </button>
                <button
                  className={`dep-tab-btn ${depTab === 'obstacole' ? 'on' : ''}`}
                  onClick={() => { setDepTab('obstacole'); setDepSearchQ(''); setDepDropdownOpen(false) }}
                >
                  <Icon name="obstacle" size={13} /> Obstacole
                  {obstIds.length > 0 && <span className="dep-tab-count">{obstIds.length}</span>}
                </button>
                <div className="dep-search-wrap-rel">
                  <div className="dep-search-field">
                    <Icon name="search" size={13} className="dep-search-icon" />
                    <input
                      className="dep-search-input-sm"
                      value={depSearchQ}
                      onChange={(e) => { setDepSearchQ(e.target.value); setDepSearchHl(0); setDepDropdownOpen(true) }}
                      onKeyDown={handleDepKeyDown}
                      onFocus={() => { setDepSearchHl(0); if (depSearchQ.trim()) setDepDropdownOpen(true) }}
                      onBlur={() => setTimeout(() => setDepDropdownOpen(false), 150)}
                      placeholder={depTab === 'obstacole' ? 'Caută sau creează obstacol…' : 'Caută sau creează tichet…'}
                      autoComplete="off"
                      autoCorrect="off"
                    />
                  </div>

                  {/* Floating dropdown — anchored under the search field */}
                  {depDropdownOpen && depSearchQ.trim() && (
                    <div className="dep-dropdown">
                      {depFiltered.map((item, idx) => (
                        <button
                          key={item.id}
                          className={`dep-dd-item${idx === depSearchHl ? ' hl' : ''}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addCurrentDep(item.id)}
                        >
                          <span className="dep-dd-ic">+</span>
                          <span className="dep-dd-title">{item.title}</span>
                          <span className="dep-dd-id">{displayIssueId(item.id)}</span>
                        </button>
                      ))}
                      {depFiltered.length === 0 && !depShowCreate && (
                        <div className="dep-dd-empty">{depTab === 'obstacole' ? 'Niciun obstacol găsit.' : 'Niciun tichet găsit.'}</div>
                      )}
                      {depShowCreate && (
                        <button
                          className={`dep-dd-create${depSearchHl === depFiltered.length ? ' hl' : ''}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => createCurrentDraft(depSearchQ.trim())}
                        >
                          <span className="dep-dd-plus">+</span>
                          Creează <strong>«{depSearchQ.trim()}»</strong> și leagă
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Dep cards grid */}
              {totalCurrentCount > 0 ? (
                <div
                  className="dep-cards-grid"
                  style={{ '--dep-cols': depCols(totalCurrentCount) } as React.CSSProperties}
                >
                  {currentRealIds.map((id) => {
                    if (depTab === 'obstacole') {
                      const obstacle = obstacles.find((o) => o.id === id)
                      if (!obstacle) return null
                      return (
                        <div key={id} className="dep-card">
                          {/* Un obstacol scris chiar acum e gol — titlu și nimic altceva — deci
                              corpul jetonului deschide direct foaia, ca „owner"/„stare" să fie o atingere. */}
                          <button className="dep-card-body" onClick={() => pushSheet({ kind: 'obstacle-form', obstacleId: id })}>
                            <span className="dep-card-id">{displayIssueId(id)}</span>
                            <span className="dep-card-title">{obstacle.title}</span>
                          </button>
                          <button className="dep-card-x" onClick={() => removeCurrentDep(id)} aria-label="Scoate obstacolul"><Icon name="close" size={12} /></button>
                        </div>
                      )
                    }
                    const issue = byId[id]
                    if (!issue) return null
                    return (
                      <div key={id} className="dep-card">
                        <button className="dep-card-body" onClick={() => pushSheet({ kind: 'issue', issueId: id })}>
                          <span className="dep-card-id">{displayIssueId(id)}</span>
                          <span className="dep-card-title">{issue.title}</span>
                        </button>
                        <button className="dep-card-x" onClick={() => removeCurrentDep(id)} aria-label="Scoate dependența"><Icon name="close" size={12} /></button>
                      </div>
                    )
                  })}
                  {currentDraftItems.map((d) => (
                    <div key={d.tempId} className="dep-card dep-card--draft">
                      <div className="dep-card-body">
                        <span className="dep-card-id">nou</span>
                        <span className="dep-card-title">{d.title}</span>
                      </div>
                      <button className="dep-card-x" onClick={() => removeCurrentDraft(d)} aria-label={depTab === 'obstacole' ? 'Scoate obstacolul' : 'Scoate dependența'}><Icon name="close" size={12} /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dep-empty-row" />
              )}

            </div>

            {/* FIR — comentarii + pase. Nu se randează pe un tichet nesalvat:
                `existing` e undefined până la primul save. */}
            {isEdit && existing && (
              <Thread
                issueId={existing.id}
                projectId={project.id}
                onDirtyChange={setCommentDraftDirty}
                onHandoff={setAssigneeId}
                reveal={revealThread}
              />
            )}


          </div>
        </div>

        {cycleMsg && (
          <div className="banner" style={{ marginTop: 12 }}>⚠ Asta ar crea un ciclu: {cycleMsg}</div>
        )}
        {waveError && (
          <div className="banner" style={{ marginTop: 12 }}>⚠ {waveError}</div>
        )}
        {obstacleError && (
          <div className="banner" style={{ marginTop: 12 }}>⚠ {obstacleError}</div>
        )}

        {/* Proveniența stă la COADĂ, nu în capul foii: cine și când a creat
            tichetul nu se citește decât o dată, iar sus fura rândul de la
            urgent și scadență — singurele două lucruri pentru care deschizi
            formularul de pe telefon. Doar la editare: un tichet nesalvat n-are
            creator. Aceeași clasă `.origin` din IssueSheet.tsx, ca să nu apară
            un al doilea set de stiluri pentru același fapt; `.origin-foot` doar
            o coboară și o stinge. Rezolvarea numelui trece prin
            `assignees.userId`, la fel ca autorul unui comentariu din
            Thread.tsx. */}
        {isEdit && existing && (
          <div className="origin origin-foot">
            {existing.createdBy ? (() => {
              const creator = assignees.find((a) => a.userId === existing.createdBy)
              const creatorName = creator?.name ?? 'cineva'
              return (
                <>
                  <span className="origin-avatar">{creatorName.slice(0, 2).toUpperCase()}</span>
                  <span>creat de {creatorName}</span>
                  <span className="dot">·</span>
                </>
              )
            })() : (
              /* Fără creator (tichet scris cu cheia de serviciu — vezi
                 ticket-kit) rămâne pe rând doar data; numită, ca să nu fie
                 patru cifre fără subiect. */
              <span>creat</span>
            )}
            <time className="mono" title={new Date(existing.createdAt).toLocaleString('ro-RO')}>
              {toShortDate(existing.createdAt)}
            </time>
          </div>
        )}

      </div>

      {confirmClose && (
        <div className="ccm-overlay" role="dialog" aria-modal="true">
          <div className="ccm-box">
            <p className="ccm-msg">Ai modificări nesalvate.</p>
            <div
              className="ccm-btns"
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
                  const idx = btns.indexOf(document.activeElement as HTMLButtonElement)
                  if (idx !== -1) btns[(idx + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length].focus()
                }
              }}
            >
              <button className="ccm-stay" autoFocus onClick={() => setConfirmClose(false)}>
                Rămâi pe pagină
              </button>
              <button className="ccm-exit" onClick={() => { setCloseGuard(null); closeSheet() }}>
                Ieși din pagină
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
