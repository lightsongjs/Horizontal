# Data din titlu, și la editare — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recunoașterea datei din titlu funcționează și la editarea unui tichet existent, unde suprascrie scadența — dar numai ca urmare a unei tastări în titlu, și retrăgându-se la valoarea dinainte dacă fragmentul dispare.

**Architecture:** Regula de decizie iese din efectul React și devine o funcție pură (`src/lib/titleDueFill.ts`) care primește câmpurile curente, ce a recunoscut parserul și memoria de dinainte, și întoarce ce se scrie în câmpuri plus memoria nouă. `IssueForm.tsx` păstrează starea React și o singură stare nouă, `titleTyped`, care înlocuiește cele două excepții de azi (`isEdit`, `dueOwned`).

**Tech Stack:** TypeScript, React, Vitest. Fără dependențe noi.

**Spec:** `docs/superpowers/specs/2026-09-11-data-din-titlu-la-editare-design.md`

## Global Constraints

- Romanian in all comments, JSDoc, commit messages and UI copy. Match the density and tone of the surrounding code in `src/lib/` and `src/components/IssueForm.tsx`.
- `src/lib/` modules are pure: no React imports, no `Date.now()` hidden inside decisions that tests need to pin.
- Nu se face `git push`. Push pe `master` publică în producție (vezi `CLAUDE.md`); acest plan se oprește la commit local.
- `git add` enumeră fișiere, niciodată `-A`.
- Commit-uri convenționale: `feat:`, `fix:`, `refactor:`, `docs:`.

## Descoperire care simplifică Task 2

`setDueOwned` nu e apelat nicăieri în `IssueForm.tsx`. `dueOwned` se
inițializează cu `!!existing?.dueAt` și rămâne neschimbat, deci e adevărat doar
când `existing` există, adică exact când `isEdit` e adevărat. Prin urmare
`!isEdit && !dueOwned` e identic cu `!isEdit`, iar `titleDate.active && !dueOwned
&& !isEdit` e identic cu `titleDate.active && !isEdit`. Ștergerea lui `dueOwned`
nu schimbă niciun comportament observabil azi — e curățenie care face loc noii
reguli.

## File Structure

- `src/lib/titleDueFill.ts` — **nou.** Regula pură: ce se scrie în câmpurile de scadență și ce se reține, dat fiind ce zice titlul. Fără React, fără `Date`.
- `src/lib/titleDueFill.test.ts` — **nou.** Fixtures pentru cele șapte tranziții din spec.
- `src/components/IssueForm.tsx` — **modificat.** Scoate `dueOwned`, adaugă `titleTyped`, cheamă funcția pură din efect.

---

### Task 1: Regula pură `fillFromTitle`

**Files:**
- Create: `src/lib/titleDueFill.ts`
- Test: `src/lib/titleDueFill.test.ts`

**Interfaces:**
- Consumes: nimic din alte task-uri.
- Produces: `DueFields` (`{ date: string; time: string }`), `FillMemo` (`{ wrote: DueFields; before: DueFields }`), `FillResult` (`{ fields: DueFields; memo: FillMemo | null }`), și `fillFromTitle(fields: DueFields, recognized: DueFields | null, memo: FillMemo | null): FillResult`. Task 2 le importă pe toate patru.

- [ ] **Step 1: Write the failing test**

