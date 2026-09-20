// Foaia mică de „personalizat": interval și, pentru săptămânal, zilele.
//
// NU e o foaie din stiva de foi (`SheetHost`): o stivă înseamnă o intrare de
// istoric, iar Back-ul de pe telefon ar trebui atunci să închidă un selector,
// nu formularul. Un control dintr-un formular se poartă ca un `<select>`, nu ca
// un ecran — se închide cu Escape sau cu un click pe fundal, și atât.
//
// Preseturile (zilnic/săptămânal/lunar/anual) NU sunt aici: stau ca jetoane pe
// rândul din formular, la o atingere distanță. Aici se intră doar pentru ce nu
// încape pe un rând.

import { useEffect, useState } from 'react'
import { formatRrule, parseRrule, type Rec } from '../lib/recurrence'

export const PRESETS: { value: string | null; label: string }[] = [
  { value: null, label: 'fără' },
  { value: 'FREQ=DAILY', label: 'zilnic' },
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

  return (
    <>
      <div className="rp-back" onClick={onClose} />
      <div className="rp" role="dialog" aria-label="Repetare personalizată">
        <div className="rp-row">
          <span className="if-sub-label">La fiecare</span>
          <input
            className="rp-n"
            type="text"
            inputMode="numeric"
            value={String(rec.interval)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, '').slice(0, 2))
              set({ interval: n >= 1 ? n : 1 })
            }}
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
                {rec.interval === 1 ? u.one : u.many}
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
            onClick={() => { onChange(formatRrule(rec)); onClose() }}
          >
            Gata
          </button>
        </div>
      </div>
    </>
  )
}
