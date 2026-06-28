// UI context for the bottom sheet — lets any card open the issue detail or the
// new-issue form without prop drilling.

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type SheetState =
  | { kind: 'none' }
  | { kind: 'issue'; issueId: string }
  | { kind: 'new-issue' }

interface UI {
  sheet: SheetState
  openIssue(id: string): void
  openNewIssue(): void
  closeSheet(): void
}

const Ctx = createContext<UI | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' })
  const value = useMemo<UI>(
    () => ({
      sheet,
      openIssue: (issueId) => setSheet({ kind: 'issue', issueId }),
      openNewIssue: () => setSheet({ kind: 'new-issue' }),
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
