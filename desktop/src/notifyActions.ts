import type { Reminder } from './scheduler'

/**
 * Acțiunile unei notificări D-Bus, perechi (cheie, etichetă). `default` e
 * clicul pe corp (GNOME nu-l arată ca buton) și deschide tichetul; GNOME arată
 * cel mult 3 butoane.
 *
 * Un ping de serie are un singur buton, „Gata" = AM VĂZUT PINGUL (`seen`):
 * închide doar notificarea, seria continuă. Ca `SERIES_SEEN_LABEL` de pe web.
 * Înainte era „Gata azi", care bifa tichetul — iar notificarea e rezidentă
 * (stă pe ecran până la un clic), deci clicul din reflex oprea seria după
 * primul ping (bugul din 10 nov. 2026). Seria se bifează din aplicație.
 */
export function notifyActions(r: Reminder): string[] {
  if (r.kind === 'event') return ['default', 'Deschide']
  if (r.series) return ['default', 'Deschide', 'seen', 'Gata']
  return ['default', 'Deschide', 'done', 'Gata', 'snooze15', '15 min', 'snooze30', '30 min']
}
