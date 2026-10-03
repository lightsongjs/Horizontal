import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { repository } from '../data'
import {
  deleteAttachment,
  isRenderableImage,
  listAttachments,
  signedDownloadUrl,
  signedUrls,
  uploadPicked,
  type Attachment,
} from '../data/attachments'
import { afterDelete } from '../lib/gallery'
import { isTempIssueId } from '../lib/issueId'
import { pickFiles, rejectMessage } from '../lib/pickFiles'
import { iconFor } from './Attachments'
import { Icon } from './Icon'
import { Lightbox } from './Lightbox'

/** Ca în `Attachments.tsx`: fișierele există doar cu Supabase în spate. */
const ENABLED = import.meta.env.VITE_DATA_SOURCE === 'supabase'

/** O atingere pe un buton din foaie nu ia focusul (tastatura rămâne cum e). */
const keepFocus = (e: PointerEvent) => e.preventDefault()

/**
 * De ce nu se poate atașa ACUM, sau null.
 *
 * Fișierele nu trec prin coada offline (`offlineRepository`): octeții unei
 * poze n-au ce căuta în IndexedDB lângă tichete, iar o încărcare reluată la
 * nesfârșit pe un semnal slab ar arde bateria fără să spună nimic. Un refuz
 * vizibil la atingere e mai cinstit decât o poză care „pare" atașată.
 */
export function attachBlocked(issueId?: string): string | null {
  if (!ENABLED) return 'Fișierele cer contul (Supabase), nu modul local.'
  const offline = navigator.onLine === false || !!repository.sync?.status().offline
  if (offline) return 'Necesită rețea'
  // Un tichet creat offline are un ID provizoriu până la sincronizare; calea
  // din Storage și rândul din `attachments` ar rămâne legate de un ID care nu
  // va exista.
  if (issueId && isTempIssueId(issueId)) return 'Necesită rețea'
  return null
}

/** Poze sau fișiere, după ce s-a ales — pentru textul toastului. */
export function filesNoun(files: readonly { type: string }[]): string {
  const n = files.length
  const all = files.every((f) => f.type.startsWith('image/'))
  if (all) return n === 1 ? '1 poză' : `${n} poze`
  return n === 1 ? '1 fișier' : `${n} fișiere`
}

/**
 * Agrafa din rândul de controale: o atingere deschide un meniu mic cu „Fă o
 * poză" și „Alege fișier". Două intrări, nu una: pe Android un singur input
 * fără `capture` deschide galeria sau managerul de fișiere, iar camera ar fi
 * la trei atingeri distanță — exact cazul pentru care există butonul (o poză
 * a tablei, a bonului).
 *
 * Inputurile sunt separate, ca în `AttachmentPicker`: Safari citește
 * atributele în momentul gestului, deci ce e scris în JSX e ce vede.
 */
