# Offline — baza locală și coada de scrieri — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicația pornește instant din datele locale, se citește complet și se editează (creare, bifare, amânare, câmpuri) fără rețea, iar la revenirea rețelei se sincronizează singură.

**Architecture:** Un înveliș `createOfflineRepository(remote, kv)` care implementează aceeași interfață `Repository` și deleagă la `supabaseRepository`. Cache-ul („baza") ține ultimul răspuns al serverului în IndexedDB; scrierile offline intră într-o coadă (`outbox`) tot în IndexedDB; ce vede aplicația = baza + coada rejucată peste ea (`overlay`). Store-ul randează întâi din cache (`repository.cache`), apoi pe drumul de reîmprospătare existent; evenimentele de sincronizare (`repository.sync`) îi spun când un ID provizoriu a devenit real sau când o scriere a fost refuzată.

**Tech Stack:** TypeScript, React 18, Vite, vitest 2, `idb` (înveliș subțire peste IndexedDB), `fake-indexeddb` (teste), workbox (service worker).

**Spec:** `docs/superpowers/specs/2026-10-02-offline-baza-locala-design.md`

## Global Constraints

- Lucrul se face pe o ramură (`offline`), **niciodată push pe `master`** fără acordul utilizatorului: push pe `master` = publicare în producție (`CLAUDE.md`).
- Înainte de îmbinare: `npm test`, `npm run typecheck`, `npm run test:upgrade` (se atinge `src/sw.ts`), `npm run test:nav` (se atinge store-ul și navigarea).
- `loading` rămâne doar al PORNIRII; reîmprospătarea ridică `refreshing` (`CLAUDE.md`, „Reîmprospătarea datelor"). Pornirea din cache pune `loading = false` fără să aștepte rețeaua.
- Merge offline: citirea a tot ce e în cache; `createIssue`; `updateIssue`; `deleteIssue(s)`; `markSeen`. Restul aruncă `OfflineError` cu mesajul exact `Necesită rețea — ești offline.`
- Conflict: ultima scriere câștigă, câmp cu câmp; `deps` se înlocuiește întreg.
- ID provizoriu: `<PREFIX>-~<6 caractere>`, afișat ca `<PREFIX>-·`.
- Recurența rămâne autoritate de server (`issues_zz_advance_recurrence`); clientul doar o oglindește pentru afișare, cu aceeași funcție ca `localRepository`.
- Comentariile din cod sunt în română, cu diacritice, și explică DE CE — ca în restul repo-ului.
- Nicio componentă nu află dacă repository-ul e offline sau nu, în afara indicatorului din header și a punții de redenumire.
- **Abatere asumată de la spec:** spec-ul cere `npm run test:nav` extins cu o pornire offline. `test:nav` rulează pe backendul LOCAL, pe care învelișul nu-l acoperă (`src/data/index.ts` învelește doar Supabase), deci extinderea n-ar testa nimic. Pornirea offline e acoperită de testele unitare (Task 6–8, 11) și de scenariile manuale din Task 13. `test:nav` rămâne obligatoriu ca regresie pentru refactorul din Task 10.

## Review Focus

1. **O bifă pe o sarcină recurentă, offline, apoi o reîmprospătare înainte de sincronizare** — saltul trebuie să rămână vizibil (overlay peste baza veche), nu să se „anuleze" la refresh. Test în Task 4 (`overlay`).
2. **Ștergerea unei sarcini create offline, încă netrimise** — nu trebuie să plece la server nici crearea, nici ștergerea; dependențele altor tichete spre ea dispar. Test în Task 7.
3. **O scriere refuzată de server (RLS, tichet șters pe alt dispozitiv)** — nu blochează coada la infinit; tichetul revine la valoarea serverului; restul cozii continuă. Test în Task 8.
4. **O eroare de cod (`TypeError` dintr-un bug) nu e confundată cu „offline"** — altfel s-ar pune la coadă și s-ar reîncerca la nesfârșit. Test în Task 3.
5. **Pornire offline cu sesiunea expirată** — aplicația rămâne în interfață pe cache, nu sare la `Login`. Test în Task 11.

---

## Structura fișierelor

| Fișier | Rol |
|---|---|
| `src/lib/issuePatch.ts` (nou) | `applyIssuePatch` — aplicarea unui patch cu oglinda trigger-ului de recurență. Extras din `localRepository`. |
| `src/lib/issueId.ts` (nou) | ID-uri provizorii: creare, recunoaștere, afișare. |
| `src/data/offline/netError.ts` (nou) | `OfflineError`, `isNetworkError`, `withTimeout`. |
| `src/data/offline/ops.ts` (nou) | Tipurile cozii + funcții pure: `overlay`, `remapOp`, `cancelTempIssues`, `deriveDue`, `echoIssue`. |
| `src/data/offline/kv.ts` (nou) | Înveliș IndexedDB: cheie-valoare + coadă, tranzacții atomice. |
| `src/data/offline/types.ts` (nou) | `CacheReader`, `SyncControl`, `SyncEvent`, `SyncStatus`, `ProjectBundle`. |
| `src/data/offline/offlineRepository.ts` (nou) | Învelișul: citiri, scrieri, golirea cozii, evenimente. |
| `src/data/offline/channel.ts` (nou) | `BroadcastChannel` între file + lacăt de golire (Web Locks). |
| `src/lib/storedSession.ts` (nou) | Citirea sesiunii Supabase din `localStorage` pentru pornirea offline. |
| `src/data/repository.ts` | + `cache?` și `sync?` opționale pe `Repository`. |
| `src/data/index.ts` | Învelește repository-ul de Supabase. |
| `src/data/localRepository.ts` | Folosește `applyIssuePatch`. |
| `src/store.tsx` | Pornire din cache, `applyProjectBundle`, abonare la evenimente, `syncStatus`. |
| `src/ui.tsx` | `renameIssueId(from, to)` pe stiva de foi. |
| `src/App.tsx` | `SyncBridge` (redenumire în foi + URL), indicatorul din header. |
| `src/components/*` (afișarea ID-ului) | `displayIssueId(id)`. |
| `src/components/IssueForm.tsx` | Copierea linkului refuzată pentru ID provizoriu. |
| `src/components/Sidebar.tsx` | Logout: avertisment + golirea bazei locale. |
| `src/auth.tsx` | Sesiunea nu se pierde offline. |
| `src/sw.ts` | Rută de navigare → `index.html` (deep link offline). |
| `src/styles.css` | `.sync-status`. |

---

### Task 0: Mediul și ramura

**Files:** niciunul de cod.

- [ ] **Step 1: Ramura de lucru**

```bash
cd /home/q/01Proiecte/Horizontal
git switch -c offline
```

- [ ] **Step 2: Dependențele existente (lipsesc `node_modules`) și cele noi**

```bash
npm ci
npm install idb@^8
npm install -D fake-indexeddb@^6
```

- [ ] **Step 3: Starea de plecare e verde**

Run: `npm test && npm run typecheck`
Expected: PASS. Dacă ceva pică ÎNAINTE de orice schimbare, oprește-te și raportează — nu e treaba planului ăstuia.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(offline): idb și fake-indexeddb"
```

---

### Task 1: `applyIssuePatch` — patch-ul cu oglinda recurenței, într-un singur loc

Coada offline trebuie să aplice un patch exact cum o face `localRepository` (inclusiv saltul recurenței). Două copii ale regulii ar diverge; deci o extragem.

**Files:**
- Create: `src/lib/issuePatch.ts`
- Create: `src/lib/issuePatch.test.ts`
- Modify: `src/data/localRepository.ts:311-351` (corpul lui `updateIssue`)

**Interfaces:**
- Produces: `applyIssuePatch(issue: Issue, patch: Partial<Issue>, now: Date): Issue` — întoarce un obiect NOU, nu modifică intrarea.

- [ ] **Step 1: Testul care pică**

```ts
// src/lib/issuePatch.test.ts
import { describe, expect, it } from 'vitest'
import { applyIssuePatch } from './issuePatch'
import type { Issue } from './types'

const base: Issue = {
  id: 'HZ-01', projectId: 'p', title: 'bea apă', desc: '', theme: '', wave: 1, deps: [],
  done: false, selectors: [], scenarios: [], assigneeId: null, createdBy: null,
  createdAt: '2026-09-01T00:00:00.000Z', urgent: false,
  dueAt: '2026-09-28T07:00:00.000Z', allDay: false, remindAt: '2026-09-28T06:50:00.000Z',
  rrule: 'FREQ=DAILY',
}

describe('applyIssuePatch', () => {
  it('aplică un patch simplu fără să modifice intrarea', () => {
    const out = applyIssuePatch(base, { title: 'bea ceai' }, new Date('2026-10-01T09:00:00Z'))
    expect(out.title).toBe('bea ceai')
    expect(base.title).toBe('bea apă')
  })

  it('bifarea unei recurente sare din ziua curentă și păstrează decalajul mementoului', () => {
    const out = applyIssuePatch(base, { done: true }, new Date('2026-10-01T09:00:00Z'))
    expect(out.done).toBe(false)
    expect(new Date(out.dueAt!).getTime()).toBeGreaterThan(new Date('2026-10-01T09:00:00Z').getTime())
    expect(new Date(out.dueAt!).getTime() - new Date(out.remindAt!).getTime()).toBe(10 * 60_000)
  })

  it('a doua bifare pe un tichet deja bifat nu mai sare', () => {
    const out = applyIssuePatch({ ...base, done: true }, { done: true }, new Date('2026-10-01T09:00:00Z'))
    expect(out.dueAt).toBe(base.dueAt)
    expect(out.done).toBe(true)
  })

  it('fără rrule, bifarea doar bifează', () => {
    const out = applyIssuePatch({ ...base, rrule: null }, { done: true }, new Date())
    expect(out.done).toBe(true)
    expect(out.dueAt).toBe(base.dueAt)
  })
})
```

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/lib/issuePatch.test.ts`
Expected: FAIL — `Cannot find module './issuePatch'`.

- [ ] **Step 3: Implementarea**

```ts
// src/lib/issuePatch.ts
// Aplicarea unui patch pe un tichet, cu oglinda trigger-ului de recurență.
//
// De ce aici și nu în `localRepository`: și coada offline trebuie să arate
// saltul imediat, înainte să răspundă serverul. Două copii ale regulii ar
// diverge la prima corectură; o funcție, două apelanți. Legea rămâne
// `issues_zz_advance_recurrence` din `supabase/migration-recurrence.sql` —
// asta doar o repetă în TS, pentru afișare.

import { nextOccurrence } from './recurrence'
import type { Issue } from './types'

export function applyIssuePatch(issue: Issue, patch: Partial<Issue>, now: Date): Issue {
  // `wasDone` e citit ÎNAINTE de aplicare: trigger-ul verifică o TRANZIȚIE
  // (`new.done and not old.done`), nu doar valoarea din patch. Un
  // `{ done: true }` pe un tichet deja bifat n-are voie să sară a doua oară.
  const wasDone = issue.done
  const out: Issue = { ...issue, ...patch }
  if (!wasDone && patch.done === true && out.rrule && out.dueAt) {
    const nxt = nextOccurrence(out.rrule, now, out.dueAt)
    if (nxt) {
      // Perechea din starea FINALĂ a patch-ului — ca `new.due_at - new.remind_at`
      // din trigger, nu `old.due_at`.
      const delta = out.remindAt ? new Date(out.dueAt).getTime() - new Date(out.remindAt).getTime() : null
      out.dueAt = nxt
      out.remindAt = delta === null ? null : new Date(new Date(nxt).getTime() - delta).toISOString()
      out.done = false
    }
  }
  return out
}
```

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/lib/issuePatch.test.ts`
Expected: PASS (4 teste).

- [ ] **Step 5: `localRepository` folosește funcția**

În `src/data/localRepository.ts`, înlocuiește corpul lui `updateIssue` (de la `const wasDone = issue.done` până la blocul `if (!wasDone && …) { … }` inclusiv) cu:

```ts
    async updateIssue(id: string, patch: Partial<Issue>) {
      const db = load()
      const idx = db.issues.findIndex((i) => i.id === id)
      if (idx === -1) throw new Error(`Unknown issue ${id}`)
      // Oglinda trigger-ului de recurență trăiește în `applyIssuePatch` — vezi
      // comentariul de acolo. Ce e în `supabase/migration-recurrence.sql` e legea.
      // `reminder_sent_at` n-are ce oglindi aici: e o coloană de server, nu există
      // în `Issue`, iar modul local n-are nici cron, nici trimițător.
      db.issues[idx] = applyIssuePatch(db.issues[idx], patch, new Date())
      save(db)
      return clone(db.issues[idx])
    },
```

și adaugă importul `import { applyIssuePatch } from '../lib/issuePatch'`. Scoate importul `nextOccurrence` dacă nu mai e folosit în fișier.

- [ ] **Step 6: Regresia modului local**

Run: `npx vitest run src/data/localRepository.test.ts src/lib/issuePatch.test.ts && npm run typecheck`
Expected: PASS — testele existente de recurență din `localRepository.test.ts` trec neschimbate.

- [ ] **Step 7: Commit**

```bash
git add src/lib/issuePatch.ts src/lib/issuePatch.test.ts src/data/localRepository.ts
git commit -m "refactor(recurență): applyIssuePatch, o singură oglindă a trigger-ului"
```

---

### Task 2: ID-uri provizorii și afișarea lor

**Files:**
- Create: `src/lib/issueId.ts`, `src/lib/issueId.test.ts`
- Modify (afișare): `src/components/TicketCard.tsx:77`, `src/components/ListView.tsx:208`, `src/components/ThemesView.tsx:80,103`, `src/components/QuickSearch.tsx:168`, `src/components/ObstacleForm.tsx:194,230`, `src/components/IssueForm.tsx:1464,1500,1512`
- Modify: `src/components/IssueForm.tsx` (`copyLink`, ~linia 275)

**Interfaces:**
- Produces: `makeTempIssueId(prefix: string, rand?: () => string): string`, `isTempIssueId(id: string): boolean`, `displayIssueId(id: string): string`.

- [ ] **Step 1: Testul care pică**

```ts
// src/lib/issueId.test.ts
import { describe, expect, it } from 'vitest'
import { displayIssueId, isTempIssueId, makeTempIssueId } from './issueId'
import { parseTicketPath } from './deepLink'

describe('ID provizoriu', () => {
  it('are prefixul proiectului și un marcaj imposibil într-un ID real', () => {
    const id = makeTempIssueId('HZ', () => 'a1b2c3')
    expect(id).toBe('HZ-~a1b2c3')
    expect(isTempIssueId(id)).toBe(true)
    expect(isTempIssueId('HZ-12')).toBe(false)
  })
  it('se afișează ca PREFIX-·', () => {
    expect(displayIssueId('HZ-~a1b2c3')).toBe('HZ-·')
    expect(displayIssueId('HZ-12')).toBe('HZ-12')
  })
  it('nu e recunoscut ca deep link — un URL provizoriu nu deschide nimic la repornire', () => {
    expect(parseTicketPath('/HZ-~a1b2c3')).toBeNull()
  })
  it('două ID-uri generate implicit diferă', () => {
    expect(makeTempIssueId('HZ')).not.toBe(makeTempIssueId('HZ'))
  })
})
```

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/lib/issueId.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Implementarea**

```ts
// src/lib/issueId.ts
// ID-uri provizorii pentru tichetele create offline.
//
// `HZ-12` e calculat de client ca „cel mai mare + 1" (`nextIssueId` din
// `supabaseRepository.ts`). Două dispozitive offline ar crea amândouă `HZ-13`.
// Deci offline nu se inventează un număr: se pune un marcaj (`-~`) care nu
// poate apărea într-un ID real (`TICKET_PATH` din `deepLink.ts` nu-l acceptă),
// iar la sincronizare serverul dă numărul.

const MARK = '-~'

export function makeTempIssueId(
  prefix: string,
  rand: () => string = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0'),
): string {
  return `${prefix}${MARK}${rand()}`
}

export function isTempIssueId(id: string): boolean {
  return id.includes(MARK)
}

/** Ce vede omul: `HZ-·` până primește numărul real. */
export function displayIssueId(id: string): string {
  const i = id.indexOf(MARK)
  return i === -1 ? id : `${id.slice(0, i)}-·`
}
```

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/lib/issueId.test.ts`
Expected: PASS.

- [ ] **Step 5: Afișarea**

În fiecare loc din lista „Modify (afișare)", înlocuiește `{X.id}` / `{id}` din interiorul elementului de ID cu `{displayIssueId(X.id)}` / `{displayIssueId(id)}` și adaugă `import { displayIssueId } from '../lib/issueId'`. Exemplu, `TicketCard.tsx:77`:

```tsx
        <span className="tk-id">{displayIssueId(id)}</span>
```

NU atinge atributele `key=`, `data-issue-id=` sau ID-urile de obstacol (`WaveGate.tsx:81` e `o.id` al unui obstacol — rămâne neschimbat). Apoi caută locuri ratate:

Run: `grep -rnE '>\{(issue|i|it|item|t|dep|d)?\.?id\}<' src/components | grep -v displayIssueId`
Expected: nicio linie care afișează un ID de TICHET.

- [ ] **Step 6: Linkul nu se copiază pentru un ID provizoriu**

În `src/components/IssueForm.tsx`, la începutul lui `copyLink`:

```ts
  const copyLink = useCallback(async (id: string | undefined) => {
    if (!id) return
    // Un tichet creat offline n-are încă număr: linkul `/HZ-~…` n-ar deschide
    // nimic pe alt dispozitiv. Se refuză vizibil, nu în tăcere.
    if (isTempIssueId(id)) { setCopyState('fail'); return }
```

și pe butonul de copiere (`aria-label` de la ~linia 1196), `title` devine `Linkul apare după sincronizare` când `isTempIssueId(issue.id)`. Importă `isTempIssueId`.

- [ ] **Step 7: Verificare**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/issueId.ts src/lib/issueId.test.ts src/components
git commit -m "feat(offline): ID-uri provizorii, afișate ca PREFIX-·"
```

---

### Task 3: Erorile de rețea, separate de restul

**Files:**
- Create: `src/data/offline/netError.ts`, `src/data/offline/netError.test.ts`

**Interfaces:**
- Produces: `class OfflineError extends Error` (mesaj implicit `Necesită rețea — ești offline.`, `name = 'OfflineError'`); `isNetworkError(e: unknown): boolean`; `withTimeout<T>(p: Promise<T>, ms: number): Promise<T>` (respinge cu `OfflineError` la depășire).

- [ ] **Step 1: Testul care pică**

```ts
// src/data/offline/netError.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineError, isNetworkError, withTimeout } from './netError'

afterEach(() => vi.unstubAllGlobals())

describe('isNetworkError', () => {
  it('recunoaște eșecul de fetch al browserului', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true)
  })
  it('recunoaște forma PostgREST a aceluiași eșec (obiect simplu, nu Error)', () => {
    expect(isNetworkError({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' })).toBe(true)
  })
  it('recunoaște eroarea reîncercabilă de auth', () => {
    expect(isNetworkError({ name: 'AuthRetryableFetchError', message: '' })).toBe(true)
  })
  it('NU confundă un bug de cod cu offline', () => {
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false)
  })
  it('NU confundă o eroare de server cu offline', () => {
    expect(isNetworkError({ message: 'new row violates row-level security policy', code: '42501' })).toBe(false)
  })
  it('navigator.onLine === false înseamnă offline, orice ar fi eroarea', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(isNetworkError(new Error('orice'))).toBe(true)
  })
  it('OfflineError e de rețea și are mesajul fix', () => {
    const e = new OfflineError()
    expect(isNetworkError(e)).toBe(true)
    expect(e.message).toBe('Necesită rețea — ești offline.')
  })
})

describe('withTimeout', () => {
  it('respinge cu OfflineError după prag', async () => {
    vi.useFakeTimers()
    const p = withTimeout(new Promise(() => {}), 1000)
    vi.advanceTimersByTime(1001)
    await expect(p).rejects.toBeInstanceOf(OfflineError)
    vi.useRealTimers()
  })
  it('lasă rezultatul să treacă', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
  })
})
```

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/data/offline/netError.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Implementarea**

```ts
// src/data/offline/netError.ts
// Ce înseamnă „n-am rețea", separat de „serverul a zis nu".
//
// Distincția decide soarta unei scrieri: una de rețea se pune la coadă și se
// reîncearcă; una de server (RLS, constrângere) se respinge și se anunță.
// Confundate, un bug de cod (`TypeError: Cannot read…`) ar sta în coadă la
// infinit — de-aia `TypeError` NU e suficient, contează mesajul.

