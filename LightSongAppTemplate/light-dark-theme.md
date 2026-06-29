# Light Theme / Dark Theme cu Light ca Default

## Ce face

Aplicația suportă două teme — dark și light. Preferința e salvată în `localStorage`. La prima vizită (fără preferință salvată), tema default este **light**. Utilizatorul poate comuta cu un buton; schimbarea persistă între sesiuni.

## Arhitectura

### 1. CSS Variables — două seturi de tokeni

În `src/styles.css`, `:root` definește tema dark (default la nivel CSS):

```css
:root {
  --bg: #0c0d12;
  --surface: #14151c;
  --txt: #e8e9ee;
  --accent: #0EA5E9;
  --done: #3ecf8e;
  --blocked: #ff6b6b;
  /* ... */
}
```

Tema light suprascrie variabilele prin atribut pe `<html>`:

```css
[data-theme='light'] {
  --bg: #EEF2F7;
  --surface: #FFFFFF;
  --txt: #0F1923;
  --accent: #0284C7;
  --done: #059669;
  --blocked: #E11D48;
  /* + variabile exclusive temei light: */
  --shadow-sm: 0 1px 3px rgba(15,25,35,0.07);
  --shadow-md: 0 8px 24px rgba(15,25,35,0.09);
  --placeholder: #9DAFC4;
}
```

Toate componentele folosesc `var(--bg)`, `var(--txt)` etc. — niciodată culori hardcodate. Schimbarea temei = schimbarea unui atribut pe `<html>`, fără re-render al componentelor.

### 2. ThemeProvider — context React

`src/theme.tsx` — fișier complet:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

function getInitial(): Theme {
  const stored = localStorage.getItem('depflow-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'light'  // ← default explicit: light, nu dark
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitial)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)  // setează pe <html>
    localStorage.setItem('depflow-theme', theme)                // persistă
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c0d12' : '#f4f5fa')
  }, [theme])

  return (
    <Ctx.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
```

### 3. Cum se face light default

**O singură linie** în `getInitial()`:

```ts
function getInitial(): Theme {
  const stored = localStorage.getItem('depflow-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'light'  // ← schimbă în 'dark' dacă vrei dark ca default
}
```

Logica: dacă utilizatorul a ales ceva înainte → respectă alegerea lui. Dacă nu → returnează `'light'`.

**Nu folosim `prefers-color-scheme`** intenționat — preferința sistemului e ignorată. Aplicația are un look specific care arată mai bine în light, iar comportamentul consistent e mai predictibil decât să urmărești sistemul.

### 4. meta theme-color

```ts
const meta = document.querySelector('meta[name="theme-color"]')
if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c0d12' : '#f4f5fa')
```

Aceasta schimbă culoarea barei de status pe mobile (Android Chrome, Safari iOS). Fără ea, bara de sus rămâne în culoarea din `index.html` indiferent de temă.

### 5. Utilizare în componente

```tsx
import { useTheme } from './theme'

function MyComponent() {
  const { theme, toggle } = useTheme()
  return (
    <button onClick={toggle}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}
```

## Fișiere relevante

- `src/theme.tsx` — întreg fișierul (~40 linii)
- `src/styles.css` — liniile 5–27 (dark tokens în `:root`) și 68–92 (light tokens în `[data-theme='light']`)
- `src/main.tsx` — `<ThemeProvider>` înfășoară `<App>`

## Rezumat pattern

1. CSS variables pe `:root` pentru dark (fallback)
2. `[data-theme='light']` override pe `<html>` element
3. React context cu `useState` + `useEffect` care setează atributul
4. `localStorage` pentru persistență
5. Default `'light'` în `getInitial()` — fără `prefers-color-scheme`
6. `meta[name="theme-color"]` actualizat la fiecare schimbare
