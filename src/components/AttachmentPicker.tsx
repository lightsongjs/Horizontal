import { useRef, type ChangeEvent } from 'react'
import { useCoarsePointer } from '../hooks'
import { Icon } from './Icon'

/**
 * Alegerea fișierelor, fără să știe nimic despre ce se întâmplă cu ele: nici de
 * Supabase, nici de `issueId`, nici de plafoane, nici de redenumire. Predă un
 * `File[]` și atât.
 *
 * Trei input-uri separate, nu unul cu atribute rescrise înainte de `.click()`.
 * Varianta cu unul singur economisește două noduri și cumpără un bug: Safari
 * citește atributele în momentul gestului, iar React nu garantează că DOM-ul s-a
 * actualizat înainte de apel. Aici ce e scris în JSX e ce vede browserul.
 *
 * Butoane cu iconiță, fără titlu și fără descriere: picker-ul stă într-o bară de
 * 36px deasupra descrierii, iar acolo fiecare cuvânt împinge miniaturile afară
 * din vedere. Ce spuneau descrierile („poți alege mai multe deodată") a rămas în
 * `title`/`aria-label`, unde nu ocupă lățime.
 */
export function AttachmentPicker({
  onPick,
  disabled = false,
  blocked = false,
  onBlocked,
}: {
  onPick: (files: File[]) => void
  disabled?: boolean
  /** Tichet nou: nu există id la care să lipim fișierul. Butoanele rămân la
   *  vedere, ca bara să nu-și schimbe forma după prima salvare, dar spun de ce
   *  nu merg în loc să fie `disabled` — un buton mort pe telefon nu explică
   *  nimic, fiindcă nu există hover care să arate `title`. */
  blocked?: boolean
  onBlocked?: () => void
}) {
  const coarse = useCoarsePointer()
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const anyFile = useRef<HTMLInputElement>(null)

  // Resetul lui `value` nu e igienă, e obligatoriu: fără el, a doua oară când
  // alegi ACELAȘI fișier evenimentul `change` nu se mai declanșează, fiindcă
  // valoarea input-ului n-a variat — iar cardul pare pur și simplu mort.
  //
  // Lista goală înseamnă că ai anulat din dialogul nativ. Anularea nu e eroare,
  // deci nu se raportează nimic.
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) onPick(files)
  }

  const open = (input: HTMLInputElement | null) => {
    if (blocked) { onBlocked?.(); return }
    input?.click()
  }

  return (
    <div className="att-acts">
      {/* `capture` exclude `multiple` prin definiția atributului: captura
          pornește camera pentru un singur cadru. */}
      {coarse && (
        <button
          type="button"
          className="att-act"
          disabled={disabled}
          aria-label="Fă o poză"
          title="Fă o poză (o poză odată)"
          onClick={() => open(camera.current)}
        >
          <Icon name="camera" size={15} />
        </button>
      )}

      <button
        type="button"
        className="att-act"
        disabled={disabled}
        aria-label="Adaugă din galerie"
        title="Din galerie (poți alege mai multe deodată)"
        onClick={() => open(gallery.current)}
      >
        <Icon name="image" size={15} />
      </button>

      <button
        type="button"
        className="att-act"
        disabled={disabled}
        aria-label="Adaugă alt fișier"
        title={coarse ? 'Alt fișier' : 'Alt fișier — sau lipește (Ctrl+V) ori trage peste descriere'}
        onClick={() => open(anyFile.current)}
      >
        <Icon name="add" size={15} />
      </button>

      <input ref={camera} className="att-pick-input" type="file"
             accept="image/*" capture="environment" onChange={handle} />
      <input ref={gallery} className="att-pick-input" type="file"
             accept="image/*" multiple onChange={handle} />
      <input ref={anyFile} className="att-pick-input" type="file"
             multiple onChange={handle} />
    </div>
  )
}