export class OfflineError extends Error {
  constructor(message = 'Necesită rețea — ești offline.') {
    super(message)
    this.name = 'OfflineError'
  }
}

// Mesajele cu care Chromium, Firefox, Safari și Node (undici) raportează un
// fetch care n-a ajuns nicăieri. PostgREST le împachetează ca
// `{ message: 'TypeError: Failed to fetch' }`, deci se caută în text.
const NET = /failed to fetch|networkerror|load failed|fetch failed|network request failed/i

export function isNetworkError(e: unknown): boolean {
  if (e instanceof OfflineError) return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (typeof e !== 'object' || e === null) return false
  const o = e as { name?: unknown; message?: unknown }
  if (o.name === 'AuthRetryableFetchError') return true
  return typeof o.message === 'string' && NET.test(o.message)
}

/** Doar pentru CITIRI: o rețea care atârnă e, pentru om, o rețea care lipsește.
 *  Nu se pune pe scrieri — o scriere abandonată la timeout poate ajunge totuși
 *  la server, iar reîncercarea ar dubla-o. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new OfflineError()), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}
```

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/data/offline/netError.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/offline/netError.ts src/data/offline/netError.test.ts
git commit -m "feat(offline): OfflineError și recunoașterea erorilor de rețea"
```

---

### Task 4: Coada — tipuri și funcții pure

**Files:**
- Create: `src/data/offline/ops.ts`, `src/data/offline/ops.test.ts`

**Interfaces:**
- Consumes: `applyIssuePatch` (Task 1).
- Produces:
  ```ts
  type OutboxOp =
    | { kind: 'createIssue'; tempId: string; input: NewIssue; echo: Issue }
    | { kind: 'updateIssue'; id: string; patch: Partial<Issue> }
    | { kind: 'deleteIssues'; ids: string[] }
    | { kind: 'markSeen'; issueId: string }
  interface QueuedOp { seq: number; op: OutboxOp; at: string }
  overlay(base: Issue[], ops: OutboxOp[], now: Date): Issue[]
  remapOp(op: OutboxOp, from: string, to: string): OutboxOp
  cancelTempIssues(queued: QueuedOp[], tempIds: string[]): { remove: number[]; rewrite: QueuedOp[] }
  deriveDue(issues: Issue[], range: DueRange): Issue[]
  echoIssue(input: NewIssue, id: string, project: Project, createdBy: string | null, now: Date): Issue
  opIssueIds(op: OutboxOp): string[]
  ```

- [ ] **Step 1: Testul care pică**

```ts
// src/data/offline/ops.test.ts
import { describe, expect, it } from 'vitest'
import { cancelTempIssues, deriveDue, echoIssue, overlay, remapOp, type QueuedOp } from './ops'
import type { Issue, Project } from '../../lib/types'

const now = new Date('2026-10-02T09:00:00Z')
const proj: Project = { id: 'p', name: 'P', description: '', prefix: 'HZ', currentWave: 2, accent: '#000', type: 'personal' }
const mk = (id: string, over: Partial<Issue> = {}): Issue => ({
  id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [],
  scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-09-01T00:00:00.000Z', urgent: false,
  dueAt: null, allDay: true, remindAt: null, rrule: null, ...over,
})
const q = (seq: number, op: QueuedOp['op']): QueuedOp => ({ seq, op, at: now.toISOString() })

describe('echoIssue', () => {
  it('construiește tichetul local cu valul curent al proiectului', () => {
    const e = echoIssue({ projectId: 'p', title: 'sună la bancă' }, 'HZ-~x', proj, 'u1', now)
    expect(e).toMatchObject({ id: 'HZ-~x', title: 'sună la bancă', wave: 2, done: false, createdBy: 'u1', deps: [] })
  })
})

describe('overlay', () => {
  it('adaugă creările, aplică patch-urile, scoate ștergerile', () => {
    const base = [mk('HZ-01'), mk('HZ-02', { deps: ['HZ-01'] })]
    const out = overlay(base, [
      { kind: 'createIssue', tempId: 'HZ-~a', input: { projectId: 'p', title: 'n' }, echo: mk('HZ-~a') },
      { kind: 'updateIssue', id: 'HZ-02', patch: { title: 'nou' } },
      { kind: 'deleteIssues', ids: ['HZ-01'] },
    ], now)
    expect(out.map((i) => i.id)).toEqual(['HZ-02', 'HZ-~a'])
    expect(out[0]).toMatchObject({ title: 'nou', deps: [] })
  })
  it('o bifă pe o recurentă rămâne sărită peste o bază veche (refresh înainte de sincronizare)', () => {
    const base = [mk('HZ-01', { rrule: 'FREQ=DAILY', dueAt: '2026-09-28T07:00:00.000Z', allDay: false })]
    const out = overlay(base, [{ kind: 'updateIssue', id: 'HZ-01', patch: { done: true } }], now)
    expect(out[0].done).toBe(false)
    expect(new Date(out[0].dueAt!).getTime()).toBeGreaterThan(now.getTime())
  })
  it('nu modifică baza', () => {
    const base = [mk('HZ-01')]
    overlay(base, [{ kind: 'updateIssue', id: 'HZ-01', patch: { title: 'x' } }], now)
    expect(base[0].title).toBe('HZ-01')
  })
})

describe('remapOp', () => {
  it('rescrie ID-ul provizoriu peste tot unde apare', () => {
    expect(remapOp({ kind: 'updateIssue', id: 'HZ-~a', patch: { deps: ['HZ-~a', 'HZ-01'] } }, 'HZ-~a', 'HZ-13'))
      .toEqual({ kind: 'updateIssue', id: 'HZ-13', patch: { deps: ['HZ-13', 'HZ-01'] } })
    const c = remapOp({ kind: 'createIssue', tempId: 'HZ-~b', input: { projectId: 'p', title: 't', deps: ['HZ-~a'] }, echo: mk('HZ-~b', { deps: ['HZ-~a'] }) }, 'HZ-~a', 'HZ-13')
    expect(c.kind === 'createIssue' && c.input.deps).toEqual(['HZ-13'])
    expect(c.kind === 'createIssue' && c.echo.deps).toEqual(['HZ-13'])
    expect(remapOp({ kind: 'deleteIssues', ids: ['HZ-~a'] }, 'HZ-~a', 'HZ-13')).toEqual({ kind: 'deleteIssues', ids: ['HZ-13'] })
    expect(remapOp({ kind: 'markSeen', issueId: 'HZ-~a' }, 'HZ-~a', 'HZ-13')).toEqual({ kind: 'markSeen', issueId: 'HZ-13' })
  })
})

describe('cancelTempIssues', () => {
  it('ștergerea unui tichet netrimis anulează crearea și tot ce-l privește, fără să plece nimic', () => {
    const queued = [
      q(1, { kind: 'createIssue', tempId: 'HZ-~a', input: { projectId: 'p', title: 'a' }, echo: mk('HZ-~a') }),
      q(2, { kind: 'updateIssue', id: 'HZ-~a', patch: { title: 'b' } }),
      q(3, { kind: 'updateIssue', id: 'HZ-02', patch: { deps: ['HZ-~a', 'HZ-01'] } }),
      q(4, { kind: 'markSeen', issueId: 'HZ-~a' }),
    ]
    const r = cancelTempIssues(queued, ['HZ-~a'])
    expect(r.remove).toEqual([1, 2, 4])
    expect(r.rewrite).toEqual([q(3, { kind: 'updateIssue', id: 'HZ-02', patch: { deps: ['HZ-01'] } })])
  })
})

describe('deriveDue', () => {
  it('aceeași regulă ca serverul: nefinalizatele fără limită în jos, bifatele doar recente', () => {
    const issues = [
      mk('A', { dueAt: '2026-08-01T07:00:00+00:00' }),
      mk('B', { dueAt: '2026-08-01T07:00:00.000Z', done: true }),
      mk('C', { dueAt: '2026-10-02T07:00:00.000Z', done: true }),
      mk('D', { dueAt: '2026-12-01T07:00:00.000Z' }),
      mk('E'),
    ]
    const out = deriveDue(issues, { to: '2026-10-09T21:00:00.000Z', doneFrom: '2026-10-01T21:00:00.000Z' })
    expect(out.map((i) => i.id)).toEqual(['A', 'C'])
  })
})
```

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/data/offline/ops.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Implementarea**

```ts
// src/data/offline/ops.ts
// Coada de scrieri offline — tipurile și tot ce se poate calcula fără I/O.
//
// Regula centrală: baza (ultimul răspuns al serverului) nu se modifică niciodată
// cu o scriere locală. Ce vede aplicația = baza + coada rejucată peste ea
// (`overlay`). Așa o scriere refuzată de server se „anulează" singură — se scoate
// din coadă și dispare din ce vezi — fără o a doua copie de reconciliat.

import { applyIssuePatch } from '../../lib/issuePatch'
import type { Issue, Project } from '../../lib/types'
import type { DueRange, NewIssue } from '../repository'

export type OutboxOp =
  | { kind: 'createIssue'; tempId: string; input: NewIssue; echo: Issue }
  | { kind: 'updateIssue'; id: string; patch: Partial<Issue> }
  | { kind: 'deleteIssues'; ids: string[] }
  | { kind: 'markSeen'; issueId: string }

export interface QueuedOp {
  /** Cheia autoincrement din IndexedDB — dă ordinea de golire. */
  seq: number
  op: OutboxOp
  at: string
}

