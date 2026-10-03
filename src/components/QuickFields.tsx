import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import type { TitleDate } from '../hooks'

interface TitleProps {
  date: TitleDate
  text: string
  onText(next: string): void
  inputRef: RefObject<HTMLInputElement>
  placeholder: string
  enterKeyHint: 'done' | 'send'
  onKeyDown(e: KeyboardEvent<HTMLInputElement>): void
  onFocus?(): void
  onBlur?(): void
  autoFocus?: boolean
  /**
   * Unde stă indiciul „atinge ca să anulezi". Deasupra (implicit) în rândul
   * din listă; dedesubt, ÎN flux, în foaia rapidă — deasupra e marginea foii,
   * iar suprapus ar acoperi descrierea exact cât timp e de citit.
   */
  tipBelow?: boolean
}

/**
 * Titlul capturii: un input transparent peste un strat-oglindă care desenează
 * fragmentul de dată recunoscut. Un singur loc pentru rândul din listă, bara
 * de captură și foaia rapidă — evidențierea, indiciul și refuzul la atingere
 * trebuie să fie același gest peste tot, iar oglinda e ușor de stricat (orice
 * diferență de font sau spațiere între cele două straturi decalează marcajul).
 */
export function QuickTitle({ date, text, onText, inputRef, placeholder, enterKeyHint, onKeyDown, onFocus, onBlur, autoFocus, tipBelow = false }: TitleProps) {
  // Indiciul care spune că evidențierea se poate refuza cu o atingere. Apare la
  // TRECEREA în „am înțeles ceva" și pleacă singur: e o instrucțiune, nu o
  // stare — lipit pe ecran, ar sta exact peste textul pe care îl citești.
  // Pleacă și când data dispare (refuz, golire), nu doar la expirare.
  const [tip, setTip] = useState(false)
  useEffect(() => {
    if (!date.active) { setTip(false); return }
    setTip(true)
    const t = setTimeout(() => setTip(false), 4200)
    return () => clearTimeout(t)
  }, [date.active])

  const tipEl = tip && (
    <span className={`qa-tip ${tipBelow ? 'below' : ''}`} role="status">
      Am recunoscut o dată — atinge fragmentul evidențiat ca să o anulezi.
    </span>
  )
  return (
    <>
    <span
      className={`qa-wrap ${date.onDate ? 'on-date' : ''}`}
      // Titlul stă pe înveliș, nu pe input: inputul e transparent și acoperă
      // tot rândul, deci un `title` pe el ar explica „atinge ca să anulezi"
      // și acolo unde nu e nicio dată de anulat.
      title={date.onDate ? 'Nu e o dată — atinge ca să rămână text în titlu' : undefined}
    >
      {!tipBelow && tipEl}
      {/* Oglinda desenează evidențierea, inputul stă transparent deasupra. */}
      <span className="qa-mirror" ref={date.mirrorRef} aria-hidden="true">
        {date.pieces.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
      </span>
      <input
        ref={inputRef}
        className="qa-input"
        // Vezi comentariul din IssueForm: `search` e ultima pârghie peste
        // bara de autofill a Chrome. Butonul nativ de golire e ascuns din
        // CSS — ar fi stat peste stratul-oglindă care desenează data.
        type="search"
        value={text}
        name="titlu-sarcina"
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint={enterKeyHint}
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Titlul sarcinii"
        onChange={(e) => onText(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        // O atingere PE fragmentul recunoscut înseamnă „nu e o dată".
        {...date.inputProps}
        // Oglinda nu se derulează singură: fără asta, evidențierea rămâne
        // în urmă la un titlu mai lung decât inputul.
        onScroll={(e) => {
          if (date.mirrorRef.current) date.mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        onKeyDown={onKeyDown}
      />
    </span>
    {tipBelow && tipEl}
    </>
  )
}

interface DescProps {
  value: string
  onChange(next: string): void
  textareaRef: RefObject<HTMLTextAreaElement>
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void
  placeholder?: string
  onFocus?(): void
  onBlur?(): void
  /** Foaia de tichet folosește același câmp și pentru titlul pe mai multe rânduri. */
  className?: string
  ariaLabel?: string
  readOnly?: boolean
}

const growsByItself = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')

/**
 * Descrierea capturii: un textarea care crește cu textul. `field-sizing:
 * content` face asta singur; unde lipsește (Firefox, Safari mai vechi),
 * înălțimea se ia din `scrollHeight` la fiecare schimbare.
 */
export function QuickDesc({ value, onChange, textareaRef, onKeyDown, placeholder = 'Descriere', onFocus, onBlur, className = 'qa-desc', ariaLabel = 'Descrierea sarcinii', readOnly }: DescProps) {
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el || growsByItself) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, textareaRef])
  return (
    <textarea
      ref={textareaRef}
      className={className}
      rows={1}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  )
}
