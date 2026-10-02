# Aplicația Horizontal pentru Linux — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O aplicație Electron rezidentă pentru Linux/GNOME: Ctrl+Shift+A aduce o bară de captură gata de scris, fereastra principală e Horizontal complet, iar mementourile sună local cu butoanele „Gata" și „Amână 5 min".

**Architecture:** Cutia Electron (`desktop/`, propriul `package.json`) încarcă site-ul publicat; tot ce ține de sarcini rămâne cod al site-ului (`src/`), care detectează puntea `window.horizontalDesktop` și altfel se poartă exact ca azi. Site-ul primește o rută ușoară `/quick-add` (bara) și o componentă care trimite cutiei mementourile din următoarele 24 h; cutia ține timerele, sună prin D-Bus (`org.freedesktop.Notifications`) și întoarce acțiunile paginii, care le execută prin store — deci prin coada offline.

**Tech Stack:** Electron 44, TypeScript (compilat cu `tsc` în CommonJS pentru procesul principal), `dbus-next` 0.10, `electron-builder` 26 (țintă `dir`), React 18 + Vite (site), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-aplicatie-linux-design.md` (inclusiv „Rezultatul probei").

## Global Constraints

- Totul nou din cutie trăiește în `desktop/`, cu **propriul `package.json`**; Electron nu intră în build-ul site-ului.
- Fereastra încarcă `https://horizontal-dyx.pages.dev` (suprascriere doar prin `HORIZONTAL_URL`, pentru dezvoltare), nu un bundle împachetat.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Preload-ul expune doar `window.horizontalDesktop`, și doar dacă originea paginii e originea configurată.
- Navigarea spre alte origini se deschide în browserul sistemului.
- Scurtătura: **Ctrl+Shift+A** (`<Control><Shift>a`), scurtătură GNOME personalizată; `custom0` existent (`Alt+Shift+W`, Flameshot) nu se atinge.
- Serviciu D-Bus `ro.horizontal.App`, obiect `/ro/horizontal/App`, metode `QuickAdd`, `Show` (plus `Quit`, pentru instalator).
- Notificări: `org.freedesktop.Notifications.Notify` direct pe D-Bus, acțiuni „Gata" și „Amână 5 min", `urgency=2`, `resident=true`.
- Textul notificării vine din `planNotification` (`src/lib/pushPayload.ts`) — aceeași funcție ca pe web.
- Ratate la trezire: sună doar cele din **ultima oră** (`3_600_000` ms); cele mai vechi se sar.
- Fără tray, fără Flatpak/AppImage, fără auto-update al cutiei, fără Web Push în Electron.
- Serverul (`send-reminders`, pg_cron, `reminder-action`, trigger-ele) rămâne neatins.
- Bara (cerința omului, 2026-10-02): proiect, persoană, dată/oră, urgent — **scris** (`#proiect`, `@persoană`, `!`, data ca azi) **și din butoane**; butonul are ultimul cuvânt. Proiectul implicit: **„✅Daily"** (după nume), nu ultimul folosit. Fără dată în text: azi, ca adăugarea rapidă din „Azi".
- Bara: Enter salvează și ascunde; Esc sau pierderea focusului ascunde fără să salveze; la fiecare arătare câmpul e gol și focusat.
- Fereastra barei se creează o dată la pornire și se refolosește (`show()` + `focus()` + `webContents.focus()`), nu se recreează — rezultatul probei.
- Lucrul pe ramura `desktop`, nu pe `master`. Push pe `master` = producție (CLAUDE.md): doar cu acordul omului.
- Comentariile din cod: în română, explică DE CE, în stilul fișierelor vecine.

**Abatere asumată de la spec:** instalarea NU produce un `.rpm`. `electron-builder --linux dir` + copiere în `~/.local/opt/horizontal`: fără `sudo` la fiecare reinstalare și fără `fpm` (care pe Fedora cere `libxcrypt-compat`). Pentru om rezultatul e identic: lansator în meniu, pornire la login, scurtătura.

## Review Focus

1. **Pagina principală reîncărcată de un build nou** (`pwa.ts` aplică update-ul la revenire) retrimite lista întreagă de mementouri → un memento deja sunat NU sună a doua oară. Test în Task 7 (`fired` respectat).
2. **„Gata" pe o sarcină deja bifată în altă parte** (telefonul a bifat-o, cache-ul paginii încă nu știe) → nu o debifează. Azi `toggleDone` comută orb. Test în Task 1.
3. **Scurtătura apăsată fără sesiune** (prima pornire, sau după logout) → bara spune ce să faci, nu e albă și nu aruncă. Verificat în Task 9, Step 4: bara chemată ÎNAINTE de login (backendul local din `test:quick-add` n-are login, deci nu-l poate acoperi).
4. **Un semn care nu se potrivește** (`#zzz`, `@a` ambiguu) → nu alege nimic pe ghicite, rămâne în titlu și indiciul spune „nu știu #zzz". Teste în Task 4.
5. **Bara chemată de două ori la rând / cu text scris și Esc** → la următoarea arătare câmpul e gol; Enter pe câmp gol nu creează nimic. Test de browser în Task 6.
6. **Laptop adormit peste un memento** → la trezire sună doar dacă a trecut mai puțin de o oră; timerele Node nu numără timpul de somn, deci trezirea re-planifică de la zero. Teste în Task 7.

---

## Structura fișierelor

**Site (`src/`):**
- `src/lib/reminderAction.ts` (nou) — ce mutație cere o acțiune de memento („Gata", „Amână"), pur. Folosit de ascultătorul service worker-ului și de punte.
- `src/lib/desktopBridge.ts` (nou) — tipurile punții (`HorizontalDesktop`, `DesktopReminder`, `DesktopAction`), `getDesktopBridge()` și `upcomingReminders()` (pur).
- `src/components/DesktopBridge.tsx` (nou) — montat în `App`; trimite mementourile cutiei, execută acțiunile primite.
- `src/lib/captureTokens.ts` (nou) — `#proiect`, `@persoană`, `!` din text, pur (+ test).
- `src/components/QuickAdd.tsx` (modificat) — modul bogat (`rich`, `defaultProjectId`): semne + butoane.
- `src/QuickAddPage.tsx` (nou) — pagina barei de captură.
- `src/lib/deepLink.ts` (modificat) — `QUICK_ADD_PATH`, `isQuickAddPath`; `parseTicketPath` refuză `/quick-add`.
- `src/main.tsx` (modificat) — ramificarea timpurie pe `/quick-add`.
- `src/store.tsx` (modificat) — expune `dueIssues` în context.
- `src/App.tsx` (modificat) — ascultătorul SW folosește `reminderAction`; montează `<DesktopBridge />`.
- `src/styles.css` (modificat) — `.qab*`, pagina barei.
- `scripts/test-quick-add.mjs` (nou) + script `test:quick-add` în `package.json`.

**Cutia (`desktop/`):**
- `desktop/package.json`, `desktop/tsconfig.json`, `desktop/.gitignore`.
- `desktop/src/scheduler.ts` — planificatorul de mementouri, pur (+ `scheduler.test.ts`).
- `desktop/src/notify.ts` — notificările pe D-Bus.
- `desktop/src/dbusService.ts` — serviciul `ro.horizontal.App`.
- `desktop/src/main.ts` — procesul principal: ferestre, instanță unică, IPC, timere.
- `desktop/src/preload.ts` — puntea.
- `desktop/scripts/gsettings.mjs` — funcții pure pentru lista de scurtături GNOME (+ `gsettings.test.mjs`).
- `desktop/scripts/install.mjs`, `desktop/scripts/uninstall.mjs`.
- `desktop/scripts/notify-probe.mjs` — o notificare de test (verificare manuală a butoanelor).
- `CLAUDE.md` (modificat) — secțiunea „Aplicația de Linux".

---

### Task 0: Ramura și mediul

**Files:** niciunul.

- [ ] **Step 1: Worktree pe ramura `desktop`**

```bash
cd /home/q/01Proiecte/Horizontal
git worktree add .claude/worktrees/desktop -b desktop master
cd .claude/worktrees/desktop
ln -s ../../../.env .env
npm ci
```

- [ ] **Step 2: Linia de bază**

Run: `npm test && npm run typecheck`
Expected: PASS (709+ teste). Dacă nu trec pe `master`, oprește-te și raportează — nu porni pe o bază roșie.

---

### Task 1: Acțiunea de memento, o singură regulă

Azi ascultătorul din `src/App.tsx` (~linia 838) face `toggleDone(id)` la „Gata". `toggleDone` **comută**: dacă sarcina a fost bifată între timp în altă parte, „Gata" o debifează. Puntea desktop ar fi al doilea apelant al aceleiași reguli, deci regula devine o funcție pură, folosită de amândoi.

**Files:**
- Create: `src/lib/reminderAction.ts`
- Test: `src/lib/reminderAction.test.ts`
- Modify: `src/App.tsx` (ascultătorul `navigator.serviceWorker` `message`, ~838-854)

**Interfaces:**
- Produces: `reminderMutation(action: 'done' | 'snooze', issue: Pick<Issue, 'done'> | undefined, now: Date): ReminderMutation`, cu `type ReminderMutation = { kind: 'toggle' } | { kind: 'patch'; patch: { remindAt: string } } | { kind: 'none' }`.

- [ ] **Step 1: Testul care pică**

```ts
// src/lib/reminderAction.test.ts
import { describe, expect, it } from 'vitest'
import { reminderMutation } from './reminderAction'
import { SNOOZE_MINUTES } from './pushPayload'

const now = new Date('2026-10-02T10:00:00.000Z')

describe('reminderMutation', () => {
  it('„Gata" pe o sarcină nebifată o bifează', () => {
    expect(reminderMutation('done', { done: false }, now)).toEqual({ kind: 'toggle' })
  })
  it('„Gata" pe o sarcină deja bifată în altă parte nu o debifează', () => {
    expect(reminderMutation('done', { done: true }, now)).toEqual({ kind: 'none' })
  })
  it('„Gata" pe o sarcină necunoscută încă (nu e în cache) comută, ca înainte', () => {
    expect(reminderMutation('done', undefined, now)).toEqual({ kind: 'toggle' })
  })
  it('„Amână" mută mementoul, nu scadența', () => {
    expect(reminderMutation('snooze', { done: false }, now)).toEqual({
      kind: 'patch',
      patch: { remindAt: new Date(now.getTime() + SNOOZE_MINUTES * 60_000).toISOString() },
    })
  })
})
```

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/lib/reminderAction.test.ts`
Expected: FAIL — `Failed to resolve import "./reminderAction"`.

- [ ] **Step 3: Implementarea**

```ts
// src/lib/reminderAction.ts
import type { Issue } from './types'
import { SNOOZE_MINUTES } from './pushPayload'

export type ReminderMutation =
  | { kind: 'toggle' }
  | { kind: 'patch'; patch: { remindAt: string } }
  | { kind: 'none' }

/**
 * Ce face un buton al notificării, indiferent cine l-a primit (service
 * worker-ul pe web, cutia pe desktop). „Gata" nu comută orb: o sarcină bifată
 * între timp pe telefon ar fi fost DEbifată de un click pe o notificare veche.
 * Necunoscută (nu e în cache) — comută, ca înainte: n-avem cum s-o știm bifată.
 * Amânarea mută mementoul, nu scadența; aceeași constantă o folosesc eticheta
 * butonului și `supabase/functions/reminder-action`.
 */
export function reminderMutation(action: 'done' | 'snooze', issue: Pick<Issue, 'done'> | undefined, now: Date): ReminderMutation {
  if (action === 'done') return issue?.done ? { kind: 'none' } : { kind: 'toggle' }
  return { kind: 'patch', patch: { remindAt: new Date(now.getTime() + SNOOZE_MINUTES * 60_000).toISOString() } }
}
```

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/lib/reminderAction.test.ts`
Expected: PASS, 4 teste.

