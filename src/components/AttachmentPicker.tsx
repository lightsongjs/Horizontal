import { useRef, type ChangeEvent } from 'react'
import { useCoarsePointer } from '../hooks'

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function GalleryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
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
        JPG / PNG / WEBP / PDF · max 20 MB
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
