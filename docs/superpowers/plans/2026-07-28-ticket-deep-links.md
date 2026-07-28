# Ticket Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deschiderea unui card scrie id-ul ticketului în URL (`horizontal.app/MS-03`), iar un astfel de URL deschide direct ticketul respectiv.

**Architecture:** Patru bucăți. (1) Helperi puri de parsare/formatare path în `src/lib/deepLink.ts`. (2) Un toast minimal pentru mesaje tranzitorii — nu există niciunul azi. (3) Sincronizare bidirecțională URL ⇄ sheet în `Shell` (`src/App.tsx`), lângă sincronizarea de proiect care există deja. (4) Buton de copiere link + tasta `y` în header-ul sheet-ului de ticket.

**Tech Stack:** React 18, TypeScript, Vite, vitest (mediu `node` — fără jsdom, fără testing-library), History API nativ, Cloudflare Pages.

## Global Constraints

- **Fără dependențe noi.** Nu se adaugă react-router și nici librărie de toast.
- **Issues se încarcă lazy, per proiect.** `store.tsx:103` cheamă `repository.listIssues(projectId)` doar la selectarea unui proiect. La load, `allIssues` e gol — deci un id de ticket **nu** poate fi căutat direct în state. Rezoluția se face prin `Project.prefix` (proiectele sunt încărcate la boot).
- **Prefixul e partea de dinaintea primei cratime**: `MS-03` → `MS`, `TUR-API` → `TUR`.
- **Ruta existentă `/project/<slug>` rămâne neschimbată** pentru vizualizarea de proiect. Nu se modifică `slugify` (`src/App.tsx:106`).
- **Toate string-urile de UI în română**, ca restul aplicației.
- **Ce deschide link-ul:** sheet-ul `issue-form` (exact ce deschide click-ul pe card azi, via `openIssue` din `src/ui.tsx:43`). Niciun ecran nou.
- **Risc acceptat, nu se rezolvă aici:** două proiecte cu același `prefix` fac id-ul ambiguu; rezoluția ia primul proiect găsit.
- Rulează testele cu `npm test`. Verifică tipurile cu `npm run typecheck`.

---

### Task 1: Helperi de deep link (funcții pure)

Toată logica de string/path stă aici, testabilă fără DOM. Restul task-urilor doar o consumă.

**Files:**
- Create: `src/lib/deepLink.ts`
- Test: `src/lib/deepLink.test.ts`

**Interfaces:**
- Consumes: nimic.
- Produces:
  - `parseTicketPath(pathname: string): string | null` — întoarce id-ul ticketului (uppercase) sau `null`
  - `prefixOf(issueId: string): string` — partea de dinaintea primei cratime, uppercase
  - `ticketPath(issueId: string): string` — `'/MS-03'`
  - `ticketUrl(origin: string, issueId: string): string` — `'https://x.app/MS-03'`

- [ ] **Step 1: Write the failing test**

