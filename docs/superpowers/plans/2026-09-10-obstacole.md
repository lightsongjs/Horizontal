# Obstacole — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaugă „obstacolul" — o condiție de deblocat, cu owner și ocolire, legată la N tichete din oricâte valuri — plus harta pe care se vede ce s-a depășit deja.

**Architecture:** O entitate nouă (`obstacles`) plus două tabele de legătură. Motorul de layere (`computeLayers`) și `deriveState` NU se ating: blocarea prin obstacol e un al doilea semnal, ortogonal, calculat de o funcție pură nouă (`src/lib/obstacles.ts`). UI-ul primește trei intrări noi: poarta valului în „Ordine", jetonul de obstacol pe card/rând, și rescrierea tabului „Graf" în „Hartă".

**Tech Stack:** React 19 + TypeScript, Vite, vitest, Supabase (postgres + RLS), CSS custom properties. Fără biblioteci noi.

**Spec:** `docs/superpowers/specs/2026-09-10-obstacole-design.md`
**Mockup vizual:** `prototype-obstacole.html` (deschide în browser înainte de Task 6)

## Global Constraints

- **Push pe master = publicare în producție.** Nu se dă push până la Task 12. Înainte de push: `npm test` și `npm run typecheck`.
- Nu se atinge `src/sw.ts`, `src/pwa.ts` sau blocul VitePWA. `npm run test:upgrade` nu e cerut.
- **Fără linii de 1px ca decor.** Ierarhia se face prin salt de fundal (`--surface` peste `--bg`) plus `box-shadow: var(--amb)`. Linia rămâne doar la separatoare de rând, inele de focus, chenarul câmpurilor de input, afordanțe punctate, legende de tastă.
- **Serif pentru limbă, mono pentru cifre.** `var(--display)` (Literata) pe titluri și corp; `var(--mono)` (IBM Plex Mono) pe ID-uri, owneri, etichete majuscule, numere.
- **Un singur accent.** `--accent`. Niciun gradient pe stări active: text plin plus linie de 2px.
- **Trei raze, pe rol.** `--r-s` 6px jetoane/butoane · `--r-m` 10px tichete/rânduri/câmpuri · `--r` 16px carduri/panouri/foi. **Nu adăuga a patra valoare.**
- **Iconițe, nu emoji.** Doar prin `src/components/Icon.tsx`, cu nume de ROL.
- Culorile semantice: `--blocked` obstacol deschis, `--done` depășit, `--active` în lucru, `var(--layer-N)` rampa de layere. Rampa trăiește în coloana grupului și în numărul layerului — **nu** pe conturul cardului.
- Textul de interfață e în **română**, cu diacritice.
- Migrările SQL: single-line, `if not exists`, safe to re-run, fără ghilimele fanteziste.
- Funcțiile pure noi (`src/lib/obstacles.ts`) nu au I/O și nu importă React.

## File Structure

| fișier | responsabilitate |
|---|---|
| `src/lib/types.ts` *(modif.)* | `Obstacle`, `ObstacleState`, `ObstacleEvidence`, `ObstacleLink` |
| `src/lib/obstacles.ts` *(nou)* | motorul pur: `openObstacles`, `blockedBy`, `waitingDays`, `detectObstacleCycle` |
| `src/lib/obstacles.test.ts` *(nou)* | fixtures pe cazul MCP |
| `src/lib/ordering.ts` *(modif.)* | tichetele blocate de obstacol coboară la finalul layerului |
| `src/data/repository.ts` *(modif.)* | contract: `listObstacles`, `createObstacle`, `updateObstacle`, `deleteObstacle`, `linkObstacle`, `unlinkObstacle` |
| `src/data/localRepository.ts` *(modif.)* | implementarea pe localStorage |
| `src/data/supabaseRepository.ts` *(modif.)* | implementarea pe Postgres |
| `supabase/migration-obstacles.sql` *(nou)* | tabele + indexuri + RLS |
| `src/store.tsx` *(modif.)* | `obstacles`, `blockedByObstacle`, acțiuni CRUD |
| `src/components/Icon.tsx` *(modif.)* | rolurile `obstacle` și `bypass` |
| `src/styles.css` *(modif.)* | `.wave-gate`, `.obst-row`, `.card.blocat`, `.chip.blk`, clasele hărții |
| `src/components/WaveGate.tsx` *(nou)* | poarta valului, peste layere în „Ordine" |
| `src/components/ObstacleChip.tsx` *(nou)* | jetonul „blocat de", folosit de card ȘI de rând |
| `src/components/ObstacleForm.tsx` *(nou)* | foaia obstacolului |
| `src/ui.tsx` *(modif.)* | `kind: 'obstacle-form'` |
| `src/components/SheetHost.tsx` *(modif.)* | randează foaia |
| `src/components/IssueForm.tsx` *(modif.)* | secțiunea „Obstacole" |
| `src/components/TicketCard.tsx` *(modif.)* | jetonul pe card |
| `src/components/ListView.tsx` *(modif.)* | jetonul pe rând |
| `src/components/MapView.tsx` *(nou, înlocuiește GraphView)* | harta |
| `design/preview.html` *(regenerat)* | bancul de probă, ambele teme |

---

### Task 1: Tipurile și motorul pur

**Files:**
- Modify: `src/lib/types.ts` (adaugă la final)
- Create: `src/lib/obstacles.ts`
- Test: `src/lib/obstacles.test.ts`

**Interfaces:**
- Consumes: `Issue` din `src/lib/types.ts`
- Produces: tipurile `Obstacle`, `ObstacleState`, `ObstacleEvidence`, `ObstacleLink`; funcțiile `openObstacles(obstacles: Obstacle[]): Set<string>`, `blockedBy(issues: Issue[], obstacles: Obstacle[], links: ObstacleLink[]): Record<string, string[]>`, `waitingDays(o: Obstacle, now: Date): number | null`, `detectObstacleCycle(obstacles: Obstacle[]): string[] | null`

- [ ] **Step 1: Adaugă tipurile în `src/lib/types.ts`**

La finalul fișierului, după `export type Layers`:

```ts
/** Starea unui obstacol. Vezi docs/superpowers/specs/2026-09-10-obstacole-design.md. */
export type ObstacleState = 'necunoscut' | 'asteptare' | 'depasit' | 'ocolit'

/** Marcajele [V]/[P]/[?]: cât de sigur e ce scrie în obstacol. */
export type ObstacleEvidence = 'verificat' | 'plauzibil' | 'necunoscut'

/**
 * O condiție care trebuie să cadă înainte ca munca să înceapă. NU e muncă: nu
 * are val, nu are layer, nu se estimează, și de obicei nu o rezolvă cel care
 * ține tichetul. De-aia `owner` e text liber și nu un `assigneeId`: „echipa de
 * API", „juridic", „management" nu sunt conturi în aplicație.
 */
export interface Obstacle {
  id: string
  projectId: string
  title: string
  detail: string
  /** Cine îl scoate. Text liber. */
  owner: string
  state: ObstacleState
  /**
   * Un obstacol poate exista fără să blocheze. #3 și #4 din dosarul MCP au
   * fost „nu blochează", apoi promovate — deci e o proprietate care se
   * schimbă în timp, nu o consecință a existenței obstacolului.
   */
  blocking: boolean
  /** `null` = nu are ocolire. Text = ocolirea, cu costul ei. */
  bypass: string | null
  evidence: ObstacleEvidence
  /** Când s-a întrebat. De aici iese „fără răspuns de N zile". */
  askedAt: string | null
  resolvedAt: string | null
  /** Alte obstacole care trebuie depășite înaintea acestuia. */
  deps: string[]
  /** Ordinea în listă, în cadrul proiectului. */
  position: number
}

/** Muchia obstacol → tichet. N la N, peste valuri. */
export interface ObstacleLink {
  obstacleId: string
  issueId: string
}
```

- [ ] **Step 2: Scrie testul care picată**

Creează `src/lib/obstacles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { blockedBy, detectObstacleCycle, openObstacles, waitingDays } from './obstacles'
import { NO_SCHEDULE } from './schedule'
import type { Issue, Obstacle, ObstacleLink, ObstacleState } from './types'

function mkIssue(id: string, wave = 1, done = false): Issue {
  return { id, projectId: 'p', title: id, desc: '', theme: '', wave, deps: [], done, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false, ...NO_SCHEDULE }
}

function mkObst(id: string, state: ObstacleState, extra: Partial<Obstacle> = {}): Obstacle {
  return {
    id, projectId: 'p', title: id, detail: '', owner: '', state,
    blocking: true, bypass: null, evidence: 'necunoscut',
    askedAt: null, resolvedAt: null, deps: [], position: 0, ...extra,
  }
}

// Cazul MCP. B1 „listare de facturi" blochează șase tichete din Faza 1 și
// obstacolul #19. Lanțul #1 → #19: „dacă nu știm cine e utilizatorul, nu știm
// câte tool-uri expunem".
const ISSUES: Issue[] = ['1.1', '1.2', '1.3', '1.4', '1.6', '0.2'].map((id) => mkIssue(id))

describe('openObstacles', () => {
  it('nu întoarce obstacolele depășite sau ocolite', () => {
    const o = [mkObst('B1', 'asteptare'), mkObst('B2', 'depasit'), mkObst('#12', 'ocolit')]
    expect([...openObstacles(o)].sort()).toEqual(['B1'])
  })

  it('propagă prin dependențe între obstacole: #19 e deschis fiindcă #1 e deschis', () => {
    const o = [mkObst('#1', 'necunoscut'), mkObst('#19', 'depasit', { deps: ['#1'] })]
    expect(openObstacles(o).has('#19')).toBe(true)
  })

  it('închide lanțul când rădăcina se depășește', () => {
    const o = [mkObst('#1', 'depasit'), mkObst('#19', 'depasit', { deps: ['#1'] })]
    expect(openObstacles(o).size).toBe(0)
  })

  it('nu intră în buclă infinită pe un ciclu', () => {
    const o = [mkObst('X', 'depasit', { deps: ['Y'] }), mkObst('Y', 'depasit', { deps: ['X'] })]
    expect(() => openObstacles(o)).not.toThrow()
  })
})

describe('blockedBy', () => {
  it('un obstacol deschis blochează toate tichetele legate', () => {
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = ['1.1', '1.2', '1.4', '1.6'].map((issueId) => ({ obstacleId: 'B1', issueId }))
    const out = blockedBy(ISSUES, obstacles, links)
    expect(out['1.1']).toEqual(['B1'])
    expect(out['1.6']).toEqual(['B1'])
    expect(out['0.2']).toBeUndefined()
  })

  it('blocking=false nu stinge nimic', () => {
    const obstacles = [mkObst('#3', 'necunoscut', { blocking: false })]
    const links: ObstacleLink[] = [{ obstacleId: '#3', issueId: '1.6' }]
    expect(blockedBy(ISSUES, obstacles, links)['1.6']).toBeUndefined()
  })

  it('un obstacol depășit nu mai blochează', () => {
    const obstacles = [mkObst('B2', 'depasit')]
    const links: ObstacleLink[] = [{ obstacleId: 'B2', issueId: '1.1' }]
    expect(blockedBy(ISSUES, obstacles, links)['1.1']).toBeUndefined()
  })

  it('adună mai multe obstacole pe același tichet, în ordinea lor de poziție', () => {
    const obstacles = [
      mkObst('#17', 'asteptare', { position: 2 }),
      mkObst('B1', 'asteptare', { position: 0 }),
      mkObst('#19', 'necunoscut', { position: 1 }),
    ]
    const links: ObstacleLink[] = ['B1', '#19', '#17'].map((obstacleId) => ({ obstacleId, issueId: '1.1' }))
    expect(blockedBy(ISSUES, obstacles, links)['1.1']).toEqual(['B1', '#19', '#17'])
  })

  it('un tichet bifat nu se raportează blocat', () => {
    const issues = [mkIssue('1.1', 1, true)]
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = [{ obstacleId: 'B1', issueId: '1.1' }]
    expect(blockedBy(issues, obstacles, links)['1.1']).toBeUndefined()
  })

  it('ignoră legăturile către tichete inexistente', () => {
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = [{ obstacleId: 'B1', issueId: 'FANTOMA' }]
    expect(blockedBy(ISSUES, obstacles, links)).toEqual({})
  })
})

describe('waitingDays', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('numără zilele de la askedAt pentru un obstacol în așteptare', () => {
    const o = mkObst('B1', 'asteptare', { askedAt: '2026-08-25T09:00:00Z' })
    expect(waitingDays(o, now)).toBe(16)
  })

  it('întoarce null dacă nu e în așteptare', () => {
    expect(waitingDays(mkObst('B1', 'necunoscut', { askedAt: '2026-08-25T09:00:00Z' }), now)).toBeNull()
    expect(waitingDays(mkObst('B1', 'depasit', { askedAt: '2026-08-25T09:00:00Z' }), now)).toBeNull()
  })

  it('întoarce null dacă nu s-a notat când s-a întrebat', () => {
    expect(waitingDays(mkObst('B1', 'asteptare'), now)).toBeNull()
  })
})

describe('detectObstacleCycle', () => {
  it('găsește ciclul ca traseu ordonat', () => {
    const o = [mkObst('A', 'necunoscut', { deps: ['B'] }), mkObst('B', 'necunoscut', { deps: ['A'] })]
    expect(detectObstacleCycle(o)).toEqual(['A', 'B', 'A'])
  })

  it('întoarce null pe un lanț valid', () => {
    const o = [mkObst('#1', 'necunoscut'), mkObst('#19', 'necunoscut', { deps: ['#1'] })]
    expect(detectObstacleCycle(o)).toBeNull()
  })
})
```