- [ ] **Step 5: Ascultătorul din `App.tsx` folosește regula**

În `src/App.tsx`, în efectul cu `navigator.serviceWorker.addEventListener('message', …)`, înlocuiește:

```ts
      const { action, id } = e.data
      if (action === 'done') void toggleDone(id)
      // Amânarea mută mementoul, nu scadența: sarcina rămâne când era, doar
      // sună din nou peste `SNOOZE_MINUTES` minute. Aceeași constantă o folosesc
      // eticheta butonului și `supabase/functions/reminder-action`.
      else void updateIssue(id, { remindAt: new Date(Date.now() + SNOOZE_MINUTES * 60_000).toISOString() })
```

cu:

```ts
      const { action, id } = e.data
      const m = reminderMutation(action, byIdRef.current[id], new Date())
      if (m.kind === 'toggle') void toggleDone(id)
      else if (m.kind === 'patch') void updateIssue(id, m.patch)
```

Componenta are nevoie de `byId` din `useHorizontal()` (e deja în context, `byId: Record<string, Issue>`). Ca efectul să nu se reabboneze la fiecare schimbare de date, ține-l într-un ref lângă celelalte hook-uri ale componentei:

```ts
  const byIdRef = useRef(byId)
  byIdRef.current = byId
```

Importă `reminderMutation` din `./lib/reminderAction`. Dacă `SNOOZE_MINUTES` nu mai e folosit în `App.tsx`, scoate-l din import (typecheck-ul nu se plânge de importuri nefolosite — `grep -n SNOOZE_MINUTES src/App.tsx` ca să verifici).

- [ ] **Step 6: Verificare și commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src/lib/reminderAction.ts src/lib/reminderAction.test.ts src/App.tsx
git commit -m "fix(memento): „Gata" nu mai debifează o sarcină bifată între timp în altă parte"
```

---

### Task 2: Ce mementouri urmează, ca funcție pură

**Files:**
- Create: `src/lib/desktopBridge.ts`
- Test: `src/lib/desktopBridge.test.ts`

**Interfaces:**
- Consumes: `planNotification(p: ReminderPayload): NotificationPlan` din `src/lib/pushPayload.ts` (`ReminderPayload = { id, title, dueAt?, allDay?, projectName?, actionToken?, actionUrl? }`, plan cu `title`, `body`).
- Produces:
  - `interface DesktopReminder { key: string; id: string; at: string; title: string; body: string }` — `key = \`${id}@${at}\``, `at` = ISO.
  - `type DesktopAction = { action: 'done' | 'snooze' | 'open'; id: string }`
  - `interface HorizontalDesktop { version: string; setReminders(list: DesktopReminder[]): void; onReminderAction(fn: (a: DesktopAction) => void): () => void; hideBar(): void }`
  - `getDesktopBridge(): HorizontalDesktop | null`
  - `upcomingReminders(issues: Issue[], projects: Pick<Project, 'id' | 'name'>[], now: Date): DesktopReminder[]`
  - constantele `REMINDER_LOOKBACK_MS = 3_600_000`, `REMINDER_HORIZON_MS = 24 * 3_600_000`.

- [ ] **Step 1: Testul care pică**

```ts
// src/lib/desktopBridge.test.ts
import { describe, expect, it } from 'vitest'
import { upcomingReminders } from './desktopBridge'
import type { Issue } from './types'

const now = new Date('2026-10-02T10:00:00.000Z')
const base: Issue = {
  id: 'HZ-1', projectId: 'p1', title: 'Sună la bancă', desc: '', theme: '', wave: 1, deps: [], done: false,
  selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-10-01T00:00:00.000Z',
  urgent: false, dueAt: '2026-10-02T12:00:00.000Z', allDay: false, remindAt: '2026-10-02T12:00:00.000Z', rrule: null,
}
const projects = [{ id: 'p1', name: 'Personal' }]
const at = (iso: string): Issue => ({ ...base, remindAt: iso })

describe('upcomingReminders', () => {
  it('un memento în următoarele 24 h intră, cu textul de pe web', () => {
    const [r] = upcomingReminders([base], projects, now)
    expect(r.id).toBe('HZ-1')
    expect(r.at).toBe('2026-10-02T12:00:00.000Z')
    expect(r.key).toBe('HZ-1@2026-10-02T12:00:00.000Z')
    expect(r.title).toBe('Sună la bancă')
    expect(r.body).toContain('Personal')
  })
  it('unul trecut de mai puțin de o oră intră (poate n-a sunat încă)', () => {
    expect(upcomingReminders([at('2026-10-02T09:30:00.000Z')], projects, now)).toHaveLength(1)
  })
  it('unul trecut de peste o oră nu intră', () => {
    expect(upcomingReminders([at('2026-10-02T08:59:00.000Z')], projects, now)).toHaveLength(0)
  })
  it('unul peste mai mult de 24 h nu intră încă', () => {
    expect(upcomingReminders([at('2026-10-03T10:01:00.000Z')], projects, now)).toHaveLength(0)
  })
  it('o sarcină bifată sau fără memento nu intră', () => {
    expect(upcomingReminders([{ ...base, done: true }, { ...base, id: 'HZ-2', remindAt: null }], projects, now)).toHaveLength(0)
  })
  it('aceeași sarcină venită de două ori (dueIssues + proiect) dă un singur memento', () => {
    expect(upcomingReminders([base, { ...base }], projects, now)).toHaveLength(1)
  })
  it('sortate după oră', () => {
    const list = upcomingReminders([{ ...base, id: 'HZ-2', remindAt: '2026-10-02T15:00:00.000Z' }, base], projects, now)
    expect(list.map((r) => r.id)).toEqual(['HZ-1', 'HZ-2'])
  })
})
```

Dacă tipul `Issue` din `src/lib/types.ts` are câmpuri obligatorii în plus față de `base`, adaugă-le în `base` cu valori neutre — nu schimba tipul.

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/lib/desktopBridge.test.ts`
Expected: FAIL — `Failed to resolve import "./desktopBridge"`.

- [ ] **Step 3: Implementarea**

```ts
// src/lib/desktopBridge.ts
import type { Issue, Project } from './types'
import { planNotification } from './pushPayload'

/**
 * Contractul cu aplicația de Linux (`desktop/`). Cutia Electron injectează
 * `window.horizontalDesktop` din preload, și numai pe originea ei; în browser
 * puntea lipsește și site-ul se poartă exact ca azi. Schimbă tipurile de aici
 * doar împreună cu `desktop/src/preload.ts` — e același contract, scris de două ori.
 */
export interface DesktopReminder {
  /** `${id}@${at}` — un memento amânat e ALT memento (altă cheie), nu același mutat. */
  key: string
  id: string
  /** ISO. */
  at: string
  title: string
  body: string
}

export type DesktopAction = { action: 'done' | 'snooze' | 'open'; id: string }

export interface HorizontalDesktop {
  version: string
  setReminders(list: DesktopReminder[]): void
  onReminderAction(fn: (a: DesktopAction) => void): () => void
  hideBar(): void
}

export function getDesktopBridge(): HorizontalDesktop | null {
  return (window as unknown as { horizontalDesktop?: HorizontalDesktop }).horizontalDesktop ?? null
}

/** Cât de vechi poate fi un memento ca să mai sune: aceeași regulă ca `TTL: 3600` la push. */
export const REMINDER_LOOKBACK_MS = 3_600_000
/** Cât în față planifică cutia. Pagina retrimite lista periodic, deci fereastra alunecă. */
export const REMINDER_HORIZON_MS = 24 * 3_600_000

/**
 * Mementourile pe care cutia trebuie să le țină, din ce știe pagina acum
 * (cache-ul offline inclus). Textul vine din `planNotification`, ca notificarea
 * de pe desktop să spună exact ce spune cea de pe telefon.
 */
