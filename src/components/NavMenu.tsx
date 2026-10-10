import { useHorizontal } from '../store'
import { isPinned, type Pin, type PinKind } from '../lib/pins'
import type { Project } from '../lib/types'
import { isInboxProject } from '../lib/captureTokens'
import { Icon, type IconName } from './Icon'
import { KeyboardSheet } from './KeyboardSheet'

/**
 * Unde duce un rând de navigare (sertar, sidebar, pătrat fixat). Un singur
 * tip pentru toate trei, ca un pătrat fixat să ducă exact unde duce rândul
 * din care a fost fixat.
 */
export type NavTarget =
  | { kind: 'screen'; screen: 'today' | 'week' | 'inbox' }
  | { kind: 'project'; id: string }

/** Ținta unei fixări. Pentru `filter` vine în etapa filtrelor salvate. */
export function pinTarget(p: Pin): NavTarget | null {
  if (p.kind === 'project') return { kind: 'project', id: p.ref }
  if (p.kind === 'list' && (p.ref === 'week' || p.ref === 'inbox')) return { kind: 'screen', screen: p.ref }
  return null
}

/** Eticheta și semnul unei fixări — aceleași în pătrat și în rândul de sidebar. */
export function pinLabel(p: Pin, projects: readonly Project[]): string {
  if (p.kind === 'project') return projects.find((x) => x.id === p.ref)?.name ?? p.ref
  if (p.kind === 'list') return p.ref === 'week' ? '7 zile' : 'Ale mele'
  return p.ref
}

/**
 * Semnul unei fixări. Un proiect obișnuit își arată prefixul în culoarea lui
 * (ca logo-ul din antetul proiectului) — o bulină singură într-un pătrat de
 * 44px nu se citește; Inbox își păstrează iconița.
 */
export function PinGlyph({ pin, projects, size = 20 }: { pin: Pin; projects: readonly Project[]; size?: number }) {
  if (pin.kind === 'project') {
    const p = projects.find((x) => x.id === pin.ref)
    if (!p) return null
    if (isInboxProject(p)) return <span style={{ color: p.accent || undefined, display: 'inline-flex' }}><Icon name="inbox" size={size} /></span>
    return <span className="pin-prefix" style={{ color: p.accent || 'var(--txt-dim)' }}>{p.prefix.slice(0, 2)}</span>
  }
  const icon: IconName = pin.kind === 'list' ? (pin.ref === 'week' ? 'list' : 'people') : 'filter'
  return <Icon name={icon} size={size} />
}

export interface MenuTarget {
  kind: PinKind
  ref: string
  label: string
  /** Click dreapta pe desktop: meniul stă lângă cursor. Fără el, foaie de jos. */
  at?: { x: number; y: number }
}

/**
 * Meniul unui rând de navigare: „Fixează sus" / „Desprinde", plus „Editează"
 * unde există ceva de editat. Pe telefon o foaie de acțiuni (cea a glisării,
 * `.action-sheet`), pe desktop un meniu lângă cursor.
 */
export function PinMenu({ target, onClose, onEdit }: { target: MenuTarget; onClose(): void; onEdit?(): void }) {
  const { pins, pin, unpin } = useHorizontal()
  const pinned = isPinned(pins, target.kind, target.ref)
  const items = (
    <>
      <button
        type="button"
        className="as-item"
        role="menuitem"
        onClick={() => { onClose(); void (pinned ? unpin : pin)(target.kind, target.ref) }}
      >
        <Icon name={pinned ? 'unpin' : 'pin'} size={18} /> {pinned ? 'Desprinde' : 'Fixează sus'}
      </button>
      {onEdit && (
        <button type="button" className="as-item" role="menuitem" onClick={() => { onClose(); onEdit() }}>
          <Icon name="edit" size={18} /> Editează
        </button>
      )}
    </>
  )
  if (!target.at) {
    return (
      <KeyboardSheet onClose={onClose} label={target.label} className="action-sheet">
        <p className="as-title"><span className="as-subject">{target.label}</span></p>
        <div className="as-list">{items}</div>
      </KeyboardSheet>
    )
  }
  // Ținut în ecran: un click dreapta lângă marginea de jos ar fi deschis
  // meniul sub ea.
  const left = Math.min(target.at.x, window.innerWidth - 200)
  const top = Math.min(target.at.y, window.innerHeight - 110)
  return (
    <>
      <div className="ctx-menu-bg" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="ctx-menu" role="menu" aria-label={target.label} style={{ left, top }}>
        {items}
      </div>
    </>
  )
}
