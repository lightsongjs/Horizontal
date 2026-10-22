import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AuthProvider } from './auth'
import { ThemeProvider } from './theme'
import { QuickAddPage } from './QuickAddPage'
import { isQuickAddPath } from './lib/deepLink'
import { registerPWA } from './pwa'
import { installNarrow } from './lib/narrow'
import { createMemoryPort, setHistoryPort } from './lib/historyPort'
import { loadPaneStack, paneId, savePaneStack } from './lib/pane'
import './styles.css'

// Un panou al panoului dublu (`<iframe src="/?pane=L|R">`): istoric în memorie,
// fiindcă al iframe-ului ar fi comun cu al filei (spec 2026-10-22-split-pane).
const pane = paneId()
if (pane) {
  setHistoryPort(createMemoryPort({
    initial: { state: { hzDepth: 0, hzScreen: 'today' }, path: '/' },
    persist: { load: () => loadPaneStack(pane), save: (s) => savePaneStack(pane, s) },
  }))
  document.documentElement.setAttribute('data-pane', pane)
}
// Înainte de prima randare: CSS-ul de telefon atârnă de `<html data-narrow>`,
// iar un panou (îngust ca viewport) rămâne desktop.
installNarrow({ pane: !!pane })

const root = createRoot(document.getElementById('root')!)
// Bara de captură nu trece prin `App`: efectul de boot ar fi luat calea drept
// deep link de tichet, iar `settleUrl` ar fi rescris-o.
if (isQuickAddPath(window.location.pathname)) {
  root.render(
    <StrictMode>
      <AuthProvider>
        <ThemeProvider>
          <QuickAddPage />
        </ThemeProvider>
      </AuthProvider>
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <AuthProvider>
        {/* Deasupra lui `App`, nu în el: și ecranul de login trebuie să
            respecte fundalul și mărimea textului alese pe dispozitiv. */}
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </AuthProvider>
    </StrictMode>,
  )
}

// Gazda reîncarcă documentul de sus la un build nou, iar panourile vin odată
// cu el; un panou care s-ar reîncărca singur și-ar pierde vecinul din vedere.
if (!pane) registerPWA()
