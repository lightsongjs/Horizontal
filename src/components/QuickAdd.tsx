import { useEffect, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { useQuickDraft } from '../hooks'
import { fromInputs, toDateInput } from '../lib/schedule'
import { describeRrule } from '../lib/recurrence'
import { dueLabel, dueLabelParts, quickKey } from '../lib/quickDraft'
import { loadBarDraft, saveBarDraft, type BarDraft } from '../lib/barDraft'
import { Icon } from './Icon'
import { QuickDesc, QuickTitle } from './QuickFields'
import { ProjectMark } from './ProjectMark'
import { QuickDue } from './QuickDue'

interface Props {
  /** Scadența implicită când textul nu conține niciuna (ziua listei deschise). */
  /** Ziua unei capturi fără dată în text; null = fără scadență. */
  defaultDueAt: string | null
  onAdded?(): void
  /** Se schimbă la fiecare cerere de focus din afară (tasta C). */
  focusSignal?: number
  /**
   * Bara de captură (Linux): rândul foii rapide sub titlu — inelul în culoarea
   * proiectului, jetonul de dată cu panoul inline, proiectul, urgent, Trimite.
   */
  rich?: boolean
  /**
   * Bara de captură: ciorna (text, descriere, alegeri de mână, refuzuri) se
   * păstrează peste ascunderi și reîncărcări (`lib/barDraft.ts`), iar
   * `focusSignal` readuce cursorul în câmpul unde era, la sfârșit.
   */
  keepDraft?: boolean
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
export function QuickAdd({ defaultDueAt, onAdded, focusSignal = 0, rich = false, keepDraft = false }: Props) {
  const { assignees, assigneeShort } = useHorizontal()
  // O singură citire, la montare: de aici încolo starea React e adevărul, iar
  // stocarea doar o oglindește (efectul de mai jos).
  const [saved] = useState<BarDraft | null>(() => (keepDraft ? loadBarDraft() : null))
  const q = useQuickDraft({
    ctx: { mode: 'list', defaultDueAt },
    // `#proiect @om !` peste tot unde se capturează (cu lista de sugestii), și în rândul din listă.
    tokens: true,
    initial: saved ?? undefined,
  })
  const { text, desc, date, tokens, project, projects, schedule, error, saving, assigneeId, urgent } = q
  const [focus, setFocus] = useState(false)
  const [descOpen, setDescOpen] = useState(saved?.descOpen ?? false)
  const [descFocus, setDescFocus] = useState(false)
  const [field, setField] = useState<'title' | 'desc'>(saved?.field ?? 'title')
  const inputRef = useRef<HTMLInputElement>(null)
  /** Bara: panoul datei (`QuickDue`), inline deasupra rândului de jetoane. */
  const [whenOpen, setWhenOpen] = useState(false)
  const descRef = useRef<HTMLTextAreaElement>(null)

  const liveKey = q.date.live.join('\u0001')
  useEffect(() => {
    if (!keepDraft) return
    saveBarDraft({ text, desc, descOpen, manual: q.manual, rejected: q.date.live, field })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepDraft, text, desc, descOpen, q.manual, liveKey, field])

  // Focus cerut din afară (tasta C). Reținem valoarea de la montare
  // și focusăm numai când se SCHIMBĂ față de ea — nu la montare.
  //
  // Altfel: contorul din `Shell` rămâne ≥1 după primul „C", deci fiecare
  // revenire pe listă remonta componenta cu un semnal deja pozitiv și ridica
  // tastatura nechemată. Deschiderea unei liste nu e o cerere de a scrie.
  //
  // Cererea rămâne în așteptare dacă câmpul încă nu există (proiectele sosesc
  // după primul cadru, iar până atunci se randează doar notița).
  const signalAtMount = useRef(focusSignal)
  const focusPending = useRef(false)
  const hasField = !!q.project
  useEffect(() => {
    if (focusSignal !== signalAtMount.current) {
      signalAtMount.current = focusSignal
      focusPending.current = true
    }
    if (!focusPending.current || !inputRef.current) return
    focusPending.current = false
    if (!keepDraft) { inputRef.current.focus(); return }
    // Bara: înapoi unde era cursorul, la sfârșit, fără selecție — omul revine
    // ca să lipească în continuare, iar o selecție ar fi înlocuit textul.
    const id = requestAnimationFrame(() => {
      const el = (field === 'desc' && descRef.current) || inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal, hasField])

  const useParsed = date.active
  const { dueAt, allDay } = schedule
  // Calculat o singură dată — nu de două ori în JSX (condiție + text).
  const recur = schedule.rrule ? describeRrule(schedule.rrule) : ''
  const bare = error === 'bare'

  const reset = () => { q.reset(); setDescOpen(false); setWhenOpen(false) }

  // Bara: Esc are doi pași. Cât panoul datei e deschis, Esc îl închide DOAR pe
  // el (tiparul `ChipPop`: în captură, cu `stopPropagation`) — altfel ar ajunge
  // la ascultătorul din `QuickAddPage`, care golește ciorna și ascunde bara.
  // Alt+D îl deschide / închide din tastatură, fără să părăsească titlul.
  useEffect(() => {
    if (!rich) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && whenOpen) {
        e.preventDefault()
        e.stopPropagation()
        setWhenOpen(false)
        inputRef.current?.focus()
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyD') {
        e.preventDefault()
        e.stopPropagation()
        setWhenOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rich, whenOpen])

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
    setWhenOpen(false)
    setField('title')
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

  if (rich) {
    const parts = dueAt ? dueLabelParts(dueAt, allDay, new Date()) : null
    const warn = tokens?.unknown.length ? `nu știu ${tokens.unknown.join(', ')}` : bare ? 'și ce ai de făcut?' : null
    const chosenProject = !!(q.manual.projectId || tokens?.projectId)
    const who = assigneeId ? assignees.find((a) => a.id === assigneeId)?.name ?? '' : ''
    const toTitleEnd = () => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    return (
      <div
        className={`qa qa-bar ${focus ? 'focus' : ''} ${q.shake ? 'shake' : ''}`}
        style={project.accent ? ({ ['--pc' as string]: project.accent }) : undefined}
      >
        <form className="qa-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <div className="qa-row">
            {/* Bifa în culoarea proiectului, ca rândul în care va ajunge sarcina;
                urgentul = inelul chihlimbar. Numai desen: nu e nimic de bifat. */}
            <span className={`ck${urgent ? ' urg' : ''}`} aria-hidden="true" />
            <QuickTitle
              date={date}
              text={text}
              onText={q.setText}
              inputRef={inputRef}
              placeholder="Ce ai de făcut? încearcă „mâine la 9” · #proiect · @om · !"
              enterKeyHint="done"
              tipBelow
              onFocus={() => { setFocus(true); setField('title') }}
              onBlur={() => setFocus(false)}
              onKeyDown={onKey('title')}
              suggestions={{ projects, people: assignees, placement: 'flow' }}
            />
          </div>

          {descOpen && (
            <div className="qa-desc-row">
              <QuickDesc
                value={desc}
                onChange={q.setDesc}
                textareaRef={descRef}
                onKeyDown={onKey('desc')}
                onFocus={() => { setFocus(true); setDescFocus(true); setField('desc') }}
                onBlur={() => { setFocus(false); setDescFocus(false) }}
              />
            </div>
          )}

          {/* Data se alege din panoul formularului (`DuePanel`), inline: fereastra
              crește în jos (`resizeBar`), fiindcă un popover ar ieși din ea. */}
          {whenOpen && (
            <QuickDue
              dueAt={dueAt}
              allDay={allDay}
              fallbackDay={toDateInput(new Date().toISOString())}
              onDue={(d, t) => q.setManual((m) => ({ ...m, due: fromInputs(d, t) }))}
              onPicked={toTitleEnd}
              onClear={() => q.setManual((m) => ({ ...m, due: { dueAt: null, allDay: true } }))}
            />
          )}

          {/* Rândul foii rapide („Ordinea rândului”): jetoanele cu text la stânga,
              comutatoarele lângă Trimite. Fără agrafă (decizia omului): bara
              capturează un gând, nu fișiere. Persoana nu are jeton — `@nume`. */}
          <div className="qs-bar">
            <span className={`qs-due${dueAt ? ' on' : ''}${whenOpen ? ' open' : ''}`}>
              <button
                type="button"
                className="qs-due-btn"
                aria-expanded={whenOpen}
                title={`Data și ora (Alt+D, sau „mâine la 10” în text)${recur ? ` · ${recur}` : ''}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setWhenOpen((v) => !v)}
              >
                <Icon name={recur ? 'recurring' : 'due'} size={15} />
                <span className="qs-due-t">{parts ? parts.day : 'Dată'}</span>
                {parts?.time && <span className="qs-due-h">{parts.time}</span>}
                {parts?.time && <Icon name="reminder" size={13} />}
              </button>
              {useParsed && (
                <button
                  type="button"
                  className="qs-due-x"
                  title="Nu e o dată — lasă textul în titlu"
                  aria-label="Respinge data recunoscută"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={rejectDate}
                >
                  <Icon name="close" size={13} />
                </button>
              )}
            </span>
            <label
              className={`qs-sel qs-proj${chosenProject ? ' tinted' : ''}`}
              title="Proiectul sarcinii (sau #nume în text)"
            >
              <ProjectMark project={project} dot="t-dot" />
              <span className="qs-sel-t">{project.name}</span>
              <select
                aria-label="Proiectul"
                value={project.id}
                onChange={(e) => { q.pickProject(e.target.value); toTitleEnd() }}
              >
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {assigneeId && (
              <span className="qs-who-badge" title={`Pasat: ${who} (din @nume)`}>
                {assigneeShort[assigneeId] ?? who.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="qs-tools">
              <span className={`qa-hint${warn ? ' warn' : ''}`} role="status">
                {warn ?? (saving ? 'se salvează…'
                  : whenOpen ? <><kbd>Esc</kbd> închide panoul</>
                    : descFocus ? <><kbd>Ctrl+↵</kbd> adaugă</>
                      : descOpen ? <><kbd>↵</kbd> adaugă</>
                        : text.trim() ? <><kbd>Tab</kbd> descriere · <kbd>↵</kbd> adaugă</>
                          : <><kbd>Esc</kbd> închide</>)}
              </span>
              <button
                type="button"
                className={`qs-ico qs-urgent${urgent ? ' on' : ''}`}
                aria-pressed={urgent}
                aria-label="Urgent"
                title="Urgent (sau ! în text)"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => q.setManual((m) => ({ ...m, urgent: !urgent }))}
              >
                <Icon name="urgent" size={15} />
              </button>
              <button
                type="submit"
                className="qs-send"
                aria-label="Adaugă"
                title="Adaugă (↵)"
                disabled={text.trim() === '' || saving}
                onPointerDown={(e) => e.preventDefault()}
              >
                <Icon name="send" size={16} />
              </button>
            </span>
          </div>
        </form>
      </div>
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
          onFocus={() => { setFocus(true); setField('title') }}
          onBlur={() => setFocus(false)}
          onKeyDown={onKey('title')}
          suggestions={{ projects, people: assignees, placement: 'below' }}
        />
        {!focus && !text && <kbd className="qa-kbd">C</kbd>}
      </div>

      {descOpen && (
        <div className="qa-desc-row">
          <QuickDesc
            value={desc}
            onChange={q.setDesc}
            textareaRef={descRef}
            onKeyDown={onKey('desc')}
            onFocus={() => { setFocus(true); setDescFocus(true); setField('desc') }}
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

          <label className="qa-proj" title="Proiectul sarcinii">
            <ProjectMark project={project} dot="t-dot" />
            <select
              value={project.id}
              onChange={(e) => q.pickProject(e.target.value)}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

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

      </form>
    </div>
  )
}
