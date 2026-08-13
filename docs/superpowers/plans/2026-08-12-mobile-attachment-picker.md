# Mobile Attachment Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add camera, gallery, and any-file pickers to the attachments section so a phone can attach files at all.

**Architecture:** A new presentational component, `AttachmentPicker`, owns three hidden `<input type="file">` elements with fixed attributes and exposes a single `onPick(files: File[])` callback. `Attachments.tsx` wires that callback into its existing `addFiles`, so every file — pasted, dropped, or picked — travels the same path. The camera card is gated on a `(pointer: coarse)` media query read through a new `useCoarsePointer` hook.

**Tech Stack:** React 19 + TypeScript, Vite, plain CSS in `src/styles.css`, Vitest (`environment: 'node'`).

**Spec:** `docs/superpowers/specs/2026-08-12-mobile-attachment-picker-design.md`

## Global Constraints

- **No changes to `src/data/`.** The data layer, the SQL migration, and the RLS policies are done and deployed. This plan touches presentation only.
- **No new dependencies.** No jsdom, no icon library, no HEIC converter.
- **UI copy is Romanian**, matching the rest of the app.
- **No size or count caps.** `pickFiles.ts` rejects only zero-byte entries (dragged folders arrive that way) — that is a folder guard, not a size limit, and it stays. Everything else passes through unchanged, and `shrinkImage` still shrinks images that need it. Do not add limits.
- **Icons are inline SVG**, following `src/components/Sidebar.tsx` and `src/components/QuickSearch.tsx`. Do not use emoji for the picker; the emoji in `Attachments.tsx` label file *types*, these are *actions*.
- **Colors come from existing CSS custom properties only:** `--accent`, `--accent-soft`, `--line`, `--surface-2`, `--txt`, `--txt-dim`. No new color literals.
- **Comments explain *why*, in Romanian**, matching the density and voice of `Attachments.tsx` and `pickFiles.ts`. Do not narrate what the code already says.

## A note on testing

**This plan has no unit tests, deliberately.** Vitest runs with `environment: 'node'` in this repo — that is precisely why `src/lib/pickFiles.ts` was written DOM-free. Everything this plan adds is DOM: three inputs, a `.click()`, a `value` reset, a media query. The policy that decides which files are accepted, how oversized files are reported, and how pasted screenshots get named is already covered by the 29 tests in `src/data/attachments.test.ts` plus the `pickFiles` suite, and **none of it changes**.

Adding jsdom to assert that a button calls `click()` would buy nothing.

Each task's gate is therefore: `npm run typecheck` clean, `npm test` still 232 passing (proving nothing regressed), `npm run build` clean. Task 3 adds manual device verification.

---

### Task 1: `useCoarsePointer` hook