export function AttachButton({
  onPick,
  blocked,
  onBlocked,
  count = 0,
  thumb,
  disabled,
}: {
  onPick(files: File[]): void
  /** Motivul pentru care atingerea nu deschide meniul (se arată ca toast). */
  blocked?: () => string | null
  onBlocked?(reason: string): void
  /** Câte fișiere așteaptă (foaia rapidă le ține până la trimitere). */
  count?: number
  /** Miniatura primei poze care așteaptă. */
  thumb?: string | null
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const any = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: globalThis.PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const toggle = () => {
    const why = blocked?.() ?? null
    if (why) { onBlocked?.(why); return }
    setOpen((v) => !v)
  }
  const choose = (input: HTMLInputElement | null) => {
    setOpen(false)
    input?.click()
  }
  // Resetul lui `value` e obligatoriu: fără el, același fișier ales a doua
  // oară nu mai declanșează `change`. Lista goală = anulat, nu eroare.
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length) onPick(files)
  }

  return (
    <span className="qs-attach-wrap" ref={wrap}>
      <button
        type="button"
        className={`qs-ico qs-attach ${count ? 'on' : ''} ${thumb ? 'has-thumb' : ''}`}
        aria-label={count ? `Atașează (${count} alese)` : 'Atașează'}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Fă o poză sau alege un fișier"
        disabled={disabled}
        onPointerDown={keepFocus}
        onClick={toggle}
      >
        {thumb ? <img src={thumb} alt="" /> : <Icon name="attachment" size={16} />}
        {count > 0 && <span className="qs-attach-n">{count}</span>}
      </button>
      {open && (
        <span className="qs-attach-menu" role="menu">
          <button type="button" role="menuitem" onPointerDown={keepFocus} onClick={() => choose(camera.current)}>
            <Icon name="camera" size={16} /> Fă o poză
          </button>
          <button type="button" role="menuitem" onPointerDown={keepFocus} onClick={() => choose(any.current)}>
            <Icon name="attachment" size={16} /> Alege fișier
          </button>
        </span>
      )}
      {/* `capture` exclude `multiple`: camera pornește pentru un singur cadru. */}
      <input ref={camera} className="att-pick-input" type="file" accept="image/*" capture="environment" onChange={handle} />
      <input ref={any} className="att-pick-input" type="file" multiple onChange={handle} />
    </span>
  )
}

interface Pending {
  key: string
  name: string
  /** URL local (`blob:`) pentru o poză, ca miniatura să apară înainte de urcare. */
  preview: string | null
}

export interface TicketFiles {
  items: Attachment[]
  urls: Record<string, string>
  pending: Pending[]
  add(files: File[]): void
  remove(a: Attachment): Promise<void>
}

/**
 * Fișierele unui tichet existent, pentru foaia de pe telefon. Aceeași listă ca
 * bara formularului complet (inclusiv cele urcate din fir — „am atașat ceva"
 * trebuie să fie adevărat peste tot), iar ce se urcă de aici se leagă de
 * TICHET (`event_id` null), nu de un comentariu.
 */
export function useTicketFiles(issueId: string, projectId: string, onError: (m: string) => void): TicketFiles {
  const [items, setItems] = useState<Attachment[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Pending[]>([])
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  useEffect(() => {
    if (!ENABLED || isTempIssueId(issueId)) return
    let stale = false
    void (async () => {
      try {
        const list = await listAttachments(issueId)
        if (stale) return
        setItems(list)
        const imgs = list.filter((a) => isRenderableImage(a.contentType))
        if (imgs.length) {
          const fresh = await signedUrls(imgs.map((a) => a.path))
          if (!stale) setUrls(fresh)
        }
      } catch {
        // Offline sau fără drept: rândul pur și simplu nu apare. Bara din
        // formularul complet spune eroarea; aici n-ar avea unde.
      }
    })()
    return () => { stale = true }
  }, [issueId])

  const add = useCallback((files: File[]) => {
    const picked = pickFiles({ types: ['Files'], files })
    const msg = rejectMessage(picked.rejected)
    if (msg) onErrorRef.current(msg)
    const jobs = picked.accept.map((file, i) => ({
      file,
      name: picked.renamed[i],
      p: {
        key: crypto.randomUUID(),
        name: file.name,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      } as Pending,
    }))
    if (!jobs.length) return
    setPending((prev) => [...prev, ...jobs.map((j) => j.p)])
    void (async () => {
      for (const j of jobs) {
        try {
          const saved = await uploadPicked({ issueId, projectId, file: j.file, name: j.name })
          if (isRenderableImage(saved.contentType)) {
            const fresh = await signedUrls([saved.path]).catch(() => ({}))
            if (live.current) setUrls((prev) => ({ ...prev, ...fresh }))
          }
          if (live.current) setItems((prev) => [...prev, saved])
        } catch (e) {
          onErrorRef.current(e instanceof Error ? e.message : 'Fișierul nu s-a putut urca.')
        } finally {
          if (j.p.preview) URL.revokeObjectURL(j.p.preview)
          if (live.current) setPending((prev) => prev.filter((x) => x.key !== j.p.key))
        }
      }
    })()
  }, [issueId, projectId])

  const remove = useCallback(async (a: Attachment) => {
    try {
      await deleteAttachment(a)
      setItems((prev) => prev.filter((x) => x.id !== a.id))
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : 'Fișierul nu s-a putut șterge.')
    }
  }, [])

  return { items, urls, pending, add, remove }
}