export function upcomingReminders(issues: Issue[], projects: Pick<Project, 'id' | 'name'>[], now: Date): DesktopReminder[] {
  const from = now.getTime() - REMINDER_LOOKBACK_MS
  const to = now.getTime() + REMINDER_HORIZON_MS
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const seen = new Set<string>()
  const out: DesktopReminder[] = []
  for (const i of issues) {
    if (i.done || !i.remindAt || seen.has(i.id)) continue
    const t = Date.parse(i.remindAt)
    if (!Number.isFinite(t) || t < from || t > to) continue
    seen.add(i.id)
    const at = new Date(t).toISOString()
    const plan = planNotification({ id: i.id, title: i.title, dueAt: i.dueAt, allDay: i.allDay, projectName: names.get(i.projectId) })
    out.push({ key: `${i.id}@${at}`, id: i.id, at, title: plan.title, body: plan.body })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}
```

Verifică tipurile lui `ReminderPayload`: dacă `dueAt` e `string | undefined` (nu `| null`), trimite `dueAt: i.dueAt ?? undefined`; la fel `projectName`.

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/lib/desktopBridge.test.ts && npm run typecheck`
Expected: PASS, 7 teste; typecheck curat.

- [ ] **Step 5: Commit**

```bash
git add src/lib/desktopBridge.ts src/lib/desktopBridge.test.ts
git commit -m "feat(desktop): contractul punții și mementourile din următoarele 24 h"
```

---

### Task 3: Pagina vorbește cu cutia

**Files:**
- Modify: `src/store.tsx` (interfața contextului ~linia 76, valoarea ~1039)
- Create: `src/components/DesktopBridge.tsx`
- Modify: `src/App.tsx` (montarea lângă `<SyncBridge />`, în ramura cu `HorizontalProvider > UIProvider`)

**Interfaces:**
- Consumes: `getDesktopBridge`, `upcomingReminders`, `DesktopAction` (Task 2); `reminderMutation` (Task 1); din store: `dueIssues`, `allIssues`/`issues`, `projects`, `byId`, `toggleDone`, `updateIssue`.
- Produces: `dueIssues: Issue[]` în contextul store-ului; `<DesktopBridge />` care nu randează nimic.

- [ ] **Step 1: `dueIssues` în context**

În `src/store.tsx`: `dueIssues` există deja (`const dueIssues = useMemo(…)`, ~linia 519), dar nu e expus. Adaugă în interfața contextului (lângă `smartLists`):

```ts
  /** Sarcinile cu scadență din fereastra listelor inteligente (cache inclus) — sursa mementourilor de pe desktop. */
  dueIssues: Issue[]
```

și în obiectul valorii, lângă `smartLists,`: `dueIssues,`.

- [ ] **Step 2: Componenta**

```tsx
// src/components/DesktopBridge.tsx
import { useEffect, useRef } from 'react'
import { useHorizontal } from '../store'
import { getDesktopBridge, upcomingReminders } from '../lib/desktopBridge'
import { reminderMutation } from '../lib/reminderAction'

/** Cât de des se retrimite lista chiar fără nicio schimbare: fereastra de 24 h alunecă. */
const RESEND_MS = 15 * 60_000

/**
 * Puntea către aplicația de Linux. Fără `window.horizontalDesktop` (browser,
 * telefon) nu face nimic. Pagina e cea care ȘTIE ce urmează (store + cache
 * offline); cutia e cea care SUNĂ — timerele din pagină ar fi sugrumate de
 * Chromium cât fereastra stă ascunsă, de-aia stau în procesul principal.
 */
export function DesktopBridge() {
  const { dueIssues, issues, projects, byId, toggleDone, updateIssue } = useHorizontal()
  const bridge = getDesktopBridge()
  const lastSent = useRef('')
  const byIdRef = useRef(byId)
  byIdRef.current = byId
  const dueRef = useRef(dueIssues)
  dueRef.current = dueIssues

  useEffect(() => {
    if (!bridge) return
    const send = () => {
      const list = upcomingReminders([...dueIssues, ...issues], projects, new Date())
      const json = JSON.stringify(list)
      if (json === lastSent.current) return
      lastSent.current = json
      bridge.setReminders(list)
    }
    send()
    const t = setInterval(send, RESEND_MS)
    return () => clearInterval(t)
  }, [bridge, dueIssues, issues, projects])

  useEffect(() => {
    if (!bridge) return
    return bridge.onReminderAction(({ action, id }) => {
      // Click pe corpul notificării: același drum ca un deep link, prin
      // `popstate`-ul din App.tsx — nu un al doilea mod de a deschide un tichet.
      if (action === 'open') {
        history.pushState(null, '', `/${id}`)
        window.dispatchEvent(new PopStateEvent('popstate'))
        return
      }
      const issue = byIdRef.current[id] ?? dueRef.current.find((i) => i.id === id)
      const m = reminderMutation(action, issue, new Date())
      if (m.kind === 'toggle') void toggleDone(id)
      else if (m.kind === 'patch') void updateIssue(id, m.patch)
    })
  }, [bridge, toggleDone, updateIssue])

  return null
}
```

Verifică numele exacte în contextul store-ului: `grep -n "^  issues\b\|^  issues:" src/store.tsx` — dacă lista tichetelor proiectului curent se numește altfel (`issues` vs `allIssues`), folosește ce expune contextul. `upcomingReminders` deduplică pe `id`, deci suprapunerea celor două liste e inofensivă.

- [ ] **Step 3: Montarea**

În `src/App.tsx`, unde se randează `<SyncBridge />` (în interiorul `HorizontalProvider` și `UIProvider`), adaugă imediat după el `<DesktopBridge />`, cu importul `import { DesktopBridge } from './components/DesktopBridge'`. `UIProvider` nu e necesar componentei, dar locul acesta garantează că store-ul e montat.

- [ ] **Step 4: Verificare și commit**

Run: `npm test && npm run typecheck && npm run test:nav`
Expected: PASS. (`test:nav`: fără punte componenta nu face nimic, dar s-a atins `App.tsx`.)

```bash
git add src/store.tsx src/components/DesktopBridge.tsx src/App.tsx
git commit -m "feat(desktop): pagina trimite mementourile cutiei și execută butoanele notificării"
```

---

### Task 4: Semnele din bară — `#proiect`, `@persoană`, `!`

Cerința omului (2026-10-02): din bară se aleg proiectul, cui îi e pasată sarcina, data/ora și urgența — **scris și cu butoane**. Partea scrisă e un parser pur, ca `parseDue`: în text, `#Daily` alege proiectul, `@Alex` persoana, un `!` singur marchează urgent. Data rămâne treaba lui `parseDue`/`useTitleDate`, neatinsă.

**Files:**
- Create: `src/lib/captureTokens.ts`
- Test: `src/lib/captureTokens.test.ts`

**Interfaces:**
- Produces:
  - `normalizeName(s: string): string` — fără diacritice, emoji, spații și semne; litere mici („✅Daily" → `daily`, „Racovița" → `racovita`).
  - `interface CaptureTokens { title: string; projectId: string | null; assigneeId: string | null; urgent: boolean; unknown: string[] }`
  - `parseCaptureTokens(raw: string, projects: Pick<Project, 'id' | 'name' | 'prefix'>[], assignees: Pick<Assignee, 'id' | 'name'>[]): CaptureTokens`
  - `dailyProjectId(projects: Pick<Project, 'id' | 'name'>[]): string | null` — proiectul al cărui nume normalizat e `daily`.

- [ ] **Step 1: Testele care pică**

```ts
// src/lib/captureTokens.test.ts
import { describe, expect, it } from 'vitest'
import { dailyProjectId, normalizeName, parseCaptureTokens } from './captureTokens'

const projects = [
  { id: 'd', name: '✅Daily', prefix: 'D' },
  { id: 'kata', name: 'Katalist', prefix: 'KATA' },
  { id: 'nk', name: 'Neveon-kata testare', prefix: 'NK' },
  { id: 'pg', name: 'Predare GDPR', prefix: 'PG' },
  { id: 'gdpr', name: 'GDPR', prefix: 'GDPR' },
  { id: 'r', name: 'Racovița', prefix: 'R' },
]
const assignees = [
  { id: 'a1', name: 'Alex Popescu' },
  { id: 'a2', name: 'Andrei' },
  { id: 'b1', name: 'Bogdan' },
]
const parse = (t: string) => parseCaptureTokens(t, projects, assignees)

describe('normalizeName', () => {
  it('scoate emoji, diacritice, spații', () => {
    expect(normalizeName('✅Daily')).toBe('daily')
    expect(normalizeName('Racovița')).toBe('racovita')
    expect(normalizeName('Predare GDPR')).toBe('predaregdpr')
  })
})

describe('parseCaptureTokens', () => {
  it('fără semne: titlul rămâne, nimic ales', () => {
    expect(parse('sună la bancă')).toEqual({ title: 'sună la bancă', projectId: null, assigneeId: null, urgent: false, unknown: [] })
  })
  it('#proiect după nume, fără emoji și fără diacritice', () => {
    expect(parse('sună #daily la bancă').projectId).toBe('d')
    expect(parse('sună #racovita').projectId).toBe('r')
    expect(parse('sună #daily la bancă').title).toBe('sună la bancă')
  })
  it('#proiect după prefix', () => {
    expect(parse('test #NK').projectId).toBe('nk')
  })
  it('numele exact bate începutul altui nume (#gdpr ≠ Predare GDPR)', () => {
    expect(parse('x #gdpr').projectId).toBe('gdpr')
  })
  it('un început de nume unic e de ajuns; unul ambiguu nu alege nimic', () => {
    expect(parse('x #kat').projectId).toBe('kata')
    expect(parse('x #ne').projectId).toBe('nk')
    expect(parse('x #zzz')).toMatchObject({ projectId: null, unknown: ['#zzz'], title: 'x #zzz' })
  })
  it('@persoană după prenume sau început unic', () => {
    expect(parse('raport @alex').assigneeId).toBe('a1')
    expect(parse('raport @bog').assigneeId).toBe('b1')
    expect(parse('raport @a')).toMatchObject({ assigneeId: null, unknown: ['@a'] })
  })
  it('un ! singur e urgent; un ! lipit de cuvânt e punctuație', () => {
    expect(parse('sună acum !')).toMatchObject({ urgent: true, title: 'sună acum' })
    expect(parse('! sună')).toMatchObject({ urgent: true, title: 'sună' })
    expect(parse('sună acum!')).toMatchObject({ urgent: false, title: 'sună acum!' })
  })
  it('toate deodată', () => {
    expect(parse('sună la bancă #daily @alex !')).toEqual({ title: 'sună la bancă', projectId: 'd', assigneeId: 'a1', urgent: true, unknown: [] })
  })
  it('primul semn de un fel câștigă; al doilea rămâne text', () => {
    expect(parse('x #daily #kata')).toMatchObject({ projectId: 'd', title: 'x #kata' })
  })
  it('un email sau un # din mijlocul cuvântului nu e semn', () => {
    expect(parse('scrie lui ion@firma.ro despre C#')).toMatchObject({ assigneeId: null, projectId: null, title: 'scrie lui ion@firma.ro despre C#' })
  })
})

describe('dailyProjectId', () => {
  it('găsește „✅Daily" după nume', () => {
    expect(dailyProjectId(projects)).toBe('d')
    expect(dailyProjectId([{ id: 'x', name: 'Altceva' }])).toBeNull()
  })
})
```

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/lib/captureTokens.test.ts`
Expected: FAIL — `Failed to resolve import "./captureTokens"`.

- [ ] **Step 3: Implementarea**

```ts
// src/lib/captureTokens.ts
import type { Assignee, Project } from './types'

/**
 * Semnele barei de captură: `#proiect`, `@persoană`, `!` (urgent). Pur, ca
 * `parseDue` — data rămâne a lui; aici se citește doar ce nu e dată. Un semn
 * se recunoaște numai la început de cuvânt (`ion@firma.ro`, `C#` rămân text),
 * iar unul care nu se potrivește cu nimic RĂMÂNE în titlu și e raportat în
 * `unknown`: mai bine un titlu cu „#zzz" decât o sarcină pusă în alt proiect.
 */
export interface CaptureTokens {
  title: string
  projectId: string | null
  assigneeId: string | null
  urgent: boolean
  unknown: string[]
}

export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Potrivirea, în ordinea încrederii: exact, apoi un singur candidat care începe așa. */
function pick<T extends { id: string }>(key: string, items: T[], exact: (t: T) => string[], starts: (t: T) => string[]): T | null {
  if (!key) return null
  const hit = items.find((t) => exact(t).includes(key))
  if (hit) return hit
  const cands = items.filter((t) => starts(t).some((n) => n.startsWith(key)))
  return cands.length === 1 ? cands[0] : null
}

const TOKEN = /(^|\s)(?:([#@])([^\s#@!]+)|!(?=\s|$))/g

export function parseCaptureTokens(
  raw: string,
  projects: Pick<Project, 'id' | 'name' | 'prefix'>[],
  assignees: Pick<Assignee, 'id' | 'name'>[],
): CaptureTokens {
  let projectId: string | null = null
  let assigneeId: string | null = null
  let urgent = false
  const unknown: string[] = []
  const cut: [number, number][] = []
  for (const m of raw.matchAll(TOKEN)) {
    const start = m.index! + m[1].length
    const end = m.index! + m[0].length
    if (!m[2]) { if (!urgent) { urgent = true; cut.push([start, end]) } continue }
    const key = normalizeName(m[3])
    if (m[2] === '#') {
      if (projectId !== null) continue
      const p = pick(key, projects, (x) => [normalizeName(x.name), normalizeName(x.prefix)], (x) => [normalizeName(x.name)])
      if (p) { projectId = p.id; cut.push([start, end]) } else unknown.push(raw.slice(start, end))
    } else {
      if (assigneeId !== null) continue
      const words = (x: { name: string }) => x.name.split(/\s+/).map(normalizeName).filter(Boolean)
      const a = pick(key, assignees, (x) => [normalizeName(x.name), ...words(x)], (x) => [normalizeName(x.name), ...words(x)])
      if (a) { assigneeId = a.id; cut.push([start, end]) } else unknown.push(raw.slice(start, end))
    }
  }
  let title = ''
  let at = 0
  for (const [s, e] of cut) { title += raw.slice(at, s); at = e }
  title += raw.slice(at)
  return { title: title.replace(/\s+/g, ' ').trim(), projectId, assigneeId, urgent, unknown }
}

/** Proiectul implicit al barei, ales de om: „✅Daily". După nume, ca să nu țină de un id. */
export function dailyProjectId(projects: Pick<Project, 'id' | 'name'>[]): string | null {
  return projects.find((p) => normalizeName(p.name) === 'daily')?.id ?? null
}
```

Atenție la testul „un început de nume unic… `#ne` → nk": `ne` e începutul lui `neveonkatatestare` și al niciunui alt nume — trece. Dacă vreun test pică din cauza ordinii regulilor, schimbă implementarea, nu testul: testele sunt cerința.

- [ ] **Step 4: Rulează, trebuie să treacă**

Run: `npx vitest run src/lib/captureTokens.test.ts && npm run typecheck`
Expected: PASS, toate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/captureTokens.ts src/lib/captureTokens.test.ts
git commit -m "feat(captură): #proiect, @persoană și ! în textul sarcinii, ca parser pur"
```

---

### Task 5: `QuickAdd` în modul bogat — semnele plus butoanele

Bara refolosește `QuickAdd` (aceeași recunoaștere a datei, cu oglinda și refuzul pe fragment), cu două proprietăți noi, opționale: fără ele componenta se poartă **exact** ca azi în „Azi"/„Mâine".

Regula de prioritate, una singură, pentru proiect, persoană, dată și urgență: **butonul are ultimul cuvânt** (o alegere explicită e o corectură), apoi semnul din text, apoi valoarea implicită (proiectul „Daily", fără persoană = al creatorului, data din text sau azi, neurgent). Un semn necunoscut (`#zzz`) rămâne în titlu și e semnalat în indiciu.

**Files:**
- Modify: `src/components/QuickAdd.tsx`
- Modify: `src/styles.css` (`.qa-rich`, `.qa-who`, `.qa-when`, `.qa-urgent`)

**Interfaces:**
- Consumes: `parseCaptureTokens`, `CaptureTokens` (Task 4); din store `assignees: Assignee[]`; `fromInputs(date, time)`, `toDateInput(iso)`, `toTimeInput(iso)` din `src/lib/schedule.ts`; iconițele `people`, `urgent`, `due` din `Icon.tsx`.
- Produces: props noi pe `QuickAdd`: `defaultProjectId?: string`, `rich?: boolean`.

- [ ] **Step 1: Props și starea**

În `interface Props` adaugă:

```ts
  /** Proiectul cu care pornește, peste cel ținut minte (bara de captură: „Daily"). */
  defaultProjectId?: string
  /** Bara de captură: semnele `#proiect`, `@persoană`, `!` în text și rândul de butoane, mereu vizibil. */
  rich?: boolean
```

Semnătura devine `QuickAdd({ defaultDueAt, onAdded, focusSignal = 0, defaultProjectId, rich = false }: Props)`.

- `const { createIssue, assignees } = useHorizontal()`
- inițializarea lui `projectId`: `defaultProjectId ?? localStorage.getItem(LAST_PROJECT_KEY) ?? ''`
- o stare nouă pentru alegerile prin butoane (lipsa cheii = „n-a atins butonul"):

```ts
  // Ce a ales omul din butoane. Lipsa cheii = n-a atins butonul; `assigneeId:
  // null` = a ales explicit „al meu". Butonul bate semnul din text: e corectura.
  const [manual, setManual] = useState<{ projectId?: string; assigneeId?: string | null; urgent?: boolean; due?: { dueAt: string | null; allDay: boolean } }>({})
```

- [ ] **Step 2: Valorile efective**

Înlocuiește blocul care calculează `project`, `dueAt`, `allDay`, `title` cu:

```ts
  const tokens = rich ? parseCaptureTokens(date.title, projects, assignees) : null
  const effectiveProjectId = manual.projectId ?? tokens?.projectId ?? projectId
  const project = projects.find((p) => p.id === effectiveProjectId)
    ?? projects.find((p) => p.type === 'personal')
    ?? projects[0]
```

(`project` se folosește mai jos, la `if (!project)` — ordinea rămâne: întâi `parsed`/`useParsed`, apoi restul.)

```ts
  const dueAt = manual.due ? manual.due.dueAt : useParsed ? parsed.dueAt! : defaultDueAt
  const allDay = manual.due ? manual.due.allDay : useParsed ? parsed.allDay : true
  const title = (tokens ? tokens.title : date.title).trim()
  const assigneeId = manual.assigneeId !== undefined ? manual.assigneeId : tokens?.assigneeId ?? null
  const urgent = manual.urgent ?? tokens?.urgent ?? false
```

`dueLabel(dueAt, allDay, …)` primește acum un `dueAt` care poate fi `null` (omul a golit data din buton): randează chip-ul de dată doar când `dueAt` nu e `null` (`{dueAt && (<span className="chip date">…)}`).

`reset` golește și alegerile: `const reset = () => { setText(''); date.reset(); setTip(false); setManual({}) }`.

- [ ] **Step 3: Salvarea**

În `submit`, apelul devine:

```ts
      await createIssue({
        projectId: project.id,
        title,
        dueAt,
        allDay,
        remindAt: reminderAt(dueAt, defaultReminder(allDay)),
        rrule: useParsed && !manual.due ? parsed.rrule : null,
        // Doar din bară: în „Azi" rândul nu are cum să le aleagă, iar un
        // `assigneeId: null` explicit e tot „al creatorului".
        ...(rich ? { assigneeId, urgent } : {}),
      })
```

(O dată aleasă din buton anulează recurența din text: butonul a înlocuit data, iar „în fiecare luni" făcea parte din ea.)

- [ ] **Step 4: Rândul de butoane**

În JSX:
- în rândul `qa-meta` existent, `<label className="qa-proj">…</label>` se randează doar când `!rich` (în modul bogat proiectul e în rândul nou);
- în indiciu, când `tokens?.unknown.length`, textul devine `nu știu ${tokens.unknown.join(', ')}` cu clasa `warn` (înaintea ramurii `bare`);
- după `qa-meta`, încă în `<form>`:

```tsx
      {rich && (
        <div className="qa-meta qa-rich">
          <label className="qa-proj" title="Proiectul sarcinii (sau #nume în text)">
            <span className="t-dot" style={{ background: project.accent }} />
            <select value={project.id} onChange={(e) => setManual((m) => ({ ...m, projectId: e.target.value }))}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="qa-who" title="Cui îi pasezi sarcina (sau @nume în text)">
            <Icon name="people" size={13} />
            <select value={assigneeId ?? ''} onChange={(e) => setManual((m) => ({ ...m, assigneeId: e.target.value || null }))}>
              <option value="">al meu</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <span className="qa-when" title="Data și ora (sau „mâine la 10" în text)">
            <Icon name="due" size={13} />
            <input
              type="date"
              value={dueAt ? toDateInput(dueAt) : ''}
              onChange={(e) => setManual((m) => ({ ...m, due: fromInputs(e.target.value, dueAt && !allDay ? toTimeInput(dueAt) : '') }))}
            />
            <input
              type="time"
              value={dueAt && !allDay ? toTimeInput(dueAt) : ''}
              onChange={(e) => setManual((m) => ({ ...m, due: fromInputs(dueAt ? toDateInput(dueAt) : toDateInput(defaultDueAt), e.target.value) }))}
            />
          </span>
          <button
            type="button"
            className={`qa-urgent ${urgent ? 'on' : ''}`}
            aria-pressed={urgent}
            title="Urgent (sau ! în text)"
            onClick={() => setManual((m) => ({ ...m, urgent: !urgent }))}
          >
            <Icon name="urgent" size={13} /> urgent
          </button>
        </div>
      )}
```

Butoanele din `<form>` sunt `type="button"`, iar `<select>`/`<input>` nu trimit formularul la schimbare — Enter rămâne pe câmpul de titlu (`onKeyDown` existent). Verifică `toDateInput`/`toTimeInput` (`src/lib/schedule.ts:163,169`): primesc ISO și întorc `aaaa-ll-zz` / `hh:mm`, formatele inputurilor native.

Importuri noi: `parseCaptureTokens` din `../lib/captureTokens`; `fromInputs`, `toDateInput`, `toTimeInput` din `../lib/schedule` (lângă `reminderAt`, `defaultReminder` deja importate).

- [ ] **Step 5: Stilul**

Lângă regulile `.qa-proj` din `src/styles.css` (~5083-5251), urmând cele cinci reguli din CLAUDE.md („Sistemul vizual": fără chenar decorativ, mono pe cifre, un singur accent, starea activă = text plin plus linie de 2px, nu casetă umplută):

```css
/* Rândul de butoane al barei de captură. Același limbaj ca .qa-proj: fără
   chenar, fundal --surface-2, raza de buton. Activ = text plin + linie de 2px. */
.qa-rich { flex-wrap: wrap; gap: 6px; }
.qa-who, .qa-when, .qa-urgent { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--r-s); background: var(--surface-2); color: var(--txt-dim); font: inherit; font-size: 12px; }
.qa-who select, .qa-when input { border: 0; background: transparent; color: inherit; font: inherit; }
.qa-when input { font-family: var(--mono); }
.qa-urgent { border: 0; cursor: pointer; }
.qa-urgent.on { color: var(--blocked); box-shadow: inset 0 -2px 0 var(--blocked); }
```

Excepția de la „fără linii" pentru câmpuri (CLAUDE.md, regula 1) nu se aplică aici: inputurile de dată/oră stau într-un jeton care ESTE delimitarea.

- [ ] **Step 6: Verificare și commit**

Run: `npm test && npm run typecheck && npm run test:nav && npm run test:layout`
Expected: PASS — fără `rich`, „Azi"/„Mâine" se comportă ca înainte (test:nav acoperă adăugarea rapidă din „Azi").

```bash
git add src/components/QuickAdd.tsx src/styles.css
git commit -m "feat(captură): adăugarea rapidă știe proiect, persoană, dată, oră și urgent — scris și din butoane"
```

---

### Task 6: Ruta `/quick-add` — bara de captură

`parseTicketPath` (`src/lib/deepLink.ts`) acceptă azi `/quick-add` drept tichetul `QUICK-ADD`; iar `settleUrl` din `App.tsx` ar rescrie calea. De-aia ramificarea se face în `src/main.tsx`, înainte de `App`.

**Files:**
- Modify: `src/lib/deepLink.ts`, `src/lib/deepLink.test.ts`
- Create: `src/QuickAddPage.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css` (la final)
- Create: `scripts/test-quick-add.mjs`; Modify: `package.json` (script `test:quick-add`)

**Interfaces:**
- Consumes: `getDesktopBridge` (Task 2); `dailyProjectId` (Task 4); `QuickAdd` cu props `{ defaultDueAt: string; onAdded?(): void; focusSignal?: number; defaultProjectId?: string; rich?: boolean }` (Task 5); `startOfLocalDay` din `src/lib/schedule.ts`; `AuthProvider`/`useAuth` (`{ enabled, session, loading }`) din `src/auth.tsx`; `ThemeProvider` din `src/theme.tsx`; `HorizontalProvider` din `src/store.tsx`.
- Produces: `QUICK_ADD_PATH = '/quick-add'`, `isQuickAddPath(pathname: string): boolean`; pagina servită la `/quick-add`.

- [ ] **Step 1: Testele care pică (deepLink)**

Adaugă în `src/lib/deepLink.test.ts`:

```ts
import { isQuickAddPath, parseTicketPath, QUICK_ADD_PATH } from './deepLink'

describe('ruta barei de captură', () => {
  it('/quick-add nu e un tichet', () => {
    expect(parseTicketPath('/quick-add')).toBeNull()
    expect(parseTicketPath('/quick-add/')).toBeNull()
  })
  it('isQuickAddPath recunoaște ruta, cu sau fără bară finală', () => {
    expect(QUICK_ADD_PATH).toBe('/quick-add')
    expect(isQuickAddPath('/quick-add')).toBe(true)
    expect(isQuickAddPath('/quick-add/')).toBe(true)
    expect(isQuickAddPath('/QUICK-ADD')).toBe(false)
    expect(isQuickAddPath('/HZ-12')).toBe(false)
  })
})
```

(Păstrează importurile existente din fișier; unește-le dacă `parseTicketPath` e deja importat.)

- [ ] **Step 2: Rulează, trebuie să pice**

Run: `npx vitest run src/lib/deepLink.test.ts`
Expected: FAIL — `isQuickAddPath` nu există; `parseTicketPath('/quick-add')` întoarce un obiect.

- [ ] **Step 3: Implementarea în `deepLink.ts`**

Adaugă:

```ts
/**
 * Bara de captură a aplicației de Linux. O rută a site-ului, nu un tichet:
 * după forma ei („cuvânt-cuvânt") regexul de tichet ar fi citit-o `QUICK-ADD`.
 */
export const QUICK_ADD_PATH = '/quick-add'

export function isQuickAddPath(pathname: string): boolean {
  return pathname.replace(/\/$/, '') === QUICK_ADD_PATH
}
```

și, la începutul corpului lui `parseTicketPath`, prima linie: `if (isQuickAddPath(pathname)) return null` (folosește numele real al parametrului funcției).

Run: `npx vitest run src/lib/deepLink.test.ts`
Expected: PASS.

- [ ] **Step 4: Pagina**

```tsx
// src/QuickAddPage.tsx
import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { HorizontalProvider, useHorizontal } from './store'
import { QuickAdd } from './components/QuickAdd'
import { startOfLocalDay } from './lib/schedule'
import { getDesktopBridge } from './lib/desktopBridge'
import { dailyProjectId } from './lib/captureTokens'

/**
 * Bara de captură (aplicația de Linux, Ctrl+Shift+A). O intrare ușoară, nu
 * aplicația întreagă: același `QuickAdd` ca în „Azi" — aceeași recunoaștere a
 * datei, același proiect ținut minte —, scris prin același repository, deci
 * prin coada offline. Fereastra stă ascunsă și se refolosește; fiecare arătare
 * aduce `focus` pe fereastră, iar asta e semnalul de „rundă nouă": câmp gol,
 * cursor în el.
 */
export function QuickAddPage() {
  const { enabled, session, loading } = useAuth()
  if (loading) return null
  if (enabled && !session) {
    return <p className="qab-empty">Deschide Horizontal și autentifică-te o dată — bara folosește aceeași sesiune.</p>
  }
  return (
    <HorizontalProvider>
      <QuickAddBar />
    </HorizontalProvider>
  )
}

function QuickAddBar() {
  const { projects } = useHorizontal()
  const [round, setRound] = useState(0)
  useEffect(() => {
    const onFocus = () => setRound((r) => r + 1)
    // Esc ascunde fără să salveze, cu sau fără text. În captură, ca `QuickAdd`
    // (care la Esc doar golește câmpul) să nu-l vadă primul.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      getDesktopBridge()?.hideBar()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('keydown', onKey, true) }
  }, [])
  // `QuickAdd` focusează doar la o SCHIMBARE a semnalului, nu la montare —
  // iar remontarea (cheia) e cea care golește câmpul. Deci focusul îl cerem noi,
  // după ce noul câmp există.
  useEffect(() => {
    if (round === 0) return
    const id = requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.qab .qa-input')?.focus())
    return () => cancelAnimationFrame(id)
  }, [round])
  // Fără dată în text, sarcina e pentru azi — ca adăugarea rapidă din „Azi",
  // ca să apară imediat în lista pe care omul o deschide dimineața.
  const today = startOfLocalDay(new Date()).toISOString()
  return (
    <div className="qab">
      {/* Proiectul implicit e „✅Daily", ales de om — nu ultimul folosit: bara e
          pentru captura zilnică, iar alt proiect se cere explicit (#nume sau butonul). */}
      <QuickAdd
        key={round}
        rich
        defaultProjectId={dailyProjectId(projects) ?? undefined}
        defaultDueAt={today}
        onAdded={() => getDesktopBridge()?.hideBar()}
      />
    </div>
  )
}
```

- [ ] **Step 5: Testul de browser care pică**

```js
// scripts/test-quick-add.mjs
// Ruta /quick-add pe backendul local, în Chromium: pagina nu e luată drept
// tichet, Enter creează sarcina cu data din text în proiectul ținut minte,
// iar sarcina apare în aplicație.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5213
const BASE = `http://localhost:${PORT}`
let failed = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++ }

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', VITE_DATA_SOURCE: 'local', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite nu a pornit în 60s')), 60_000)
  vite.stdout.on('data', (d) => { if (String(d).includes(`localhost:${PORT}`)) { clearTimeout(t); resolve() } })
  vite.on('exit', (c) => { clearTimeout(t); reject(new Error(`vite a ieșit cu ${c}`)) })
})

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 150 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}/quick-add`, { waitUntil: 'networkidle' })
  check('URL-ul rămâne /quick-add', new URL(page.url()).pathname === '/quick-add', page.url())
  check('nu apare notița de tichet inexistent', (await page.locator('text=nu mai există').count()) === 0)
  const input = page.locator('.qab .qa-input')
  check('bara are câmpul', (await input.count()) === 1)

  await input.fill('')
  await input.press('Enter')
  await page.waitForTimeout(400)
  await input.fill('test bară mâine la 10')
  await page.waitForTimeout(300)
  await input.press('Enter')
  await page.waitForTimeout(800)
  check('după Enter câmpul e gol', (await input.inputValue()) === '')

  // Semnele: proiectul și urgența din text. Pe backendul local proiectul din
  // seed e „Exemplu" (`src/lib/seed.ts`); „Daily" nu există acolo, deci bara
  // pornește pe proiectul personal implicit.
  await input.fill('test semne #exemplu ! poimâine')
  await page.waitForTimeout(300)
  const richRow = await page.locator('.qab .qa-rich').innerText()
  check('rândul de butoane arată proiectul ales din text', /Exemplu/i.test(richRow), richRow)
  check('urgent aprins din „!"', (await page.locator('.qab .qa-urgent.on').count()) === 1)
  await page.locator('.qab .qa-urgent').click()
  check('butonul are ultimul cuvânt (urgent stins)', (await page.locator('.qab .qa-urgent.on').count()) === 0)
  await input.press('Enter')
  await page.waitForTimeout(800)

  // Esc cu text: nu salvează (în browser nu există punte, deci bara nu se ascunde).
  await input.fill('nu trebuie salvat')
  await input.press('Escape')
  check('fără erori în pagină', errors.length === 0, errors.join(' | '))

  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('.tabbar button, .sidebar-smart-item, .sidebar button').filter({ hasText: /^Mâine/ }).locator('visible=true').first().click()
  await page.waitForTimeout(800)
  const rows = await page.locator('.task-row').allInnerTexts()
  check('sarcina din bară apare în „Mâine", la 10:00', rows.some((r) => r.includes('test bară') && r.includes('10:00')), rows.join(' / '))
  check('textul de la Esc nu s-a salvat', !rows.some((r) => r.includes('nu trebuie salvat')))
  check('Enter pe câmp gol n-a creat nimic', !rows.some((r) => r.trim() === ''))
  check('semnele nu rămân în titlu', !rows.some((r) => r.includes('#exemplu') || r.includes(' !')), rows.join(' / '))
} finally {
  await browser.close()
  vite.kill('SIGTERM')
}
if (failed) { console.error(`${failed} verificări au picat.`); process.exit(1) }
console.log('Bara de captură funcționează.')
```

