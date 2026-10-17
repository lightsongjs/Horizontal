import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useCanWriteFn, useMediaQuery, useSelection, type Selection } from '../hooks'
import {
  bulkNotice, canClearDate, countRecurring, deleteNotice, nextMonday, pinTarget, planBulk, urgentTarget,
  type BulkAction, type DatePreset,
} from '../lib/bulkActions'
import { didJumpOnComplete } from '../lib/recurrence'
import { addDays, dayOffset, hasTime, startOfLocalDay, toDateInput, toShortDate, toTimeInput } from '../lib/schedule'
import { dateFromInput } from '../lib/nativePicker'
import type { Issue } from '../lib/types'
import { Icon } from './Icon'
import { KeyboardSheet } from './KeyboardSheet'
import { NativePick } from './NativePick'
import { MoveProjectSheet } from './MoveProject'
import { isTempIssueId } from '../lib/issueId'

/** Foaia de acțiuni deschisă peste listă: pe ce sarcini, și ce fel. */
// `bulk-more`: ⋮ din bara de selecție — fără „Șterge", care e deja în bară.
// `move`: „Mută în proiect…" din ⋮ al unui singur rând (selecția nu se mută, v1).
type ActionSheet = { kind: 'date' | 'more' | 'bulk-more' | 'assign' | 'move'; ids: string[] }

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
  /**
   * Calendarul / ceasul nativ (`NativePick`): valoarea cu care se deschid și
   * scrierea alegerii. Data păstrează ora fiecărei sarcini; ora se pune pe
   * ziua fiecărei sarcini (sau azi).
   */
  dateInitial(ids: string[]): string
  timeInitial(ids: string[]): string
  applyDate(ids: string[], value: string): void
  applyTime(ids: string[], value: string): void
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

  const dateInitial = useCallback((ids: string[]) => {
    const issues = issuesOf(ids)
    const one = issues.length === 1 ? issues[0] : null
    return toDateInput(one?.dueAt ?? new Date().toISOString())
  }, [issuesOf])

  const timeInitial = useCallback((ids: string[]) => {
    const issues = issuesOf(ids)
    const one = issues.length === 1 ? issues[0] : null
    // Ora de acum a sarcinii; fără oră, ceasul pornește de la ora curentă.
    return one && hasTime(one) && dayOffset(one.dueAt!, new Date()) >= 0 ? toTimeInput(one.dueAt!) : ''
  }, [issuesOf])

  const applyDate = useCallback((ids: string[], v: string) => {
    void run({ kind: 'date', preset: { kind: 'pick', date: dateFromInput(v), time: null } }, ids)
  }, [run])

  const applyTime = useCallback((ids: string[], v: string) => {
    void run({ kind: 'date', preset: { kind: 'time', time: v } }, ids)
  }, [run])

  const selectAllVisible = useCallback(() => setSelected(visible.current), [setSelected])
  const setVisible = useCallback((ids: string[]) => { visible.current = ids }, [])

  const layers = (selectMode ? 1 : 0) + (sheet ? 1 : 0)
  const popLayer = useCallback(() => {
    if (sheet) setSheet(null)
    else exitSelectMode()
  }, [sheet, exitSelectMode])

  const value = useMemo<TaskActions>(() => ({
    ...sel, narrow, openRow, setOpenRow, setVisible, issuesOf, selectAllVisible, run, remove, openSheet, dateInitial, timeInitial, applyDate, applyTime, layers, popLayer,
  }), [sel, narrow, openRow, setVisible, issuesOf, selectAllVisible, run, remove, openSheet, dateInitial, timeInitial, applyDate, applyTime, layers, popLayer])

  const targets = sheet ? issuesOf(sheet.ids) : []

  return (
    <Ctx.Provider value={value}>
      {children}
      {sheet?.kind === 'date' && (
        <DateSheet
          issues={targets}
          onPick={(preset) => void run({ kind: 'date', preset }, sheet.ids)}
          dateInitial={() => dateInitial(sheet.ids)}
          timeInitial={() => timeInitial(sheet.ids)}
          onPickDate={(v) => applyDate(sheet.ids, v)}
          onPickTime={(v) => applyTime(sheet.ids, v)}
          onClose={() => setSheet(null)}
        />
      )}
      {(sheet?.kind === 'more' || sheet?.kind === 'bulk-more') && (
        <MoreSheet
          count={targets.length}
          canDelete={sheet.kind === 'more'}
          urgent={sheet.kind === 'more' ? targets.every((i) => i.urgent) && targets.length > 0 : null}
          onUrgent={() => void run(urgentActionFor(targets), sheet.ids)}
          pin={pinTarget(targets)}
          onPin={() => void run({ kind: 'pin', value: pinTarget(targets) }, sheet.ids)}
          onAssign={() => setSheet({ kind: 'assign', ids: sheet.ids })}
          onMove={sheet.kind === 'more' && targets.length === 1 && canWrite(targets[0].projectId) && !isTempIssueId(targets[0].id)
            ? () => setSheet({ kind: 'move', ids: sheet.ids })
            : null}
          onDelete={() => remove(sheet.ids)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'move' && targets.length === 1 && (
        <MoveProjectSheet issue={targets[0]} open={false} onClose={finish} />
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
 * Foaia de dată a barei de selecție și a glisării complete spre stânga.
 * Presetările păstrează ora fiecărei sarcini; „Alege data" și „Oră" sunt
 * inputuri native sub deget (`NativePick`): calendarul / ceasul sistemului.
 */
function DateSheet({ issues, onPick, dateInitial, timeInitial, onPickDate, onPickTime, onClose }: {
  issues: Issue[]; onPick(p: DatePreset): void
  dateInitial(): string; timeInitial(): string; onPickDate(v: string): void; onPickTime(v: string): void; onClose(): void
}) {
  const now = new Date()
  const today = startOfLocalDay(now)
  const recurring = countRecurring(issues)

  const presets: { preset: DatePreset; label: string; hint?: string; disabled?: boolean }[] = [
    { preset: { kind: 'today' }, label: 'Azi', hint: dayLabel(today) },
    { preset: { kind: 'tomorrow' }, label: 'Mâine', hint: dayLabel(addDays(today, 1)) },
    { preset: { kind: 'plus1' }, label: '+1 zi', hint: 'față de scadență' },
    { preset: { kind: 'nextMonday' }, label: 'Luni viitoare', hint: dayLabel(nextMonday(now)) },
  ]

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
        <NativePick type="date" label="Alege data…" className="ds-opt" initial={dateInitial} onPick={onPickDate}>
          <span className="ds-label" aria-hidden>Alege data…</span>
          <span className="ds-hint" aria-hidden>calendar</span>
        </NativePick>
        <NativePick type="time" label="Oră…" className="ds-opt" initial={timeInitial} onPick={onPickTime}>
          <span className="ds-label" aria-hidden>Oră…</span>
          <span className="ds-hint" aria-hidden>ziua rămâne</span>
        </NativePick>
        <button
          type="button"
          className="ds-opt ds-wide"
          disabled={!canClearDate(issues)}
          onClick={() => onPick({ kind: 'none' })}
        >
          <span className="ds-label">Fără dată</span>
        </button>
      </div>
      {recurring > 0 && (
        <p className="ds-note">
          <Icon name="recurring" size={12} /> {recurring} {recurring === 1 ? 'recurentă' : 'recurente'} — data mută doar apariția curentă, ora mută seria
        </p>
      )}
    </KeyboardSheet>
  )
}

/**
 * ⋮ de pe banda unui rând: ce nu încape pe bandă. Urgent stă aici de când
 * banda a primit „Oră": patru butoane la 320px lăsau din rând o fâșie de
 * ~60px și împingeau banda peste pragul glisării complete. `urgent` e `null`
 * în ⋮ al selecției, unde bara are deja Urgent.
 */
function MoreSheet({ count, canDelete, urgent, onUrgent, pin, onPin, onAssign, onMove, onDelete, onClose }: {
  count: number; canDelete: boolean; urgent: boolean | null; onUrgent(): void
  /** `true` = gestul fixează (măcar una nefixată); `false` = toate sunt fixate, gestul scoate. */
  pin: boolean; onPin(): void
  onAssign(): void
  /** `null`: mai multe sarcini, fără drept, sau ID provizoriu — rândul lipsește. */
  onMove: (() => void) | null
  onDelete(): void; onClose(): void
}) {
  return (
    <KeyboardSheet onClose={onClose} label="Mai multe" className="action-sheet">
      <div className="as-list">
        {urgent !== null && (
          <button type="button" className="as-item" onClick={onUrgent}>
            <Icon name="urgent" size={18} /> {urgent ? 'Scoate urgent' : 'Urgent'}
          </button>
        )}
        <button type="button" className="as-item" onClick={onPin}>
          <Icon name={pin ? 'pin' : 'unpin'} size={18} /> {pin ? 'Fixează sus' : 'Scoate de sus'}
        </button>
        <button type="button" className="as-item" onClick={onAssign}>
          <Icon name="people" size={18} /> Pasează
        </button>
        {onMove && (
          <button type="button" className="as-item" onClick={onMove}>
            <Icon name="move" size={18} /> Mută în proiect…
          </button>
        )}
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
