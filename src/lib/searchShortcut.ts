// Scurtătura căutării de tichete: Ctrl+K (⌘K pe Mac), ca în Slack — decizia
// omului, 2026-11-06. Înainte erau O și Ctrl+F; Ctrl+F e iar căutarea din
// pagină a browserului.

/** Ce scrie lângă „Caută” (bara laterală, panoul de taste). */
export const SEARCH_SHORTCUT_LABEL = 'Ctrl K'

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/**
 * Ctrl+K sau ⌘K, fără Alt și fără Shift (Ctrl+Shift+K e altceva: în
 * CodeMirror șterge rândul; AltGr de pe Windows vine ca Ctrl+Alt).
 *
 * Întâi litera (`key`): pe un aranjament latin (RO, US, Dvorak) e cea de pe
 * tastă. Numai când litera nu e latină (chirilic, grec) contează tasta fizică
 * (`code`), ca la `paneSwitchTarget` — altfel Ctrl+T pe Dvorak, care stă pe
 * tasta fizică K, ar fi deschis căutarea.
 */
export function isSearchShortcut(e: KeyLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false
  const k = e.key.toLowerCase()
  if (k === 'k') return true
  if (/^[a-z]$/.test(k)) return false
  return e.code === 'KeyK'
}
