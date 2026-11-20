// Ce cere o foaie de tichet la deschidere, cerut dinainte, în lot, pentru
// rândurile unei liste: rezumatul firului și fișierele (cu URL-urile
// miniaturilor). Amândouă stau DEASUPRA descrierii — pe telefon și în
// formular —, deci sosite după o rundă la server o împingeau în jos
// (~50–80px) la prima deschidere a unui tichet cu fir sau cu fișiere.
// Măsurători: `docs/agent/viteza-deschidere.md`.
//
// Trei cereri mici pe listă (evenimente, vizite, fișiere), în idle, nu câte
// trei pe tichet la atingere. Plafonat la primele `MAX` rânduri: o listă de
// proiect are sute, iar ce se deschide e de obicei sus. Un eșec e tăcut —
// foaia își cere singură ce-i lipsește, ca înainte.
import { useEffect } from 'react'
import { isTempIssueId } from '../lib/issueId'
import { prefetchAttachments } from './attachments'
import { prefetchThreadSummaries } from './threadSummary'

const FILES = import.meta.env.VITE_DATA_SOURCE === 'supabase'
const MAX = 60

export function usePrefetchSheets(ids: readonly string[]): void {
  const key = ids.filter((id) => !isTempIssueId(id)).slice(0, MAX).join(',')
  useEffect(() => {
    if (!key) return
    const list = key.split(',')
    const run = () => {
      void prefetchThreadSummaries(list)
      if (FILES) prefetchAttachments(list).catch(() => {})
    }
    // Safari n-are `requestIdleCallback`.
    if (typeof window.requestIdleCallback === 'function') {
      const h = window.requestIdleCallback(run, { timeout: 2000 })
      return () => window.cancelIdleCallback(h)
    }
    const t = setTimeout(run, 200)
    return () => clearTimeout(t)
  }, [key])
}
