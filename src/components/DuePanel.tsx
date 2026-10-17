import type { ReactNode } from 'react'
import { datePresets, REMINDER_OPTIONS } from '../lib/formChips'
import { describeRrule } from '../lib/recurrence'
import { fromInputDate, fromTimeText, pickDayLabel, toDateInput, type ReminderKind } from '../lib/schedule'
import { Icon } from './Icon'
import { NativePick } from './NativePick'

/**
 * Corpul popoverului de dată — UN singur desen pentru formularul complet,
 * foaia de tichet de pe telefon (D-197) și foaia rapidă: presetările (Azi ·
 * Mâine · Luni · +1 săpt.), DOUĂ butoane — ziua și ora —, „scoate" (fără
 * dată), mementoul (doar cu oră) și „Se repetă: … · scoate".
 *
 * Nimic nu se scrie de mână (decizia omului, 2026-10-17: „nu scriu niciodată
 * o dată de mână, aleg din calendar"). Butonul de zi spune ziua în cuvintele
 * noastre („Azi" + „sâm 17 oct", „Lun 20 oct"), iar butonul ÎNSUȘI e un
 * `NativePick`: inputul nativ stă sub deget, deci atingerea deschide direct
 * calendarul sistemului — nu `showPicker()`, care pe telefon nu deschidea
 * nimic (vezi „Gesturile de pe telefon" în CLAUDE.md). La fel ora, cu ceasul;
 * ✕ de lângă ea o scoate (= toată ziua). Formatul afișat rămâne al nostru, nu
 * cel al locale-ului din WebView (`10/16/2026`, `--:-- --`).
 *
 * Pur prezentare: cine îl folosește ține starea și decide când scrie. Formularul
 * doar își murdărește câmpurile (salvarea rămâne explicită); foaia de tichet
 * scrie pe loc, prin autosave; foaia rapidă pune data în ciornă.
 */
export function DuePanel({
  now,
  dueDate,
  dueTime,
  onPreset,
  onPickDate,
  onPickTime,
  onClearTime,
  onClear,
  reminder,
  onReminder,
  rrule,
  onClearRrule,
  foot,
}: {
  now: Date
  /** Ce e acum adevărat: `aaaa-ll-zz` / `HH:MM`, sau `''`. */
  dueDate: string
  dueTime: string
  onPreset(day: Date): void
  /** Alegerea din calendarul / ceasul sistemului, deja validată (`aaaa-ll-zz`, `HH:MM`). */
  onPickDate(value: string): void
  onPickTime(value: string): void
  /** Scoate ora: sarcina rămâne pe zi, toată ziua. */
  onClearTime(): void
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
  const presets = datePresets(now)
  const day = dueDate ? pickDayLabel(dueDate, now) : null
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
        <NativePick
          type="date"
          label={day ? `Ziua: ${day.day}${day.sub ? `, ${day.sub}` : ''} — alege din calendar` : 'Alege data din calendar'}
          className={`fc-pick fc-pick-date${day ? '' : ' unset'}`}
          initial={() => dueDate || toDateInput(now.toISOString())}
          onPick={(v) => { const d = fromInputDate(v); if (d) onPickDate(d) }}
        >
          <Icon name="due" size={16} />
          <span className="fc-pick-t">{day ? day.day : 'Alege data'}</span>
          {day?.sub && <small className="fc-pick-sub">{day.sub}</small>}
        </NativePick>
        <span className={`fc-time${dueTime ? ' set' : ''}`}>
          {/* Ceasul merge și fără zi: ora cade azi (ca „Oră…" din glisare). */}
          <NativePick
            type="time"
            label={dueTime ? `Ora: ${dueTime} — alege din ceas` : 'Alege ora'}
            className="fc-pick fc-pick-time"
            initial={() => dueTime || '09:00'}
            onPick={(v) => { const t = fromTimeText(v); if (t) onPickTime(t) }}
          >
            <Icon name="reminderTime" size={16} />
            <span className="fc-pick-t">{dueTime || 'Oră'}</span>
          </NativePick>
          {dueTime && (
            <button type="button" className="fc-pick-x" onClick={onClearTime} title="Fără oră (toată ziua)" aria-label="Fără oră, toată ziua">
              <Icon name="close" size={14} />
            </button>
          )}
        </span>
        {dueDate && (
          <button type="button" className="fc-link" onClick={onClear} title="Fără dată" aria-label="Fără dată">
            scoate
          </button>
        )}
      </div>
      {/* Mementoul apare numai când are ce să însemne. Pentru o sarcină de
          zi întreagă ar suna la miezul nopții, deci acolo tace și treaba
          o face rezumatul de dimineață. */}
      {onReminder && dueDate && !dueTime && <p className="fc-note">Toată ziua — fără memento.</p>}
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

