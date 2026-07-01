# Command Palette — Sprint Information

**Status:** Paused — de implementat când aduce suficientă valoare  
**Data design-ului:** 2026-07-01  
**Prioritate estimată:** Medium

---

## Ce este

Un command palette VS Code-style declanșat prin `Ctrl+P`, disponibil în interiorul unui proiect. Afișează o listă filtrabilă de comenzi; tastând, comenzile se filtrează fuzzy. Unele comenzi au un sub-selector inline (ex: „Schimbă proiect" → lista de proiecte).

---

## De ce a fost pus pe pauză

Nu aduce suficientă valoare față de costul de implementare în momentul actual. Toate funcționalitățile acoperite de paletă sunt deja accesibile prin shortcut-uri de taste (`O`, `C`, `P`) sau butoane UI.

---

## Comenzi planificate (v1)

| Comandă | Acțiune |
|---|---|
| Caută tichet | Deschide QuickSearch (O key) |
| Creează tichet nou | Deschide formularul de tichet (C key) |
| Schimbă proiect | Sub-selector inline cu lista de proiecte |
| Ascunde/Arată completate | Toggle cu indicator de stare (✓) |
| Activează/Dezactivează tree view | Toggle cu indicator de stare |
| Activează/Dezactivează select mode | Toggle bulk select |
| Mergi la Ordine | Navighează la tab-ul Ordine |

---

## Documente existente

Designul și planul de implementare sunt complet scrise și gata de executat:

- **Spec:** `docs/superpowers/specs/2026-07-01-command-palette-design.md`
- **Plan:** `docs/superpowers/plans/2026-07-01-command-palette.md`

---

## Progres la data pauzei

Tasks 1 și 2 din plan au fost implementate, review-uite și committate pe branch-ul `feat/command-palette` (branch șters, codul pierdut — retart din plan când se reia).

Worktree-ul `.worktrees/command-palette` a fost șters.

---

## Ce trebuie făcut la reluare

1. Creează un nou worktree: `git worktree add .worktrees/command-palette -b feat/command-palette`
2. Urmează planul din `docs/superpowers/plans/2026-07-01-command-palette.md` de la Task 1
3. Folosește `superpowers:subagent-driven-development` pentru execuție

---

## Considerații arhitecturale cheie

- `src/lib/commands.ts` — registry pur (fără React), ușor de extins
- `src/lib/fuzzy.ts` — extras din QuickSearch, shared între paletă și search
- Stările `hideDone`, `treeView`, `selectMode`, `activeTab` trebuie mutate din componente locale în `ui.tsx` — asta e singura modificare mai mare
- Paleta refolosește stilurile `.qs-*` din QuickSearch, adaugă doar `.cp-mode-badge`
- `Ctrl+P` se adaugă **înaintea** guard-ului `if (e.ctrlKey) return` din `App.tsx`

---

## Cum se extinde în viitor

Adăugarea unei comenzi noi = un obiect în `COMMANDS[]` + un `if` în `execute()`. Nu se atinge componenta.

Extensii posibile:
- Paletă globală (și pe ecranul cu lista de proiecte)
- Grupuri de comenzi cu separatori
- Comenzi recent folosite (persist în localStorage)
- Keybinding per comandă
