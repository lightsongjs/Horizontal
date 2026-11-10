import type { Issue } from './types'
import type { DesktopAction } from './desktopBridge'
import { reminderMutation, snoozeBase } from './reminderAction'

export interface NativeActionDeps {
  find(id: string): Issue | undefined
  toggleDone(id: string): Promise<void>
  updateIssue(id: string, patch: Partial<Issue>): Promise<void>
  open(id: string): void
  now(): Date
  /** `repository.sync.resolveId`: un tichet creat offline (`HZ-~abc`) a primit
   *  între timp numărul real. Cutia de Android lasă astfel de acțiuni paginii. */
  resolveId(id: string): string
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null)

/**
 * O acțiune venită de la o cutie (Linux sau Android), executată prin store —
 * deci prin coada offline. „Gata" trece prin `reminderMutation`: nu comută orb,
 * ca o notificare veche să nu debifeze o sarcină bifată pe alt dispozitiv.
 * `until`: ținta e calculată de cutie; recalculată aici din cache ar putea da
 * alt rezultat.
 */
export function runNativeAction(raw: DesktopAction, d: NativeActionDeps): void {
  // ID-ul provizoriu poate fi deja remapat; o scriere pe cel vechi n-ar mai găsi
  // tichetul în store (`find`), iar coada ar traduce-o oricum doar dacă e încă în ea.
  const a = { ...raw, id: d.resolveId(raw.id) } as DesktopAction
  if (a.action === 'open') { d.open(a.id); return }
  // O serie nu se amână (`reminderMutation`): „Amână…" vine doar de la un APK vechi.
  if (a.action === 'until' && d.find(a.id)?.pingEvery) return
  if (a.action === 'until') {
    // Baza amânării (`snoozeBase`): cea calculată de cutie, ca ora; un APK de
    // dinainte de `from` n-o trimite, și atunci o calculează pagina din cache.
    const known = d.find(a.id)
    const from = a.from ?? (known ? snoozeBase(known, a.dueAt) : undefined)
    void d.updateIssue(a.id, { remindAt: a.at, ...(a.dueAt ? { dueAt: a.dueAt } : {}), ...(from ? { snoozedFrom: from } : {}) })
    return
  }
  const issue = d.find(a.id)
  // Nici „Gata" pe o serie (`reminderMutation`): pingul văzut nu bifează.
  if (issue?.pingEvery) return
  if (a.action === 'done' && a.prevDueAt !== undefined) {
    // Garda recurenței, ca `buildPatch` din cutie: pe o recurentă `done` rămâne
    // false după salt, deci un „Gata" executat a doua oară (sau unul vechi) ar
    // sări încă o dată. Scadența alta decât cea văzută de notificare = a sărit deja.
    // Tichet necunoscut: nu se poate verifica, deci nu se riscă un salt dublu.
    if (!issue) return
    if (issue.rrule && time(issue.dueAt) !== time(a.prevDueAt)) return
  }
  // Tichet neîncărcat (alt proiect, cache gol): comutarea ar fi un no-op în
  // store, iar acțiunea — deja scoasă din coada cutiei — s-ar pierde. „Gata"
  // e o stare, nu o comutare, deci se scrie absolut. (Doar fără `prevDueAt`, adică Linux.)
  if (a.action === 'done' && !issue) { void d.updateIssue(a.id, { done: true }); return }
  const m = reminderMutation(a.action, issue, d.now(), a.action === 'snooze' ? a.minutes : undefined)
  if (m.kind === 'toggle') void d.toggleDone(a.id)
  else if (m.kind === 'patch') void d.updateIssue(a.id, m.patch)
}
