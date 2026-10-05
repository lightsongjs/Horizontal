// UI context for the bottom sheet — supports a navigation stack.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { QuickCtx } from './lib/quickDraft'

/**
 * Ce trece din foaia rapidă în formularul complet („…"): ce a scris și ce a
 * ales omul acolo, deja curățat — titlul fără dată și fără semne, scadența ca
 * valoare. Formularul nu reparsează titlul (recunoașterea lui pornește doar la
 * tastare), deci nimic nu se înțelege de două ori.
 */
export interface IssueDraft {
  title: string
  desc: string
  projectId: string
  dueAt: string | null
  allDay: boolean
  rrule: string | null
  urgent: boolean
  assigneeId: string | null
}

export type SheetState =
  | { kind: 'none' }
  // `keyId`: cheia React de la montare, când `issueId` s-a schimbat sub foaie
  // (tichet creat offline care a primit numărul real) — vezi `renameIssueInSheets`.
  | { kind: 'issue'; issueId: string; keyId?: string }
  // create when no id, edit otherwise. `full`: formularul complet chiar și pe
  // telefon — cerut din „…" al foii de tichet (vezi `compactIssueIdFrom`).
  | { kind: 'issue-form'; issueId?: string; keyId?: string; draft?: IssueDraft; full?: boolean }
  // Foaia rapidă de pe telefon (FAB). Altă cochilie decât `.sheet` — vezi `QuickSheet`.
  | { kind: 'quick-add'; ctx: QuickCtx }
  | { kind: 'project-form' }
  | { kind: 'project-settings' }
  | { kind: 'wave-manage' }
  | { kind: 'theme-manage' }
  | { kind: 'app-settings' }
  | { kind: 'obstacle-form'; obstacleId?: string } // creare când n-are id
  | { kind: 'user-form'; userId?: string } // creare când n-are id

interface UI {
  sheet: SheetState
  /**
   * Ticketul care deține URL-ul: primul `issue-form` cu id din stivă, nu vârful.
   * Un card de dependență (`kind: 'issue'`) împins deasupra formularului nu
   * schimbă URL-ul — ticketul de dedesubt e tot cel deschis.
   */
  ticketId: string | null
  canGoBack: boolean
  /**
   * Ticketul care se randează în panoul lateral în loc de modal, sau null.
   *
   * Decizia se ia la RANDARE, nu la click: nimeni nu apelează „deschide în
   * panou". O vizualizare care poate găzdui panoul se anunță cu
   * `registerSplitHost` (numai când e destul de lată), iar dacă stiva e exact
   * un formular de editare, formularul apare acolo. De-aia deep-link-ul
   * aterizează direct în panou, redimensionarea ferestrei mută formularul
   * între panou și modal fără să piardă ce ai scris, iar un card de
   * dependență împins deasupra rămâne modal — e o navigare temporară.
   */
  dockedIssueId: string | null
  /** Cheia React a formularului docat — `keyId ?? issueId`, vezi `sheetKey`. */
  dockedKeyId: string | null
  /** O vizualizare anunță că poate găzdui panoul. Întoarce dezabonarea. */
  registerSplitHost(): () => void
  /** Formularul docat își raportează starea „am modificări nesalvate”. */
  setDockedDirty(dirty: boolean): void
  /**
   * Contor care crește când o comutare a fost oprită de modificări nesalvate.
   * Formularul docat îl folosește ca să clipească săgeata de salvare.
   */
  saveNudge: number
  openIssue(id: string): void
  openNewIssue(): void
  /** `full`: sare peste foaia de telefon (după crearea unui tichet din formularul complet). */
  openEditIssue(id: string, opts?: { full?: boolean }): void
  /** „…" din foaia de tichet de pe telefon: același tichet, în formularul complet. */
  expandIssue(): void
  openNewProject(): void
  openProjectSettings(): void
  openWaveManage(): void
  openThemeManage(): void
  /** Rotița: fundalul și mărimea textului, pe dispozitiv. */
  openAppSettings(): void
  /** Foaia de utilizator din ecranul de administrare. Fără id = cont nou. */
  openUserForm(userId?: string): void
  /** Închide toată stiva. Întoarce false dacă garda de close a blocat. */
  closeSheet(): boolean
  goBack(): void
  pushSheet(state: SheetState): void
  /** Un tichet creat offline a primit numărul real: foile care-l țin trec pe ID-ul nou. */
  renameIssueId(from: string, to: string): void
  /** Register a guard called before closing all sheets. Return false to block close. */
  setCloseGuard(fn: (() => boolean) | null): void
  /**
   * Un mesaj scurt pentru Toast-ul aplicației, cerut dintr-o foaie (foaia
   * rapidă: „Adăugat: X", după ce s-a închis și tastatura a coborât).
   */
  toast: string | null
  showToast(message: string): void
  clearToast(): void
}

