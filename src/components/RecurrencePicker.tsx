// Foaia mică de „personalizat": interval și, pentru săptămânal, zilele.
//
// NU e o foaie din stiva de foi (`SheetHost`): o stivă înseamnă o intrare de
// istoric, iar Back-ul de pe telefon ar trebui atunci să închidă un selector,
// nu formularul. Un control dintr-un formular se poartă ca un `<select>`, nu ca
// un ecran — se închide cu Escape sau cu un click pe fundal, și atât.
//
// Preseturile (zilnic/zile lucrătoare/săptămânal/lunar/anual) NU sunt aici: stau ca jetoane pe
// rândul din formular, la o atingere distanță. Aici se intră doar pentru ce nu
// încape pe un rând.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatRrule, parseRrule, type Rec } from '../lib/recurrence'

/** Luni–vineri. Exact șirul pe care îl scrie `formatRrule`, ca `presetOf` să-l recunoască. */
export const WEEKDAYS = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'

export const PRESETS: { value: string | null; label: string }[] = [
  { value: null, label: 'fără' },
  { value: 'FREQ=DAILY', label: 'zilnic' },
  { value: WEEKDAYS, label: 'zile lucrătoare' },
  { value: 'FREQ=WEEKLY', label: 'săptămânal' },
  { value: 'FREQ=MONTHLY', label: 'lunar' },
  { value: 'FREQ=YEARLY', label: 'anual' },
]

/** Ce jeton e aprins pe rând. Tot ce nu e preset curat e „personalizat". */
export function presetOf(rrule: string | null): string {
  if (!rrule) return 'none'
  const hit = PRESETS.find((p) => p.value === rrule)
  return hit?.value ?? 'custom'
}

const UNITS: { freq: Rec['freq']; one: string; many: string }[] = [
  { freq: 'DAILY', one: 'zi', many: 'zile' },
  { freq: 'WEEKLY', one: 'săptămână', many: 'săptămâni' },
  { freq: 'MONTHLY', one: 'lună', many: 'luni' },
  { freq: 'YEARLY', one: 'an', many: 'ani' },
]

const DAY_SHORT = ['D', 'L', 'Ma', 'Mi', 'J', 'V', 'S']
const DAY_FULL = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă']

/**
 * Ce arată câmpul de interval cât timp userul scrie — doar cifre, cel mult
 * două. Un gol e un stadiu intermediar legitim, la fel ca la `bymonthday`:
 * o valoare controlată care se rotunjește la 1 în timp ce userul șterge ca
 * să scrie alta face ca următoarea cifră tastată să aterizeze lângă „1"
 * rezidual („13" în loc de „3"), nu în locul lui.
 */
export function sanitizeIntervalText(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 2)
}

/**
 * Textul din câmp → numărul care intră în `Rec`. Se cheamă DOAR la compunerea
 * RRULE-ului (butonul „Gata"), niciodată la fiecare tastă — `interval` din
 * `Rec` n-are o valoare „goală" validă (contractul e „≥ 1"), deci un câmp gol
 * sau „0" cade pe 1 aici, ca „Gata" să rămână mereu apăsabil și niciun RRULE
 * invalid să nu iasă din foaie.
 */
export function intervalFromText(text: string): number {
  const n = Number(text)
  return n >= 1 ? n : 1
}

export function RecurrencePicker({
  value,
  onChange,
  onClose,
}: {
  value: string | null
  onChange: (rrule: string | null) => void
  onClose: () => void
}) {
  const start = parseRrule(value) ?? { freq: 'DAILY' as const, interval: 2, byday: [], bymonthday: null }
  const [rec, setRec] = useState<Rec>(start)
  // Text brut, separat de `rec.interval`: ține golul cât timp userul șterge
  // ca să scrie alt număr — vezi `sanitizeIntervalText`.
  const [intervalText, setIntervalText] = useState(String(start.interval))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [onClose])

  const set = (patch: Partial<Rec>) => setRec((r) => ({ ...r, ...patch }))
  const toggleDay = (i: number) =>
    set({ byday: rec.byday.includes(i) ? rec.byday.filter((d) => d !== i) : [...rec.byday, i].sort((a, b) => a - b) })

  // Portal în `document.body`: `.sheet` are `transform` necondiționat (inclusiv
  // în starea `.on`), iar un ascendent transformat devine containing block
  // pentru un descendent `position: fixed` — foaia s-ar poziționa față de
  // `.sheet`, nu față de fereastră, exact când formularul e modal (nedocat în
  // `SplitView`). Portalul scoate `.rp`/`.rp-back` din acel arbore; API-ul
  // componentei nu se schimbă, doar unde ajunge în DOM.
  return createPortal(
    <>
      <div className="rp-back" onClick={onClose} />
      <div className="rp" role="dialog" aria-label="Repetare personalizată">
        <div className="rp-row">
          <span className="if-sub-label">La fiecare</span>
          <input
            className="rp-n"
            type="text"
            inputMode="numeric"
            value={intervalText}
            onChange={(e) => setIntervalText(sanitizeIntervalText(e.target.value))}
            aria-label="La câte unități se repetă"
          />
          <div className="pills-row">
            {UNITS.map((u) => (
              <button
                key={u.freq}
                type="button"
                className={`if-meta-pill ${rec.freq === u.freq ? 'active' : ''}`}
                onClick={() => set({ freq: u.freq, byday: [], bymonthday: null })}
              >
                {Number(intervalText) === 1 ? u.one : u.many}
              </button>
            ))}
          </div>
        </div>

        {rec.freq === 'WEEKLY' && (
          <div className="rp-row">
            <span className="if-sub-label">În zilele</span>
            <div className="pills-row">
              {DAY_SHORT.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  className={`if-meta-pill rp-day ${rec.byday.includes(i) ? 'active' : ''}`}
                  onClick={() => toggleDay(i)}
                  aria-label={DAY_FULL[i]}
                  aria-pressed={rec.byday.includes(i)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {rec.freq === 'MONTHLY' && (
          <div className="rp-row">
            <span className="if-sub-label">În ziua</span>
            <input
              className="rp-n"
              type="text"
              inputMode="numeric"
              value={rec.bymonthday ? String(rec.bymonthday) : ''}
              placeholder="ca scadența"
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, '').slice(0, 2))
                set({ bymonthday: n >= 1 && n <= 31 ? n : null })
              }}
              aria-label="Ziua din lună"
            />
            {/* Ziua 31 nu există în toate lunile: se retează, nu se sare peste. */}
            {rec.bymonthday && rec.bymonthday > 28 && (
              <span className="due-hint">în lunile mai scurte, ultima zi</span>
            )}
          </div>
        )}

        <div className="rp-acts">
          <button type="button" className="if-meta-pill" onClick={onClose}>Renunță</button>
          <button
            type="button"
            className="if-meta-pill active"
            onClick={() => {
              onChange(formatRrule({ ...rec, interval: intervalFromText(intervalText) }))
              onClose()
            }}
          >
            Gata
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
