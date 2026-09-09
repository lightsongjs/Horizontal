# Build date în interfață — "Built: 2 minutes ago"

Ghid complet, portabil, ca să adaugi aceeași funcționalitate în altă aplicație (Vite + React/TS).

## La ce folosește (de ce vrei asta)

Sub logo apare când a fost construită ultima versiune: *"just now"*, *"3 minutes ago"*, *"1 day ago"*.
E un **check vizual instant**: intri în aplicație și vezi imediat dacă build-ul curent chiar
conține ultimele tale modificări. Dacă scrie "5 days ago", ultima ta modificare **nu** a ajuns în
producție (deploy vechi, cache PWA, sau ai uitat să dai build).

## Ideea de bază (cum e "calculată")

Nu se salvează nimic în bază de date. Sunt două momente:

1. **La build** (când rulezi `vite build`) — se îngheață în bundle timestamp-ul exact al build-ului.
2. **La fiecare render** (când userul deschide app-ul) — se calculează diferența dintre *acum* și
   acel timestamp înghețat, și se formatează ca text relativ.

Deci "ago"-ul e mereu proaspăt (se recalculează la runtime), dar punctul de referință e fix
(momentul build-ului). Zero dependențe externe, ~10 linii de cod.

---

## Pas 1 — Vite injectează timestamp-ul la build

În `vite.config.ts`, în obiectul de config:

```ts
export default defineConfig(({ command: _command }) => ({
  // ...restul configului...
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
}))
```

**Cum funcționează `define`:** e un find-and-replace la bundle time. Oriunde în cod apare textul
`__BUILD_TIME__`, Vite îl înlocuiește literal cu string-ul ISO al momentului când a rulat build-ul.
`new Date().toISOString()` se evaluează **o singură dată**, pe mașina de build, și rezultatul
(ex: `"2026-07-18T14:32:00.000Z"`) ajunge hardcodat în bundle-ul final.

> Important: `new Date()` din `vite.config.ts` rulează la **build**, nu la runtime. De asta merge —
> e "înghețat" în cod. `JSON.stringify` e ca să ajungă în bundle cu ghilimele (ca string valid).

## Pas 2 — spune-i lui TypeScript că variabila există

Altfel TS se plânge că `__BUILD_TIME__` e nedefinit. Într-un fișier de tipuri global
(ex: `src/vite-env.d.ts`):

```ts
declare const __BUILD_TIME__: string
```

## Pas 3 — funcția care formatează "ago"

Pune-o unde o afișezi (ex: în componenta de sidebar/header):

```ts
function getBuildAgo(): string {
  const diff = Math.floor((Date.now() - new Date(__BUILD_TIME__).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) { const m = Math.floor(diff / 60); return `${m} minute${m > 1 ? 's' : ''} ago` }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return `${h} hour${h > 1 ? 's' : ''} ago` }
  const d = Math.floor(diff / 86400); return `${d} day${d > 1 ? 's' : ''} ago`
}
```

Logica pragurilor (totul în secunde):

| Diferență           | Afișare        |
|---------------------|----------------|
| `< 60`              | `just now`     |
| `< 3600` (1 oră)    | `X minutes ago`|
| `< 86400` (1 zi)    | `X hours ago`  |
| rest                | `X days ago`   |

Pluralul e gestionat inline: `minute${m > 1 ? 's' : ''}`.

## Pas 4 — afișează-l în UI

```tsx
<span style={{ display: 'block', fontSize: '9px', opacity: 0.6 }}>
  Built: {getBuildAgo()}
</span>
```

În Horizontal apare în două locuri (aceeași funcție, duplicată în ambele):
- `src/components/Sidebar.tsx` — sub numele aplicației (desktop).
- `src/App.tsx` — în header-ul mobil, doar când nu e selectat niciun proiect.

---

## De reținut / capcane

- **Se actualizează doar când dai build.** `npm run dev` folosește momentul pornirii serverului.
  Ca să vezi timpul real de deploy, contează timestamp-ul de la `vite build` din pipeline-ul de
  producție.
- **PWA / cache.** Dacă app-ul e PWA și "ago"-ul pare vechi după un deploy, e service worker-ul care
  servește un bundle vechi. Verifică strategia de update a SW-ului (în Horizontal e `prompt`, aplicat
  la open/focus prin `src/pwa.ts`).
- **Nu se re-randează singur în timp.** `getBuildAgo()` se calculează la fiecare render React, nu pe
  un timer. Dacă lași fila deschisă 3 ore, textul se împrospătează abia la următorul render. Pentru
  Horizontal e ok (vrei valoarea de la deschidere). Dacă vrei live-tick, wrap-uiește într-un
  `setInterval` + state.
- **Fus orar:** `toISOString()` e mereu UTC, iar `Date.now()` e absolut — diferența e corectă
  indiferent de fusul userului.

## De ce nu date-fns / dayjs

Pentru un text relativ simplu, 10 linii înlocuiesc o librărie de ~30KB. Merită o librărie doar la
localizare, fusuri multiple sau formate custom.

## Checklist de copiere într-un proiect nou

1. `vite.config.ts` → adaugă blocul `define` cu `__BUILD_TIME__`.
2. `src/vite-env.d.ts` → adaugă `declare const __BUILD_TIME__: string`.
3. Copiază funcția `getBuildAgo()` în componenta de layout.
4. Afișează `Built: {getBuildAgo()}` unde vrei.
5. Dă `npm run build` și verifică că data se schimbă la fiecare build.

## Fișiere de referință în Horizontal

- `vite.config.ts` → blocul `define` (`__BUILD_TIME__: JSON.stringify(new Date().toISOString())`).
- `src/vite-env.d.ts` → `declare const __BUILD_TIME__: string`.
- `src/components/Sidebar.tsx` → `getBuildAgo()` + afișare sub logo.
- `src/App.tsx` → `getBuildAgo()` + afișare în header mobil.
