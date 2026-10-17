import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useAutosave, useCanWriteIn, useTitleDate, type TitleDate } from '../hooks'
import type { Normalize } from '../lib/autosave'
import { dateFragments } from '../lib/parseDue'
import { dueLabelParts } from '../lib/quickDraft'
import {
  fromInputs, reminderAt, reminderKindOf, reschedule,
  toDateInput, toTimeInput,
} from '../lib/schedule'
import { pinPatch } from '../lib/pinned'
import { mergeTitleDue } from '../lib/titleDue'
import type { Issue } from '../lib/types'
import { Icon } from './Icon'
import { KeyboardSheet } from './KeyboardSheet'
import { DescFold } from './DescFold'
import type { EditorHandle } from './MarkdownEditor'
import { FormatBar } from './FormatBar'
import { AttachButton, ThumbRow, attachBlocked, useTicketFiles } from './SheetFiles'
import { ProjectMark } from './ProjectMark'
import { displayIssueId, isTempIssueId } from '../lib/issueId'
import { MoveProjectSheet } from './MoveProject'
import { SheetThreadRow } from './SheetThreadRow'
import { ChipPop } from './ChipPop'
import { DuePanel } from './DuePanel'

/** Ce se editează din foaie — exact câmpurile pe care le poate trimite. */
type EditFields = {
  title: string
  desc: string
  dueAt: string | null
  allDay: boolean
  remindAt: string | null
  rrule: string | null
  urgent: boolean
  pinnedAt: string | null
}

const fieldsOf = (i: Issue): EditFields => ({
  title: i.title,
  desc: i.desc,
  dueAt: i.dueAt,
  allDay: i.allDay,
  remindAt: i.remindAt,
  rrule: i.rrule ?? null,
  urgent: i.urgent,
  pinnedAt: i.pinnedAt ?? null,
})

/**
 * Titlul se trimite fără spațiile de la capete, iar unul gol nu se trimite
 * deloc: golit din greșeală și lăsat așa, tichetul își păstrează titlul vechi.
 *
 * Cât în titlu e evidențiată o dată (`held()`), titlul NU pleacă: pauza de
 * 800ms ar fi salvat „Ședință la 17" ca text, iar aplicarea de la blur ar fi
 * venit după, ca o a doua scriere care rescrie titlul. Data se aplică doar la
 * un gest de încheiere (blur, Enter, închidere) — o pauză în scris nu e unul.
 */
const normalizeWith = (held: () => boolean): Normalize<EditFields> => (field, value) => {
  if (field !== 'title') return value
  if (held()) return undefined
  const t = (value as string).trim()
  return (t === '' ? undefined : t) as typeof value | undefined
}

/** Ca în `QuickSheet`: o atingere pe un buton nu ia focusul (tastatura rămâne cum e). */
const keepFocus = (e: PointerEvent) => e.preventDefault()

/**
 * Un tichet existent, deschis pe telefon: aceeași foaie ca adăugarea rapidă,
 * cu titlul, descrierea întreagă și rândul de controale. N-are buton de
 * salvare — salvează singură (`useAutosave`): textul după o pauză și la
 * închidere, jetoanele imediat.
 *
 * Nu ia focusul la deschidere: deschizi ca să citești, iar o tastatură care
 * sare acoperă exact descrierea. Tastatura vine la atingerea unui câmp, iar
 * foaia urcă deasupra ei (`KeyboardSheet`).
 *
 * Scadența, urgența și persoana se citesc din ciorna rebazată din store, deci
 * saltul unei recurențe (bifa de lângă titlu) se vede fără remontare — spre
 * deosebire de formularul complet, care și-a copiat câmpurile la montare.
 */
export function EditSheet({ issueId }: { issueId: string }) {
  const { byId, dueIssues, openIssues } = useHorizontal()
  const { closeSheet } = useUI()
  // `openIssues` în plus: tichetul abia mutat, fără scadență, cât proiectul
  // țintă încă se încarcă (`byId` e al proiectului deschis).
  const issue = byId[issueId] ?? dueIssues.find((i) => i.id === issueId) ?? openIssues.find((i) => i.id === issueId)
  if (!issue) {
    return (
      <KeyboardSheet onClose={closeSheet} label="Sarcină" className="edit-sheet">
        <p className="qa-noproject">Tichetul nu mai există.</p>
      </KeyboardSheet>
    )
  }
  return <EditBody issue={issue} />
}

