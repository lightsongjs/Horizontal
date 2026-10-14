import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { useCanWrite, useLongPress, useMediaQuery, shouldIgnoreKey } from '../hooks'
import {
  deliveryWaves, openCounts, pillText, showWaveBand, stepWave, totalCounts, waveTitle, SCRATCH,
} from '../lib/waveBar'
import type { Wave } from '../lib/types'
import { ChipPop } from './ChipPop'
import { Icon } from './Icon'
import { TabsSlot } from './tabsSlot'

/** Filtrul „Al cui" din „Listă": `null` = toți, `'none'` = nepasate, altfel un om. */
export type WhoKey = string | 'none' | null

export interface WhoFilter {
  value: WhoKey
  options: { key: WhoKey; label: string; count: number }[]
  onChange(k: WhoKey): void
}

/** Modurile vizualizării — stare a lui `OrdineView`/`ListView`, arătată aici. */
export interface ViewModes {
  tree: boolean
  onToggleTree(): void
  hideDone: boolean
  onToggleHideDone(): void
  selectMode: boolean
  onEnterSelect(): void
  onExitSelect(): void
  /** Doar în „Listă" și doar dacă proiectul are oameni (poarta din `ListView`). */
  who?: WhoFilter | null
}

/**
 * Banda de valuri: [Notițe N] [pastilele valurilor] [+] [moduri ✕] … [⋯].
 *
 * Pastila arată ETICHETA valului și numărul de tichete DESCHISE; cifra romană
 * (numele) e în tooltip și în foaia „Valuri". Sub 900px banda derulează
 * orizontal (estompare la capătul spre care mai sunt valuri, valul activ adus
 * în cadru); peste, se rupe pe rânduri, ca toate valurile să fie la un click.
 *
 * Cu un singur val de livrare (sau niciunul) n-ai între ce comuta: banda nu
 * se randează, iar Notițele și „⋯" urcă în rândul de taburi (`TabsSlot`).
 * Regulile pure: `lib/waveBar.ts`.
 */
export function WaveTabs({ onWaveChange, modes }: { onWaveChange?: () => void; modes: ViewModes }) {
  const { waves, issues, activeWave, setActiveWave } = useHorizontal()
  const { openWaveManage, sheet, dockedIssueId } = useUI()
  const canWrite = useCanWrite()
  const narrow = useMediaQuery('(max-width: 899px)')
  const slot = useContext(TabsSlot)
  const modalOpen = sheet.kind !== 'none' && !dockedIssueId

  const delivery = useMemo(() => deliveryWaves(waves), [waves])
  const scratch = waves.find((w) => w.number === SCRATCH) ?? null
  const band = showWaveBand(waves)
  const open = useMemo(() => openCounts(issues), [issues])
  const total = useMemo(() => totalCounts(issues), [issues])

  const choose = (n: number) => {
    if (n === activeWave) return
    setActiveWave(n)
    onWaveChange?.()
  }
  const chooseRef = useRef(choose)
  chooseRef.current = choose

  // `,` / `.` = valul anterior / următor, `V` = foaia „Valuri". Libere (vezi
  // `InfoPanel`); aceleași gărzi ca T și hjkl: nu în câmpuri, nu peste un modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreKey(e, modalOpen)) return
      if (e.key === ',' || e.key === '.') {
        const next = stepWave(waves, activeWave, e.key === ',' ? -1 : 1)
        e.preventDefault()
        if (next !== null) chooseRef.current(next)
      } else if ((e.key === 'v' || e.key === 'V') && canWrite) {
        e.preventDefault()
        openWaveManage()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [waves, activeWave, modalOpen, canWrite, openWaveManage])

  const chips = <ModeChips modes={modes} />
  const more = <MoreMenu modes={modes} band={band} narrow={narrow} canWrite={canWrite} />

  if (!band) {
    // Cu un singur val, Notițele sunt un comutator: a doua atingere te întoarce
    // pe val — n-are altă pastilă pe care să apeși.
    const only = delivery[0]
    const tools = (
      <span className="wb-tools">
        {scratch && (
          <ScratchPill
            wave={scratch}
            count={open.get(SCRATCH) ?? 0}
            total={total.get(SCRATCH) ?? 0}
            on={activeWave === SCRATCH}
            onClick={() => choose(activeWave === SCRATCH && only ? only.number : SCRATCH)}
          />
        )}
        {chips}
        {more}
      </span>
    )
    return slot ? createPortal(tools, slot) : <div className="wave-band solo">{tools}</div>
  }

  return (
    <Band
      scratch={scratch}
      delivery={delivery}
      activeWave={activeWave}
      open={open}
      total={total}
      narrow={narrow}
      canWrite={canWrite}
      onChoose={choose}
      onManage={openWaveManage}
      chips={chips}
      more={more}
    />
  )
}

