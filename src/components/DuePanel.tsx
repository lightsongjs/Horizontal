import { useEffect, useState, type ReactNode } from 'react'
import { datePresets, REMINDER_OPTIONS } from '../lib/formChips'
import { describeRrule } from '../lib/recurrence'
import {
  DATE_PLACEHOLDER, TIME_PLACEHOLDER, displayFromInputDate, fromDisplayDate, fromTimeText, maskDateInput,
  maskTimeInput, toDateInput, type ReminderKind,
} from '../lib/schedule'
import { Icon } from './Icon'
import { NativePick } from './NativePick'

/**
 * Corpul popoverului de dată — UN singur desen pentru formularul complet și
 * pentru foaia de tichet de pe telefon (D-197): presetările (Azi · Mâine ·
 * Luni · +1 săpt.), câmpul scris `zz/ll/aaaa` + `hh:mm` (24 de ore, aceeași
 * validare), „scoate" (fără dată), mementoul (doar cu oră) și „Se repetă: … · scoate".
 *
 * Pur prezentare: cine îl folosește ține starea și decide când scrie. Formularul
 * doar își murdărește câmpurile (salvarea rămâne explicită); foaia scrie pe loc,
 * prin autosave.
 *
 * Calendarul și ceasul SISTEMULUI stau în câmp, ca iconițe: un `NativePick`
 * (inputul nativ sub deget), nu `showPicker()` — acela nu deschidea nimic pe
 * telefon (vezi „Gesturile de pe telefon" în CLAUDE.md). Valoarea lor intră
 * prin aceleași `onPickDate`/`onPickTime`, deci formatul afișat rămâne al
 * nostru, nu cel al locale-ului din WebView (`10/16/2026`, `--:-- --`).
 */