function EditBody({ issue }: { issue: Issue }) {
  const { projects, assignees, assigneeShort, updateIssue, toggleDone, byId } = useHorizontal()
  const { closeSheet, expandIssue, showToast, pushSheet } = useUI()
  const canWrite = useCanWriteIn(issue.projectId)
  // ID-ul de acum, nu cel de la montare: un tichet creat offline primește
  // numărul real cu foaia deschisă (`renameIssueId`), iar cheia nu se schimbă.
  const idRef = useRef(issue.id)
  idRef.current = issue.id
  const holdTitle = useRef(false)
  const [normalize] = useState(() => normalizeWith(() => holdTitle.current))
  const a = useAutosave(fieldsOf(issue), {
    save: (patch) => updateIssue(idRef.current, patch),
    normalize,
  })
  const d = a.draft
  /**
   * Recunoașterea datei, cu evidențiere și refuz la atingere — același hook ca
   * adăugarea rapidă și formularul complet. Ce era deja în titlu la deschidere
   * pornește refuzat: „Ședință la 17", scris acum o lună, e text.
   */
  const date = useTitleDate(d.title, {
    enabled: canWrite,
    onChange: (title) => a.type({ title }),
    initialRejected: () => dateFragments(issue.title),
  })
  holdTitle.current = date.active
  // Ce s-ar aplica acum: jetonul de dată îl arată dinainte, ca evidențierea.
  const preview = date.active ? mergeTitleDue(d, date.parsed) : null
  /**
   * Titlul fără fragment + scadența îmbinată, într-un singur patch. Un titlu
   * care era NUMAI dată („mâine la 9") nu se aplică: ar rămâne un tichet fără
   * titlu, iar `normalize` l-ar fi ținut oricum pe cel vechi.
   */
  const applyDate = () => {
    if (!date.active || !canWrite || !date.title) return
    const m = mergeTitleDue(d, date.parsed)
    holdTitle.current = false
    void a.commit({ title: date.title, dueAt: m.dueAt, allDay: m.allDay, remindAt: m.remindAt, rrule: m.rrule })
  }
  const applyRef = useRef(applyDate)
  applyRef.current = applyDate
  // Închiderea (Back, fundal, Esc) demontează foaia fără blur. Efectul stă DUPĂ
  // `useAutosave`, deci curățenia lui rulează după ultimul flush de acolo —
  // `commit` pornește încă o salvare, iar coada din store le ține în ordine.
  useEffect(() => () => applyRef.current(), [])
  const files = useTicketFiles(issue.id, issue.projectId, showToast)
  const [whenOpen, setWhenOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const dueAnchor = useRef<HTMLElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  // Mutarea cere scriere pe sursă (ținta o filtrează selectorul) și un număr
  // real: `HZ-~…` încă n-a ajuns pe server.
  const canMove = canWrite && !isTempIssueId(issue.id)
  const descRef = useRef<EditorHandle>(null)
  const [descFocus, setDescFocus] = useState(false)
  // Cu tastatura sus (titlu sau descriere în focus) rândul de fir se ascunde:
  // scrii, nu citești, iar spațiul e al textului.
  const [titleFocus, setTitleFocus] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const project = projects.find((p) => p.id === issue.projectId)
  const prefixes = projects.map((p) => p.prefix)
  // `#HZ-12` din descriere: cardul tichetului, dacă e încărcat.
  const openRef = (id: string) => (byId[id] ? pushSheet({ kind: 'issue', issueId: id }) : showToast(`${id} nu e încărcat — deschide-i proiectul.`))

  const toFull = async (at?: 'thread') => {
    // Formularul complet își citește câmpurile din store la montare: ce
    // așteaptă încă pauza trebuie să fi ajuns acolo înainte — inclusiv o
    // dată evidențiată în titlu.
    applyDate()
    if (await a.flush()) expandIssue(at ? { at } : undefined)
  }
  const toggle = () => {
    void a.flush()
    void toggleDone(issue.id)
  }

  const shown = preview ?? d
  const parts = shown.dueAt ? dueLabelParts(shown.dueAt, shown.allDay, new Date()) : null
  const status = !canWrite
    ? 'Doar citire: n-ai drept de scriere în proiectul ăsta.'
    : date.active && !date.title ? 'și ce ai de făcut?'
    : a.status === 'error' ? 'Nu s-a salvat — reîncerc la următoarea modificare.' : ''
  const assignee = issue.assigneeId
    ? assignees.find((x) => x.id === issue.assigneeId)?.name ?? assigneeShort[issue.assigneeId] ?? '?'
    : null

  return (
    <KeyboardSheet onClose={closeSheet} label={`Sarcina ${issue.id}`} className={`edit-sheet ${issue.done ? 'done' : ''}`}>
      <div className="qs-form">
        <div className="es-meta">
          <span>{displayIssueId(issue.id)}</span>
          {/* Fixează sus (`pinnedAt`): pe rândul ID-ului, nu în rândul de
              jetoane — acela e plin la 320px și e despre când/unde, iar
              fixarea e despre locul în listă. Pleacă imediat, ca urgentul. */}
          <button
            type="button"
            className={`es-pin ${d.pinnedAt ? 'on' : ''}`}
            aria-pressed={!!d.pinnedAt}
            aria-label={d.pinnedAt ? 'Scoate de sus' : 'Fixează sus'}
            title={d.pinnedAt ? 'Fixat sus în liste — atinge ca să scoți' : 'Fixează sus în liste'}
            disabled={!canWrite}
            onPointerDown={keepFocus}
            onClick={() => void a.commit(pinPatch(d, new Date()))}
          >
            <Icon name="pin" size={15} />
          </button>
        </div>
        <div className="es-head">
          <button
            type="button"
            className={`es-check ${issue.done ? 'on' : ''}`}
            style={project?.accent ? ({ ['--pc' as string]: project.accent }) : undefined}
            role="checkbox"
            aria-checked={issue.done}
            aria-label={issue.done ? 'Marchează nefăcut' : 'Marchează gata'}
            disabled={!canWrite}
            onPointerDown={keepFocus}
            onClick={toggle}
          >
            <span className={`ck${issue.done ? ' on' : ''}${d.urgent && !issue.done ? ' urg' : ''}`}>
              {issue.done && <Icon name="check" size={13} />}
            </span>
          </button>
          <EditTitle
            date={date}
            value={d.title}
            textareaRef={titleRef}
            readOnly={!canWrite}
            onChange={(title) => a.type({ title })}
            onFocus={() => setTitleFocus(true)}
            onBlur={() => { setTitleFocus(false); applyDate(); void a.flush() }}
            onKeyDown={(e) => {
              // Titlul n-are rânduri: Enter aplică data și trece în descriere.
              if (e.key === 'Enter') { e.preventDefault(); applyDate(); descRef.current?.focus() }
            }}
          />
        </div>
        {/* Sub titlu, nu jos: foaia asta se deschide ca să citești, deci ziua și
            proiectul se văd odată cu titlul, chiar și peste o descriere lungă.
            Jos, cât scrii, e locul barei de formatare („Senin", 2026-10-14). */}
        <div className="qs-bar" ref={barRef}>
          <button
            type="button"
            className={`qs-due ${shown.dueAt ? 'on' : ''} ${preview ? 'pending' : ''}`}
            aria-expanded={whenOpen}
            aria-label={parts ? `Scadența${preview ? ' (din titlu)' : ''}: ${parts.day}${parts.time ? ' ' + parts.time : ''}` : 'Fără dată'}
            disabled={!canWrite}
            onPointerDown={keepFocus}
            onClick={(e) => {
              if (whenOpen) { setWhenOpen(false); return }
              // Deschiderea e un gest de încheiere, ca „…": o dată evidențiată
              // în titlu se aplică acum, ca panoul să arate scadența adevărată.
              applyDate()
              dueAnchor.current = e.currentTarget
              setWhenOpen(true)
            }}
          >
            <Icon name={shown.rrule ? 'recurring' : 'due'} size={15} />
            <span className="qs-due-t">{parts ? parts.day : 'Fără dată'}</span>
            {parts?.time && <span className="qs-due-h">{parts.time}</span>}
          </button>
          {/* Proiectul se schimbă prin MUTARE (număr nou, `move_issue`), nu
              printr-un câmp: jetonul deschide foaia mică de proiecte. Fără
              drept de scriere rămâne doar afișat. */}
          {project && canMove && (
            <button
              type="button"
              className="qs-sel qs-proj tinted"
              title={`${project.name} — mută în alt proiect`}
              aria-label={`Proiect: ${project.name}. Mută în alt proiect`}
              aria-haspopup="dialog"
              style={project.accent ? ({ ['--pc' as string]: project.accent }) : undefined}
              onPointerDown={keepFocus}
              onClick={() => setMoveOpen(true)}
            >
              <ProjectMark project={project} dot="t-dot" />
              <span className="qs-sel-t">{project.name}</span>
            </button>
          )}
          {project && !canMove && (
            <span className="qs-sel qs-proj tinted" title={project.name} style={project.accent ? ({ ['--pc' as string]: project.accent }) : undefined}>
              <ProjectMark project={project} dot="t-dot" />
              <span className="qs-sel-t">{project.name}</span>
            </span>
          )}
          {/* Persoana se vede, nu se alege: pasarea se face din fir
              (`post_to_thread`, în formularul complet), unde un gest scrie și
              comentariul, și pasa. Un select aici ar fi pasat fără niciun
              cuvânt, pe lângă fir. */}
          {assignee && issue.assigneeId && (
            <button
              type="button"
              className="qs-ico qs-who-badge"
              title={`Pasat: ${assignee} — pasarea se schimbă din fir (formularul complet)`}
              aria-label={`Pasat lui ${assignee}; deschide formularul complet`}
              onPointerDown={keepFocus}
              onClick={() => void toFull()}
            >
              {assigneeShort[issue.assigneeId] ?? assignee.slice(0, 2).toUpperCase()}
            </button>
          )}
          {/* Comutatoarele la dreapta, ca în foaia rapidă. */}
          <span className="qs-tools">
            <button
              type="button"
              className={`qs-ico qs-urgent ${d.urgent ? 'on' : ''}`}
              aria-pressed={d.urgent}
              aria-label="Urgent"
              disabled={!canWrite}
              onPointerDown={keepFocus}
              onClick={() => void a.commit({ urgent: !d.urgent })}
            >
              <Icon name="urgent" size={16} />
            </button>
            <AttachButton
              onPick={files.add}
              blocked={() => attachBlocked(issue.id)}
              onBlocked={showToast}
              disabled={!canWrite}
            />
            <button
              type="button"
              className="qs-ico qs-more"
              aria-label="Formularul complet"
              title="Formularul complet: temă, dependențe, val, fir"
              onPointerDown={keepFocus}
              onClick={() => void toFull()}
            >
              <Icon name="more" size={16} />
            </button>
          </span>
        </div>
        <p className={`qs-status ${status ? 'warn' : ''}`} role="status">{status}</p>

        {/* Firul, sub jetoane: numai dacă are ceva, și nu cât scrii. */}
        {!descFocus && !titleFocus && <SheetThreadRow issueId={issue.id} onOpen={() => void toFull('thread')} />}

        <ThumbRow files={files} canDelete={canWrite} onError={showToast} issueId={issue.id} title={d.title} />
        {/* Înălțimea textului, cu plafon de 45% din ecran și „Arată tot"
            (`DescFold`); sub plafon umple în continuare foaia, ca o atingere
            sub text să înceapă scrisul. */}
        <DescFold
          ref={descRef}
          where="viewport"
          className="es-desc"
          value={d.desc}
          readOnly={!canWrite}
          placeholder={canWrite ? 'Adaugă o descriere — cerințe, notițe, context…' : ''}
          ariaLabel="Descrierea sarcinii"
          prefixes={prefixes}
          onRef={openRef}
          onChange={(desc) => a.type({ desc })}
          onCommit={(desc) => void a.commit({ desc })}
          onFocus={() => setDescFocus(true)}
          onBlur={() => { setDescFocus(false); void a.flush() }}
        />

        {descFocus && canWrite && <FormatBar onFormat={(c) => descRef.current?.format(c)} />}
      </div>
      {whenOpen && canWrite && (
        <ChipPop
          anchor={dueAnchor.current}
          rowRef={barRef}
          sheet
          role="dialog"
          label="Scadența"
          className="fc-pop-date es-due-pop"
          onClose={(back) => { setWhenOpen(false); if (back) dueAnchor.current?.focus() }}
        >
          <SheetDue fields={d} commit={(patch) => void a.commit(patch)} />
        </ChipPop>
      )}
      {moveOpen && (
        <MoveProjectSheet
          issue={issue}
          open
          // Ce așteaptă încă pauza (și o dată evidențiată în titlu) pleacă pe
          // ID-ul vechi înainte de mutare; un eșec oprește mutarea.
          prepare={async () => {
            applyDate()
            if (!(await a.flush())) throw new Error('Modificarea de dinainte nu s-a salvat — încearcă din nou.')
          }}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </KeyboardSheet>
  )
}

/**
 * Panoul de dată al foii (D-197): același corp ca popoverul formularului
 * complet (`DuePanel`), ca foaie de jos — nu cele două inputuri native goale,
 * care pe un telefon în engleză arătau `10/16/2026` și `--:-- --`.
 *
 * Fiecare alegere pleacă imediat, ca orice jeton al foii (autosave: numai
 * câmpurile schimbate). Mutarea trece prin `reschedule`, deci mementoul își
 * păstrează decalajul; `rrule` rămâne neatins, iar triggerul face restul:
 * ziua mută doar apariția, ora mută seria.
 *
 * Ziua și ora se aleg din calendarul / ceasul sistemului (butoanele panoului),
 * nu se scriu; ✕ de lângă oră o scoate (toată ziua).
 */
function SheetDue({ fields: d, commit }: { fields: EditFields; commit(patch: Partial<EditFields>): void }) {
  const curDate = d.dueAt ? toDateInput(d.dueAt) : ''
  const curTime = d.dueAt && !d.allDay ? toTimeInput(d.dueAt) : ''
  const move = (date: string, time: string) => {
    if (date === curDate && time === curTime) return
    commit(reschedule(d, fromInputs(date, time)))
  }
  const now = new Date()
  return (
    <DuePanel
      now={now}
      dueDate={curDate}
      dueTime={curTime}
      onPreset={(day) => move(toDateInput(day.toISOString()), curTime)}
      onPickDate={(v) => move(v, curTime)}
      onPickTime={(v) => move(curDate || toDateInput(now.toISOString()), v)}
      onClearTime={() => move(curDate, '')}
      onClear={() => commit(reschedule(d, { dueAt: null, allDay: true }))}
      reminder={reminderKindOf(d.dueAt, d.remindAt)}
      onReminder={(kind) => commit({ remindAt: reminderAt(d.dueAt, kind) })}
      rrule={d.dueAt ? d.rrule : null}
      onClearRrule={() => commit({ rrule: null })}
    />
  )
}

/**
 * Titlul foii de tichet: un `<textarea>` transparent peste o oglindă care
 * desenează fragmentul de dată — tiparul `sh-title-mirror` din formularul
 * complet, nu `QuickTitle`: acela e un `<input>` de un rând, iar aici titlul
 * se rupe pe rânduri. Ambele straturi au `pre-wrap` și aceeași mărime de
 * literă (`.es-title-wrap` în CSS); orice diferență decalează marcajul.
 */
function EditTitle({ date, value, textareaRef, readOnly, onChange, onFocus, onBlur, onKeyDown }: {
  date: TitleDate
  value: string
  textareaRef: RefObject<HTMLTextAreaElement>
  readOnly: boolean
  onChange(next: string): void
  onFocus(): void
  onBlur(): void
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void
}) {
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el || (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content'))) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, textareaRef])
  return (
    <span
      className={`es-title-wrap ${date.onDate ? 'on-date' : ''}`}
      title={date.onDate ? 'Nu e o dată — atinge ca să rămână text în titlu' : undefined}
    >
      <span className="es-title-mirror" ref={date.mirrorRef} aria-hidden="true">
        {date.pieces.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
      </span>
      <textarea
        ref={textareaRef}
        className="es-title"
        rows={1}
        value={value}
        placeholder="Titlu"
        aria-label="Titlul sarcinii"
        readOnly={readOnly}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        // O atingere PE fragmentul evidențiat înseamnă „nu e o dată".
        {...date.inputProps}
      />
    </span>
  )
}