/** Cât ține „am înțeles, comută” înainte să se uite. */
const PENDING_SWITCH_MS = 4000

/**
 * Care tichet se randează în panoul lateral, dat fiind ce e pe stivă.
 *
 * Exportată și testată separat fiindcă e singura regulă a docării, iar
 * greșelile ei nu se văd ca o eroare, ci ca un modal apărut unde nu trebuie:
 * la un tichet nou (n-are ce evidenția în listă), sau peste un card de
 * dependență (o navigare temporară, care trebuie să rămână modală ca să poți
 * da „Înapoi”).
 */
export function dockedIssueIdFrom(sheets: SheetState[], hasSplitHost: boolean): string | null {
  if (!hasSplitHost || sheets.length !== 1) return null
  const only = sheets[0]
  return only.kind === 'issue-form' ? only.issueId ?? null : null
}

/**
 * Tichetul care se arată în foaia de telefon (`EditSheet`) în loc de
 * formularul complet, sau null.
 *
 * Aceeași idee ca `dockedIssueIdFrom`: decizia se ia la RANDARE, dintr-un
 * singur loc, nu în fiecare handler de click. Orice drum care deschide un
 * tichet — rândul din „Azi", cardul din „Ordine", căutarea, un deep link,
 * Back/Forward — ajunge la aceeași stivă, deci la aceeași foaie. Starea din
 * stivă rămâne `issue-form` cu id, deci URL-ul (`/HZ-12`), `behindTicket` și
 * Back merg exact ca pentru formular, fără nicio ramură nouă în `App.tsx`.
 *
 * Numai sub 900px (pragul FAB-ului), numai pentru un tichet existent, numai
 * când e singura foaie, și niciodată după „…" (`full`).
 */
export function compactIssueIdFrom(top: SheetState, depth: number, narrow: boolean): string | null {
  if (!narrow || depth !== 1 || top.kind !== 'issue-form' || top.full) return null
  return top.issueId ?? null
}

/**
 * Cheia React a unei foi de tichet: ID-ul de la montare, nu cel de acum.
 *
 * Un tichet creat offline și ținut deschis primește numărul real exact când
 * revine rețeaua. Cu cheia pe `issueId`, `SheetHost`/`SplitView` ar remonta
 * formularul atunci — și s-ar pierde tot ce scrii nesalvat, plus ciorna din
 * `Thread`. E ACELAȘI tichet, deci cheia rămâne. Invers decât regula `dueAt`
 * din `SplitView`, unde remontarea e chiar scopul: acolo datele din formular
 * ar minți, aici doar eticheta s-a schimbat.
 */
export function sheetKey(s: Extract<SheetState, { kind: 'issue' | 'issue-form' }>): string | undefined {
  return s.keyId ?? s.issueId
}

/** Cheia formularului docat, cu exact regulile lui `dockedIssueIdFrom`. */
export function dockedKeyFrom(sheets: SheetState[], hasSplitHost: boolean): string | null {
  if (!dockedIssueIdFrom(sheets, hasSplitHost)) return null
  const only = sheets[0]
  return only.kind === 'issue-form' ? sheetKey(only) ?? null : null
}

/**
 * Foile cu `from` trec pe `to`, ținând minte cheia de la montare (prima, nu
 * una intermediară). Aceeași stivă dacă n-are ce schimba — o redenumire a
 * unui tichet care nu e deschis nu trebuie să randeze nimic.
 */
export function renameIssueInSheets(sheets: SheetState[], from: string, to: string): SheetState[] {
  if (!sheets.some((s) => 'issueId' in s && s.issueId === from)) return sheets
  return sheets.map((s) =>
    (s.kind === 'issue' || s.kind === 'issue-form') && s.issueId === from
      ? { ...s, issueId: to, keyId: s.keyId ?? from }
      : s,
  )
}

/**
 * Foaia de editare pentru `issueId`. Dacă tichetul e deja singura foaie, își
 * păstrează cheia: un click pe rândul lui după o redenumire ar fi schimbat
 * cheia din `HZ-~…` în `HZ-13` și ar fi remontat formularul, cu tot ce conține.
 */
export function editSheet(prev: SheetState[], issueId: string, full = false): SheetState {
  const only = prev.length === 1 ? prev[0] : null
  const same = only?.kind === 'issue-form' && only.issueId === issueId ? only : null
  // Formularul complet deja deschis pe același tichet rămâne complet.
  const isFull = full || !!same?.full
  const out: SheetState = { kind: 'issue-form', issueId }
  if (same?.keyId) out.keyId = same.keyId
  if (isFull) out.full = true
  return out
}

/** „…": singura foaie de tichet trece în formularul complet, cu aceeași cheie. */
export function expandSheets(prev: SheetState[]): SheetState[] {
  const only = prev.length === 1 ? prev[0] : null
  if (only?.kind !== 'issue-form' || !only.issueId || only.full) return prev
  return [{ ...only, full: true }]
}

