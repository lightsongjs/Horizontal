import { useEffect } from 'react'
import { signedDownloadUrl, type Attachment } from '../data/attachments'

/**
 * Imaginea pe tot ecranul, în aplicație. Nu într-un tab nou: Horizontal e PWA
 * instalabil, iar un tab nou aruncă utilizatorul în browser, cu un URL semnat
 * urât în bară și o revenire greoaie pe telefon.
 */
export function Lightbox({
  attachment,
  url,
  onClose,
  onError,
}: {
  attachment: Attachment
  url?: string
  onClose: () => void
  onError?: (message: string) => void
}) {
  // Escape trebuie să închidă DOAR lightbox-ul. `SheetHost` are propriul
  // listener de Escape pe `window`, în faza de bubble, care ar închide sheet-ul
  // de dedesubt. Ascultăm în faza de CAPTURE (care rulează prima) și oprim
  // propagarea, deci al lui nu se mai declanșează.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // `signedDownloadUrl` cheamă `requireSupabase()`, care aruncă SINCRON dacă
  // lipsesc cheile. Fără `try`, butonul ar fi mort iar respingerea ar rămâne
  // netratată. Mesajul îl deține lista de fișiere, nu lightbox-ul.
  const download = async () => {
    try {
      const href = await signedDownloadUrl(attachment)
      if (href) window.location.href = href
      else onError?.('Fișierul nu s-a putut descărca.')
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Fișierul nu s-a putut descărca.')
    }
  }

  return (
    <div className="lb-back" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lb-name">{attachment.filename}</span>
        <div className="lb-actions">
          <button onClick={() => void download()}>Descarcă</button>
          <button onClick={onClose} aria-label="Închide">✕</button>
        </div>
      </div>
      <div className="lb-body">
        {url ? (
          <img src={url} alt={attachment.filename} />
        ) : (
          <span style={{ color: '#fff', fontSize: 13 }}>Imaginea nu e disponibilă offline.</span>
        )}
      </div>
    </div>
  )
}
