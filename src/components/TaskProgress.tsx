import { useMemo } from 'react'
import { taskProgress } from '../lib/markdown/tasks'

/** Ieftin, ca un card să nu parseze o descriere fără căsuțe. */
export const hasTasks = (desc: string) => /\[[ xX]\]/.test(desc)

/**
 * „2/5” lângă titlu, numai dacă descrierea are căsuțe — fără ele absența e
 * informația, ca la `DueChip`. Mono: e o cifră.
 */
export function TaskProgress({ desc }: { desc: string }) {
  const p = useMemo(() => taskProgress(desc), [desc])
  if (!p.total) return null
  return (
    <span className={`md-progress${p.done === p.total ? ' all' : ''}`} title={`${p.done} din ${p.total} bifate`}>
      {p.done}/{p.total}
    </span>
  )
}
