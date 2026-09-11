import { useRef, useState, useEffect, useCallback, forwardRef } from 'react'
import { detectCycle, requiredDepWave } from '../lib/engine'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useCanWrite, useTitleDate } from '../hooks'
import { ticketUrl } from '../lib/deepLink'
import { stripSpans } from '../lib/parseDue'
import { fold } from '../lib/text'
import { fillFromTitle, titleToSave, type FillMemo } from '../lib/titleDueFill'
import {
  DATE_PLACEHOLDER, NO_SCHEDULE, TIME_PLACEHOLDER, defaultReminder, displayFromInputDate,
  fromDisplayDate, fromInputs, fromTimeText, hasTime, maskDateInput, maskTimeInput, reminderAt,
  reminderKindOf, toDisplayDate, toShortDate, toTimeInput, type ReminderKind,
} from '../lib/schedule'
import { Attachments } from './Attachments'
import type { Issue, ScenarioKind, TestScenario } from '../lib/types'
import { Icon, type IconName } from './Icon'

const PALETTE = ['#0284C7', '#059669', '#D97706', '#EA580C', '#E11D48', '#7C3AED', '#06B6D4']

const BADGE_CYCLE: { kind: ScenarioKind; icon: IconName }[] = [
  { kind: 'pass',    icon: 'check' },
  { kind: 'fail',    icon: 'close' },
  { kind: 'neutral', icon: 'notDone' },
]

export interface MetaRecapInput {
  themeName: string | null
  waveName: string
  assigneeName: string | null
  urgent: boolean
  dueLabel: string | null
}

/**
 * Rezumatul pe un rând al meta colapsate pe mobil — doar ce e deja setat.
 * Valul e mereu prezent (fiecare tichet are unul); restul apar condiționat.
 */
export function buildMetaRecap(input: MetaRecapInput): string {
  return [input.themeName, input.waveName, input.assigneeName, input.urgent ? '⚡ Urgent' : null, input.dueLabel]
    .filter((part): part is string => !!part)
    .join(' · ')
}

/**
 * Formularul e murdar de obstacole când setul de id-uri reale diferă de ce e
 * salvat — ordinea nu contează. Extrasă pură ca să fie testabilă fără randare,
 * la fel ca `buildMetaRecap`.
 */
export function obstaclesDirty(current: string[], saved: string[]): boolean {
  return current.slice().sort().join(',') !== saved.slice().sort().join(',')
}

type DraftIssue = { tempId: string; title: string }
let draftCounter = 0
const newTempId = () => `__draft_${++draftCounter}__`

function depCols(n: number): number {
  if (n <= 2) return 1
  if (n <= 4) return 2
  return 3
}

const AutoTextarea = forwardRef<HTMLTextAreaElement, {
  value: string; onChange: (v: string) => void; placeholder?: string; minH?: number; maxH?: number
}>(function AutoTextarea({ value, onChange, placeholder, minH = 80, maxH }, forwardedRef) {
  const innerRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = innerRef.current; if (!el) return
    el.style.height = 'auto'
    const natural = Math.max(minH, el.scrollHeight)
    const capped = maxH ? Math.min(natural, maxH) : natural
    el.style.height = capped + 'px'
    el.style.overflow = (maxH && natural >= maxH) ? 'auto' : 'hidden'
  }, [value, minH, maxH])
  return (
    <textarea
      ref={(el) => {
        (innerRef as { current: HTMLTextAreaElement | null }).current = el
        if (typeof forwardedRef === 'function') forwardedRef(el)
        else if (forwardedRef) (forwardedRef as { current: HTMLTextAreaElement | null }).current = el
      }}
      value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} style={{ minHeight: minH, resize: 'none' }} />
  )
})