Create `src/lib/titleDueFill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fillFromTitle, type FillMemo } from './titleDueFill'

const F = (date: string, time: string) => ({ date, time })
const EMPTY = F('', '')

describe('fillFromTitle — tichet nou', () => {
  it('completează câmpurile goale din titlu și ține minte că erau goale', () => {
    const r = fillFromTitle(EMPTY, F('14/09/2026', '14:00'), null)
    expect(r.fields).toEqual(F('14/09/2026', '14:00'))
    expect(r.memo).toEqual({ wrote: F('14/09/2026', '14:00'), before: EMPTY })
  })

  it('golește câmpurile când titlul rămâne fără dată', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: EMPTY }
    const r = fillFromTitle(F('14/09/2026', '14:00'), null, memo)
    expect(r.fields).toEqual(EMPTY)
    expect(r.memo).toBeNull()
  })
})

describe('fillFromTitle — tichet cu scadență', () => {
  it('suprascrie scadența existentă și o ține minte ca bază', () => {
    const r = fillFromTitle(F('08/09/2026', '10:00'), F('14/09/2026', '14:00'), null)
    expect(r.fields).toEqual(F('14/09/2026', '14:00'))
    expect(r.memo).toEqual({
      wrote: F('14/09/2026', '14:00'),
      before: F('08/09/2026', '10:00'),
    })
  })

  it('revine la scadența dinainte când fragmentul dispare din titlu', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: F('08/09/2026', '10:00') }
    const r = fillFromTitle(F('14/09/2026', '14:00'), null, memo)
    expect(r.fields).toEqual(F('08/09/2026', '10:00'))
    expect(r.memo).toBeNull()
  })

  it('păstrează baza peste o a doua recunoaștere', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: F('08/09/2026', '10:00') }
    const r = fillFromTitle(F('14/09/2026', '14:00'), F('15/09/2026', ''), memo)
    expect(r.fields).toEqual(F('15/09/2026', ''))
    expect(r.memo).toEqual({ wrote: F('15/09/2026', ''), before: F('08/09/2026', '10:00') })
  })
})

describe('fillFromTitle — câmpul schimbat cu mâna', () => {
  it('nu retrage nimic dacă valorile nu mai sunt cele scrise de recunoaștere', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: EMPTY }
    const r = fillFromTitle(F('20/09/2026', '09:00'), null, memo)
    expect(r.fields).toEqual(F('20/09/2026', '09:00'))
    expect(r.memo).toBeNull()
  })

  it('ia valoarea scrisă cu mâna ca bază nouă', () => {
    const memo: FillMemo = { wrote: F('14/09/2026', '14:00'), before: EMPTY }
    const r = fillFromTitle(F('20/09/2026', '09:00'), F('15/09/2026', ''), memo)
    expect(r.memo).toEqual({ wrote: F('15/09/2026', ''), before: F('20/09/2026', '09:00') })
  })
})

describe('fillFromTitle — fără memorie', () => {
  it('fără dată în titlu și fără memorie, câmpurile rămân neatinse', () => {
    const r = fillFromTitle(F('08/09/2026', '10:00'), null, null)
    expect(r.fields).toEqual(F('08/09/2026', '10:00'))
    expect(r.memo).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/titleDueFill.test.ts`
Expected: FAIL — `Failed to resolve import "./titleDueFill"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/titleDueFill.ts`:

```ts
/**
 * Ce scrie recunoașterea din titlu în câmpurile de scadență — și ce are voie
 * să retragă.
 *
 * Regula e pură și stă aici, nu în formular, pentru că e singurul loc unde se
 * decide dacă o scadență existentă se pierde. Trei intrări, două ieșiri, nicio
 * referință la React sau la ceasul sistemului: tot ce ține de „azi" s-a
 * întâmplat deja în `parseDue`.
 */

/** Câmpurile de scadență, exact în forma pe care o scrie omul. */
export interface DueFields {
  /** `zz/ll/aaaa`, sau gol. */
  date: string
  /** `HH:MM`, sau gol — gol înseamnă toată ziua. */
  time: string
}

/** Ce a completat recunoașterea, și peste ce a completat. */
export interface FillMemo {
  /** Valorile scrise de recunoaștere. */
  wrote: DueFields
  /** Valorile dinaintea primei completări — ce se pune înapoi la retragere. */
  before: DueFields
}

export interface FillResult {
  /** Ce trebuie să ajungă în câmpuri. */
  fields: DueFields
  /** Memoria de dus mai departe. `null` = nu mai e nimic de retras. */
  memo: FillMemo | null
}

const same = (a: DueFields, b: DueFields) => a.date === b.date && a.time === b.time

/**
 * @param fields ce e ACUM în câmpuri
 * @param recognized ce a înțeles parserul din titlu, sau `null` dacă titlul nu
 *   mai conține o dată (ori fragmentul a fost refuzat)
 * @param memo ce s-a completat data trecută
 *
 * Titlul e stăpânul: o dată recunoscută suprascrie orice, inclusiv o scadență
 * aleasă cândva din calendar. Ce face schimbarea reversibilă e `before` —
 * ștergerea fragmentului din titlu pune înapoi valoarea dinainte, nu golul.
 *
 * `mine` e condiția care ține retragerea onestă: dacă omul a schimbat câmpul cu
 * mâna după ce am completat noi, valoarea nu mai e a noastră. Atunci nu se
 * retrage nimic, iar la următoarea completare ea devine noua bază — baza e
 * întotdeauna ultima valoare pe care n-am scris-o noi.
 */
export function fillFromTitle(
  fields: DueFields,
  recognized: DueFields | null,
  memo: FillMemo | null,
): FillResult {
  const mine = memo !== null && same(fields, memo.wrote)
  if (recognized) {
    return { fields: recognized, memo: { wrote: recognized, before: mine ? memo!.before : fields } }
  }
  return { fields: mine ? memo!.before : fields, memo: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/titleDueFill.test.ts`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: fără erori.

