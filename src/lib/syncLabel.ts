import type { SyncStatus } from '../data/offline/types'

/**
 * Textul indicatorului din header, sau null când n-are ce spune — absența e
 * informația. „se trimite" doar cât o golire chiar e în curs: o coadă oprită
 * (sesiune expirată, așteptarea reîncercării) care s-ar anunța „se trimite"
 * la nesfârșit ar minți exact când omul se uită de ce nu pleacă nimic.
 * O golire care termină repede (fiecare captură) nu aprinde nimic: fără
 * elemente în așteptare, „se trimite" singur ar clipi la fiecare sarcină.
 */
export function syncLabel(s: SyncStatus): string | null {
  const state = s.offline ? 'offline' : s.syncing && s.pending > 0 ? 'se trimite' : null
  const count = s.pending > 0 ? `${s.pending} în așteptare` : null
  const parts = [state, count].filter((x): x is string => x !== null)
  return parts.length ? parts.join(' · ') : null
}
