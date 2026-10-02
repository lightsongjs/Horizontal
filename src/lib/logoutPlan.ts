/**
 * Ce face deconectarea, dată fiind coada. Pură, ca decizia să aibă test:
 * `refuse` offline (signOut-ul ar pica, iar coada ștearsă ar lăsa omul logat și
 * fără modificări), `confirm` cu scrieri netrimise, `proceed` altfel.
 * `nativePending` = acțiunile din notificări pe care cutia Android încă nu le-a
 * trimis: se pierd la logout la fel ca scrierile din coada paginii.
 */
export function logoutPlan({ offline, pending, nativePending = 0 }: { offline: boolean; pending: number; nativePending?: number }): 'refuse' | 'confirm' | 'proceed' {
  if (offline) return 'refuse'
  return pending + nativePending > 0 ? 'confirm' : 'proceed'
}