- [ ] **Step 3: Rulează testul ca să confirmi că picată**

Run: `npx vitest run src/lib/obstacles.test.ts`
Expected: FAIL cu „Failed to resolve import './obstacles'"

- [ ] **Step 4: Scrie implementarea minimă**

Creează `src/lib/obstacles.ts`:

```ts
// Motorul obstacolelor. Pur: fără I/O, fără React — testat pe fixtures ca
// engine.ts, schedule.ts și parseDue.ts.
//
// De ce e separat de engine.ts: obstacolele nu au val, deci nu intră în
// computeLayers. Layerul unui tichet nu se mișcă niciodată la depășirea unui
// obstacol — altfel numărul layerului, singurul lucru stabil din aplicație, ar
// depinde de viteza cu care răspund alte echipe.

import type { Issue, Obstacle, ObstacleLink } from './types'

/** Stările în care un obstacol e închis prin el însuși. */
const CLOSED = new Set(['depasit', 'ocolit'])

/**
 * Obstacolele **efectiv** deschise. Un obstacol e efectiv deschis dacă starea
 * lui e deschisă SAU oricare obstacol de care depinde e efectiv deschis:
 * „#19 câte tool-uri" e depășit în teorie, dar dacă „#1 cine e utilizatorul" e
 * încă deschis, răspunsul lui nu ține.
 *
 * Un ciclu nu aruncă — se tratează ca deschis și se lasă `detectObstacleCycle`
 * să-l raporteze la scriere. O funcție pură chemată la fiecare randare nu are
 * voie să dea eroare pe date deja salvate.
 */
export function openObstacles(obstacles: Obstacle[]): Set<string> {
  const byId: Record<string, Obstacle> = {}
  for (const o of obstacles) byId[o.id] = o

  const memo: Record<string, boolean> = {}
  const VISITING = 'visiting'
  const mark: Record<string, string> = {}

  const isOpen = (id: string): boolean => {
    const cached = memo[id]
    if (cached !== undefined) return cached
    if (mark[id] === VISITING) return true // ciclu
    const o = byId[id]
    if (!o) return false
    mark[id] = VISITING
    const open = !CLOSED.has(o.state) || o.deps.some((d) => byId[d] && isOpen(d))
    delete mark[id]
    memo[id] = open
    return open
  }

  const out = new Set<string>()
  for (const o of obstacles) if (isOpen(o.id)) out.add(o.id)
  return out
}

/**
 * issueId → id-urile obstacolelor deschise ȘI blocante care îl ating, în
 * ordinea `position`. Singura poartă prin care UI-ul află că un tichet e
 * blocat de un obstacol; nicio componentă nu recalculează asta.
 *
 * Tichetele bifate nu se raportează blocate: „gata" bate orice condiție.
 */
export function blockedBy(
  issues: Issue[],
  obstacles: Obstacle[],
  links: ObstacleLink[],
): Record<string, string[]> {
  const open = openObstacles(obstacles)
  const byId: Record<string, Obstacle> = {}
  for (const o of obstacles) byId[o.id] = o
  const live = new Map(issues.filter((i) => !i.done).map((i) => [i.id, i]))

  const out: Record<string, string[]> = {}
  for (const { obstacleId, issueId } of links) {
    const o = byId[obstacleId]
    if (!o || !o.blocking || !open.has(obstacleId)) continue
    if (!live.has(issueId)) continue
    ;(out[issueId] ??= []).push(obstacleId)
  }
  for (const ids of Object.values(out)) {
    ids.sort((a, b) => (byId[a].position - byId[b].position) || a.localeCompare(b))
  }
  return out
}

/** Zile întregi de la `askedAt`. Doar în `asteptare`; null altfel. */
export function waitingDays(o: Obstacle, now: Date): number | null {
  if (o.state !== 'asteptare' || !o.askedAt) return null
  const ms = now.getTime() - new Date(o.askedAt).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/** Ciclu în dependențele dintre obstacole, ca traseu ordonat, sau null. */
export function detectObstacleCycle(obstacles: Obstacle[]): string[] | null {
  const byId: Record<string, Obstacle> = {}
  for (const o of obstacles) byId[o.id] = o
  const GRAY = 1
  const BLACK = 2
  const color: Record<string, number> = {}
  const stack: string[] = []
  let found: string[] | null = null

  const dfs = (id: string): boolean => {
    color[id] = GRAY
    stack.push(id)
    for (const d of byId[id]?.deps ?? []) {
      if (!byId[d]) continue
      if (color[d] === GRAY) {
        found = stack.slice(stack.indexOf(d)).concat(d)
        return true
      }
      if (color[d] === undefined && dfs(d)) return true
    }
    color[id] = BLACK
    stack.pop()
    return false
  }

  for (const o of obstacles) {
    if (color[o.id] === undefined && dfs(o.id)) break
  }
  return found
}
```

- [ ] **Step 5: Rulează testele**

Run: `npx vitest run src/lib/obstacles.test.ts`
Expected: PASS, 15 teste

- [ ] **Step 6: Confirmă că motorul de layere e neatins**

Adaugă în `src/lib/engine.test.ts`, la finalul fișierului, un test care blochează regresia:

```ts
describe('obstacolele nu ating motorul', () => {
  it('computeLayers și deriveState dau același rezultat indiferent de obstacole', () => {
    // engine.ts nu importă nimic din obstacles.ts. Testul e o afirmație despre
    // dependențe, nu despre date: dacă cineva bagă obstacole în layere,
    // importul apare aici și testul devine imposibil de scris cinstit.
    const before = computeLayers(ISSUES, 1)
    const states = ISSUES.map((i) => deriveState(i, indexById(ISSUES)))
    expect(before).toEqual(computeLayers(ISSUES, 1))
    expect(states).toEqual(ISSUES.map((i) => deriveState(i, indexById(ISSUES))))
  })
})
```

- [ ] **Step 7: Rulează toată suita și typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS pe tot

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/obstacles.ts src/lib/obstacles.test.ts src/lib/engine.test.ts
git commit -m "feat(obstacole): motorul pur, cu propagare prin lanțul de obstacole

Un obstacol e efectiv deschis dacă starea lui e deschisă SAU oricare
obstacol de care depinde e deschis: raspunsul la #19 nu ține cât timp #1 e
deschis. Ciclul nu aruncă — o funcție chemată la fiecare randare n-are voie
să dea eroare pe date deja salvate; detectObstacleCycle îl refuză la scriere.

computeLayers și deriveState rămân neatinse."
```

---

### Task 2: Contractul de date și implementarea locală

**Files:**
- Modify: `src/data/repository.ts`
- Modify: `src/data/localRepository.ts`
- Test: `src/data/localRepository.test.ts`

**Interfaces:**
- Consumes: `Obstacle`, `ObstacleLink` din Task 1
- Produces: pe `Repository` — `listObstacles(projectId: string): Promise<Obstacle[]>`, `listObstacleLinks(projectId: string): Promise<ObstacleLink[]>`, `createObstacle(input: NewObstacle): Promise<Obstacle>`, `updateObstacle(id: string, patch: Partial<Obstacle>): Promise<Obstacle>`, `deleteObstacle(id: string): Promise<void>`, `setObstacleIssues(obstacleId: string, issueIds: string[]): Promise<void>`, `setIssueObstacles(issueId: string, obstacleIds: string[]): Promise<void>`; tipul `NewObstacle`

- [ ] **Step 1: Extinde contractul în `src/data/repository.ts`**

Adaugă importul și tipul, după `NewIssue`:

```ts
import type { Assignee, Issue, Obstacle, ObstacleLink, Project, Theme, Wave } from '../lib/types'

export interface NewObstacle {
  projectId: string
  title: string
  detail?: string
  owner?: string
  state?: Obstacle['state']
  blocking?: boolean
  bypass?: string | null
  evidence?: Obstacle['evidence']
  askedAt?: string | null
  deps?: string[]
  /** Tichetele blocate, legate la creare. */
  issueIds?: string[]
}
```

Adaugă în `interface Repository`, după blocul de `listIssues`/`deleteIssues`:

```ts
  listObstacles(projectId: string): Promise<Obstacle[]>
  /** Muchiile obstacol → tichet ale proiectului. Separat de obstacole ca să
   *  poată fi încărcate într-un singur round trip, ca `dependencies`. */
  listObstacleLinks(projectId: string): Promise<ObstacleLink[]>
  createObstacle(input: NewObstacle): Promise<Obstacle>
  /**
   * `resolvedAt` NU se trimite de apelant: se pune automat la trecerea în
   * `depasit`/`ocolit` și se șterge la ieșire. Altfel fiecare loc care schimbă
   * starea ar trebui să-și amintească să-l seteze, iar unul l-ar uita.
   */
  updateObstacle(id: string, patch: Partial<Obstacle>): Promise<Obstacle>
  /** Șterge obstacolul, legăturile lui la tichete, și îl scoate din `deps`
   *  celorlalte obstacole. */
  deleteObstacle(id: string): Promise<void>
  /** Înlocuiește complet setul de tichete blocate de un obstacol. */
  setObstacleIssues(obstacleId: string, issueIds: string[]): Promise<void>
  /** Înlocuiește complet setul de obstacole ale unui tichet. */
  setIssueObstacles(issueId: string, obstacleIds: string[]): Promise<void>
```

- [ ] **Step 2: Scrie testele care picată**

Adaugă la finalul `describe('localRepository', …)` din `src/data/localRepository.test.ts`:

```ts
  it('creează obstacole cu id derivat din prefixul proiectului', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const o1 = await repo.createObstacle({ projectId: p.id, title: 'Listare de facturi', owner: 'Echipa de API' })
    const o2 = await repo.createObstacle({ projectId: p.id, title: 'Care firmă?', owner: 'PM' })
    expect(o1.id).toBe('MCP-O01')
    expect(o2.id).toBe('MCP-O02')
    expect(o1.state).toBe('necunoscut')
    expect(o1.blocking).toBe(true)
    expect(o1.bypass).toBeNull()
    expect(o2.position).toBe(1)
  })

  it('leagă obstacolul la tichete și le întoarce ca muchii', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: '6 tool-uri' })
    const b = await repo.createIssue({ projectId: p.id, title: 'invoice_validate' })
    const o = await repo.createObstacle({ projectId: p.id, title: 'B1', issueIds: [a.id, b.id] })
    const links = await repo.listObstacleLinks(p.id)
    expect(links.filter((l) => l.obstacleId === o.id).map((l) => l.issueId).sort()).toEqual([a.id, b.id].sort())
  })

  it('pune resolvedAt la depășire și îl șterge la redeschidere', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const o = await repo.createObstacle({ projectId: p.id, title: 'B2' })
    const closed = await repo.updateObstacle(o.id, { state: 'depasit' })
    expect(closed.resolvedAt).not.toBeNull()
    const reopened = await repo.updateObstacle(o.id, { state: 'asteptare' })
    expect(reopened.resolvedAt).toBeNull()
  })

  it('ștergerea unui tichet curăță legăturile lui de obstacole', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: 'a' })
    await repo.createObstacle({ projectId: p.id, title: 'B1', issueIds: [a.id] })
    await repo.deleteIssue(a.id)
    expect(await repo.listObstacleLinks(p.id)).toEqual([])
  })

  it('ștergerea unui obstacol curăță legăturile și deps celorlalte', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: 'a' })
    const root = await repo.createObstacle({ projectId: p.id, title: '#1' })
    const child = await repo.createObstacle({ projectId: p.id, title: '#19', deps: [root.id], issueIds: [a.id] })
    await repo.deleteObstacle(root.id)
    const left = await repo.listObstacles(p.id)
    expect(left.map((o) => o.id)).toEqual([child.id])
    expect(left[0].deps).toEqual([])
    expect((await repo.listObstacleLinks(p.id)).length).toBe(1)
    await repo.deleteObstacle(child.id)
    expect(await repo.listObstacleLinks(p.id)).toEqual([])
  })

  it('setIssueObstacles înlocuiește complet setul tichetului', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: 'a' })
    const o1 = await repo.createObstacle({ projectId: p.id, title: 'B1', issueIds: [a.id] })
    const o2 = await repo.createObstacle({ projectId: p.id, title: '#13' })
    await repo.setIssueObstacles(a.id, [o2.id])
    const links = await repo.listObstacleLinks(p.id)
    expect(links.map((l) => l.obstacleId)).toEqual([o2.id])
    expect(links.map((l) => l.obstacleId)).not.toContain(o1.id)
  })

  it('ștergerea proiectului șterge obstacolele și legăturile lui', async () => {
    const repo = createLocalRepository()
    const p = await repo.createProject({ name: 'MCP', description: '', prefix: 'MCP' })
    const a = await repo.createIssue({ projectId: p.id, title: 'a' })
    await repo.createObstacle({ projectId: p.id, title: 'B1', issueIds: [a.id] })
    await repo.deleteProject(p.id)
    expect(await repo.listObstacles(p.id)).toEqual([])
    expect(await repo.listObstacleLinks(p.id)).toEqual([])
  })