În `package.json`, la `scripts`, lângă `test:nav`: `"test:quick-add": "node scripts/test-quick-add.mjs"`.

Run: `npm run test:quick-add`
Expected: FAIL la „bara are câmpul" — fără ramificare, `/quick-add` încarcă aplicația întreagă.

- [ ] **Step 6: Ramificarea în `main.tsx`**

Înlocuiește conținutul lui `src/main.tsx` păstrând importurile existente și adăugând `QuickAddPage`, `ThemeProvider`, `isQuickAddPath`:

```tsx
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
```

Citește întâi `src/main.tsx` și păstrează orice altă linie existentă (importul CSS etc.).

Run: `npm run test:quick-add`
Expected: PASS.

- [ ] **Step 7: Stilul**

La finalul `src/styles.css` (atenție: fișierul are BOM la început — nu-l atinge; editează doar finalul):

```css
/* ── Bara de captură (aplicația de Linux, /quick-add) ─────────────────────
   O fereastră mică, fără ramă: pagina ESTE bara. Fără chenar — fundalul
   (--surface) peste nimic e delimitarea. */
html:has(.qab), body:has(.qab) { margin: 0; height: 100%; background: var(--surface); overflow: hidden; }
.qab { padding: 12px 16px; }
.qab .qa { box-shadow: none; background: transparent; }
.qab-empty { margin: 0; padding: 18px 20px; font-family: var(--display); color: var(--txt-dim); background: var(--surface); }
```

