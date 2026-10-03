import { useRef, useState, type PointerEvent } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useAutosave, useCanWriteIn } from '../hooks'
import type { Normalize } from '../lib/autosave'
import { dueLabelParts } from '../lib/quickDraft'
import { fromInputs, reschedule, toDateInput, toTimeInput } from '../lib/schedule'
import type { Issue } from '../lib/types'
import { Icon } from './Icon'
import { KeyboardSheet } from './KeyboardSheet'
import { QuickDesc } from './QuickFields'

/** Ce se editează din foaie — exact câmpurile pe care le poate trimite. */
type EditFields = {
  title: string
  desc: string
  dueAt: string | null
  allDay: boolean
  remindAt: string | null
  rrule: string | null
  urgent: boolean
  assigneeId: string | null
}

const fieldsOf = (i: Issue): EditFields => ({
  title: i.title,
  desc: i.desc,
  dueAt: i.dueAt,
  allDay: i.allDay,
  remindAt: i.remindAt,
  rrule: i.rrule ?? null,
  urgent: i.urgent,
  assigneeId: i.assigneeId ?? null,
})

/**
 * Titlul se trimite fără spațiile de la capete, iar unul gol nu se trimite
 * deloc: golit din greșeală și lăsat așa, tichetul își păstrează titlul vechi.
 */
const normalize: Normalize<EditFields> = (field, value) => {
  if (field !== 'title') return value
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
  const { byId, dueIssues } = useHorizontal()
  const { closeSheet } = useUI()
  const issue = byId[issueId] ?? dueIssues.find((i) => i.id === issueId)
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
  const { projects, assignees, assigneeShort, updateIssue, toggleDone } = useHorizontal()
  const { closeSheet, expandIssue } = useUI()
  const canWrite = useCanWriteIn(issue.projectId)
  // ID-ul de acum, nu cel de la montare: un tichet creat offline primește
  // numărul real cu foaia deschisă (`renameIssueId`), iar cheia nu se schimbă.
  const idRef = useRef(issue.id)
  idRef.current = issue.id
  const a = useAutosave(fieldsOf(issue), {
    save: (patch) => updateIssue(idRef.current, patch),
    normalize,
  })
  const d = a.draft
  const [whenOpen, setWhenOpen] = useState(false)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const project = projects.find((p) => p.id === issue.projectId)

  const setDue = (date: string, time: string) => {
    void a.commit(reschedule(d, fromInputs(date, time)))
  }
  const toFull = async () => {
    // Formularul complet își citește câmpurile din store la montare: ce
    // așteaptă încă pauza trebuie să fi ajuns acolo înainte.
    if (await a.flush()) expandIssue()
  }
  const toggle = () => {
    void a.flush()
    void toggleDone(issue.id)
  }

  const parts = d.dueAt ? dueLabelParts(d.dueAt, d.allDay, new Date()) : null
  const status = !canWrite
    ? 'Doar citire: n-ai drept de scriere în proiectul ăsta.'
    : a.status === 'error' ? 'Nu s-a salvat — reîncerc la următoarea modificare.' : ''

  return (
    <KeyboardSheet onClose={closeSheet} label={`Sarcina ${issue.id}`} className={`edit-sheet ${issue.done ? 'done' : ''}`}>
      <div className="qs-form">
        <div className="es-head">
          <button
            type="button"
            className={`es-check ${issue.done ? 'on' : ''}`}
            role="checkbox"
            aria-checked={issue.done}
            aria-label={issue.done ? 'Marchează nefăcut' : 'Marchează gata'}
            disabled={!canWrite}
            onPointerDown={keepFocus}
            onClick={toggle}
          >
            <Icon name={issue.done ? 'done' : 'notDone'} size={20} />
          </button>
          <QuickDesc
            className="es-title"
            ariaLabel="Titlul sarcinii"
            placeholder="Titlu"
            value={d.title}
            textareaRef={titleRef}
            readOnly={!canWrite}
            onChange={(title) => a.type({ title })}
            onBlur={() => void a.flush()}
            onKeyDown={(e) => {
              // Titlul n-are rânduri: Enter trece în descriere.
              if (e.key === 'Enter') { e.preventDefault(); descRef.current?.focus() }
            }}
          />
        </div>
        <QuickDesc
          value={d.desc}
          textareaRef={descRef}
          readOnly={!canWrite}
          placeholder={canWrite ? 'Descriere' : ''}
          onChange={(desc) => a.type({ desc })}
          onBlur={() => void a.flush()}
          onKeyDown={() => {}}
        />

        <p className={`qs-status ${status ? 'warn' : ''}`} role="status">{status}</p>

        {whenOpen && canWrite && (
          <div className="qs-when">
            <Icon name="due" size={14} />
            <input
              type="date"
              aria-label="Ziua"
              value={d.dueAt ? toDateInput(d.dueAt) : ''}
              onChange={(e) => setDue(e.target.value, d.dueAt && !d.allDay ? toTimeInput(d.dueAt) : '')}
            />
            <input
              type="time"
              aria-label="Ora"
              value={d.dueAt && !d.allDay ? toTimeInput(d.dueAt) : ''}
              onChange={(e) => setDue(d.dueAt ? toDateInput(d.dueAt) : toDateInput(new Date().toISOString()), e.target.value)}
            />
            {d.dueAt && (
              <button type="button" className="qs-clear" onPointerDown={keepFocus} onClick={() => setDue('', '')}>
                fără dată
              </button>
            )}
          </div>
        )}

        <div className="qs-bar">
          <button
            type="button"
            className={`qs-due ${d.dueAt ? 'on' : ''}`}
            aria-expanded={whenOpen}
            aria-label={parts ? `Scadența: ${parts.day}${parts.time ? ' ' + parts.time : ''}` : 'Fără dată'}
            disabled={!canWrite}
            onPointerDown={keepFocus}
            onClick={() => setWhenOpen((v) => !v)}
          >
            <Icon name={d.rrule ? 'recurring' : 'due'} size={15} />
            <span className="qs-due-t">{parts ? parts.day : 'Fără dată'}</span>
            {parts?.time && <span className="qs-due-h">{parts.time}</span>}
          </button>
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
          {/* Proiectul unui tichet existent nu se schimbă: ID-ul îi poartă
              prefixul, iar valul și dependențele sunt ale proiectului. */}
          {project && (
            <span className="qs-sel qs-proj" title={project.name}>
              <span className="t-dot" style={{ background: project.accent }} />
              <span className="qs-sel-t">{project.name}</span>
            </span>
          )}
          <label
            className={`qs-sel qs-who ${d.assigneeId ? 'on' : ''}`}
            title={d.assigneeId ? `Pasat: ${assignees.find((x) => x.id === d.assigneeId)?.name ?? assigneeShort[d.assigneeId] ?? '?'}` : 'Al creatorului — atinge ca să pasezi'}
          >
            <Icon name="people" size={15} />
            <select
              aria-label="Persoana"
              value={d.assigneeId ?? ''}
              disabled={!canWrite}
              onChange={(e) => void a.commit({ assigneeId: e.target.value || null })}
            >
              <option value="">al creatorului</option>
              {assignees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
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
        </div>
      </div>
    </KeyboardSheet>
  )
}
