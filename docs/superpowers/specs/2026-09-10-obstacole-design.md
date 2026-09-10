# Obstacole — design

**Data:** 10 septembrie 2026. **Mockup:** `prototype-obstacole.html`.
**Cazul de probă:** dosarul `SB_MCP` (server MCP SmartBill) — blocantele B1–B5,
cele 30 de decizii cu „cine decide", Faza 0 „Deblocare și verificare".

## Problema

Layerul spune „ce pot începe acum" **doar** din dependențe între tichete. În valul
activ, cinci tichete în layer 0 arată identic, deși trei dintre ele nu se pot
începe — nu fiindcă lipsește muncă, ci fiindcă lipsește un **răspuns**, o
**decizie** sau o **resursă a altei echipe**.

Modelul de azi nu poate exprima asta. Un „nu știm încă X" se poate scrie ca tichet,
dar atunci intră în estimare, în layere și în valuri, iar owner-ul real („echipa de
API", „juridic") n-are unde să stea. Iar consecința cea mai scumpă e alta: nu există
răspuns la întrebarea pe care o pune un director — *„de unde am plecat și ce am
rezolvat?"*.

## Ce e un obstacol

O **condiție** care trebuie să cadă înainte ca munca să înceapă. Nu e muncă: nu se
estimează, nu are val, nu are layer, și de obicei nu o rezolvă cel care ține
tichetul.

Patru forme, toate din dosarul MCP:

| formă | exemplu | se închide prin |
|---|---|---|
| necunoscut | B1 „există endpoint de listare facturi?" | un răspuns primit |
| decizie neluată | #13 „care firmă? (CIF)" | un om care hotărăște |
| lipsă externă | #12 „nu avem authorization server" | altă echipă, sau o ocolire |
| constatare de verificat | B2 „revizia 2026-07-28 e o rescriere" | citirea sursei |

### Stări

`necunoscut` → `asteptare` → `depasit` | `ocolit`

- **necunoscut** — n-am întrebat / n-am verificat încă.
- **asteptare** — am întrebat, aștept răspuns. Diferența față de `necunoscut` e
  singura pe care un PM o poate acționa azi.
- **depasit** — s-a răspuns, s-a decis, s-a verificat.
- **ocolit** — nu s-a rezolvat, dar munca a mers pe lângă el. Distincția e
  literal în dosar: B1 „nu are ocolire", #12 „are ocolire documentată — dar nu e
  gratuită".

Un obstacol `depasit` sau `ocolit` **nu deblochează** singur nimic dacă mai există
altul deschis pe același tichet; și **rămâne pe hartă**, tăiat. Ștergerea ar face
harta incapabilă să arate progres.

### Câmpul `blocking`

#3 și #4 din dosar au fost marcate „nu blochează", apoi promovate la blocante.
Deci „blochează?" e o proprietate care se schimbă în timp, nu o consecință a
existenței obstacolului. Un obstacol cu `blocking = false` se vede pe hartă și în
poartă, dar nu stinge niciun tichet.

### Dependențe între obstacole

`#1 → #19 → 1.1`: „dacă nu știm cine e utilizatorul, nu știm câte tool-uri
expunem, deci nu putem scrie tool-urile". Un obstacol poate depinde de alt
obstacol. Și invers: `0.2 → #19` — un tichet de muncă (oracolul Notion) a cărui
livrare e depășirea unui obstacol. **Muncă → obstacol e o direcție reală**, nu o
eroare de modelare.

Regula derivată: un obstacol e „efectiv deschis" dacă starea lui e deschisă **sau**
oricare obstacol de care depinde e efectiv deschis. Ciclurile se refuză la scriere,
ca la dependențele de tichete (`detectCycle`).

## De ce nu e tichet

Întrebarea e firească — mecanica de blocare există deja, prin `deps`. Răspunsul
decisiv vine dintr-o regulă a aplicației, nu dintr-o preferință:

**Un tichet trebuie să aibă val.** B1 ar sta în Faza 0, iar în „Ordine" pe Faza 1
— unde chiar blochează — n-ar apărea deloc: dependențele între valuri nu blochează
vizualizarea filtrată pe val (`REQUIREMENTS.md` §1, `CLAUDE.md`). Exact acolo unde
obstacolul trebuie să se vadă, ar dispărea.

Restul urmează: B1 ar intra în numărătoarea Fazei 1 („7 tichete" când sunt 6 de
muncă) și în `projectCompletion`, deci o întrebare fără răspuns ar arăta ca muncă
nefăcută. „Echipa de API" ar trebui să fie cont în `assignees`. Și `ocolit` n-ar
avea echivalent — un tichet e făcut sau nu, iar „am mers pe lângă el, cu un cost"
ar trebui bifat ca gata.

## Ce NU se schimbă

