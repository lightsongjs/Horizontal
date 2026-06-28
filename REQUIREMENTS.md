# DepFlow — Build Specification

A mobile-first project-planning tool for developers. Manages projects → issues → dependencies, computes build order automatically, and organizes delivery into **waves (sprints)**. Inspired by Linear (density, clarity, calm motion) and Asana (epics with sub-tasks grouped by theme).

> This document is the source of truth. Build against it. `data-model.json` holds the seed/example data and the exact shape every entity must follow.

---

## 1. Core concepts (read this first)

There are four ideas. Getting these right is the whole product.

1. **Issue** — the single unit of work. One type, with a `type` field (`external` | `task` | `epic`). An epic is just an issue that has children. No separate models.
2. **Dependency** — a directed edge between two issues: "A depends on B" means B must be done before A. Dependencies are **global** — they never disappear, regardless of wave.
3. **Layer** — computed, read-only. The topological depth of an issue. Layer 0 = depends on nothing; Layer N = max(layer of its dependencies) + 1. Answers "what can I start now."
4. **Wave** — a delivery sprint, set **manually** by the user (Val 1 = MVP, Val 2 = Dashboard, etc.). Answers "what am I shipping now." Independent from layer.

**The key rule that makes this tool useful:**
- The main "Ordine" view is **filtered by the active wave**. Layers are recomputed using **only the issues in that wave**. So while building the MVP, the user sees only MVP work, in dependency order.
- But when the user **opens any issue**, the detail sheet shows **all** of its dependencies across **all** waves. A dependency already shipped in an earlier wave appears marked done (e.g. "Val 1 · ✓") — it does not vanish and does not block the current view.

---

## 2. Functional requirements

### FR-1 Projects
- FR-1.1 List all projects on the home screen, each with: name, description, completion %, theme tags, accent color.
- FR-1.2 Completion % = done issues / total issues for that project.
- FR-1.3 Tapping a project opens its detail view.
- FR-1.4 Create a new project (name, description, issue-ID prefix e.g. `TUR`).

### FR-2 Project detail — three tabs
- FR-2.1 **Ordine** (default): wave selector + computed layers.
- FR-2.2 **Graf**: visual dependency graph (nodes + directional edges), horizontally scrollable.
- FR-2.3 **Teme**: issues grouped by theme, filterable by theme chip.

### FR-3 Waves (the delivery axis)
- FR-3.1 Each issue has a `wave` (integer ≥ 1). Default new issues to the project's current wave.
- FR-3.2 Wave selector at the top of "Ordine" lists every wave with name, sub-label, and issue count.
- FR-3.3 Selecting a wave filters the "Ordine" view to issues in that wave only.
- FR-3.4 User can change an issue's wave manually ("mală pe sprintul viitor").

### FR-4 Layers (computed build order)
- FR-4.1 Layer = topological depth, computed **only from issues within the active wave** (dependencies pointing to other waves are ignored for layer math).
- FR-4.2 Layer 0 of the active wave renders with an "Acum / Începe aici" badge.
- FR-4.3 Recompute automatically whenever a dependency or wave changes.
- FR-4.4 Cycle protection: if dependencies form a cycle, surface a clear error rather than infinite-looping.

### FR-5 Issue states
- FR-5.1 `done` (manual checkbox), `active` (all deps done, not yet done), `blocked` (≥1 dep not done).
- FR-5.2 State is derived, except `done` which is user-set.
- FR-5.3 Toggling done updates dependent issues' states and project %.

### FR-6 Issue detail sheet (bottom sheet)
- FR-6.1 Shows title, type, wave, description.
- FR-6.2 **Depinde de**: lists ALL dependencies across all waves. Each row shows the dep's title + a wave tag; done deps marked "✓".
- FR-6.3 **Sub-tichete** (epics only): list of children, with add control.
- FR-6.4 **Deblochează**: issues that depend on this one (reverse edges), each with its wave tag.
- FR-6.5 Add a dependency inline by typing only a name → creates a new issue with that name, no other fields required.