```

- [ ] **Step 3: Rulează testele ca să confirmi că picată**

Run: `npx vitest run src/data/localRepository.test.ts`
Expected: FAIL cu „repo.createObstacle is not a function"

- [ ] **Step 4: Implementează în `src/data/localRepository.ts`**

Modifică importul de tipuri și `interface DB`:

```ts
import type { Assignee, Issue, Obstacle, ObstacleLink, Project, Theme, Wave } from '../lib/types'
import { themeKey, type DueRange, type NewIssue, type NewObstacle, type NewProject, type Repository } from './repository'

interface DB {
  projects: Project[]
  waves: Wave[]
  themes: Theme[]
  issues: Issue[]
  assignees: Assignee[]
  obstacles: Obstacle[]
  obstacleLinks: ObstacleLink[]
}
```

În `load()`, în ramura cu date existente, adaugă după `assignees`:

```ts
        // Adăugate după ce cineva avea deja date în localStorage.
        obstacles: (db.obstacles ?? []).map((o) => ({ ...o, deps: o.deps ?? [] })),
        obstacleLinks: db.obstacleLinks ?? [],
```

Și în obiectul `seeded`, după `assignees: []`:

```ts
    obstacles: [],
    obstacleLinks: [],
```

Adaugă lângă `nextIssueId`:

```ts
/** Next free obstacle id for a project, e.g. MCP-O01. Același tipar ca la
 *  tichete, cu „O" ca să nu se confunde niciodată un obstacol cu un tichet. */
function nextObstacleId(db: DB, project: Project): string {
  const pre = `${project.prefix}-O`
  const max = db.obstacles
    .filter((o) => o.projectId === project.id)
    .map((o) => Number(o.id.slice(pre.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${pre}${String(max + 1).padStart(2, '0')}`
}
```

În `deleteIssuesImpl`, înainte de `save(db)`, adaugă:

```ts
  db.obstacleLinks = db.obstacleLinks.filter((l) => !gone.has(l.issueId))
```

În `deleteProject`, după filtrarea celorlalte colecții, adaugă:

```ts
      const goneObstacles = new Set(db.obstacles.filter((o) => o.projectId === id).map((o) => o.id))
      db.obstacles = db.obstacles.filter((o) => o.projectId !== id)
      db.obstacleLinks = db.obstacleLinks.filter((l) => !goneObstacles.has(l.obstacleId))
```

Adaugă metodele, după `deleteIssues`:

```ts
    async listObstacles(projectId: string) {
      return clone(
        load()
          .obstacles.filter((o) => o.projectId === projectId)
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
      )
    },

    async listObstacleLinks(projectId: string) {
      const db = load()
      const mine = new Set(db.obstacles.filter((o) => o.projectId === projectId).map((o) => o.id))
      return clone(db.obstacleLinks.filter((l) => mine.has(l.obstacleId)))
    },

    async createObstacle(input: NewObstacle) {
      const db = load()
      const project = db.projects.find((p) => p.id === input.projectId)
      if (!project) throw new Error(`Unknown project ${input.projectId}`)
      const obstacle: Obstacle = {
        id: nextObstacleId(db, project),
        projectId: input.projectId,
        title: input.title,
        detail: input.detail ?? '',
        owner: input.owner ?? '',
        state: input.state ?? 'necunoscut',
        blocking: input.blocking ?? true,
        bypass: input.bypass ?? null,
        evidence: input.evidence ?? 'necunoscut',
        askedAt: input.askedAt ?? null,
        resolvedAt: null,
        deps: input.deps ?? [],
        position: db.obstacles.filter((o) => o.projectId === input.projectId).length,
      }
      db.obstacles.push(obstacle)
      for (const issueId of input.issueIds ?? []) {
        db.obstacleLinks.push({ obstacleId: obstacle.id, issueId })
      }
      save(db)
      return clone(obstacle)
    },

    async updateObstacle(id: string, patch: Partial<Obstacle>) {
      const db = load()
      const o = db.obstacles.find((x) => x.id === id)
      if (!o) throw new Error(`Unknown obstacle ${id}`)
      Object.assign(o, patch)
      if (patch.state !== undefined) {
        const closed = patch.state === 'depasit' || patch.state === 'ocolit'
        o.resolvedAt = closed ? (o.resolvedAt ?? new Date().toISOString()) : null
      }
      save(db)
      return clone(o)
    },

    async deleteObstacle(id: string) {
      const db = load()
      db.obstacles = db.obstacles
        .filter((o) => o.id !== id)
        .map((o) => (o.deps.includes(id) ? { ...o, deps: o.deps.filter((d) => d !== id) } : o))
      db.obstacleLinks = db.obstacleLinks.filter((l) => l.obstacleId !== id)
      save(db)
    },

    async setObstacleIssues(obstacleId: string, issueIds: string[]) {
      const db = load()
      db.obstacleLinks = db.obstacleLinks.filter((l) => l.obstacleId !== obstacleId)
      for (const issueId of issueIds) db.obstacleLinks.push({ obstacleId, issueId })
      save(db)
    },

    async setIssueObstacles(issueId: string, obstacleIds: string[]) {
      const db = load()
      db.obstacleLinks = db.obstacleLinks.filter((l) => l.issueId !== issueId)
      for (const obstacleId of obstacleIds) db.obstacleLinks.push({ obstacleId, issueId })
      save(db)
    },
```

- [ ] **Step 5: Rulează testele**

Run: `npx vitest run src/data/localRepository.test.ts && npm run typecheck`
Expected: testele locale PASS. `typecheck` va cădea pe `supabaseRepository.ts` — nu implementează încă noile metode. Ăsta e semnalul corect; se rezolvă în Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/data/repository.ts src/data/localRepository.ts src/data/localRepository.test.ts
git commit -m "feat(obstacole): contractul de date și backendul local

resolvedAt se pune de repository, nu de apelant: altfel fiecare loc care
schimbă starea ar trebui să-și amintească să-l seteze, iar unul l-ar uita.

Id-ul are „O\" în el (MCP-O01) ca un obstacol să nu poată fi confundat
niciodată cu un tichet, nici într-un log, nici într-un URL.

typecheck cade deliberat pe supabaseRepository până la commitul următor."
```

---

### Task 3: Migrarea și backendul Supabase

**Files:**
- Create: `supabase/migration-obstacles.sql`
- Modify: `src/data/supabaseRepository.ts`

**Interfaces:**
- Consumes: contractul `Repository` din Task 2
- Produces: implementarea Supabase a acelorași metode. Coloanele DB: `obstacles(id, project_id, title, detail, owner, state, blocking, bypass, evidence, asked_at, resolved_at, position)`, `obstacle_issues(obstacle_id, issue_id)`, `obstacle_deps(obstacle_id, depends_on_id)`

- [ ] **Step 1: Scrie migrarea**

Creează `supabase/migration-obstacles.sql`:

```sql
-- Obstacole: condiția de deblocat, ca entitate proprie. Rulează o dată:
-- npm run migrate supabase/migration-obstacles.sql
-- Single-line, fara ghilimele fanteziste (editoarele de telefon strica apostrofii). Safe to re-run.
--
-- Un obstacol NU e munca: nu are wave si nu are layer, deci nu intra in
-- computeLayers. owner e text liber, nu FK in assignees: „echipa de API",
-- „juridic", „management" nu sunt conturi in aplicatie si nu vor fi.
create table if not exists obstacles (id text primary key, project_id text not null references projects(id) on delete cascade, title text not null, detail text not null default '', owner text not null default '', state text not null default 'necunoscut' check (state in ('necunoscut','asteptare','depasit','ocolit')), blocking boolean not null default true, bypass text, evidence text not null default 'necunoscut' check (evidence in ('verificat','plauzibil','necunoscut')), asked_at timestamptz, resolved_at timestamptz, position integer not null default 0);
create index if not exists obstacles_project_idx on obstacles(project_id);

-- N la N, peste valuri: B1 blocheaza sase tichete din Faza 1. Se scrie o data
-- si se depaseste o data.
create table if not exists obstacle_issues (obstacle_id text not null references obstacles(id) on delete cascade, issue_id text not null references issues(id) on delete cascade, primary key (obstacle_id, issue_id));
create index if not exists obstacle_issues_issue_idx on obstacle_issues(issue_id);

-- Obstacol care blocheaza obstacol: #1 „cine e utilizatorul" → #19 „cate
-- tool-uri". Ciclurile se refuza in aplicatie (detectObstacleCycle).
create table if not exists obstacle_deps (obstacle_id text not null references obstacles(id) on delete cascade, depends_on_id text not null references obstacles(id) on delete cascade, primary key (obstacle_id, depends_on_id), check (obstacle_id <> depends_on_id));

alter table obstacles enable row level security;
alter table obstacle_issues enable row level security;
alter table obstacle_deps enable row level security;

-- Politicile urmeaza exact modelul din migration-access.sql: select pentru
-- orice membru al proiectului, scriere doar pentru role = write sau is_admin().
drop policy if exists obstacles_select on obstacles;
drop policy if exists obstacles_write on obstacles;
create policy obstacles_select on obstacles for select to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = obstacles.project_id and m.user_id = auth.uid()));
create policy obstacles_write on obstacles for all to authenticated using (is_admin() or exists (select 1 from project_members m where m.project_id = obstacles.project_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from project_members m where m.project_id = obstacles.project_id and m.user_id = auth.uid() and m.role = 'write'));

drop policy if exists obstacle_issues_select on obstacle_issues;
drop policy if exists obstacle_issues_write on obstacle_issues;
create policy obstacle_issues_select on obstacle_issues for select to authenticated using (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_issues.obstacle_id and m.user_id = auth.uid()));
create policy obstacle_issues_write on obstacle_issues for all to authenticated using (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_issues.obstacle_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_issues.obstacle_id and m.user_id = auth.uid() and m.role = 'write'));

drop policy if exists obstacle_deps_select on obstacle_deps;
drop policy if exists obstacle_deps_write on obstacle_deps;
create policy obstacle_deps_select on obstacle_deps for select to authenticated using (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_deps.obstacle_id and m.user_id = auth.uid()));
create policy obstacle_deps_write on obstacle_deps for all to authenticated using (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_deps.obstacle_id and m.user_id = auth.uid() and m.role = 'write')) with check (is_admin() or exists (select 1 from obstacles o join project_members m on m.project_id = o.project_id where o.id = obstacle_deps.obstacle_id and m.user_id = auth.uid() and m.role = 'write'));
```

- [ ] **Step 2: Implementează în `src/data/supabaseRepository.ts`**

Extinde importurile:

```ts
import type { Assignee, Issue, Obstacle, ObstacleLink, Project, Theme, Wave } from '../lib/types'
import { themeKey, type DueRange, type NewIssue, type NewObstacle, type NewProject, type Repository } from './repository'
```

Adaugă rândul și maparea, lângă `rowToIssue`:

```ts
interface ObstacleRow {
  id: string
  project_id: string
  title: string
  detail: string
  owner: string
  state: string
  blocking: boolean
  bypass: string | null
  evidence: string
  asked_at: string | null
  resolved_at: string | null
  position: number
}

function rowToObstacle(row: ObstacleRow, depsById: Record<string, string[]>): Obstacle {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    detail: row.detail ?? '',
    owner: row.owner ?? '',
    state: row.state as Obstacle['state'],
    blocking: row.blocking ?? true,
    bypass: row.bypass ?? null,
    evidence: (row.evidence ?? 'necunoscut') as Obstacle['evidence'],
    askedAt: isoOrNull(row.asked_at),
    resolvedAt: isoOrNull(row.resolved_at),
    deps: depsById[row.id] ?? [],
    position: row.position ?? 0,
  }
}

