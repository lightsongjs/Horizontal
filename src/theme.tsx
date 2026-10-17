import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { parseTextScale, TEXT_SCALE_KEY, type TextScale } from './lib/textScale'
import { FOLLOW_KEY, parseFlag, serializeFlag, VIM_KEY } from './lib/vimSettings'

export type Theme = 'dark' | 'light'

interface ThemeCtx {
  theme: Theme
  setTheme(t: Theme): void
  textScale: TextScale
  setTextScale(s: TextScale): void
  /** „Mod Vim": navigarea din tastatură (`src/vim.tsx`). Oprit = tastele de dinainte. */
  vim: boolean
  setVim(on: boolean): void
  /** „Panoul urmează cursorul": cu un tichet docat, j / k schimbă și tichetul din panou. */
  follow: boolean
  setFollow(on: boolean): void
}

const Ctx = createContext<ThemeCtx | null>(null)

function getInitial(): Theme {
  const stored = localStorage.getItem('horizontal-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'light'
}

// Un `localStorage` blocat (fereastră privată, date șterse) nu are voie să
// oprească pornirea: valoarea lipsă e „pornit".
function readKey(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
function writeKey(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* rămâne doar pe sesiune */ }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitial)
  const [textScale, setTextScale] = useState<TextScale>(() => parseTextScale(localStorage.getItem(TEXT_SCALE_KEY)))
  const [vim, setVim] = useState(() => parseFlag(readKey(VIM_KEY)))
  const [follow, setFollow] = useState(() => parseFlag(readKey(FOLLOW_KEY)))
  useLayoutEffect(() => { writeKey(VIM_KEY, serializeFlag(vim)) }, [vim])
  useLayoutEffect(() => { writeKey(FOLLOW_KEY, serializeFlag(follow)) }, [follow])

  // Layout, nu efect obișnuit: se aplică înainte de primul cadru, altfel pagina
  // clipea o dată mică (sau luminoasă) și abia apoi se mărea.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('horizontal-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#141517' : '#FFFFFF')
  }, [theme])

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(textScale))
    // Pentru rândurile care la text mărit trebuie să se rupă pe două linii în
    // loc să taie cuvintele — vezi `[data-text-large]` în styles.css.
    document.documentElement.toggleAttribute('data-text-large', textScale > 1)
    localStorage.setItem(TEXT_SCALE_KEY, String(textScale))
  }, [textScale])

  return (
    <Ctx.Provider value={{ theme, setTheme, textScale, setTextScale, vim, setVim, follow, setFollow }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
