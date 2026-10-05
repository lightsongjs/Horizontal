import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { parseTextScale, TEXT_SCALE_KEY, type TextScale } from './lib/textScale'

export type Theme = 'dark' | 'light'

interface ThemeCtx {
  theme: Theme
  setTheme(t: Theme): void
  textScale: TextScale
  setTextScale(s: TextScale): void
}

const Ctx = createContext<ThemeCtx | null>(null)

function getInitial(): Theme {
  const stored = localStorage.getItem('horizontal-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitial)
  const [textScale, setTextScale] = useState<TextScale>(() => parseTextScale(localStorage.getItem(TEXT_SCALE_KEY)))

  // Layout, nu efect obișnuit: se aplică înainte de primul cadru, altfel pagina
  // clipea o dată mică (sau luminoasă) și abia apoi se mărea.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('horizontal-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B0B0E' : '#F7F9FC')
  }, [theme])

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(textScale))
    // Pentru rândurile care la text mărit trebuie să se rupă pe două linii în
    // loc să taie cuvintele — vezi `[data-text-large]` în styles.css.
    document.documentElement.toggleAttribute('data-text-large', textScale > 1)
    localStorage.setItem(TEXT_SCALE_KEY, String(textScale))
  }, [textScale])

  return (
    <Ctx.Provider value={{ theme, setTheme, textScale, setTextScale }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
