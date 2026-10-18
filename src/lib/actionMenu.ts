/**
 * Meniul de acțiuni al modului Vim (`m`), ca DATE: ce scrie pe fiecare rând,
 * litera lui (aceeași cu tasta directă — `t` dată, `D` mâine, `!` urgent…),
 * sub-meniurile și motivul pentru care un rând e stins.
 *
 * Pur, fără React: componenta (`ActionMenu`) doar desenează și trimite mai
 * departe ce s-a ales; dispecerul (`src/vim.tsx`) execută prin `TaskActions`.
 * Macheta: `overlayOpts()` din `design/vim-nav/index.html`.
 */
import type { DatePreset } from './bulkActions'
import { addDays, startOfLocalDay } from './schedule'
import { nextMonday } from './bulkActions'

export type MenuLevel = 'root' | 'date' | 'wave' | 'move'

/** Ce face un rând ales. `sub` deschide un sub-meniu; restul se execută. */
export type MenuAction =
  | { kind: 'sub'; level: Exclude<MenuLevel, 'root'> }
  | { kind: 'date'; preset: DatePreset }
  | { kind: 'calendar' }
  | { kind: 'urgent' } | { kind: 'pin' } | { kind: 'done' } | { kind: 'delete' }
  | { kind: 'rename' } | { kind: 'yank' } | { kind: 'handoff' }
  | { kind: 'wave'; value: number }
  | { kind: 'move'; projectId: string }

export interface MenuItem {
  /** Litera (tasta). `Del` = Delete. */
  key: string
  label: string
  action: MenuAction
  /** Motivul pentru care nu se poate (rândul stă stins, cu motivul lângă). */
  disabled?: string | null
  danger?: boolean
}

export interface MenuTargets {
  count: number
  /** Toate țintele sunt deja urgente / fixate / gata — atunci rândul scoate. */
  allUrgent: boolean
  allPinned: boolean
  allDone: boolean
  /** Valurile în care se pot muta (toate țintele în proiectul încărcat). Gol = rândul e stins. */
  waves: { number: number; label: string }[]
  /** De ce nu se poate alege valul, când `waves` e gol. */
  wavesWhy: string | null
  /** Proiectele-țintă ale mutării (un singur tichet). */
  projects: { id: string; name: string }[]
  /** Motivul refuzului mutării (dependențe, obstacol, ID provizoriu), dacă e unul. */
  moveWhy: string | null
}

const ONE = 'doar pe un tichet'

export function rootItems(t: MenuTargets): MenuItem[] {
  const many = t.count > 1 ? ONE : null
  return [
    { key: 't', label: 'Dată și oră', action: { kind: 'sub', level: 'date' } },
    { key: 'D', label: 'Mâine', action: { kind: 'date', preset: { kind: 'tomorrow' } } },
    { key: '-', label: 'Fără dată (scoate data, ora, mementoul)', action: { kind: 'date', preset: { kind: 'none' } } },
    { key: '!', label: t.allUrgent ? 'Nu mai e urgent' : 'Urgent', action: { kind: 'urgent' } },
    { key: 'F', label: t.allPinned ? 'Scoate de sus' : 'Fixează sus', action: { kind: 'pin' } },
    { key: 'w', label: 'Val', action: { kind: 'sub', level: 'wave' }, disabled: t.waves.length ? null : t.wavesWhy ?? 'proiectul n-are valuri' },
    { key: 'M', label: 'Mută în proiect', action: { kind: 'sub', level: 'move' }, disabled: many },
    { key: '@', label: 'Pasează', action: { kind: 'handoff' }, disabled: many },
    { key: 'r', label: 'Redenumește', action: { kind: 'rename' }, disabled: many },
    { key: 'x', label: t.allDone ? 'Redeschide' : 'Gata', action: { kind: 'done' } },
    { key: 'y', label: 'Copiază linkul', action: { kind: 'yank' }, disabled: many },
    { key: 'Del', label: 'Șterge (u anulează)', action: { kind: 'delete' }, danger: true },
  ]
}

export function dateItems(now: Date): MenuItem[] {
  const today = startOfLocalDay(now)
  return [
    { key: 'a', label: 'Azi', action: { kind: 'date', preset: { kind: 'today' } } },
    { key: 'm', label: 'Mâine', action: { kind: 'date', preset: { kind: 'tomorrow' } } },
    { key: 'l', label: 'Luni', action: { kind: 'date', preset: { kind: 'pick', date: nextMonday(now), time: null } } },
    { key: 's', label: '+1 săptămână', action: { kind: 'date', preset: { kind: 'pick', date: addDays(today, 7), time: null } } },
    { key: 'c', label: 'Alege din calendar…', action: { kind: 'calendar' } },
    { key: 'z', label: 'Zi întreagă (scoate ora)', action: { kind: 'date', preset: { kind: 'allDay' } } },
    { key: '-', label: 'Fără dată', action: { kind: 'date', preset: { kind: 'none' } } },
  ]
}

/** Valurile și proiectele se aleg cu cifre: 1…9. */
export function waveItems(t: MenuTargets): MenuItem[] {
  return t.waves.slice(0, 9).map((w, i) => ({ key: String(i + 1), label: w.label, action: { kind: 'wave', value: w.number } }))
}

export function moveItems(t: MenuTargets): MenuItem[] {
  return t.projects.slice(0, 9).map((p, i) => ({ key: String(i + 1), label: p.name, action: { kind: 'move', projectId: p.id } }))
}

/** Rândul ales după tastă: litera exactă; `Delete` = rândul `Del`. */
export function itemForKey(items: MenuItem[], key: string): MenuItem | undefined {
  if (key === 'Delete') return items.find((i) => i.key === 'Del')
  return items.find((i) => i.key === key)
}

/**
 * Cifrele tastate în sub-meniul datei → o oră `HH:MM`, sau null dacă nu e una
 * validă. `9` → 09:00, `15` → 15:00, `930` → 09:30, `1530` → 15:30.
 */
export function timeFromDigits(d: string): string | null {
  if (!/^\d{1,4}$/.test(d)) return null
  const h = d.length <= 2 ? Number(d) : Number(d.slice(0, d.length - 2))
  const m = d.length <= 2 ? 0 : Number(d.slice(-2))
  if (h > 23 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Cel mult patru cifre: a cincea o împinge afară pe prima, ca la un ceas. */
export function pushDigit(d: string, digit: string): string {
  return (d + digit).slice(-4)
}

export const LEVEL_TITLE: Record<MenuLevel, string> = {
  root: 'Acțiuni',
  date: 'Dată și oră',
  wave: 'Val',
  move: 'Mută în proiect',
}