- [ ] **Step 8: Verificare și commit**

Run: `npm test && npm run typecheck && npm run test:quick-add && npm run test:nav && npm run test:layout`
Expected: PASS. Apoi `python3 design/build-preview.py` și deschide `design/preview.html` în ambele teme: nimic din aplicație nu trebuie să se fi mișcat (stilul nou e legat de `.qab`).

```bash
git add src/lib/deepLink.ts src/lib/deepLink.test.ts src/QuickAddPage.tsx src/main.tsx src/styles.css scripts/test-quick-add.mjs package.json
git commit -m "feat(desktop): ruta /quick-add — bara de captură, ramificată înaintea aplicației"
```

---

### Task 7: Cutia — schelet și planificatorul de mementouri

**Files:**
- Create: `desktop/package.json`, `desktop/tsconfig.json`, `desktop/.gitignore`
- Create: `desktop/src/scheduler.ts`
- Test: `desktop/src/scheduler.test.ts`

**Interfaces:**
- Produces:
  - `interface Reminder { key: string; id: string; at: number; title: string; body: string }` (`at` în ms)
  - `MISSED_WINDOW_MS = 3_600_000`, `HORIZON_MS = 24 * 3_600_000`
  - `interface Plan { fireNow: Reminder[]; arm: { reminder: Reminder; delayMs: number }[]; close: string[] }` — `close` = chei afișate care nu mai sunt în listă
  - `planReminders(next: Reminder[], now: number, fired: ReadonlySet<string>, shown: ReadonlySet<string>): Plan`
  - `parseReminders(raw: unknown): Reminder[]` — validează ce vine din pagină (IPC) și convertește `at` ISO → ms.

- [ ] **Step 1: Scheletul**

```json
// desktop/package.json
{
  "name": "horizontal-desktop",
  "version": "0.1.0",
  "private": true,
  "description": "Horizontal pentru Linux — cutia Electron rezidentă",
  "main": "dist/main.js",
  "desktopName": "horizontal.desktop",
  "author": "Horizontal",
  "scripts": {
    "build": "tsc -p .",
    "typecheck": "tsc -p . --noEmit",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder --linux dir",
    "app:install": "npm run dist && node scripts/install.mjs",
    "app:uninstall": "node scripts/uninstall.mjs"
  },
  "build": {
    "appId": "ro.horizontal.app",
    "productName": "Horizontal",
    "executableName": "horizontal",
    "files": ["dist/**", "package.json"],
    "directories": { "output": "release" },
    "linux": { "target": "dir", "category": "Office", "icon": "../public/pwa-512x512.png" }
  },
  "dependencies": {
    "dbus-next": "0.10.2"
  },
  "devDependencies": {
    "electron": "44.5.1",
    "electron-builder": "26.15.3",
    "typescript": "<aceeași versiune ca în package.json-ul rădăcinii>"
  }
}
```

Înlocuiește `<aceeași versiune…>` cu valoarea exactă din `package.json` de la rădăcină (`node -p "require('./package.json').devDependencies.typescript"`).

