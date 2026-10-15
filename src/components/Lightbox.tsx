import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { signedDownloadUrl, type Attachment } from '../data/attachments'
import { atEnd, step } from '../lib/gallery'
import { FIT, isZoomed, pan, pinch, toggleZoom, wheelScale, zoomAt, type Point, type View } from '../lib/zoom'
import { Icon } from './Icon'

/** Cât trebuie să alunece degetul ca să conteze ca „următoarea", nu ca o
 *  atingere ratată sau ca o derulare. */
const SWIPE_PX = 48
/** Sub atât, degetul nu s-a mișcat: e o atingere (tap), nu o tragere. */
const TAP_SLOP = 10
/** Fereastra dublului-tap, în timp și în spațiu. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30

type Gesture = {
  view: View
  /** Pornirea degetului unic (sau a mouse-ului), în coordonate de client. */
  p0: Point
  /** Ciupitul: cele două degete la pornire, față de centrul cutiei. */
  a0?: Point
  b0?: Point
  moved: boolean
  pinched: boolean
}

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
 *
 * Mărirea e a galeriei, nu a paginii: viewport-ul are `user-scalable=no` (foile
 * lipite de tastatură măsoară în pixeli reali), deci ciupitul browserului nu
 * există. Ciupit, tras cu un deget cât e mărită, dublu-tap (încape ↔ 2× la
 * punct), rotița și dublu-click pe desktop; aritmetica e în `lib/zoom.ts`.
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

  const [view, setView] = useState<View>(FIT)
  /** Tranziție doar la salturi (dublu-tap); sub degete urmează fără întârziere. */
  const [animate, setAnimate] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef<{ t: number; p: Point } | null>(null)
  /** O tragere sau un ciupit nu e și un click: fără asta, ridicarea degetului
   *  pe fundal după o tragere ar închide galeria. */
  const swallowClick = useRef(false)
  /** Click-ul care urmează unei apăsări pe imagine nu e al fundalului. Cu
   *  `setPointerCapture` pe cutie, ținta click-ului devine cutia (strămoșul
   *  comun), deci `stopPropagation` de pe `<img>` nu l-ar mai vedea. */
  const downOnImage = useRef(false)
  /** Chromium sintetizează și `dblclick` dintr-un dublu-tap (pe o pagină fără
   *  zoom), deci mărirea s-ar comuta de două ori și s-ar anula. Dublul-tap e
   *  al degetului; `onDoubleClick` rămâne doar pentru mouse/creion. */
  const lastPointerType = useRef('')
  const viewRef = useRef(view)
  viewRef.current = view

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

  // Altă imagine, altă mărire: fiecare se deschide întreagă.
  useEffect(() => {
    setView(FIT)
    setAnimate(false)
    pointers.current.clear()
    gesture.current = null
    lastTap.current = null
  }, [index])

  // Rotit telefonul / redimensionată fereastra: „încape" s-a schimbat, iar o
  // vedere calculată pe vechea cutie ar lăsa margini goale. Înapoi la întreg.
  useEffect(() => {
    const onResize = () => setView(FIT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** Mărimea „încăpută" a imaginii și a cutiei. `offsetWidth` nu vede
   *  `transform`, deci e mereu mărimea de la scara 1. */
  const sizes = () => {
    const img = imgRef.current
    const body = bodyRef.current
    return {
      img: { w: img?.offsetWidth ?? 0, h: img?.offsetHeight ?? 0 },
      box: { w: body?.clientWidth ?? 0, h: body?.clientHeight ?? 0 },
    }
  }
  /** Un punct de client, față de centrul cutiei (sistemul din `lib/zoom`). */
  const local = (p: Point): Point => {
    const r = bodyRef.current?.getBoundingClientRect()
    if (!r) return p
    return { x: p.x - (r.left + r.width / 2), y: p.y - (r.top + r.height / 2) }
  }

  // Rotița mărește la cursor. Ascultător nativ, nu `onWheel`: React îl pune
  // pasiv, iar fără `preventDefault` Ctrl+rotiță ar mări pagina din spate.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const onWheel = (e: WheelEvent) => {
      if (!imgRef.current) return
      e.preventDefault()
      const { img, box } = sizes()
      const v = viewRef.current
      setAnimate(false)
      setView(zoomAt(v, wheelScale(v.s, e.deltaY), local({ x: e.clientX, y: e.clientY }), img, box))
    }
    body.addEventListener('wheel', onWheel, { passive: false })
    return () => body.removeEventListener('wheel', onWheel)
  })

  const startGesture = () => {
    const pts = [...pointers.current.values()]
    const prev = gesture.current
    if (pts.length >= 2) {
      gesture.current = {
        view: viewRef.current, p0: pts[0], a0: local(pts[0]), b0: local(pts[1]),
        moved: true, pinched: true,
      }
    } else if (pts.length === 1) {
      gesture.current = { view: viewRef.current, p0: pts[0], moved: prev?.moved ?? false, pinched: prev?.pinched ?? false }
    } else {
      gesture.current = null
    }
  }

  const zoomToggle = (p: Point) => {
    const { img, box } = sizes()
    setAnimate(true)
    setView(toggleZoom(viewRef.current, local(p), img, box))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    downOnImage.current = !!(e.target as Element).closest('img')
    lastPointerType.current = e.pointerType
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer deja dispărut */ }
    if (pointers.current.size === 0) gesture.current = null
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setAnimate(false)
    startGesture()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    const { img, box } = sizes()
    const pts = [...pointers.current.values()]
    if (pts.length >= 2 && g.a0 && g.b0) {
      setView(pinch(g.view, g.a0, g.b0, local(pts[0]), local(pts[1]), img, box))
      return
    }
    const dx = e.clientX - g.p0.x
    const dy = e.clientY - g.p0.y
    if (Math.hypot(dx, dy) > TAP_SLOP) g.moved = true
    if (isZoomed(g.view)) setView(pan(g.view, dx, dy, img, box))
  }

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (pointers.current.size > 0) {
      // Din ciupit rămâne un deget: continuă ca tragere, de unde e acum.
      startGesture()
      return
    }
    gesture.current = null
    if (!g) return
    if (g.moved || g.pinched) swallowClick.current = true
    if (e.type === 'pointercancel') return
    const dx = e.clientX - g.p0.x
    const dy = e.clientY - g.p0.y
    // Răsfoirea: doar de la „încape", cu un singur deget, pe orizontală. Mărită,
    // aceeași mișcare trage de imagine.
    if (!g.pinched && !isZoomed(g.view) && Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1)
      return
    }
    // Dublul-tap e al degetului; mouse-ul are `onDoubleClick`.
    if (g.moved || g.pinched || e.pointerType === 'mouse') return
    const p = { x: e.clientX, y: e.clientY }
    const prev = lastTap.current
    if (prev && e.timeStamp - prev.t < DOUBLE_TAP_MS && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < DOUBLE_TAP_PX) {
      lastTap.current = null
      zoomToggle(p)
    } else {
      lastTap.current = { t: e.timeStamp, p }
    }
  }

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
  const zoomed = isZoomed(view)

  // În `document.body`, mereu: galeria se deschide din foi (`.sheet`) care au
  // `transform`, iar sub un strămoș cu `transform` un `position: fixed` se
  // așază față de el, nu față de ecran — galeria rămânea prinsă (și tăiată) în
  // dreptunghiul foii. Asta, plus `max-height: 100%` nerezolvat într-un rând de
  // grid, era „se vede un sfert din poză".
  return createPortal(
    <div
      className="lb-back"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      // Prin portal, evenimentele React urcă tot pe arborele componentelor:
      // gesturile galeriei nu sunt ale foii de dedesubt (tras-în-jos, glisări).
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
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
      <div
        ref={bodyRef}
        className={`lb-body${zoomed ? ' zoomed' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          const swallow = swallowClick.current || downOnImage.current
          swallowClick.current = false
          downOnImage.current = false
          if (swallow) e.stopPropagation()
        }}
      >
        {url ? (
          <img
            ref={imgRef}
            key={current.id}
            src={url}
            alt={current.filename}
            draggable={false}
            className={animate ? 'anim' : undefined}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
            // Atingerea pe imagine nu închide: poate fi începutul unui
            // dublu-tap. Închid fundalul din jurul ei, X-ul și Esc.
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (lastPointerType.current !== 'touch') zoomToggle({ x: e.clientX, y: e.clientY })
            }}
          />
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
    </div>,
    document.body,
  )
}
