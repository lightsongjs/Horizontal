import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { HorizontalProvider, useHorizontal } from './store'
import { QuickAdd } from './components/QuickAdd'
import { startOfLocalDay } from './lib/schedule'
import { getDesktopBridge } from './lib/desktopBridge'
import { dailyProjectId } from './lib/captureTokens'

/**
 * Bara de captură (aplicația de Linux, Ctrl+Shift+A). O intrare ușoară, nu
 * aplicația întreagă: același `QuickAdd` ca în „Azi" — aceeași recunoaștere a
 * datei, același proiect ținut minte —, scris prin același repository, deci
 * prin coada offline. Fereastra stă ascunsă și se refolosește; fiecare arătare
 * o face din nou vizibilă (`visibilitychange`), iar asta e semnalul de „rundă
 * nouă": câmp gol, cursor în el. NU `focus`: popup-ul unui `<select>` sau al
 * unui câmp de dată ia focusul și îl dă înapoi, iar o rundă nouă la întoarcere
 * ar fi golit tot ce scrisese omul.
 */
export function QuickAddPage() {
  const { enabled, session, loading } = useAuth()
  // Esc ascunde fără să salveze — și înainte de login, când bara arată doar
  // mesajul. În captură, ca `QuickAdd` (care la Esc doar golește câmpul) să
  // nu-l vadă primul.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      getDesktopBridge()?.hideBar()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  if (loading) return null
  if (enabled && !session) {
    return <p className="qab-empty">Deschide Horizontal și autentifică-te o dată — bara folosește aceeași sesiune.</p>
  }
  return (
    <HorizontalProvider>
      <QuickAddBar />
    </HorizontalProvider>
  )
}

function QuickAddBar() {
  const { projects } = useHorizontal()
  const [round, setRound] = useState(0)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setRound((r) => r + 1) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  // `QuickAdd` focusează doar la o SCHIMBARE a semnalului, nu la montare —
  // iar remontarea (cheia) e cea care golește câmpul. Deci focusul îl cerem noi,
  // după ce noul câmp există.
  useEffect(() => {
    if (round === 0) return
    const id = requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.qab .qa-input')?.focus())
    return () => cancelAnimationFrame(id)
  }, [round])
  // Fără dată în text, sarcina e pentru azi — ca adăugarea rapidă din „Azi",
  // ca să apară imediat în lista pe care omul o deschide dimineața.
  const today = startOfLocalDay(new Date()).toISOString()
  return (
    <div className="qab">
      {/* Proiectul implicit e „✅Daily", ales de om — nu ultimul folosit: bara e
          pentru captura zilnică, iar alt proiect se cere explicit (#nume sau butonul). */}
      <QuickAdd
        key={round}
        rich
        defaultProjectId={dailyProjectId(projects) ?? undefined}
        defaultDueAt={today}
        onAdded={() => getDesktopBridge()?.hideBar()}
      />
    </div>
  )
}