`computeLayers` rămâne neatins. Obstacolele nu au val, deci nu intră în el.
Layerul unui tichet nu se mișcă niciodată la depășirea unui obstacol — altfel
numărul layerului, singurul lucru stabil din aplicație, ar depinde de viteza cu
care răspund alte echipe.

`deriveState` rămâne neatins: `blocked` continuă să însemne „are dependențe
nefăcute". Blocarea prin obstacol e un al doilea semnal, ortogonal, calculat
separat.

## Model de date

```
obstacles
  id            text primary key      -- prefixul proiectului + „O" + număr: „MCP-O01"
                                      -- același tipar ca nextIssueId (localRepository.ts:64-71)
  project_id    text not null
  title         text not null
  detail        text not null default ''
  owner         text not null default ''   -- text liber; de obicei nu e user în aplicație
  state         text not null default 'necunoscut'  -- necunoscut|asteptare|depasit|ocolit
  blocking      boolean not null default true
  bypass        text                       -- null = nu are ocolire; text = ocolirea, cu costul ei
  evidence      text not null default 'necunoscut'  -- verificat|plauzibil|necunoscut
  asked_at      timestamptz                -- de aici iese „fără răspuns de N zile"
  resolved_at   timestamptz
  position      integer not null default 0

obstacle_issues   obstacle_id · issue_id      -- N la N, peste valuri
obstacle_deps     obstacle_id · depends_on    -- obstacol → obstacol
```

`owner` e text liber, nu FK în `assignees`: „echipa de API", „juridic",
„management" nu sunt conturi în aplicație și nu vor fi. Un selector de utilizatori
ar forța crearea de conturi false.

`evidence` reproduce marcajele `[V]`/`[P]`/`[?]` din dosar. E singurul câmp
adăugat pentru care nu am o cerință explicită — motivul e că fără el „obstacol
depășit" nu distinge între *am primit răspunsul în scris* și *am presupus*.

Migrare: `supabase/migration-obstacles.sql`, în stilul celorlalte (single-line,
`if not exists`, safe to re-run), plus politicile RLS pe modelul din
`migration-access.sql`: `select` pentru orice membru al proiectului, scriere doar
pentru `role = 'write'` sau `is_admin()`. `obstacle_issues` și `obstacle_deps`
moștenesc prin join pe `obstacles.project_id`.

## Motorul — o funcție pură nouă

`src/lib/obstacles.ts`, testat pe fixtures ca `engine.ts` / `schedule.ts` /
`parseDue.ts`. Fără I/O, fără React.

```ts
export type ObstacleState = 'necunoscut' | 'asteptare' | 'depasit' | 'ocolit'

/** Obstacolele efectiv deschise, cu dependențele între obstacole rezolvate. */
export function openObstacles(obstacles: Obstacle[]): Set<string>

/** issueId -> obstacolele deschise ȘI blocante care îl ating. */
export function blockedBy(
  issues: Issue[], obstacles: Obstacle[], links: ObstacleLink[]
): Record<string, string[]>

/** Zile de la `asked_at` pentru un obstacol în `asteptare`; null altfel. */
export function waitingDays(o: Obstacle, now: Date): number | null

/** Ciclu în `obstacle_deps`, ca listă ordonată, sau null. */
export function detectObstacleCycle(obstacles: Obstacle[]): string[] | null
```

`blockedBy` e singura poartă prin care UI-ul află că un tichet e blocat de un
obstacol. Nicio componentă nu recalculează asta.

## Interfața

### 1. Poarta valului („Ordine")

Peste grupurile de layere, un panou: numărul de obstacole deschise ale valului
activ, câte sunt la altcineva, și lista lor cu owner. Obstacolele depășite ale
valului apar tăiate la finalul listei — două-trei, nu tot istoricul.

Un tichet blocat de obstacol **își păstrează layerul**, se stinge
(`.card.blocat`: `--surface-2`, fără umbră, opacitate 0,72), coboară la finalul
layerului său, și poartă un jeton cu obstacolul și owner-ul. Titlul layerului
capătă „se poate începe · 2 din 5".

### 2. Harta („Graf" → „Hartă")

Evoluția lui `GraphView`. Tabul se redenumește: „graf" descrie desenul, „hartă"
descrie întrebarea la care răspunde.

- Coloane de la stânga la dreapta după adâncimea de dependență, ca acum.
- **Tichetul e o casetă rotunjită** (`--r-m`). **Obstacolul e o poartă** — muchia
  stângă teșită. Diferența e de formă, nu de chenar; regula „fără linii" ține.
- **Ocolire documentată = colțul dreapta-sus retezat.** Se vede că există o cale
  pe lângă. `bypass != null` e singura sursă.
- Bandă de fundal per val (`--surface-2` peste `--surface`), cu numele valului în
  mono majuscule.