/**
 * Rândul de miniaturi de 44px dintre titlu și descriere. Apare numai când
 * există fișiere: un rând gol ar împinge descrierea în jos pentru nimic, iar
 * agrafa din rândul de controale spune deja că se poate atașa.
 *
 * Ștergerea stă în galerie (`Lightbox`), nu pe miniatură: X-ul de 18px de pe
 * o miniatură de 44px, sub degetul mare, ar fi fost o ștergere din greșeală.
 */
export function ThumbRow({ files, canDelete, onError }: { files: TicketFiles; canDelete: boolean; onError(m: string): void }) {
  const { items, urls, pending } = files
  const [viewing, setViewing] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const images = items.filter((a) => isRenderableImage(a.contentType))
  const viewIndex = viewing === null ? -1 : images.findIndex((a) => a.id === viewing)

  if (!items.length && !pending.length) return null

  const openItem = async (a: Attachment) => {
    if (isRenderableImage(a.contentType)) { setViewing(a.id); return }
    try {
      const url = await signedDownloadUrl(a)
      if (url) window.location.href = url
      else onError('Fișierul nu s-a putut descărca.')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Fișierul nu s-a putut descărca.')
    }
  }
  const removeViewed = (a: Attachment) => {
    const rest = images.filter((x) => x.id !== a.id)
    const next = afterDelete(images.length, images.findIndex((x) => x.id === a.id))
    setViewing(next === null ? null : (rest[next]?.id ?? null))
    void files.remove(a)
  }

  return (
    <div className="es-files att-strip" aria-label="Fișiere atașate">
      {items.map((a) => {
        const isImg = isRenderableImage(a.contentType)
        const url = urls[a.path]
        const shown = isImg && url && !broken.has(a.path)
        return (
          <span key={a.id} className={`att-chip ${isImg ? 'img' : 'file'}`}>
            <button
              type="button"
              className="att-open"
              onPointerDown={keepFocus}
              onClick={() => void openItem(a)}
              title={a.filename}
            >
              {shown ? (
                <img src={url} alt={a.filename} loading="lazy" onError={() => setBroken((prev) => new Set(prev).add(a.path))} />
              ) : (
                <span className={`att-ic ${isImg ? 'off' : ''}`}><Icon name={isImg ? 'fileImage' : iconFor(a.contentType, a.filename)} size={20} /></span>
              )}
            </button>
          </span>
        )
      })}
      {/* Cât se urcă: poza locală, sub un văl cu rotița. Supabase nu dă
          progres pe octeți la `upload`, deci starea e „se urcă", nu un procent
          inventat. */}
      {pending.map((p) => (
        <span key={p.key} className="att-chip img es-file-up" role="status" aria-label={`Se urcă ${p.name}`}>
          {p.preview ? <img src={p.preview} alt="" /> : <span className="att-ic off"><Icon name="attachment" size={20} /></span>}
          <span className="es-file-veil"><Icon name="loading" size={16} /></span>
        </span>
      ))}
      {/* În `document.body`: foaia e `position: fixed` cu propriul z-index,
          deci galeria ar fi rămas prinsă în stratul ei. */}
      {viewIndex >= 0 && createPortal(
        <Lightbox
          items={images}
          index={viewIndex}
          urlFor={(a) => (broken.has(a.path) ? undefined : urls[a.path])}
          canDelete={canDelete}
          onIndex={(i) => setViewing(images[i]?.id ?? null)}
          onDelete={removeViewed}
          onClose={() => setViewing(null)}
          onError={onError}
        />,
        document.body,
      )}
    </div>
  )
}