/** Următorul id liber de obstacol, cu „O" ca la localRepository. */
function nextObstacleId(existing: string[], prefix: string): string {
  const pre = `${prefix}-O`
  const max = existing
    .map((id) => Number(id.slice(pre.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${pre}${String(max + 1).padStart(2, '0')}`
}
```

Adaugă metodele în obiectul întors, după `deleteIssues`:

```ts
    async listObstacles(projectId: string) {
      const { data, error } = await db
        .from('obstacles')
        .select('*')
        .eq('project_id', projectId)
        .order('position')
        .order('id')
      if (error) throw error
      const rows = (data ?? []) as ObstacleRow[]
      const ids = rows.map((r) => r.id)
      const depsById: Record<string, string[]> = {}
      if (ids.length) {
        const { data: deps, error: dErr } = await db
          .from('obstacle_deps')
          .select('obstacle_id, depends_on_id')
          .in('obstacle_id', ids)
        if (dErr) throw dErr
        for (const d of deps ?? []) {
          ;(depsById[d.obstacle_id] ??= []).push(d.depends_on_id)
        }
      }
      return rows.map((row) => rowToObstacle(row, depsById))
    },

    async listObstacleLinks(projectId: string) {
      // Un singur round trip: filtrăm pe project_id prin join implicit, ca la
      // `dependencies`. RLS ar întoarce oricum doar proiectele accesibile, dar
      // fără filtru am aduce obstacolele TUTUROR proiectelor userului.
      const { data: mine, error: oErr } = await db.from('obstacles').select('id').eq('project_id', projectId)
      if (oErr) throw oErr
      const ids = (mine ?? []).map((r) => r.id)
      if (!ids.length) return []
      const { data, error } = await db.from('obstacle_issues').select('obstacle_id, issue_id').in('obstacle_id', ids)
      if (error) throw error
      return (data ?? []).map((r) => ({ obstacleId: r.obstacle_id, issueId: r.issue_id }))
    },

    async createObstacle(input: NewObstacle) {
      const { data: existing, error: exErr } = await db.from('obstacles').select('id').eq('project_id', input.projectId)
      if (exErr) throw exErr
      const { data: proj, error: pErr } = await db.from('projects').select('prefix').eq('id', input.projectId).single()
      if (pErr) throw pErr

      const id = nextObstacleId((existing ?? []).map((r) => r.id), proj.prefix)
      const { error } = await db.from('obstacles').insert({
        id,
        project_id: input.projectId,
        title: input.title,
        detail: input.detail ?? '',
        owner: input.owner ?? '',
        state: input.state ?? 'necunoscut',
        blocking: input.blocking ?? true,
        bypass: input.bypass ?? null,
        evidence: input.evidence ?? 'necunoscut',
        asked_at: input.askedAt ?? null,
        resolved_at: null,
        position: (existing ?? []).length,
      })
      if (error) throw error

      if (input.deps?.length) {
        const { error: dErr } = await db
          .from('obstacle_deps')
          .insert(input.deps.map((depends_on_id) => ({ obstacle_id: id, depends_on_id })))
        if (dErr) throw dErr
      }
      if (input.issueIds?.length) {
        const { error: lErr } = await db
          .from('obstacle_issues')
          .insert(input.issueIds.map((issue_id) => ({ obstacle_id: id, issue_id })))
        if (lErr) throw lErr
      }

      const { data: back, error: bErr } = await db.from('obstacles').select('*').eq('id', id).single()
      if (bErr) throw bErr
      return rowToObstacle(back as ObstacleRow, { [id]: input.deps ?? [] })
    },

    async updateObstacle(id: string, patch: Partial<Obstacle>) {
      const row: Record<string, unknown> = {}
      if (patch.title !== undefined) row.title = patch.title
      if (patch.detail !== undefined) row.detail = patch.detail
      if (patch.owner !== undefined) row.owner = patch.owner
      if (patch.blocking !== undefined) row.blocking = patch.blocking
      if (patch.bypass !== undefined) row.bypass = patch.bypass
      if (patch.evidence !== undefined) row.evidence = patch.evidence
      if (patch.askedAt !== undefined) row.asked_at = patch.askedAt
      if (patch.position !== undefined) row.position = patch.position
      if (patch.state !== undefined) {
        row.state = patch.state
        const closed = patch.state === 'depasit' || patch.state === 'ocolit'
        row.resolved_at = closed ? new Date().toISOString() : null
      }
      if (Object.keys(row).length) {
        const { error } = await db.from('obstacles').update(row).eq('id', id)
        if (error) throw error
      }
      if (patch.deps) {
        const { error: delErr } = await db.from('obstacle_deps').delete().eq('obstacle_id', id)
        if (delErr) throw delErr
        if (patch.deps.length) {
          const { error: insErr } = await db
            .from('obstacle_deps')
            .insert(patch.deps.map((depends_on_id) => ({ obstacle_id: id, depends_on_id })))
          if (insErr) throw insErr
        }
      }
      const { data, error } = await db.from('obstacles').select('*').eq('id', id).single()
      if (error) throw error
      const { data: deps, error: dErr } = await db.from('obstacle_deps').select('depends_on_id').eq('obstacle_id', id)
      if (dErr) throw dErr
      return rowToObstacle(data as ObstacleRow, { [id]: (deps ?? []).map((d) => d.depends_on_id) })
    },

    async deleteObstacle(id: string) {
      // obstacle_issues și obstacle_deps au ON DELETE CASCADE pe ambele capete,
      // deci un singur delete curăță și legăturile, și `deps` celorlalte.
      const { error } = await db.from('obstacles').delete().eq('id', id)
      if (error) throw error
    },

    async setObstacleIssues(obstacleId: string, issueIds: string[]) {
      const { error: delErr } = await db.from('obstacle_issues').delete().eq('obstacle_id', obstacleId)
      if (delErr) throw delErr
      if (!issueIds.length) return
      const { error } = await db
        .from('obstacle_issues')
        .insert(issueIds.map((issue_id) => ({ obstacle_id: obstacleId, issue_id })))
      if (error) throw error
    },

    async setIssueObstacles(issueId: string, obstacleIds: string[]) {
      const { error: delErr } = await db.from('obstacle_issues').delete().eq('issue_id', issueId)
      if (delErr) throw delErr
      if (!obstacleIds.length) return
      const { error } = await db
        .from('obstacle_issues')
        .insert(obstacleIds.map((obstacle_id) => ({ obstacle_id, issue_id: issueId })))
      if (error) throw error
    },
```

- [ ] **Step 3: Rulează typecheck și toată suita**

Run: `npm run typecheck && npm test`
Expected: PASS. `supabaseRepository.test.ts` existent trebuie să treacă neschimbat — dacă are un test care afirmă forma contractului, extinde-l cu obstacolele; dacă nu, nu inventa unul aici.

- [ ] **Step 4: Rulează migrarea**

Run: `npm run migrate supabase/migration-obstacles.sql`
Expected: fără eroare. Re-rulează o dată — trebuie să treacă din nou (safe to re-run).

- [ ] **Step 5: Commit**

```bash
git add supabase/migration-obstacles.sql src/data/supabaseRepository.ts
git commit -m "feat(obstacole): migrarea și backendul Supabase

ON DELETE CASCADE pe ambele capete din obstacle_deps face ca ștergerea unui
obstacol să curețe singură deps celorlalte — de-aia deleteObstacle e un
singur delete aici și trei operații în backendul local.

Politicile RLS urmează exact modelul din migration-access.sql; legăturile
moștenesc accesul prin join pe obstacles.project_id."
```

---

### Task 4: Store — obstacolele în starea aplicației

**Files:**
- Modify: `src/store.tsx`

**Interfaces:**
- Consumes: `blockedBy`, `openObstacles`, `detectObstacleCycle` din Task 1; metodele de repository din Task 2
- Produces: pe `HorizontalState` — `obstacles: Obstacle[]`, `obstacleLinks: ObstacleLink[]`, `blockedByObstacle: Record<string, string[]>`, `obstaclesOf(issueId: string): Obstacle[]`, `issuesOf(obstacleId: string): Issue[]`, `createObstacle`, `updateObstacle`, `deleteObstacle`, `setObstacleIssues`, `setIssueObstacles`

- [ ] **Step 1: Extinde `HorizontalState`**

Adaugă în interfață, după `assignees`:

```ts
  /** Obstacolele proiectului activ, ordonate după `position`. */
  obstacles: Obstacle[]
  /** Muchiile obstacol → tichet ale proiectului activ. */
  obstacleLinks: ObstacleLink[]
```

și în secțiunea `// derived helpers`:

```ts
  /**
   * issueId → obstacolele deschise ȘI blocante care îl ating. Singura sursă:
   * nicio componentă nu recalculează asta. Vezi src/lib/obstacles.ts.
   */
  blockedByObstacle: Record<string, string[]>
  obstaclesOf(issueId: string): Obstacle[]
  issuesOf(obstacleId: string): Issue[]
```

și în secțiunea de acțiuni, după `deleteIssues`:

```ts
  createObstacle(input: Omit<NewObstacle, 'projectId'>): Promise<Obstacle | null>
  updateObstacle(id: string, patch: Partial<Obstacle>): Promise<void>
  deleteObstacle(id: string): Promise<void>
  setObstacleIssues(obstacleId: string, issueIds: string[]): Promise<void>
  setIssueObstacles(issueId: string, obstacleIds: string[]): Promise<void>
```

- [ ] **Step 2: Încarcă obstacolele împreună cu tichetele**

Obstacolele se încarcă lazy per proiect, exact ca tichetele: găsește locul unde se apelează `repo.listIssues(projectId)` și adaugă în același `Promise.all` apelurile `repo.listObstacles(projectId)` și `repo.listObstacleLinks(projectId)`, punând rezultatele în două stări noi:

```ts
const [allObstacles, setAllObstacles] = useState<Obstacle[]>([])
const [allObstacleLinks, setAllObstacleLinks] = useState<ObstacleLink[]>([])
```

Filtrate pe proiectul activ, lângă `issues`:

```ts
  const obstacles = useMemo(
    () => allObstacles.filter((o) => o.projectId === projectId),
    [allObstacles, projectId],
  )
  const obstacleLinks = useMemo(() => {
    const mine = new Set(obstacles.map((o) => o.id))
    return allObstacleLinks.filter((l) => mine.has(l.obstacleId))
  }, [allObstacleLinks, obstacles])
```

**De ce în același `Promise.all` și nu într-un efect separat:** dacă obstacolele ajung o randare mai târziu decât tichetele, poarta valului apare goală și apoi sare la patru — iar cardurile clipesc din „liber" în „blocat". Un singur `await` face ca cele două să apară împreună.

- [ ] **Step 3: Calculează derivatele**

Lângă `layers`:

```ts
  const blockedByObstacle = useMemo(
    () => blockedBy(issues, obstacles, obstacleLinks),
    [issues, obstacles, obstacleLinks],
  )

  const obstaclesOf = useCallback(
    (issueId: string) => {
      const ids = new Set(obstacleLinks.filter((l) => l.issueId === issueId).map((l) => l.obstacleId))
      return obstacles.filter((o) => ids.has(o.id))
    },
    [obstacles, obstacleLinks],
  )

  const issuesOf = useCallback(
    (obstacleId: string) => {
      const ids = new Set(obstacleLinks.filter((l) => l.obstacleId === obstacleId).map((l) => l.issueId))
      return issues.filter((i) => ids.has(i.id))
    },
    [issues, obstacleLinks],
  )
```

- [ ] **Step 4: Scrie acțiunile**

Modelează-le după `createIssue` / `updateIssue` existente (același tratament de eroare și același `refresh` sau update optimist — urmează exact ce fac acelea, nu inventa un al doilea tipar). Singura logică proprie e refuzul ciclurilor:

```ts
  const updateObstacleAction = useCallback(
    async (id: string, patch: Partial<Obstacle>) => {
      if (patch.deps) {
        // Ciclul se refuză aici, nu în motor: openObstacles e chemat la fiecare
        // randare și n-are voie să arunce pe date deja salvate.
        const prospective = obstacles.map((o) => (o.id === id ? { ...o, deps: patch.deps! } : o))
        const cycle = detectObstacleCycle(prospective)
        if (cycle) throw new Error(`Dependență circulară între obstacole: ${cycle.join(' → ')}`)
      }
      const updated = await repo.updateObstacle(id, patch)
      setAllObstacles((prev) => prev.map((o) => (o.id === id ? updated : o)))
    },
    [obstacles, repo],
  )
```

`createObstacle` întoarce `null` dacă `project` e null, ca `createTheme`.

- [ ] **Step 5: Pune-le în `value`**

Adaugă toate câmpurile noi în obiectul `value: HorizontalState`.

- [ ] **Step 6: Verifică**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/store.tsx
git commit -m "feat(obstacole): starea și derivatele în store

Obstacolele se încarcă în ACELAȘI Promise.all cu tichetele. Dacă ajungeau o
randare mai târziu, poarta valului apărea goală și apoi sărea la patru, iar
cardurile clipeau din „liber\" în „blocat\".

Ciclul se refuză în acțiunea de scriere, nu în motor: openObstacles e chemat
la fiecare randare și n-are voie să arunce pe date deja salvate."
```

---

### Task 5: Tichetele blocate coboară în layerul lor

**Files:**
- Modify: `src/lib/ordering.ts`
- Modify: `src/hooks.ts` (`useOrderedLayers`)
- Test: `src/lib/ordering.test.ts`

**Interfaces:**
- Consumes: `blockedByObstacle` din Task 4
- Produces: `buildOrderedLayers(layers, byId, hideDone, blockedIds?: Set<string>)` — al patrulea parametru, opțional, retrocompatibil

- [ ] **Step 1: Scrie testul care picată**

Adaugă în `src/lib/ordering.test.ts`:

```ts
describe('tichetele blocate de obstacol', () => {
  it('coboară la finalul layerului, sub cele libere', () => {
    const byId = { A: mk('A'), B: mk('B'), C: mk('C'), D: mk('D') }
    const layers = { 0: ['A', 'B', 'C', 'D'] }
    const blocked = new Set(['A', 'C'])
    expect(buildOrderedLayers(layers, byId, false, blocked)[0].ids).toEqual(['B', 'D', 'A', 'C'])
  })

  it('urgența bate ordinea de blocare doar între tichete libere', () => {
    // Un tichet urgent DAR blocat nu are ce să facă sus: e o promisiune pe care
    // lista n-o poate ține. Urgența ordonează în interiorul fiecărei grupe.
    const byId = { A: mk('A'), U: mk('U', [], 1, false, true), V: mk('V', [], 1, false, true) }
    const layers = { 0: ['A', 'U', 'V'] }
    const blocked = new Set(['U'])
    expect(buildOrderedLayers(layers, byId, false, blocked)[0].ids).toEqual(['V', 'A', 'U'])
  })

  it('fără al patrulea argument se comportă exact ca înainte', () => {
    const byId = { A: mk('A'), B: mk('B') }
    const layers = { 0: ['A', 'B'] }
    expect(buildOrderedLayers(layers, byId, false)[0].ids).toEqual(['A', 'B'])
  })
})
```

Dacă factory-ul `mk` din acel fișier nu primește `urgent`, extinde-l ca al cincilea parametru cu implicit `false`.

- [ ] **Step 2: Rulează testul ca să confirmi că picată**

Run: `npx vitest run src/lib/ordering.test.ts`
Expected: FAIL — `['A','B','C','D']` în loc de `['B','D','A','C']`

- [ ] **Step 3: Implementează**

În `src/lib/ordering.ts`:

```ts
/**
 * Partiție stabilă: liberele înainte de cele blocate de un obstacol, urgența
 * aplicată în interiorul fiecărei grupe.
 *
 * De ce blocarea bate urgența: un tichet urgent dar blocat nu are ce să facă
 * sus în listă — e o promisiune pe care lista n-o poate ține. Urgent înseamnă
 * „fă-l primul", și nu se poate.
 */
export function orderIdsByBlocking(ids: string[], blockedIds: Set<string>): string[] {
  const free: string[] = []
  const blocked: string[] = []
  for (const id of ids) (blockedIds.has(id) ? blocked : free).push(id)
  return [...free, ...blocked]
}
```

și în `buildOrderedLayers`:

```ts
export function buildOrderedLayers(
  layers: Layers,
  byId: Record<string, Issue>,
  hideDone: boolean,
  blockedIds?: Set<string>,
): OrderedLayer[] {
  return layerKeys(layers)
    .map((L) => {
      let ids = layers[L]
      if (hideDone) ids = ids.filter((id) => !byId[id]?.done)
      if (blockedIds?.size) {
        const [free, blocked] = [
          orderIdsByUrgency(ids.filter((id) => !blockedIds.has(id)), byId),
          orderIdsByUrgency(ids.filter((id) => blockedIds.has(id)), byId),
        ]
        return { L, ids: [...free, ...blocked] }
      }
      return { L, ids: orderIdsByUrgency(ids, byId) }
    })
    .filter((group) => group.ids.length > 0)
}
```

- [ ] **Step 4: Leagă hook-ul**

În `src/hooks.ts`:

```ts
export function useOrderedLayers(hideDone: boolean): OrderedLayer[] {
  const { layers, byId, blockedByObstacle } = useHorizontal()
  const blockedIds = useMemo(() => new Set(Object.keys(blockedByObstacle)), [blockedByObstacle])
  return useMemo(
    () => buildOrderedLayers(layers, byId, hideDone, blockedIds),
    [layers, byId, hideDone, blockedIds],
  )
}
```

- [ ] **Step 5: Rulează testele**

Run: `npm test && npm run typecheck`
Expected: PASS. `orderIdsByBlocking` rămâne exportat dar nefolosit de `buildOrderedLayers` — șterge-l dacă lint-ul se plânge, sau folosește-l în locul partiției inline; **nu lăsa două implementări ale aceleiași reguli.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/ordering.ts src/lib/ordering.test.ts src/hooks.ts
git commit -m "feat(obstacole): tichetul blocat coboară, layerul nu se schimbă

Blocarea bate urgența: un tichet urgent dar blocat nu are ce să facă sus în
listă — urgent înseamnă „fă-l primul\", și nu se poate.

Layerul rămâne calculat exclusiv din dependențe. Al patrulea parametru e
opțional, deci apelurile existente se comportă identic."
```

---

### Task 6: Vocabularul vizual — iconițe și CSS

**Files:**
- Modify: `src/components/Icon.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: rolurile de iconiță `obstacle` și `bypass`; clasele CSS `.wave-gate`, `.wave-gate-top`, `.obst-row`, `.obst-row.ok`, `.card.blocat`, `.chip`, `.chip.blk`, `.chip.ok`, `.map-*`

**Înainte de acest task: deschide `prototype-obstacole.html` în browser, în ambele teme.** Este referința vizuală.

- [ ] **Step 1: Adaugă rolurile de iconiță**

În `src/components/Icon.tsx`, la importuri: `OctagonAlert`, `CornerUpRight` (ambele verificate ca existente în `lucide-react@^1.43.0`). În vocabular:

```ts
  // Nume de ROL, nu de desen: „obstacle", nu „octagon". Desenul se schimbă
  // într-un singur loc. `danger` rămâne pentru avertismente generice.
  obstacle: OctagonAlert,
  bypass: CornerUpRight,
```

- [ ] **Step 2: Scrie CSS-ul pentru poarta valului și rândurile ei**

Adaugă în `src/styles.css`, într-o secțiune nouă comentată `/* OBSTACOLE */`:

```css
/* Poarta valului: obstacolele deschise ale valului activ, peste layere.
   Card, deci --r și --amb; fără chenar. */
.wave-gate {
  background: var(--surface);
  border-radius: var(--r);
  box-shadow: var(--amb);
  padding: 12px 14px;
  margin: 0 0 14px;
}
.wave-gate-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wave-gate-n {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--blocked);
}
.wave-gate-l {
  flex: 1;
  font-size: 13.5px;
  color: var(--txt);
}
.wave-gate-c {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--txt-faint);
}
.obst-list {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
}
/* Rând, deci --r-m... dar aici e jeton pe un card: --r-s. Fundalul e
   --surface-3, al treilea ton, pus PE card, nu pe pagină. */
.obst-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--r-s);
  background: var(--surface-3);
  color: var(--txt);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.obst-row:hover { background: var(--surface-2); }
.obst-row-id {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--blocked);
  min-width: 44px;
}
.obst-row.ok .obst-row-id { color: var(--done); }
.obst-row-title { flex: 1; font-size: 13px; min-width: 0; }
.obst-row.ok .obst-row-title { color: var(--txt-faint); text-decoration: line-through; }
.obst-row-own {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--txt-faint);
}

