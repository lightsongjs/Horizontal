import { useRef, useState, type PointerEvent } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useQuickDraft } from '../hooks'
import { dueLabelParts, quickKey, type QuickCtx } from '../lib/quickDraft'
import { fromInputs, toDateInput, toTimeInput } from '../lib/schedule'
import { describeRrule } from '../lib/recurrence'
import { Icon } from './Icon'
import { KeyboardSheet } from './KeyboardSheet'
import { QuickDesc, QuickTitle } from './QuickFields'

/**
 * Un buton din foaie nu ia focusul: titlul îl păstrează, deci tastatura nu
 * cade la fiecare atingere pe urgent, pe dată sau pe trimite. Selecturile și
 * câmpurile de dată native n-au cum — popup-ul lor închide tastatura — de-aia
 * după o schimbare acolo focusul se întoarce pe titlu.
 */
const keepFocus = (e: PointerEvent) => e.preventDefault()

/**
 * Captura de pe telefon: FAB-ul deschide numai foaia asta, deasupra tastaturii
 * — titlu, descriere, un rând de controale și trimite. Aceeași stare ca rândul
 * din „Azi" și bara de captură (`useQuickDraft`), deci textul se înțelege la
 * fel peste tot.
 *
 * După trimitere foaia se închide (o sarcină, un gest), iar confirmarea e
 * Toast-ul aplicației — tastatura a coborât odată cu foaia, deci nu-l mai
 * acoperă. În foaie, `role="status"` rămâne doar pentru ce oprește trimiterea
 * („și ce ai de făcut?", semne necunoscute). Back o închide fără să salveze.
 */