```json
// desktop/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

```
# desktop/.gitignore
node_modules
dist
release
```

Run: `cd desktop && npm install && cd ..`
Expected: `desktop/package-lock.json` creat; `desktop/node_modules/electron` prezent. (`@types/node` vine cu electron; dacă `tsc` nu-l găsește, `npm --prefix desktop install -D @types/node@22`.)

Testele din `desktop/src/*.test.ts` le rulează vitest-ul rădăcinii (`npm test`), care prinde implicit orice `*.test.ts` din afara `node_modules` — de-aia `desktop/` n-are vitest propriu.

- [ ] **Step 2: Testele care pică**

```ts
// desktop/src/scheduler.test.ts
import { describe, expect, it } from 'vitest'
import { HORIZON_MS, MISSED_WINDOW_MS, parseReminders, planReminders, type Reminder } from './scheduler'

const now = Date.parse('2026-10-02T10:00:00.000Z')
const r = (id: string, at: number): Reminder => ({ key: `${id}@${new Date(at).toISOString()}`, id, at, title: id, body: '' })
const none = new Set<string>()

describe('planReminders', () => {
  it('unul din viitor se armează cu întârzierea exactă', () => {
    const p = planReminders([r('A', now + 60_000)], now, none, none)
    expect(p.arm).toEqual([{ reminder: r('A', now + 60_000), delayMs: 60_000 }])
    expect(p.fireNow).toEqual([])
  })
  it('unul ratat de mai puțin de o oră sună acum', () => {
    expect(planReminders([r('A', now - 30 * 60_000)], now, none, none).fireNow.map((x) => x.id)).toEqual(['A'])
  })
  it('unul ratat de peste o oră se sare', () => {
    const p = planReminders([r('A', now - MISSED_WINDOW_MS - 1)], now, none, none)
    expect(p.fireNow).toEqual([])
    expect(p.arm).toEqual([])
  })
  it('unul deja sunat nu sună a doua oară, nici dacă pagina retrimite lista', () => {
    const a = r('A', now - 60_000)
    expect(planReminders([a], now, new Set([a.key]), none).fireNow).toEqual([])
  })
  it('unul dincolo de orizont nu se armează (pagina îl retrimite mai târziu)', () => {
    expect(planReminders([r('A', now + HORIZON_MS + 1)], now, none, none).arm).toEqual([])
  })
  it('o notificare afișată a cărei cheie a dispărut (bifată, amânată) se închide', () => {
    const old = r('A', now - 60_000)
    const snoozed = r('A', now + 5 * 60_000)
    const p = planReminders([snoozed], now, new Set([old.key]), new Set([old.key]))
    expect(p.close).toEqual([old.key])
    expect(p.arm.map((x) => x.reminder.key)).toEqual([snoozed.key])
  })
  it('o notificare afișată încă în listă rămâne', () => {
    const a = r('A', now - 60_000)
    expect(planReminders([a], now, new Set([a.key]), new Set([a.key])).close).toEqual([])
  })
})

describe('parseReminders', () => {
  it('acceptă forma din pagină și convertește ora', () => {
    expect(parseReminders([{ key: 'A@x', id: 'A', at: '2026-10-02T10:00:00.000Z', title: 't', body: 'b' }]))
      .toEqual([{ key: 'A@x', id: 'A', at: now, title: 't', body: 'b' }])
  })
  it('aruncă tot ce nu are forma — IPC-ul e o graniță', () => {
    expect(parseReminders('nu')).toEqual([])
    expect(parseReminders([{ id: 'A' }, null, { key: 'k', id: 'A', at: 'nu e dată', title: '', body: '' }])).toEqual([])
  })
})
```

- [ ] **Step 3: Rulează, trebuie să pice**

Run: `npx vitest run desktop/src/scheduler.test.ts`
Expected: FAIL — `Failed to resolve import "./scheduler"`.

- [ ] **Step 4: Implementarea**

```ts
// desktop/src/scheduler.ts
/**
 * Planificatorul de mementouri al cutiei, pur: dată lista de la pagină și ora,
 * ce sună acum, ce se armează, ce notificare afișată se retrage. Procesul
 * principal îl recheamă de la zero la fiecare listă nouă, la fiecare timer
 * ajuns la termen și la trezirea din somn — timerele Node merg pe un ceas care
 * NU numără somnul, deci după o noapte cu capacul închis ar întârzia cu o noapte.
 */
export interface Reminder { key: string; id: string; at: number; title: string; body: string }

/** Aceeași regulă ca `TTL: 3600` la push: un memento răsuflat e zgomot, nu informație. */
export const MISSED_WINDOW_MS = 3_600_000
export const HORIZON_MS = 24 * 3_600_000

export interface Plan {
  fireNow: Reminder[]
  arm: { reminder: Reminder; delayMs: number }[]
  close: string[]
}

export function planReminders(next: Reminder[], now: number, fired: ReadonlySet<string>, shown: ReadonlySet<string>): Plan {
  const keys = new Set(next.map((r) => r.key))
  const plan: Plan = { fireNow: [], arm: [], close: [...shown].filter((k) => !keys.has(k)) }
  for (const r of next) {
    if (fired.has(r.key)) continue
    const delay = r.at - now
    if (delay <= 0) { if (-delay <= MISSED_WINDOW_MS) plan.fireNow.push(r); continue }
    if (delay <= HORIZON_MS) plan.arm.push({ reminder: r, delayMs: delay })
  }
  return plan
}

const str = (v: unknown): v is string => typeof v === 'string'

export function parseReminders(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return []
  const out: Reminder[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (!str(o.key) || !str(o.id) || !str(o.at) || !str(o.title) || !str(o.body)) continue
    const at = Date.parse(o.at)
    if (!Number.isFinite(at)) continue
    out.push({ key: o.key, id: o.id, at, title: o.title, body: o.body })
  }
  return out
}
```

- [ ] **Step 5: Rulează, trebuie să treacă**

Run: `npx vitest run desktop/src/scheduler.test.ts && npm --prefix desktop run typecheck`
Expected: PASS, 9 teste; typecheck curat.

- [ ] **Step 6: Commit**

```bash
git add desktop/package.json desktop/package-lock.json desktop/tsconfig.json desktop/.gitignore desktop/src/scheduler.ts desktop/src/scheduler.test.ts
git commit -m "feat(desktop): cutia Electron — schelet și planificatorul de mementouri"
```

---

### Task 8: Notificările și serviciul pe D-Bus

**Files:**
- Create: `desktop/src/notify.ts`, `desktop/src/dbusService.ts`
- Create: `desktop/scripts/notify-probe.mjs`

**Interfaces:**
- Consumes: `Reminder` (Task 7).
- Produces:
  - `type NotifyAction = { action: 'done' | 'snooze' | 'open'; id: string }`
  - `interface Notifier { show(r: Reminder): Promise<void>; close(key: string): Promise<void>; shownKeys(): Set<string> }`
  - `createNotifier(onAction: (a: NotifyAction) => void): Promise<Notifier>`
  - `exportAppService(h: { quickAdd(): void; show(): void; quit(): void }): Promise<boolean>` — `true` dacă numele `ro.horizontal.App` a fost obținut.

- [ ] **Step 1: Proba de butoane, înainte de cod păstrat**

Riscul din spec: GNOME pliază butoanele dacă notificarea nu e extinsă. Se verifică întâi cu `dbus-next`, exact cu hint-urile pe care le va folosi cutia.

```js
// desktop/scripts/notify-probe.mjs — rulează: node desktop/scripts/notify-probe.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const dbus = require('dbus-next')
const { Variant } = dbus

const bus = dbus.sessionBus()
const obj = await bus.getProxyObject('org.freedesktop.Notifications', '/org/freedesktop/Notifications')
const n = obj.getInterface('org.freedesktop.Notifications')
const id = await n.Notify('Horizontal', 0, 'horizontal', 'Sună la bancă', '10:00 · Personal',
  ['default', 'Deschide', 'done', 'Gata', 'snooze', 'Amână 5 min'],
  { urgency: new Variant('y', 2), resident: new Variant('b', true), 'desktop-entry': new Variant('s', 'horizontal') }, -1)
console.log('notificare', id, '— apasă un buton (Ctrl+C ca să ieși)')
n.on('ActionInvoked', (nid, key) => { if (nid === id) console.log('acțiune:', key) })
n.on('NotificationClosed', (nid, reason) => { if (nid === id) { console.log('închisă, motiv', reason); bus.disconnect() } })
```

Run: `node desktop/scripts/notify-probe.mjs`
Expected (verificat de om, pe ecran): notificarea apare cu **ambele butoane vizibile**; „Amână 5 min" tipărește `acțiune: snooze`; un click pe corp tipărește `acțiune: default`. Dacă butoanele apar doar după extinderea manuală a notificării, notează asta în raportul taskului — nu schimba hint-urile pe ghicite.

- [ ] **Step 2: `notify.ts`**

```ts
// desktop/src/notify.ts
import * as dbus from 'dbus-next'
import type { Reminder } from './scheduler'

export type NotifyAction = { action: 'done' | 'snooze' | 'open'; id: string }

export interface Notifier {
  show(r: Reminder): Promise<void>
  close(key: string): Promise<void>
  /** Cheile notificărilor încă pe ecran — planificatorul le retrage pe cele care nu mai sunt în listă. */
  shownKeys(): Set<string>
}

/**
 * Notificările merg direct pe D-Bus, nu prin `Notification` din Electron
 * (n-are acțiuni pe Linux) și nici prin portal (v1 n-are ce trebuie).
 * `urgency=2` extinde notificarea în GNOME, deci butoanele se văd; `resident`
 * o ține pe ecran după o acțiune — o retragem noi, când pagina confirmă.
 */
export async function createNotifier(onAction: (a: NotifyAction) => void): Promise<Notifier> {
  const bus = dbus.sessionBus()
  const obj = await bus.getProxyObject('org.freedesktop.Notifications', '/org/freedesktop/Notifications')
  const n = obj.getInterface('org.freedesktop.Notifications')
  const byKey = new Map<string, number>()
  const byNid = new Map<number, { key: string; id: string }>()

  n.on('ActionInvoked', (nid: number, actionKey: string) => {
    const hit = byNid.get(nid)
    if (!hit) return
    if (actionKey === 'done' || actionKey === 'snooze') onAction({ action: actionKey, id: hit.id })
    else if (actionKey === 'default') onAction({ action: 'open', id: hit.id })
  })
  n.on('NotificationClosed', (nid: number) => {
    const hit = byNid.get(nid)
    if (!hit) return
    byNid.delete(nid)
    byKey.delete(hit.key)
  })

  return {
    async show(r) {
      const nid: number = await n.Notify('Horizontal', 0, 'horizontal', r.title, r.body,
        ['default', 'Deschide', 'done', 'Gata', 'snooze', 'Amână 5 min'],
        { urgency: new dbus.Variant('y', 2), resident: new dbus.Variant('b', true), 'desktop-entry': new dbus.Variant('s', 'horizontal') },
        -1)
      byKey.set(r.key, nid)
      byNid.set(nid, { key: r.key, id: r.id })
    },
    async close(key) {
      const nid = byKey.get(key)
      if (nid === undefined) return
      byKey.delete(key)
      byNid.delete(nid)
      await n.CloseNotification(nid).catch(() => {})
    },
    shownKeys: () => new Set(byKey.keys()),
  }
}
```

- [ ] **Step 3: `dbusService.ts`**

```ts
// desktop/src/dbusService.ts
import * as dbus from 'dbus-next'

const NAME = 'ro.horizontal.App'
const PATH = '/ro/horizontal/App'

/**
 * Ușa pentru scurtătura GNOME: `gdbus call … QuickAdd` (~10 ms) e mult mai
 * rapid decât o a doua lansare a binarului, care pornește tot Chromium doar ca
 * să afle că există deja o instanță. `Quit` e pentru instalator.
 */
export async function exportAppService(h: { quickAdd(): void; show(): void; quit(): void }): Promise<boolean> {
  const { Interface } = dbus.interface
  class AppIface extends Interface {
    QuickAdd() { h.quickAdd() }
    Show() { h.show() }
    Quit() { h.quit() }
  }
  AppIface.configureMembers({
    methods: {
      QuickAdd: { inSignature: '', outSignature: '' },
      Show: { inSignature: '', outSignature: '' },
      Quit: { inSignature: '', outSignature: '' },
    },
  })
  const bus = dbus.sessionBus()
  const reply = await bus.requestName(NAME, dbus.NameFlag.DO_NOT_QUEUE)
  if (reply !== dbus.RequestNameReply.PRIMARY_OWNER) return false
  bus.export(PATH, new AppIface(NAME))
  return true
}
```

Dacă tipurile `dbus-next` nu expun `configureMembers` sau `NameFlag` sub aceste nume, citește `desktop/node_modules/dbus-next/types.d.ts` și folosește numele de acolo (constantele: `DBUS_NAME_FLAG_DO_NOT_QUEUE = 4`, `PRIMARY_OWNER = 1`).

- [ ] **Step 4: Verificare și commit**

Run: `npm --prefix desktop run typecheck && npm test`
Expected: PASS.

```bash
git add desktop/src/notify.ts desktop/src/dbusService.ts desktop/scripts/notify-probe.mjs
git commit -m "feat(desktop): notificări cu butoane și serviciul ro.horizontal.App pe D-Bus"
```

---

### Task 9: Procesul principal și puntea

**Files:**
- Create: `desktop/src/main.ts`, `desktop/src/preload.ts`

**Interfaces:**
- Consumes: `planReminders`, `parseReminders`, `Reminder` (Task 7); `createNotifier`, `NotifyAction`, `Notifier`, `exportAppService` (Task 8); contractul `HorizontalDesktop` din `src/lib/desktopBridge.ts` (Task 2) — preload-ul îl implementează.
- Produces: canalele IPC `hz:set-reminders` (pagină → cutie, `DesktopReminder[]`), `hz:hide-bar` (bară → cutie), `hz:reminder-action` (cutie → pagină, `{ action, id }`); argumentele `--hidden`, `--quick-add`; variabila `HORIZONTAL_URL`.

- [ ] **Step 1: Preload-ul**

```ts
// desktop/src/preload.ts
import { contextBridge, ipcRenderer } from 'electron'