export function echoIssue(input: NewIssue, id: string, project: Project, createdBy: string | null, now: Date): Issue {
  // Aceleași valori implicite ca `supabaseRepository.createIssue`, ca tichetul
  // să nu-și schimbe forma când sosește varianta serverului.
  return {
    id,
    projectId: input.projectId,
    title: input.title,
    desc: input.desc ?? '',
    theme: input.theme ?? '',
    wave: input.wave ?? project.currentWave,
    deps: input.deps ?? [],
    done: false,
    selectors: input.selectors ?? [],
    scenarios: (input.scenarios ?? []).map((s) => ({ text: s.text, kind: s.kind as Issue['scenarios'][number]['kind'] })),
    assigneeId: input.assigneeId ?? null,
    createdBy,
    createdAt: now.toISOString(),
    urgent: input.urgent ?? false,
    dueAt: input.dueAt ?? null,
    allDay: input.allDay ?? true,
    remindAt: input.remindAt ?? null,
    rrule: input.rrule ?? null,
  }
}

export function overlay(base: Issue[], ops: OutboxOp[], now: Date): Issue[] {
  let out = base.slice()
  for (const op of ops) {
    if (op.kind === 'createIssue') {
      if (!out.some((i) => i.id === op.tempId)) out.push(op.echo)
    } else if (op.kind === 'updateIssue') {
      out = out.map((i) => (i.id === op.id ? applyIssuePatch(i, op.patch, now) : i))
    } else if (op.kind === 'deleteIssues') {
      // Ca `deleteIssuesImpl` pe server: o ștergere scoate și muchiile spre tichet.
      const gone = new Set(op.ids)
      out = out
        .filter((i) => !gone.has(i.id))
        .map((i) => (i.deps.some((d) => gone.has(d)) ? { ...i, deps: i.deps.filter((d) => !gone.has(d)) } : i))
    }
  }
  return out
}

export function remapOp(op: OutboxOp, from: string, to: string): OutboxOp {
  const r = (id: string) => (id === from ? to : id)
  switch (op.kind) {
    case 'createIssue':
      return { ...op, input: { ...op.input, deps: op.input.deps?.map(r) }, echo: { ...op.echo, deps: op.echo.deps.map(r) } }
    case 'updateIssue':
      return { ...op, id: r(op.id), patch: op.patch.deps ? { ...op.patch, deps: op.patch.deps.map(r) } : op.patch }
    case 'deleteIssues':
      return { ...op, ids: op.ids.map(r) }
    case 'markSeen':
      return { ...op, issueId: r(op.issueId) }
  }
}

/** Ce tichete atinge o scriere — pentru evenimentele de eșec și pentru a ști
 *  dacă mai rămâne ceva în coadă peste un tichet. */
export function opIssueIds(op: OutboxOp): string[] {
  switch (op.kind) {
    case 'createIssue': return [op.tempId]
    case 'updateIssue': return [op.id]
    case 'deleteIssues': return op.ids
    case 'markSeen': return [op.issueId]
  }
}

/**
 * Ștergerea unui tichet care n-a ajuns încă la server: nu trimite nimic. Crearea
 * și tot ce-l privește se scot din coadă, iar dependențele altor tichete spre el
 * se taie. Altfel s-ar crea pe server un tichet doar ca să fie șters imediat.
 */
export function cancelTempIssues(queued: QueuedOp[], tempIds: string[]): { remove: number[]; rewrite: QueuedOp[] } {
  const gone = new Set(tempIds)
  const remove: number[] = []
  const rewrite: QueuedOp[] = []
  for (const q of queued) {
    const op = q.op
    if (op.kind === 'createIssue' && gone.has(op.tempId)) { remove.push(q.seq); continue }
    if (op.kind === 'updateIssue' && gone.has(op.id)) { remove.push(q.seq); continue }
    if (op.kind === 'markSeen' && gone.has(op.issueId)) { remove.push(q.seq); continue }
    const strip = (ds: string[] | undefined) => ds?.filter((d) => !gone.has(d))
    if (op.kind === 'updateIssue' && op.patch.deps?.some((d) => gone.has(d))) {
      rewrite.push({ ...q, op: { ...op, patch: { ...op.patch, deps: strip(op.patch.deps) } } })
    } else if (op.kind === 'createIssue' && op.input.deps?.some((d) => gone.has(d))) {
      rewrite.push({ ...q, op: { ...op, input: { ...op.input, deps: strip(op.input.deps) }, echo: { ...op.echo, deps: strip(op.echo.deps)! } } })
    } else if (op.kind === 'deleteIssues' && op.ids.some((d) => gone.has(d))) {
      const ids = op.ids.filter((d) => !gone.has(d))
      if (ids.length) rewrite.push({ ...q, op: { ...op, ids } })
      else remove.push(q.seq)
    }
  }
  return { remove, rewrite }
}

/**
 * Oglinda lui `listDueIssues` pe date locale. Se compară MOMENTE, nu șiruri:
 * Supabase întoarce `+00:00`, clientul scrie `.000Z`, iar o comparație de text
 * între cele două formate ar greși exact la granița unei zile.
 */
export function deriveDue(issues: Issue[], range: DueRange): Issue[] {
  const to = Date.parse(range.to)
  const doneFrom = Date.parse(range.doneFrom)
  return issues
    .filter((i) => {
      if (!i.dueAt) return false
      const t = Date.parse(i.dueAt)
      return t < to && (!i.done || t >= doneFrom)
    })
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
}
```

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/data/offline/ops.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/offline/ops.ts src/data/offline/ops.test.ts
git commit -m "feat(offline): coada de scrieri — overlay, remapare, anularea creărilor netrimise"
```

---

### Task 5: Stocarea în IndexedDB

**Files:**
- Create: `src/data/offline/kv.ts`, `src/data/offline/kv.test.ts`

**Interfaces:**
- Consumes: `OutboxOp`, `QueuedOp` (Task 4).
- Produces:
  ```ts
  interface Kv {
    get<T>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
    keys(prefix: string): Promise<string[]>
    ops(): Promise<QueuedOp[]>
    append(op: OutboxOp): Promise<number>
    replaceOps(rewrite: QueuedOp[], remove: number[]): Promise<void>
    completeOp(seq: number, writes: [string, unknown][]): Promise<void>
    clear(): Promise<void>
  }
  openKv(name?: string): Promise<Kv>   // implicit 'horizontal-offline'
  ```
  Chei folosite de Task 6–8: `projects`, `assignees`, `inbox`, `due`, `p:<projectId>:waves|themes|issues|obstacles|obstacleLinks|members`.

- [ ] **Step 1: Testul care pică**

```ts
// src/data/offline/kv.test.ts
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { openKv } from './kv'

let n = 0
const fresh = () => openKv(`t-${++n}`)

describe('kv', () => {
  it('ține valori pe chei și le listează după prefix', async () => {
    const kv = await fresh()
    await kv.set('p:a:issues', [1])
    await kv.set('p:b:issues', [2])
    await kv.set('projects', [])
    expect(await kv.get('p:a:issues')).toEqual([1])
    expect((await kv.keys('p:')).sort()).toEqual(['p:a:issues', 'p:b:issues'])
  })
  it('coada păstrează ordinea adăugării', async () => {
    const kv = await fresh()
    await kv.append({ kind: 'markSeen', issueId: 'A' })
    await kv.append({ kind: 'markSeen', issueId: 'B' })
    expect((await kv.ops()).map((q) => (q.op as { issueId: string }).issueId)).toEqual(['A', 'B'])
  })
  it('completeOp scoate elementul și scrie baza în ACEEAȘI tranzacție', async () => {
    const kv = await fresh()
    const seq = await kv.append({ kind: 'markSeen', issueId: 'A' })
    await kv.completeOp(seq, [['due', ['x']]])
    expect(await kv.ops()).toEqual([])
    expect(await kv.get('due')).toEqual(['x'])
  })
  it('supraviețuiește redeschiderii (repornirea aplicației)', async () => {
    const name = `t-${++n}`
    const a = await openKv(name)
    await a.append({ kind: 'markSeen', issueId: 'A' })
    const b = await openKv(name)
    expect(await b.ops()).toHaveLength(1)
  })
  it('clear golește și baza, și coada', async () => {
    const kv = await fresh()
    await kv.set('projects', [1])
    await kv.append({ kind: 'markSeen', issueId: 'A' })
    await kv.clear()
    expect(await kv.get('projects')).toBeUndefined()
    expect(await kv.ops()).toEqual([])
  })
})
```

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/data/offline/kv.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Implementarea**

