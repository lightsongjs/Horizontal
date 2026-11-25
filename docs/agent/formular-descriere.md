# Formularul: jetoane, descriere, markdown

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Rândul de jetoane al formularului

Între titlu și descriere, formularul complet (panou, modal, telefon) are UN
rând de jetoane cu **numai ce e setat** (mockup: `design/form-compact/index.html`):
scadența (fantoma „Dată” când lipsește — singura cu jeton gol), mementoul
(doar peste o oră), repetarea, valul (ascuns cu un singur val), tema,
persoana, urgentul, apoi agrafa și „+” (temă, persoană, urgent). Ce apare o
decide `visibleChips`/`addMenuItems` (`src/lib/formChips.ts`, pur, cu teste).
Rândul stă în `.sh-header`, deci nu se derulează, iar popoverele lui nu sunt
tăiate de `overflow` al corpului.

- **Un singur popover deschis** (`openPop` din `IssueForm`), în cochilia
  `ChipPop.tsx`: Esc ascultat în faza de CAPTURĂ cu `stopPropagation` (tiparul
  din `Lightbox`) închide doar popoverul și întoarce focusul pe jeton — altfel
  Escape-ul din `SheetHost`/`SplitView` ar fi închis tot formularul. Sub
  900px popoverul e foaie de jos, prin portal în `body` (`.sheet` are
  `transform`).
- Popoverul datei: presetări (Azi · Mâine · Luni · +1 săpt.), butoanele de
  zi și de oră (calendarul / ceasul sistemului, `NativePick`, nu câmpuri de
  scris) și mementoul — `DuePanel`, comun cu foaia de tichet. Formularul își
  ține în continuare data ca text `zz/ll/aaaa` (`dueText`, de el depinde
  `fillFromTitle`), dar textul vine numai din alegeri valide.
  Logica de murdărie e neatinsă: deschiderea unui tichet nu-l face „nesalvat”.
- Bara de fișiere apare numai cu fișiere (`Attachments hideEmpty`); agrafa din
  rând urcă prin același drum (`addRef`). Tragerea peste coloana descrierii
  merge în continuare — bara reapare cât se trage.
- Teste: `npm run test:layout` măsoară rândul la 320–430px, în panoul de
  ~500px și popoverul datei ca foaie; bancul („Controale”) are toate stările.

## Descrierea e un câmp, comentariul un rând

Macheta aprobată: `design/desc-box/index.html` (2026-10-15). Se scriu descrieri
mult mai des decât comentarii, deci ierarhia e: descrierea = câmpul principal,
caseta de comentariu = discretă.

- **Descrierea** (`DescFold` pune `.desc-box` pe cutie, deci panou, modal 94%,
  formularul și foaia de telefon arată la fel): `--surface-2` + linie de păr
  (`box-shadow` inset; în întunecat `--txt` 7%), raza `--r-m`, fără umbră.
  Focus: fundalul paginii (`--surface` în foi), contur accent + inel
  `--accent-soft` de 3px. Citit și scris arată la fel. „Arată tot"/„Restrânge"
  stă ÎN cutie (`after` din `DescField`, după editor — editorul rămâne primul
  copil, pe el îl măsoară `DescFold`), pe `--surface-3`; focusul lui nu aprinde
  inelul (`:not(:has(> .desc-more:focus))`). Codul din casetă urcă pe
  `--surface-3`. În foaia de tichet caseta ține toată lățimea, aliniată cu
  rândul de fir, nu după bifă.
