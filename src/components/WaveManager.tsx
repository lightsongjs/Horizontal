import { useEffect, useMemo, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { deliveryWaves, moveWave, openCounts, totalCounts, waveFallback, waveName, SCRATCH } from '../lib/waveBar'
import { toDateInput } from '../lib/schedule'
import { NativePick } from './NativePick'
import { sprintDateOf } from '../lib/sprints'
import { errorMessage } from '../lib/errorMessage'
import { useUI } from '../ui'
import { Icon } from './Icon'

/** Coloana cifrei: un sprint cu dată o are deja în nume, deci aici doar semnul calendarului. */
const rnText = (w: { name: string; label: string }) => (sprintDateOf(w) ? <Icon name="due" size={14} /> : waveName(w))

interface Drag {
  number: number
  from: number
  to: number
  startY: number
  dy: number
  /** Dreptunghiurile rândurilor la începutul tragerii — ținta se calculează pe ele. */
  mids: number[]
  /** Pasul dintre două rânduri (înălțime + spațiu). */
  step: number
}

/**
 * Foaia „Sprinturi" (valurile, în interfață): aceeași ordine ca banda, cu cifra (NUMELE valului, nu poziția
 * lui — după ștergerea lui I, „II" rămâne „II"), eticheta editabilă pe loc,
 * numărul de tichete deschise, tragerea pentru ordine (`position`, prin
 * `reorderWaves`; ←/↑/↓ pe mâner, de la tastatură) și ștergerea, refuzată cât
 * valul mai are tichete.
 *
 * Arhivarea (H-17): un val care are doar tichete GATA nu se șterge, se
 * arhivează (coșul de pe rând devine cutia de arhivă). Unul cu tichete
 * deschise rămâne refuzat — mutarea lor e o alegere a omului (sau
 * `tk wave-delete --move-to`). Arhivatele stau jos, strânse sub „Arhivate":
 * „Deschide" le arată în bandă cât le consulți, „Scoate" le readuce.
 */
export function WaveManager({ focus }: { focus?: number | 'new' }) {
  const { waves, archivedWaves, issues, createSprint, renameWave, reorderWaves, deleteWave, archiveWave, setActiveWave, reportError } = useHorizontal()
  const { closeSheet } = useUI()
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const [blocked, setBlocked] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const rows = useRef(new Map<number, HTMLDivElement>())
  const newRef = useRef<HTMLDivElement>(null)

  // Valul arhivat deschis acum e în `waves` (ca banda să-l arate), dar locul lui aici e jos.
  const delivery = useMemo(() => deliveryWaves(waves).filter((w) => !w.archivedAt), [waves])
  const scratch = waves.find((w) => w.number === SCRATCH) ?? null
  const open = useMemo(() => openCounts(issues), [issues])
  const total = useMemo(() => totalCounts(issues), [issues])
  // Deschisă din „+" / „Sprint nou…": focusul pe butonul de dată. Din apăsarea
  // lungă pe o pastilă: în eticheta sprintului acela.
  useEffect(() => {
    if (focus === undefined) return
    const el = (focus === 'new' ? newRef.current : rows.current.get(focus))?.querySelector('input')
    el?.focus({ preventScroll: false })
    // Doar la deschidere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = async (iso: string) => {
    if (busy) return
    setBusy(true)
    try {
      await createSprint(iso)
    } catch (e) {
      reportError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const move = (number: number, to: number) => {
    const changes = moveWave(delivery, number, to)
    if (changes.length) reorderWaves(changes).catch((e) => reportError(errorMessage(e)))
  }

  /** Doar gata (și baza știe arhiva): coșul devine arhivare. */
  const archivable = (n: number) =>
    (total.get(n) ?? 0) > 0 && (open.get(n) ?? 0) === 0 && delivery.find((w) => w.number === n)?.archivedAt !== undefined

  const onDelete = (n: number) => {
    const arch = archivable(n)
    if ((total.get(n) ?? 0) > 0 && !arch) {
      // Ștergerea unui val cu tichete le-ar lăsa orfane — refuzată, cu motivul.
      setBlocked(n)
      setConfirmDel(null)
      return
    }
    setBlocked(null)
    if (confirmDel !== n) { setConfirmDel(n); return }
    setConfirmDel(null)
    void (arch ? archiveWave(n, true) : deleteWave(n)).catch((e) => reportError(errorMessage(e)))
  }

  const startDrag = (e: React.PointerEvent, number: number, from: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rects = delivery.map((w) => rows.current.get(w.number)!.getBoundingClientRect())
    const step = rects.length > 1 ? rects[1].top - rects[0].top : rects[0].height
    setDrag({ number, from, to: from, startY: e.clientY, dy: 0, mids: rects.map((r) => r.top + r.height / 2), step })
  }
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag) return
    const dy = e.clientY - drag.startY
    const center = drag.mids[drag.from] + dy
    const to = drag.mids.filter((m, j) => j !== drag.from && m < center).length
    setDrag({ ...drag, dy, to })
  }
  const endDrag = () => {
    if (!drag) return
    setDrag(null)
    move(drag.number, drag.to)
  }

  // Cât se trage, rândurile dintre `from` și `to` își fac loc cu un pas.
  const shift = (j: number): number => {
    if (!drag || j === drag.from) return 0
    if (drag.from < drag.to && j > drag.from && j <= drag.to) return -drag.step
    if (drag.from > drag.to && j >= drag.to && j < drag.from) return drag.step
    return 0
  }

  return (
    <>
      <div className="sheet-head">
        <h2>Sprinturi</h2>
        <p>Ordinea de aici e ordinea din bandă. Trage de mâner ca să muți. Fiecare sprint își calculează propriile layere.</p>
      </div>
      <div className="sheet-scroll">
        {scratch && (
          <div className="we fixed">
            <span className="we-grip" aria-hidden="true" />
            <span className="we-rn" aria-hidden="true" />
            <span className="we-field"><Icon name="scratch" size={16} />{scratch.label.trim() || 'Notițe'}</span>
            <span className="we-n" title="deschise">{open.get(SCRATCH) ?? 0}</span>
            <span className="we-del" aria-hidden="true" />
          </div>
        )}
        {delivery.length === 0 && (
          <p className="empty" style={{ padding: '8px 0' }}>Niciun sprint încă.</p>
        )}
        <div className="we-list" onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
          {delivery.map((w, i) => {
            const lifted = drag?.number === w.number
            const dy = lifted ? drag!.dy : shift(i)
            return (
              <div
                key={w.number}
                ref={(el) => { if (el) rows.current.set(w.number, el); else rows.current.delete(w.number) }}
                className={`we${lifted ? ' lift' : ''}${drag && !lifted ? ' shifting' : ''}`}
                style={dy ? { transform: `translateY(${dy}px)` } : undefined}
                data-wave={w.number}
              >
                <button
                  type="button"
                  className="we-grip"
                  aria-label={`Mută sprintul ${waveName(w)}`}
                  title="Trage ca să muți (sau ↑/↓)"
                  onPointerDown={(e) => startDrag(e, w.number, i)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); move(w.number, i - 1) }
                    else if (e.key === 'ArrowDown' && i < delivery.length - 1) { e.preventDefault(); move(w.number, i + 1) }
                  }}
                >
                  <Icon name="drag" size={16} />
                </button>
                <span className="we-rn" title={waveFallback(w)}>{rnText(w)}</span>
                <input
                  key={`${w.number}:${w.label}`}
                  className="we-input"
                  defaultValue={w.label}
                  aria-label={`Eticheta sprintului ${waveName(w)}`}
                  placeholder={waveFallback(w)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v !== w.label) renameWave(w.number, w.name, v).catch((err) => reportError(errorMessage(err)))
                  }}
                />
                <span className="we-n" title={`${open.get(w.number) ?? 0} deschise din ${total.get(w.number) ?? 0}`}>
                  {open.get(w.number) ?? 0}
                </span>
                <button
                  type="button"
                  className="we-del"
                  aria-label={archivable(w.number) ? `Arhivează sprintul ${waveName(w)}` : `Șterge sprintul ${waveName(w)}`}
                  title={archivable(w.number)
                    ? `Arhivează: ${total.get(w.number)} tichete gata rămân, sprintul iese din bandă`
                    : (total.get(w.number) ?? 0) > 0 ? `${total.get(w.number)} tichete în acest sprint` : 'Șterge'}
                  onClick={() => onDelete(w.number)}
                >
                  {confirmDel === w.number
                    ? 'Sigur?'
                    : archivable(w.number) ? <Icon name="archive" size={16} label="Arhivează" /> : <Icon name="delete" size={16} label="Șterge" />}
                </button>
              </div>
            )
          })}
        </div>
        {blocked !== null && (
          <div className="banner">
            <Icon name="danger" size={15} /> {(open.get(blocked) ?? 0) > 0
              ? <>Sprintul are {open.get(blocked)} tichete deschise. Mută-le pe alt sprint (din editarea tichetului) sau bifează-le
                înainte să-l poți arhiva — cele gata rămân în arhivă.</>
              : <>Sprintul are {total.get(blocked) ?? 0} tichete. Mută-le pe alt sprint (din editarea tichetului) înainte să-l poți
                șterge.</>}
          </div>
        )}

        {archivedWaves.length > 0 && (
          <div className="we-archived">
            <button type="button" className="we-arch-toggle" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
              <Icon name={showArchived ? 'collapse' : 'expand'} size={14} /> Arhivate ({archivedWaves.length})
            </button>
            {showArchived && archivedWaves.map((w) => (
              <div key={w.number} className="we we-arch" data-wave={w.number}>
                <span className="we-rn" title={waveFallback(w)}>{rnText(w)}</span>
                <span className="we-field">{w.label.trim() || waveFallback(w)}</span>
                <span className="we-n" title={`${total.get(w.number) ?? 0} tichete`}>{total.get(w.number) ?? 0}</span>
                <button type="button" className="we-arch-act" onClick={() => { setActiveWave(w.number); closeSheet() }}>Deschide</button>
                <button
                  type="button"
                  className="we-arch-act"
                  onClick={() => void archiveWave(w.number, false).catch((e) => reportError(errorMessage(e)))}
                >
                  <Icon name="restore" size={14} /> Scoate
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Sprint nou = o dată (calendarul sistemului), numit „dd/mm/yy” și pus în ordinea datei. */}
        <div className="we-new" ref={newRef}>
          <NativePick
            type="date"
            label="Sprint nou: alege data"
            className={`we-add${busy ? ' busy' : ''}`}
            initial={() => toDateInput(new Date().toISOString())}
            onPick={add}
          >
            <Icon name="add" size={16} /> Sprint nou · alege data
          </NativePick>
          <span className="we-hint">Se numește cu data (19/11/26) și intră în ordinea datelor.</span>
        </div>
      </div>
    </>
  )
}
