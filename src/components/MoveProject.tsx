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
 * `#proiect` scris în titlul unui tichet existent (`titleProjectToken`): unde
 * se mută la salvare, sau de ce nu se poate (`refusal`). Dependențele și
 * obstacolele se știu doar pentru proiectul încărcat; altfel răspunde serverul.
 */
export function useTitleMove(issue: Issue | undefined, targetId: string | null): { name: string; refusal: string | null } | null {
  const { projects, project, issues, obstacleLinks } = useHorizontal()
  const canWrite = useCanWriteFn()
  if (!issue || !targetId) return null
  const target = projects.find((p) => p.id === targetId)
  if (!target) return null
  const loaded = project?.id === issue.projectId
  const block = moveBlock(issue, loaded ? issues : [], loaded ? obstacleLinks : [])
  const refusal = block
    ? moveBlockMessage(issue.id, block)
    : moveTargets(projects, issue.projectId, canWrite).some((p) => p.id === targetId)
      ? null
      : `Nu poți scrie în ${target.name}.`
  return { name: target.name, refusal }
}

/** Indiciul din rândul de jetoane: „se mută în X la salvare", sau refuzul. */
export function TitleMoveHint({ name, refusal }: { name: string; refusal: string | null }) {
  if (refusal) return <span className="fc-hint warn" role="alert">#{name}: {refusal}</span>
  return (
    <span className="fc-hint mv-title" title="Tichetul primește număr nou în proiectul țintă">
      <Icon name="fromTitle" size={13} /> se mută în {name} la salvare
    </span>
  )
}
