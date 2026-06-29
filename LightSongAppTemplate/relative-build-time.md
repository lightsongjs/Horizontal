# Timp relativ de build ("built 3 minutes ago")

## Ce face

În sidebar și în header-ul mobil apare când a fost construit ultima versiune a aplicației: "just now", "2 minutes ago", "3 hours ago", "1 day ago". Se calculează la fiecare render față de timestamp-ul injectat la build.

## Cum funcționează în două părți

### Partea 1 — Vite injectează timestamp-ul la build

În `vite.config.ts`:

```ts
define: {
  __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
},
```

`define` în Vite face un find-and-replace la bundle time: oriunde în cod apare `__BUILD_TIME__`, Vite îl înlocuiește cu string-ul ISO al momentului când a rulat `vite build`. Rezultat: `"2026-06-28T14:32:00.000Z"` hardcodat în bundle.

Pentru TypeScript să nu se plângă, adaugă într-un `vite-env.d.ts` sau `global.d.ts`:

```ts
declare const __BUILD_TIME__: string
```

### Partea 2 — funcția de calcul

```ts
function getBuildAgo(): string {
  const diff = Math.floor((Date.now() - new Date(__BUILD_TIME__).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) {
    const m = Math.floor(diff / 60)
    return `${m} minute${m > 1 ? 's' : ''} ago`
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600)
    return `${h} hour${h > 1 ? 's' : ''} ago`
  }
  const d = Math.floor(diff / 86400)
  return `${d} day${d > 1 ? 's' : ''} ago`
}
```

Logica intervalelor (în secunde):
- `< 60` → "just now"
- `< 3600` (1 oră) → X minutes ago
- `< 86400` (1 zi) → X hours ago
- rest → X days ago

Pluralul e gestionat inline: `minute${m > 1 ? 's' : ''}`.

### Unde e afișat

**Header mobil** (`src/App.tsx`):
```tsx
{!project && (
  <span style={{ display: 'block', fontSize: '10px', opacity: 0.5, marginTop: '1px' }}>
    Built: {getBuildAgo()}
  </span>
)}
```
Apare sub "Toate proiectele tale" doar când nu e selectat niciun proiect.

**Sidebar** (`src/components/Sidebar.tsx`):
```tsx
<div className="sidebar-build-time">{getBuildAgo()}</div>
```
Sub numele aplicației.

## De ce nu folosim date-fns / dayjs

Zero dependențe externe pentru un feature simplu. 5 linii de cod înlocuiesc o librărie de 30KB. Pentru cazuri mai complexe (localizare, fusuri orare, formate custom) — atunci merită o librărie.

## Fișiere relevante

- `vite.config.ts` — linia 48 (injectarea `__BUILD_TIME__`)
- `src/App.tsx` — liniile 32–38 (funcția) și ~55 (afișare header)
- `src/components/Sidebar.tsx` — liniile 6–12 (funcția duplicată) și ~27 (afișare)