/**
 * Puntea, și NUMAI pe originea aplicației: dacă fereastra ar ajunge vreodată pe
 * altă pagină (un link, o redirecționare), pagina aceea nu primește nimic. Rulează
 * în sandbox — fără Node; originea și versiunea vin prin `additionalArguments`.
 * Contractul e `HorizontalDesktop` din `src/lib/desktopBridge.ts`.
 */
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

if (location.origin === arg('hz-origin')) {
  contextBridge.exposeInMainWorld('horizontalDesktop', {
    version: arg('hz-version') ?? '0',
    setReminders: (list: unknown) => ipcRenderer.send('hz:set-reminders', list),
    onReminderAction: (fn: (a: unknown) => void) => {
      const h = (_e: unknown, a: unknown) => fn(a)
      ipcRenderer.on('hz:reminder-action', h)
      return () => { ipcRenderer.removeListener('hz:reminder-action', h) }
    },
    hideBar: () => ipcRenderer.send('hz:hide-bar'),
  })
}
```

- [ ] **Step 2: Procesul principal**

```ts
// desktop/src/main.ts
import { app, BrowserWindow, ipcMain, powerMonitor, shell, type WebContents } from 'electron'
import * as path from 'node:path'
import { parseReminders, planReminders, type Reminder } from './scheduler'
import { createNotifier, type Notifier, type NotifyAction } from './notify'
import { exportAppService } from './dbusService'

const START_URL = process.env.HORIZONTAL_URL ?? 'https://horizontal-dyx.pages.dev'
const ORIGIN = new URL(START_URL).origin
const HIDDEN = process.argv.includes('--hidden')

let mainWin: BrowserWindow | null = null
let barWin: BrowserWindow | null = null
let quitting = false
let notifier: Notifier | null = null

const webPreferences = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  additionalArguments: [`--hz-origin=${ORIGIN}`, `--hz-version=${app.getVersion()}`],
})

/** Orice altă origine pleacă în browserul sistemului; fereastra rămâne Horizontal. */
function guard(wc: WebContents) {
  wc.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== ORIGIN) { e.preventDefault(); void shell.openExternal(url) }
  })
  wc.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
}

function createMain() {
  mainWin = new BrowserWindow({ width: 1400, height: 900, show: false, title: 'Horizontal', autoHideMenuBar: true, webPreferences: webPreferences() })
  guard(mainWin.webContents)
  void mainWin.loadURL(START_URL)
  // Închiderea ascunde: fereastra principală e cea care știe mementourile, deci
  // trebuie să rămână încărcată. Ieșirea reală: meniul (Alt → File → Quit, Ctrl+Q).
  mainWin.on('close', (e) => { if (!quitting) { e.preventDefault(); mainWin?.hide() } })
  if (!HIDDEN) mainWin.once('ready-to-show', () => mainWin?.show())
}

function createBar() {
  // Creată o dată și refolosită: proba de focus (2026-10-02) a arătat că pe
  // GNOME Wayland `show()` + `focus()` pe aceeași fereastră primește tastatura
  // din prima. Pe Wayland poziția o alege compozitorul (centrat).
  barWin = new BrowserWindow({
    width: 720, height: 150, show: false, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, center: true, title: 'Horizontal — captură',
    webPreferences: webPreferences(),
  })
  guard(barWin.webContents)
  void barWin.loadURL(`${START_URL}/quick-add`)
  barWin.on('blur', () => barWin?.hide())
}

function showBar() {
  if (!barWin || barWin.isDestroyed()) createBar()
  barWin!.show(); barWin!.focus(); barWin!.webContents.focus()
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createMain()
  mainWin!.show(); mainWin!.focus()
}

// ── Mementourile ────────────────────────────────────────────────────────────
const timers = new Map<string, NodeJS.Timeout>()
const fired = new Set<string>()
let reminders: Reminder[] = []

/**
 * De la zero de fiecare dată: lista e mică (24 h), iar un singur drum de
 * planificare înseamnă că o listă nouă, un timer ajuns la termen și trezirea
 * din somn aplică exact aceeași regulă.
 */
function reschedule() {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  if (!notifier) return
  const plan = planReminders(reminders, Date.now(), fired, notifier.shownKeys())
  for (const key of plan.close) void notifier.close(key)
  for (const r of plan.fireNow) { fired.add(r.key); void notifier.show(r).catch((e) => console.error('notificare', e)) }
  for (const { reminder, delayMs } of plan.arm) {
    timers.set(reminder.key, setTimeout(reschedule, delayMs))
  }
}

function onNotifyAction(a: NotifyAction) {
  if (a.action === 'open') showMain()
  mainWin?.webContents.send('hz:reminder-action', a)
}

