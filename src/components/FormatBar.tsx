import type { PointerEvent, MouseEvent } from 'react'
import type { FormatCmd } from './MarkdownEditor'
import { Icon, type IconName } from './Icon'

const ITEMS: [FormatCmd, IconName, string][] = [
  ['task', 'mdTask', 'Căsuță'],
  ['bullet', 'mdList', 'Listă'],
  ['bold', 'mdBold', 'Îngroșat'],
  ['indent', 'mdIndent', 'Indentează'],
]

/** Nu iau focusul: tastatura rămâne sus, cursorul în descriere. */
const keep = (e: PointerEvent | MouseEvent) => e.preventDefault()

/**
 * Patru gesturi deasupra tastaturii, numai cât descrierea are focus. Restul
 * (titluri, linkuri) se scrie de mână. Ieșirea dintr-o indentare e Backspace
 * la începutul elementului.
 */
export function FormatBar({ onFormat }: { onFormat(cmd: FormatCmd): void }) {
  return (
    <div className="md-format" role="toolbar" aria-label="Formatare">
      {ITEMS.map(([cmd, icon, label]) => (
        <button key={cmd} type="button" className="qs-ico" aria-label={label} title={label}
          onPointerDown={keep} onMouseDown={keep} onClick={() => onFormat(cmd)}>
          <Icon name={icon} size={17} />
        </button>
      ))}
    </div>
  )
}