export function QuickSheet({ ctx }: { ctx: QuickCtx }) {
  const { assignees, assigneeShort, project: openProject, selectProject } = useHorizontal()
  const { closeSheet, pushSheet, showToast } = useUI()
  const q = useQuickDraft({ ctx, tokens: true, rememberProject: ctx.mode === 'list' })
  const { text, desc, date, tokens, project, projects, schedule, error, saving, assigneeId, urgent } = q
  const [whenOpen, setWhenOpen] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  const toTitle = () => titleRef.current?.focus()

  const submit = async () => {
    const created = await q.submit()
    if (!created) return
    // Pe calea obișnuită de închidere: efectul de istoric din `App.tsx`
    // desface intrarea foii, deci Back nu mai are ce închide după asta.
    closeSheet()
    showToast(`Adăugat: ${created.title}`)
  }

  /** „…": formularul complet, cu tot ce s-a scris aici — temă, dependențe, val. */
  const toFull = () => {
    if (!project) return
    // Formularul scrie în proiectul DESCHIS din store; cel ales aici poate fi altul.
    if (openProject?.id !== project.id) selectProject(project.id)
    closeSheet()
    pushSheet({
      kind: 'issue-form',
      draft: {
        title: q.title,
        desc,
        projectId: project.id,
        dueAt: schedule.dueAt,
        allDay: schedule.allDay,
        rrule: schedule.rrule,
        urgent,
        assigneeId,
      },
    })
  }

  if (!project) {
    return (
      <KeyboardSheet onClose={closeSheet} label="Sarcină nouă" className="quick-sheet">
        <p className="qa-noproject">O sarcină are nevoie de un proiect în care poți scrie.</p>
      </KeyboardSheet>
    )
  }

  const { dueAt, allDay } = schedule
  const recur = schedule.rrule ? describeRrule(schedule.rrule) : ''
  const parts = dueAt ? dueLabelParts(dueAt, allDay, new Date()) : null
  const warn = tokens?.unknown.length ? `nu știu ${tokens.unknown.join(', ')}` : error === 'bare' ? 'și ce ai de făcut?' : null
  const status = warn ?? (saving ? 'se salvează…' : '')
  const setDue = (date: string, time: string) => {
    q.setManual((m) => ({ ...m, due: fromInputs(date, time) }))
  }
  const fallbackDay = toDateInput(ctx.mode === 'list' ? ctx.defaultDueAt : new Date().toISOString())

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
    else if (action === 'open-desc') { e.preventDefault(); descRef.current?.focus() }
    else if (action === 'to-title') { e.preventDefault(); toTitle() }
  }

  return (
    <KeyboardSheet onClose={closeSheet} label="Sarcină nouă" className={`quick-sheet ${q.shake ? 'shake' : ''}`}>
      <form
        className="qs-form"
        autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); void submit() }}
      >
        <QuickTitle
          date={date}
          text={text}
          onText={q.setText}
          inputRef={titleRef}
          placeholder="Ce ai de făcut?"
          enterKeyHint="send"
          autoFocus
          tipBelow
          onKeyDown={onKey('title')}
        />
        <QuickDesc value={desc} onChange={q.setDesc} textareaRef={descRef} onKeyDown={onKey('desc')} />

        <p className={`qs-status ${warn ? 'warn' : ''}`} role="status">{status}</p>

        {whenOpen && (
          <div className="qs-when">
            <Icon name="due" size={14} />
            <input
              type="date"
              aria-label="Ziua"
              value={dueAt ? toDateInput(dueAt) : ''}
              onChange={(e) => { setDue(e.target.value, dueAt && !allDay ? toTimeInput(dueAt) : ''); toTitle() }}
            />
            <input
              type="time"
              aria-label="Ora"
              value={dueAt && !allDay ? toTimeInput(dueAt) : ''}
              onChange={(e) => { setDue(dueAt ? toDateInput(dueAt) : fallbackDay, e.target.value); toTitle() }}
            />
            {dueAt && (
              <button
                type="button"
                className="qs-clear"
                onPointerDown={keepFocus}
                onClick={() => q.setManual((m) => ({ ...m, due: { dueAt: null, allDay: true } }))}
              >
                fără dată
              </button>
            )}
          </div>
        )}

        <div className="qs-bar">
          <button
            type="button"
            className={`qs-due ${dueAt ? 'on' : ''}`}
            aria-expanded={whenOpen}
            title="Data și ora (sau „mâine la 10” în text)"
            onPointerDown={keepFocus}
            onClick={() => setWhenOpen((v) => !v)}
          >
            <Icon name={recur ? 'recurring' : 'due'} size={15} />
            <span className="qs-due-t">{parts ? parts.day : 'Fără dată'}</span>
            {parts?.time && <span className="qs-due-h">{parts.time}</span>}
          </button>
          <button
            type="button"
            className={`qs-ico qs-urgent ${urgent ? 'on' : ''}`}
            aria-pressed={urgent}
            aria-label="Urgent"
            title="Urgent (sau ! în text)"
            onPointerDown={keepFocus}
            onClick={() => q.setManual((m) => ({ ...m, urgent: !urgent }))}
          >
            <Icon name="urgent" size={16} />
          </button>
          {/* Selectul nativ stă transparent PESTE eticheta desenată: atingerea
              îl deschide, iar lățimea o hotărăște eticheta, care se taie cu
              „…" — nu cea mai lungă opțiune din listă. */}
          <label className="qs-sel qs-proj" title="Proiectul sarcinii (sau #nume în text)">
            <span className="t-dot" style={{ background: project.accent }} />
            <span className="qs-sel-t">{project.name}</span>
            <select
              aria-label="Proiectul"
              value={project.id}
              onChange={(e) => { q.pickProject(e.target.value); toTitle() }}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {/* Numai iconița: numele lua locul proiectului pe un rând de 390px.
              Cine e ales se vede deschizând selectul și în `title`. */}
          <label
            className={`qs-sel qs-who ${assigneeId ? 'on' : ''}`}
            title={assigneeId ? `Pasat: ${assignees.find((a) => a.id === assigneeId)?.name ?? assigneeShort[assigneeId] ?? '?'}` : 'Cui îi pasezi sarcina (sau @nume în text)'}
          >
            <Icon name="people" size={15} />
            <select
              aria-label="Persoana"
              value={assigneeId ?? ''}
              onChange={(e) => { q.setManual((m) => ({ ...m, assigneeId: e.target.value || null })); toTitle() }}
            >
              <option value="">al meu</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="qs-ico qs-more"
            aria-label="Formularul complet"
            title="Formularul complet: temă, dependențe, val"
            onPointerDown={keepFocus}
            onClick={toFull}
          >
            <Icon name="more" size={16} />
          </button>
          <button
            type="submit"
            className="qs-send"
            aria-label="Adaugă"
            disabled={text.trim() === '' || saving}
            onPointerDown={keepFocus}
          >
            <Icon name="send" size={18} />
          </button>
        </div>
      </form>
    </KeyboardSheet>
  )
}