export function DuePanel({
  now,
  dueText,
  timeText,
  dueDate,
  dueTime,
  onDueText,
  onTimeText,
  onTimeBlur,
  onPreset,
  onPickDate,
  onPickTime,
  onClear,
  reminder,
  onReminder,
  rrule,
  onClearRrule,
  foot,
}: {
  now: Date
  /** Textul din câmpuri, cum e scris (`zz/ll/aaaa`, `hh:mm`). */
  dueText: string
  timeText: string
  /** Valorile validate (`aaaa-ll-zz`, `HH:MM`), sau `''`. */
  dueDate: string
  dueTime: string
  onDueText(text: string): void
  onTimeText(text: string): void
  onTimeBlur?(): void
  onPreset(day: Date): void
  /** Alegerea din calendarul / ceasul sistemului (`aaaa-ll-zz`, `HH:MM`). */
  onPickDate(value: string): void
  onPickTime(value: string): void
  onClear(): void
  /**
   * Fără `onReminder` rândul mementoului lipsește (foaia rapidă: captura pune
   * mementoul implicit, ca înainte de panou — nu-l alege).
   */
  reminder?: ReminderKind
  onReminder?(kind: ReminderKind): void
  /** Recurența care chiar se salvează (fără dată nu există). Fără `onClearRrule` nu se arată. */
  rrule?: string | null
  onClearRrule?(): void
  foot?: ReactNode
}) {
  const dueIncomplete = dueText.trim() !== '' && dueDate === ''
  const timeIncomplete = timeText.trim() !== '' && dueTime === ''
  const presets = datePresets(now)
  return (
    <>
      <h4 className="fc-h">Ziua</h4>
      <div className="fc-presets">
        {presets.map((p) => {
          const on = dueDate === toDateInput(p.date.toISOString())
          return (
            <button
              key={p.key}
              type="button"
              className={`fc-pre${on ? ' on' : ''}`}
              aria-pressed={on}
              data-autofocus={on || undefined}
              onClick={() => onPreset(p.date)}
            >
              {p.label}
              <small>{p.sub}</small>
            </button>
          )
        })}
      </div>
      <div className="fc-fields">
        <div className={`due-inputs${dueText ? '' : ' unset'}`} title="Scadență">
          <input
            type="text"
            inputMode="numeric"
            className={`due-input due-input-date ${dueIncomplete ? 'incomplete' : ''}`}
            value={dueText}
            onChange={(e) => onDueText(maskDateInput(e.target.value))}
            placeholder={DATE_PLACEHOLDER}
            maxLength={10}
            aria-label="Data scadenței, zi/lună/an"
          />
          <NativePick
            type="date"
            label="Alege data…"
            className="due-pick"
            tabIndex={-1}
            initial={() => dueDate || toDateInput(now.toISOString())}
            onPick={onPickDate}
          >
            <Icon name="due" size={13} />
          </NativePick>
          <input
            type="text"
            inputMode="numeric"
            className={`due-input due-input-time ${timeIncomplete ? 'incomplete' : ''}`}
            value={timeText}
            onChange={(e) => onTimeText(maskTimeInput(e.target.value))}
            onBlur={onTimeBlur}
            disabled={!dueDate}
            placeholder={TIME_PLACEHOLDER}
            maxLength={5}
            aria-label="Ora scadenței, 24 de ore"
            title={dueDate ? 'Lasă gol pentru toată ziua' : 'Alege întâi o zi'}
          />
          {/* Ceasul merge și fără zi: ora cade azi (ca „Oră…" din glisare). */}
          <NativePick
            type="time"
            label="Oră…"
            className="due-pick"
            tabIndex={-1}
            initial={() => dueTime || '09:00'}
            onPick={onPickTime}
          >
            <Icon name="reminderTime" size={13} />
          </NativePick>
        </div>
        {dueText && (
          <button type="button" className="fc-link" onClick={onClear} title="Fără dată" aria-label="Fără dată">
            scoate
          </button>
        )}
      </div>
      {(dueIncomplete || timeIncomplete) && (
        <p className="fc-note warn">{dueIncomplete ? 'Scrie data ca zi/lună/an.' : 'Ora, de la 00:00 la 23:59.'}</p>
      )}
      {/* Mementoul apare numai când are ce să însemne. Pentru o sarcină de
          zi întreagă ar suna la miezul nopții, deci acolo tace și treaba
          o face rezumatul de dimineață. */}
      {onReminder && dueDate && !dueTime && !dueIncomplete && <p className="fc-note">Toată ziua — fără memento.</p>}
      {onReminder && dueDate && dueTime && (
        <>
          <h4 className="fc-h">Memento</h4>
          <div className="fc-seg" role="group" aria-label="Memento">
            {REMINDER_OPTIONS.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className={reminder === kind ? 'on' : ''}
                aria-pressed={reminder === kind}
                onClick={() => onReminder(kind)}
              >
                {reminder === kind && <Icon name="check" size={12} />}
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {/* Repetarea nu se alege de aici: se scrie în titlu („în fiecare luni"),
          iar `parseDue` o recunoaște. Aici doar se vede și se scoate. */}
      {rrule && onClearRrule && (
        <>
          <p className="fc-recur">
            <Icon name="recurring" size={13} />
            <span>Se repetă: {describeRrule(rrule) || 'personalizat'}</span>
            <span aria-hidden="true">·</span>
            <button type="button" className="fc-link" onClick={onClearRrule}>scoate</button>
          </p>
          <p className="fc-note">Ziua mută doar apariția de acum; ora mută toată seria.</p>
        </>
      )}
      {foot}
    </>
  )
}

/**
 * Textul câmpurilor scrise ale panoului, ținut de cine îl folosește: scris pe
 * jumătate nu e o dată, deci textul e local, iar valoarea validă (`dueDate`,
 * `dueTime`) se scrie abia când e întreagă. O schimbare venită din altă parte
 * (presetare, calendar, alt dispozitiv, data din titlu) e urmată de câmpuri,
 * dacă nu spun deja același lucru. `curDate`/`curTime` = ce e acum adevărat
 * (`aaaa-ll-zz`, `HH:MM`, sau `''`).
 */
export function useDueFields(curDate: string, curTime: string) {
  const [dueText, setDueText] = useState(curDate ? displayFromInputDate(curDate) : '')
  const [timeText, setTimeText] = useState(curTime)
  useEffect(() => {
    setDueText((t) => ((fromDisplayDate(t) ?? '') === curDate ? t : curDate ? displayFromInputDate(curDate) : ''))
    setTimeText((t) => ((fromTimeText(t) ?? '') === curTime ? t : curTime))
  }, [curDate, curTime])
  return {
    dueText,
    setDueText,
    timeText,
    setTimeText,
    dueDate: fromDisplayDate(dueText) ?? '',
    dueTime: fromTimeText(timeText) ?? '',
  }
}
