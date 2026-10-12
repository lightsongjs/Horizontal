# Descrierea tichetului în markdown, ca în Obsidian — design

Data: 2026-10-12 · Mockup: `design/markdown-descriere.html`

## De ce

Omul pune în descrieri liste de pași de bifat, iar ca text simplu ele nu se
văd ca liste. În plus, descrierea e scrisă azi în IBM Plex Mono 13px
(`.desc-fixed`, `src/styles.css`). E fontul de cod, se citește greu și calcă
regula „serif pentru tot ce e limbă".

Referințele omului: Obsidian Live Preview (scrii markdown, se randează pe loc)
și Linear (calitatea). Deciziile de design și tehnice au fost delegate:
designer, PM și arhitect au fost consultați pe 2026-10-12.

## Ce a decis omul

- O căsuță se bifează **dintr-o atingere, fără să intri în editare**, iar
  rândul bifat se taie.
- Restul deciziilor sunt ale consultanților și au fost aprobate de om în bloc.

## Comportament

**Un singur mod, nu „citire / editare" cu comutator.** Câmpul arată textul
randat. Pentru sintaxă:

- Marcajele de **bloc** (bulina, numărul, căsuța) sunt desenate MEREU, inclusiv
  pe rândul cu cursorul. Altfel rândul ar sări sub deget la fiecare atingere.
