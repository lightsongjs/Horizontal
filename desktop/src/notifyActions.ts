import type { Reminder } from './scheduler'

/**
 * Acțiunile unei notificări D-Bus, perechi (cheie, etichetă). `default` e
 * clicul pe corp (GNOME nu-l arată ca buton) și deschide tichetul; GNOME arată
 * cel mult 3 butoane.
 *
 * Un ping de serie are „Am văzut" ÎNAINTEA lui „Gata azi". Notificarea e
 * rezidentă (stă pe ecran până la un clic — vezi `notify.ts`), iar cu „Gata
 * azi" singur, clicul firesc de „am văzut, du-te" bifa tichetul și oprea
 * seria după primul ping (bugul din 10 nov. 2026). „Am văzut" închide doar
 * pingul de pe ecran; următorul vine la ora lui.
 */
export function notifyActions(r: Reminder): string[] {
  if (r.kind === 'event') return ['default', 'Deschide']
  if (r.series) return ['default', 'Deschide', 'seen', 'Am văzut', 'done', 'Gata azi']
  return ['default', 'Deschide', 'done', 'Gata', 'snooze15', '15 min', 'snooze30', '30 min']
}
