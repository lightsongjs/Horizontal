import { useCallback, useEffect, useRef, useState } from 'react'
import { signedDownloadUrl, type Attachment } from '../data/attachments'
import { atEnd, step } from '../lib/gallery'
import { Icon } from './Icon'

/** Cât trebuie să alunece degetul ca să conteze ca „următoarea", nu ca o
 *  atingere ratată sau ca o derulare. */
const SWIPE_PX = 48

/**
 * Imaginile pe tot ecranul, ca galerie. Nu într-un tab nou: Horizontal e PWA
 * instalabil, iar un tab nou aruncă utilizatorul în browser, cu un URL semnat
 * urât în bară și o revenire greoaie pe telefon.
 *
 * Primește TOATĂ lista de imagini și indexul, nu o singură imagine: altfel
 * fiecare poză cerea deschis-văzut-închis, iar a doua poză însemna trei
 * atingeri în loc de una.
 *
 * Documentele nu intră în listă. Un PDF nu se „vede" aici, deci o săgeată care
 * ar ajunge pe el ar duce la un ecran gol, iar contorul ar număra altceva decât
 * arată. Ele se descarcă direct din bară.
 */
export function Lightbox({
  items,
  index,
  urlFor,
  canDelete = false,
  onIndex,
  onClose,
  onDelete,
  onError,
}: {
  /** Doar imaginile, în ordinea din bară. */
  items: Attachment[]
  index: number
  /** `undefined` = fără URL utilizabil (offline, sau imagine picată). */
  urlFor: (a: Attachment) => string | undefined
  canDelete?: boolean
  onIndex: (index: number) => void
  onClose: () => void
  onDelete?: (a: Attachment) => void
  onError?: (message: string) => void
}) {
  const current = items[index]
  /** Ștergerea cere două apăsări, ca X-ul din bară: aici greșeala e mai scumpă,
   *  fiindcă butonul stă lângă „Descarcă" și lângă „Închide". */
  const [armed, setArmed] = useState(false)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchX = useRef<number | null>(null)

  const go = useCallback(
    (delta: number) => {
      setArmed(false)
      onIndex(step(items.length, index, delta))
    },
    [items.length, index, onIndex],
  )

  // Escape și săgețile trebuie să rămână ALE galeriei. `SheetHost` are propriul
  // listener de Escape pe `window`, în faza de bubble, care ar închide sheet-ul
  // de dedesubt, iar formularul de sub galerie mută focusul cu ←/→ între
  // butoanele lui. Ascultăm în faza de CAPTURE (care rulează prima) și oprim
  // propagarea, deci ale lor nu se mai declanșează.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.stopPropagation()
        e.preventDefault()
        go(e.key === 'ArrowRight' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, go])

  // Imaginea vecină, cerută din timp. Fără asta, prima săgeată arată o
  // fereastră goală cât ține descărcarea — exact impresia pe care galeria
  // trebuia să o șteargă. `new Image()` nu randează nimic, doar umple cache-ul.
  useEffect(() => {
    for (const near of [items[index - 1], items[index + 1]]) {
      const url = near && urlFor(near)
      if (url) new Image().src = url
    }
  }, [items, index, urlFor])

  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current) }, [])

  // Dezarmare după 3s, ca la X-ul din bară: un buton de ștergere rămas armat e
  // chiar capcana pe care confirmarea din două apăsări trebuia să o închidă.
  const arm = () => {
    if (armTimer.current) clearTimeout(armTimer.current)
    setArmed(true)
    armTimer.current = setTimeout(() => setArmed(false), 3000)
  }

  // `signedDownloadUrl` cheamă `requireSupabase()`, care aruncă SINCRON dacă
  // lipsesc cheile. Fără `try`, butonul ar fi mort iar respingerea ar rămâne
  // netratată. Mesajul îl deține lista de fișiere, nu galeria.
  const download = async () => {
    if (!current) return
    try {
      const href = await signedDownloadUrl(current)
      if (href) window.location.href = href
      else onError?.('Fișierul nu s-a putut descărca.')
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Fișierul nu s-a putut descărca.')
    }
  }

  if (!current) return null
  const url = urlFor(current)
  const many = items.length > 1

  return (
    <div
      className="lb-back"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      // Swipe, pe telefon. Un singur deget și o singură axă: dacă mișcarea e
      // mai mult verticală, nu e răsfoire, e derulare sau o închidere ratată.
      onTouchStart={(e) => { touchX.current = e.touches.length === 1 ? e.touches[0].clientX : null }}
      onTouchEnd={(e) => {
        const from = touchX.current
        touchX.current = null
        if (from === null) return
        const dx = e.changedTouches[0].clientX - from
        if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1)
      }}
    >
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lb-name">{current.filename}</span>
        {many && <span className="lb-count">{index + 1} / {items.length}</span>}
        <div className="lb-actions">
          {canDelete && onDelete && (
            <button
              className={`lb-del ${armed ? 'armed' : ''}`}
              title={armed ? 'Mai apasă o dată ca să ștergi' : 'Șterge'}
              aria-label={armed ? `Confirmă ștergerea ${current.filename}` : `Șterge ${current.filename}`}
              onClick={() => { if (armed) { setArmed(false); onDelete(current) } else arm() }}
            >
              <Icon name="delete" size={16} />
            </button>
          )}
          <button onClick={() => void download()}>Descarcă</button>
          <button onClick={onClose} aria-label="Închide"><Icon name="close" size={16} /></button>
        </div>
      </div>
      <div className="lb-body">
        {url ? (
          <img src={url} alt={current.filename} />
        ) : (
          <span className="lb-off">Imaginea nu e disponibilă offline.</span>
        )}
        {many && (
          <>
            {/* Butoanele stau PESTE imagine, pe margini: pe telefon degetul e
                deja acolo, iar pe web drumul mouse-ului e cel mai scurt.
                Ascunse la capete în loc de dezactivate — un buton mort care
                rămâne pe ecran se apasă oricum, de două ori. */}
            {index > 0 && (
              <button
                className="lb-nav prev"
                aria-label="Imaginea anterioară"
                onClick={(e) => { e.stopPropagation(); go(-1) }}
              >
                <Icon name="back" size={22} />
              </button>
            )}
            {!atEnd(items.length, index) && (
              <button
                className="lb-nav next"
                aria-label="Imaginea următoare"
                onClick={(e) => { e.stopPropagation(); go(1) }}
              >
                <Icon name="forward" size={22} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