const Ctx = createContext<UI | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [sheets, setSheets] = useState<SheetState[]>([])
  const [splitHosts, setSplitHosts] = useState(0)
  const [saveNudge, setSaveNudge] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const showToast = useCallback((m: string) => setToast(m), [])
  const clearToast = useCallback(() => setToast(null), [])
  const closeGuard = useRef<(() => boolean) | null>(null)
  const dockedDirty = useRef(false)
  const pendingSwitch = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  const sheet = sheets[sheets.length - 1] ?? { kind: 'none' }

  const clearPendingSwitch = useCallback(() => {
    if (pendingSwitch.current) clearTimeout(pendingSwitch.current.timer)
    pendingSwitch.current = null
  }, [])

  const setDockedDirty = useCallback((dirty: boolean) => {
    dockedDirty.current = dirty
    if (!dirty) clearPendingSwitch()
  }, [clearPendingSwitch])

  const registerSplitHost = useCallback(() => {
    setSplitHosts((n) => n + 1)
    return () => setSplitHosts((n) => n - 1)
  }, [])

  const dockedIssueId = dockedIssueIdFrom(sheets, splitHosts > 0)
  const dockedKeyId = dockedKeyFrom(sheets, splitHosts > 0)

  const ticketId = useMemo(() => {
    const found = sheets.find((s) => s.kind === 'issue-form' && s.issueId)
    return found && found.kind === 'issue-form' ? found.issueId ?? null : null
  }, [sheets])

  const value = useMemo<UI>(
    () => ({
      sheet,
      ticketId,
      canGoBack: sheets.length > 1,
      dockedIssueId,
      dockedKeyId,
      registerSplitHost,
      setDockedDirty,
      saveNudge,
      openIssue: (issueId) => setSheets((prev) => [editSheet(prev, issueId)]),
      openNewIssue: () => setSheets([{ kind: 'issue-form' }]),
      openEditIssue: (issueId, opts) => {
        // Plasa de siguranță a panoului lateral. Comutarea pe alt tichet NU
        // trece prin `closeSheet`, deci garda de close n-o vede niciodată:
        // fără asta, un click în listă ar arunca în tăcere ce tocmai ai scris.
        // Nu e un dialog — prima atingere doar refuză și aprinde săgeata de
        // salvare; a doua, pe același rând, comută. Intenția expiră singură,
        // ca să nu comute peste zece minute din inerție.
        if (dockedIssueId && dockedDirty.current && issueId !== dockedIssueId) {
          if (pendingSwitch.current?.id !== issueId) {
            clearPendingSwitch()
            pendingSwitch.current = {
              id: issueId,
              timer: setTimeout(() => { pendingSwitch.current = null }, PENDING_SWITCH_MS),
            }
            setSaveNudge((n) => n + 1)
            return
          }
        }
        clearPendingSwitch()
        setSheets((prev) => [editSheet(prev, issueId, opts?.full)])
      },
      expandIssue: () => setSheets(expandSheets),
      openNewProject: () => setSheets([{ kind: 'project-form' }]),
      openProjectSettings: () => setSheets([{ kind: 'project-settings' }]),
      openWaveManage: () => setSheets([{ kind: 'wave-manage' }]),
      openThemeManage: () => setSheets([{ kind: 'theme-manage' }]),
      openAppSettings: () => setSheets([{ kind: 'app-settings' }]),
      openUserForm: (userId) => setSheets([{ kind: 'user-form', userId }]),
      closeSheet: () => {
        if (closeGuard.current && !closeGuard.current()) return false
        setSheets([])
        return true
      },
      goBack: () => setSheets((prev) => prev.slice(0, -1)),
      pushSheet: (state) => setSheets((prev) => [...prev, state]),
      // Un tichet creat offline și deschis în foaie primește numărul real la
      // sincronizare; foaia trebuie să-l urmeze, altfel ar căuta un ID care
      // nu mai există și s-ar închide sub degetele omului.
      // Cheia React rămâne cea veche (`renameIssueInSheets`), ca formularul să
      // nu se remonteze și să nu piardă ce e nesalvat. Și intenția de comutare
      // în așteptare îl urmează — altfel a doua atingere pe rând n-ar mai
      // recunoaște tichetul și ar cere din nou confirmarea.
      renameIssueId: (from, to) => {
        if (pendingSwitch.current?.id === from) pendingSwitch.current.id = to
        setSheets((prev) => renameIssueInSheets(prev, from, to))
      },
      setCloseGuard: (fn) => { closeGuard.current = fn },
      toast,
      showToast,
      clearToast,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, sheets.length, ticketId, dockedIssueId, dockedKeyId, registerSplitHost, setDockedDirty, saveNudge, clearPendingSwitch, toast, showToast, clearToast],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUI(): UI {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
