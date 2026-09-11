import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  deleteAttachment,
  isRenderableImage,
  listAttachments,
  signedDownloadUrl,
  signedUrls,
  uploadAttachment,
  type Attachment,
} from '../data/attachments'
import { carriesFiles, pickFiles, rejectMessage } from '../lib/pickFiles'
import { attachmentFilename, shrinkImage } from '../lib/shrinkImage'
import { Lightbox } from './Lightbox'
import { AttachmentPicker } from './AttachmentPicker'
import { Icon, type IconName } from './Icon'

/** Doar în modul Supabase: attachment-urile n-au sens în modul local seeded. */
const ENABLED = import.meta.env.VITE_DATA_SOURCE === 'supabase'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Iconiță după tip. Nu încercăm să fim exhaustivi — doar să nu arate toate la fel. */
function iconFor(contentType: string, filename: string): IconName {
  if (contentType === 'application/pdf') return 'fileDoc'
  if (contentType.startsWith('image/')) return 'fileImage'
  if (contentType.startsWith('video/')) return 'fileVideo'
  if (contentType.startsWith('audio/')) return 'fileAudio'
  if (/\.(zip|rar|7z|tar|gz)$/i.test(filename)) return 'fileArchive'
  if (/\.(json|ts|tsx|js|jsx|css|html|sql|sh|py|md)$/i.test(filename)) return 'fileCode'
  return 'attachment'
}

/**
 * Fișierele tichetului, ca o bară de 36px deasupra descrierii.
 *
 * Înainte era un bloc sub notițe, adică sub o descriere care poate fi lungă: se
 * ajungea la el doar cu scroll, deci nu răspundea la întrebarea pentru care
 * există — „am deja atașamente?". O bară de o singură linie o poate ține în
 * câmpul vizual permanent, dar numai dacă nu poartă niciun cuvânt în plus:
 * titlul secțiunii, descrierile butoanelor și îndemnul de paste au plecat în
 * `title`/`aria-label`. Miniaturile SUNT lista, iconița-ancoră e eticheta.
 */
