// UI context for the bottom sheet — supports a navigation stack.

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

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
  canGoBack: boolean
  openIssue(id: string): void
  openNewIssue(): void
  openEditIssue(id: string): void
  openNewProject(): void
  openProjectSettings(): void
  openWaveManage(): void
  openThemeManage(): void
  closeSheet(): void
  goBack(): void
  pushSheet(state: SheetState): void
  /** Register a guard called before closing all sheets. Return false to block close. */
  setCloseGuard(fn: (() => boolean) | null): void
}

const Ctx = createContext<UI | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [sheets, setSheets] = useState<SheetState[]>([])
  const closeGuard = useRef<(() => boolean) | null>(null)

  const sheet = sheets[sheets.length - 1] ?? { kind: 'none' }

  const value = useMemo<UI>(
    () => ({
      sheet,
      canGoBack: sheets.length > 1,
      openIssue: (issueId) => setSheets([{ kind: 'issue-form', issueId }]),
      openNewIssue: () => setSheets([{ kind: 'issue-form' }]),
      openEditIssue: (issueId) => setSheets([{ kind: 'issue-form', issueId }]),
      openNewProject: () => setSheets([{ kind: 'project-form' }]),
      openProjectSettings: () => setSheets([{ kind: 'project-settings' }]),
      openWaveManage: () => setSheets([{ kind: 'wave-manage' }]),
      openThemeManage: () => setSheets([{ kind: 'theme-manage' }]),
      closeSheet: () => {
        if (closeGuard.current && !closeGuard.current()) return
        setSheets([])
      },
      goBack: () => setSheets((prev) => prev.slice(0, -1)),
      pushSheet: (state) => setSheets((prev) => [...prev, state]),
      setCloseGuard: (fn) => { closeGuard.current = fn },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, sheets.length],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUI(): UI {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