```ts
// src/data/offline/kv.ts
// Stocarea locală: un magazin cheie-valoare pentru bază și unul autoincrement
// pentru coadă. IndexedDB și nu SQLite: merge identic în browser, în Electron și
// în WebView-ul Capacitor, deci stratul se scrie o dată.

import { openDB } from 'idb'
import type { OutboxOp, QueuedOp } from './ops'

export interface Kv {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  keys(prefix: string): Promise<string[]>
  ops(): Promise<QueuedOp[]>
  append(op: OutboxOp): Promise<number>
  replaceOps(rewrite: QueuedOp[], remove: number[]): Promise<void>
  /**
   * Un element trimis cu succes: se scoate din coadă ȘI se scrie răspunsul
   * serverului în bază, atomic. Separat, între cele două ar exista o clipă în
   * care o citire vede și baza nouă, și patch-ul vechi — iar o bifă pe o
   * recurentă ar sări de două ori pe ecran.
   */
  completeOp(seq: number, writes: [string, unknown][]): Promise<void>
  clear(): Promise<void>
}

export async function openKv(name = 'horizontal-offline'): Promise<Kv> {
  const db = await openDB(name, 1, {
    upgrade(d) {
      d.createObjectStore('kv')
      d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
    },
  })
  return {
    async get<T>(key: string) {
      return (await db.get('kv', key)) as T | undefined
    },
    async set(key, value) {
      await db.put('kv', value, key)
    },
    async keys(prefix) {
      return ((await db.getAllKeys('kv')) as string[]).filter((k) => k.startsWith(prefix))
    },
    async ops() {
      return (await db.getAll('outbox')) as QueuedOp[]
    },
    async append(op) {
      return (await db.add('outbox', { op, at: new Date().toISOString() })) as number
    },
    async replaceOps(rewrite, remove) {
      const tx = db.transaction('outbox', 'readwrite')
      for (const q of rewrite) void tx.store.put(q)
      for (const s of remove) void tx.store.delete(s)
      await tx.done
    },
    async completeOp(seq, writes) {
      const tx = db.transaction(['outbox', 'kv'], 'readwrite')
      void tx.objectStore('outbox').delete(seq)
      for (const [k, v] of writes) void tx.objectStore('kv').put(v, k)
      await tx.done
    },
    async clear() {
      const tx = db.transaction(['outbox', 'kv'], 'readwrite')
      void tx.objectStore('outbox').clear()
      void tx.objectStore('kv').clear()
      await tx.done
    },
  }
}
```

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/data/offline/kv.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/offline/kv.ts src/data/offline/kv.test.ts
git commit -m "feat(offline): stocarea în IndexedDB — bază și coadă, cu tranzacții atomice"
```

---

### Task 6: Învelișul — tipurile publice și citirile

**Files:**
- Create: `src/data/offline/types.ts`
- Create: `src/data/offline/offlineRepository.ts`
- Create: `src/data/offline/offlineRepository.test.ts`
- Modify: `src/data/repository.ts` (interfața `Repository`, la final)

**Interfaces:**
- Consumes: `Kv` (Task 5), `overlay`, `deriveDue` (Task 4), `isNetworkError`, `OfflineError`, `withTimeout` (Task 3).
- Produces (`src/data/offline/types.ts`):
  ```ts
  interface SyncStatus { offline: boolean; pending: number }
  type SyncEvent =
    | { type: 'status'; status: SyncStatus }
    | { type: 'issue'; issue: Issue }
    | { type: 'removed'; ids: string[] }
    | { type: 'remap'; from: string; to: string }
    | { type: 'failed'; message: string; issueId: string | null; revert: Issue | null }
  interface ProjectBundle { waves: Wave[]; themes: Theme[]; issues: Issue[]; obstacles: Obstacle[]; obstacleLinks: ObstacleLink[]; members: ProjectMember[] }
  interface CacheReader {
    projects(): Promise<Project[] | null>
    assignees(): Promise<Assignee[] | null>
    project(id: string): Promise<ProjectBundle | null>
    due(range: DueRange): Promise<Issue[] | null>
    inbox(): Promise<InboxRow[] | null>
  }
  interface SyncControl {
    status(): SyncStatus
    subscribe(fn: (e: SyncEvent) => void): () => void
    flush(): Promise<void>
    prefetchAll(): Promise<void>
    clear(): Promise<void>
  }
  ```
- Produces (`offlineRepository.ts`): `createOfflineRepository(remote: Repository, kvReady: Promise<Kv | null>, opts?: OfflineOptions): Repository` cu `cache` și `sync` puse. `OfflineOptions = { now?: () => Date; userId?: () => string | null; readTimeoutMs?: number; channel?: SyncChannel | null; lock?: (fn: () => Promise<void>) => Promise<void> }` (`SyncChannel` vine în Task 9; până atunci câmpul e `null`).
- `Repository` primește `cache?: CacheReader` și `sync?: SyncControl`.

- [ ] **Step 1: `types.ts` și câmpurile opționale pe `Repository`**

```ts
// src/data/offline/types.ts
// Ce vede restul aplicației din stratul offline. Opțional pe `Repository`:
// modul local (`localRepository`) n-are nici cache, nici coadă, și n-are nevoie.

import type { Assignee, InboxRow, Issue, Obstacle, ObstacleLink, Project, ProjectMember, Theme, Wave } from '../../lib/types'
import type { DueRange } from '../repository'

export interface SyncStatus { offline: boolean; pending: number }

export type SyncEvent =
  | { type: 'status'; status: SyncStatus }
  /** Varianta de acum a unui tichet (de la server, sau ecoul din altă filă). */
  | { type: 'issue'; issue: Issue }
  | { type: 'removed'; ids: string[] }
  /** Un tichet creat offline a primit numărul real. */
  | { type: 'remap'; from: string; to: string }
  /** Serverul a refuzat o scriere. `revert` = valoarea lui de acum, sau null dacă tichetul nu mai există. */
  | { type: 'failed'; message: string; issueId: string | null; revert: Issue | null }

export interface ProjectBundle {
  waves: Wave[]
  themes: Theme[]
  issues: Issue[]
  obstacles: Obstacle[]
  obstacleLinks: ObstacleLink[]
  members: ProjectMember[]
}

/** Citiri DOAR din cache, fără rețea — pentru primul cadru. `null` = nu există încă. */
export interface CacheReader {
  projects(): Promise<Project[] | null>
  assignees(): Promise<Assignee[] | null>
  project(id: string): Promise<ProjectBundle | null>
  due(range: DueRange): Promise<Issue[] | null>
  inbox(): Promise<InboxRow[] | null>
}

export interface SyncControl {
  status(): SyncStatus
  subscribe(fn: (e: SyncEvent) => void): () => void
  flush(): Promise<void>
  /** Aduce în cache TOATE proiectele, nu doar cel deschis — altfel unul
   *  nedeschis recent n-ar avea nimic de arătat offline. */
  prefetchAll(): Promise<void>
  /** Logout: baza și coada de pe dispozitivul ăsta dispar. */
  clear(): Promise<void>
}
```

În `src/data/repository.ts`, la finalul interfeței `Repository` (după `listInbox(): Promise<InboxRow[]>`):

```ts
  /** Doar pe învelișul offline — vezi `src/data/offline/types.ts`. */
  cache?: import('./offline/types').CacheReader
  sync?: import('./offline/types').SyncControl
```

- [ ] **Step 2: Testul de citiri care pică**

Fake-ul de `remote` e un `Repository` cu `vi.fn()` doar pe metodele folosite; `net.down = true` simulează lipsa rețelei.

```ts
// src/data/offline/offlineRepository.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOfflineRepository } from './offlineRepository'
import { openKv, type Kv } from './kv'
import { OfflineError } from './netError'
import type { Repository } from '../repository'
import type { Issue, Project } from '../../lib/types'

export const proj: Project = { id: 'p', name: 'P', description: '', prefix: 'HZ', currentWave: 1, accent: '#000', type: 'personal' }
export const mk = (id: string, over: Partial<Issue> = {}): Issue => ({
  id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [],
  scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-09-01T00:00:00.000Z', urgent: false,
  dueAt: null, allDay: true, remindAt: null, rrule: null, ...over,
})

export function fakeRemote() {
  const net = { down: false }
  const server = { issues: [mk('HZ-01'), mk('HZ-02')], next: 13 }
  const guard = <T>(f: () => T) => async () => {
    if (net.down) throw new TypeError('Failed to fetch')
    return f()
  }
  const remote = {
    listProjects: vi.fn(guard(() => [proj])),
    listAssignees: vi.fn(guard(() => [])),
    listWaves: vi.fn(guard(() => [])),
    listThemes: vi.fn(guard(() => [])),
    listIssues: vi.fn(async (pid: string) => guard(() => server.issues.filter((i) => i.projectId === pid))()),
    listObstacles: vi.fn(guard(() => [])),
    listObstacleLinks: vi.fn(guard(() => [])),
    listProjectMembers: vi.fn(guard(() => [])),
    listDueIssues: vi.fn(guard(() => server.issues.filter((i) => i.dueAt))),
    listInbox: vi.fn(guard(() => [])),
    listEvents: vi.fn(guard(() => [])),
    createProject: vi.fn(guard(() => proj)),
    createIssue: vi.fn(async (input: { projectId: string; title: string; deps?: string[] }) => guard(() => {
      const i = mk(`HZ-${server.next++}`, { title: input.title, deps: input.deps ?? [] })
      server.issues.push(i)
      return i
    })()),
    updateIssue: vi.fn(async (id: string, patch: Partial<Issue>) => guard(() => {
      const i = server.issues.find((x) => x.id === id)
      if (!i) throw { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }
      Object.assign(i, patch)
      return { ...i }
    })()),
    deleteIssues: vi.fn(async (ids: string[]) => guard(() => { server.issues = server.issues.filter((i) => !ids.includes(i.id)) })()),
    deleteIssue: vi.fn(async (id: string) => guard(() => { server.issues = server.issues.filter((i) => i.id !== id) })()),
    markSeen: vi.fn(guard(() => undefined)),
  } as unknown as Repository
  return { remote, net, server }
}

let n = 0
let kv: Kv
beforeEach(async () => { kv = await openKv(`r-${++n}`) })
const make = (remote: Repository) =>
  createOfflineRepository(remote, Promise.resolve(kv), { now: () => new Date('2026-10-02T09:00:00Z'), userId: () => 'u1', readTimeoutMs: 1000, channel: null })

describe('citiri', () => {
  it('cu rețea: răspunde serverul și se scrie cache-ul', async () => {
    const { remote } = fakeRemote()
    const repo = make(remote)
    expect((await repo.listIssues('p')).map((i) => i.id)).toEqual(['HZ-01', 'HZ-02'])
    expect((await repo.cache!.project('p'))?.issues.map((i) => i.id)).toEqual(['HZ-01', 'HZ-02'])
  })
  it('fără rețea: răspunde cache-ul și statusul devine offline', async () => {
    const { remote, net } = fakeRemote()
    const repo = make(remote)
    await repo.listProjects()
    await repo.listIssues('p')
    net.down = true
    expect(await repo.listProjects()).toEqual([proj])
    expect((await repo.listIssues('p')).map((i) => i.id)).toEqual(['HZ-01', 'HZ-02'])
    expect(repo.sync!.status().offline).toBe(true)
  })
  it('fără rețea și fără cache: OfflineError, nu o eroare de rețea crudă', async () => {
    const { remote, net } = fakeRemote()
    net.down = true
    await expect(make(remote).listIssues('p')).rejects.toBeInstanceOf(OfflineError)
  })
  it('o eroare de server nu cade pe cache', async () => {
    const { remote } = fakeRemote()
    ;(remote.listIssues as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ message: 'permission denied', code: '42501' })
    await expect(make(remote).listIssues('p')).rejects.toMatchObject({ code: '42501' })
  })
  it('cache.due derivă scadențele din toate proiectele din cache', async () => {
    const { remote, server } = fakeRemote()
    server.issues[0].dueAt = '2026-10-03T07:00:00.000Z'
    const repo = make(remote)
    await repo.sync!.prefetchAll()
    const due = await repo.cache!.due({ to: '2026-10-09T21:00:00.000Z', doneFrom: '2026-10-01T21:00:00.000Z' })
    expect(due?.map((i) => i.id)).toEqual(['HZ-01'])
  })
  it('fără IndexedDB: trece direct la server, fără cache', async () => {
    const { remote } = fakeRemote()
    const repo = createOfflineRepository(remote, Promise.resolve(null), { channel: null })
    expect((await repo.listIssues('p')).length).toBe(2)
    expect(await repo.cache!.projects()).toBeNull()
  })
})
```

- [ ] **Step 3: Rulează, trebuie să pice**

Run: `npx vitest run src/data/offline/offlineRepository.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 4: Implementarea citirilor (și scheletul complet al învelișului)**

Fișierul de mai jos e complet pentru citiri și pentru metodele care cer rețea; scrierile din coadă (`createIssue`, `updateIssue`, `deleteIssue(s)`, `markSeen`) și `flush` sunt deocamdată delegare directă prin `net(...)` și se înlocuiesc în Task 7 și 8.

