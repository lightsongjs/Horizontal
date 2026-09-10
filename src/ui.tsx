// UI context for the bottom sheet — supports a navigation stack.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type SheetState =
  | { kind: 'none' }
  | { kind: 'issue'; issueId: string }
  | { kind: 'issue-form'; issueId?: string } // create when no id, edit otherwise
  | { kind: 'project-form' }
  | { kind: 'project-settings' }
  | { kind: 'wave-manage' }
  | { kind: 'theme-manage' }

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
  openEditIssue(id: string): void
  openNewProject(): void
  openProjectSettings(): void
  openWaveManage(): void
  openThemeManage(): void
  /** Închide toată stiva. Întoarce false dacă garda de close a blocat. */
  closeSheet(): boolean
  goBack(): void
  pushSheet(state: SheetState): void
  /** Register a guard called before closing all sheets. Return false to block close. */
  setCloseGuard(fn: (() => boolean) | null): void
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

const Ctx = createContext<UI | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [sheets, setSheets] = useState<SheetState[]>([])
  const [splitHosts, setSplitHosts] = useState(0)
  const [saveNudge, setSaveNudge] = useState(0)
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
      registerSplitHost,
      setDockedDirty,
      saveNudge,
      openIssue: (issueId) => setSheets([{ kind: 'issue-form', issueId }]),
      openNewIssue: () => setSheets([{ kind: 'issue-form' }]),
      openEditIssue: (issueId) => {
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
        setSheets([{ kind: 'issue-form', issueId }])
      },
      openNewProject: () => setSheets([{ kind: 'project-form' }]),
      openProjectSettings: () => setSheets([{ kind: 'project-settings' }]),
      openWaveManage: () => setSheets([{ kind: 'wave-manage' }]),
      openThemeManage: () => setSheets([{ kind: 'theme-manage' }]),
      closeSheet: () => {
        if (closeGuard.current && !closeGuard.current()) return false
        setSheets([])
        return true
      },
      goBack: () => setSheets((prev) => prev.slice(0, -1)),
      pushSheet: (state) => setSheets((prev) => [...prev, state]),
      setCloseGuard: (fn) => { closeGuard.current = fn },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, sheets.length, ticketId, dockedIssueId, registerSplitHost, setDockedDirty, saveNudge, clearPendingSwitch],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUI(): UI {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
