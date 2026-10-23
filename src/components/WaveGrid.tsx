import { useEffect, useMemo, useRef } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useCanWrite } from '../hooks'
import { useTheme } from '../theme'
import { useVimOptional } from '../vim'
import { useTaskActions } from './TaskActions'
import { Icon } from './Icon'
import { displayIssueId } from '../lib/issueId'
import {
  depWarning, edgeWave, gridColumns, gridGroups, openCounts, stepWave, waveTitle, type GridGroup,
} from '../lib/waveGrid'
import type { Wave } from '../lib/types'

/**
 * Modul „× Valuri” din tabul Teme (H-13, macheta `design/valuri/index.html`):
 * tichetele pe rânduri, grupate pe teme, valurile pe coloane. Punctul arată
 * valul tichetului; un clic pe alt cerc îl mută acolo (toast cu „Anulează”,
 * prin `TaskActions`, ca orice mutare din listă).
 *
 * Gramatica de clase e a „Listei” (`.list-group` > `.list-row[data-issue-id]`,
 * `.list-title`), deci cursorul modului Vim, `x`, `dd`, `m`, `f`, selecția
 * și deschiderea în panou merg fără cod nou. În plus doar `h` / `l` / `0` /
 * `$` (contextul `grid` din `keymap.ts`, prin `registerGrid`).
 *
 * Numai pe desktop (≥900px): pe telefon comutatorul nu apare.
 */
export function WaveGrid({ filter, hideDone, collapsed, onToggleGroup }: {
  filter: string
  hideDone: boolean
  collapsed: ReadonlySet<string>
  onToggleGroup(key: string): void
}) {
  const { issues, byId, waves, themes, toggleDone } = useHorizontal()
  const { openEditIssue, dockedIssueId, isDockedDirty, nudgeSave } = useUI()
  const canWrite = useCanWrite()
  const ta = useTaskActions()
  const { vim } = useTheme()

  const cols = useMemo(() => gridColumns(waves), [waves])
  const groups = useMemo(() => gridGroups(themes, issues, { filter, hideDone }), [themes, issues, filter, hideDone])
  // Antetul numără tichetele DESCHISE din ce e pe ecran (filtrul de temă inclus),
  // ca pastilele valurilor: aceeași cifră ca grupurile de dedesubt.
  const headCounts = useMemo(
    () => openCounts(groups.flatMap((g) => g.ids).map((id) => byId[id]).filter((i) => !!i)),
    [groups, byId],
  )

  // `h` / `l` / `0` / `$` din modul Vim: valul în care ajunge tichetul.
  const live = useRef({ cols, byId })
  live.current = { cols, byId }
  const { registerGrid } = useVimOptional()
  useEffect(() => registerGrid((id, where) => {
    const { cols: c, byId: b } = live.current
    const it = b[id]
    if (!it) return null
    const dest = where === 'left' ? stepWave(c, it.wave, -1)
      : where === 'right' ? stepWave(c, it.wave, 1)
        : edgeWave(c, where)
    return dest === null || dest === it.wave ? null : dest
  }), [registerGrid])

  const move = (id: string, wave: number) => {
    const it = byId[id]
    if (!it || it.wave === wave || !canWrite) return
    // Valul e un câmp al formularului: pe tichetul docat murdar, scrierea l-ar
    // remonta și s-ar pierde ce scrii (aceeași regulă ca în dispecer).
    if (dockedIssueId === id && isDockedDirty()) { nudgeSave(); return }
    void ta.run({ kind: 'wave', value: wave }, [id])
  }

  const n = cols.length
  const style = {
    '--wg-n': n,
    // Coloanele cresc cu textul: la ×1,5 etichetele valurilor se tăiau la trei litere.
    '--wg-col': `calc(${n > 5 ? 64 : 84}px * min(var(--text-scale), 1.25))`,
    '--wg-tmin': `${dockedIssueId ? 260 : 440}px`,
  } as React.CSSProperties

  return (
    <div className="wg">
      <div className="wg-scroll" style={style} role="table" aria-label="Tichetele pe valuri">
        <div className="wg-in">
          <div className="wg-r wg-head" role="row">
            <div className="wg-t" role="columnheader">Tichet</div>
            {cols.map((w) => <WaveHead key={w.number} wave={w} count={headCounts.get(w.number) ?? 0} />)}
            <span />
          </div>

          {groups.length === 0 ? (
            <p className="empty wg-empty">
              {filter === 'all' ? 'Niciun tichet în proiect.' : 'Niciun tichet pe tema asta.'}
            </p>
          ) : groups.map((g) => (
            <Group
              key={g.key || '__none__'}
              group={g}
              cols={cols}
              closed={collapsed.has(g.key)}
              onToggle={() => onToggleGroup(g.key)}
            >
              {g.ids.map((id) => {
                const it = byId[id]
                if (!it) return null
                const warn = depWarning(it, byId, cols)
                const warnWave = warn ? cols.find((w) => w.number === warn.wave) : undefined
                const docked = dockedIssueId === id
                return (
                  <div
                    key={id}
                    className={`list-row wg-r wg-row${it.done ? ' done' : ''}${docked ? ' docked' : ''}`}
                    data-issue-id={id}
                    role="row"
                    tabIndex={0}
                    onClick={() => openEditIssue(id)}
                    onKeyDown={(e) => {
                      // Fără modul Vim: Enter pe rândul cu focus îl deschide, ca un buton.
                      if (!vim && e.key === 'Enter' && e.target === e.currentTarget) openEditIssue(id)
                    }}
                    onContextMenu={canWrite && !ta.narrow ? (e) => { e.preventDefault(); ta.openRowMenu(id, { x: e.clientX, y: e.clientY }) } : undefined}
                  >
                    <div className="wg-t" role="rowheader">
                      <span
                        className="list-check"
                        role="checkbox"
                        aria-checked={it.done}
                        aria-label={it.done ? 'Marchează nefăcut' : 'Marchează gata'}
                        onClick={(e) => { e.stopPropagation(); if (canWrite) void toggleDone(id) }}
                      >
                        <span className={`ck${it.done ? ' on' : ''}${it.urgent && !it.done ? ' urg' : ''}`}>
                          {it.done && <Icon name="check" size={12} />}
                        </span>
                      </span>
                      {/* Avertismentul stă SUB titlu: lângă el, în coloana îngustă de
                          lângă panou, strivea titlul la un cuvânt. */}
                      <span className="wg-tx">
                      <span className="list-title wg-title" title={it.title}>{it.title}</span>
                      {warn && (
                        <span
                          className="wg-dep"
                          title={`Depinde de ${displayIssueId(warn.id)} (${byId[warn.id]?.title ?? ''}), care e ${warn.wave === 0 ? 'încă în Notițe' : `în ${warnWave ? waveTitle(warnWave) : 'alt val'}`}`}
                        >
                          <Icon name="depLink" size={13} />
                          cere <b>{displayIssueId(warn.id)}</b> · {warnWave ? waveTitle(warnWave) : '?'}
                        </span>
                      )}
                      </span>
                      <span className="list-id">{displayIssueId(id)}</span>
                    </div>
                    {cols.map((w) => {
                      const on = it.wave === w.number
                      const name = waveTitle(w)
                      return (
                        <button
                          key={w.number}
                          type="button"
                          role="cell"
                          tabIndex={-1}
                          className={`wg-cell${on ? ' on' : ''}${w.number === 0 ? ' notes' : ''}`}
                          aria-pressed={on}
                          aria-label={`${displayIssueId(id)} în ${name}`}
                          title={on ? `În ${name}` : `Mută în ${name}${w.number !== 0 && w.label ? ` · ${w.label}` : ''}`}
                          disabled={!canWrite || it.done}
                          onClick={(e) => { e.stopPropagation(); move(id, w.number) }}
                        >
                          <span className="wg-ring" />
                          <span className="wg-dot" />
                        </button>
                      )
                    })}
                    <span />
                  </div>
                )
              })}
            </Group>
          ))}
        </div>
      </div>
      {/* Lângă panou, rândul de taste s-ar fi rupt pe trei rânduri din înălțimea tabelului. */}
      {vim && !dockedIssueId && (
        <div className="wg-hint" aria-hidden="true">
          <span><kbd>j</kbd><kbd>k</kbd>rând</span>
          <span><kbd>h</kbd><kbd>l</kbd>val anterior / următor</span>
          <span><kbd>0</kbd><kbd>$</kbd>Notițe / ultimul</span>
          <span><kbd>Enter</kbd>deschide</span>
          <span><kbd>x</kbd>gata</span>
          <span><kbd>u</kbd>anulează</span>
        </div>
      )}
    </div>
  )
}