function Band({
  scratch, delivery, activeWave, open, total, narrow, canWrite, onChoose, onManage, chips, more,
}: {
  scratch: Wave | null
  delivery: Wave[]
  activeWave: number
  open: Map<number, number>
  total: Map<number, number>
  narrow: boolean
  canWrite: boolean
  onChoose(n: number): void
  onManage(focus?: number | 'new'): void
  chips: ReactNode
  more: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ l: false, r: false })

  // Estomparea arată în ce parte mai sunt valuri — doar unde banda derulează.
  const measure = () => {
    const el = scrollRef.current
    if (!el || !narrow) { setFade((f) => (f.l || f.r ? { l: false, r: false } : f)); return }
    const l = el.scrollLeft > 2
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setFade((f) => (f.l === l && f.r === r ? f : { l, r }))
  }

  // Valul activ adus în cadru, la deschidere și după fiecare schimbare. Prin
  // `scrollLeft`, nu `scrollIntoView`: acela ar fi derulat și pagina pe
  // verticală dacă banda nu era pe ecran.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (narrow) {
      const on = el.querySelector<HTMLElement>('.wb-pill.on')
      if (on) {
        const pad = 28
        const left = on.offsetLeft
        const right = left + on.offsetWidth
        if (left - pad < el.scrollLeft) el.scrollLeft = Math.max(0, left - pad)
        else if (right + pad > el.scrollLeft + el.clientWidth) el.scrollLeft = right + pad - el.clientWidth
      }
    }
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWave, narrow, delivery.length])

  useEffect(() => {
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow])

  // Pastilele sunt un `tablist`: ←/→ mută între ele (și aleg valul).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const tabs = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
    const i = tabs.indexOf(document.activeElement as HTMLElement)
    if (i === -1) return
    e.preventDefault()
    const j = e.key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(tabs.length - 1, i + 1)
    tabs[j].focus()
    tabs[j].click()
  }

  return (
    <div className="wave-band">
      <div
        ref={scrollRef}
        className={`wb-pills${fade.l ? ' fade-l' : ''}${fade.r ? ' fade-r' : ''}`}
        role="tablist"
        aria-label="Valuri"
        onScroll={measure}
        onKeyDown={onKeyDown}
      >
        {scratch && (
          <>
            <ScratchPill
              wave={scratch}
              count={open.get(SCRATCH) ?? 0}
              total={total.get(SCRATCH) ?? 0}
              on={activeWave === SCRATCH}
              onClick={() => onChoose(SCRATCH)}
            />
            <span className="wb-sep" aria-hidden="true" />
          </>
        )}
        {delivery.map((w) => (
          <WavePill
            key={w.number}
            wave={w}
            on={w.number === activeWave}
            count={open.get(w.number) ?? 0}
            total={total.get(w.number) ?? 0}
            onClick={() => onChoose(w.number)}
            onManage={canWrite ? () => onManage(w.number) : undefined}
          />
        ))}
        {canWrite && (
          <button
            type="button"
            className="wb-pill wb-add"
            aria-label="Val nou"
            title="Valuri: adaugă, redenumește, mută (V)"
            onClick={() => onManage('new')}
          >
            <Icon name="add" size={16} />
          </button>
        )}
        {chips}
      </div>
      {more}
    </div>
  )
}

function ScratchPill({ wave, count, total, on, onClick }: {
  wave: Wave; count: number; total: number; on: boolean; onClick(): void
}) {
  const name = wave.label.trim() || 'Notițe'
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      className={`wb-pill wb-scratch${on ? ' on' : ''}`}
      title={`${name} · ${count} deschise${total !== count ? ` din ${total}` : ''}`}
      aria-label={`${name}, ${count} deschise`}
      onClick={onClick}
    >
      <Icon name="scratch" size={16} />
      <span className="lb">{name}</span>
      <span className="n">{count}</span>
    </button>
  )
}

/**
 * O pastilă de val. Apăsarea lungă (telefon) și dublu-click-ul (desktop)
 * deschid foaia „Valuri" cu eticheta lui sub cursor; un click doar alege.
 */
function WavePill({ wave, on, count, total, onClick, onManage }: {
  wave: Wave; on: boolean; count: number; total: number; onClick(): void; onManage?: () => void
}) {
  const manageRef = useRef(onManage)
  manageRef.current = onManage
  const long = useLongPress(() => manageRef.current?.())
  const press = onManage ? long : {}
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      className={`wb-pill${on ? ' on' : ''}`}
      title={waveTitle(wave, count, total)}
      data-wave={wave.number}
      onClick={onClick}
      onDoubleClick={onManage}
      {...press}
    >
      <span className="lb">{pillText(wave, on)}</span>
      <span className="n">{count}</span>
    </button>
  )
}

/** Un mod diferit de implicit, ca jeton cu ✕ — un mod uitat pornit se vede. */
function ModeChips({ modes }: { modes: ViewModes }) {
  const who = modes.who
  const whoLabel = who && who.value !== null ? who.options.find((o) => o.key === who.value)?.label ?? null : null
  return (
    <>
      {modes.tree && <ModeChip label="Arbore" onClear={modes.onToggleTree} />}
      {who && whoLabel && <ModeChip label={whoLabel} onClear={() => who.onChange(null)} />}
    </>
  )
}

