import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useCanWriteFn, useMediaQuery, useSelection, type Selection } from '../hooks'
import {
  bulkNotice, canClearDate, countRecurring, deleteNotice, nextMonday, planBulk, urgentTarget,
  type BulkAction, type DatePreset,
} from '../lib/bulkActions'
import { didJumpOnComplete } from '../lib/recurrence'
import { addDays, startOfLocalDay, toShortDate } from '../lib/schedule'
import type { Issue } from '../lib/types'
import { Icon } from './Icon'
import { KeyboardSheet } from './KeyboardSheet'

/** Foaia de acțiuni deschisă peste listă: pe ce sarcini, și ce fel. */
// `bulk-more`: ⋮ din bara de selecție — fără „Șterge", care e deja în bară.
type ActionSheet = { kind: 'date' | 'more' | 'bulk-more' | 'assign'; ids: string[] }

interface TaskActions extends Selection {
  /** Sub 900px: numai acolo există glisare, apăsare lungă și bara de selecție. */
  narrow: boolean
  /** Rândul deschis acum (cu banda vizibilă). Unul singur. */
  openRow: string | null
  setOpenRow(id: string | null): void
  /** Rândurile de pe ecran, pentru „Toate". Le anunță `SmartListView`. */
  setVisible(ids: string[]): void
  issuesOf(ids: string[]): Issue[]
  selectAllVisible(): void
  run(action: BulkAction, ids: string[]): Promise<void>
  remove(ids: string[]): void
  openSheet(kind: ActionSheet['kind'], ids: string[]): void
  /** Straturile peste listă care au intrare în istoric: selecția, foaia. */
  layers: number
  /** Back: închide stratul de sus. */
  popLayer(): void
}

const Ctx = createContext<TaskActions | null>(null)

export function useTaskActions(): TaskActions {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTaskActions must be used within TaskActionsProvider')
  return ctx
}

/**
 * Acțiunile pe sarcini din listele inteligente, pe telefon: glisarea unui rând
 * și modul de selecție. Ține starea comună rândurilor, antetului și barei de
 * jos (care trăiesc în locuri diferite din arbore) și execută acțiunile —
 * logica lor e în `lib/bulkActions`, aici doar se leagă de store și de toast.
 */