```ts
// src/data/offline/offlineRepository.ts
// A treia implementare de `Repository`: învelește repository-ul de Supabase cu
// o bază locală și o coadă de scrieri. Nicio componentă nu știe că există —
// în afară de indicatorul din header (`sync.status`) și de puntea care
// redenumește un tichet provizoriu (`sync.subscribe`).
//
// Citirile: întâi serverul (cu prag de timp), iar la eșec de REȚEA, cache-ul.
// Primul cadru nu așteaptă nici atât: store-ul citește `cache` direct.
// Ce vede aplicația din tichete = baza + coada rejucată (`overlay`, ops.ts).

import type { Repository } from '../repository'
import type { Issue } from '../../lib/types'
import type { Kv } from './kv'
import { OfflineError, isNetworkError, withTimeout } from './netError'
import { deriveDue, overlay, type OutboxOp } from './ops'
import type { CacheReader, ProjectBundle, SyncControl, SyncEvent, SyncStatus } from './types'

export interface SyncChannel {
  post(e: SyncEvent): void
  onMessage(fn: (e: SyncEvent) => void): void
}

export interface OfflineOptions {
  now?: () => Date
  userId?: () => string | null
  readTimeoutMs?: number
  channel?: SyncChannel | null
  lock?: (fn: () => Promise<void>) => Promise<void>
}

const K = {
  projects: 'projects',
  assignees: 'assignees',
  inbox: 'inbox',
  due: 'due',
  p: (pid: string, what: keyof ProjectBundle) => `p:${pid}:${what}`,
}

/** Un mutex în proces, pentru unde Web Locks nu există (teste, Node). */
function localLock() {
  let tail = Promise.resolve()
  return (fn: () => Promise<void>) => {
    const run = tail.then(fn, fn)
    tail = run.catch(() => undefined)
    return run
  }
}

export function createOfflineRepository(remote: Repository, kvReady: Promise<Kv | null>, opts: OfflineOptions = {}): Repository {
  const now = opts.now ?? (() => new Date())
  const readTimeoutMs = opts.readTimeoutMs ?? 10_000
  const lock = opts.lock ?? localLock()
  const listeners = new Set<(e: SyncEvent) => void>()
  let status: SyncStatus = { offline: false, pending: 0 }

  const emitLocal = (e: SyncEvent) => { for (const fn of listeners) fn(e) }
  const emit = (e: SyncEvent) => {
    emitLocal(e)
    // Statusul e al fiecărei file (fiecare își numără singură coada); restul
    // evenimentelor se trimit și celorlalte file, ca o captură din bara de
    // pe desktop să apară în fereastra principală fără reîncărcare.
    if (e.type !== 'status') opts.channel?.post(e)
  }
  opts.channel?.onMessage((e) => {
    emitLocal(e)
    void refreshPending()
  })

  const setStatus = (next: Partial<SyncStatus>) => {
    const s = { ...status, ...next }
    if (s.offline === status.offline && s.pending === status.pending) return
    status = s
    emit({ type: 'status', status })
  }
  async function refreshPending() {
    const kv = await kvReady
    setStatus({ pending: kv ? (await kv.ops()).length : 0 })
  }

  async function pendingOps(): Promise<OutboxOp[]> {
    const kv = await kvReady
    return kv ? (await kv.ops()).map((q) => q.op) : []
  }

  /** Server întâi; la eșec de rețea, cache-ul. O eroare de server NU cade pe cache. */
  async function read<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    const kv = await kvReady
    try {
      const v = await withTimeout(fetch(), readTimeoutMs)
      setStatus({ offline: false })
      await kv?.set(key, v)
      return v
    } catch (e) {
      if (!isNetworkError(e)) throw e
      setStatus({ offline: true })
      const cached = kv ? await kv.get<T>(key) : undefined
      if (cached === undefined) throw new OfflineError()
      return cached
    }
  }

  /** Pentru ce NU merge offline: eroarea de rețea devine `OfflineError`. */
  async function net<T>(f: () => Promise<T>): Promise<T> {
    try {
      const v = await f()
      setStatus({ offline: false })
      return v
    } catch (e) {
      if (!isNetworkError(e)) throw e
      setStatus({ offline: true })
      throw new OfflineError()
    }
  }

  async function allCachedIssues(kv: Kv): Promise<Issue[]> {
    const byId = new Map<string, Issue>()
    for (const i of (await kv.get<Issue[]>(K.due)) ?? []) byId.set(i.id, i)
    // Tichetele per proiect au prioritate peste `due`: sunt aduse complet și,
    // de obicei, mai recent.
    for (const key of await kv.keys('p:')) {
      if (!key.endsWith(':issues')) continue
      for (const i of (await kv.get<Issue[]>(key)) ?? []) byId.set(i.id, i)
    }
    return [...byId.values()]
  }

  const cache: CacheReader = {
    async projects() { const kv = await kvReady; return (kv && (await kv.get(K.projects))) ?? null },
    async assignees() { const kv = await kvReady; return (kv && (await kv.get(K.assignees))) ?? null },
    async inbox() { const kv = await kvReady; return (kv && (await kv.get(K.inbox))) ?? null },
    async project(pid) {
      const kv = await kvReady
      if (!kv) return null
      const issues = await kv.get<Issue[]>(K.p(pid, 'issues'))
      if (!issues) return null
      return {
        waves: (await kv.get(K.p(pid, 'waves'))) ?? [],
        themes: (await kv.get(K.p(pid, 'themes'))) ?? [],
        issues: overlay(issues, await pendingOps(), now()).filter((i) => i.projectId === pid),
        obstacles: (await kv.get(K.p(pid, 'obstacles'))) ?? [],
        obstacleLinks: (await kv.get(K.p(pid, 'obstacleLinks'))) ?? [],
        members: (await kv.get(K.p(pid, 'members'))) ?? [],
      }
    },
    async due(range) {
      const kv = await kvReady
      if (!kv) return null
      const all = await allCachedIssues(kv)
      if (!all.length && (await kv.get(K.due)) === undefined) return null
      return deriveDue(overlay(all, await pendingOps(), now()), range)
    },
  }

  async function prefetchAll() {
    try {
      const projects = await read(K.projects, () => remote.listProjects())
      for (const p of projects) {
        await Promise.all([
          read(K.p(p.id, 'waves'), () => remote.listWaves(p.id)),
          read(K.p(p.id, 'themes'), () => remote.listThemes(p.id)),
          read(K.p(p.id, 'issues'), () => remote.listIssues(p.id)),
          read(K.p(p.id, 'obstacles'), () => remote.listObstacles(p.id)),
          read(K.p(p.id, 'obstacleLinks'), () => remote.listObstacleLinks(p.id)),
          read(K.p(p.id, 'members'), () => remote.listProjectMembers(p.id)).catch(() => []),
        ])
      }
    } catch {
      // Best-effort: un prefetch eșuat lasă cache-ul cum era. Nu e o eroare de
      // arătat — omul n-a cerut nimic.
    }
  }

  const sync: SyncControl = {
    status: () => status,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    flush: async () => {},
    prefetchAll,
    async clear() { const kv = await kvReady; await kv?.clear(); setStatus({ pending: 0 }) },
  }

  const repo: Repository = {
    cache,
    sync,

    listProjects: () => read(K.projects, () => remote.listProjects()),
    listAssignees: () => read(K.assignees, () => remote.listAssignees()),
    listWaves: (pid) => read(K.p(pid, 'waves'), () => remote.listWaves(pid)),
    listThemes: (pid) => read(K.p(pid, 'themes'), () => remote.listThemes(pid)),
    listObstacles: (pid) => read(K.p(pid, 'obstacles'), () => remote.listObstacles(pid)),
    listObstacleLinks: (pid) => read(K.p(pid, 'obstacleLinks'), () => remote.listObstacleLinks(pid)),
    listProjectMembers: (pid) => read(K.p(pid, 'members'), () => remote.listProjectMembers(pid)),
    listInbox: () => read(K.inbox, () => remote.listInbox()),
    async listIssues(pid) {
      const base = await read(K.p(pid, 'issues'), () => remote.listIssues(pid))
      return overlay(base, await pendingOps(), now()).filter((i) => i.projectId === pid)
    },
    async listDueIssues(range) {
      try {
        const base = await withTimeout(remote.listDueIssues(range), readTimeoutMs)
        setStatus({ offline: false })
        const kv = await kvReady
        await kv?.set(K.due, base)
        return deriveDue(overlay(base, await pendingOps(), now()), range)
      } catch (e) {
        if (!isNetworkError(e)) throw e
        setStatus({ offline: true })
        const local = await cache.due(range)
        if (local === null) throw new OfflineError()
        return local
      }
    },

    // ── Cer rețea ────────────────────────────────────────────────────────────
    createProject: (input) => net(() => remote.createProject(input)),
    updateProject: (id, patch) => net(() => remote.updateProject(id, patch)),
    deleteProject: (id) => net(() => remote.deleteProject(id)),
    createWave: (pid, name, label) => net(() => remote.createWave(pid, name, label)),
    updateWave: (pid, num, patch) => net(() => remote.updateWave(pid, num, patch)),
    deleteWave: (pid, num) => net(() => remote.deleteWave(pid, num)),
    createTheme: (pid, name, color) => net(() => remote.createTheme(pid, name, color)),
    updateTheme: (pid, key, patch) => net(() => remote.updateTheme(pid, key, patch)),
    deleteTheme: (pid, key) => net(() => remote.deleteTheme(pid, key)),
    createObstacle: (input) => net(() => remote.createObstacle(input)),
    updateObstacle: (id, patch) => net(() => remote.updateObstacle(id, patch)),
    deleteObstacle: (id) => net(() => remote.deleteObstacle(id)),
    setObstacleIssues: (oid, ids) => net(() => remote.setObstacleIssues(oid, ids)),
    setIssueObstacles: (iid, ids) => net(() => remote.setIssueObstacles(iid, ids)),
    createAssignee: (name) => net(() => remote.createAssignee(name)),
    ensureAssigneeForMember: (pid, uid) => net(() => remote.ensureAssigneeForMember(pid, uid)),
    listEvents: (iid) => net(() => remote.listEvents(iid)),
    postToThread: (input) => net(() => remote.postToThread(input)),

    // ── Merg offline — înlocuite în Task 7 ───────────────────────────────────
    createIssue: (input) => net(() => remote.createIssue(input)),
    updateIssue: (id, patch) => net(() => remote.updateIssue(id, patch)),
    deleteIssue: (id) => net(() => remote.deleteIssue(id)),
    deleteIssues: (ids) => net(() => remote.deleteIssues(ids)),
    markSeen: (iid) => net(() => remote.markSeen(iid)),
  }

  void refreshPending()
  return repo
}
```

- [ ] **Step 5: Rulează, trebuie să treacă**

Run: `npx vitest run src/data/offline/offlineRepository.test.ts && npm run typecheck`
Expected: PASS (6 teste). Dacă typecheck-ul cere tipuri explicite la `cache.projects()` etc., adaugă `as Project[] | null` — nu schimba forma.

- [ ] **Step 6: Commit**

```bash
git add src/data/offline/types.ts src/data/offline/offlineRepository.ts src/data/offline/offlineRepository.test.ts src/data/repository.ts
git commit -m "feat(offline): învelișul Repository — citiri din server cu cache de rezervă"
```

---

### Task 7: Scrierile — directe cu rețea, la coadă fără