Create `src/lib/deepLink.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseTicketPath, prefixOf, ticketPath, ticketUrl } from './deepLink'

describe('parseTicketPath', () => {
  it('recunoaște un path de ticket', () => {
    expect(parseTicketPath('/MS-03')).toBe('MS-03')
    expect(parseTicketPath('/TUR-01')).toBe('TUR-01')
    expect(parseTicketPath('/TUR-API')).toBe('TUR-API')
  })

  it('normalizează la uppercase', () => {
    expect(parseTicketPath('/ms-03')).toBe('MS-03')
  })

  it('tolerează un slash final', () => {
    expect(parseTicketPath('/MS-03/')).toBe('MS-03')
  })

  it('respinge rădăcina, ruta de proiect și path-urile fără cratimă', () => {
    expect(parseTicketPath('/')).toBeNull()
    expect(parseTicketPath('/project/turnaround')).toBeNull()
    expect(parseTicketPath('/MS03')).toBeNull()
    expect(parseTicketPath('/MS-03/extra')).toBeNull()
  })

  it('respinge un slug de proiect cu cratimă care ar putea ajunge la rădăcină', () => {
    // Ruta de proiect e mereu prefixată cu /project/, deci un slug nu poate
    // ajunge aici — dar id-urile au mereu cifre sau litere după cratimă și
    // nicio a doua cratimă.
    expect(parseTicketPath('/my-super-project')).toBeNull()
  })
})

describe('prefixOf', () => {
  it('taie la prima cratimă', () => {
    expect(prefixOf('MS-03')).toBe('MS')
    expect(prefixOf('TUR-API')).toBe('TUR')
  })

  it('normalizează la uppercase', () => {
    expect(prefixOf('ms-03')).toBe('MS')
  })

  it('întoarce tot id-ul dacă nu există cratimă', () => {
    expect(prefixOf('MS03')).toBe('MS03')
  })
})

describe('ticketPath / ticketUrl', () => {
  it('construiește path-ul și URL-ul absolut', () => {
    expect(ticketPath('MS-03')).toBe('/MS-03')
    expect(ticketUrl('https://horizontal.app', 'MS-03')).toBe('https://horizontal.app/MS-03')
  })

  it('nu dublează slash-ul dacă origin-ul are unul', () => {
    expect(ticketUrl('https://horizontal.app/', 'MS-03')).toBe('https://horizontal.app/MS-03')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/deepLink.test.ts`
Expected: FAIL — `Failed to resolve import "./deepLink"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/deepLink.ts`:

