import { useMemo, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useCanWrite, useHideDone, useNarrow } from '../hooks'
import { Icon } from './Icon'
import { ChipPop } from './ChipPop'
import { SplitView } from './SplitView'
import { WaveGrid } from './WaveGrid'
import { displayIssueId } from '../lib/issueId'
import { naturalCompare } from '../lib/waveGrid'

/**
 * Modul „× Valuri” (H-13) e ținut pe DISPOZITIV: o ședință de triere se
 * reîncarcă (un build nou aplicat la revenirea în tab) fără să piardă tabelul.
 */
const GRID_KEY = 'horizontal:themes-grid'
const readGrid = () => { try { return localStorage.getItem(GRID_KEY) === '1' } catch { return false } }

export function ThemesView() {
  const { themes: rawThemes, issues, stateOf, project } = useHorizontal()
  const { openIssue, openThemeManage, dockedIssueId, closeSheet } = useUI()
  const canWrite = useCanWrite()
  const narrow = useNarrow()
  const [active, setActive] = useState<string>('all')
  const [gridOn, setGridOn] = useState(readGrid)
  const [hideDone, toggleHideDone] = useHideDone()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // Ordinea naturală a numelor („Pasul 2” înaintea lui „Pasul 10”), și în jetoane, și în grupuri.
  const themes = useMemo(() => [...rawThemes].sort((a, b) => naturalCompare(a.name, b.name)), [rawThemes])

  const setGrid = (on: boolean) => {
    // Tichetul docat ar sări ca modal peste lista temelor (panoul pleacă odată cu tabelul).
    if (!on && dockedIssueId && !closeSheet()) return
    setGridOn(on)
    try { localStorage.setItem(GRID_KEY, on ? '1' : '0') } catch { /* fără stocare: doar sesiunea */ }
  }
  const grid = gridOn && !narrow

  const chips = (
    <div className="chips">
      <button className={`chip ${active === 'all' ? 'on' : ''}`} onClick={() => setActive('all')}>
        Toate
      </button>
      {themes.map((t) => (
        <button key={t.key} className={`chip ${active === t.key ? 'on' : ''}`} onClick={() => setActive(t.key)}>
          <span className="cdot" style={{ background: t.color }} />
          {t.name}
        </button>
      ))}
      {canWrite && (
        <button className="chip add" onClick={openThemeManage}>
          <Icon name="settings" size={14} /> Gestionează
        </button>
      )}
    </div>
  )

  const bar = (
    <div className="wg-bar">
      {chips}
      {!narrow && (grid ? (
        <>
          <button type="button" className="wb-mode" onClick={() => setGrid(false)} title="Înapoi la lista temelor" aria-label="Oprește modul Valuri">
            <Icon name="waveGrid" size={14} />
            <span>Valuri</span>
            <span className="x" aria-hidden="true"><Icon name="close" size={12} /></span>
          </button>
          <GridMenu
            hideDone={hideDone}
            onToggleHideDone={toggleHideDone}
            onExpandAll={() => setCollapsed(new Set())}
            onCollapseAll={() => setCollapsed(new Set([...themes.map((t) => t.key), '']))}
            canWrite={canWrite}
          />
        </>
      ) : (
        <button type="button" className="chip wg-toggle" onClick={() => setGrid(true)} title="Teme pe rânduri, valuri pe coloane">
          <Icon name="waveGrid" size={14} /> Valuri
        </button>
      ))}
    </div>
  )

  if (grid) {
    return (
      // Panoul numai dacă lângă el încap titlul și măcar patru coloane de val
      // (`--wg-tmin` docat + 4 × `--wg-col`); altfel tichetul se deschide modal.
      <SplitView dockMinWidth={260 + 4 * 64} resizeKey="horizontal:themes-pane-w">
        <div className="panel wg-panel" style={project?.accent ? ({ ['--pc' as string]: project.accent }) : undefined}>
          {bar}
          <WaveGrid
            filter={active}
            hideDone={hideDone}
            collapsed={collapsed}
            onToggleGroup={(key) => setCollapsed((c) => {
              const n = new Set(c)
              if (n.has(key)) n.delete(key)
              else n.add(key)
              return n
            })}
          />
        </div>
      </SplitView>
    )
  }

  // "all" shows every theme group plus an "Fără temă" bucket for untagged issues.
  const groups: { key: string; name: string; color: string }[] =
    active === 'all'
      ? [...themes.map((t) => ({ key: t.key, name: t.name, color: t.color }))]
      : themes.filter((t) => t.key === active).map((t) => ({ key: t.key, name: t.name, color: t.color }))

  const untagged = issues.filter((i) => !i.theme || !themes.some((t) => t.key === i.theme))
  const showUntagged = active === 'all' && untagged.length > 0

  return (
    <div className="panel">
      {bar}
      {themes.length === 0 && (
        <p className="empty">
          {canWrite ? 'Nicio temă încă. Apasă „Gestionează" ca să adaugi.' : 'Nicio temă încă.'}
        </p>
      )}

      {groups.map((g) => {
        const list = issues.filter((i) => i.theme === g.key)
        if (list.length === 0 && active === 'all') return null
        return (
          <div key={g.key}>
            <div className="layer-head" style={{ margin: '18px 0 10px' }}>
              <span className="theme-dot" style={{ width: 10, height: 10, background: g.color }} />
              <h4 style={{ fontSize: 'calc(13px * var(--text-scale))' }}>{g.name}</h4>
              <div className="sub" style={{ marginLeft: 'auto' }}>
                {list.length} tichete
              </div>
            </div>
            {list.length === 0 ? (
              <p className="empty" style={{ padding: '8px 0' }}>Niciun tichet pe tema asta.</p>
            ) : (
              list.map((it) => <ThemeIssueRow key={it.id} id={it.id} color={g.color} />)
            )}
          </div>
        )
      })}

      {showUntagged && (
        <div>
          <div className="layer-head" style={{ margin: '18px 0 10px' }}>
            <span className="theme-dot" style={{ width: 10, height: 10, background: 'var(--txt-faint)' }} />
            <h4 style={{ fontSize: 'calc(13px * var(--text-scale))' }}>Fără temă</h4>
            <div className="sub" style={{ marginLeft: 'auto' }}>{untagged.length} tichete</div>
          </div>
          {untagged.map((it) => (
            <button key={it.id} className={`tk ${stateOf(it.id)}`} onClick={() => openIssue(it.id)}>
              <span className="check"><Icon name={it.done ? 'done' : 'notDone'} size={16} /></span>
              <span className="tk-body">
                <span className="tk-top">
                  <span className="tk-id">{displayIssueId(it.id)}</span>
                </span>
                <h5>{it.title}</h5>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeIssueRow({ id, color }: { id: string; color: string }) {
  const { byId, stateOf } = useHorizontal()
  const { openIssue } = useUI()
  const it = byId[id]
  if (!it) return null
  return (
    <button className={`tk ${stateOf(id)}`} onClick={() => openIssue(id)}>
      <span className="check"><Icon name={it.done ? 'done' : 'notDone'} size={16} /></span>
      <span className="tk-body">
        <span className="tk-top">
          <span className="theme-dot" style={{ background: color }} />
          <span className="tk-id">{displayIssueId(id)}</span>
        </span>
        <h5>{it.title}</h5>
      </span>
    </button>
  )
}

/** „⋯ Vizualizare” al modului „× Valuri”: bifatele, temele strânse, valurile. */
function GridMenu({ hideDone, onToggleHideDone, onExpandAll, onCollapseAll, canWrite }: {
  hideDone: boolean
  onToggleHideDone(): void
  onExpandAll(): void
  onCollapseAll(): void
  canWrite: boolean
}) {
  const { openWaveManage } = useUI()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) btnRef.current?.focus()
  }
  return (
    <span className="wb-more-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`wb-more${open ? ' on' : ''}`}
        aria-label="Vizualizare"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Vizualizare"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <ChipPop anchor={btnRef.current} rowRef={wrapRef} sheet={false} role="menu" label="Vizualizare" align="end" className="wb-menu" onClose={close}>
          <div className="fc-h">Vizualizare</div>
          <button type="button" role="menuitemcheckbox" aria-checked={hideDone} className={`fc-mi${hideDone ? ' on' : ''}`} onClick={onToggleHideDone}>
            <Icon name="hide" size={16} /><span className="fc-mi-t">Ascunde bifatele</span>
            <span className={`wb-tgl${hideDone ? ' on' : ''}`} aria-hidden="true" />
          </button>
          <div className="wb-hr" role="separator" />
          <button type="button" role="menuitem" className="fc-mi" onClick={() => { onExpandAll(); close(false) }}>
            <Icon name="expand" size={16} /><span className="fc-mi-t">Desfă toate temele</span>
          </button>
          <button type="button" role="menuitem" className="fc-mi" onClick={() => { onCollapseAll(); close(false) }}>
            <Icon name="collapse" size={16} /><span className="fc-mi-t">Strânge toate temele</span>
          </button>
          {canWrite && (
            <>
              <div className="wb-hr" role="separator" />
              <button type="button" role="menuitem" className="fc-mi" onClick={() => { close(false); openWaveManage() }}>
                <Icon name="settings" size={16} /><span className="fc-mi-t">Gestionează valurile…</span>
              </button>
            </>
          )}
        </ChipPop>
      )}
    </span>
  )
}