### FR-7 Create / edit issue (tall sheet)
- FR-7.1 Fields: Titlu (text), Detalii (multiline textarea), Temă (chip picker), Wave.
- FR-7.2 Theme chips include a "+ Temă nouă" affordance at the end → type name → new theme created with a color.
- FR-7.3 "Depinde de" and "Blochează" sections: add issue by name only (inline, no extra detail). Enter or button commits; each added row is removable.
- FR-7.4 Save persists the issue and recomputes layers/graph.

### FR-8 Themes
- FR-8.1 A theme has a name + color. Issues reference a theme.
- FR-8.2 Teme tab: chip row (incl. "Toate"), filtered list grouped by theme with counts.
- FR-8.3 Create theme inline from anywhere a theme is picked.

### FR-9 Graph
- FR-9.1 Render issues as nodes, dependencies as arrows (left→right by layer).
- FR-9.2 Node shows id, short title, theme color accent, and done state.
- FR-9.3 Horizontally scrollable on mobile. (Enhancement: dim nodes outside the active wave.)

---

## 3. Non-functional requirements

- NFR-1 **Mobile-first.** Primary target is phone. Single column, max content width ~480px, large tap targets (≥44px), bottom sheets for detail.
- NFR-2 **Persistence.** Real storage required (the working demo was an in-memory mock). Use a real store — see §5.
- NFR-3 **Performance.** Layer computation runs on the client; memoize. Must handle a few hundred issues without lag.
- NFR-4 **Accessibility.** Visible keyboard focus, respects reduced-motion, sufficient contrast.
- NFR-5 **Offline-tolerant** is a plus, not required for v1.

---

## 4. Design system (from the working prototype)

Dark, calm, dense. Tokens:

| Token | Value | Use |
|---|---|---|
| bg | `#0c0d12` | app background |
| surface | `#14151c` | cards |
| surface-2 | `#1b1d27` | inputs, inner rows |
| line | `#262833` | borders |
| txt | `#e8e9ee` | primary text |
| txt-dim | `#9296a6` | secondary |
| txt-faint | `#5d6173` | tertiary / ids |
| accent | `#6e7bff` | primary / Auth theme |
| done | `#3ecf8e` | done state / DB theme |
| blocked | `#ff6b6b` | blocked / Expense theme |
| active | `#ffb454` | active / Email theme |

- Type: Inter (or system). IDs in a monospace face.
- Radius: cards ~14px, inner rows ~9-11px, sheets 22px top corners.
- Motion: subtle fades (.25–.34s), bottom-sheet slide-up, no decorative animation.
- Signature element: the **wave selector + auto-computed layer stack** is the memorable core — keep it crisp.

---

## 5. Suggested tech (adjust to your stack)

- Frontend: React (or your framework). The prototype is a single HTML file — treat it as a visual reference, not the architecture.
- State: keep the issue graph in a normalized store; derive layers/states with selectors.
- Persistence: Supabase (Postgres) fits the example project well. Tables: `projects`, `issues`, `dependencies` (issue_id, depends_on_id), `themes`. `children` can be modeled as issues with a `parent_id`.
- The whole layer/wave algorithm is in `data-model.json` comments and §1 — port it directly.

---

## 6. Build order for the AI (do these in sequence)

1. Data layer: schema for projects, issues, dependencies, themes (see `data-model.json`).
2. Layer/wave engine: pure functions `computeLayers(issues, wave)` and `deriveState(issue)`. Unit-test against `data-model.json` (expected output is documented there).
3. Project list screen (FR-1).
4. Project detail shell + tabs (FR-2).
5. Ordine tab: wave selector + layer rendering (FR-3, FR-4, FR-5).
6. Issue detail sheet with cross-wave deps (FR-6).
7. Create/edit issue sheet (FR-7) incl. inline theme + inline dep creation.
8. Teme tab (FR-8).
9. Graph tab (FR-9).
10. Persistence wiring (NFR-2).

Ship after step 5 as the first usable slice — that alone delivers the core value.
