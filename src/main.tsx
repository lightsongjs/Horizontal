import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AuthProvider } from './auth'
import { ThemeProvider } from './theme'
import { QuickAddPage } from './QuickAddPage'
import { isQuickAddPath } from './lib/deepLink'
import { registerPWA } from './pwa'
import './styles.css'

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
        <App />
      </AuthProvider>
    </StrictMode>,
  )
}

registerPWA()
