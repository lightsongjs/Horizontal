import { useEffect, useMemo, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { deliveryWaves, moveWave, nextWaveName, openCounts, totalCounts, waveFallback, SCRATCH } from '../lib/waveBar'
import { errorMessage } from '../lib/errorMessage'
import { Icon } from './Icon'

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
 * Foaia „Valuri": aceeași ordine ca banda, cu cifra (NUMELE valului, nu poziția
 * lui — după ștergerea lui I, „II" rămâne „II"), eticheta editabilă pe loc,
 * numărul de tichete deschise, tragerea pentru ordine (`position`, prin
 * `reorderWaves`; ←/↑/↓ pe mâner, de la tastatură) și ștergerea, refuzată cât
 * valul mai are tichete.
 */
export function WaveManager({ focus }: { focus?: number | 'new' }) {
  const { waves, issues, createWave, renameWave, reorderWaves, deleteWave, reportError } = useHorizontal()
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const [blocked, setBlocked] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const rows = useRef(new Map<number, HTMLDivElement>())
  const newRef = useRef<HTMLInputElement>(null)

  const delivery = useMemo(() => deliveryWaves(waves), [waves])
  const scratch = waves.find((w) => w.number === SCRATCH) ?? null
  const open = useMemo(() => openCounts(issues), [issues])
  const total = useMemo(() => totalCounts(issues), [issues])
  const nextName = nextWaveName(waves)

  // Deschisă din „+" / „Val nou…": cursorul în câmpul de val nou. Din apăsarea
  // lungă pe o pastilă: în eticheta valului acela.
  useEffect(() => {
    if (focus === undefined) return
    const el = focus === 'new' ? newRef.current : rows.current.get(focus)?.querySelector('input')
    el?.focus({ preventScroll: false })
    // Doar la deschidere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = async () => {
    if (busy) return
    setBusy(true)
    try {
      await createWave(nextName, newLabel.trim())
      setNewLabel('')
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

  const onDelete = (n: number) => {
    if ((total.get(n) ?? 0) > 0) {
      // Ștergerea unui val cu tichete le-ar lăsa orfane — refuzată, cu motivul.
      setBlocked(n)
      setConfirmDel(null)
      return
    }
    setBlocked(null)
    if (confirmDel === n) void deleteWave(n).catch((e) => reportError(errorMessage(e)))
    else setConfirmDel(n)
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
        <div className="eyebrow"><Icon name="wave" size={13} /> Valuri</div>
        <h2>Valuri</h2>
        <p>Ordinea de aici e ordinea din bandă. Trage de mâner ca să muți. Fiecare val își calculează propriile layere.</p>
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
          <p className="empty" style={{ padding: '8px 0' }}>Niciun val încă.</p>
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
                  aria-label={`Mută valul ${w.name}`}
                  title="Trage ca să muți (sau ↑/↓)"
                  onPointerDown={(e) => startDrag(e, w.number, i)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); move(w.number, i - 1) }
                    else if (e.key === 'ArrowDown' && i < delivery.length - 1) { e.preventDefault(); move(w.number, i + 1) }
                  }}
                >
                  <Icon name="drag" size={16} />
                </button>
                <span className="we-rn" title={`Valul ${w.name}`}>{w.name}</span>
                <input
                  key={`${w.number}:${w.label}`}
                  className="we-input"
                  defaultValue={w.label}
                  aria-label={`Eticheta valului ${w.name}`}
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
                  aria-label={`Șterge valul ${w.name}`}
                  title={(total.get(w.number) ?? 0) > 0 ? `${total.get(w.number)} tichete în acest val` : 'Șterge'}
                  onClick={() => onDelete(w.number)}
                >
                  {confirmDel === w.number ? 'Sigur?' : <Icon name="delete" size={16} label="Șterge" />}
                </button>
              </div>
            )
          })}
        </div>
        {blocked !== null && (
          <div className="banner">
            <Icon name="danger" size={15} /> Valul are {total.get(blocked) ?? 0} tichete. Mută-le pe alt val (din editarea
            tichetului) înainte să-l poți șterge.
          </div>
        )}

        <div className="we-new">
          <span className="we-rn" aria-label={`Următorul val: ${nextName}`}>{nextName}</span>
          <input
            ref={newRef}
            className="we-input"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Val nou, ex. „Lansare”"
            aria-label="Eticheta valului nou"
          />
          <button type="button" className="we-add" onClick={add} disabled={busy}>
            <Icon name="add" size={16} /> Adaugă
          </button>
        </div>
      </div>
    </>
  )
}