- **Caseta de comentariu** (`Thread`, regula `composerOpen` din
  `src/lib/composer.ts`, pură, cu teste): în repaus un rând de 40px fără fundal
  (avatarul tău, „Scrie un comentariu…", agrafa care alege direct un fișier);
  deschisă cât are focus ORI ciornă (text, fișiere urcate/în urcare, „către…"
  ales), cu acțiunile înăuntru. Textarea-ul e același element în ambele stări,
  deci focusul nu sare. Agrafa din repaus nu ia focusul (`preventDefault` pe
  `pointerdown`/`mousedown`), altfel ar dispărea sub deget înainte de click.
  Fără drept de scriere caseta nu se mai randează.

## Descrierea în markdown

Descrierea unui tichet e text markdown, citit și scris cu **aceeași gramatică**:
`mdParser` (`src/lib/markdown/parse.ts`, Lezer). Două straturi deasupra ei —
`MarkdownView` (citit: elemente React din `toBlocks`, nu `innerHTML`, deci un
HTML scris de o unealtă rămâne text și n-avem ce sanitiza) și `MarkdownEditor`
(scris: CodeMirror 6 cu live preview, lazy prin `DescField`, chunk separat de
~82 KB gzip). O singură gramatică, ca citit și scris să nu poată diverge:
ce vezi în cititor e exact ce desenează editorul pe un rând fără cursor.
Subsetul îl dă specul (`docs/superpowers/specs/2026-10-12-descriere-markdown-design.md`);
`ticket-kit/README.md` îl spune și uneltelor care scriu descrieri.

- **Documentul ESTE stringul.** Decorările ascund sintaxa doar pe ecran; nimic
  nu „curăță” textul la salvare: `IssueForm` salvează descrierea exact cum e
  scrisă, iar singura excepție e o descriere numai din spații, care devine `''`
  (un `trim` pe tot textul ar fi mâncat un rând gol de la capăt, adică o
  schimbare pe care omul n-a făcut-o). Bifa schimbă exact un caracter (`toggleTask`), iar
  deschiderea și închiderea fără editare nu scriu nimic. CRLF se păstrează octet
  cu octet: `EditorState.lineSeparator.of('\n')` lasă `\r` un caracter la capăt
  de rând (ascuns de plugin). Implicit CodeMirror rupe rândul și pe `\r\n`, iar
  `toString()` întoarce `\n` — un text venit de pe Windows s-ar fi rescris la
  prima bifă.
- **Marcajele de bloc sunt mereu desenate** (căsuță, buline, `⁂`, citat, cod),
  **sintaxa inline doar pe linia cu cursorul** (`**`, `` ` ``, `[]()`): blocul
  e structură pe care o atingi, inline-ul e text pe care îl corectezi. Rândul cu
  focus își arată sintaxa ca să știi ce ștergi.
- **Rândul de listă are o singură geometrie** (2026-10-16): marcajul (căsuță,
  bulină, număr) stă într-o coloană fixă `--md-gutter`, textul și rândurile lui
  rupte pornesc după ea (agățat), iar marcajul se centrează pe PRIMUL rând prin
  `1lh`, nu pe linia de bază — o căsuță goală și una cu SVG-ul bifei au linii de
  bază diferite, și de-aia cea bifată stătea ~2px mai jos. Cititorul: `li`
  relativ, marcajul absolut. Editorul: `decorationSpecs` pune pe linie
  `md-li md-li-<fel>` + `--md-depth`, iar widgetul înghite indentarea dinainte
  și spațiul de după (lățimea unui spațiu depinde de font, a coloanei nu);
  `padding-left` + `text-indent` negativ îl aduc în coloană. Pe telefon
  (`max-width: 899px`, `pointer: coarse`) rândul cu căsuță are ~44px
  (`--md-task-pad`), iar ținta `::after` acoperă exact rândul ei, cu tot cu
  padding — niciodată pe al vecinului. `test:layout` măsoară centrarea (±1px)
  și agățarea pe componentele reale, la 1400/390 și text ×1/×1.5.
- **Bifa nu ia focusul și pleacă prin `commit`.** `preventDefault` pe
  `pointerdown` și `mousedown` — altfel o atingere ar ridica tastatura exact
  peste lista pe care o bifezi. Pe editor bifa e o tranzacție cu adnotarea
  `Toggle`, deci `onCommit` pleacă imediat, nu după pauza de 800ms a textului.
  În formularul complet `commit` doar murdărește starea locală (salvarea rămâne
  explicită). În foaia de tichet de pe card de dependență (`IssueSheet`) bifa e
  **optimistă**: valoarea locală se arată pe loc, iar la eșec se revine pe cea
  din store și apare un toast („Bifa nu s-a salvat”) — două bife rapide nu se
  pierd, fiindcă a doua se construiește pe prima, nu pe răspunsul serverului.
- **Rebaza din store e amânată cât `view.composing`.** O schimbare venită de
  pe alt dispozitiv, aplicată în mijlocul unei compuneri (diacritice, corectură
  Gboard), ar dubla sau pierde litere; se ține în `pending` și se aplică la
  `compositionend`. Rebaza e anotată `External` și nu intră în istoric: un
  Ctrl+Z ar fi desfăcut-o și ar fi trimis înapoi textul vechi ca scriere a omului.
- **`.md-editor .cm-editor`, nu `.cm-editor` gol.** Tema de bază CodeMirror
  (style-mod) se injectează la runtime ca PRIMUL `<style>` din `<head>`, cu
  aceeași specificitate ca regulile noastre — câștigăm prin ordine și prin
  prefixul `.md-editor`. Nu „repara” cu `!important` și nu muta foaia înaintea ei.
- **Blocul de cod din editor e O cutie** (W-02, 2026-11-11): rândurile se
  ating, rotunjite doar primul/ultimul (`md-pre-first`/`-last`), gardurile
  ``` sunt rânduri joase (`md-pre-fence`) cu textul ascuns fără cursor.
  Regula cititorului e `pre.md-pre`, NU `.md-pre` — altfel marginea și raza ei
  se lipesc pe fiecare `.cm-line.md-pre` (pastile), iar **o margine pe un rând
  CodeMirror nu e măsurată**: harta înălțimilor se decalează și clicul pune
  cursorul pe rândul de dedesubt. Niciodată `margin` pe `.cm-line`.
  `test:layout` („Blocul de cod”) păzește amândouă.
- **Butonul de copiere al blocului de cod** (2026-11-18, ca pe GitHub): colțul
  dreapta-sus, mereu vizibil (pe telefon nu e hover), bifă + „Copiat” 1,6 s,
  ✕ la eșec. În cititor `CodeCopy` (`MarkdownView`, cutia `.md-pre-box`), în
  editor un widget pe primul rând (`k: 'copy'` din `decorationSpecs`) care NU
  ține textul — îl ia la clic cu `codeTextAt` (o editare mai jos nu
  redesenează primul rând); ambele copiază același text ca `toBlocks`. Nu ia
  focusul (gardul nu se arată, tastatura nu urcă). Primul rând de cod din
  editor are `md-pre-pad` (loc în dreapta), fiindcă acolo rândurile se rup.
  Copierea trece prin `copyText` (`lib/clipboard.ts`): Clipboard API, altfel
  textarea + `execCommand`. Verificat în WebView-ul APK-ului (Chrome 157):
  amândouă merg; Electron încarcă tot producția.
- **`hzValue` pentru teste.** Nodul `.md-editor` expune `hzValue()` (textul real,
  cu sintaxa ascunsă inclusă): un test de browser nu poate citi documentul din
  `textContent`, fiindcă decorările l-au tăiat.
- Comentariile din fir au căsuțe statice (`MarkdownView` fără `onToggle`). Un
  `HZ-12` în text devine legătură doar pentru prefixele proiectelor cunoscute;
  linkurile merg doar pe `http:`/`https:`/`mailto:` (`www.` → `https://`).
- **Ce NU e încă:** foaia rapidă, bara de captură de pe Linux, `TicketActivity`
  și widget-ul de pe Android (descrierea lor rămâne text simplu; cer APK nou).
- **Tabelele (GFM, din 2026-10-24)**: cititorul le desenează ca rânduri plate
  cu linie de păr (fără grilă, derulare orizontală în cutia lor). Celulele se
  iau ca goluri între bare, nu din `TableCell` — o celulă goală n-are nod și
  restul s-ar fi mutat cu o coloană. **În editor tabelul rămâne mereu desenat
  și se editează pe celule** (`components/markdown/tableEditor.ts`, regulile
  pure în `lib/markdown/table.ts`; cerința omului: „la clic să-și păstreze
  forma”): o celulă cu clic devine `textarea` cu markdown-ul ei brut, iar o
  tastă scrie DOAR golul celulei (`editCell`) — un tabel aliniat rămâne
  aliniat, anularea grupează literele. Rând / coloană (butoanele „+”, meniul
  ⋯, Tab pe ultima celulă, Enter pe ultimul rând) rescriu tabelul în forma
  minimă. Widgetul de BLOC vine dintr-un `StateField` (un `ViewPlugin` nu
  poate înlocui peste capete de rând) și își păstrează DOM-ul prin
  `updateDOM`, altfel câmpul cu focusul ar dispărea la fiecare tastă.
  Ctrl+Z din celulă e `undo` al editorului; Esc (în captură) iese sub tabel.
  Shift/Ctrl/⌘+Enter rupe rândul ÎN celulă: câmpul arată un rând nou, sursa
  ține `<br>` (`cellIn`/`cellOut`), oprit înainte de „salvează” din formular;
  `<br>` (`<br/>`, `<BR />`) e singurul HTML desenat, și numai în celule.
  **În GFM un rând lipit de tabel e încă un rând al lui** — de-aia ieșirea și
  inserarea lasă un rând gol după. „Editează ca text” (⋯) arată sursa cât
  cursorul stă în tabel. Focusul descrierii e al cutiei (`focusin`/`focusout`
  pe gazdă), nu `view.hasFocus`, iar rebaza din store se amână și cât o
  celulă compune. Un tabel într-o listă / citat rămâne text.
- **Meniul „/”** (`components/markdown/slash.ts`, `@codemirror/autocomplete`,
  în `body`): numai pe rând gol sau după marcajul unei liste — după un cuvânt
  „și / sau” e text. Caută în română și engleză (`slashMatches`, cu teste).
- Banc: ecranul „Descriere” din `design/preview.html` (căsuța nebifată, textul
  bifat, codul cu fundal, rândul cu `.md-progress`), în ambele teme.