```ts
// Deep links pentru tickete: URL-ul unui ticket e doar id-ul lui, la rădăcină
// (ex. /MS-03). Vezi docs/superpowers/specs/2026-07-28-ticket-deep-links-design.md
//
// Id-urile de issue au forma PREFIX-SUFIX (TUR-01, MS-03, TUR-API) — exact o
// cratimă, doar litere și cifre. Regexul e deliberat strict ca un slug de
// proiect (my-super-project) să nu fie confundat cu un id de ticket.

const TICKET_PATH = /^\/([A-Za-z0-9]+-[A-Za-z0-9]+)\/?$/

/** Id-ul ticketului din pathname, normalizat uppercase, sau null. */
export function parseTicketPath(pathname: string): string | null {
  const match = TICKET_PATH.exec(pathname)
  return match ? match[1].toUpperCase() : null
}

/** Prefixul de proiect al unui id de issue: 'MS-03' -> 'MS'. */
export function prefixOf(issueId: string): string {
  const dash = issueId.indexOf('-')
  return (dash === -1 ? issueId : issueId.slice(0, dash)).toUpperCase()
}

/** Path-ul canonic al unui ticket. */
export function ticketPath(issueId: string): string {
  return `/${issueId}`
}

/** URL absolut, pentru clipboard. */
export function ticketUrl(origin: string, issueId: string): string {
  return `${origin.replace(/\/$/, '')}${ticketPath(issueId)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/deepLink.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Verify types**

Run: `npm run typecheck`
Expected: fără erori.

- [ ] **Step 6: Commit**

```bash
git add src/lib/deepLink.ts src/lib/deepLink.test.ts
git commit -m "feat: add deep-link path helpers for ticket URLs"
```

---

### Task 2: Toast minimal

Nu există niciun mecanism de toast în aplicație (`grep -rn "toast" src/` → zero rezultate). Spec-ul cere unul pentru două mesaje: „ticketul nu mai există” și „Link copiat”. Se construiește aici ca primitivă, ca task-urile 4 și 5 doar să o folosească.

**Files:**
- Create: `src/components/Toast.tsx`
- Modify: `src/styles.css` (adaugă la final)

**Interfaces:**
- Consumes: nimic.
- Produces:
  - `<Toast message={string | null} onDone={() => void} />` — se afișează cât timp `message` nu e null, se ascunde singur după 2600 ms și cheamă `onDone()`. Un mesaj nou resetează cronometrul.

- [ ] **Step 1: Create the component**

Create `src/components/Toast.tsx`:

```tsx
// Toast tranzitoriu, fără dependențe. Deținătorul păstrează mesajul în state și
// îl golește în onDone.

import { useEffect } from 'react'

const DURATION = 2600

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const id = setTimeout(onDone, DURATION)
    return () => clearTimeout(id)
  }, [message, onDone])

  return (
    <div className={`toast ${message ? 'on' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  )
}
```

- [ ] **Step 2: Add the styles**

Append to `src/styles.css`:

```css
/* ── TOAST ───────────────────────────────────────── */
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
  transform: translate(-50%, 12px);
  z-index: 120;
  max-width: min(92vw, 420px);
  padding: 10px 16px;
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--line);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease, transform 160ms ease;
}
.toast.on {
  opacity: 1;
  transform: translate(-50%, 0);
}
```

- [ ] **Step 3: Verify the CSS variables exist**

Run: `grep -n -- "--panel\|--line\|--text" src/styles.css | head -5`
Expected: fiecare variabilă apare definită. Dacă vreuna lipsește, înlocuiește-o cu echivalentul folosit de `.sheet` din același fișier — nu inventa culori noi.

- [ ] **Step 4: Verify types**

Run: `npm run typecheck`
Expected: fără erori. (`Toast` nu e încă montat nicăieri — normal, îl montează Task 3.)

- [ ] **Step 5: Commit**

```bash
git add src/components/Toast.tsx src/styles.css
git commit -m "feat: add minimal toast primitive"
```

---

### Task 3: Sheet de ticket → URL

Când un sheet de ticket se deschide, URL-ul devine `/MS-03` prin `pushState`. Când se închide, `history.back()` — nu un `pushState` nou — ca istoricul să nu se umple. Rezultat: Back închide sheet-ul.

Sincronizarea proiect → URL care există deja (`src/App.tsx:183-190`) trebuie să nu mai calce peste URL-ul de ticket.

**Files:**
- Modify: `src/App.tsx` (import-uri; efectul de la liniile 183-190; efect nou; `popstate` la liniile 193-201; JSX-ul lui `Shell`)

**Interfaces:**
- Consumes: `parseTicketPath`, `ticketPath` din `src/lib/deepLink` (Task 1); `Toast` din `src/components/Toast` (Task 2).
- Produces:
  - `notice: string | null` + `setNotice` — state în `Shell`, folosit de Task 4 și 5 pentru mesaje de toast.
  - Invariant: cât timp `sheet.kind === 'issue-form' && sheet.issueId` e setat, `window.location.pathname` e `ticketPath(sheet.issueId)`.

- [ ] **Step 1: Add the imports**

În `src/App.tsx`, după linia 13 (`import { UsersView } from './components/UsersView'`):

```tsx
import { Toast } from './components/Toast'
import { parseTicketPath, ticketPath } from './lib/deepLink'
```

- [ ] **Step 2: Add state and refs to `Shell`**

În `Shell`, după `const urlSyncReady = useRef(false)` (linia 121):

```tsx
  const [notice, setNotice] = useState<string | null>(null)
  // Setat cât timp un deep link se rezolvă, ca sincronizarea proiect → URL să
  // nu scrie /project/<slug> peste /MS-03. Vezi Task 4.
  const deepLinkPending = useRef<string | null>(null)
```

- [ ] **Step 3: Make the project → URL sync yield to ticket URLs**

Înlocuiește efectul de la liniile 183-190 (`// Step 2 — sync project → URL using name slug`) cu:

```tsx
  // Step 2 — sync project → URL using name slug. Nu scrie nimic cât timp URL-ul
  // aparține unui ticket (deep link în curs de rezolvare, sau sheet deschis) —
  // altfel /project/<slug> ar călca peste /MS-03.
  useEffect(() => {
    if (!urlSyncReady.current) return
    const slug = project ? slugify(project.name) : null
    if (slug) localStorage.setItem('horizontal:last-project', slug)
    else localStorage.removeItem('horizontal:last-project')

    const ticketOwnsUrl = deepLinkPending.current !== null || parseTicketPath(window.location.pathname)
    if (ticketOwnsUrl) return

    const path = slug ? `/project/${slug}` : '/'
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Add the sheet → URL effect**

Imediat după efectul de la Step 3, adaugă:

```tsx
  // Sheet de ticket → URL. Deschiderea împinge o intrare în istoric, deci Back
  // închide sheet-ul. Închiderea face history.back() în loc de pushState, ca să
  // nu acumuleze intrări duplicate.
  const openTicketId = sheet.kind === 'issue-form' && sheet.issueId ? sheet.issueId : null
  useEffect(() => {
    if (!urlSyncReady.current) return
    const onTicketUrl = parseTicketPath(window.location.pathname)

    if (openTicketId) {
      const path = ticketPath(openTicketId)
      if (window.location.pathname !== path) {
        // Deep link în curs: URL-ul e deja corect, doar îl adoptăm.
        if (onTicketUrl === openTicketId) window.history.replaceState(null, '', path)
        else window.history.pushState(null, '', path)
      }
    } else if (onTicketUrl) {
      // Sheet-ul s-a închis dar URL-ul e încă de ticket → derulăm istoricul.
      // Garda `onTicketUrl` previne un back dublu când tocmai popstate a fost
      // cel care a închis sheet-ul (atunci URL-ul nu mai e de ticket).
      window.history.back()
    }
  }, [openTicketId])