export function TaskActionsProvider({ children }: { children: ReactNode }) {
  const { dueIssues, openIssues, applyWrites, hideIssues, unhideIssues, deleteIssues, offerUndo, reportError } = useHorizontal()
  const { showToast } = useUI()
  const canWrite = useCanWriteFn()
  const narrow = useMediaQuery('(max-width: 899px)')
  const sel = useSelection()
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ActionSheet | null>(null)
  const visible = useRef<string[]>([])

  const dueRef = useRef(dueIssues)
  dueRef.current = dueIssues
  // Și cele fără scadență: un filtru salvat arată tichete deschise oricare.
  const openRef = useRef(openIssues)
  openRef.current = openIssues
  const issuesOf = useCallback((ids: string[]): Issue[] => {
    const by = new Map([...openRef.current, ...dueRef.current].map((i) => [i.id, i]))
    return ids.map((id) => by.get(id)).filter((i): i is Issue => !!i)
  }, [])

  const { exitSelectMode, setSelected, selectMode } = sel
  // Peste prag nu există mod de selecție de telefon: o fereastră lărgită în
  // timpul selecției ar rămâne cu un antet înlocuit și fără bară.
  useEffect(() => {
    if (!narrow) { exitSelectMode(); setSheet(null); setOpenRow(null) }
  }, [narrow, exitSelectMode])

  // Rândul deschis se închide la orice atingere în afara lui și la derulare.
  useEffect(() => {
    if (!openRow) return
    const onTouch = (e: Event) => {
      const t = e.target as Element | null
      if (t?.closest?.(`[data-swipe-id="${CSS.escape(openRow)}"]`)) return
      setOpenRow(null)
    }
    const onScroll = () => setOpenRow(null)
    document.addEventListener('touchstart', onTouch, { capture: true, passive: true })
    document.addEventListener('mousedown', onTouch, { capture: true })
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouch, { capture: true })
      document.removeEventListener('mousedown', onTouch, { capture: true })
      document.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [openRow])

  const finish = useCallback(() => {
    setSheet(null)
    setOpenRow(null)
    exitSelectMode()
  }, [exitSelectMode])

  const run = useCallback(async (action: BulkAction, ids: string[]) => {
    const issues = issuesOf(ids)
    finish()
    const plan = planBulk(issues, action, canWrite, new Date())
    if (plan.writes.length === 0) {
      showToast(bulkNotice(action, 0, plan.readOnly))
      return
    }
    const before = new Map(issues.map((i) => [i.id, i]))
    const { saved } = await applyWrites(plan.writes.map(({ id, patch }) => ({ id, patch })))
    const ok = new Set(saved.map((s) => s.id))
    // Saltul se numără din răspunsul bazei, ca la `toggleDone`.
    const jumped = action.kind === 'done'
      ? saved.filter((s) => didJumpOnComplete(true, before.get(s.id)?.dueAt ?? null, s)).length
      : 0
    const done = plan.writes.filter((w) => ok.has(w.id))
    if (done.length === 0) return
    offerUndo({
      label: bulkNotice(action, done.length, plan.readOnly, jumped),
      undo: () => { void applyWrites(done.map((w) => ({ id: w.id, patch: w.prev }))) },
    })
  }, [issuesOf, finish, canWrite, applyWrites, offerUndo, showToast])

  const remove = useCallback((ids: string[]) => {
    const issues = issuesOf(ids)
    finish()
    const mine = issues.filter((i) => canWrite(i.projectId)).map((i) => i.id)
    const readOnly = issues.length - mine.length
    if (mine.length === 0) { showToast(deleteNotice(0, readOnly)); return }
    // Fără dialog de confirmare: rândurile dispar acum, iar ștergerea pleacă
    // abia când se închide fereastra de anulare. „Anulează" doar le arată la loc.
    hideIssues(mine)
    offerUndo({
      label: deleteNotice(mine.length, readOnly),
      undo: () => unhideIssues(mine),
      expire: () => {
        deleteIssues(mine)
          .catch((e) => reportError(e instanceof Error ? e.message : String(e)))
          .finally(() => unhideIssues(mine))
      },
    })
  }, [issuesOf, finish, canWrite, hideIssues, unhideIssues, deleteIssues, offerUndo, reportError, showToast])

  const openSheet = useCallback((kind: ActionSheet['kind'], ids: string[]) => {
    setOpenRow(null)
    setSheet({ kind, ids })
  }, [])

  const selectAllVisible = useCallback(() => setSelected(visible.current), [setSelected])
  const setVisible = useCallback((ids: string[]) => { visible.current = ids }, [])

  const layers = (selectMode ? 1 : 0) + (sheet ? 1 : 0)
  const popLayer = useCallback(() => {
    if (sheet) setSheet(null)
    else exitSelectMode()
  }, [sheet, exitSelectMode])

  const value = useMemo<TaskActions>(() => ({
    ...sel, narrow, openRow, setOpenRow, setVisible, issuesOf, selectAllVisible, run, remove, openSheet, layers, popLayer,
  }), [sel, narrow, openRow, setVisible, issuesOf, selectAllVisible, run, remove, openSheet, layers, popLayer])

  const targets = sheet ? issuesOf(sheet.ids) : []

  return (
    <Ctx.Provider value={value}>
      {children}
      {sheet?.kind === 'date' && (
        <DateSheet
          issues={targets}
          onPick={(preset) => void run({ kind: 'date', preset }, sheet.ids)}
          onClose={() => setSheet(null)}
        />
      )}
      {(sheet?.kind === 'more' || sheet?.kind === 'bulk-more') && (
        <MoreSheet
          count={targets.length}
          canDelete={sheet.kind === 'more'}
          onAssign={() => setSheet({ kind: 'assign', ids: sheet.ids })}
          onDelete={() => remove(sheet.ids)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'assign' && (
        <AssignSheet
          onPick={(assigneeId) => void run({ kind: 'assign', assigneeId }, sheet.ids)}
          onClose={() => setSheet(null)}
        />
      )}
    </Ctx.Provider>
  )
}

const DAY_SHORT = ['dum', 'lun', 'mar', 'mie', 'joi', 'vin', 'sâm']
const dayLabel = (d: Date) => `${DAY_SHORT[d.getDay()]} ${toShortDate(d)}`

const subject = (issues: Issue[]) =>
  issues.length === 1 ? issues[0].title : `${issues.length} sarcini`

/**
 * Foaia de dată: a glisării spre stânga și a barei de selecție. Presetările
 * păstrează ora fiecărei sarcini; „Alege…" deschide aceleași câmpuri de zi și
 * oră ca foaia de tichet.
 */
function DateSheet({ issues, onPick, onClose }: { issues: Issue[]; onPick(p: DatePreset): void; onClose(): void }) {
  const now = new Date()
  const today = startOfLocalDay(now)
  const recurring = countRecurring(issues)
  const [picking, setPicking] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  const presets: { preset: DatePreset; label: string; hint?: string; disabled?: boolean }[] = [
    { preset: { kind: 'today' }, label: 'Azi', hint: dayLabel(today) },
    { preset: { kind: 'tomorrow' }, label: 'Mâine', hint: dayLabel(addDays(today, 1)) },
    { preset: { kind: 'plus1' }, label: '+1 zi', hint: 'față de scadență' },
    { preset: { kind: 'nextMonday' }, label: 'Luni viitoare', hint: dayLabel(nextMonday(now)) },
    { preset: { kind: 'none' }, label: 'Fără dată', disabled: !canClearDate(issues) },
  ]

  const apply = () => {
    if (!date) return
    const [y, m, d] = date.split('-').map(Number)
    onPick({ kind: 'pick', date: new Date(y, m - 1, d), time: time || null })
  }

  return (
    <KeyboardSheet onClose={onClose} label="Mută data" className="action-sheet date-sheet">
      <p className="as-title">Mută <span className="as-subject">{subject(issues)}</span></p>
      <div className="ds-grid">
        {presets.map(({ preset, label, hint, disabled }) => (
          <button
            key={preset.kind}
            type="button"
            className={`ds-opt ${preset.kind === 'tomorrow' ? 'primary' : ''}`}
            disabled={disabled}
            onClick={() => onPick(preset)}
          >
            <span className="ds-label">{label}</span>
            {hint && <span className="ds-hint">{hint}</span>}
          </button>
        ))}
        <button
          type="button"
          className={`ds-opt ${picking ? 'on' : ''}`}
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
        >
          <span className="ds-label">Alege…</span>
          <span className="ds-hint">zi și oră</span>
        </button>
      </div>
      {recurring > 0 && (
        <p className="ds-note">
          <Icon name="recurring" size={12} /> {recurring} {recurring === 1 ? 'recurentă' : 'recurente'} — se mută doar apariția curentă
        </p>
      )}
      {picking && (
        <div className="qs-when ds-pick">
          <Icon name="due" size={14} />
          <input type="date" aria-label="Ziua" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" aria-label="Ora" value={time} onChange={(e) => setTime(e.target.value)} />
          <button type="button" className="ds-apply" disabled={!date} onClick={apply}>Aplică</button>
        </div>
      )}
    </KeyboardSheet>
  )
}

/** ⋮ de pe banda unui rând: ce nu încape pe bandă. */
function MoreSheet({ count, canDelete, onAssign, onDelete, onClose }: { count: number; canDelete: boolean; onAssign(): void; onDelete(): void; onClose(): void }) {
  return (
    <KeyboardSheet onClose={onClose} label="Mai multe" className="action-sheet">
      <div className="as-list">
        <button type="button" className="as-item" onClick={onAssign}>
          <Icon name="people" size={18} /> Pasează
        </button>
        {canDelete && (
          <button type="button" className="as-item danger" onClick={onDelete}>
            <Icon name="delete" size={18} /> Șterge{count > 1 ? ` ${count}` : ''}
          </button>
        )}
      </div>
    </KeyboardSheet>
  )
}

/**
 * Pasarea: o simplă schimbare de `assigneeId`, ca selectorul din foaia de
 * tichet. Pasarea cu un mesaj rămâne în fir (`post_to_thread`).
 */
function AssignSheet({ onPick, onClose }: { onPick(id: string | null): void; onClose(): void }) {
  const { assignees } = useHorizontal()
  return (
    <KeyboardSheet onClose={onClose} label="Pasează" className="action-sheet">
      <p className="as-title">Pasează</p>
      <div className="as-list">
        <button type="button" className="as-item" onClick={() => onPick(null)}>
          <Icon name="back" size={18} /> Înapoi la creator
        </button>
        {assignees.map((a) => (
          <button key={a.id} type="button" className="as-item" onClick={() => onPick(a.id)}>
            <Icon name="people" size={18} /> {a.name}
          </button>
        ))}
      </div>
    </KeyboardSheet>
  )
}

/** Urgent pe o selecție: vezi `urgentTarget`. Exportat pentru bara de jos și bandă. */
export function urgentActionFor(issues: Issue[]): BulkAction {
  return { kind: 'urgent', value: urgentTarget(issues) }
}