- **Linia „azi"**, punctată, în accent: la stânga ce e închis, pe ea obstacolele
  deschise, la dreapta ce se poate face în paralel.
- Ce e închis rămâne desenat, tăiat, în `--done`.
- Muchiile care pleacă din obstacole deschise sunt punctate în `--blocked`; cele
  din lucruri închise, continue în `--done`; restul, `--txt-faint`. Se desenează
  **sub** noduri.

Culoarea barei verticale a nodului: `--blocked` obstacol deschis, `--done` închis,
`--active` în lucru, `var(--layer-N)` altfel. Rampa de layere rămâne în coloana
grupului și în numărul layerului — nu pe conturul cardului.

### 3. Foaia obstacolului

`kind: 'obstacle-form'` în stiva de foi din `src/ui.tsx`. Câmpuri: titlu, detaliu,
cine îl scoate, stare (segmentat de 4), ocolire, dovadă, tichetele blocate.

„Fără răspuns de N zile" se **calculează**, nu se scrie — ca tabelul de exemple din
`InfoPanel`. Se afișează doar în `asteptare`.

Foaia obstacolului **nu** intră în panoul lateral (`dockedIssueIdFrom` rămâne
numai pe `issue-form`): un obstacol se deschide de pe hartă sau din poartă, adică
din contexte unde lista din stânga nu e ce vrei să vezi.

### 4. Formularul tichetului — al treilea tab

Selectorul de dependențe are azi două taburi, „Necesită" și „Permite". Obstacolele
sunt al treilea. Nu fiindcă un obstacol ar fi un fel de dependență — nu e, e altă
axă — ci fiindcă întrebarea se pune în același moment: *ce împiedică tichetul
asta?* Un al doilea selector de căutare, în altă parte a formularului, ar pune
același gest în două locuri.

Din tab se poate și **crea** un obstacol nou, tastându-i titlul, ca la `draftDeps`:
`state: 'necunoscut'`, `blocking: true`, restul gol. Jetonul deschide foaia, ca
drumul de la „l-am scris" la „i-am pus owner și stare" să fie o atingere.

Ăsta e drumul principal — obstacolul se descoperă în timp ce te uiți la muncă, nu
într-o listă separată de obstacole.

## Ce las afară, deliberat

- **Obstacol la nivel de val.** Faza 0 din dosar e un val format numai din
  depășire de obstacole. Se exprimă deja: un obstacol legat la toate tichetele
  valului. Fără câmp nou până nu se dovedește necesar.
- **Risc.** „Prompt injection prin rezultate de tool" nu blochează nimic, dar nu
  se uită. A cincea stare sau altă entitate — ar dilua „obstacol" în „orice notă".
- **Export de hartă ca imagine.** Cerere reală („să pot arăta șefului"), dar
  independentă de model. Separat.
- **Notificare pentru obstacol care stă prea mult.** Merită, dar cere prag,
  preferință și un job — și `remindAt` e deja pe tichete. Separat.

## Testare

- `src/lib/obstacles.test.ts` — fixtures pe cazul MCP: `openObstacles` cu lanțul
  `#1 → #19`, `blockedBy` cu B1 pe șase tichete, `blocking = false` care nu
  stinge nimic, ciclu refuzat, `waitingDays`.
- `src/lib/engine.test.ts` — un test care afirmă că `computeLayers` și
  `deriveState` dau exact același rezultat cu și fără obstacole prezente.
- `src/data/localRepository.test.ts` — CRUD pe obstacole, ștergerea unui tichet
  care curăță legăturile, ștergerea unui obstacol care curăță legăturile și
  `obstacle_deps`.
- `design/preview.html` — regenerat cu `python3 design/build-preview.py`, cu un
  ecran „Hartă" și poarta valului adăugată pe ecranul „Ordine". **Verificat în
  ambele teme:** poarta teșită și cardul `.blocat` sunt exact clasa de control
  care poate rămâne fără fundal ȘI fără chenar.

## Pași de setup

```bash
npm run migrate supabase/migration-obstacles.sql
```

Nu se atinge `src/sw.ts`, `src/pwa.ts` sau blocul VitePWA, deci
`npm run test:upgrade` nu e cerut. Nu se atinge nicio funcție edge.

## Decizii luate fără confirmare explicită

Ambele vin din „pare ok" pe mockup. Dacă vreuna e greșită, se schimbă ieftin.

1. Harta se citește stânga→dreapta pe adâncime de dependență. Alternativa era
   valuri una sub alta. Am ales prima fiindcă păstrează semantica actuală a lui
   `GraphView` și fiindcă „ce merge în paralel" se citește pe verticală.
2. Tichetul blocat își păstrează layerul. Alternativa — obstacolele devin
   layerul 0 și tichetele blocate coboară — citește mai bine pe telefon, dar
   face numărul layerului instabil, ceea ce contrazice regula din CLAUDE.md.