**Files:**
- Modify: `src/hooks.ts` (append at end of file, after `useVimNav`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useCoarsePointer(): boolean` — exported from `src/hooks.ts`. Task 2 imports it as `import { useCoarsePointer } from '../hooks'`.

- [ ] **Step 1: Append the hook to `src/hooks.ts`**

`useState` and `useEffect` are already imported at the top of the file (line 1) — do not add imports.

```ts
/**
 * True când pointerul principal e grosier — un deget, nu un mouse.
 *
 * Decide dacă se arată cardul de cameră din AttachmentPicker: `capture` deschide
 * webcamul pe desktop, ceea ce nu e aproape niciodată ce vrei. Detecția e pe
 * capabilitate, nu pe user-agent, fiindcă șirul de user-agent minte și oricum
 * n-ar prinde un dispozitiv hibrid care câștigă sau pierde touchscreen-ul în
 * timpul sesiunii — media query-ul îl urmărește.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => window.matchMedia('(pointer: coarse)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    // Se resincronizează la montare, nu doar la `change`: între citirea din
    // `useState` și abonare poate trece un detach de tastatură, iar evenimentul
    // acela s-ar pierde pentru totdeauna.
    setCoarse(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return coarse
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: exits 0, no output beyond the tsc banner.

- [ ] **Step 3: Verify nothing regressed**

Run: `npm test`
Expected: `Test Files 18 passed (18)`, `Tests 232 passed (232)`

- [ ] **Step 4: Commit**

```bash
git add src/hooks.ts
git commit -m "feat(attachments): useCoarsePointer, so the camera card can know it has a camera"
```

---

### Task 2: `AttachmentPicker` component and its styles

**Files:**
- Create: `src/components/AttachmentPicker.tsx`
- Modify: `src/styles.css` (append after line 3822, the last `.att-msg-x` rule)

**Interfaces:**
- Consumes: `useCoarsePointer(): boolean` from `src/hooks.ts` (Task 1).
- Produces: `AttachmentPicker` — a named export from `src/components/AttachmentPicker.tsx` with props `{ onPick: (files: File[]) => void; disabled?: boolean }`. Task 3 renders it.

- [ ] **Step 1: Create `src/components/AttachmentPicker.tsx`**

```tsx
import { useRef, type ChangeEvent } from 'react'
import { useCoarsePointer } from '../hooks'

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function GalleryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  )
}

/**
 * Alegerea fișierelor, fără să știe nimic despre ce se întâmplă cu ele: nici de
 * Supabase, nici de `issueId`, nici de plafoane, nici de redenumire. Predă un
 * `File[]` și atât.
 *
 * Trei input-uri separate, nu unul cu atribute rescrise înainte de `.click()`.
 * Varianta cu unul singur economisește două noduri și cumpără un bug: Safari
 * citește atributele în momentul gestului, iar React nu garantează că DOM-ul s-a
 * actualizat înainte de apel. Aici ce e scris în JSX e ce vede browserul.
 */
export function AttachmentPicker({
  onPick,
  disabled = false,
}: {
  onPick: (files: File[]) => void
  disabled?: boolean
}) {
  const coarse = useCoarsePointer()
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const anyFile = useRef<HTMLInputElement>(null)

  // Resetul lui `value` nu e igienă, e obligatoriu: fără el, a doua oară când
  // alegi ACELAȘI fișier evenimentul `change` nu se mai declanșează, fiindcă
  // valoarea input-ului n-a variat — iar cardul pare pur și simplu mort.
  //
  // Lista goală înseamnă că ai anulat din dialogul nativ. Anularea nu e eroare,
  // deci nu se raportează nimic.
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) onPick(files)
  }

  return (
    <div className="att-pick">
      <div className="att-pick-cards">
        {/* `capture` exclude `multiple` prin definiția atributului: captura
            pornește camera pentru un singur cadru. De-aia scrie „o poză odată”. */}
        {coarse && (
          <button
            type="button"
            className="att-pick-card"
            disabled={disabled}
            onClick={() => camera.current?.click()}
          >
            <span className="att-pick-ic"><CameraIcon /></span>
            <span className="att-pick-t">Fă o poză</span>
            <span className="att-pick-d">Deschide camera, o poză odată</span>
          </button>
        )}

        <button
          type="button"
          className="att-pick-card"
          disabled={disabled}
          onClick={() => gallery.current?.click()}
        >
          <span className="att-pick-ic"><GalleryIcon /></span>
          <span className="att-pick-t">Din galerie</span>
          <span className="att-pick-d">Poți alege mai multe deodată</span>
        </button>
      </div>

      <button
        type="button"
        className="att-pick-more"
        disabled={disabled}
        onClick={() => anyFile.current?.click()}
      >
        + Alt fișier
      </button>

      <p className="att-pick-hint">
        Poze, PDF-uri, arhive — orice fișier
        {!coarse && (
          <>
            <br />
            Lipește o poză (Ctrl+V) sau trage fișiere aici.
          </>
        )}
      </p>

      <input ref={camera} className="att-pick-input" type="file"
             accept="image/*" capture="environment" onChange={handle} />
      <input ref={gallery} className="att-pick-input" type="file"
             accept="image/*" multiple onChange={handle} />
      <input ref={anyFile} className="att-pick-input" type="file"
             multiple onChange={handle} />
    </div>
  )
}
```

- [ ] **Step 2: Append the styles to `src/styles.css`**

Append after the existing `.att-msg-x` rule (currently line 3822 — the last `att-` rule in the file):

```css
/* --- alegerea fișierelor: cameră / galerie / orice --- */
.att-pick { margin-top: 8px; }
.att-pick-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.att-pick-card { display: grid; justify-items: center; align-content: center; gap: 3px; min-height: 100px; padding: 12px 8px; border: 1px dashed var(--line); border-radius: 10px; background: var(--surface-2); color: var(--txt); cursor: pointer; text-align: center; }
.att-pick-card:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
.att-pick-card:disabled { opacity: 0.5; cursor: default; }
.att-pick-ic { display: grid; place-items: center; width: 36px; height: 36px; margin-bottom: 3px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); }
.att-pick-t { font-size: 13px; font-weight: 600; }
.att-pick-d { font-size: 11px; line-height: 1.3; color: var(--txt-dim); }
.att-pick-more { display: block; width: 100%; min-height: 44px; margin-top: 8px; border: 1px solid var(--line); border-radius: 8px; background: none; color: var(--txt); font-size: 13px; cursor: pointer; }
.att-pick-more:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.att-pick-more:disabled { opacity: 0.5; cursor: default; }
.att-pick-hint { margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: var(--txt-dim); text-align: center; }
.att-pick-input { display: none; }
```

**Deviation from the spec, on purpose:** the spec called for `grid-template-columns: 1fr 1fr` collapsing to one column below a 360 px container. That needs container queries, which this project does not set up, and a viewport media query would be the wrong measurement — the section lives inside a bottom sheet whose width is not the viewport's. `repeat(auto-fit, minmax(150px, 1fr))` achieves the same intent by measuring the actual grid. Cards sit side by side at any realistic phone width and wrap only when genuinely cramped.

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: exits 0.

If `capture="environment"` is rejected, the installed `@types/react` is too old to type it on `<input>`. Do not cast it away — check the version first; React 19 types have supported it for years.

- [ ] **Step 4: Verify nothing regressed and the CSS is valid**

Run: `npm test && npm run build`
Expected: `Tests 232 passed (232)`, then a clean Vite build ending in `files generated`. A CSS syntax error surfaces here as a build warning — read the output, don't skim it.

- [ ] **Step 5: Commit**

```bash
git add src/components/AttachmentPicker.tsx src/styles.css
git commit -m "feat(attachments): camera, gallery and any-file pickers"
```

---

### Task 3: Wire the picker into the attachments section

**Files:**
- Modify: `src/components/Attachments.tsx` — import at line 13, render block at lines 240-244

**Interfaces:**
- Consumes: `AttachmentPicker` from Task 2; the existing `addFiles(types, files)`, `canEdit`, and `busy` already in the component.
- Produces: nothing further. This is the last task.

- [ ] **Step 1: Add the import**

In `src/components/Attachments.tsx`, after the existing `import { Lightbox } from './Lightbox'` (line 13):

```tsx
import { AttachmentPicker } from './AttachmentPicker'
```

- [ ] **Step 2: Replace the empty-state block**

Find this, currently at lines 240-244:

```tsx
      {items.length === 0 && !busy && (
        <p className="att-empty">
          {canEdit ? 'Lipește o poză (Ctrl+V) sau trage fișiere aici.' : 'Niciun fișier.'}
        </p>
      )}
