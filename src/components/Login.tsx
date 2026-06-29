import { useState } from 'react'
import { useAuth } from '../auth'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const err = await signIn(email.trim(), password)
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <div id="app">
      <div className="login">
        <div className="login-card">
          <div className="logo" style={{ width: 48, height: 48, borderRadius: 14, fontSize: 18 }}>
            H
          </div>
          <h1>Horizontal</h1>
          <p className="login-sub">Autentifică-te ca să continui.</p>

          <form onSubmit={submit}>
            <div className="fld">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@exemplu.ro"
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="fld">
              <label>Parolă</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && <div className="banner">⚠ {error}</div>}

            <div className="save-bar" style={{ position: 'static', marginTop: 4 }}>
              <button type="submit" disabled={busy || !email || !password}>
                {busy ? 'Se conectează…' : 'Intră în cont'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
