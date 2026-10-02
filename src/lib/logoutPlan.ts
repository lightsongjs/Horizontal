/**
 * Ce face deconectarea, dată fiind coada. Pură, ca decizia să aibă test:
 * `refuse` offline (signOut-ul ar pica, iar coada ștearsă ar lăsa omul logat și
 * fără modificări), `confirm` cu scrieri netrimise, `proceed` altfel.
 */
export function logoutPlan({ offline, pending }: { offline: boolean; pending: number }): 'refuse' | 'confirm' | 'proceed' {
  if (offline) return 'refuse'
  return pending > 0 ? 'confirm' : 'proceed'
}