```

Replace it with:

```tsx
      {/* Picker-ul rămâne montat și când există deja fișiere. Regula veche —
          hint doar pe listă goală — făcea imposibil al doilea fișier pe telefon,
          unde nu există nici paste, nici drop. */}
      {canEdit && (
        <AttachmentPicker
          onPick={(files) => void addFiles(['Files'], files)}
          disabled={busy > 0}
        />
      )}
```

`['Files']` is passed literally, exactly as the paste path does at line 160: the files are already in hand, so their presence is asserted rather than sniffed out of `types`. Sniffing `types` only earns its keep on the drop path, where the list is not yet available.

Do not also add a `{items.length === 0 && !busy && !canEdit && <p className="att-empty">Niciun fișier.</p>}` fallback here — it would never render. Past the `!issueId` early return earlier in the component, `canEdit` reduces to `!readOnly`, and the `readOnly && items.length === 0` early return has already fired before this point. A second `<p>` guarded the same way is dead code from the day it's written.

- [ ] **Step 3: Verify it compiles and nothing regressed**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck exits 0; `Tests 232 passed (232)`; clean build.

- [ ] **Step 4: Verify on desktop**

Run: `npm run dev`, open the app, open an **existing** ticket (not an unsaved new one).

- [ ] The camera card is **absent**
- [ ] "Din galerie" and "+ Alt fișier" are present
- [ ] The hint reads `Poze, PDF-uri, arhive — orice fișier` followed by `Lipește o poză (Ctrl+V) sau trage fișiere aici.`
- [ ] Ctrl+V with an image in the clipboard still attaches it
- [ ] Drag & drop of a PDF still attaches it
- [ ] "Din galerie" → pick two images → both appear in the grid
- [ ] Pick the **same** file twice in a row → it attaches both times (this is the `value` reset doing its job)
- [ ] Cancel out of the native dialog → nothing happens, no error message
- [ ] Open a ticket as a read-only member → no picker
- [ ] Open a **new, unsaved** ticket → the message is still `Salvează tichetul, apoi atașează fișiere.`

- [ ] **Step 5: Verify on a phone**

The dev server binds to localhost only. Expose it: `npm run dev -- --host`, then open the printed network URL on a phone on the same Wi-Fi.

- [ ] The camera card **is** present
- [ ] The Ctrl+V hint line is **absent**
- [ ] "Fă o poză" opens the rear camera; the photo lands in the grid
- [ ] "Din galerie" allows selecting several photos at once; all appear
- [ ] "+ Alt fișier" attaches a PDF, shown with the 📄 icon
- [ ] Tapping a photo opens the lightbox
- [ ] Cards are at least 44 px tall and comfortable to hit

If the camera card does not appear, check `matchMedia('(pointer: coarse)')` in the phone's dev console before touching the component — a desktop browser's mobile emulation reports a coarse pointer, but a real device is the only honest signal.

- [ ] **Step 6: Commit**

```bash
git add src/components/Attachments.tsx
git commit -m "feat(attachments): a phone can finally attach a file"
```

---

## Done when

All three tasks are committed, `npm run typecheck && npm test && npm run build` is clean, and every checkbox in Task 3 Steps 4 and 5 is ticked on real hardware.

Known limitation, accepted and documented in the spec: iPhone photos arrive as HEIC, which Chrome on Android cannot decode on a canvas, so such a file uploads unshrunk. It still uploads.