/* Cardul blocat: se stinge prin SALT DE FUNDAL și pierderea umbrei, nu prin
   chenar. Rămâne clar un card — dacă ar pierde și fundalul, ar dispărea. */
.card.blocat,
.tk.blocat {
  background: var(--surface-2);
  box-shadow: none;
  opacity: 0.72;
}

/* Jetonul de obstacol. Folosit identic pe card („Ordine") și pe rând
   („Listă"), ca „blocat de" să arate la fel în ambele. */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: var(--r-s);
  background: var(--surface-3);
  color: var(--txt-dim);
}
.chip.blk { background: var(--blocked-soft); color: var(--blocked); }
.chip.ok { background: var(--done-soft); color: var(--done); }
.chip.acc { background: var(--accent-soft); color: var(--accent); }
```

- [ ] **Step 3: Scrie CSS-ul hărții**

```css
/* HARTĂ */
.map-wrap {
  background: var(--surface);
  border-radius: var(--r);
  box-shadow: var(--amb);
  overflow-x: auto;
  overflow-y: hidden;
}
.map-band { fill: var(--surface-2); }
.map-bandtxt {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  fill: var(--txt-faint);
}
.map-id {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  fill: var(--txt-faint);
}
.map-own {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  fill: var(--txt-faint);
  text-anchor: end;
}
.map-title { font-family: var(--display); font-size: 12.5px; fill: var(--txt); }
.map-title.dim { fill: var(--txt-dim); }
.map-tick { fill: var(--surface-2); }
.map-obst { fill: var(--surface-3); }
.map-edge { fill: none; stroke-width: 1.5; }
.map-edge.dep { stroke: var(--txt-faint); opacity: 0.4; }
.map-edge.blk { stroke: var(--blocked); opacity: 0.6; stroke-dasharray: 5 4; }
.map-edge.don { stroke: var(--done); opacity: 0.45; }
.map-head.dep { fill: var(--txt-faint); opacity: 0.4; }
.map-head.blk { fill: var(--blocked); opacity: 0.7; }
.map-head.don { fill: var(--done); opacity: 0.5; }
.map-strike { stroke: var(--done); stroke-width: 1.2; opacity: 0.8; }
.map-node { cursor: pointer; }
```

- [ ] **Step 4: Verifică în bancul de probă, în AMBELE teme**

Run: `python3 design/build-preview.py`
Apoi deschide `design/preview.html` și treci pe ecranul „Controale". Verifică explicit: `.obst-row` are fundal în ambele teme? `.card.blocat` se distinge de fundalul paginii fără chenar? **Un control care rămâne fără fundal ȘI fără chenar trece typecheck-ul și testele, dar e invizibil.**

- [ ] **Step 5: Commit**

```bash
git add src/components/Icon.tsx src/styles.css
git commit -m "design(obstacole): vocabularul vizual, fără să adauge o rază nouă

Cardul blocat se stinge prin salt de fundal (--surface-2) și pierderea
umbrei, nu prin chenar — dar PĂSTREAZĂ fundalul: fără el ar dispărea, iar
typecheck-ul și testele n-ar prinde-o.

Rolurile de iconiță sunt „obstacle\" și „bypass\", nu numele desenelor."
```

---

### Task 7: Poarta valului în „Ordine"

**Files:**
- Create: `src/components/WaveGate.tsx`
- Modify: `src/components/OrdineView.tsx:39-45` (înainte de `orderedLayers.map`)

**Interfaces:**
- Consumes: `obstacles`, `obstacleLinks`, `issues`, `activeWave` din store; `openObstacles`, `waitingDays` din Task 1; clasele CSS din Task 6
- Produces: `<WaveGate />` — nu primește props; citește totul din store

- [ ] **Step 1: Scrie componenta**

Creează `src/components/WaveGate.tsx`:

```tsx
import { useMemo } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { openObstacles, waitingDays } from '../lib/obstacles'
import { Icon } from './Icon'
import type { Obstacle } from '../lib/types'

/** Câte obstacole depășite se arată în poartă. Restul se văd pe hartă. */
const RECENT_CLOSED = 3

/**
 * Obstacolele deschise ale valului activ, peste grupurile de layere.
 *
 * Valul unui obstacol nu există — obstacolul n-are val. „Al valului" înseamnă
 * „atinge cel puțin un tichet din valul activ". De-aia același obstacol apare
 * în poarta mai multor valuri, și e corect: B1 chiar blochează în toate.
 */
export function WaveGate() {
  const { obstacles, obstacleLinks, issues, activeWave } = useHorizontal()
  const { pushSheet } = useUI()

  const { open, closed, elsewhere } = useMemo(() => {
    const inWave = new Set(issues.filter((i) => i.wave === activeWave).map((i) => i.id))
    const touching = new Set(
      obstacleLinks.filter((l) => inWave.has(l.issueId)).map((l) => l.obstacleId),
    )
    const mine = obstacles.filter((o) => touching.has(o.id))
    const openIds = openObstacles(obstacles)
    const open = mine.filter((o) => openIds.has(o.id) && o.blocking)
    const closed = mine.filter((o) => !openIds.has(o.id)).slice(-RECENT_CLOSED)
    // „La alții": owner scris și diferit de gol. Numărul care răspunde la
    // „de ce nu merge mai repede" fără să-l spui tu.
    const elsewhere = open.filter((o) => o.owner.trim() !== '').length
    return { open, closed, elsewhere }
  }, [obstacles, obstacleLinks, issues, activeWave])

  if (open.length === 0 && closed.length === 0) return null

  const row = (o: Obstacle, ok: boolean) => {
    const days = waitingDays(o, new Date())
    return (
      <button
        key={o.id}
        className={`obst-row ${ok ? 'ok' : ''}`}
        onClick={() => pushSheet({ kind: 'obstacle-form', obstacleId: o.id })}
      >
        <span className="obst-row-id">{o.id}</span>
        <span className="obst-row-title">{o.title}</span>
        <span className="obst-row-own">
          {ok ? (o.state === 'ocolit' ? 'ocolit' : 'depășit') : days !== null ? `${days} zile` : o.owner}
        </span>
      </button>
    )
  }

  return (
    <div className="wave-gate">
      <div className="wave-gate-top">
        <Icon name="obstacle" size={15} />
        <span className="wave-gate-n">{open.length}</span>
        <span className="wave-gate-l">
          {open.length === 1 ? 'obstacol deschis' : 'obstacole deschise'} în acest val
        </span>
        {elsewhere > 0 && <span className="wave-gate-c">{elsewhere} la alții</span>}
      </div>
      <div className="obst-list">
        {open.map((o) => row(o, false))}
        {closed.map((o) => row(o, true))}
      </div>
    </div>
  )
}
```

**Notă:** `Icon name="obstacle"` moștenește `currentColor`; culoarea vine din `.wave-gate-top`. Adaugă în `styles.css` la `.wave-gate-top`: `color: var(--blocked);` și pe `.wave-gate-l` `color: var(--txt);` — altfel textul devine roșu și el.

- [ ] **Step 2: Montează-l în „Ordine"**

În `src/components/OrdineView.tsx`, imediat după `</div>` care închide `.wave-sel` și înainte de `{waves.length === 0 ? …}`:

```tsx
      <WaveGate />
