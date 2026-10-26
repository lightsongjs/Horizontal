import { useEffect, useRef, useState } from 'react'
import { useAuth } from './auth'
import { HorizontalProvider } from './store'
import { QuickAdd } from './components/QuickAdd'
import { startOfLocalDay } from './lib/schedule'
import { getDesktopBridge } from './lib/desktopBridge'
import { clearBarDraft } from './lib/barDraft'

/**
 * Bara de captură (aplicația de Linux, Ctrl+Shift+A). O intrare ușoară, nu
 * aplicația întreagă: același `QuickAdd` ca în „Azi" — aceeași recunoaștere a
 * datei, același proiect ținut minte —, scris prin același repository, deci
 * prin coada offline. Fereastra stă ascunsă și se refolosește; fiecare arătare
 * o face din nou vizibilă (`visibilitychange`), iar asta e semnalul de
 * „revino": cursorul înapoi în câmpul unde era, la sfârșit. NU `focus`:
 * popup-ul unui `<select>` sau al unui câmp de dată ia focusul și îl dă înapoi.
 *
 * Ascunderea NU golește: bara se ascunde la orice click în afară, iar omul
 * revine des ca să lipească ceva copiat din spate. Golesc doar Esc și o
 * trimitere reușită; ciorna e în `lib/barDraft.ts`.
 */
export function QuickAddPage() {
  const { enabled, session, loading } = useAuth()
  const [fresh, setFresh] = useState(0)
  // Esc = renunț: golește ciorna și ascunde, fără să salveze — și înainte de
  // login, când bara arată doar mesajul. La urcare, nu în captură: lista de
  // sugestii (`#`, `@`) oprește Esc-ul ei, care o închide doar pe ea.
  // Remontarea (`fresh`) aduce câmpurile goale și descrierea închisă.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      clearBarDraft()
      setFresh((n) => n + 1)
      getDesktopBridge()?.hideBar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (loading) return null
  if (enabled && !session) {
    return <p className="qab-empty">Deschide Horizontal și autentifică-te o dată — bara folosește aceeași sesiune.</p>
  }
  return (
    <HorizontalProvider>
      <QuickAddBar key={fresh} />
    </HorizontalProvider>
  )
}

function QuickAddBar() {
  const [round, setRound] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setRound((r) => r + 1) }
    document.addEventListener('visibilitychange', onVisible)
    // Prima arătare: o fereastră care n-a fost niciodată afișată raportează deja
    // `visible`, deci `visibilitychange` nu vine și `round` ar rămâne 0 — bara
    // s-ar deschide fără cursor. Primul `focus` (sau focusul deja existent la
    // montare, în calea la rece) deschide runda 1, o singură dată; următoarele
    // `focus`-uri NU, din motivul de mai sus (popup-urile native).
    const onFirstFocus = () => setRound((r) => (r === 0 ? 1 : r))
    if (document.hasFocus()) onFirstFocus()
    else window.addEventListener('focus', onFirstFocus, { once: true })
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFirstFocus)
    }
  }, [])
  // Fereastra crește cu conținutul: Tab deschide descrierea sub titlu, iar o
  // fereastră fixă de 150px ar tăia-o. Trimiterea și Esc închid descrierea,
  // deci observatorul o readuce singur la loc.
  useEffect(() => {
    const el = barRef.current
    const bridge = getDesktopBridge()
    if (!el || !bridge?.resizeBar) return
    const ro = new ResizeObserver(() => bridge.resizeBar?.(Math.ceil(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Fără dată în text, sarcina e pentru azi — ca adăugarea rapidă din „Azi",
  // ca să apară imediat în lista pe care omul o deschide dimineața.
  const today = startOfLocalDay(new Date()).toISOString()
  return (
    <div className="qab" ref={barRef}>
      {/* Proiectul implicit e Inbox, ca peste tot (`captureDefaultProjectId`);
          alt proiect se cere explicit (#nume sau butonul). */}
      <QuickAdd
        rich
        keepDraft
        focusSignal={round}
        defaultDueAt={today}
        onAdded={() => getDesktopBridge()?.hideBar()}
      />
    </div>
  )
}
