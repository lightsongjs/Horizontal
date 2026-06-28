// UI context for the bottom sheet.

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type SheetState =
  | { kind: 'none' }
  | { kind: 'issue'; issueId: string }
  | { kind: 'issue-form'; issueId?: string } // create when no id, edit otherwise
  | { kind: 'project-form' }
  | { kind: 'wave-manage' }
  | { kind: 'theme-manage' }

interface UI {
  sheet: SheetState
  openIssue(id: string): void
  openNewIssue(): void
  openEditIssue(id: string): void
  openNewProject(): void
  openWaveManage(): void
  openThemeManage(): void
  closeSheet(): void
}

const Ctx = createContext<UI | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' })
  const value = useMemo<UI>(
    () => ({
      sheet,
      openIssue: (issueId) => setSheet({ kind: 'issue', issueId }),
      openNewIssue: () => setSheet({ kind: 'issue-form' }),
      openEditIssue: (issueId) => setSheet({ kind: 'issue-form', issueId }),
      openNewProject: () => setSheet({ kind: 'project-form' }),
      openWaveManage: () => setSheet({ kind: 'wave-manage' }),
      openThemeManage: () => setSheet({ kind: 'theme-manage' }),
      closeSheet: () => setSheet({ kind: 'none' }),
    }),
    [sheet],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUI(): UI {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
