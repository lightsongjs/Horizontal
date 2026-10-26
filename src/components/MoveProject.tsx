import { useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { useCanWriteFn, useMoveIssue } from '../hooks'
import { errorMessage } from '../lib/errorMessage'
import { moveBlock, moveBlockMessage, moveTargets } from '../lib/moveIssue'
import type { Issue } from '../lib/types'
import { ChipPop } from './ChipPop'
import { Icon } from './Icon'
import { KeyboardSheet } from './KeyboardSheet'
import { ProjectMark } from './ProjectMark'

/**
 * Ce arată selectorul de proiect: motivul pentru care nu se poate muta, sau
 * proiectele în care se poate. Dependențele și obstacolele se știu doar pentru
 * proiectul încărcat în store; pentru altul, serverul răspunde la cerere
 * (`move_issue` e sursa de adevăr, `moveBlock` doar spune motivul dinainte).
 */
function useMoveChoice(issue: Issue) {
  const { projects, project, issues, obstacleLinks } = useHorizontal()
  const canWrite = useCanWriteFn()
  const loaded = project?.id === issue.projectId
  const block = moveBlock(issue, loaded ? issues : [], loaded ? obstacleLinks : [])
  return {
    why: block ? moveBlockMessage(issue.id, block) : null,
    targets: moveTargets(projects, issue.projectId, canWrite),
  }
}

/**
 * Lista proiectelor-țintă (Inbox primul) sau motivul refuzului. `menu` = rânduri
 * de popover (`.fc-mi`, formularul complet), `sheet` = rânduri de foaie de
 * acțiuni (`.as-item`, telefon).
 */
export function MoveTargets({ issue, variant, busy, onPick }: {
  issue: Issue
  variant: 'menu' | 'sheet'
  busy: boolean
  onPick(projectId: string): void
}) {
  const { why, targets } = useMoveChoice(issue)
  if (why) return <p className="mv-why">{why}</p>
  if (!targets.length) return <p className="mv-why">Nu ai alt proiect în care să-l muți.</p>
  const item = variant === 'menu' ? 'fc-mi' : 'as-item'
  return (
    <>
      {targets.map((p) => (
        <button
          key={p.id}
          type="button"
          role={variant === 'menu' ? 'menuitem' : undefined}
          className={`${item} mv-item`}
          disabled={busy}
          onClick={() => onPick(p.id)}
        >
          <span className="mv-mark"><ProjectMark project={p} dot="t-dot" /></span>
          <span className="mv-name">{p.name}</span>
        </button>
      ))}
    </>
  )
}

/**
 * Mutarea, cu starea ei: „se mută…", eroarea pe loc (refuzul serverului,
 * offline). `prepare` rulează înainte — foaia de tichet își trimite acolo ce
 * aștepta încă pauza, ca ultima editare să ajungă pe ID-ul vechi ÎNAINTE de
 * mutare, nu după ea.
 */
export function useMoveAction(issue: Issue, opts: { open: boolean; remount?: boolean; prepare?: () => Promise<unknown>; onDone(): void }) {
  const move = useMoveIssue()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pick = async (projectId: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await opts.prepare?.()
      await move(issue.id, projectId, { open: opts.open, remount: opts.remount })
      opts.onDone()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return { busy, error, pick }
}

/**
 * Formularul complet: proiectul, lângă ID, ca jeton care deschide meniul de
 * mutare (`ChipPop` — popover pe desktop, foaie de jos pe telefon). Cu
 * modificări nesalvate meniul nu mută: formularul se remontează pe proiectul
 * nou (valul și tema copiate la montare ar fi mințit), iar ce n-ai salvat s-ar
 * pierde — aceeași plasă ca „Deschide mare".
 */
export function MoveChip({ issue, dirty, narrow }: { issue: Issue; dirty: boolean; narrow: boolean }) {
  const { projects } = useHorizontal()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const { busy, error, pick } = useMoveAction(issue, { open: true, remount: true, onDone: () => setOpen(false) })
  const project = projects.find((p) => p.id === issue.projectId)
  if (!project) return null
  return (
    <span className="sh-move" ref={wrap}>
      <button
        ref={btn}
        type="button"
        tabIndex={-1}
        className={`sh-move-btn${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Proiect: ${project.name}. Mută în alt proiect`}
        title="Mută în alt proiect"
        onClick={() => setOpen((v) => !v)}
      >
        <ProjectMark project={project} dot="t-dot" />
        <span className="sh-move-t">{project.name}</span>
        <Icon name="dropdown" size={12} />
      </button>
      {open && (
        <ChipPop
          anchor={btn.current}
          rowRef={wrap}
          sheet={narrow}
          role="menu"
          label="Mută în proiect"
          className="mv-pop"
          onClose={(returnFocus) => { setOpen(false); if (returnFocus) btn.current?.focus() }}
        >
          <p className="fc-h">Mută în proiect</p>
          {dirty ? (
            <p className="mv-why">Salvează întâi — mutarea nu ia cu ea ce n-ai salvat.</p>
          ) : (
            <>
              {error && <p className="mv-why warn" role="alert">{error}</p>}
              <MoveTargets issue={issue} variant="menu" busy={busy} onPick={(id) => void pick(id)} />
            </>
          )}
        </ChipPop>
      )}
    </span>
  )
}

/**
 * Foaia mică de pe telefon: din jetonul de proiect al foii de tichet și din ⋮
 * al unui rând din liste. O singură sarcină — selecția multiplă nu se mută (v1).
 */
export function MoveProjectSheet({ issue, open, prepare, onClose }: {
  issue: Issue
  /** Tichetul e deschis într-o foaie, care îl urmează pe ID-ul nou. */
  open: boolean
  prepare?: () => Promise<unknown>
  onClose(): void
}) {
  const { busy, error, pick } = useMoveAction(issue, { open, prepare, onDone: onClose })
  return (
    <KeyboardSheet onClose={onClose} label="Mută în proiect" className="action-sheet move-sheet">
      <p className="as-title">Mută <span className="as-subject">{issue.title}</span> în…</p>
      {error && <p className="mv-why warn" role="alert">{error}</p>}
      <div className="as-list mv-list">
        <MoveTargets issue={issue} variant="sheet" busy={busy} onPick={(id) => void pick(id)} />
      </div>
    </KeyboardSheet>
  )
}

/**
 * `#proiect` scris în titlul unui tichet existent (`titleProjectToken`): jetonul
 * „Mută în …" din rândul formularului. Nu mută singur — mutarea schimbă numărul
 * și nu se anulează. Un clic scoate semnul din titlu (scris pe ID-ul vechi,
 * ÎNAINTE de mutare, prin `prepare`) și mută; formularul se remontează pe
 * tichetul nou, din store. Cu alte modificări nesalvate refuză, ca `MoveChip`.
 */
export function TitleMoveChip({ issue, targetId, title, otherDirty }: {
  issue: Issue
  targetId: string
  /** Titlul fără semn. */
  title: string
  otherDirty: boolean
}) {
  const { projects, updateIssue } = useHorizontal()
  const { why, targets } = useMoveChoice(issue)
  const target = targets.find((p) => p.id === targetId)
  const [refused, setRefused] = useState<string | null>(null)
  const { busy, error, pick } = useMoveAction(issue, {
    open: true,
    remount: true,
    prepare: title && title !== issue.title ? () => updateIssue(issue.id, { title }) : undefined,
    onDone: () => {},
  })
  const name = target?.name ?? projects.find((p) => p.id === targetId)?.name
  if (!name) return null
  const onClick = () => {
    if (why) return setRefused(why)
    if (!target) return setRefused(`Nu poți scrie în ${name}.`)
    if (otherDirty) return setRefused('Salvează întâi — mutarea nu ia cu ea ce n-ai salvat.')
    setRefused(null)
    void pick(targetId)
  }
  const msg = refused ?? error
  return (
    <>
      <button
        type="button"
        data-chip=""
        tabIndex={-1}
        className="fc-chip ghost mv-title"
        disabled={busy}
        title={`Scoate #${name} din titlu și mută tichetul (primește număr nou)`}
        onClick={onClick}
      >
        <Icon name="fromTitle" size={14} />
        {busy ? 'Se mută…' : `Mută în ${name}`}
      </button>
      {msg && <span className="fc-hint warn" role="alert">{msg}</span>}
    </>
  )
}