- Sintaxa **inline** (`**`, `*`, `` ` ``, `~~`, `[]()`, `#`) apare numai pe
  rândul (rândurile) cu cursorul, în `--txt-faint`.

**Intrarea în editare:**

- Foaia de pe telefon se deschide fără focus, ca acum (citești, tastatura nu urcă).
- O atingere pe text pune cursorul exact pe caracterul atins.
- Focusul se dă sincron, în handlerul gestului (tiparul `openQuick`), altfel
  Android nu ridică tastatura.

**Căsuța:**

- `onPointerDown` + `preventDefault`, deci nu ia focusul și nu ridică tastatura.
- Schimbă un singur caracter (`[ ]` ↔ `[x]`) pe linia ei.
- Pleacă imediat, ca jetoanele: `commit`, nu pauza de 800ms.
- Se aplică pe ultimul text știut. Dacă linia nu mai e o căsuță, nu scrie nimic.

**Linkurile:**

- Când câmpul nu e în editare, o atingere deschide linkul. Pe desktop merge
  Ctrl+click oricând.
- Sunt permise doar `http:`, `https:` și `mailto:`, aceeași regulă ca
  `openExternal`. Restul rămâne text.
- `PREFIX-N` (prefixul unui proiect cunoscut) devine legătură și deschide
  cardul de dependență deasupra. `HZ-~…` nu devine legătură.

**Listele:**

- Enter continuă lista (`- `, `- [ ] ` nebifat, `1.` incrementat).
- Enter pe un element gol iese din listă.
- Backspace la începutul unui element scoate marcajul, nu șterge rândul.
- Tab și Shift+Tab indentează numai în listă. În afara ei, Shift+Tab pe o
  descriere goală se întoarce în titlu, ca acum.

**Scurtături pe desktop:** Ctrl+B, Ctrl+I, Ctrl+L (căsuță pe rândul curent).
Ctrl+Enter rămâne „salvează".

**Bara de formatare (doar telefon):**

- Apare cât descrierea are focus, lipită deasupra tastaturii (`--kb`).
- Are patru butoane-iconiță: căsuță, listă, bold, indentare.
- `onPointerDown` + `preventDefault`, ca tastatura să nu coboare.

**Textul vechi:**

- Un Enter simplu rămâne rând nou (`breaks`), ca în Obsidian.
- Descrierile existente se afișează aproape identic.
- Deschiderea și închiderea fără editare nu produce nicio scriere.

## Subsetul markdown

**Intră:**

- `#` `##` `###` (H4–H6 se afișează ca `###`)
- paragrafe
- liste `-`/`*` și `1.`, cu indentare
- `- [ ]` / `- [x]`
- `**bold**`, `*italic*`, `~~tăiat~~`
- `` `cod` `` și blocuri ```` ``` ````
- `> citat`
- `[text](url)` și URL-uri goale
- `---`

**Nu intră:**

- tabele
- imagini în text (atașamentele au bara lor)
- HTML brut, care se afișează ca text
- note de subsol, `[[wikilinks]]`
- comenzi `/`
- evidențiere colorată de sintaxă

## Aspect

Tokenurile sunt cele existente. Orice `font-size` e `calc(Npx * var(--text-scale))`.

| Element | Stil |
|---|---|
| corp | Literata 16px, `line-height: 1.6`, `--txt`; `max-width: 68ch` pe desktop |
| spații | paragraf 0.65em; titlu 1.3em sus / 0.35em jos; item 0.15em; cod 0.8em |
| `#` / `##` | 20px / 17px, 600 |
| `###` | Plex Mono 12px, majuscule, `.06em`, `--txt-dim` |
| bulină | 5px, 50%, `--txt-faint`; indentare 1.4em |
| numerotare | mono, `--txt-dim`, `tabular-nums` |
| căsuță | 18px, `--r-s`, `inset 0 0 0 1.5px var(--txt-faint)`; țintă de atingere 44px |
| căsuță bifată | umplută `--accent` + `<Icon name="done">` în `--bg`; textul `--txt-faint` + `line-through`; 120ms |
| cod inline | mono .86em, fundal suprafață ridicată, `1px 5px`, `--r-s` |
| bloc de cod | `--r-m`, `12px 14px`, mono 13px, `overflow-x: auto`, o singură culoare |
| citat | Literata italic, `--txt-dim`, `padding-left: 14px`, **fără bară** |
| link | `--accent`, subliniere 1px, offset 3px, culoarea accentului la 40% |
| `---` | `⁂` centrat, mono, `--txt-faint` |
| câmpul | fără fundal și fără chenar; cu focus doar `box-shadow: 0 0 0 2px` accent-soft, `--r-m` |

**Progres:** pe cardul din „Ordine", pe rândul din „Listă" și în listele
inteligente apare jetonul „2/5", mono, `--txt-dim`. Apare **numai** dacă
descrierea are căsuțe; fără căsuțe nu arată nimic.

## Suprafețe

| Suprafață | v1 |
|---|---|
| formularul complet + panoul lateral (`IssueForm`) | editor |
| foaia de pe telefon (`EditSheet`) | editor |
| cardul de dependență (`IssueSheet`) | citire, cu căsuțe bifabile |
| comentariile din fir (`Thread`) | citire; căsuțele **statice** (un comentariu e istorie) |
| câmpul de scris comentarii | rămâne textarea, dar trece pe Literata 15px |
| foaia rapidă, rândul de quick add, bara Linux | **mai târziu**; textul lor se afișează corect după salvare |
| `TicketActivity` + widget Android | **mai târziu** (APK nou); arată și editează textul brut, care rămâne neatins |

## Arhitectură

**Editorul: CodeMirror 6**, cu un plugin propriu de live preview peste
`@lezer/markdown` (GFM). Nu folosim `@codemirror/lang-markdown` și nici
pachete „live-markdown" de pe npm.

- **Documentul ESTE stringul `desc`.** Decorările ascund doar pe ecran. Bifa și
  Enter sunt editări de text, deci textul salvat e exact cel scris.
- ProseMirror/Tiptap, Milkdown și Lexical sunt excluse: ele serializează
  arborele și rescriu markdown-ul omului.
- CM6 are cel mai matur strat IME pentru Android.
- Textarea cu overlay e exclus: nu poate ascunde sintaxa fără ca lățimile să
  se decaleze.

**Încărcarea:**

- Editorul (~100–115 KB gzip, de măsurat) stă într-un chunk separat, cu
  `import()` dinamic.
- Intră în precache prin `globPatterns`, deci merge offline, dar nu întârzie
  primul cadru.
- Cât se încarcă, se folosește textarea-ul existent drept rezervă.

**Cititorul** (`MarkdownView`):

- Același `@lezer/markdown` (~17 KB, în chunk-ul principal), deci o singură
  gramatică pentru editare și citire.
- Produce elemente React, nu `innerHTML`, deci nu e nevoie de sanitizer.

### Unități

Module pure, `src/lib/markdown/` (vitest, fixtures):

- `spans.ts`: text → intervale (fel, `from`/`to`, ce se ascunde). Îl folosesc
  și decorările, și cititorul.
- `tasks.ts`:
  - `toggleTask(text, line)`
  - `taskProgress(text)` → `{ done, total }`
  - `continueList(text, sel)`
  - `outdentItem(text, sel)`
- `minimalChange(old, next)`: diff prefix/sufix, pentru rebaza din store fără
  să sară cursorul.
- `safeUrl.ts`, `issueRefs.ts` (`PREFIX-N` cunoscut → legătură).

Componente:

- `MarkdownView.tsx`: citire, `onToggle?` opțional.
- `MarkdownEditor.tsx` (lazy):
  - ViewPlugin de decorări;
  - widget de căsuță (`role="checkbox"`, `aria-checked`);
  - keymap;
  - `scrollMargins` din `--kb`;
  - fără scroll propriu, derulează foaia.
- `DescField.tsx`: `Suspense` cu textarea ca rezervă, apoi editorul.
  Contract `value` / `onChange` / `onCommit` / `onBlur`.
- `FormatBar.tsx`: bara de pe telefon.

### Legătura cu salvarea automată

- **EditSheet:**
  - `docChanged` → `a.type({ desc })`;
  - căsuța → `a.commit({ desc })`;
  - blur → `a.flush()`.
- **Rebaza din store:** `Autosaver` deja nu calcă un câmp murdar. Dacă
  `d.desc` diferă de document, aplicăm `minimalChange` printr-un `dispatch`.
  Rebaza se **amână cât `view.composing`** și se reia la `compositionend`.
- **IssueForm:** același contract peste `setDesc`. `desc.trim()` la salvare
  rămâne.
- **Remontarea la pragul de 1200px / cheia cu `dueAt`:** pierde starea
  editorului exact cum o pierde azi textarea-ul. Nicio regulă nouă.
- **Offline:** bifa e o scriere obișnuită de tichet (`enqueueWrite` + coada
  offline). Nu e nimic nou.

## Riscuri și verificare

1. **IME pe Android (riscul principal).** Pe linia aflată în compunere nu se
   recalculează decorările cât `view.composing`.
   - Automat: `Input.imeSetComposition` prin CDP în `test:nav`.
   - Manual pe Redmi (`mobile/scripts/cdp.mjs`):
     - corectura automată;
     - tastarea prin glisare;
     - diacriticele;
     - Enter în mijlocul unui cuvânt compus;
     - Backspace la început de element.
   - **Înainte de push pe master.**
2. **Bifa ridică tastatura.** În `test:nav`, cu atingeri reale
   (`lib-touch.mjs`), verificăm trei lucruri: textul s-a schimbat,
   `activeElement` nu e editorul, iar `visualViewport` nu s-a micșorat.
3. **Geometria.** `test:layout` la 320–430px și `TEXT_SCALE=1.5`: editorul cu
   `--kb`, bara de formatare, minimul de ~43% al foii, jetonul „2/5" pe rând.
4. **Precache.** Chunk-ul nou schimbă manifestul, deci rulăm `npm run test:upgrade`.
5. **Fidelitatea textului:**
   - `toggleTask` aplicat de două ori dă textul inițial, octet cu octet;
   - `continueList` atinge doar selecția;
   - randarea descrierilor reale (export din bază, local, negitat) nu pierde
     niciun rând.
6. **textScale.** Stilurile din `EditorView.theme` nu sunt văzute de
   `textScale.test.ts`. Le punem în `styles.css` sub clase `.cm-md-*`, ca
   testul să le prindă.
7. **Culoarea.** Adăugăm un ecran „Descriere" în `design/preview.html`, verificat
   în ambele teme.

## Ordinea

1. Pur: `spans`, `tasks`, `minimalChange`, `safeUrl`, `issueRefs` + fixtures.
2. `MarkdownView` în `IssueSheet` și `Thread`; jetonul „2/5" pe card și pe rând.
3. Editorul în `EditSheet` + `FormatBar` + testele de atingere și IME.
4. Editorul în `IssueForm` / panoul lateral + scurtăturile de desktop.
5. Documentarea în `CLAUDE.md` + subsetul suportat în README-ul ticket-kit.

## Ce NU facem

- comutator Editare/Previzualizare
- bară de formatare pe desktop
- comenzi `/`, tabele, imagini în text
- emoji `:x:`
- evidențiere multicoloră în cod
- bară laterală pe citate, linii sub titluri
- mutarea rândurilor prin tragere
- bară de progres sau gradient
- „curățarea" textului la salvare