**Files:**
- Modify: `src/data/offline/offlineRepository.ts` (blocul „Merg offline")
- Modify: `src/data/offline/offlineRepository.test.ts` (bloc nou `describe('scrieri')`)

**Interfaces:**
- Consumes: `makeTempIssueId`, `isTempIssueId` (Task 2), `echoIssue`, `cancelTempIssues`, `applyIssuePatch` (Task 1, 4).
- Produces: scrierile întorc imediat ecoul local când sunt puse la coadă; `sync.status().pending` crește.

Regula: dacă coada e GOALĂ, scrierea se încearcă direct la server (ID real, ca azi). Dacă e eroare de rețea, sau coada nu e goală (ordinea trebuie păstrată), scrierea intră în coadă.

- [ ] **Step 1: Testele care pică**

Adaugă în `offlineRepository.test.ts`:

```ts
describe('scrieri', () => {
  async function offlineRepo() {
    const f = fakeRemote()
    const repo = make(f.remote)
    await repo.sync!.prefetchAll()
    f.net.down = true
    return { ...f, repo }
  }

  it('cu rețea: createIssue primește ID-ul real direct, fără coadă', async () => {
    const { remote } = fakeRemote()
    const repo = make(remote)
    await repo.sync!.prefetchAll()
    const c = await repo.createIssue({ projectId: 'p', title: 'sună la bancă' })
    expect(c.id).toBe('HZ-13')
    expect(repo.sync!.status().pending).toBe(0)
  })

  it('offline: createIssue întoarce un ID provizoriu și tichetul se vede în citiri', async () => {
    const { repo } = await offlineRepo()
    const c = await repo.createIssue({ projectId: 'p', title: 'sună la bancă' })
    expect(c.id).toMatch(/^HZ-~/)
    expect(c.createdBy).toBe('u1')
    expect((await repo.listIssues('p')).map((i) => i.title)).toContain('sună la bancă')
    expect(repo.sync!.status().pending).toBe(1)
  })

  it('offline: updateIssue întoarce ecoul și citirile îl arată', async () => {
    const { repo } = await offlineRepo()
    const saved = await repo.updateIssue('HZ-02', { title: 'nou' })
    expect(saved.title).toBe('nou')
    expect((await repo.listIssues('p')).find((i) => i.id === 'HZ-02')?.title).toBe('nou')
  })

  it('o scriere nouă cu coada nevidă intră la coadă chiar dacă rețeaua a revenit (ordinea contează)', async () => {
    const { repo, net, remote } = await offlineRepo()
    await repo.updateIssue('HZ-01', { title: 'a' })
    net.down = false
    await repo.updateIssue('HZ-01', { title: 'b' })
    expect(remote.updateIssue).not.toHaveBeenCalled()
    expect(repo.sync!.status().pending).toBe(2)
  })

  it('ștergerea unui tichet creat offline nu trimite nimic și scoate dependențele spre el', async () => {
    const { repo, remote } = await offlineRepo()
    const c = await repo.createIssue({ projectId: 'p', title: 'efemer' })
    await repo.updateIssue('HZ-02', { deps: [c.id, 'HZ-01'] })
    await repo.deleteIssue(c.id)
    const issues = await repo.listIssues('p')
    expect(issues.map((i) => i.id)).toEqual(['HZ-01', 'HZ-02'])
    expect(issues.find((i) => i.id === 'HZ-02')?.deps).toEqual(['HZ-01'])
    expect(repo.sync!.status().pending).toBe(1)
    expect(remote.deleteIssues).not.toHaveBeenCalled()
    expect(remote.deleteIssue).not.toHaveBeenCalled()
  })

  it('offline: o acțiune care cere rețea aruncă OfflineError', async () => {
    const { repo } = await offlineRepo()
    await expect(repo.postToThread({ issueId: 'HZ-01', projectId: 'p', body: 'x' })).rejects.toBeInstanceOf(OfflineError)
  })

  it('o eroare de server la scrierea directă se aruncă, nu se pune la coadă', async () => {
    const { remote } = fakeRemote()
    const repo = make(remote)
    await expect(repo.updateIssue('NU-EXISTA', { title: 'x' })).rejects.toMatchObject({ code: 'PGRST116' })
    expect(repo.sync!.status().pending).toBe(0)
  })
})
```

Saltul de recurență al ecoului e acoperit de `ops.test.ts` (overlay) și de Task 1; aici contează doar că ecoul ajunge în citiri.

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/data/offline/offlineRepository.test.ts`
Expected: FAIL — scrierile offline aruncă `OfflineError` (încă sunt `net(...)`).

- [ ] **Step 3: Implementarea**

În `offlineRepository.ts`, adaugă importurile:

```ts
import { applyIssuePatch } from '../../lib/issuePatch'
import { isTempIssueId, makeTempIssueId } from '../../lib/issueId'
import { cancelTempIssues, echoIssue } from './ops'
import type { Project } from '../../lib/types'
```

Adaugă, înainte de `const sync`:

```ts
  /** Varianta de acum a unui tichet: baza din cache + coada rejucată. */
  async function currentIssue(kv: Kv, id: string): Promise<Issue | null> {
    const all = overlay(await allCachedIssues(kv), await pendingOps(), now())
    return all.find((i) => i.id === id) ?? null
  }

  /** Răspunsul serverului intră în bază: în lista proiectului și în `due`. */
  async function baseWritesUpsert(kv: Kv, issue: Issue): Promise<[string, unknown][]> {
    const writes: [string, unknown][] = []
    const key = K.p(issue.projectId, 'issues')
    const list = await kv.get<Issue[]>(key)
    if (list) writes.push([key, [...list.filter((i) => i.id !== issue.id), issue]])
    const due = (await kv.get<Issue[]>(K.due)) ?? []
    writes.push([K.due, issue.dueAt ? [...due.filter((i) => i.id !== issue.id), issue] : due.filter((i) => i.id !== issue.id)])
    return writes
  }

  async function baseWritesRemove(kv: Kv, ids: string[]): Promise<[string, unknown][]> {
    const gone = new Set(ids)
    const strip = (xs: Issue[]) => xs.filter((i) => !gone.has(i.id)).map((i) => (i.deps.some((d) => gone.has(d)) ? { ...i, deps: i.deps.filter((d) => !gone.has(d)) } : i))
    const writes: [string, unknown][] = []
    for (const key of await kv.keys('p:')) {
      if (!key.endsWith(':issues')) continue
      writes.push([key, strip((await kv.get<Issue[]>(key)) ?? [])])
    }
    writes.push([K.due, strip((await kv.get<Issue[]>(K.due)) ?? [])])
    return writes
  }

  async function applyWrites(kv: Kv, writes: [string, unknown][]) {
    for (const [k, v] of writes) await kv.set(k, v)
  }

  /**
   * Coada goală → direct la server (ID real, ca azi). Eroare de rețea sau coadă
   * nevidă → la coadă: o scriere care ar trece PE LÂNGĂ coadă ar ajunge la
   * server înaintea celor mai vechi și ar inversa ordinea cerută de om.
   * Eroarea de server se aruncă — nu e treaba cozii s-o ascundă.
   */
  async function write<T>(direct: () => Promise<T>, afterDirect: (kv: Kv, r: T) => Promise<void>, enqueue: (kv: Kv) => Promise<T>): Promise<T> {
    const kv = await kvReady
    if (!kv) return net(direct)
    if ((await kv.ops()).length === 0) {
      try {
        const r = await direct()
        setStatus({ offline: false })
        await afterDirect(kv, r)
        return r
      } catch (e) {
        if (!isNetworkError(e)) throw e
        setStatus({ offline: true })
      }
    }
    const r = await enqueue(kv)
    await refreshPending()
    return r
  }
```

Înlocuiește blocul „Merg offline — înlocuite în Task 7" cu:

```ts
    // ── Merg offline ─────────────────────────────────────────────────────────
    createIssue: (input) =>
      write(
        () => remote.createIssue(input),
        async (kv, created) => { await applyWrites(kv, await baseWritesUpsert(kv, created)); emit({ type: 'issue', issue: created }) },
        async (kv) => {
          const projects = (await kv.get<Project[]>(K.projects)) ?? []
          const project = projects.find((p) => p.id === input.projectId)
          if (!project) throw new OfflineError()
          const tempId = makeTempIssueId(project.prefix)
          const echo = echoIssue(input, tempId, project, opts.userId?.() ?? null, now())
          await kv.append({ kind: 'createIssue', tempId, input, echo })
          emit({ type: 'issue', issue: echo })
          return echo
        },
      ),

    updateIssue: (id, patch) =>
      write(
        () => remote.updateIssue(id, patch),
        async (kv, saved) => { await applyWrites(kv, await baseWritesUpsert(kv, saved)); emit({ type: 'issue', issue: saved }) },
        async (kv) => {
          const cur = await currentIssue(kv, id)
          if (!cur) throw new OfflineError()
          await kv.append({ kind: 'updateIssue', id, patch })
          const echo = applyIssuePatch(cur, patch, now())
          emit({ type: 'issue', issue: echo })
          return echo
        },
      ),

    deleteIssue: (id) => repo.deleteIssues([id]),

    async deleteIssues(ids) {
      const kv = await kvReady
      const temp = ids.filter(isTempIssueId)
      const real = ids.filter((id) => !isTempIssueId(id))
      if (kv && temp.length) {
        const { remove, rewrite } = cancelTempIssues(await kv.ops(), temp)
        await kv.replaceOps(rewrite, remove)
        await refreshPending()
      }
      if (real.length) {
        await write(
          () => remote.deleteIssues(real),
          async (k) => { await applyWrites(k, await baseWritesRemove(k, real)) },
          async (k) => { await k.append({ kind: 'deleteIssues', ids: real }) },
        )
      }
      emit({ type: 'removed', ids })
    },

    markSeen: (iid) =>
      isTempIssueId(iid)
        ? Promise.resolve()
        : write(() => remote.markSeen(iid), async () => {}, async (kv) => { await kv.append({ kind: 'markSeen', issueId: iid }) }),
```

`repo` trebuie declarat cu `const repo: Repository = { … }` înainte de folosirea lui `repo.deleteIssues` în `deleteIssue` — e deja așa; apelul se face la RULARE, nu la definire.

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/data/offline/offlineRepository.test.ts && npm run typecheck`
Expected: PASS (13 teste).

- [ ] **Step 5: Commit**

```bash
git add src/data/offline/offlineRepository.ts src/data/offline/offlineRepository.test.ts
git commit -m "feat(offline): scrierile merg la coadă fără rețea, cu ID provizoriu la creare"
```

---

### Task 8: Golirea cozii

**Files:**
- Modify: `src/data/offline/offlineRepository.ts` (`sync.flush` + declanșatori)
- Modify: `src/data/offline/offlineRepository.test.ts` (bloc nou `describe('golire')`)

**Interfaces:**
- Consumes: `remapOp`, `opIssueIds` (Task 4), `errorMessage` (`src/lib/errorMessage.ts`).
- Produces: `sync.flush()` — golește în ordine; emite `remap`, `issue`, `failed`, `removed`, `status`. Se declanșează singură la creare, la `online` și după fiecare punere la coadă cât e rețea.

- [ ] **Step 1: Testele care pică**

```ts
describe('golire', () => {
  async function queued() {
    const f = fakeRemote()
    const repo = make(f.remote)
    await repo.sync!.prefetchAll()
    f.net.down = true
    const events: unknown[] = []
    repo.sync!.subscribe((e) => events.push(e))
    return { ...f, repo, events }
  }

  it('golește în ordine și remapează ID-ul provizoriu în scrierile care-l urmau', async () => {
    const { repo, net, remote, events, server } = await queued()
    const c = await repo.createIssue({ projectId: 'p', title: 'nou' })
    await repo.updateIssue('HZ-02', { deps: [c.id] })
    await repo.updateIssue(c.id, { title: 'nou, redenumit' })
    net.down = false
    await repo.sync!.flush()
    expect(repo.sync!.status().pending).toBe(0)
    expect(remote.updateIssue).toHaveBeenNthCalledWith(1, 'HZ-02', { deps: ['HZ-13'] })
    expect(remote.updateIssue).toHaveBeenNthCalledWith(2, 'HZ-13', { title: 'nou, redenumit' })
    expect(events).toContainEqual({ type: 'remap', from: c.id, to: 'HZ-13' })
    expect(server.issues.find((i) => i.id === 'HZ-13')?.title).toBe('nou, redenumit')
    expect((await repo.listIssues('p')).map((i) => i.id)).toEqual(['HZ-01', 'HZ-02', 'HZ-13'])
  })

  it('se oprește la o eroare de rețea și reia mai târziu', async () => {
    const { repo, net } = await queued()
    await repo.updateIssue('HZ-01', { title: 'a' })
    await repo.sync!.flush()
    expect(repo.sync!.status().pending).toBe(1)
    net.down = false
    await repo.sync!.flush()
    expect(repo.sync!.status().pending).toBe(0)
  })

  it('o scriere refuzată de server se scoate, tichetul revine, restul cozii continuă', async () => {
    const { repo, net, server, events } = await queued()
    await repo.updateIssue('HZ-01', { title: 'pe un tichet care va dispărea' })
    await repo.updateIssue('HZ-02', { title: 'b' })
    server.issues = server.issues.filter((i) => i.id !== 'HZ-01') // șters pe alt dispozitiv
    net.down = false
    await repo.sync!.flush()
    expect(repo.sync!.status().pending).toBe(0)
    expect(events).toContainEqual(expect.objectContaining({ type: 'failed', issueId: 'HZ-01' }))
    expect(server.issues.find((i) => i.id === 'HZ-02')?.title).toBe('b')
  })

  it('coada supraviețuiește repornirii', async () => {
    const { repo, remote, net } = await queued()
    await repo.updateIssue('HZ-01', { title: 'a' })
    const again = make(remote)
    net.down = false
    await again.sync!.flush()
    expect(remote.updateIssue).toHaveBeenCalledWith('HZ-01', { title: 'a' })
  })

  it('două golire simultane nu trimit de două ori', async () => {
    const { repo, net, remote } = await queued()
    await repo.updateIssue('HZ-01', { title: 'a' })
    net.down = false
    await Promise.all([repo.sync!.flush(), repo.sync!.flush()])
    expect(remote.updateIssue).toHaveBeenCalledTimes(1)
  })

  it('conflict pe câmpuri diferite: se păstrează amândouă', async () => {
    const { repo, net, server } = await queued()
    await repo.updateIssue('HZ-01', { title: 'de pe laptop' })
    server.issues[0].dueAt = '2026-10-05T07:00:00.000Z' // de pe telefon, între timp
    net.down = false
    await repo.sync!.flush()
    expect(server.issues[0]).toMatchObject({ title: 'de pe laptop', dueAt: '2026-10-05T07:00:00.000Z' })
  })
})
```

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/data/offline/offlineRepository.test.ts`
Expected: FAIL — `flush` e gol.

- [ ] **Step 3: Implementarea**

Importuri noi în `offlineRepository.ts`:

```ts
import { errorMessage } from '../../lib/errorMessage'
import { opIssueIds, remapOp, type QueuedOp } from './ops'
```

Adaugă înainte de `const sync`:

```ts
  /** Trimite UN element. Aruncă mai departe orice eroare — decizia e în `flush`. */
  async function runOp(kv: Kv, q: QueuedOp, rest: QueuedOp[]) {
    const op = q.op
    if (op.kind === 'createIssue') {
      const created = await remote.createIssue(op.input)
      // Întâi coada: scrierile care urmau trebuie să vadă ID-ul real înainte
      // de orice altă golire. Apoi baza, atomic cu scoaterea elementului.
      const rewritten = rest.map((r) => ({ ...r, op: remapOp(r.op, op.tempId, created.id) }))
      await kv.replaceOps(rewritten, [])
      await kv.completeOp(q.seq, await baseWritesUpsert(kv, created))
      emit({ type: 'remap', from: op.tempId, to: created.id })
      const later = rewritten.map((r) => r.op)
      emit({ type: 'issue', issue: overlay([created], later, now())[0] ?? created })
    } else if (op.kind === 'updateIssue') {
      const saved = await remote.updateIssue(op.id, op.patch)
      await kv.completeOp(q.seq, await baseWritesUpsert(kv, saved))
      // Varianta serverului, cu scrierile încă netrimise rejucate peste ea —
      // altfel ecranul ar „anula" pentru o clipă o modificare care urmează.
      const later = rest.map((r) => r.op)
      const shown = overlay([saved], later, now())[0]
      if (shown) emit({ type: 'issue', issue: shown })
    } else if (op.kind === 'deleteIssues') {
      await remote.deleteIssues(op.ids)
      await kv.completeOp(q.seq, await baseWritesRemove(kv, op.ids))
    } else {
      await remote.markSeen(op.issueId)
      await kv.completeOp(q.seq, [])
    }
  }

  async function flush() {
    const kv = await kvReady
    if (!kv) return
    await lock(async () => {
      for (;;) {
        const all = await kv.ops()
        if (!all.length) break
        const [q, ...rest] = all
        try {
          await runOp(kv, q, rest)
          setStatus({ offline: false })
        } catch (e) {
          if (isNetworkError(e)) { setStatus({ offline: true }); break }
          // Refuz de server: nu blocăm coada la infinit. Elementul se scoate,
          // iar cine afișează tichetul primește valoarea serverului (sau află
          // că nu mai există).
          await kv.replaceOps([], [q.seq])
          const [issueId] = opIssueIds(q.op)
          let revert: Issue | null = null
          if (q.op.kind === 'updateIssue') revert = await currentIssue(kv, q.op.id)
          emit({ type: 'failed', message: errorMessage(e), issueId: issueId ?? null, revert })
          if (q.op.kind === 'createIssue') emit({ type: 'removed', ids: [q.op.tempId] })
        }
      }
      await refreshPending()
    })
  }
```

În obiectul `sync`, `flush: async () => {}` devine `flush,`. În `write(...)`, după `await refreshPending()` din ramura de coadă, adaugă `if (!status.offline) void flush()` (coada nevidă cu rețea prezentă se golește singură). La finalul funcției, după `void refreshPending()`:

```ts
  // Golirea pornește singură: la deschidere (coada poate fi plină de ieri) și
  // la revenirea rețelei. Revenirea în tab o cere store-ul, prin `refresh`.
  void flush()
  if (typeof window !== 'undefined') window.addEventListener('online', () => void flush())
```

Notă la `failed` pe `updateIssue`: `currentIssue` rulează DUPĂ scoaterea elementului, deci întoarce baza + restul cozii — adică exact ce trebuie arătat. Dacă tichetul nu mai există pe server, baza tot îl are; e corect până la următorul refresh, care îl scoate.

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/data/offline && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/offline/offlineRepository.ts src/data/offline/offlineRepository.test.ts
git commit -m "feat(offline): golirea cozii — în ordine, remapare, refuzuri care nu blochează"
```

---

### Task 9: Între file — canal și lacăt

Bara de captură de pe desktop (etapa 2) e o fereastră separată, deci o filă separată pentru browser. Ce scrie ea trebuie să apară în fereastra principală, iar coada se golește dintr-un singur loc.

**Files:**
- Create: `src/data/offline/channel.ts`, `src/data/offline/channel.test.ts`

**Interfaces:**
- Consumes: `SyncChannel` (Task 6), `SyncEvent`.
- Produces: `createBroadcastSyncChannel(name?: string): SyncChannel | null` (null dacă `BroadcastChannel` lipsește); `webLock(name: string): ((fn: () => Promise<void>) => Promise<void>) | null` (null dacă `navigator.locks` lipsește).

- [ ] **Step 1: Testul care pică**

```ts
// src/data/offline/channel.test.ts
import { describe, expect, it } from 'vitest'
import { createBroadcastSyncChannel } from './channel'

describe('canalul între file', () => {
  it('un eveniment trimis dintr-o filă ajunge în cealaltă, nu înapoi la emițător', async () => {
    const a = createBroadcastSyncChannel('t-chan')!
    const b = createBroadcastSyncChannel('t-chan')!
    const gotA: unknown[] = []
    const gotB: unknown[] = []
    a.onMessage((e) => gotA.push(e))
    b.onMessage((e) => gotB.push(e))
    a.post({ type: 'removed', ids: ['HZ-01'] })
    await new Promise((r) => setTimeout(r, 20))
    expect(gotB).toEqual([{ type: 'removed', ids: ['HZ-01'] }])
    expect(gotA).toEqual([])
  })
})
```

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/data/offline/channel.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 3: Implementarea**

```ts
// src/data/offline/channel.ts
// Mai multe file (sau bara de captură de pe desktop, care pentru browser e tot
// o filă) au aceeași bază locală, dar câte un store React fiecare. Canalul le
// spune celorlalte ce s-a schimbat; lacătul face ca o singură filă să golească
// coada, ca o scriere să nu plece de două ori.

import type { SyncChannel } from './offlineRepository'
import type { SyncEvent } from './types'

export function createBroadcastSyncChannel(name = 'horizontal-sync'): SyncChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const ch = new BroadcastChannel(name)
  return {
    post: (e: SyncEvent) => ch.postMessage(e),
    onMessage: (fn) => { ch.onmessage = (m: MessageEvent<SyncEvent>) => fn(m.data) },
  }
}

export function webLock(name: string): ((fn: () => Promise<void>) => Promise<void>) | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null
  return (fn) => navigator.locks.request(name, fn)
}
```

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/data/offline/channel.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/offline/channel.ts src/data/offline/channel.test.ts
git commit -m "feat(offline): canal între file și lacăt de golire"
```

---

### Task 10: Legarea în aplicație — repository, store, punte

**Files:**
- Modify: `src/data/index.ts`
- Modify: `src/store.tsx` (pornire din cache ~linia 405, `selectProject` ~500, `refresh` ~321, abonare nouă, `syncStatus` în context)
- Modify: `src/ui.tsx` (`renameIssueId`)
- Modify: `src/App.tsx` (`SyncBridge` în interiorul `<HorizontalProvider><UIProvider>`, ~linia 956)

**Interfaces:**
- Consumes: `createOfflineRepository`, `openKv`, `createBroadcastSyncChannel`, `webLock`, `pickStoredSession` (Task 11 — până atunci `userId` citește sesiunea din `supabase.auth`, vezi Step 1), `ProjectBundle`, `SyncEvent`, `SyncStatus`.
- Produces: `useHorizontal().syncStatus: SyncStatus`; `useUI().renameIssueId(from: string, to: string): void`.

- [ ] **Step 1: `src/data/index.ts`**

```ts
// Picks the data backend. Set VITE_DATA_SOURCE=supabase (with credentials) to
// use the live DB; anything else falls back to the local seeded store.
//
// Pe Supabase, repository-ul e învelit de stratul offline (bază locală + coadă
// de scrieri, vezi `src/data/offline/`). Fără IndexedDB (fereastră privată pe
// unele browsere) învelișul trece direct la server, ca înainte.

import { supabase } from '../lib/supabase'
import { createLocalRepository } from './localRepository'
import { createSupabaseRepository } from './supabaseRepository'
import { createOfflineRepository } from './offline/offlineRepository'
import { openKv } from './offline/kv'
import { createBroadcastSyncChannel, webLock } from './offline/channel'
import type { Repository } from './repository'

let currentUserId: string | null = null
supabase?.auth.onAuthStateChange((_e, s) => { currentUserId = s?.user.id ?? null })

function pick(): Repository {
  const source = import.meta.env.VITE_DATA_SOURCE
  if (source === 'supabase' && supabase) {
    const kv = typeof indexedDB === 'undefined' ? Promise.resolve(null) : openKv().catch(() => null)
    return createOfflineRepository(createSupabaseRepository(), kv, {
      userId: () => currentUserId,
      channel: createBroadcastSyncChannel(),
      lock: webLock('horizontal-outbox') ?? undefined,
    })
  }
  return createLocalRepository()
}

export const repository: Repository = pick()
export type { Repository } from './repository'
```

- [ ] **Step 2: Store — `applyProjectBundle`, o singură funcție pentru cache și rețea**

În `src/store.tsx`, după `upsertIssue` (~linia 585), adaugă și apoi folosește-o în `refresh` și `selectProject` în locul blocurilor duplicate de `setAllWaves…setLoadedProjects`:

```ts
  /**
   * Așază datele unui proiect în store. O singură funcție pentru cele trei
   * drumuri — cache la pornire, `selectProject`, `refresh` — fiindcă regula
   * legăturilor de obstacol (scoase pe baza obstacolelor VECHI, citite din
   * `prev` în actualizatorul funcțional) e ușor de greșit, și ar fi fost
   * scrisă de trei ori.
   */
  const applyProjectBundle = useCallback((id: string, b: ProjectBundle) => {
    setAllWaves((prev) => [...prev.filter((x) => x.projectId !== id), ...b.waves])
    setAllThemes((prev) => [...prev.filter((x) => x.projectId !== id), ...b.themes])
    setAllIssues((prev) => [...prev.filter((i) => i.projectId !== id), ...b.issues])
    setAllProjectMembers((prev) => [
      ...prev.filter((x) => x.projectId !== id),
      ...b.members.map((m) => ({ ...m, projectId: id })),
    ])
    setAllObstacles((prev) => {
      const staleObstacleIds = new Set(prev.filter((x) => x.projectId === id).map((x) => x.id))
      setAllObstacleLinks((links) => [
        ...links.filter((l) => !staleObstacleIds.has(l.obstacleId)),
        ...b.obstacleLinks,
      ])
      return [...prev.filter((x) => x.projectId !== id), ...b.obstacles]
    })
    setIssuesLoadedFor(id)
    setLoadedProjects((prev) => new Set(prev).add(id))
  }, [])
```

Comentariile existente din `refresh`/`selectProject` despre `Promise.all` (de ce obstacolele vin împreună cu tichetele, de ce `listProjectMembers` are `.catch`) RĂMÂN lângă `Promise.all`; se mută doar corpul lui `.then`. `applyProjectBundle` trebuie definit ÎNAINTE de `refresh` și `selectProject` în fișier (sunt `useCallback` care îl închid) — mută-l imediat după declararea stărilor, nu după `upsertIssue`, dacă ordinea o cere. Importă `ProjectBundle` din `./data/offline/types`.

În `refresh`, corpul lui `if (projectId) { … }` devine:

```ts
      if (projectId) {
        const [w, t, loaded, o, ol, pm] = await Promise.all([ /* neschimbat */ ])
        applyProjectBundle(projectId, { waves: w, themes: t, issues: loaded, obstacles: o, obstacleLinks: ol, members: pm })
      }
```

iar la începutul lui `try` din `refresh`, înainte de `listProjects`:

```ts
      // Întâi coada: datele aduse mai jos trebuie să conțină deja ce s-a
      // scris offline, altfel refresh-ul ar arăta o clipă starea veche.
      await repository.sync?.flush()
```

Adaugă `applyProjectBundle` în dependențele lui `refresh`.

În `selectProject`, `Promise.all([...]).then(([w, t, loaded, o, ol, pm]) => { … })` devine:

```ts
      void (async () => {
        // Primul cadru din cache — un proiect deschis ieri se vede imediat,
        // și offline. Rețeaua vine după și îl înlocuiește.
        const cached = await repository.cache?.project(id)
        if (cached) applyProjectBundle(id, cached)
        try {
          const [w, t, loaded, o, ol, pm] = await Promise.all([ /* neschimbat */ ])
          applyProjectBundle(id, { waves: w, themes: t, issues: loaded, obstacles: o, obstacleLinks: ol, members: pm })
          if (w.length && !w.some((x) => x.number === (proj?.currentWave ?? 1))) setActiveWave(w[0].number)
        } catch (e) {
          setError(errorMessage(e))
          // Cu date din cache pe ecran, „n-a putut fi încărcat" ar minți.
          if (!cached) setIssuesLoadFailedFor(id)
        }
      })()
```

Adaugă `applyProjectBundle` în dependențele lui `selectProject`.

- [ ] **Step 3: Store — pornirea din cache**

În efectul de boot (~linia 405), la începutul IIFE-ului, înainte de `const [p, a] = await Promise.all([...])`:

```ts
      // Primul cadru din baza locală, fără să aștepte rețeaua. `loading` cade
      // aici — e doar al PORNIRII (CLAUDE.md, „Reîmprospătarea datelor"); ce
      // urmează e o reîmprospătare obișnuită, cu datele vechi pe ecran.
      const c = repository.cache
      if (c) {
        const [cp, ca, cd, ci] = await Promise.all([c.projects(), c.assignees(), c.due(smartListRange(new Date())), c.inbox()])
        if (alive && cp) {
          setRawProjects(cp)
          setAssignees(ca ?? [])
          if (cd) { setDueRaw(cd); setDueLoaded(true) }
          if (ci) { setInboxRaw(ci); setInboxLoaded(true) }
          setLoading(false)
        }
      }
```

iar după `if (alive) { void loadDue(); void loadInbox() }`:

```ts
        // Restul proiectelor în fundal, ca offline să existe și ce n-ai deschis azi.
        void repository.sync?.prefetchAll()
```

- [ ] **Step 4: Store — evenimentele de sincronizare și `syncStatus`**

Adaugă starea și abonarea (după `upsertIssue` și `applyProjectBundle`):

```ts
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => repository.sync?.status() ?? { offline: false, pending: 0 })

  // Ce scrie coada, ce refuză serverul, ce scrie altă filă. Store-ul nu
  // inițiază nimic aici — doar își aliniază memoria cu ce s-a întâmplat.
  useEffect(() => {
    const s = repository.sync
    if (!s) return
    const forget = (ids: string[]) => {
      const gone = new Set(ids)
      const strip = (i: Issue) => (i.deps?.some((d) => gone.has(d)) ? { ...i, deps: i.deps.filter((d) => !gone.has(d)) } : i)
      setAllIssues((prev) => prev.filter((i) => !gone.has(i.id)).map(strip))
      setDueRaw((prev) => prev.filter((i) => !gone.has(i.id)))
      setInboxRaw((prev) => prev.filter((r) => !gone.has(r.issueId)))
    }
    return s.subscribe((e: SyncEvent) => {
      if (e.type === 'status') setSyncStatus(e.status)
      else if (e.type === 'issue') {
        upsertIssue(e.issue)
        setDueRaw((prev) => prev.map((i) => (i.id === e.issue.id ? e.issue : i)))
      } else if (e.type === 'removed') forget(e.ids)
      else if (e.type === 'remap') {
        const r = (id: string) => (id === e.from ? e.to : id)
        const ren = (i: Issue) => (i.id === e.from || i.deps?.includes(e.from) ? { ...i, id: r(i.id), deps: i.deps.map(r) } : i)
        setAllIssues((prev) => prev.map(ren))
        setDueRaw((prev) => prev.map(ren))
      } else if (e.type === 'failed') {
        setError(e.message)
        if (e.revert) upsertIssue(e.revert)
        else if (e.issueId) forget([e.issueId])
      }
    })
  }, [upsertIssue])