```

plus importul `import { WaveGate } from './WaveGate'`.

- [ ] **Step 3: Verifică manual**

Run: `npm run dev`
Creează în proiectul demo două obstacole, leagă unul la două tichete din valul activ, marchează al doilea `depasit`. Verifică: poarta arată „1 obstacol deschis", cel depășit apare tăiat, tichetele legate au coborât la finalul layerului.

- [ ] **Step 4: Verifică și commit**

Run: `npm test && npm run typecheck`

```bash
git add src/components/WaveGate.tsx src/components/OrdineView.tsx src/styles.css
git commit -m "feat(obstacole): poarta valului, peste layere în Ordine

Un obstacol n-are val. „Al valului\" înseamnă „atinge cel puțin un tichet
din valul activ\", deci același obstacol apare în poarta mai multor valuri —
și e corect, fiindcă chiar blochează în toate.

Numărul „N la alții\" e răspunsul la „de ce nu merge mai repede\", dat de
interfață în locul tău."
```

---

### Task 8: Jetonul de obstacol pe card și pe rând

**Files:**
- Create: `src/components/ObstacleChip.tsx`
- Modify: `src/components/TicketCard.tsx:76-84` (zona de jetoane, lângă `DueChip`)
- Modify: `src/components/ListView.tsx` (aceeași zonă pe rând)

**Interfaces:**
- Consumes: `blockedByObstacle`, `obstacles` din store
- Produces: `<ObstacleChip issueId={string} />` — întoarce `null` dacă tichetul nu e blocat de niciun obstacol

- [ ] **Step 1: Scrie componenta**

Creează `src/components/ObstacleChip.tsx`:

```tsx
import { useHorizontal } from '../store'
import { Icon } from './Icon'

/**
 * „Blocat de". Exportat o dată și folosit de card ȘI de rând, ca la clopoțelul
 * din DueChip: aceeași informație trebuie să arate identic în cele două moduri.
 *
 * Un obstacol → id-ul lui, care e acționabil. Mai multe → numărul, fiindcă
 * patru id-uri pe un card de telefon nu se citesc, iar oricum deschizi foaia.
 */
export function ObstacleChip({ issueId }: { issueId: string }) {
  const { blockedByObstacle, obstacles } = useHorizontal()
  const ids = blockedByObstacle[issueId]
  if (!ids?.length) return null

  const first = obstacles.find((o) => o.id === ids[0])
  const label =
    ids.length === 1
      ? `${ids[0]}${first?.owner ? ` · ${first.owner}` : ''}`
      : `${ids.length} obstacole`

  return (
    <span className="chip blk" title={ids.join(', ')}>
      <Icon name="obstacle" size={10} />
      {label}
    </span>
  )
}
```

- [ ] **Step 2: Montează pe card**

În `src/components/TicketCard.tsx`, lângă `<DueChip issue={it} />`:

```tsx
          <ObstacleChip issueId={it.id} />
```

Și pe elementul rădăcină al cardului, adaugă clasa `blocat` când e blocat:

```tsx
const { blockedByObstacle } = useHorizontal()
const obstructed = Boolean(blockedByObstacle[it.id]?.length)
```

folosită în `className={`tk ... ${obstructed ? 'blocat' : ''}`}` — potrivește numele real al clasei rădăcină din fișier, nu presupune `tk`.

- [ ] **Step 3: Montează pe rând, în „Listă"**

În `src/components/ListView.tsx`, în aceeași poziție relativă în care rândul randează deja `DueChip`, adaugă `<ObstacleChip issueId={…} />`. Rândul primește și el clasa `blocat`.

- [ ] **Step 4: Verifică**

Run: `npm test && npm run typecheck && npm run dev`
Verifică manual că un tichet blocat arată identic în „Ordine" și în „Listă".

- [ ] **Step 5: Commit**

```bash
git add src/components/ObstacleChip.tsx src/components/TicketCard.tsx src/components/ListView.tsx
git commit -m "feat(obstacole): jetonul „blocat de\", identic pe card și pe rând

Un component, două locuri — ca la clopoțelul din DueChip: aceeași informație
n-are voie să arate diferit în cele două moduri.

Un obstacol arată id-ul, care e acționabil. Mai multe arată numărul: patru
id-uri pe un card de telefon nu se citesc, iar oricum deschizi foaia."
```

---

### Task 9: Foaia obstacolului

**Files:**
- Create: `src/components/ObstacleForm.tsx`
- Modify: `src/ui.tsx:5-12` (`SheetState`)
- Modify: `src/components/SheetHost.tsx`
- Modify: `src/styles.css` (clasele `.srow`, `.skey`, `.sval`, `.seg` dacă nu există deja)

**Interfaces:**
- Consumes: `updateObstacle`, `deleteObstacle`, `setObstacleIssues`, `obstacles`, `issuesOf` din Task 4; `waitingDays` din Task 1
- Produces: `kind: 'obstacle-form'; obstacleId?: string` pe `SheetState`; componenta `<ObstacleForm obstacleId?: string />`

- [ ] **Step 1: Adaugă starea de foaie**

În `src/ui.tsx`:

```ts
  | { kind: 'obstacle-form'; obstacleId?: string } // creare când n-are id
```

Foaia obstacolului **nu** intră în panoul lateral: `dockedIssueIdFrom` rămâne exclusiv pe `issue-form`. Un obstacol se deschide de pe hartă sau din poartă, adică din contexte unde lista din stânga nu e ce vrei să vezi. Verifică `dockedIssueIdFrom` și confirmă că nu se schimbă.

Adaugă și `tall` pentru ea în `SheetHost.tsx`, plus randarea:

```tsx
        {sheet.kind === 'obstacle-form' && <ObstacleForm key={sheet.obstacleId ?? '__new__'} obstacleId={sheet.obstacleId} />}
