import { useEffect, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { useQuickDraft } from '../hooks'
import { fromInputs, toDateInput, toTimeInput } from '../lib/schedule'
import { describeRrule } from '../lib/recurrence'
import { dueLabel, quickKey } from '../lib/quickDraft'
import { Icon } from './Icon'
import { QuickDesc, QuickTitle } from './QuickFields'
import { ProjectMark } from './ProjectMark'

interface Props {
  /** Scadența implicită când textul nu conține niciuna (ziua listei deschise). */
  defaultDueAt: string
  onAdded?(): void
  /** Se schimbă la fiecare cerere de focus din afară (tasta C). */
  focusSignal?: number
  /** Bara de captură: semnele `#proiect`, `@persoană`, `!` în text și rândul de butoane, mereu vizibil. */
  rich?: boolean
}

/**
 * Rândul de adăugare rapidă (desktop) și bara de captură (`rich`). Parsează
 * data din titlu pe măsură ce se scrie și o arată în două locuri: fragmentul
 * recunoscut, evidențiat CHIAR ÎN input printr-un strat-oglindă poziționat
 * identic (`QuickTitle`), și un jeton cu ce a înțeles, cu un × care îl respinge.
 *
 * Fără cele două, un parser bun devine dușman la primul „Întâlnire la Podul 5":
 * userul trebuie să vadă ce s-a interpretat înainte să apese Enter, și să poată
 * spune nu.
 *
 * Tab peste un titlu început deschide descrierea dedesubt; acolo Enter e rând
 * nou, iar Ctrl+Enter salvează (tabelul e `quickKey`). Pe telefon rândul nu se
 * arată: acolo captura e foaia rapidă (`QuickSheet`), peste aceeași stare.
 *
 * Fiecare sarcină are un proiect: fără alegere, Inbox (`captureDefaultProjectId`).
 * Selectorul schimbă doar sarcina în curs — nu ține minte nimic.
 */
export function QuickAdd({ defaultDueAt, onAdded, focusSignal = 0, rich = false }: Props) {
  const { assignees } = useHorizontal()
  const q = useQuickDraft({
    ctx: { mode: 'list', defaultDueAt },
    // `#proiect @om !` peste tot unde se capturează (cu lista de sugestii), și în rândul din listă.
    tokens: true,
  })
  const { text, desc, date, tokens, project, projects, schedule, error, saving, assigneeId, urgent } = q
  const [focus, setFocus] = useState(false)
  const [descOpen, setDescOpen] = useState(false)
  const [descFocus, setDescFocus] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  // Focus cerut din afară (tasta C). Reținem valoarea de la montare
  // și focusăm numai când se SCHIMBĂ față de ea — nu la montare.
  //
  // Altfel: contorul din `Shell` rămâne ≥1 după primul „C", deci fiecare
  // revenire pe listă remonta componenta cu un semnal deja pozitiv și ridica
  // tastatura nechemată. Deschiderea unei liste nu e o cerere de a scrie.
  const signalAtMount = useRef(focusSignal)
  useEffect(() => {
    if (focusSignal === signalAtMount.current) return
    signalAtMount.current = focusSignal
    inputRef.current?.focus()
  }, [focusSignal])

  const useParsed = date.active
  const { dueAt, allDay } = schedule
  // Calculat o singură dată — nu de două ori în JSX (condiție + text).
  const recur = schedule.rrule ? describeRrule(schedule.rrule) : ''
  const bare = error === 'bare'

  const reset = () => { q.reset(); setDescOpen(false) }

  /** „Nu e o dată." Tot ce e evidențiat acum rămâne text în titlu. */
  const rejectDate = () => {
    date.rejectAll()
    const el = inputRef.current
    if (!el) return
    // Cursorul la sfârșit, ca după atingerea pe fragment: refuzul e o comandă,
    // iar de aici se scrie mai departe.
    el.focus()
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length))
  }

  const submit = async () => {
    const created = await q.submit()
    if (!created) return
    setDescOpen(false)
    onAdded?.()
    inputRef.current?.focus()
  }

  const openDesc = () => {
    setDescOpen(true)
    // După randare: textarea abia apare.
    requestAnimationFrame(() => descRef.current?.focus())
  }

  const toTitle = () => {
    if (!desc.trim()) { q.setDesc(''); setDescOpen(false) }
    inputRef.current?.focus()
  }

  const onKey = (field: 'title' | 'desc') => (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const action = quickKey({
      key: e.key,
      shift: e.shiftKey,
      mod: e.ctrlKey || e.metaKey,
      field,
      titleEmpty: text.trim() === '',
      descEmpty: desc === '',
    })
    if (action === 'submit') { e.preventDefault(); void submit() }
    else if (action === 'open-desc') { e.preventDefault(); openDesc() }
    else if (action === 'to-title') { e.preventDefault(); toTitle() }
    else if (e.key === 'Escape' && (text || desc)) { e.preventDefault(); reset(); inputRef.current?.focus() }
  }

  if (!project) {
    // Fie nu există niciun proiect, fie userul e read-only în toate. Ambele
    // înseamnă același lucru aici: nu se poate adăuga nimic.
    return (
      <p className="qa-noproject">
        O sarcină are nevoie de un proiect în care poți scrie.
      </p>
    )
  }

  return (
    <div className={`qa ${focus ? 'focus' : ''} ${q.shake ? 'shake' : ''}`}>
      <form
        className="qa-form"
        autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); void submit() }}
      >
      <div className="qa-row">
        <span className="qa-plus" aria-hidden="true">+</span>
        <QuickTitle
          date={date}
          text={text}
          onText={q.setText}
          inputRef={inputRef}
          placeholder="Adaugă o sarcină… încearcă „mâine la 9”"
          enterKeyHint="done"
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={onKey('title')}
          suggestions={{ projects, people: assignees, placement: rich ? 'flow' : 'below' }}
        />
      </div>

      {descOpen && (
        <div className="qa-desc-row">
          <QuickDesc
            value={desc}
            onChange={q.setDesc}
            textareaRef={descRef}
            onKeyDown={onKey('desc')}
            onFocus={() => { setFocus(true); setDescFocus(true) }}
            onBlur={() => { setFocus(false); setDescFocus(false) }}
          />
        </div>
      )}

      {text.trim() !== '' && (
        <div className="qa-meta">
          {dueAt && (
          <span className="chip date">
            <span className="chip-ico"><Icon name="due" size={13} /></span>
            {dueLabel(dueAt, allDay, new Date())}
            {useParsed && (
              <button
                className="chip-x"
                title="Nu e o dată — lasă textul în titlu"
                aria-label="Respinge data recunoscută"
                onClick={rejectDate}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </span>
          )}

          {dueAt && !allDay && (
            <span className="chip bell">
              <span className="chip-ico"><Icon name="reminder" size={13} /></span> memento la oră
            </span>
          )}

          {/* Prin `describeRrule`, nu pe un `if` care numără tipare: acela era
              tolerabil cu doi tipare cunoscute, dar parserul le știe acum pe
              toate opt din vocabular — un `if` pe `'FREQ=DAILY'` ar minti la
              primul „la 2 zile" sau „lunea și joia". */}
          {recur && (
            <span className="chip"><Icon name="recurring" size={12} /> {recur}</span>
          )}

          {!rich && (
          <label className="qa-proj" title="Proiectul sarcinii">
            <ProjectMark project={project} dot="t-dot" />
            <select
              value={project.id}
              onChange={(e) => q.pickProject(e.target.value)}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          )}

          <span className={`qa-hint ${bare || tokens?.unknown.length ? 'warn' : ''}`}>
            {tokens?.unknown.length ? `nu știu ${tokens.unknown.join(', ')}`
              : bare ? 'și ce ai de făcut?'
                : saving ? 'se salvează…'
                  : descFocus ? <><kbd>Ctrl+↵</kbd> adaugă</>
                    : descOpen ? <><kbd>↵</kbd> adaugă</>
                      : <><kbd>Tab</kbd> descriere · <kbd>↵</kbd> adaugă</>}
          </span>
        </div>
      )}

      {rich && (
        <div className="qa-meta qa-rich">
          <label className="qa-proj" title="Proiectul sarcinii (sau #nume în text)">
            <ProjectMark project={project} dot="t-dot" />
            <select value={project.id} onChange={(e) => q.pickProject(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="qa-who" title="Cui îi pasezi sarcina (sau @nume în text)">
            <Icon name="people" size={13} />
            <select value={assigneeId ?? ''} onChange={(e) => q.setManual((m) => ({ ...m, assigneeId: e.target.value || null }))}>
              <option value="">al meu</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <span className="qa-when" title="Data și ora (sau „mâine la 10” în text)">
            <Icon name="due" size={13} />
            <input
              type="date"
              value={dueAt ? toDateInput(dueAt) : ''}
              onChange={(e) => q.setManual((m) => ({ ...m, due: fromInputs(e.target.value, dueAt && !allDay ? toTimeInput(dueAt) : '') }))}
            />
            <input
              type="time"
              value={dueAt && !allDay ? toTimeInput(dueAt) : ''}
              onChange={(e) => q.setManual((m) => ({ ...m, due: fromInputs(dueAt ? toDateInput(dueAt) : toDateInput(defaultDueAt), e.target.value) }))}
            />
          </span>
          <button
            type="button"
            className={`qa-urgent ${urgent ? 'on' : ''}`}
            aria-pressed={urgent}
            title="Urgent (sau ! în text)"
            onClick={() => q.setManual((m) => ({ ...m, urgent: !urgent }))}
          >
            <Icon name="urgent" size={13} /> urgent
          </button>
        </div>
      )}
      </form>
    </div>
  )
}