```

- [ ] **Step 5: Teach `popstate` about ticket paths**

Înlocuiește efectul de `popstate` (liniile 193-201) cu:

```tsx
  // Browser back/forward → sync store. Un path de ticket nu schimbă proiectul;
  // doar deschide sau închide sheet-ul.
  useEffect(() => {
    const onPop = () => {
      const ticketId = parseTicketPath(window.location.pathname)
      if (ticketId) {
        openIssue(ticketId)
        return
      }
      if (sheetRef.current.kind !== 'none') closeSheet()
      const match = window.location.pathname.match(/^\/project\/(.+)$/)
      const found = match ? findBySlug(match[1]) : null
      selectProject(found?.id ?? null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [selectProject, projects, openIssue, closeSheet]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 6: Add the missing bindings the popstate handler needs**

`Shell` destructurează azi doar `openNewIssue, openNewProject, openProjectSettings, sheet` din `useUI()` (linia 111). Handler-ul de `popstate` are nevoie și de `openIssue` și `closeSheet`, plus o referință mereu-proaspătă la `sheet` (handler-ul e înregistrat o dată și ar captura un `sheet` învechit).

Înlocuiește linia 111 cu:

```tsx
  const { openNewIssue, openNewProject, openProjectSettings, openIssue, closeSheet, sheet } = useUI()
```

Și adaugă, imediat după declarația `deepLinkPending` din Step 2:

```tsx
  const sheetRef = useRef(sheet)
  sheetRef.current = sheet
```

- [ ] **Step 7: Mount the toast**

În JSX-ul returnat de `Shell`, imediat înainte de `<SheetHost />`, adaugă:

```tsx
        <Toast message={notice} onDone={() => setNotice(null)} />
```

Run: `grep -n "<SheetHost />" src/App.tsx`
Expected: o singură apariție — pune `<Toast ... />` pe linia de dinaintea ei.

- [ ] **Step 8: Verify types and tests**

Run: `npm run typecheck && npm test`
Expected: fără erori de tip; toate testele existente trec.

- [ ] **Step 9: Manual verification**

Run: `npm run dev`, apoi în browser la `http://localhost:5173`:

1. Intră într-un proiect, click pe un card. **Așteptat:** bara de adrese arată `http://localhost:5173/TUR-01` (id-ul cardului pe care ai dat click).
2. Apasă Back. **Așteptat:** sheet-ul se închide, URL-ul revine la `/project/<slug>`, rămâi în proiect.
3. Apasă Back din nou. **Așteptat:** ajungi la lista de proiecte.
4. Deschide un card, apoi închide-l cu `✕`. **Așteptat:** URL-ul revine la `/project/<slug>`; un singur Back te scoate apoi din proiect (nu două).
5. Deschide un card, apoi Back, apoi Forward. **Așteptat:** cardul se redeschide.

Dacă pasul 4 cere două Back-uri, `history.back()` din Step 4 nu s-a executat — verifică garda `onTicketUrl`.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx
git commit -m "feat: sync open ticket sheet to the URL"
```

---

### Task 4: URL → ticket (rezoluția deep link-ului la load)

Un URL `/MS-03` deschis la rece trebuie să selecteze proiectul potrivit și să deschidă ticketul. Issues nu sunt încărcate la boot, deci: prefix → proiect → așteaptă încărcarea issues → deschide sheet-ul sau arată toast.

**Files:**
- Modify: `src/App.tsx` (efectul „Step 1 — on load” de la liniile 166-180; efect nou)

**Interfaces:**
- Consumes: `parseTicketPath`, `prefixOf` din `src/lib/deepLink` (Task 1); `deepLinkPending`, `setNotice`, `openIssue` (Task 3); `issues`, `byId`, `project` din `useHorizontal()`.
- Produces: nimic pentru task-uri următoare.

- [ ] **Step 1: Extend the import from Task 1**

În `src/App.tsx`, extinde import-ul adăugat în Task 3:

```tsx
import { parseTicketPath, prefixOf, ticketPath } from './lib/deepLink'
```

- [ ] **Step 2: Pull `issues` and `byId` from the store**

Înlocuiește linia 110 (`const { loading, error, project, projects, selectProject, refresh } = useHorizontal()`) cu:

```tsx
  const { loading, error, project, projects, issues, byId, selectProject, refresh } = useHorizontal()
```

- [ ] **Step 3: Handle a ticket path in the on-load effect**

Înlocuiește efectul „Step 1 — on load” (liniile 166-180) cu:

```tsx
  // Step 1 — on load: read path, select project, then unlock URL sync.
  // Un path de ticket (/MS-03) nu conține proiectul, așa că îl deducem din
  // prefixul id-ului. Issues se încarcă lazy, deci sheet-ul se deschide mai
  // târziu, într-un efect separat, după ce ajung datele.
  useEffect(() => {
    if (loading) return
    const ticketId = parseTicketPath(window.location.pathname)
    if (ticketId) {
      const prefix = prefixOf(ticketId)
      const found = projects.find((p) => p.prefix.toUpperCase() === prefix)
      if (found) {
        deepLinkPending.current = ticketId
        selectProject(found.id)
      } else {
        setNotice(`Ticketul ${ticketId} nu mai există`)
        const lastSlug = localStorage.getItem('horizontal:last-project')
        const fallback = lastSlug ? findBySlug(lastSlug) : null
        if (fallback) selectProject(fallback.id)
      }
    } else {
      const match = window.location.pathname.match(/^\/project\/(.+)$/)
      if (match) {
        const found = findBySlug(match[1])
        if (found) selectProject(found.id)
      } else {
        const lastSlug = localStorage.getItem('horizontal:last-project')
        if (lastSlug) {
          const found = findBySlug(lastSlug)
          if (found) selectProject(found.id)
        }
      }
    }
    urlSyncReady.current = true
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Open the sheet once the issues arrive**

După efectul din Step 3, adaugă:

```tsx
  // Rezolvă deep link-ul în așteptare de îndată ce issues proiectului sunt
  // încărcate. `issues` e derivat din proiectul activ, deci un array nevid
  // înseamnă că datele au ajuns.
  useEffect(() => {
    const pending = deepLinkPending.current
    if (!pending || !project || issues.length === 0) return
    deepLinkPending.current = null
    if (byId[pending]) openIssue(pending)
    else setNotice(`Ticketul ${pending} nu mai există`)
  }, [issues, project, byId, openIssue])
```

- [ ] **Step 5: Verify types and tests**

Run: `npm run typecheck && npm test`
Expected: fără erori; testele existente trec.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. Ia un id real de ticket din aplicație (ex. `TUR-01`), apoi:

1. Navighează direct la `http://localhost:5173/TUR-01` (reîncărcare completă, nu navigare in-app). **Așteptat:** se încarcă proiectul corect și sheet-ul ticketului se deschide singur; URL-ul rămâne `/TUR-01`.
2. Cu litere mici: `http://localhost:5173/tur-01`. **Așteptat:** același rezultat.
3. Id inexistent, prefix valid: `http://localhost:5173/TUR-999`. **Așteptat:** aterizezi în proiectul TUR, fără sheet, toast `Ticketul TUR-999 nu mai există`.
4. Prefix inexistent: `http://localhost:5173/ZZZ-01`. **Așteptat:** aterizezi în ultimul proiect folosit, toast `Ticketul ZZZ-01 nu mai există`.
5. Din starea de la pasul 1, apasă Back. **Așteptat:** sheet-ul se închide, rămâi în proiect.
6. Verifică regresia: `http://localhost:5173/project/<slug>` se comportă ca înainte, și `http://localhost:5173/` deschide ultimul proiect folosit.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: resolve ticket deep links on load via project prefix"
```

---

### Task 5: Buton de copiere link + tasta `y`

În PWA-ul instalat nu există bară de adrese, deci fără acest buton URL-ul nu poate fi copiat pe telefon — adică exact cazul de folosire.

Nu poți folosi handler-ul global de shortcuts din `App.tsx`: iese devreme cu `if (sheet.kind !== 'none') return` (linia 211). Tasta `y` trăiește deci în `IssueForm`.

**Files:**
- Modify: `src/components/IssueForm.tsx` (import-uri; `IssueForm`, la linia 138+; header-ul, la linia 461+)
- Modify: `src/styles.css` (adaugă lângă regulile `.sh-close` / `.sh-delete`, în jurul liniei 2730)

**Interfaces:**
- Consumes: `ticketUrl` din `src/lib/deepLink` (Task 1).
- Produces: nimic pentru task-uri următoare.

Butonul își arată propria confirmare inline (bifă timp de 1600 ms), nu folosește `Toast` — `IssueForm` nu are acces la `setNotice` din `Shell`, iar o confirmare la sursa acțiunii e mai clară decât una la baza ecranului. Cerința „confirmare vizibilă” din spec e satisfăcută.

- [ ] **Step 1: Add the import**

În `src/components/IssueForm.tsx`, lângă celelalte import-uri din `../lib`:

```tsx
import { ticketUrl } from '../lib/deepLink'
```

- [ ] **Step 2: Add copy state and handler**

În `IssueForm`, după `const isEdit = !!existing` (linia 143):

```tsx
  const [copied, setCopied] = useState(false)

  // Copiază link-ul absolut al ticketului. Necesar în PWA instalat, unde nu
  // există bară de adrese. clipboard.writeText cere context securizat (https
  // sau localhost) — fallback pe un textarea ascuns dacă lipsește.
  const copyLink = useCallback(async () => {
    if (!existing) return
    const url = ticketUrl(window.location.origin, existing.id)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }, [existing])

  // Tasta `y` (convenția GitHub/Linear). Handler-ul global de shortcuts din
  // App.tsx nu se aplică aici — iese devreme când un sheet e deschis.
  useEffect(() => {
    if (!isEdit) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        void copyLink()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isEdit, copyLink])
```

Verifică că `useCallback` și `useEffect` sunt importate din `react` în capul fișierului; adaugă-le la import-ul existent dacă lipsesc.

Run: `grep -n "^import.*from 'react'" src/components/IssueForm.tsx`
Expected: import-ul include `useState`, `useEffect`, `useCallback`.

- [ ] **Step 3: Add the button to the header**

În `src/components/IssueForm.tsx`, în `<div className="sh-header">`, imediat după butonul `sh-close` (linia 462):

```tsx
        {isEdit && (
          <button
            tabIndex={-1}
            className={`sh-copy${copied ? ' copied' : ''}`}
            onClick={() => void copyLink()}
            aria-label="Copiază link"
            title="Copiază link către ticket (y)"
          >
            {copied ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        )}
```

- [ ] **Step 4: Add the styles**

În `src/styles.css`, imediat după regulile `.sh-delete` (în jurul liniei 2731), adaugă:

```css
.sh-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--line);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.sh-copy:hover {
  background: var(--panel);
  color: var(--text);
}
.sh-copy.copied {
  color: var(--accent);
  border-color: var(--accent);
}
```

Run: `grep -n -- "--muted\|--accent" src/styles.css | head -3`
Expected: ambele variabile sunt definite. Dacă `--accent` lipsește, folosește variabila pe care o folosește `.sh-delete` pentru starea ei activă.

- [ ] **Step 5: Verify types and tests**

Run: `npm run typecheck && npm test`
Expected: fără erori; testele trec.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, apoi:

1. Deschide un ticket existent. **Așteptat:** în header apare icònul de copiere lângă `✕`.
2. Click pe el. **Așteptat:** icònul devine o bifă ~1,6 s; clipboard-ul conține `http://localhost:5173/TUR-01`.
3. Lipește URL-ul într-un tab nou. **Așteptat:** se deschide exact acel ticket.
4. Cu sheet-ul deschis și focus în afara câmpurilor, apasă `y`. **Așteptat:** aceeași bifă.
5. Click într-un câmp de text și tastează `y`. **Așteptat:** se scrie „y” în câmp; nu se copiază nimic.
6. Deschide sheet-ul de **ticket nou** (nu editare). **Așteptat:** butonul de copiere nu apare (nu există încă id).

- [ ] **Step 7: Commit**

```bash
git add src/components/IssueForm.tsx src/styles.css
git commit -m "feat: add copy-link button and y shortcut to ticket sheet"
```

---

### Task 6: Verificarea rutei în producție

`/project/<slug>` funcționează azi în producție, dar `/MS-03` e un path nou la rădăcină. Cloudflare Pages servește `index.html` pentru rutele fără corespondent doar când nu există `404.html`; nu există `public/_redirects` în repo. Trebuie confirmat, nu presupus.

**Files:**
- Create (doar dacă verificarea eșuează): `public/_redirects`

**Interfaces:**
- Consumes: build-ul complet din task-urile 1-5.
- Produces: nimic.

- [ ] **Step 1: Build and preview**

Run: `npm run build && npm run preview`
Expected: build reușit; preview pornește (tipic pe `http://localhost:4173`).

- [ ] **Step 2: Check the ticket route in the preview server**

Navighează direct la `http://localhost:4173/TUR-01` (folosește un id real).
Expected: aplicația se încarcă și ticketul se deschide — nu un 404.

- [ ] **Step 3: Add the SPA fallback only if step 2 returned 404**

Dacă pasul 2 a dat 404, create `public/_redirects`:

```
/api/*  /api/:splat  200
/*      /index.html  200
```

Regula pentru `/api/*` merge prima ca să nu înghită Pages Functions din `functions/api/`. Apoi repetă pașii 1-2.

Dacă pasul 2 a funcționat, nu crea niciun fișier — sari la Step 4.

- [ ] **Step 4: Verify the API still works**

În preview sau după deploy, confirmă că un endpoint din `functions/api/` răspunde în continuare (ex. `GET /api/projects` întoarce JSON, nu HTML-ul aplicației).

- [ ] **Step 5: Commit if anything changed**

```bash
git add public/_redirects
git commit -m "fix: serve SPA fallback for root-level ticket routes"
```

Dacă nu s-a schimbat nimic, sari peste commit.

---

## Verificare finală

- [ ] `npm test` — toate testele trec
- [ ] `npm run typecheck` — fără erori
- [ ] `npm run build` — reușește
- [ ] Deep link la rece (`/TUR-01` cu reîncărcare completă) deschide ticketul
- [ ] Click pe card actualizează URL-ul; Back închide sheet-ul
- [ ] Butonul de copiere și tasta `y` copiază URL-ul absolut
- [ ] Regresie: `/project/<slug>` și `/` se comportă ca înainte