- [ ] **Step 6: Commit**

```bash
git add src/lib/titleDueFill.ts src/lib/titleDueFill.test.ts
git commit -m "feat(scadenta): regula pura de completare a scadentei din titlu"
```

---

### Task 2: Cablarea în formular

**Files:**
- Modify: `src/components/IssueForm.tsx` — liniile 281-301 (starea), 375-411 (efectul), 413-423 (`cleanTitleFromDate`), 823-824 (inputul de titlu), 1092 (jetonul „din titlu")

**Interfaces:**
- Consumes: `fillFromTitle`, `FillMemo` din `src/lib/titleDueFill` (Task 1).
- Produces: nimic pentru task-uri următoare — e ultimul.

- [ ] **Step 1: Importă modulul nou**

În blocul de importuri din `src/components/IssueForm.tsx`, lângă celelalte importuri din `../lib/`, adaugă:

```ts
import { fillFromTitle, type FillMemo } from '../lib/titleDueFill'
```

- [ ] **Step 2: Înlocuiește `dueOwned` și `autoFilled` cu `titleTyped` și `fillMemo`**

Șterge liniile 281-291 (JSDoc-ul lui `dueOwned`, declarația lui, și declarația lui `autoFilled`) și pune în loc:

```ts
  /**
   * A atins omul câmpul de titlu în această deschidere a formularului?
   *
   * Singura poartă a recunoașterii, în locul vechilor `isEdit`/`dueOwned`.
   * Titlul e stăpânul scadenței — o dată scrisă în titlu rescrie și o scadență
   * aleasă cândva din calendar — dar numai ca URMARE A UNEI TASTĂRI. Fără
   * condiția asta, deschiderea unui tichet vechi i-ar muta scadența singură:
   * fragmentul „la 2p" rămas în titlu se recalculează față de ziua de azi, nu
   * față de ziua în care a fost scris.
   */
  const [titleTyped, setTitleTyped] = useState(false)
  /** Ce am completat noi și peste ce — vezi `lib/titleDueFill`. */
  const fillMemo = useRef<FillMemo | null>(null)
```

- [ ] **Step 3: Deschide recunoașterea la editare**

Înlocuiește liniile 292-301 (JSDoc-ul și apelul `useTitleDate`) cu:

```ts
  /**
   * Recunoașterea datei din titlu, cu evidențiere în input și refuz pe fragment
   * — același hook ca la adăugarea rapidă, ca gestul să fie unul singur în toată
   * aplicația. O singură condiție: să fi tastat cineva în titlu. La un tichet
   * nou asta e oricum adevărat înainte să existe o dată de recunoscut.
   */
  const titleDate = useTitleDate(title, {
    enabled: canWrite && titleTyped,
    onChange: (next) => {
      setTitleTyped(true)
      setTitle(next)
    },
  })
```

- [ ] **Step 4: Rescrie efectul**

Înlocuiește efectul de la liniile 375-411 (inclusiv JSDoc-ul lui, care începe cu explicația „NUMAI la tichete noi") cu:

```ts
  /**
   * Titlul → câmpurile de scadență.
   *
   * Decizia nu e aici: e în `fillFromTitle`, ca să fie testabilă fără DOM. Aici
   * rămâne doar traducerea — ISO-ul parserului în textul câmpurilor, și înapoi.
   *
   * `dueText`/`timeText` se citesc din randarea curentă, dar NU sunt dependențe:
   * efectul trebuie să reacționeze la titlu, nu la propriile scrieri, altfel se
   * învârte. `rejectedKey` E dependență: un fragment refuzat trebuie să retragă
   * imediat ce completase.
   */
  useEffect(() => {
    if (!canWrite || !titleTyped) return
    const parsed = titleDate.parsed
    const recognized =
      titleDate.active && parsed.dueAt
        ? { date: toDisplayDate(parsed.dueAt), time: parsed.allDay ? '' : toTimeInput(parsed.dueAt) }
        : null
    const next = fillFromTitle({ date: dueText, time: timeText }, recognized, fillMemo.current)
    fillMemo.current = next.memo
    setDueText(next.fields.date)
    setTimeText(next.fields.time)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, titleDate.rejectedKey, canWrite, titleTyped])
```

- [ ] **Step 5: Mută `cleanTitleFromDate` pe memoria nouă**

În `cleanTitleFromDate` (fost la linia 421), înlocuiește `autoFilled.current = null` cu:

```ts
    fillMemo.current = null
```

Comentariul de deasupra rămâne, dar propoziția care menționează `dueOwned` nu mai are obiect. Înlocuiește tot comentariul cu:

```ts
    // Uităm ce am completat: scadența aplicată devine definitivă, exact ca una
    // scrisă cu mâna. Uitarea e de ajuns — efectul nu mai are ce retrage când
    // titlul rămâne fără dată, iar o altă dată scrisă mai târziu în titlu se
    // aplică din nou.
```

- [ ] **Step 6: Marchează tastarea în inputul de titlu**

La linia 824, înlocuiește:

```tsx
            onChange={(e) => setTitle(e.target.value)}
```

cu:

```tsx
            onChange={(e) => {
              setTitleTyped(true)
              setTitle(e.target.value)
            }}
```

- [ ] **Step 7: Curăță gardul jetonului „din titlu"**

La linia 1092, înlocuiește:

```tsx
              {titleDate.active && !dueOwned && !isEdit && (
```

cu:

```tsx
              {titleDate.active && (
```

`titleDate.active` e deja fals cât timp `enabled` e fals, deci gardul dublu ar fi doar zgomot.

- [ ] **Step 8: Verifică că `dueOwned` a dispărut complet**

Run: `npx rg "dueOwned|autoFilled" src/`
Expected: zero rezultate. Dacă mai apare ceva, e o referință rămasă — șterge-o.

- [ ] **Step 9: Typecheck și teste**

Run: `npm run typecheck && npm test`
Expected: fără erori de tipuri; toate testele trec, inclusiv `parseDue`, `schedule` și noul `titleDueFill`.

- [ ] **Step 10: Trecere manuală**

Run: `npm run dev`

Pe un tichet care ARE scadență, în formularul mare:

1. Deschide-l. Scadența rămâne neatinsă, niciun fragment nu e evidențiat în titlu. *(Dacă se schimbă ceva aici, poarta `titleTyped` nu ține.)*
2. Tastează o literă în titlu, apoi scrie „luni la 14". Fragmentul se evidențiază, câmpul de scadență devine lunea următoare, ora 14:00.
3. Șterge „luni la 14" din titlu. Scadența revine la valoarea de la pasul 1.
4. Scrie-o din nou, apoi apasă „nu e o dată" pe jetonul din titlu. Scadența revine iar la valoarea de la pasul 1.
5. Scrie-o a treia oară și salvează. Redeschide tichetul: scadența e lunea, și nu se mișcă la deschidere.

- [ ] **Step 11: Commit**

```bash
git add src/components/IssueForm.tsx
git commit -m "feat(scadenta): data din titlu se aplica si la editarea tichetului"
```

---

## Ce NU se atinge

- `src/hooks.ts` / `useTitleDate` — `enabled` era deja parametru; se schimbă doar expresia care îl calculează.
- `src/lib/parseDue.ts`, `src/lib/schedule.ts` — neatinse.
- `QuickAdd.tsx` — acolo tichetul e mereu nou, iar titlul pornește gol.
- `npm run test:layout` / `test:nav` — nu ating zona asta; nu se rulează.
- Ștergerea automată a fragmentului din titlu la salvare — în afara scopului, vezi specul.