```

Importă `SyncEvent`, `SyncStatus` din `./data/offline/types`. Adaugă `syncStatus: SyncStatus` în interfața `HorizontalState` (lângă `refreshing`) și în obiectul de context.

`createIssue`/`updateIssue` din store fac deja `upsertIssue(created/saved)`; evenimentul `issue` emis de repository pentru aceeași scriere e idempotent (aceeași valoare). Nu schimba nimic acolo.

- [ ] **Step 5: UI — redenumirea pe stiva de foi**

În `src/ui.tsx`, în interfața `UI` adaugă `renameIssueId(from: string, to: string): void`, iar în obiectul de context:

```ts
      // Un tichet creat offline și deschis în foaie primește numărul real la
      // sincronizare; foaia trebuie să-l urmeze, altfel ar căuta un ID care
      // nu mai există și s-ar închide sub degetele omului.
      renameIssueId: (from, to) =>
        setSheets((prev) => prev.map((s) => ('issueId' in s && s.issueId === from ? { ...s, issueId: to } : s))),
```

- [ ] **Step 6: `SyncBridge` în `App.tsx`**

Adaugă componenta și randeaz-o în interiorul `<UIProvider>` (lângă conținutul existent):

```tsx
/**
 * Puntea dintre coada offline și ce nu ține de store: foaia deschisă și URL-ul.
 * Un tichet creat offline, deschis, are în bară `/HZ-~…`; la sincronizare
 * primește `/HZ-13`, fără navigare (replaceState, nu push — nu e un pas nou în
 * istoric, e același tichet).
 */