```

- [ ] **Step 2: Scrie formularul**

Creează `src/components/ObstacleForm.tsx`. Structura, cu câmpurile din spec:

```tsx
import { useMemo, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { waitingDays } from '../lib/obstacles'
import { Icon } from './Icon'
import type { ObstacleEvidence, ObstacleState } from '../lib/types'

const STATES: { key: ObstacleState; label: string }[] = [
  { key: 'necunoscut', label: 'necunoscut' },
  { key: 'asteptare', label: 'în așteptare' },
  { key: 'depasit', label: 'depășit' },
  { key: 'ocolit', label: 'ocolit' },
]

const EVIDENCE: { key: ObstacleEvidence; label: string }[] = [
  { key: 'verificat', label: 'verificat' },
  { key: 'plauzibil', label: 'plauzibil' },
  { key: 'necunoscut', label: 'nu știu' },
]

export function ObstacleForm({ obstacleId }: { obstacleId?: string }) {
  const { obstacles, issues, issuesOf, createObstacle, updateObstacle, deleteObstacle, setObstacleIssues } =
    useHorizontal()
  const { closeSheet } = useUI()
  const existing = obstacleId ? obstacles.find((o) => o.id === obstacleId) : undefined

  const [title, setTitle] = useState(existing?.title ?? '')
  const [detail, setDetail] = useState(existing?.detail ?? '')
  const [owner, setOwner] = useState(existing?.owner ?? '')
  const [state, setState] = useState<ObstacleState>(existing?.state ?? 'necunoscut')
  const [blocking, setBlocking] = useState(existing?.blocking ?? true)
  const [bypass, setBypass] = useState(existing?.bypass ?? '')
  const [evidence, setEvidence] = useState<ObstacleEvidence>(existing?.evidence ?? 'necunoscut')
  const [issueIds, setIssueIds] = useState<string[]>(
    existing ? issuesOf(existing.id).map((i) => i.id) : [],
  )

  const days = useMemo(
    () => (existing ? waitingDays({ ...existing, state }, new Date()) : null),
    [existing, state],
  )

  // … randare: câmpurile mai jos, plus butoanele Salvează / Șterge
}
```

Randarea, respectând jetoanele:

- **Titlu** — `<input>` cu chenar (câmpurile de input păstrează chenarul: un câmp fără delimitare nu se mai citește ca un câmp), rază `--r-m`.
- **Detaliu** — `<textarea>`, la fel.
- **Cine îl scoate** — `<input>` text liber, cu `placeholder="Echipa de API"`. **Nu un selector de utilizatori.**
- **Stare** — patru butoane `.seg`, marcate cu text plin plus linie de 2px pe `--accent`, **fără casetă umplută și fără gradient**.
- **„fără răspuns de N zile"** — se **calculează** din `waitingDays`, nu se scrie. Afișat doar când `days !== null`, în `var(--mono)`, sub selectorul de stare.
- **Ocolire** — `<textarea>` cu `placeholder="Nu există"`. Gol ⇒ se salvează `null`, nu `''`: `null` chiar înseamnă „nu are ocolire", iar harta desenează colțul retezat exact pe `bypass !== null`.
- **Dovadă** — trei butoane `.seg`.
- **Blochează** — un comutator; când e stins, un rând de ajutor: „Se vede pe hartă, dar nu stinge niciun tichet."
- **Tichetele blocate** — jetoane `.chip.blk` cu `×`, plus căutare de adăugat. Refolosește exact tiparul `.dep-search-*` din `IssueForm.tsx` (`dep-search-block`, `dep-chip`, `dep-search-input`, `dep-results`, `dep-result-row`) — **nu scrie un al doilea selector de căutare.**

La salvare, `askedAt` se pune automat la prima trecere în `asteptare`, dacă e gol:

```tsx
  const patch = {
    title: title.trim(), detail, owner: owner.trim(), state, blocking,
    bypass: bypass.trim() === '' ? null : bypass,
    evidence,
    askedAt: state === 'asteptare' && !existing?.askedAt ? new Date().toISOString() : existing?.askedAt ?? null,
  }
```

**De ce automat:** „fără răspuns de 16 zile" e cel mai util câmp din foaie, și e inutil dacă cere un pas manual pe care oricine îl uită la a treia folosire.

- [ ] **Step 3: Verifică în ambele teme**

Run: `python3 design/build-preview.py`
Deschide `design/preview.html`, ecranul „Controale". Verifică: butonul `.seg` neselectat are contrast suficient? Comutatorul „Blochează" se vede în ambele teme?

- [ ] **Step 4: Verifică și commit**

Run: `npm test && npm run typecheck`

```bash
git add src/components/ObstacleForm.tsx src/ui.tsx src/components/SheetHost.tsx src/styles.css
git commit -m "feat(obstacole): foaia obstacolului

askedAt se pune automat la prima trecere în „în așteptare\": „fără răspuns
de 16 zile\" e cel mai util câmp din foaie și e inutil dacă cere un pas
manual pe care oricine îl uită la a treia folosire.

Ocolirea goală se salvează null, nu '': null chiar înseamnă „nu are
ocolire\", iar harta desenează colțul retezat exact pe bypass !== null.

Foaia nu intră în panoul lateral — un obstacol se deschide de pe hartă sau
din poartă, contexte în care lista din stânga nu e ce vrei să vezi."
```

---

### Task 10: Al treilea tab — „Obstacole" în selectorul de dependențe

**Files:**
- Modify: `src/components/IssueForm.tsx` (`depTab` la linia 310; butoanele de tab la 1113-1120; helperii la 477-523; submit la 588-635; dirty la 419-429)
- Test: `src/components/IssueForm.test.ts`

**Interfaces:**
- Consumes: `obstacles`, `obstaclesOf`, `setIssueObstacles`, `createObstacle` din Task 4; `pushSheet` din Task 9
- Produces: nimic nou pentru alte task-uri

**Obstacolul nu e un al treilea fel de dependență — dar stă în același selector.**
Cele două lucruri nu se contrazic: „Necesită" și „Permite" sunt muchii între
tichete, „Obstacole" e o axă separată. Ce le unește e întrebarea pe care o pui
în același moment: *ce împiedică tichetul asta?* Un al doilea selector de
căutare, în altă parte a formularului, ar pune același gest în două locuri.

Deci: al treilea buton de tab, cu aceleași jetoane, aceeași căutare și același
drum de creare-din-titlu. Trei diferențe, toate necesare:

1. **Lista de rezultate e de obstacole, nu de tichete.** Aceeași căutare, altă
   sursă.
2. **Ce se creează la tastarea unui titlu nou e un obstacol**, nu un tichet.
   `state: 'necunoscut'`, `blocking: true`, restul gol — se completează în foaie.
3. **Jetonul deschide foaia obstacolului**, nu cardul tichetului.

- [ ] **Step 1: Scrie testul care picată**

În `src/components/IssueForm.test.ts`, extinde testul de „dirty" existent (funcția care compară starea formularului cu tichetul salvat) ca să acopere obstacolele:

```ts
it('formularul e murdar când setul de obstacole s-a schimbat', () => {
  // Urmează exact tiparul testelor de dirty existente din acest fișier:
  // dacă acolo se testează o funcție pură extrasă, testeaz-o pe ea; dacă se
  // testează prin randare, randează. Nu introduce un al doilea tipar.
  expect(obstaclesDirty(['MCP-O01'], ['MCP-O01', 'MCP-O02'])).toBe(true)
  expect(obstaclesDirty(['MCP-O02', 'MCP-O01'], ['MCP-O01', 'MCP-O02'])).toBe(false)
})
```

Dacă `IssueForm.test.ts` nu are o funcție pură de dirty pe care s-o extinzi, extrage una — comparația de seturi din `IssueForm.tsx:419-429` merită să fie testabilă și oricum crește cu acest task.

- [ ] **Step 2: Rulează testul ca să confirmi că picată**

Run: `npx vitest run src/components/IssueForm.test.ts`
Expected: FAIL cu „obstaclesDirty is not defined"

- [ ] **Step 3: Lărgește `depTab` la trei valori**

În `src/components/IssueForm.tsx:310`:

```tsx
const [depTab, setDepTab] = useState<'necesita' | 'permite' | 'obstacole'>('necesita')
```

TypeScript va marca acum fiecare loc care presupunea două valori — liniile 493–494, 505–507, 513–514, 518–519, 523. **Parcurge-le pe toate;** lista de erori de la `tsc` e harta exactă a ce trebuie extins. Nu adăuga `as never` și nu lăsa un `else` să însemne „obstacole": un `if/else` pe două ramuri devine tăcut greșit când apare a treia valoare.

Adaugă al treilea buton, după cel de „Permite" (linia ~1119), în același tipar:

```tsx
                <button
                  className={`dep-tab-btn ${depTab === 'obstacole' ? 'on' : ''}`}
                  onClick={() => { setDepTab('obstacole'); setDepSearchQ(''); setDepDropdownOpen(false) }}
                >
                  <Icon name="obstacle" size={13} /> Obstacole
                  {obstIds.length > 0 && <span className="dep-tab-count">{obstIds.length}</span>}
                </button>
```

- [ ] **Step 4: Starea și crearea din titlu**

```tsx
  const [obstIds, setObstIds] = useState<string[]>(
    existing ? obstaclesOf(existing.id).map((o) => o.id) : [],
  )
  /** Obstacole scrise în selector dar încă necreate. Același tipar ca DraftIssue. */
  const [draftObstacles, setDraftObstacles] = useState<{ tempId: string; title: string }[]>([])
```

Pe tabul „obstacole", lista de rezultate vine din `obstacles` filtrate pe `depSearchQ` (după `id` și `title`), **cu diacriticele pliate**:

```tsx
/** „firma" trebuie să găsească „Care firmă?". Aceeași pliere ca `themeKey`. */
const fold = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
```

Fără pliere, rândul „creează" apare peste un obstacol care există deja — interfața te împinge exact spre duplicat. Folosește `fold` și la testul de potrivire exactă care decide dacă rândul de creare se arată.

Iar butonul de creare — cel care în tiparul existent face `createDraftDep(t)` — creează un **obstacol** ciornă:

```tsx
  const createDraftObstacle = (title: string) => {
    const tempId = `__draft_o_${Date.now()}`
    setDraftObstacles((p) => [...p, { tempId, title }])
    setObstIds((p) => [...p, tempId])
  }
```

**Prefixul e `__draft_o_`, nu `__draft_`:** filtrele existente de la liniile 419, 485, 489, 588 și 626 taie pe `startsWith('__draft_')`, iar un obstacol ciornă care trece prin ele ar fi tratat ca tichet ciornă și ar ajunge în `createIssue`. `__draft_o_` începe tot cu `__draft_`, deci ar cădea în aceeași capcană — **folosește un prefix care NU e prefixat de el:** `__obst_draft_`.

```tsx
  const createDraftObstacle = (title: string) => {
    const tempId = `__obst_draft_${Date.now()}`
    setDraftObstacles((p) => [...p, { tempId, title }])
    setObstIds((p) => [...p, tempId])
  }
```

- [ ] **Step 5: Salvarea**

În `submit`, după ce tichetul există (la creare id-ul nu se știe înainte — `draftDeps` rezolvă deja exact această problemă în acest fișier, la liniile 605–635; urmează acel tipar):

```tsx
      // Obstacolele ciornă se creează întâi, ca setul final să fie de id-uri reale.
      const realObstIds: string[] = []
      for (const id of obstIds) {
        const draft = draftObstacles.find((d) => d.tempId === id)
        if (!draft) { realObstIds.push(id); continue }
        const created = await createObstacle({ title: draft.title })
        if (created) realObstIds.push(created.id)
      }
      await setIssueObstacles(targetId, realObstIds)
```

- [ ] **Step 6: Include-l în `dirty`**

La liniile 419–429, adaugă comparațiile pentru obstacole:

```tsx
      obstIds.filter((o) => !o.startsWith('__obst_draft_')).slice().sort().join(',') !==
        (existing ? obstaclesOf(existing.id).map((o) => o.id) : []).slice().sort().join(',') ||
      draftObstacles.filter((d) => obstIds.includes(d.tempId)).length > 0 ||
```

Fără asta, garda de close și `setDockedDirty` ratează o schimbare, iar un click pe alt rând ar arunca în tăcere obstacolul pe care tocmai l-ai scris — garda vede doar închiderea explicită.

- [ ] **Step 7: Jetonul deschide foaia obstacolului**

Pe tabul „obstacole", jetonul selectat trebuie să poată face două lucruri: `×` dezleagă, iar corpul jetonului deschide foaia. Un obstacol scris chiar acum e gol — titlu și nimic altceva — deci drumul de la „l-am scris" la „i-am pus owner și stare" trebuie să fie o atingere:

```tsx
                  onClick={() => pushSheet({ kind: 'obstacle-form', obstacleId: o.id })}
```

Doar pentru obstacolele reale; un `__obst_draft_` nu are încă foaie — pentru el, click-ul pe corp nu face nimic.

- [ ] **Step 8: Verifică**

Run: `npm test && npm run typecheck`
Expected: PASS

Manual, în această ordine — e drumul care contează:
1. Deschide un tichet, tab „Obstacole", scrie „Nu știm întrebările", creează.
2. Salvează. Obstacolul trebuie să existe cu id real și să fie legat.
3. Click pe jeton → foaia se deschide, pui owner „PM" și stare „în așteptare".
4. Înapoi în „Ordine": tichetul e stins, a coborât în layerul lui, poarta arată 1.
5. În panoul lateral, scrie alt obstacol și dă click pe alt tichet în listă.
   Prima atingere trebuie **refuzată**, cu clipirea săgeții de salvare.

- [ ] **Step 9: Commit**

```bash
git add src/components/IssueForm.tsx src/components/IssueForm.test.ts
git commit -m "feat(obstacole): al treilea tab, cu creare din titlu

Obstacolul nu e un al treilea fel de dependență, dar stă în același selector:
ce unește „Necesită", „Permite" și „Obstacole" e întrebarea pe care o pui
în același moment — ce împiedică tichetul asta? Un al doilea selector de
căutare ar fi pus același gest în două locuri.

Ciorna are prefixul __obst_draft_, nu __draft_o_: filtrele existente taie pe
startsWith('__draft_'), deci un obstacol ciornă ar fi ajuns în createIssue.

Jetonul deschide foaia, fiindcă un obstacol scris chiar acum e gol — drumul
de la „l-am scris" la „i-am pus owner" trebuie să fie o atingere."
```

---

### Task 11: Harta

**Files:**
- Create: `src/components/MapView.tsx`
- Delete: `src/components/GraphView.tsx`
- Modify: `src/components/ProjectDetail.tsx:1-28` (importul, lista de taburi, randarea)
- Test: `src/lib/mapLayout.ts` + `src/lib/mapLayout.test.ts`

**Interfaces:**
- Consumes: `issues`, `obstacles`, `obstacleLinks`, `waves`, `openObstacles`, `blockedByObstacle` din store
- Produces: `layoutMap(input): MapLayout` — funcție **pură**, cu tipurile `MapNode { id, kind: 'issue' | 'obstacle', title, owner, state, bypass, x, y }`, `MapEdge { from, to, tone: 'dep' | 'blk' | 'don' }`, `MapBand { x1, x2, label }`, `MapLayout { nodes, edges, bands, todayX, width, height }`

**De ce se șterge `GraphView.tsx`:** e singurul ecran nemigrat la sistemul „Scholarly Editorial" — are chenare de 1px pe fiecare nod, două filtre de `feDropShadow` ca strălucire, și fundaluri `--done-soft`/`--active-soft` pe card. Nu se poate adăuga poarta teșită lângă ele fără ca ecranul să arate ca două sisteme lipite. Tabul se redenumește din „Graf" în **„Hartă"**: „graf" descrie desenul, „hartă" descrie întrebarea la care răspunde.

- [ ] **Step 1: Scrie testul de layout care picată**

Creează `src/lib/mapLayout.test.ts`. Layout-ul iese din componentă fiindcă e aritmetică, iar aritmetica dintr-un JSX de 200 de linii nu se poate testa:

```ts
import { describe, expect, it } from 'vitest'
import { layoutMap, NODE_H, NODE_W } from './mapLayout'
import { NO_SCHEDULE } from './schedule'
import type { Issue, Obstacle, ObstacleLink } from './types'

function mkIssue(id: string, deps: string[] = [], wave = 1, done = false): Issue {
  return { id, projectId: 'p', title: id, desc: '', theme: '', wave, deps, done, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false, ...NO_SCHEDULE }
}

function mkObst(id: string, state: Obstacle['state'], extra: Partial<Obstacle> = {}): Obstacle {
  return { id, projectId: 'p', title: id, detail: '', owner: '', state, blocking: true, bypass: null, evidence: 'necunoscut', askedAt: null, resolvedAt: null, deps: [], position: 0, ...extra }
}

describe('layoutMap', () => {
  it('pune tichetele pe coloane după adâncimea de dependență', () => {
    const issues = [mkIssue('A'), mkIssue('B', ['A']), mkIssue('C', ['B'])]
    const { nodes } = layoutMap({ issues, obstacles: [], links: [], waves: [] })
    const x = (id: string) => nodes.find((n) => n.id === id)!.x
    expect(x('A')).toBeLessThan(x('B'))
    expect(x('B')).toBeLessThan(x('C'))
  })

  it('pune obstacolul deschis într-o coloană ÎNAINTEA tichetelor pe care le blochează', () => {
    const issues = [mkIssue('1.1')]
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = [{ obstacleId: 'B1', issueId: '1.1' }]
    const { nodes } = layoutMap({ issues, obstacles, links, waves: [] })
    const b1 = nodes.find((n) => n.id === 'B1')!
    expect(b1.kind).toBe('obstacle')
    expect(b1.x).toBeLessThan(nodes.find((n) => n.id === '1.1')!.x)
  })

  it('nodurile nu se suprapun în aceeași coloană', () => {
    const issues = [mkIssue('A'), mkIssue('B'), mkIssue('C')]
    const { nodes } = layoutMap({ issues, obstacles: [], links: [], waves: [] })
    const ys = nodes.filter((n) => n.x === nodes[0].x).map((n) => n.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(NODE_H)
  })

  it('muchia care pleacă dintr-un obstacol deschis are tonul blk', () => {
    const issues = [mkIssue('1.1')]
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = [{ obstacleId: 'B1', issueId: '1.1' }]
    const { edges } = layoutMap({ issues, obstacles, links, waves: [] })
    expect(edges).toEqual([{ from: 'B1', to: '1.1', tone: 'blk' }])
  })

  it('muchia care pleacă dintr-un lucru închis are tonul don', () => {
    const issues = [mkIssue('A', [], 1, true), mkIssue('B', ['A'])]
    const { edges } = layoutMap({ issues, obstacles: [], links: [], waves: [] })
    expect(edges.find((e) => e.from === 'A')!.tone).toBe('don')
  })

  it('linia „azi" cade după ultima coloană în care totul e închis', () => {
    const issues = [mkIssue('A', [], 1, true), mkIssue('B', ['A'])]
    const { nodes, todayX } = layoutMap({ issues, obstacles: [], links: [], waves: [] })
    const a = nodes.find((n) => n.id === 'A')!
    const b = nodes.find((n) => n.id === 'B')!
    expect(todayX).toBeGreaterThan(a.x + NODE_W)
    expect(todayX).toBeLessThan(b.x)
  })

  it('desenează o bandă per val prezent, în ordine', () => {
    const issues = [mkIssue('A', [], 1), mkIssue('B', [], 2)]
    const waves = [
      { projectId: 'p', number: 1, name: 'Faza 0', label: '', position: 0 },
      { projectId: 'p', number: 2, name: 'Faza 1', label: '', position: 1 },
    ]
    const { bands } = layoutMap({ issues, obstacles: [], links: [], waves })
    expect(bands.map((b) => b.label)).toEqual(['Faza 0', 'Faza 1'])
  })

  it('nu cade pe un proiect gol', () => {
    const out = layoutMap({ issues: [], obstacles: [], links: [], waves: [] })
    expect(out.nodes).toEqual([])
    expect(out.width).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Rulează testul ca să confirmi că picată**

Run: `npx vitest run src/lib/mapLayout.test.ts`
Expected: FAIL cu „Failed to resolve import './mapLayout'"

- [ ] **Step 3: Scrie `src/lib/mapLayout.ts`**

Reguli de layout, în ordinea în care se aplică:

1. **Coloana** unui tichet = adâncimea lui în graful global de dependențe (ca `globalDepths` din vechiul `GraphView`, care se mută aici).
2. **Coloana** unui obstacol = `min(coloana tichetelor pe care le blochează) - 1`, cel puțin 0; iar un obstacol care depinde de alte obstacole stă cel puțin cu o coloană după cel mai adânc dintre ele. Un obstacol fără legături merge în coloana 0.
3. **Rândul** — ordinea de intrare în coloană; obstacolele înaintea tichetelor în aceeași coloană. `x = PAD + col * (NODE_W + COL_GAP)`, `y = TOP + row * (NODE_H + ROW_GAP)`. Constante: `NODE_W = 196`, `NODE_H = 52`, `COL_GAP = 68`, `ROW_GAP = 24`, `PAD = 36`, `TOP = 112`.
4. **Tonul muchiei** — `blk` dacă sursa e un obstacol efectiv deschis (`openObstacles`), `don` dacă sursa e închisă (tichet `done`, sau obstacol `depasit`/`ocolit`), `dep` altfel.
5. **Muchiile** — dependențe tichet→tichet (din `deps`), obstacol→tichet (din `links`), obstacol→obstacol (din `Obstacle.deps`).
6. **`todayX`** — la mijlocul spațiului dintre ultima coloană în care **toate** nodurile sunt închise și prima coloană cu ceva deschis. Dacă nu există așa o graniță, `todayX = PAD - 12` (înainte de tot).
7. **Benzile** — un dreptunghi per val prezent în date, de la primul până la ultimul `x` al tichetelor din acel val, extins cu 20px în ambele direcții. Eticheta e `wave.name`.

Exportă constantele: alte fișiere (testul, componenta) nu au voie să le redefinească.

- [ ] **Step 4: Rulează testele de layout**

Run: `npx vitest run src/lib/mapLayout.test.ts`
Expected: PASS, 8 teste

- [ ] **Step 5: Scrie `src/components/MapView.tsx`**

Componenta desenează ce spune `layoutMap`. Formele, exact ca în `prototype-obstacole.html`:

```tsx
/** Poarta: muchia stângă teșită. Colț dreapta-sus retezat = are ocolire. */
function gatePath(x: number, y: number, hasBypass: boolean): string {
  const c = 13
  return hasBypass
    ? `M${x + c} ${y} H${x + NODE_W - 14} L${x + NODE_W} ${y + 14} V${y + NODE_H} H${x + c} L${x} ${y + NODE_H / 2} Z`
    : `M${x + c} ${y} H${x + NODE_W} V${y + NODE_H} H${x + c} L${x} ${y + NODE_H / 2} Z`
}
```

- Tichetul: `<rect rx="10" class="map-tick">` — rază `--r-m`, fără chenar.
- Obstacolul: `<path class="map-obst" d={gatePath(...)}>`.
- Bară verticală de 2,5px la muchia stângă: `--blocked` obstacol deschis, `--done` închis, `--active` în lucru, `var(--layer-N)` altfel.
- Două linii de text: id + owner sus (`map-id` / `map-own`, mono), titlu jos (`map-title`, serif).
- Linie de tăiere (`map-strike`) pe ce e închis.
- **Muchiile se desenează ÎNAINTEA nodurilor**, ca nodurile să le acopere. Curbă cubică, plus un triunghi de 9px la capăt:

```tsx
const dx = Math.max(46, (x2 - x1) / 2.3)
const d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2 - 9} ${y2}`
```

- Linia „azi": `<line stroke="var(--accent)" strokeWidth="2" strokeDasharray="2 5">` plus eticheta „AZI · <dd luna>" în mono. **E informație, nu decor** — de-aia are voie să fie o linie.
- Click pe un nod: `openIssue(id)` pentru tichete, `pushSheet({ kind: 'obstacle-form', obstacleId: id })` pentru obstacole.
- Fără `feDropShadow`, fără gradient, fără chenar pe noduri. Umbra e pe `.map-wrap`, o singură dată.
- Pe proiect gol: `<p className="empty">Niciun tichet de afișat pe hartă. Adaugă tichete în „Ordine".</p>`
- Containerul: `<div className="map-wrap">` cu `overflow-x: auto` — harta are voie să fie mai lată decât ecranul, ca tabelele și diagramele; pagina nu.

- [ ] **Step 6: Schimbă tabul**

În `src/components/ProjectDetail.tsx`: înlocuiește importul `GraphView` cu `MapView`, redenumește tabul din lista de taburi din „Graf" în „Hartă" (păstrează cheia `graf` — un deep link existent nu are de ce să se rupă), și randarea `{tab === 'graf' && <MapView />}`.

Șterge `src/components/GraphView.tsx`.

- [ ] **Step 7: Verifică**

Run: `npm test && npm run typecheck && npm run dev`

Deschide tabul „Hartă" în proiectul demo, în ambele teme. Verifică: poarta se distinge de casetă la o privire? Linia „azi" cade la locul potrivit? Muchiile punctate roșietice pleacă numai din obstacole deschise?

- [ ] **Step 8: Commit**

```bash
git add src/lib/mapLayout.ts src/lib/mapLayout.test.ts src/components/MapView.tsx src/components/ProjectDetail.tsx
git rm src/components/GraphView.tsx
git commit -m "feat(obstacole): harta, în locul grafului

Layout-ul iese în mapLayout.ts, pur și testat: aritmetica dintr-un JSX de
200 de linii nu se poate testa, iar exact ea decide dacă harta se citește.

GraphView era singurul ecran nemigrat la sistemul vizual — chenare de 1px pe
fiecare nod, două feDropShadow ca strălucire, fundaluri semantice pe card.
Poarta teșită nu se putea adăuga lângă ele fără ca ecranul să arate ca două
sisteme lipite.

Tabul se numește „Hartă\", nu „Graf\": „graf\" descrie desenul, „hartă\"
descrie întrebarea la care răspunde. Cheia rămâne graf, ca deep link-urile
existente să nu se rupă."
```

---

### Task 12: Bancul de probă, referința din aplicație, și verificarea finală

**Files:**
- Modify: `design/build-preview.py` (ecran nou „Hartă"; poarta pe ecranul „Ordine"; controalele noi pe „Controale")
- Regenerate: `design/preview.html`
- Modify: `src/components/InfoPanel.tsx`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Extinde bancul de probă**

În `design/build-preview.py`: adaugă un ecran „Hartă" cu DOM-ul real al lui `MapView` (o poartă deschisă, una cu ocolire, una depășită, două tichete, o muchie din fiecare ton, linia „azi"); adaugă poarta valului pe ecranul „Ordine" plus un card `.blocat`; pe ecranul „Controale" adaugă `.obst-row` (normal, hover, `.ok`), `.chip.blk`, `.card.blocat`, și butoanele `.seg` (apăsat și nu).

- [ ] **Step 2: Regenerează și verifică în ambele teme**

Run: `python3 design/build-preview.py`
Deschide `design/preview.html`. Treci prin toate cele cinci ecrane, **în ambele teme**. Verifică explicit fiecare control care și-a pierdut chenarul: are fundal? Se distinge de ce e sub el?

- [ ] **Step 3: Adaugă obstacolele în referința din aplicație**

În `src/components/InfoPanel.tsx`, o secțiune nouă care spune ce nu se vede din interfață:
- un obstacol nu are val și nu are layer — nu intră în calculul layerelor;
- un obstacol depășit rămâne pe hartă, tăiat;
- „blochează = nu" există: obstacolul se vede, dar nu stinge niciun tichet;
- „fără răspuns de N zile" se calculează de la prima trecere în „în așteptare";
- ocolire goală înseamnă „nu are ocolire", și de-aia colțul din dreapta-sus nu e retezat.

**Nu scrie un tabel de exemple de mână.** Dacă adaugi exemple, calculează-le la randare, ca tabelul de `parseDue`.

- [ ] **Step 4: Documentează în `CLAUDE.md`**

O secțiune nouă, „Obstacole — a doua axă de blocare", cu: ce e un obstacol și ce NU e (nu are val, nu are layer, `computeLayers` neatins); cele patru stări și de ce patru; `bypass !== null` ca sursă unică a colțului retezat; pasul de setup `npm run migrate supabase/migration-obstacles.sql`; și regula că `blockedBy` din `src/lib/obstacles.ts` e singura poartă prin care UI-ul află că un tichet e blocat.

- [ ] **Step 5: Verificarea finală, înainte de push**

Run: `npm test`
Expected: PASS, fără teste sărite

Run: `npm run typecheck`
Expected: fără erori

Run: `npm run build`
Expected: build reușit

`src/sw.ts`, `src/pwa.ts` și blocul VitePWA nu s-au atins, deci `npm run test:upgrade` nu e cerut. Confirmă cu `git diff --stat HEAD~11 -- src/sw.ts src/pwa.ts vite.config.ts` — trebuie să fie gol.

- [ ] **Step 6: Rulează migrarea în Supabase, dacă nu s-a rulat la Task 3**

Run: `npm run migrate supabase/migration-obstacles.sql`

**Ordinea contează:** migrarea înaintea pushului. Un push livrează cod care citește `obstacles`; dacă tabelul nu există, aplicația de pe telefon cade la încărcarea proiectului.

- [ ] **Step 7: Commit și push**

```bash
git add design/build-preview.py design/preview.html src/components/InfoPanel.tsx CLAUDE.md
git commit -m "docs(obstacole): bancul de probă, referința din aplicație, contextul

Bancul acoperă poarta teșită, cardul blocat și butoanele segmentate în
ambele teme — clasa de regresie „control rămas fără fundal ȘI fără chenar\"
trece typecheck-ul și testele, deci trebuie prinsă cu ochii."
git push origin master
```

**Pushul publică pe <https://horizontal-dyx.pages.dev>.** Confirmă că migrarea s-a rulat înainte.

---

## Self-Review

**Acoperirea specului:**

| secțiune din spec | task |
|---|---|
| Ce e un obstacol · patru forme | 1 (tipurile) |
| Cele patru stări | 1, 9 |
| Câmpul `blocking` | 1 (test), 9 (comutator) |
| Dependențe între obstacole | 1 (`openObstacles`, `detectObstacleCycle`), 4 (refuz la scriere) |
| Muncă → obstacol | 11 (muchia în hartă) |
| Ce NU se schimbă (`computeLayers`, `deriveState`) | 1 Step 6 (test de regresie) |
| Model de date · `obstacles` | 3 (migrare), 1 (tipuri) |
| `obstacle_issues`, `obstacle_deps` | 3 |
| `owner` text liber | 1 (comentariu), 3 (coloană), 9 (input, nu selector) |
| `evidence` | 1, 3, 9 |
| RLS pe modelul `migration-access.sql` | 3 |
| `openObstacles` / `blockedBy` / `waitingDays` / `detectObstacleCycle` | 1 |
| Poarta valului | 7 |
| Tichetul blocat păstrează layerul, se stinge, coboară | 5 (coborâre), 6 (stingere), 8 (clasa) |
| „se poate începe · 2 din 5" | 7 — **lipsea; adăugat mai jos** |
| Harta: poartă, ocolire, benzi, linia azi, muchii | 11 |
| Foaia obstacolului | 9 |
| „fără răspuns de N zile" calculat | 1, 9 |
| Foaia nu intră în panoul lateral | 9 Step 1 |
| Al treilea tab „Obstacole" din formularul tichetului, cu creare din titlu | 10 |
| Testare · fixtures MCP | 1, 2, 5, 11 |
| `design/preview.html` regenerat, ambele teme | 6 Step 4, 12 |
| Pași de setup | 3 Step 4, 12 Step 6 |

**Gol găsit și închis:** titlul layerului nu spunea câte tichete se pot începe. Se adaugă la **Task 7**, ca step suplimentar:

- [ ] **Task 7, Step 1b: Numărul „se poate începe" în titlul layerului**

În `src/components/OrdineView.tsx`, în `.layer-head`, subtitlul primului layer devine:

```tsx
const freeCount = g.ids.filter((id) => !blockedByObstacle[id]?.length).length
// …
<div className="sub">
  {ready ? 'Nu depinde de nimic din acest val' : `Depinde de layer ${g.L}`} ·{' '}
  {freeCount < g.ids.length ? `se poate începe · ${freeCount} din ${g.ids.length}` : `${g.ids.length} tichete`}
</div>
```

Numărul apare **doar** când ceva e blocat: pe un layer curat, „5 din 5" e zgomot care spune că există o problemă unde nu e.

**Placeholder scan:** fără „TBD"/„TODO". Task 4, 9, 10 și 11 descriu implementarea prin reguli plus tipare existente de urmat, nu prin cod complet — deliberat, fiindcă sunt fișiere de 300–700 de linii în care un bloc de cod scris pe orb ar contrazice tiparul local. Fiecare astfel de step numește fișierul, linia și tiparul exact de refolosit.

**Consistență de tipuri:** `Obstacle`, `ObstacleLink`, `ObstacleState`, `ObstacleEvidence`, `NewObstacle` — aceleași nume în Task 1, 2, 3, 4, 9. `blockedBy` (funcție pură, Task 1) vs `blockedByObstacle` (câmp derivat în store, Task 4) — nume diferite deliberat, ca să nu se confunde funcția cu rezultatul ei memoizat. `NODE_W`/`NODE_H` exportate o dată din `mapLayout.ts` și importate de test și componentă.