function ModeChip({ label, onClear }: { label: string; onClear(): void }) {
  return (
    <button type="button" className="wb-mode" onClick={onClear} title={`Oprește: ${label}`} aria-label={`Oprește: ${label}`}>
      <span>{label}</span>
      <span className="x" aria-hidden="true"><Icon name="close" size={12} /></span>
    </button>
  )
}

/** „⋯ Vizualizare": popover pe desktop, foaie de jos pe telefon (`ChipPop`). */
function MoreMenu({ modes, band, narrow, canWrite }: {
  modes: ViewModes; band: boolean; narrow: boolean; canWrite: boolean
}) {
  const { openWaveManage } = useUI()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const who = modes.who
  // „Ascunde bifatele” nu intră: se ține minte și stă pornit de obicei, deci un
  // punct permanent n-ar mai semnala nimic. Urma lui e la coada listei (`HiddenDone`).
  const changed = modes.tree || modes.selectMode || Boolean(who && who.value !== null)

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
        {changed && <span className="dot" aria-hidden="true" />}
      </button>
      {open && (
        <ChipPop
          anchor={btnRef.current}
          rowRef={wrapRef}
          sheet={narrow}
          role="menu"
          label="Vizualizare"
          align="end"
          className="wb-menu"
          onClose={close}
        >
          <div className="fc-h">Vizualizare</div>
          <button type="button" role="menuitemcheckbox" aria-checked={modes.tree} className={`fc-mi${modes.tree ? ' on' : ''}`} onClick={modes.onToggleTree}>
            <Icon name="graph" size={16} /><span className="fc-mi-t">Arbore de dependențe</span>
            {!narrow && <kbd className="wb-kbd">T</kbd>}
            <span className={`wb-tgl${modes.tree ? ' on' : ''}`} aria-hidden="true" />
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={modes.hideDone} className={`fc-mi${modes.hideDone ? ' on' : ''}`} onClick={modes.onToggleHideDone}>
            <Icon name="hide" size={16} /><span className="fc-mi-t">Ascunde bifatele</span>
            <span className={`wb-tgl${modes.hideDone ? ' on' : ''}`} aria-hidden="true" />
          </button>
          {canWrite && (
            <button
              type="button"
              role="menuitem"
              className={`fc-mi${modes.selectMode ? ' on' : ''}`}
              onClick={() => {
                if (modes.selectMode) modes.onExitSelect()
                else {
                  if (modes.tree) modes.onToggleTree()
                  modes.onEnterSelect()
                }
                close(false)
              }}
            >
              <Icon name="selectAll" size={16} />
              <span className="fc-mi-t">{modes.selectMode ? 'Ieși din selecție' : 'Selectează mai multe'}</span>
              {!narrow && <kbd className="wb-kbd">S</kbd>}
            </button>
          )}
          {who && (
            <>
              <div className="wb-hr" role="separator" />
              <div className="fc-h">Al cui</div>
              <div className="fc-seg wb-who" role="group" aria-label="Al cui">
                {who.options.map((o) => (
                  <button
                    type="button"
                    key={o.key ?? '__all__'}
                    className={who.value === o.key ? 'on' : ''}
                    aria-pressed={who.value === o.key}
                    onClick={() => who.onChange(o.key)}
                  >
                    {o.label} <span className="n">{o.count}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {canWrite && (
            <>
              <div className="wb-hr" role="separator" />
              {!band && (
                <button type="button" role="menuitem" className="fc-mi" onClick={() => { close(false); openWaveManage('new') }}>
                  <Icon name="add" size={16} /><span className="fc-mi-t">Val nou…</span>
                </button>
              )}
              <button type="button" role="menuitem" className="fc-mi" onClick={() => { close(false); openWaveManage() }}>
                <Icon name="settings" size={16} /><span className="fc-mi-t">Gestionează valurile…</span>
                {!narrow && <kbd className="wb-kbd">V</kbd>}
              </button>
            </>
          )}
        </ChipPop>
      )}
    </span>
  )
}

/** La coada listei: câte bifate ascunde „Ascunde bifatele” în valul activ, cu „Arată”. */
export function HiddenDone({ hideDone, onShow }: { hideDone: boolean; onShow(): void }) {
  const { issues, activeWave } = useHorizontal()
  const hidden = useMemo(
    () => issues.filter((i) => i.wave === activeWave && i.done).length,
    [issues, activeWave],
  )
  if (!hideDone || hidden === 0) return null
  return (
    <button type="button" className="hidden-done" onClick={onShow}>
      <Icon name="hide" size={14} />
      {hidden} {hidden === 1 ? 'bifat ascuns' : 'bifate ascunse'} · <b>Arată</b>
    </button>
  )
}