function SyncBridge() {
  const { renameIssueId } = useUI()
  useEffect(() => {
    return repository.sync?.subscribe((e) => {
      if (e.type !== 'remap') return
      renameIssueId(e.from, e.to)
      if (window.location.pathname === ticketPath(e.from)) {
        window.history.replaceState(window.history.state, '', ticketPath(e.to))
      }
    })
  }, [renameIssueId])
  return null
}
```

Importă `repository` din `./data` și `ticketPath` din `./lib/deepLink` dacă nu sunt deja importate.

- [ ] **Step 7: Verificare**

Run: `npm test && npm run typecheck && npm run test:nav`
Expected: PASS. `test:nav` rulează pe backendul local (fără înveliș) — dacă pică, regresia e din refactorul `applyProjectBundle`/`selectProject`, nu din offline.

- [ ] **Step 8: Commit**

```bash
git add src/data/index.ts src/store.tsx src/ui.tsx src/App.tsx
git commit -m "feat(offline): pornire din cache, evenimente de sincronizare, foaia urmează ID-ul real"
```

---

### Task 11: Sesiunea nu se pierde offline

**Files:**
- Create: `src/lib/storedSession.ts`, `src/lib/storedSession.test.ts`
- Modify: `src/auth.tsx` (efectul cu `getSession` și `onAuthStateChange`, ~linia 39)

**Interfaces:**
- Consumes: `isNetworkError` (Task 3).
- Produces: `pickStoredSession(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): Session | null`; `resolveBootSession(r: { session: Session | null; error: unknown }, stored: () => Session | null): Session | null`.

- [ ] **Step 1: Confirmă comportamentul supabase-js**

Run: `grep -n "_callRefreshToken\|isAuthRetryableFetchError" node_modules/@supabase/auth-js/dist/module/GoTrueClient.js | head -20`
Expected: în `__loadSession`, un refresh eșuat întoarce `{ data: { session: null }, error }`, iar pentru erori reîncercabile sesiunea NU se scoate din storage. Dacă sursa arată altceva (de ex. sesiunea expirată se întoarce așa cum e), oprește-te și raportează: designul de mai jos presupune exact asta.

- [ ] **Step 2: Testul care pică**

```ts
// src/lib/storedSession.test.ts
import { describe, expect, it } from 'vitest'
import { pickStoredSession, resolveBootSession } from './storedSession'
import type { Session } from '@supabase/supabase-js'

const sess = { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } } as unknown as Session
const storage = (entries: Record<string, string>) => ({
  length: Object.keys(entries).length,
  key: (i: number) => Object.keys(entries)[i] ?? null,
  getItem: (k: string) => entries[k] ?? null,
})

describe('pickStoredSession', () => {
  it('găsește sesiunea Supabase după forma cheii', () => {
    expect(pickStoredSession(storage({ 'sb-abc-auth-token': JSON.stringify(sess), x: '1' }))?.user.id).toBe('u1')
  })
  it('ignoră JSON stricat și forme greșite', () => {
    expect(pickStoredSession(storage({ 'sb-abc-auth-token': '{' }))).toBeNull()
    expect(pickStoredSession(storage({ 'sb-abc-auth-token': '{"a":1}' }))).toBeNull()
  })
})

describe('resolveBootSession', () => {
  it('sesiunea primită câștigă', () => {
    expect(resolveBootSession({ session: sess, error: null }, () => null)).toBe(sess)
  })
  it('refresh eșuat din cauza rețelei → sesiunea din storage, nu ecranul de login', () => {
    expect(resolveBootSession({ session: null, error: { name: 'AuthRetryableFetchError', message: '' } }, () => sess)).toBe(sess)
  })
  it('refresh refuzat de server (token revocat) → fără sesiune', () => {
    expect(resolveBootSession({ session: null, error: { name: 'AuthApiError', message: 'Invalid Refresh Token' } }, () => sess)).toBeNull()
  })
  it('fără eroare și fără sesiune → delogat cu adevărat', () => {
    expect(resolveBootSession({ session: null, error: null }, () => sess)).toBeNull()
  })
})
```

- [ ] **Step 3: Rulează, trebuie să pice**

Run: `npx vitest run src/lib/storedSession.test.ts`
Expected: FAIL — modul inexistent.

- [ ] **Step 4: Implementarea**

```ts
// src/lib/storedSession.ts
// Pornirea offline cu tokenul expirat.
//
// supabase-js încearcă un refresh la `getSession()`; fără rețea, refresh-ul
// eșuează și primim `session: null` — deși sesiunea e intactă în storage și
// va merge la prima rețea. Tratat ca „delogat", omul ar ajunge la `Login`
// exact când n-are cum să se logheze, cu datele din cache la un pas. Deci:
// eroare de REȚEA → păstrăm sesiunea din storage; refuz de SERVER (token
// revocat) → chiar ești delogat.

import type { Session } from '@supabase/supabase-js'
import { isNetworkError } from '../data/offline/netError'

const KEY = /^sb-.+-auth-token$/

export function pickStoredSession(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): Session | null {
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (!k || !KEY.test(k)) continue
    try {
      const v = JSON.parse(storage.getItem(k) ?? '')
      if (v && typeof v.access_token === 'string' && v.user && typeof v.user.id === 'string') return v as Session
    } catch {
      // Valoare stricată — mai departe, poate e altă cheie.
    }
  }
  return null
}

export function resolveBootSession(r: { session: Session | null; error: unknown }, stored: () => Session | null): Session | null {
  if (r.session) return r.session
  if (r.error && isNetworkError(r.error)) return stored()
  return null
}
```

- [ ] **Step 5: Legarea în `auth.tsx`**

Efectul cu `getSession` devine:

```ts
  useEffect(() => {
    if (!supabase) return
    const stored = () => (typeof localStorage === 'undefined' ? null : pickStoredSession(localStorage))
    supabase.auth.getSession().then(({ data, error }) => {
      setSession(resolveBootSession({ session: data.session, error }, stored))
      setLoading(false)
    })
    // Un `null` venit fără SIGNED_OUT e un refresh eșuat, nu o delogare — vezi
    // `storedSession.ts`. Delogarea reală vine mereu cu evenimentul ei.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!s && event !== 'SIGNED_OUT') return
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])
```

Importă `pickStoredSession`, `resolveBootSession`.

- [ ] **Step 6: Verificare**

Run: `npx vitest run src/lib/storedSession.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/storedSession.ts src/lib/storedSession.test.ts src/auth.tsx
git commit -m "fix(auth): pornirea offline cu tokenul expirat nu mai trimite la Login"
```

---

### Task 12: Ce vede omul — indicatorul, logout-ul, deep link-ul offline

**Files:**
- Modify: `src/App.tsx` (header, lângă `.header-refresh-btn`, ~linia 131)
- Modify: `src/styles.css` (`.sync-status`)
- Modify: `src/components/Sidebar.tsx:221` (logout)
- Modify: `src/sw.ts` (după `precacheAndRoute`, linia 47)

**Interfaces:**
- Consumes: `syncStatus` (Task 10), `repository.sync.clear()` (Task 6).

- [ ] **Step 1: Indicatorul din header**

În `App.tsx`, în componenta de header care citește deja `refreshing` din `useHorizontal()` (~linia 62), adaugă `syncStatus` la destructurare, iar înaintea butonului `header-refresh-btn`:

```tsx
      {/* Tăcut când totul e sincronizat: absența e informația. */}
      {(syncStatus.offline || syncStatus.pending > 0) && (
        <span className="sync-status" role="status">
          {syncStatus.offline ? 'offline' : 'se trimite'}
          {syncStatus.pending > 0 && ` · ${syncStatus.pending} în așteptare`}
        </span>
      )}
```

În `src/styles.css`, lângă regulile `.header-refresh-btn` (fără chenar, mono, un singur accent — regulile din CLAUDE.md, „Sistemul vizual"):

```css
/* Starea cozii offline. Mono — e o cifră și o etichetă de stare, nu limbă. */
.sync-status {
  font-family: var(--mono, 'IBM Plex Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--muted);
  white-space: nowrap;
}
```

Verifică numele exacte ale jetoanelor: `grep -n -- "--mono\|--muted\|--text-2\|--ink-3" src/styles.css | head`. Folosește jetonul de text secundar care EXISTĂ (nu inventa unul nou) și fontul mono definit acolo.

- [ ] **Step 2: Logout cu coada nevidă**

În `src/components/Sidebar.tsx`, butonul de la linia 221 primește un handler:

```tsx
  const onSignOut = async () => {
    const pending = repository.sync?.status().pending ?? 0
    // Coada e locală: după logout nu mai are cine s-o trimită.
    if (pending > 0 && !window.confirm(`${pending} modificări netrimise se vor pierde. Te deconectezi?`)) return
    await repository.sync?.clear()
    await signOut()
  }
```

și `onClick={() => signOut()}` devine `onClick={() => void onSignOut()}`. Importă `repository` din `../data`.

- [ ] **Step 3: Deep link offline în service worker**

În `src/sw.ts`, după `precacheAndRoute(self.__WB_MANIFEST)`:

```ts
// O navigare rece pe `/HZ-12` sau `/project/x` fără rețea: precache-ul știe doar
// `index.html`, nu fiecare cale a aplicației. Fără ruta asta, un deep link
// offline dădea pagina de eroare a browserului deși aplicația era toată pe disc.
// `/api/` rămâne pe rețea — e `functions/api`, nu aplicația.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }))
```

și importurile:

```ts
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
```

Run: `ls node_modules/workbox-routing/package.json`
Expected: există (vine cu `workbox-precaching`). Dacă lipsește: `npm install -D workbox-routing@$(node -p "require('workbox-precaching/package.json').version")`.

- [ ] **Step 4: Verificare, inclusiv contractul de update**

Run: `npm test && npm run typecheck && npm run build && npm run test:upgrade`
Expected: PASS. `test:upgrade` e obligatoriu: s-a atins `src/sw.ts` (CLAUDE.md, „Service worker-ul e scris de mână").

- [ ] **Step 5: Bancul de culoare**

Run: `python3 design/build-preview.py`, apoi deschide `design/preview.html` în ambele teme. Indicatorul nu apare acolo (n-are stare offline), deci verifică doar că nimic din header nu s-a mișcat.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/styles.css src/components/Sidebar.tsx src/sw.ts package.json package-lock.json
git commit -m "feat(offline): indicator în header, logout cu avertisment, deep link offline"
```

---

### Task 13: Verificarea în browser, cu Supabase real

Nu cod — dovada că merge, înainte de orice propunere de îmbinare.

- [ ] **Step 1: Pornește aplicația pe Supabase**

Run: `grep -c "VITE_DATA_SOURCE=supabase" .env && npm run dev`
Expected: `1`, apoi Vite pe `http://localhost:5173`. Loghează-te.

- [ ] **Step 2: Scenariile, în Chrome cu DevTools → Network → Offline**

Bifează fiecare, cu ce ai văzut efectiv:

1. Reîncarcă pagina cu rețea → apoi o a doua reîncărcare: proiectul apare **fără** „Se încarcă…".
2. Offline → indicatorul spune `offline`. Deschide un proiect pe care NU l-ai deschis azi → are tichete (prefetch).
3. Offline → creează o sarcină cu „mâine la 10" → apare cu `HZ-·`, în „Mâine", indicatorul arată `· 1 în așteptare`.
4. Offline → bifează o sarcină, amân-o, schimbă-i titlul → toate se văd imediat.
5. Offline → încearcă un comentariu → mesajul `Necesită rețea — ești offline.`
6. Offline → reîncarcă pagina (F5) → aplicația pornește, nu cade pe Login, iar cele 3–4 modificări sunt acolo.
7. Online → indicatorul dispare în câteva secunde; sarcina are acum `HZ-<număr>`; pe telefon (sau în altă fereastră) se văd toate modificările.
8. Deschide sarcina creată offline în foaie ÎNAINTE de pasul 7 → după sincronizare foaia rămâne deschisă, iar bara arată `/HZ-<număr>`.

- [ ] **Step 3: Curăță datele de test din Supabase**

Șterge din interfață sarcinile create la pasul 3. Nu lăsa tichete de test în baza reală.

- [ ] **Step 4: Raport și îmbinare — NU push**

Raportează utilizatorului rezultatul fiecărui scenariu. Îmbinarea în `master` și push-ul (= publicare în producție) se fac **doar după acordul lui explicit**, cu `superpowers:finishing-a-development-branch`.
