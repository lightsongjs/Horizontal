# DepFlow — Status proiect

_Ultima actualizare: 2026-06-28_

Tool mobile-first de planificare: proiecte → tichete → dependențe. Calculează
automat **ordinea de lucru (layere)** din dependențe și organizează livrarea pe
**valuri (sprinturi)**.

Cele 3 unghiuri:
- **Layer** = calculat din dependențe ("ce pot începe acum"). Read-only.
- **Val** = sprint setat manual de tine ("ce livrez acum").
- **Temă** = etichetă/categorie colorată, per proiect, gestionată de tine.

---

## Stadiu: Faza 1 + Faza 2 — GATA ✅
Ecranele Ordine, Graf și Teme sunt toate funcționale.

### Model de date (varianta agreată)
- **Tichet (issue)**: titlu, descriere, val, gata/nu, dependențe. **Fără tip,
  fără epic, fără sub-tichete.**
- **Dependențe în ambele direcții**: „depinde de X" și „blochează X"
  (= X depinde de el).
- **Valuri**: per proiect, gestionate de tine (adaugă/redenumește/șterge).
  Proiect nou pornește automat cu „Val 1".
- **Proiecte**: multiple, fiecare cu valurile și tichetele lui.
- **Zero date mockup** — pornești gol.

### Ce funcționează
- Login simplu (un singur user, creat manual în Supabase). Fără signup, fără
  logout (sesiunea persistă).
- Listă proiecte + creare proiect.
- Detaliu proiect cu 3 tab-uri: **Ordine / Graf / Teme**.
- **Ordine**: selector de valuri (cu ⚙ pentru gestionare) + layere calculate
  automat, cu badge „Acum / Începe aici" pe layer 0.
- **Graf**: graficul de dependențe (noduri stânga→dreapta pe adâncime, colorate
  după temă, cu stările done/active/blocked), scroll orizontal.
- **Teme**: per proiect, gestionare completă (adaugă/redenumește/recolorează/
  șterge), filtrare pe temă, bulină colorată pe tichete. La ștergerea unei teme,
  tichetele rămân fără temă (nu se șterg).
- Tichete: adaugă / editează / șterge / bifează gata / mută pe alt val / temă.
- Dependențe în ambele direcții; fișa unui tichet arată „Depinde de" (toate
  valurile, cu tag de val) + „Deblochează".
- Persistență reală în Supabase (Postgres) + fallback localStorage pentru dev.

### ⚠️ Migrare necesară pentru Teme (dacă ai rulat deja schema veche)
Rulează o dată în SQL Editor: `supabase/migration-themes.sql` (adaugă tabela
`themes` + coloana `issues.theme`). Pe proiecte noi, `schema.sql` deja le conține.

---

## Stack & structură
- **Frontend**: React + Vite + TypeScript.
- **Persistență**: Supabase (Postgres). Schema în `supabase/schema.sql`.
- **Engine pur** (fără I/O): `src/lib/engine.ts`.

```
src/
  lib/        types.ts · engine.ts (+ test) · seed.ts · supabase.ts
  data/       repository.ts (interfață) · localRepository · supabaseRepository (+ teste)
  components/ ProjectsView · OrdineView · TicketCard · IssueSheet · IssueForm
              · ProjectForm · WaveManager · SheetHost · Login
  store.tsx   stare globală + mutații + selectori derivați
  auth.tsx    auth Supabase (gate de login)
  ui.tsx      controller pentru bottom sheets
supabase/     schema.sql · seed.sql
```

---

## Teste: 32 verzi
| Zonă | Nr. | Acoperă |
|---|---|---|
| Engine | 17 | layere/ordine, cross-wave, stări done/active/blocked, deblocări, procent, **cicluri** (computeLayers + `detectCycle` global), scenariul „depinde de + blochează" |
| localRepository | 7 | seed, creare proiect + Val 1, CRUD valuri, ID-uri secvențiale, update, ștergere cu curățarea deps, **CRUD teme + ștergere temă curăță tichetele** |
| supabaseRepository (mock) | 8 | maparea `details`↔`desc` + `theme`, asamblarea deps, createProject+val, coloane createIssue, înlocuire deps, **createTheme/listThemes/deleteTheme**, delete |

Plus: typecheck curat + verificări Playwright e2e pe backend local (creare/editare
tichet, mutare val, adăugare val, scenariul depinde-de+blochează).

**NEACOPERIT (cinstit):** round-trip live către Supabase-ul real (schemă, RLS,
rețea). Sandbox-ul de dezvoltare e blocat de la `supabase.co`, deci primul test
real al bazei se face manual pe app-ul deployat.

---

## Deploy & infra
- **Cod**: GitHub `lightsongjs/Horizontal`, branch `master` (repo public).
- **Hosting**: Cloudflare Pages (de conectat la repo: build `npm run build`,
  output `dist`). Variabilele de build sunt deja în `.env.production`.
- **DB**: Supabase, schema rulată ✅. Cheia e *publishable* (publică prin design;
  datele protejate de RLS „authenticated").

### Checklist după ce pornește Cloudflare
1. Creează userul de login în Supabase: Authentication → Users → Add user
   (+ „Auto Confirm User").
2. Deschide URL-ul `*.pages.dev`, loghează-te.
3. Smoke test live: creează proiect → 2 tichete legate (unul depinde de altul)
   → refresh → verifică că persistă și ordinea e corectă.

---

## Ce mai trebuie făcut (backlog)

### Gata ✅
- [x] **Teme** (Faza 2): tab + gestionare + bulină colorată + filtrare.
- [x] **Graf** (Faza 2): grafic vizual de dependențe.
- [x] **Protecție valuri orfane**: ștergerea unui val cu tichete e blocată, cu
      mesaj („mută întâi tichetele").
- [x] **Prevenire cicluri**: la salvarea unui tichet, dacă dependențele ar crea
      un ciclu, salvarea e oprită și se arată traseul ciclului.

### Rafinări / nice-to-have
- [ ] Reordonare valuri (drag & drop).
- [ ] Editare / ștergere proiect; setare „val curent".
- [ ] „Adaugă dependență tastând un nume nou" (acum se aleg tichete existente).
- [ ] Căutare / filtrare tichete.
- [ ] Test live automat pe Supabase (necesită deschiderea network policy spre
      `*.supabase.co` sau un mediu CI cu acces).

---

## Rulare locală
```bash
npm install
cp .env.example .env     # completează cheile; VITE_DATA_SOURCE=supabase
npm run dev              # http://localhost:5173
npm run test             # rulează testele
```
Lasă `VITE_DATA_SOURCE=local` (sau gol) ca să rulezi pe date seed în
localStorage, fără credențiale.