export function Attachments({
  issueId,
  projectId,
  readOnly = false,
  dropZone,
  onDropActive,
}: {
  issueId?: string
  projectId: string
  readOnly?: boolean
  /** Unde se poate LĂSA un fișier tras cu mouse-ul. O bară de 36px e o țintă
   *  proastă de drop, deci zona rămâne mare: formularul dă aici coloana de
   *  descriere. Fără prop, nu există drop deloc (cazul read-only). */
  dropZone?: RefObject<HTMLElement | null>
  /** Evidențierea zonei de drop o pune părintele, pe nodul lui. Componenta
   *  asta nu randează `dropZone`, iar un `classList.add` pe un nod al altcuiva
   *  se bate cu React la următoarea randare. */
  onDropActive?: (active: boolean) => void
}) {
  const [items, setItems] = useState<Attachment[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [viewing, setViewing] = useState<Attachment | null>(null)
  /** Căile ale căror imagini n-au putut fi încărcate (tipic: offline). */
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const dragDepth = useRef(0)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canEdit = !readOnly && !!issueId

  const load = useCallback(async () => {
    if (!ENABLED || !issueId) return
    try {
      const list = await listAttachments(issueId)
      setItems(list)
      const images = list.filter((a) => isRenderableImage(a.contentType))
      if (images.length) setUrls(await signedUrls(images.map((a) => a.path)))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Fișierele nu s-au putut încărca.')
    }
  }, [issueId])

  useEffect(() => { void load() }, [load])

  useEffect(() => { onDropActive?.(dragging) }, [dragging, onDropActive])

  /** Dezarmează X-ul după 3s, altfel un X rămas armat devine chiar capcana pe
   *  care confirmarea din două atingeri trebuia să o închidă. */
  const arm = useCallback((id: string) => {
    if (armTimer.current) clearTimeout(armTimer.current)
    setArmed(id)
    armTimer.current = setTimeout(() => setArmed(null), 3000)
  }, [])

  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current) }, [])

  // Dezarmarea la atingere in alta parte. Fara ea, un X ramas armat e chiar
  // capcana pe care confirmarea din doua atingeri trebuia sa o inchida: te
  // razgandesti, atingi altundeva, iar butonul rămâne armat cateva secunde.
  //
  // Garda `.closest('.att-del')` lasa in pace atingerea care ARMEAZA butonul si
  // pe cea care confirma: altfel prima atingere s-ar dezarma singura.
  useEffect(() => {
    if (!armed) return
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest('.att-del')) return
      if (armTimer.current) clearTimeout(armTimer.current)
      setArmed(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [armed])

  const addFiles = useCallback(
    async (types: readonly string[], files: readonly File[]) => {
      if (!issueId) return
      const picked = pickFiles({ types, files })
      setMessage(rejectMessage(picked.rejected))
      if (picked.accept.length === 0) return

      setBusy((n) => n + picked.accept.length)
      for (const [index, original] of picked.accept.entries()) {
        try {
          const small = await shrinkImage(original)
          // Numele de bază e cel sintetizat dacă browserul a dat unul generic
          // (screenshot-urile lipite ajung toate `image.png`), altfel cel real.
          // Extensia urmează formatul CHIAR produs de micșorare.
          const base = picked.renamed[index] ?? original.name
          const changed = small !== original
          const filename = attachmentFilename(
            base,
            changed ? (small.type as 'image/jpeg' | 'image/webp') : null,
          )
          const saved = await uploadAttachment({ issueId, projectId, file: small, filename })
          setItems((prev) => [...prev, saved])
          if (isRenderableImage(saved.contentType)) {
            // Se așteaptă ÎNAINTE de setState: un `await` în funcția de
            // actualizare n-ar fi așteptat de React, iar `urls` ar primi o
            // promisiune în loc de un URL.
            const fresh = await signedUrls([saved.path])
            setUrls((prev) => ({ ...prev, ...fresh }))
          }
        } catch (e) {
          setMessage(e instanceof Error ? e.message : 'Fișierul nu s-a putut urca.')
        } finally {
          setBusy((n) => n - 1)
        }
      }
    },
    [issueId, projectId],
  )

  // Paste. Se ascultă pe `document` fiindcă cursorul e aproape sigur în
  // descriere sau notițe, nu în zona de fișiere, deci un `onPaste` pe container
  // n-ar vedea niciodată evenimentul.
  //
  // Regula care închide ambiguitatea: dacă clipboardul poartă fișiere, e
  // attachment, ORIUNDE ar fi cursorul — un paste de imagine într-un textarea
  // n-ar face nimic oricum. Paste-ul de text rămâne complet neatins fiindcă
  // renunțăm imediat când nu există fișiere. Nicio euristică pe focus.
  //
  // Nu e nevoie de urmărirea sheet-ului din vârf: SheetHost randează exact un
  // copil, deci componenta e montată doar cât e vizibilă.
  useEffect(() => {
    if (!ENABLED || !canEdit) return
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData
      if (!dt) return
      const files = Array.from(dt.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      // Prezența fișierelor e deja dovedită mai sus, deci o afirmăm în loc să o
      // deducem din `types`. Adulmecarea lui `types` are rost doar pe calea de
      // drop, unde nu avem încă lista de fișiere.
      void addFiles(['Files'], files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [canEdit, addFiles])

  // Drag & drop pe zona primită de la părinte (coloana de descriere), nu pe
  // bară. Ascultători nativi, fiindcă nodul nu e randat de componenta asta.
  useEffect(() => {
    const node = dropZone?.current
    if (!ENABLED || !canEdit || !node) return

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(Array.from(e.dataTransfer?.types ?? []))) return
      dragDepth.current += 1
      setDragging(true)
    }
    // Obligatoriu: fără preventDefault pe dragover, drop-ul nu e permis deloc
    // și browserul navighează la fișier.
    const onOver = (e: DragEvent) => {
      if (carriesFiles(Array.from(e.dataTransfer?.types ?? []))) e.preventDefault()
    }
    // Contor, nu boolean: dragleave se declanșează și la trecerea în
    // elementele-copil, iar un boolean face evidențierea să pâlpâie.
    //
    // Nu punem gardă `carriesFiles(...)` aici ca la celelalte trei handlere:
    // la `dragleave` unele browsere expun `dataTransfer.types` gol din motive
    // de securitate, iar o gardă ar putea bloca decrementul și ar lăsa
    // `dragDepth` blocat peste zero — evidențierea ar rămâne aprinsă la
    // nesfârșit. Decrementul negardat e sigur fiindcă adunăm mai jos la 0.
    const onLeave = () => {
      dragDepth.current -= 1
      if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) }
    }
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(Array.from(e.dataTransfer?.types ?? []))) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      void addFiles(Array.from(e.dataTransfer?.types ?? []), Array.from(e.dataTransfer?.files ?? []))
    }

    node.addEventListener('dragenter', onEnter)
    node.addEventListener('dragover', onOver)
    node.addEventListener('dragleave', onLeave)
    node.addEventListener('drop', onDrop)
    return () => {
      node.removeEventListener('dragenter', onEnter)
      node.removeEventListener('dragover', onOver)
      node.removeEventListener('dragleave', onLeave)
      node.removeEventListener('drop', onDrop)
      dragDepth.current = 0
      setDragging(false)
    }
  }, [dropZone, canEdit, addFiles])

  if (!ENABLED) return null

  const openItem = async (a: Attachment) => {
    if (isRenderableImage(a.contentType)) {
      setViewing(a)
      return
    }
    try {
      const url = await signedDownloadUrl(a)
      if (url) window.location.href = url
      else setMessage('Fișierul nu s-a putut descărca.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Fișierul nu s-a putut descărca.')
    }
  }

  const remove = async (a: Attachment) => {
    setArmed(null)
    try {
      await deleteAttachment(a)
      setItems((prev) => prev.filter((x) => x.id !== a.id))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Fișierul nu s-a putut șterge.')
    }
  }

  // Read-only fără fișiere: bara n-ar spune nimic și n-ar oferi nimic.
  if (readOnly && items.length === 0) return null

  return (
    <div className="att-zone">
      <div className="att-bar">
        <span className="att-anchor" title="Fișiere atașate">
          <Icon name="attachment" size={14} />
          {items.length > 0 && <span className="att-n">{items.length}</span>}
        </span>

        <div className="att-strip">
          {items.map((a) => {
            const isImg = isRenderableImage(a.contentType)
            const url = urls[a.path]
            const shown = isImg && url && !broken.has(a.path)
            return (
              <span key={a.id} className={`att-chip ${isImg ? 'img' : 'file'}`}>
                <button
                  className="att-open"
                  onClick={() => void openItem(a)}
                  title={`${a.filename} · ${humanSize(a.size)}`}
                >
                  {shown ? (
                    <img
                      src={url}
                      alt={a.filename}
                      loading="lazy"
                      // URL-urile semnate nu funcționează offline, iar shell-ul
                      // aplicației e precachat — fără asta, bara s-ar randa cu
                      // imagini moarte, care se citesc ca pierdere de date.
                      // Marcăm calea în state și randăm iconița de tip în loc;
                      // nu umblăm în DOM cu mâna.
                      onError={() => setBroken((prev) => new Set(prev).add(a.path))}
                    />
                  ) : isImg ? (
                    <span className="att-ic off"><Icon name="fileImage" size={14} /></span>
                  ) : (
                    <>
                      <span className="att-ic"><Icon name={iconFor(a.contentType, a.filename)} size={14} /></span>
                      <span className="att-name">{a.filename}</span>
                    </>
                  )}
                </button>
                {canEdit && (
                  <button
                    className={`att-del ${armed === a.id ? 'armed' : ''}`}
                    aria-label={armed === a.id ? `Confirmă ștergerea ${a.filename}` : `Șterge ${a.filename}`}
                    title={armed === a.id ? 'Mai apasă o dată ca să ștergi' : 'Șterge'}
                    onClick={() => (armed === a.id ? void remove(a) : arm(a.id))}
                  >
                    <Icon name={armed === a.id ? 'delete' : 'close'} size={11} />
                  </button>
                )}
              </span>
            )
          })}
          {busy > 0 && <span className="att-chip busy" role="status">{busy}</span>}
        </div>

        {!readOnly && (
          <AttachmentPicker
            onPick={(files) => void addFiles(['Files'], files)}
            disabled={busy > 0}
            blocked={!issueId}
            onBlocked={() => setMessage('Salvează tichetul, apoi atașează fișiere.')}
          />
        )}
      </div>

      {message && (
        <div className="att-msg" role="status">
          {message}
          <button className="att-msg-x" onClick={() => setMessage(null)} aria-label="Închide mesajul"><Icon name="close" size={16} /></button>
        </div>
      )}

      {viewing && (
        <Lightbox
          attachment={viewing}
          url={broken.has(viewing.path) ? undefined : urls[viewing.path]}
          onClose={() => setViewing(null)}
          onError={setMessage}
        />
      )}
    </div>
  )
}