function WaveHead({ wave, count }: { wave: Wave; count: number }) {
  const notes = wave.number === 0
  const title = waveTitle(wave)
  return (
    <div
      className={`wg-wh${notes ? ' notes' : ''}`}
      role="columnheader"
      title={`${title}${!notes && wave.label ? ` · ${wave.label}` : ''} · ${count} deschise`}
    >
      <span className="wg-wn">{title}</span>
      <span className="wg-wl">{notes ? ' ' : wave.label || ' '}</span>
      <span className="wg-wc">{count}</span>
    </div>
  )
}

function Group({ group, cols, closed, onToggle, children }: {
  group: GridGroup
  cols: Wave[]
  closed: boolean
  onToggle(): void
  children: React.ReactNode
}) {
  const { byId } = useHorizontal()
  const issues = group.ids.map((id) => byId[id]).filter((i) => !!i)
  const counts = openCounts(issues)
  const open = issues.filter((i) => !i.done).length
  return (
    <div className={`list-group wg-group${closed ? ' closed' : ''}`} role="rowgroup" style={{ '--tc': group.color } as React.CSSProperties}>
      <div className="wg-r wg-ghead" role="row">
        <div className="wg-t">
          <button
            type="button"
            className="wg-chev"
            aria-expanded={!closed}
            aria-label={`${closed ? 'Desfă' : 'Strânge'} ${group.name}`}
            onClick={onToggle}
          >
            <Icon name="collapse" size={14} />
          </button>
          <span className="wg-tdot" />
          <h4>{group.name}</h4>
          <span className="wg-tot">{open}</span>
        </div>
        {cols.map((w) => {
          const c = counts.get(w.number) ?? 0
          return <div key={w.number} className={`wg-gc${c ? '' : ' z'}`}>{c || '·'}</div>
        })}
        <span />
      </div>
      {!closed && children}
    </div>
  )
}