function start() {
  app.on('second-instance', (_e, argv) => (argv.includes('--quick-add') ? showBar() : showMain()))
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => { /* rezident: nu iese când se ascund ferestrele */ })

  void app.whenReady().then(async () => {
    createMain()
    createBar()
    if (process.argv.includes('--quick-add')) mainWin!.webContents.once('did-finish-load', showBar)

    ipcMain.on('hz:set-reminders', (e, list) => {
      if (e.sender !== mainWin?.webContents) return // doar fereastra principală știe lista
      reminders = parseReminders(list)
      reschedule()
    })
    ipcMain.on('hz:hide-bar', (e) => { if (e.sender === barWin?.webContents) barWin?.hide() })

    try { notifier = await createNotifier(onNotifyAction) } catch (e) { console.error('D-Bus Notifications indisponibil', e) }
    try { await exportAppService({ quickAdd: showBar, show: showMain, quit: () => app.quit() }) } catch (e) { console.error('D-Bus ro.horizontal.App', e) }

    powerMonitor.on('resume', reschedule)
    powerMonitor.on('unlock-screen', reschedule)
    reschedule()
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else start()
```

- [ ] **Step 3: Typecheck și build**

Run: `npm --prefix desktop run build`
Expected: `desktop/dist/main.js`, `preload.js`, `scheduler.js`, `notify.js`, `dbusService.js`, fără erori.

- [ ] **Step 4: Pornire pe site-ul local (înainte de orice push)**

Ruta `/quick-add` și puntea nu sunt încă în producție, deci cutia se verifică pe build-ul local, pe Supabase real:

```bash
npm run build && npx vite preview --port 4173 --strictPort &
HORIZONTAL_URL=http://localhost:4173 npm --prefix desktop start
```

Expected: se deschide fereastra Horizontal, încă NElogată. Înainte de login, din alt terminal, cheamă bara (comanda de mai jos): trebuie să spună „Deschide Horizontal și autentifică-te o dată…", fără ecran alb; Esc o ascunde. Apoi login o dată, cu contul omului, și din nou:

```bash
gdbus call --session --dest ro.horizontal.App --object-path /ro/horizontal/App --method ro.horizontal.App.QuickAdd
```

Expected: apare bara, cu cursorul în câmp; „test cutie mâine la 10" + Enter → bara dispare, iar sarcina apare în „Mâine" în fereastra principală fără reîncărcare (prin `BroadcastChannel`). Șterge sarcina de test după verificare.

Mementoul: creează din fereastra principală o sarcină „test memento" cu oră peste 2 minute și memento „la scadență"; așteaptă → notificare cu „Gata" / „Amână 5 min"; „Amână 5 min" → notificarea dispare (retragere), revine peste 5 min; „Gata" → sarcina bifată în fereastră. Șterge sarcina de test.

Închide fereastra principală cu X → dispare, procesul rămâne (`gdbus call … Show` o readuce). Ctrl+Q în fereastră → procesul se oprește. Oprește `vite preview` (`kill %1`).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main.ts desktop/src/preload.ts
git commit -m "feat(desktop): procesul rezident — fereastra, bara, puntea și timerele mementourilor"
```

---

### Task 10: Instalarea, scurtătura și autostart-ul

**Files:**
- Create: `desktop/scripts/gsettings.mjs`, `desktop/scripts/gsettings.test.mjs`
- Create: `desktop/scripts/install.mjs`, `desktop/scripts/uninstall.mjs`
- Modify: `package.json` (rădăcina — scripturile `desktop:install`, `desktop:uninstall`)

**Interfaces:**
- Produces: `parseStrv(s: string): string[]`, `formatStrv(list: string[]): string`, `withPath(list: string[], p: string): string[]`, `withoutPath(list: string[], p: string): string[]`, `KEYBINDING_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/horizontal/'`.

- [ ] **Step 1: Testele care pică**

```js
// desktop/scripts/gsettings.test.mjs
import { describe, expect, it } from 'vitest'
import { formatStrv, KEYBINDING_PATH, parseStrv, withoutPath, withPath } from './gsettings.mjs'

const custom0 = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/'

describe('lista de scurtături GNOME', () => {
  it('citește forma pe care o tipărește gsettings', () => {
    expect(parseStrv(`['${custom0}']`)).toEqual([custom0])
    expect(parseStrv('@as []')).toEqual([])
    expect(parseStrv('[]')).toEqual([])
  })
  it('adaugă scurtătura fără să atingă custom0, o singură dată', () => {
    expect(withPath([custom0], KEYBINDING_PATH)).toEqual([custom0, KEYBINDING_PATH])
    expect(withPath([custom0, KEYBINDING_PATH], KEYBINDING_PATH)).toEqual([custom0, KEYBINDING_PATH])
  })
  it('dezinstalarea scoate doar scurtătura noastră', () => {
    expect(withoutPath([custom0, KEYBINDING_PATH], KEYBINDING_PATH)).toEqual([custom0])
  })
  it('scrie forma pe care o acceptă gsettings set', () => {
    expect(formatStrv([custom0, KEYBINDING_PATH])).toBe(`['${custom0}', '${KEYBINDING_PATH}']`)
    expect(formatStrv([])).toBe('@as []')
  })
})
```

Run: `npx vitest run desktop/scripts/gsettings.test.mjs`
Expected: FAIL — modulul nu există.

- [ ] **Step 2: Implementarea**

```js
// desktop/scripts/gsettings.mjs
/**
 * Lista `custom-keybindings` din GNOME e una singură, pentru toate scurtăturile
 * personalizate ale omului (azi: custom0 = Flameshot). Instalarea adaugă calea
 * noastră la listă, n-o rescrie — de-aia funcții care primesc lista existentă.
 */
export const KEYBINDING_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/horizontal/'

export function parseStrv(s) {
  return [...s.matchAll(/'([^']*)'/g)].map((m) => m[1])
}
export function formatStrv(list) {
  return list.length ? `[${list.map((p) => `'${p}'`).join(', ')}]` : '@as []'
}
export function withPath(list, p) {
  return list.includes(p) ? list : [...list, p]
}
export function withoutPath(list, p) {
  return list.filter((x) => x !== p)
}
```

Run: `npx vitest run desktop/scripts/gsettings.test.mjs`
Expected: PASS, 4 teste.

- [ ] **Step 3: Instalarea**

```js
// desktop/scripts/install.mjs — rulat de `npm run desktop:install` după `electron-builder --linux dir`.
// Re-rulabil: fiecare pas suprascrie ce a scris data trecută.
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { formatStrv, KEYBINDING_PATH, parseStrv, withPath } from './gsettings.mjs'

const HOME = homedir()
const here = new URL('..', import.meta.url).pathname
const built = join(here, 'release', 'linux-unpacked')
const opt = join(HOME, '.local', 'opt', 'horizontal')
const bin = join(HOME, '.local', 'bin')
const exe = join(bin, 'horizontal')
const quick = join(bin, 'horizontal-quick-add')
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()

if (!existsSync(join(built, 'horizontal'))) throw new Error(`lipsește ${built}/horizontal — rulează întâi electron-builder`)

// 1. Oprește instanța care rulează (binarul nu se poate înlocui de sub ea).
try { run('gdbus', ['call', '--session', '--dest', 'ro.horizontal.App', '--object-path', '/ro/horizontal/App', '--method', 'ro.horizontal.App.Quit']) } catch { /* nu rula */ }

// 2. Programul.
rmSync(opt, { recursive: true, force: true })
mkdirSync(opt, { recursive: true })
cpSync(built, opt, { recursive: true })
mkdirSync(bin, { recursive: true })
rmSync(exe, { force: true })
symlinkSync(join(opt, 'horizontal'), exe)

// 3. Scurtătura: `gdbus call` (~10 ms) cu rezervă pe a doua lansare, dacă aplicația nu rulează.
writeFileSync(quick, `#!/bin/sh
gdbus call --session --dest ro.horizontal.App --object-path /ro/horizontal/App --method ro.horizontal.App.QuickAdd >/dev/null 2>&1 || exec "${exe}" --quick-add
`)
chmodSync(quick, 0o755)

// 4. Iconițele, în tema utilizatorului (vezi DESKTOP-INSTALL-HOWTO.md).
const icons = join(HOME, '.local', 'share', 'icons', 'hicolor')
const pub = join(here, '..', 'public')
for (const [size, file] of [['512x512', 'pwa-512x512.png'], ['192x192', 'pwa-192x192.png']]) {
  mkdirSync(join(icons, size, 'apps'), { recursive: true })
  cpSync(join(pub, file), join(icons, size, 'apps', 'horizontal.png'))
}
mkdirSync(join(icons, 'scalable', 'apps'), { recursive: true })
cpSync(join(pub, 'icon.svg'), join(icons, 'scalable', 'apps', 'horizontal.svg'))
try { run('gtk-update-icon-cache', ['-f', '-t', icons]) } catch { /* opțional */ }

// 5. Lansatorul și autostart-ul. Numele `horizontal.desktop` = `desktopName` din package.json,
//    ca GNOME să lege fereastra de iconiță. Suprascrie un lansator PWA mai vechi cu același nume.
const entry = (extra) => `[Desktop Entry]
Type=Application
Name=Horizontal
Comment=Planificare și sarcini
Exec=${exe}${extra} %U
Icon=horizontal
Categories=Office;ProjectManagement;
StartupWMClass=horizontal
`
const apps = join(HOME, '.local', 'share', 'applications')
mkdirSync(apps, { recursive: true })
writeFileSync(join(apps, 'horizontal.desktop'), entry(''))
const autostart = join(HOME, '.config', 'autostart')
mkdirSync(autostart, { recursive: true })
writeFileSync(join(autostart, 'horizontal.desktop'), entry(' --hidden') + 'X-GNOME-Autostart-enabled=true\n')

// 6. Ctrl+Shift+A, adăugată la lista existentă (custom0 rămâne).
const KB = 'org.gnome.settings-daemon.plugins.media-keys'
const list = parseStrv(run('gsettings', ['get', KB, 'custom-keybindings']))
run('gsettings', ['set', KB, 'custom-keybindings', formatStrv(withPath(list, KEYBINDING_PATH))])
const kb = `${KB}.custom-keybinding:${KEYBINDING_PATH}`
run('gsettings', ['set', kb, 'name', 'Horizontal — captură'])
run('gsettings', ['set', kb, 'command', quick])
run('gsettings', ['set', kb, 'binding', '<Control><Shift>a'])

console.log(`Instalat în ${opt}. Pornește-l din meniu sau cu: ${exe}`)
```

- [ ] **Step 4: Dezinstalarea**

```js
// desktop/scripts/uninstall.mjs
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { formatStrv, KEYBINDING_PATH, parseStrv, withoutPath } from './gsettings.mjs'

const HOME = homedir()
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
try { run('gdbus', ['call', '--session', '--dest', 'ro.horizontal.App', '--object-path', '/ro/horizontal/App', '--method', 'ro.horizontal.App.Quit']) } catch { /* nu rula */ }
for (const p of [
  join(HOME, '.local', 'opt', 'horizontal'),
  join(HOME, '.local', 'bin', 'horizontal'),
  join(HOME, '.local', 'bin', 'horizontal-quick-add'),
  join(HOME, '.local', 'share', 'applications', 'horizontal.desktop'),
  join(HOME, '.config', 'autostart', 'horizontal.desktop'),
]) rmSync(p, { recursive: true, force: true })
const KB = 'org.gnome.settings-daemon.plugins.media-keys'
const list = parseStrv(run('gsettings', ['get', KB, 'custom-keybindings']))
run('gsettings', ['set', KB, 'custom-keybindings', formatStrv(withoutPath(list, KEYBINDING_PATH))])
for (const k of ['name', 'command', 'binding']) run('gsettings', ['reset', `${KB}.custom-keybinding:${KEYBINDING_PATH}`, k])
console.log('Dezinstalat. Iconițele din ~/.local/share/icons rămân (le folosește și varianta PWA).')
```

- [ ] **Step 5: Scripturile din rădăcină**

În `package.json` (rădăcina), la `scripts`:

```json
    "desktop:install": "npm --prefix desktop install && npm --prefix desktop run app:install",
    "desktop:uninstall": "npm --prefix desktop run app:uninstall"
```

- [ ] **Step 6: Verificare și commit**

Run: `npm test && npm --prefix desktop run typecheck && npm --prefix desktop run dist`
Expected: teste PASS; `desktop/release/linux-unpacked/horizontal` există. (Nu rula încă `desktop:install` — instalarea reală e în Task 11, după publicarea site-ului.)

```bash
git add desktop/scripts/gsettings.mjs desktop/scripts/gsettings.test.mjs desktop/scripts/install.mjs desktop/scripts/uninstall.mjs package.json
git commit -m "feat(desktop): instalare în ~/.local, autostart ascuns și Ctrl+Shift+A"
```

---

### Task 11: Documentație, publicare, instalare și verificarea pe mașina omului

**Files:**
- Modify: `CLAUDE.md` (secțiune nouă „## Aplicația de Linux", după „## Offline — baza locală și coada")

- [ ] **Step 1: Secțiunea din CLAUDE.md**

Proză în stilul celorlalte secțiuni, cu de-ce-urile: cutia încarcă site-ul (un push pe `master` ajunge și pe desktop prin service worker; cutia se reconstruiește rar, cu `npm run desktop:install`); `desktop/` cu `package.json` propriu și testele rulate de vitest-ul rădăcinii; ruta `/quick-add` ramificată în `main.tsx` și de ce (`parseTicketPath`, `settleUrl`); contractul `HorizontalDesktop` scris de două ori (`src/lib/desktopBridge.ts` și `desktop/src/preload.ts`) — se schimbă împreună; pagina ȘTIE, cutia SUNĂ (timerele în procesul principal, re-planificare de la zero, `resume`); `fired` previne dublurile la reîncărcarea paginii; „Gata" nu comută orb (`reminderMutation`); notificări pe D-Bus cu `urgency=2`/`resident`; dublura cu push-ul din Chrome (dezactivează notificările site-ului în Chrome după instalare); proba de focus și rezultatul ei; instalarea în `~/.local` și de ce nu `.rpm`; dezinstalarea.

```bash
git add CLAUDE.md
git commit -m "docs(desktop): secțiunea „Aplicația de Linux" în CLAUDE.md"
```

- [ ] **Step 2: Verificarea completă pe ramură**

Run: `npm test && npm run typecheck && npm run build && npm run test:upgrade && npm run test:layout && npm run test:nav && npm run test:quick-add && npm --prefix desktop run typecheck`
Expected: PASS toate. `test:upgrade` e obligatoriu fiindcă s-a atins `src/main.tsx` (pornirea aplicației).

- [ ] **Step 3: Publicarea site-ului — DOAR cu acordul omului**

Ruta `/quick-add` și puntea trebuie să fie pe `https://horizontal-dyx.pages.dev` înainte de instalare (cutia încarcă site-ul publicat). Fără punte, site-ul se poartă exact ca azi; schimbarea vizibilă pe telefon e doar Task 1 („Gata" nu mai debifează). Cere acordul explicit, apoi `superpowers:finishing-a-development-branch` (merge în `master` + push) și așteaptă deploy-ul Cloudflare (`gh api repos/lightsongjs/Horizontal/commits/<sha>/check-runs` → `Cloudflare Pages: completed success`).

Opțional, în dashboard-ul Cloudflare Pages (Settings → Builds → Build watch paths): exclude `desktop/*`, ca o schimbare doar în cutie să nu redeployeze site-ul. Fără el, un push doar în `desktop/` face un deploy identic — inofensiv.

- [ ] **Step 4: Instalarea**

Run: `npm run desktop:install`
Expected: „Instalat în ~/.local/opt/horizontal". Pornește din meniu (Activities → Horizontal) → login o dată.

- [ ] **Step 5: Lista de verificare, cu omul**

Bifează fiecare cu ce s-a văzut efectiv:

1. Cu terminalul în față: **Ctrl+Shift+A** → bara apare, se scrie imediat, fără click. Repetă peste Chrome.
2. Bara, Esc cu text scris → dispare; Ctrl+Shift+A din nou → câmpul e gol.
3. „test desktop mâine la 10" + Enter → bara dispare; în fereastra principală sarcina e în „Mâine", la 10:00, fără reîncărcare.
4. Wi-Fi oprit: Ctrl+Shift+A → „test offline desktop" + Enter → apare în fereastră cu ID provizoriu (`PREFIX-·`); Wi-Fi pornit → primește numărul real.
5. O sarcină cu memento peste 2 minute → notificarea apare cu **ambele butoane vizibile**; „Amână 5 min" → notificarea dispare și revine după 5 min; „Gata" → sarcina e bifată (și pe telefon, după sincronizare).
6. Click pe corpul notificării → fereastra principală se deschide pe tichet.
7. X pe fereastra principală → dispare, Ctrl+Shift+A merge în continuare.
8. Repornire (logout/login) → aplicația pornește ascunsă; Ctrl+Shift+A merge.
9. Iconița din dash/Activities e cea a Horizontal, nu o rotiță generică. Dacă e generică: Wayland leagă fereastra după `app_id`; notează ce `app_id` raportează (`Looking Glass`: Alt+F2 → `lg` → Windows) și potrivește `StartupWMClass`.

Șterge sarcinile de test. Dacă Chrome-ul de pe laptop e abonat la push, dezactivează notificările site-ului în Chrome (altfel fiecare memento vine de două ori).

- [ ] **Step 6: Curățenie**

Scurtătura TickTick: când omul e mulțumit, poate dezinstala TickTick (Flatpak), ca să nu mai concureze pe Ctrl+Shift+A. Șterge proba de focus: `rm -rf tmp-calibrare/focus-probe` (e ignorată de git, dar ocupă ~250 MB). Worktree-ul: `superpowers:finishing-a-development-branch`.
