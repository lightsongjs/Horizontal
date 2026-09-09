import { useRef, type ChangeEvent } from 'react'
import { useCoarsePointer } from '../hooks'
import { Icon } from './Icon'

function CameraIcon() {
  return (
    <Icon name="camera" size={20} />
  )
}

function GalleryIcon() {
  return (
    <Icon name="image" size={20} />
  )
}

/**
 * Alegerea fișierelor, fără să știe nimic despre ce se întâmplă cu ele: nici de
 * Supabase, nici de `issueId`, nici de plafoane, nici de redenumire. Predă un
 * `File[]` și atât.
 *
 * Trei input-uri separate, nu unul cu atribute rescrise înainte de `.click()`.
 * Varianta cu unul singur economisește două noduri și cumpără un bug: Safari
 * citește atributele în momentul gestului, iar React nu garantează că DOM-ul s-a
 * actualizat înainte de apel. Aici ce e scris în JSX e ce vede browserul.
 */
export function AttachmentPicker({
  onPick,
  disabled = false,
}: {
  onPick: (files: File[]) => void
  disabled?: boolean
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

  return (
    <div className="att-pick">
      <div className="att-pick-cards">
        {/* `capture` exclude `multiple` prin definiția atributului: captura
            pornește camera pentru un singur cadru. De-aia scrie „o poză odată". */}
        {coarse && (
          <button
            type="button"
            className="att-pick-card"
            disabled={disabled}
            onClick={() => camera.current?.click()}
          >
            <span className="att-pick-ic"><CameraIcon /></span>
            <span className="att-pick-t">Fă o poză</span>
            <span className="att-pick-d">Deschide camera, o poză odată</span>
          </button>
        )}

        <button
          type="button"
          className="att-pick-card"
          disabled={disabled}
          onClick={() => gallery.current?.click()}
        >
          <span className="att-pick-ic"><GalleryIcon /></span>
          <span className="att-pick-t">Din galerie</span>
          <span className="att-pick-d">Poți alege mai multe deodată</span>
        </button>
      </div>

      <button
        type="button"
        className="att-pick-more"
        disabled={disabled}
        onClick={() => anyFile.current?.click()}
      >
        + Alt fișier
      </button>

      <p className="att-pick-hint">
        Poze, PDF-uri, arhive — orice fișier
        {!coarse && (
          <>
            <br />
            Lipește o poză (Ctrl+V) sau trage fișiere aici.
          </>
        )}
      </p>

      <input ref={camera} className="att-pick-input" type="file"
             accept="image/*" capture="environment" onChange={handle} />
      <input ref={gallery} className="att-pick-input" type="file"
             accept="image/*" multiple onChange={handle} />
      <input ref={anyFile} className="att-pick-input" type="file"
             multiple onChange={handle} />
    </div>
  )
}