function AssigneeSearch({ assigneeId, assignees, myAssigneeId, onSelect, onSetMe, onCreateAndSelect }: {
  assigneeId: string | null
  assignees: import('../lib/types').Assignee[]
  myAssigneeId: string | null
  onSelect(id: string | null): void
  onSetMe(id: string): void
  onCreateAndSelect(name: string): Promise<void>
}) {
  const [q, setQ] = useState('')
  const [hlIdx, setHlIdx] = useState(0)
  const [creating, setCreating] = useState(false)

  const sorted = [...assignees].sort((a, b) => {
    if (a.id === myAssigneeId) return -1
    if (b.id === myAssigneeId) return 1
    return a.name.localeCompare(b.name)
  })

  const filtered = q.trim() ? sorted.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())) : sorted
  const hasExact = assignees.some((a) => a.name.toLowerCase() === q.toLowerCase().trim())
  const showCreate = q.trim() && !hasExact
  const optionCount = filtered.length + (showCreate ? 1 : 0)

  const selected = assigneeId ? assignees.find((a) => a.id === assigneeId) : null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!optionCount) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx((p) => Math.min(p + 1, optionCount - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHlIdx((p) => Math.max(p - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (hlIdx < filtered.length) { onSelect(filtered[hlIdx].id); setQ(''); setHlIdx(0) }
      else if (showCreate) handleCreate()
    } else if (e.key === 'Escape') { setQ(''); setHlIdx(0) }
  }

  const handleCreate = async () => {
    const name = q.trim(); if (!name || creating) return
    setCreating(true)
    try { await onCreateAndSelect(name); setQ(''); setHlIdx(0) } finally { setCreating(false) }
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
        <input value={q} onChange={(e) => { setQ(e.target.value); setHlIdx(0) }}
          onKeyDown={handleKeyDown}
          placeholder="Search or add person…"
          className="dep-search-input" autoComplete="off" autoCorrect="off" inputMode="text" />
      </div>
      {q.trim() && (
        <div className="dep-results">
          {filtered.map((a, idx) => (
            <button key={a.id} className={`dep-result-row ${a.id === assigneeId ? 'on' : ''} ${idx === hlIdx ? 'hl' : ''}`}
              onClick={() => { onSelect(a.id); setQ(''); setHlIdx(0) }}>
              <span className={`ic ${a.id === assigneeId ? 'ok' : 'ext'}`}><Icon name={a.id === assigneeId ? 'check' : 'add'} size={14} /></span>
              <span className="dep-result-title">{a.name}{a.id === myAssigneeId ? ' (me)' : ''}</span>
              {a.id !== myAssigneeId && (
                <button style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.5, padding: '0 4px' }}
                  onClick={(e) => { e.stopPropagation(); onSetMe(a.id) }} title="This is me"
                  aria-label="Setează ca fiind eu">
                  <Icon name="star" size={13} />
                </button>
              )}
            </button>
          ))}
          {filtered.length === 0 && !showCreate && <p className="dep-no-results">No one found.</p>}
          {showCreate && (
            <button className={`dep-create-btn ${hlIdx === filtered.length ? 'hl' : ''}`}
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
export function IssueForm({ issueId, docked = false }: { issueId?: string; docked?: boolean }) {
  const { project, waves, themes, issues, byId, activeWave, createIssue, updateIssue, deleteIssue, createTheme, assignees, myAssigneeId, setMyAssigneeId, createAssignee, obstacles, obstaclesOf, createObstacle, setIssueObstacles } = useHorizontal()
  const { closeSheet, setCloseGuard, pushSheet, openEditIssue, setDockedDirty, saveNudge } = useUI()
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

  const defaultAssigneeId = !isEdit && project?.type === 'personal' ? (myAssigneeId ?? null) : null

  const [title, setTitle] = useState(existing?.title ?? '')
  const [desc, setDesc] = useState(existing?.desc ?? '')
  const [theme, setTheme] = useState(existing?.theme ?? '')
  const [wave, setWave] = useState(existing?.wave ?? activeWave)
  const [assigneeId, setAssigneeId] = useState<string | null>(existing?.assigneeId ?? defaultAssigneeId)
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

  const [selectors, setSelectors] = useState<string[]>(existing?.selectors ?? [])
  const [scenarios, setScenarios] = useState<TestScenario[]>(existing?.scenarios ?? [])
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [urgent, setUrgent] = useState(existing?.urgent ?? false)
  // Scadența trăiește în formular ca cele două valori pe care le scrie userul,
  // nu ca ISO: inputurile native vorbesc local, iar conversia stă în
  // `lib/schedule`. Ora goală = toată ziua, deci `allDay` nu are stare proprie.
  // Textul scris de utilizator, în `zz/ll/aaaa`. Valoarea canonică se derivă din
  // el — o singură stare, deci textul din câmp și data salvată nu pot diverge.
  const [dueText, setDueText] = useState(existing?.dueAt ? toDisplayDate(existing.dueAt) : '')
  const dueDate = fromDisplayDate(dueText) ?? ''
  // Text scris pe jumătate: nu e o eroare, doar nu e încă o dată. Semnalul e
  // discret, ca să nu certe pe cineva care tocmai a apăsat prima cifră.
  const dueIncomplete = dueText.trim() !== '' && dueDate === ''
  const nativeDateRef = useRef<HTMLInputElement>(null)
  // Ca la dată: textul e starea, valoarea validată se derivă. `dueTime` rămâne
  // numele valorii validate, ca `fromInputs` să primească exact ce primea.
  const [timeText, setTimeText] = useState(
    existing?.dueAt && !existing.allDay ? toTimeInput(existing.dueAt) : '',
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
  const schedule = (() => {
    const { dueAt, allDay } = fromInputs(dueDate, dueTime)
    const kind = reminderTouched ? reminder : defaultReminder(allDay)
    return { dueAt, allDay, remindAt: reminderAt(dueAt, kind), kind }
  })()

  // Pe mobil, blocul de meta pornește colapsat într-un rezumat pe un rând —
  // altfel Temă/Val/Assigned/Prioritate/Scadență stivuite împing Descrierea
  // sub fold. Pe desktop CSS-ul ignoră starea asta și ține blocul mereu deschis.
  const [metaOpen, setMetaOpen] = useState(false)

  const [showNewTheme, setShowNewTheme] = useState(false)
  const [newThemeName, setNewThemeName] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [cycleMsg, setCycleMsg] = useState<string | null>(null)
  const [waveError, setWaveError] = useState<string | null>(null)
  const [obstacleError, setObstacleError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [depTab, setDepTab] = useState<'necesita' | 'permite' | 'obstacole'>('necesita')
  const [showAssigneeInline, setShowAssigneeInline] = useState(false)

  const [depSearchQ, setDepSearchQ] = useState('')
  const [depSearchHl, setDepSearchHl] = useState(0)
  const [depDropdownOpen, setDepDropdownOpen] = useState(false)

  // QA accordion — open if has content, closed if empty
  const initialQaCount = (existing?.selectors?.filter(Boolean).length ?? 0) + (existing?.scenarios?.length ?? 0)
  const [qaOpen, setQaOpen] = useState(initialQaCount > 0)

  const titleInputRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  /** Coloana de descriere, ca zonă de drop pentru fișiere. Bara de atașamente
   *  e prea subțire ca să fie o țintă nimerită cu mouse-ul. */
  const descColRef = useRef<HTMLDivElement>(null)
  const [dropActive, setDropActive] = useState(false)
  const notesSectionRef = useRef<HTMLDivElement>(null)
  const [notesMaxH, setNotesMaxH] = useState(200)

  useEffect(() => {
    const section = notesSectionRef.current
    if (!section) return
    const compute = () => {
      const sheet = section.closest('.sheet')
      if (!sheet) return
      const sheetBottom = sheet.getBoundingClientRect().bottom - 24
      const labelEl = section.querySelector('.notes-label') as HTMLElement | null
      const textareaTop = section.getBoundingClientRect().top + (labelEl ? labelEl.offsetHeight + 10 : 36)
      setNotesMaxH(Math.max(80, sheetBottom - textareaTop))
    }
    compute()
    const sheet = section.closest('.sheet')
    const ro = new ResizeObserver(compute)
    if (sheet) ro.observe(sheet)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (isEdit && titleInputRef.current) {
      titleInputRef.current.setSelectionRange(0, 0)
      titleInputRef.current.scrollLeft = 0
    }
  }, [])

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

  const isDirty = isEdit
    ? title !== (existing?.title ?? '') ||
      desc !== (existing?.desc ?? '') ||
      theme !== (existing?.theme ?? '') ||
      wave !== (existing?.wave ?? activeWave) ||
      assigneeId !== (existing?.assigneeId ?? null) ||
      deps.filter((d) => !d.startsWith('__draft_')).slice().sort().join(',') !== (existing?.deps ?? []).slice().sort().join(',') ||
      draftDeps.filter((d) => deps.includes(d.tempId)).length > 0 ||
      draftBlocks.filter((d) => blocks.includes(d.tempId)).length > 0 ||
      blocks.filter((b) => !b.startsWith('__draft_')).slice().sort().join(',') !== (existing ? issues.filter((i) => i.deps?.includes(existing.id)).map((i) => i.id) : []).slice().sort().join(',') ||
      obstaclesDirty(
        obstIds.filter((o) => !o.startsWith('__obst_draft_')),
        existing ? obstaclesOf(existing.id).map((o) => o.id) : [],
      ) ||
      draftObstacles.filter((d) => obstIds.includes(d.tempId)).length > 0 ||
      JSON.stringify(selectors) !== JSON.stringify(existing?.selectors ?? []) ||
      JSON.stringify(scenarios) !== JSON.stringify(existing?.scenarios ?? []) ||
      notes !== (existing?.notes ?? '') ||
      urgent !== (existing?.urgent ?? false) ||
      schedule.dueAt !== (existing?.dueAt ?? null) ||
      schedule.remindAt !== (existing?.remindAt ?? null)
    : title.trim() !== '' || desc.trim() !== '' || deps.length > 0 || blocks.length > 0 || obstIds.length > 0 ||
      selectors.length > 0 || scenarios.length > 0 || notes.trim() !== '' || urgent ||
      schedule.dueAt !== null

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

  const qaCount = selectors.filter(Boolean).length + scenarios.length

  const metaRecap = buildMetaRecap({
    themeName: theme ? (themes.find((t) => t.key === theme)?.name ?? null) : null,
    waveName: waves.find((w) => w.number === wave)?.name ?? `Val ${wave}`,
    assigneeName: assigneeId ? (assignees.find((a) => a.id === assigneeId)?.name ?? null) : null,
    urgent,
    dueLabel: schedule.dueAt
      ? `${toShortDate(schedule.dueAt)}${hasTime({ dueAt: schedule.dueAt, allDay: schedule.allDay }) ? ` ${toTimeInput(schedule.dueAt)}` : ''}`
      : null,
  })

  const addTheme = async () => {
    if (!canWrite) return
    const name = newThemeName.trim(); if (!name) return
    const created = await createTheme(name, PALETTE[themes.length % PALETTE.length])
    if (created) setTheme(created.key)
    setNewThemeName(''); setShowNewTheme(false)
  }

  const addSelector = () => setSelectors((p) => [...p, ''])
  const updateSelector = (i: number, val: string) => setSelectors((p) => p.map((s, idx) => idx === i ? val : s))
  const removeSelector = (i: number) => setSelectors((p) => p.filter((_, idx) => idx !== i))

  const addScenario = () => setScenarios((p) => [...p, { text: '', kind: 'neutral' }])
  const updateScenarioText = (i: number, text: string) => setScenarios((p) => p.map((s, idx) => idx === i ? { ...s, text } : s))
  const cycleScenarioBadge = (i: number) => setScenarios((p) => p.map((s, idx) => {
    if (idx !== i) return s
    const cur = BADGE_CYCLE.findIndex((b) => b.kind === s.kind)
    return { ...s, kind: BADGE_CYCLE[(cur + 1) % BADGE_CYCLE.length].kind }
  }))
  const removeScenario = (i: number) => setScenarios((p) => p.filter((_, idx) => idx !== i))

  const cycleAfterSave = (): string | null => {
    const targetId = existing?.id ?? '__new__'
    const titleOf = (id: string) => id === targetId ? title.trim() || '(nou)' : byId[id]?.title ?? id
    const prospective: Issue[] = issues.map((i) => ({ ...i, deps: [...(i.deps ?? [])] }))
    let target = prospective.find((i) => i.id === targetId)
    if (!target) {
      target = { id: targetId, projectId: project.id, title, desc: '', theme, wave, deps: [], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false, ...NO_SCHEDULE }
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
      const draftDepMap: Record<string, string> = {}
      for (const d of draftDeps) {
        if (deps.includes(d.tempId)) {
          const created = await createIssue({ projectId: project.id, title: d.title, desc: '', theme, wave, deps: [] })
          draftDepMap[d.tempId] = created.id
        }
      }
      const draftBlockMap: Record<string, string> = {}
      for (const d of draftBlocks) {
        if (blocks.includes(d.tempId)) {
          const created = await createIssue({ projectId: project.id, title: d.title, desc: '', theme, wave, deps: [] })
          draftBlockMap[d.tempId] = created.id
        }
      }
      // Obstacolele ciornă se creează înaintea tichetului însuși — la fel ca
      // draftDeps/draftBlocks mai sus — ca un eșec aici să oprească salvarea
      // înainte ca tichetul să fi fost scris, nu la jumătate de mutație.
      // `createObstacle` întoarce `null` doar când n-are proiect activ (store,
      // `if (!projectId) return null`) — practic inatins cât timp formularul e
      // randat (`if (!project) return null` mai sus îl garantează), dar tot nu
      // trecem tăcut peste: titlul tastat rămâne exact cum l-a scris userul
      // (nu atingem `obstIds`/`draftObstacles`), iar `setIssueObstacles` nu se
      // mai cheamă deloc — tichetul nu iese legat de un set parțial.
      const realObstIds: string[] = []
      for (const id of obstIds) {
        const draft = draftObstacles.find((d) => d.tempId === id)
        if (!draft) { realObstIds.push(id); continue }
        const created = await createObstacle({ title: draft.title })
        if (created) { realObstIds.push(created.id); continue }
        setObstacleError(`Nu am putut crea obstacolul „${draft.title}". Tichetul nu s-a salvat — încearcă din nou.`)
        return
      }
      const realDeps = deps.map((id) => draftDepMap[id] ?? (id.startsWith('__draft_') ? null : id)).filter(Boolean) as string[]
      const qaPayload = {
        selectors: selectors.filter(Boolean), scenarios, notes: notes.trim(), assigneeId, urgent,
        dueAt: schedule.dueAt, allDay: schedule.allDay, remindAt: schedule.remindAt,
      }
      const targetId = isEdit
        ? (await updateIssue(existing!.id, { title: saveTitle, desc: desc.trim(), theme, wave, deps: realDeps, ...qaPayload }), existing!.id)
        : (await createIssue({ projectId: project.id, title: saveTitle, desc: desc.trim(), theme, wave, deps: realDeps, ...qaPayload })).id
      await setIssueObstacles(targetId, realObstIds)
      const realBlocks = blocks.map((id) => draftBlockMap[id] ?? (id.startsWith('__draft_') ? null : id)).filter(Boolean) as string[]
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
        snap = [...snap, { id: targetId, projectId: project.id, title: saveTitle, desc: desc.trim(), theme, wave, deps: realDeps, done: false, selectors: selectors.filter(Boolean), scenarios, notes: notes.trim(), assigneeId, urgent, dueAt: schedule.dueAt, allDay: schedule.allDay, remindAt: schedule.remindAt, rrule: null }]
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
        if (!isEdit) openEditIssue(targetId)
      }
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!canWrite || !existing || saving) return
    setSaving(true)
    try { await deleteIssue(existing.id); setCloseGuard(null); closeSheet() }
    finally { setSaving(false) }
  }

  const badgeIcon = (kind: ScenarioKind): IconName => BADGE_CYCLE.find((b) => b.kind === kind)?.icon ?? 'notDone'

  return (
    <>
      {/* HEADER */}
      <div className="sh-header">
        <button className="sh-close" onClick={closeSheet} aria-label="Închide"><Icon name="close" size={16} /></button>
        {isEdit && (
          <button
            tabIndex={-1}
            className={`sh-copy${copyState === 'ok' ? ' copied' : ''}${copyState === 'fail' ? ' copy-failed' : ''}`}
            onClick={() => void copyLink(existing?.id)}
            aria-label={copyState === 'fail' ? 'Copierea a eșuat' : 'Copiază link'}
            title={copyState === 'fail'
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
          <input
            ref={titleInputRef}
            className="sh-title-input"
            // `search`, nu `text`: e singura pârghie din pagină peste bara de
            // „completează manual" a Chrome (parolă / card / adresă), care
            // apare pe orice câmp de text. Costul e că un cititor de ecran
            // anunță „câmp de căutare" — de-aia stă aici cu un comentariu, nu
            // ca alegere de la sine înțeleasă.
            type="search"
            value={title}
            onChange={(e) => {
              setTitleTyped(true)
              setTitle(e.target.value)
            }}
            readOnly={!canWrite}
            placeholder={isEdit ? existing!.id : 'Titlu tichet…'}
            // În panou, nu: focusul ar sări în titlu la fiecare rând atins din
            // listă, iar tastele de navigare ar ajunge în câmp în loc de listă.
            autoFocus={!docked}
            autoComplete="off"
            autoCorrect="off"
            inputMode="text"
            spellCheck={false}
            // O atingere PE fragmentul recunoscut înseamnă „nu e o dată".
            {...titleDate.inputProps}
            onScroll={(e) => {
              if (titleDate.mirrorRef.current) titleDate.mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault()
                descRef.current?.focus()
              }
            }}
          />
        </span>
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

        {/* META — Temă · Val · Assigned to */}
        <div className={`sh-meta-section${metaOpen ? '' : ' meta-collapsed'}`}>
          {/* Doar pe mobil (CSS-ul de desktop îl ascunde): rezumatul înlocuiește
              blocul întreg cât timp e colaps, ca Descrierea să urce sub titlu. */}
          <button
            type="button"
            className="meta-recap"
            onClick={() => setMetaOpen((v) => !v)}
            aria-expanded={metaOpen}
          >
            <span className="meta-recap-label">Detalii</span>
            <span className="meta-recap-sep" aria-hidden="true">·</span>
            <span className="meta-recap-text">{metaRecap}</span>
            <Icon name="collapse" size={14} className={`acc-chevron${metaOpen ? ' open' : ''}`} />
          </button>
          <div className="meta-body">
          <div className="sh-meta-inline-row">

            <div className="meta-col meta-col-theme">
              <span className="meta-row-label">Temă</span>
              <div className="pills-row">
                <button tabIndex={-1} className={`if-meta-pill ${theme === '' ? 'active' : ''}`} onClick={() => setTheme('')}>Fără</button>
                {themes.map((t) => (
                  <button tabIndex={-1} key={t.key} className={`if-meta-pill ${theme === t.key ? 'active' : ''}`} onClick={() => setTheme(t.key)}>
                    <span className="if-meta-dot" style={{ background: t.color }} />{t.name}
                  </button>
                ))}
                {canWrite && (
                  <button tabIndex={-1} className="if-meta-add" onClick={() => setShowNewTheme((v) => !v)} title="Temă nouă">
                    <Icon name={showNewTheme ? 'close' : 'add'} size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="meta-vsep" />

            <div className="meta-col meta-col-wave">
              <span className="meta-row-label">Val</span>
              <div className="pills-row">
                {waves.map((w) => (
                  <button tabIndex={-1} key={w.number} className={`if-meta-wave ${wave === w.number ? 'active' : ''}`} onClick={() => {
                    if (isEdit && existing) {
                      const dependants = issues.filter((i) => (i.deps ?? []).includes(existing.id))
                      if (dependants.length > 0) {
                        const required = Math.min(...dependants.map((d) => d.wave))
                        if (w.number !== required) {
                          const names = dependants.map((d) => `„${d.title}" (val ${d.wave})`).join(', ')
                          setWaveError(`„${title}" este o dependență a ${names}. Nu poți muta tichetul.`)
                          return
                        }
                      }
                    }
                    setWave(w.number)
                    setWaveError(null)
                  }}>
                    {w.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="meta-vsep" />

            <div className="meta-col meta-col-assign">
              <span className="meta-row-label">Assigned to</span>
              <div className="meta-row-inline">
                {assigneeId && !showAssigneeInline && (() => {
                  const a = assignees.find((x) => x.id === assigneeId)
                  return a ? (
                    <div className="assignee-chip-inline">
                      <div className="assignee-avatar-sm">{a.name.slice(0, 2).toUpperCase()}</div>
                      <span className="assignee-name-sm">{a.name}{a.id === myAssigneeId ? ' (me)' : ''}</span>
                      <span className="assignee-x-sm" tabIndex={-1} onClick={() => setAssigneeId(null)}><Icon name="close" size={12} /></span>
                    </div>
                  ) : null
                })()}
                <button tabIndex={-1} className="if-meta-add" onClick={() => setShowAssigneeInline((v) => !v)}>
                  <Icon name={showAssigneeInline ? 'close' : 'add'} size={13} />
                </button>
              </div>
            </div>

            <div className="meta-vsep" />

            <div className="meta-col meta-col-urgent">
              <span className="meta-row-label">Prioritate</span>
              <div className="pills-row">
                <button
                  tabIndex={-1}
                  type="button"
                  className={`if-meta-pill urgent-pill ${urgent ? 'active' : ''}`}
                  onClick={() => setUrgent((v) => !v)}
                  title={urgent ? 'Scoate urgența' : 'Marchează urgent'}
                >
                  <Icon name="urgent" size={13} /> Urgent
                </button>
              </div>
            </div>

          </div>

            <div className="sh-due-row">
              <div className="meta-col meta-col-due">
                <span className="meta-row-label">Scadență</span>
                <div className="due-inputs">
                  <input
                    tabIndex={-1}
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
                    tabIndex={-1}
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
                    tabIndex={-1}
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
                    tabIndex={-1}
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
                  {dueText && (
                    <button
                      tabIndex={-1}
                      type="button"
                      className="due-clear"
                      onClick={() => {
                      setDueText(''); setTimeText(''); setReminderTouched(false)
                    }}
                      title="Scoate scadența"
                      aria-label="Scoate scadența"
                    >
                      ×
                    </button>
                  )}
                </div>
                {/* Mementoul apare numai când are ce să însemne. Pentru o sarcină de
                    zi întreagă ar suna la miezul nopții, deci acolo tace și treaba
                    o face rezumatul de dimineață. */}
                {dueDate && dueTime && (
                  <div className="pills-row due-reminder">
                    {([
                      ['due', 'la oră'],
                      ['m30', '−30m'],
                      ['d1', '−1 zi'],
                      ['none', 'fără'],
                    ] as const).map(([kind, label]) => (
                      <button
                        key={kind}
                        tabIndex={-1}
                        type="button"
                        className={`if-meta-pill reminder-pill ${schedule.kind === kind ? 'active' : ''}`}
                        onClick={() => { setReminder(kind); setReminderTouched(true) }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {/* Semnalul că scadența a venit din titlu, cu cele două ieșiri:
                  curăță textul rămas în titlu, sau refuză de tot. Fără ele,
                  recunoașterea ar fi o ghicire pe care n-o poți contrazice. */}
              {titleDate.active && (
                <span className="due-from-title">
                  <span className="chip date">
                    <span className="chip-ico"><Icon name="fromTitle" size={13} /></span> din titlu
                    <button
                      tabIndex={-1}
                      type="button"
                      className="chip-x"
                      title="Nu e o dată — lasă titlul în pace"
                      aria-label="Refuză data din titlu"
                      onClick={refuseTitleDate}
                    >
                      ✕
                    </button>
                  </span>
                  <button
                    tabIndex={-1}
                    type="button"
                    className="due-clean-title"
                    title="Scoate textul datei din titlu"
                    onClick={cleanTitleFromDate}
                  >
                    curăță titlul
                  </button>
                </span>
              )}
              {/* Titlul era numai dată: salvarea e stinsă, deci spune de ce. */}
              {bareTitle && <span className="due-hint warn">și ce ai de făcut?</span>}
              {(dueIncomplete || timeIncomplete) && (
                  <span className="due-hint warn">{dueIncomplete ? 'zi-lună-an' : 'oră 0–23'}</span>
                )}
                {dueDate && !dueTime && <span className="due-hint">toată ziua</span>}
              </div>
  
            </div>

          {showNewTheme && (
            <div className="inline-search-wrap" style={{ padding: '6px 12px 8px' }}>
              <input
                className="inline-search-input"
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTheme()}
                placeholder="Nume temă nouă…"
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                inputMode="text"
              />
              <button className="inline-ok-btn" onClick={addTheme} disabled={!newThemeName.trim()}>OK</button>
            </div>
          )}
          {showAssigneeInline && (
            <div className="inline-search-wrap" style={{ padding: '6px 12px 8px' }}>
              <AssigneeSearch
                assigneeId={null}
                assignees={assignees}
                myAssigneeId={myAssigneeId}
                onSelect={(id) => { setAssigneeId(id); setShowAssigneeInline(false) }}
                onSetMe={setMyAssigneeId}
                onCreateAndSelect={async (name) => {
                  const a = await createAssignee(name)
                  setAssigneeId(a.id)
                  setShowAssigneeInline(false)
                }}
              />
            </div>
          )}
          </div>
        </div>

        {/* MAIN FORM — 2 cols */}
        <div className="form-cols">

          {/* LEFT — descriere. Fișierele stau DEASUPRA descrierii, într-o bară
              de o linie: sub o descriere lungă nu se mai vedeau fără scroll.
              Coloana întreagă e zona de drop — vezi `dropZone` în Attachments. */}
          <div className={`form-col form-col-desc ${dropActive ? 'att-dropping' : ''}`} ref={descColRef}>
            <label className="if-field-label" style={{ display: 'block', marginBottom: 8 }}>Descriere</label>
            {project && (
              <Attachments
                issueId={existing?.id}
                projectId={project.id}
                readOnly={!canWrite}
                dropZone={descColRef}
                onDropActive={setDropActive}
              />
            )}
            <textarea
              ref={descRef}
              className="desc-fixed"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              readOnly={!canWrite}
              placeholder="Cerințe, notițe, context…"
            />
          </div>

          {/* RIGHT — deps + QA + note */}
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
                          <span className="dep-dd-id">{item.id}</span>
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
                            <span className="dep-card-id">{id}</span>
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
                          <span className="dep-card-id">{id}</span>
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

            {/* QA ACCORDION */}
            <div className="acc-section">
              <button className="acc-header" onClick={() => setQaOpen((v) => !v)}>
                <span className="acc-icon">
                  <Icon name="fileDoc" size={13} />
                </span>
                <span className="acc-title">QA</span>
                {qaCount > 0 && <span className="acc-count">{qaCount}</span>}
                <Icon name="collapse" size={13} className={`acc-chevron${qaOpen ? ' open' : ''}`} />
              </button>
              {qaOpen && (
                <div className="acc-body">
                  <div className="qa-sub-row">
                    <span className="qa-sub-label">Playwright Selectors</span>
                    <button className="qa-sub-add" onClick={addSelector}>+</button>
                  </div>
                  <div className="if-sc-list">
                    {selectors.map((s, i) => (
                      <div key={i} className="if-sc-item">
                        <span className="if-badge selector"><Icon name="selector" size={12} /></span>
                        <input value={s} onChange={(e) => updateSelector(i, e.target.value)}
                          placeholder="getByRole('button', { name: 'Login' })"
                          style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
                          autoComplete="off" autoCorrect="off" inputMode="text" />
                        <button className="if-sc-del" onClick={() => removeSelector(i)} aria-label="Șterge selectorul"><Icon name="close" size={13} /></button>
                      </div>
                    ))}
                  </div>

                  <div className="qa-divider" />

                  <div className="qa-sub-row">
                    <span className="qa-sub-label">Test Scenarios</span>
                    <button className="qa-sub-add" onClick={addScenario}>+</button>
                  </div>
                  <div className="if-sc-list">
                    {scenarios.map((s, i) => (
                      <div key={i} className="if-sc-item">
                        <span className={`if-badge ${s.kind}`} onClick={() => cycleScenarioBadge(i)} title="Click schimbă tipul">
                          <Icon name={badgeIcon(s.kind)} size={13} />
                        </span>
                        <input value={s.text} onChange={(e) => updateScenarioText(i, e.target.value)}
                          placeholder="Ex: Login reușit cu date valide"
                          autoComplete="off" autoCorrect="off" inputMode="text" />
                        <button className="if-sc-del" onClick={() => removeScenario(i)} aria-label="Șterge scenariul"><Icon name="close" size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* NOTE — mereu vizibil */}
            <div className="notes-section" ref={notesSectionRef}>
              <span className="notes-label">NOTE</span>
              <AutoTextarea value={notes} onChange={setNotes}
                placeholder="Observații libere, edge cases, links…" minH={80} maxH={notesMaxH} />
            </div>

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
