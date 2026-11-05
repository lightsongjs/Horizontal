# Panoul lateral și panoul dublu

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Panoul lateral (split view)

Peste 1200px, „Listă" și listele inteligente se împart în două: lista în
stânga, formularul tichetului ales în dreapta (`src/components/SplitView.tsx`).
**Panoul apare doar cu un tichet deschis** (decizia omului, 2026-10-14): fără
tichet lista ține toată lățimea (cu plafonul ei de citit), iar `<aside>` rămâne
în DOM ascuns (`hidden`), ca lista să nu se remonteze la deschidere.

**Nimeni nu cheamă „deschide în panou".** Decizia se ia la RANDARE, într-un
singur loc: `dockedIssueIdFrom` din `src/ui.tsx`. O vizualizare care poate
găzdui panoul se anunță cu `registerSplitHost` (numai când e destul de lată),
iar dacă stiva de foi e exact un `issue-form` cu id, formularul apare acolo în
loc de modal. Două lucruri ies gratis din asta, și de-aia regula nu se mută în
handlerul de click: un deep link aterizează direct în panou; un card de
dependență împins deasupra rămâne modal, ca „Înapoi" să aibă sens.

Ce NU iese gratis: redimensionarea peste prag remontează formularul, nu-l mută.
`SheetHost.tsx` și `SplitView.tsx` randează fiecare propriul `<IssueForm>`, din
poziții diferite în arbore — trecerea pragului de 1200px demontează o instanță
și montează cealaltă, iar React nu are cum să păstreze starea locală între ele,
oricare ar fi `key`-ul. Ce supraviețuiește e doar ce vine din store (`byId`,
rehidratat din tichetul salvat), nu ce tocmai ai scris nesalvat — o editare în
curs, redimensionată peste prag, se pierde la fel ca la un click pe alt rând.

Din 2026-09-20, cheia panoului poartă și `dueAt`, ca saltul unei recurențe să
remonteze formularul în loc să-l lase cu scadența veche în câmp (altfel Salvează
scria data dinainte de salt și anula saltul în tăcere). Prețul e același ca mai
sus, cu un rând în plus: remontarea pierde și ciorna netrimisă din `Thread`, nu
doar derularea și focusul. Dacă vrei ciorna păstrată, mut-o din starea locală a
lui `Thread` într-un loc care supraviețuiește remontării — nu adăuga un efect de
sincronizare în formular, care ar avea nevoie de propria conștiință a stării
murdare.

Invers, și deliberat: un tichet creat offline (`HZ-~…`) care primește numărul
real la sincronizare **nu** se remontează. Foaia ține cheia de la montare
(`keyId`, pus de `renameIssueInSheets` din `src/ui.tsx`), iar `SheetHost` și
`SplitView` cheiază pe `sheetKey` = `keyId ?? issueId` (panoul își păstrează
sufixul `:dueAt`). La `dueAt` remontarea repară date care ar minți; la
redenumire s-a schimbat doar eticheta, iar o remontare ar arunca ce scrii
nesalvat și ciorna din `Thread` exact în clipa în care revine rețeaua.

**Comutarea nu salvează nimic singură.** Garda de close (`setCloseGuard`) vede
doar închiderea explicită — un click pe alt rând o ocolește complet. De-aia
formularul docat își raportează starea murdară (`setDockedDirty`) și
`openEditIssue` refuză prima atingere pe alt tichet, clipind săgeata de
salvare. Fără plasa asta, un click în listă ar fi aruncat în tăcere ce tocmai
ai scris; cu un dialog, fiecare click ar fi cerut un „da".

**„Deschide mare"** (iconița de lângă X, numai în panou) pune `popout: true`
pe aceeași intrare (`popOutSheets`): `dockedIssueIdFrom` îl lasă atunci
modalului de 94%, pentru descrieri lungi. E tot o remontare, deci cu modificări
nesalvate refuză și clipește săgeata, ca la comutarea pe alt rând. Închiderea
modalului închide tichetul; un click pe rând îl docheză din nou.

Panoul nu e un modal, deci nu blochează tastatura listei: `shouldIgnoreKey` din
`hooks.ts` primește `modalOpen`, nu `sheet.kind`. Ecranele „Listă" și
„Listă · gol" din `design/preview.html` acoperă panoul, rândul docat și starea
goală, în ambele teme.

**Descrierea are înălțimea textului, firul se anunță sus** (macheta
`design/panel-thread/index.html`, 2026-10-15). Înainte descrierea din panou
ținea 420px chiar goală, iar Firul cădea sub pliu. Acum, în panou și în
formularul de telefon (NU în modalul de 94%, unde descrierea e coloana de
lectură și Firul e oricum în dreapta), `DescFold` (`src/components/DescFold.tsx`,
regulile pure în `src/lib/descFold.ts`): minim 3 rânduri (2 goală), plafon
`min(340px, 45% din panou)` (telefon: 45% din ecranul vizibil), pliere doar dacă
ar ascunde ≥ 4 rânduri, cu „Arată tot · încă N rânduri" / „Restrânge". Focusul
desface; desfăcută rămâne cât trăiește formularul. **Pe telefon (`viewport`)
întâi citești, apoi scrii** (D-196, `tapRevealsOnly`): cât e pliată, o atingere
pe text DOAR o desface — `onMouseDownCapture` pe cutie, înaintea CodeMirror,
cu `preventDefault` (fără focus, deci fără tastatură) + `stopPropagation`;
bifa, linkurile și „Arată tot" trec (`DESC_CONTROLS`). Pe textul întreg
atingerea pune cursorul, ca înainte. Panoul lateral (mouse) e neschimbat. Fără înălțime fixă
CodeMirror nu mai umple cutia, deci o atingere sub text o prinde cutia și
cheamă `focusEnd()` (nou în `EditorHandle`). Foaia de tichet (`EditSheet`)
folosește același `DescFold`: sub plafon umple foaia ca înainte. Primul în
corpul formularului stă `SheetThreadRow` (`icon="toThread"`): un click derulează
corpul la „nou"/Fir (`scrollTo` pe `.if-body`, nu `scrollIntoView`) și pune
focusul pe `.thread` (`tabIndex=-1`), nu în casetă. Rândul gol punctat al
dependențelor (`.dep-empty-row`) a ieșit.

## Panoul dublu (split pane, două aplicații alăturate)

Spec + plan + deciziile omului: `docs/superpowers/specs/2026-10-22-split-pane-design.md`;
macheta `design/dual-pane-v2/index.html`, varianta A. De la 1200px: ▯▯ în
antetul tichetului docat (tichetul trece în stânga, în dreapta ecranul unde
erai) sau jos în bara laterală. Fiecare panou e aplicația ÎNTREAGĂ, complet
separată; fără operații între panouri, nicio scurtătură veche schimbată.

- **Două `<iframe src="/?pane=L|R">`, nu două `Shell`-uri.** Starea de navigare
  e globală prin construcție (store-ul ține UN proiect pe ecran, ~50 de
  ascultători pe `document`, `window.history`, pragurile pe fereastră); un
  iframe le separă pe toate gratis. Documentul de sus devine **gazda**
  (`SplitHost.tsx`): bara laterală + cele două cadre. Panoul: `isPane()`
  (`lib/pane.ts`, numai într-un cadru), fără bară laterală, cu `PaneBar`.
- **Istoricul trece prin `appHistory`** (`lib/historyPort.ts`). Al unui iframe
  e comun cu al filei: un `go(-n)` din `goTop` ar fi desfăcut pașii celuilalt
  panou. În panou portul e o stivă în memorie (`sessionStorage`
  `horizontal:pane:L|R`). Un test `?raw` pică pe orice `window.history` direct.
- **Back-ul browserului = Back-ul panoului cu focus.** Gazda ține o
  intrare-santinelă (`hzSplit`); Back o părăsește, gazda o pune la loc și
  trimite `back` panoului. Pe rădăcina panoului nu face nimic (decizia omului).
  URL-ul de sus = ruta panoului cu focus.
- **„Îngust" e `<html data-narrow>`, nu `@media`** (`lib/narrow.ts`): un cadru
  de 567px ar fi primit altfel layoutul de telefon. CSS-ul de telefon e
  `:where(html[data-narrow]) …`, cel de desktop `:where(html:not([data-narrow])) …`
  (`:where`, ca specificitatea să nu se schimbe); în JS `useNarrow()`. Un test
  pică pe un `@media` 899/900 nou. Bancul și `test:layout` pun atributul
  dintr-un script AL PAGINII, înaintea conținutului — pus după, tranzițiile
  (`.sheet`) erau prinse la jumătate de măsurători.
- **Un singur executant pe filă**: PWA (`registerPWA`), punțile native,
  mesajele service worker-ului (`ServiceWorkerBridge`) și clopoțelul sunt ale
  gazdei; `sw.ts` ignoră clienții `nested`, altfel o bifă din notificare s-ar fi
  executat o dată pe cadru.
- **Datele între panouri**: tichetele circulau deja (`horizontal-sync`); orice
  altă scriere (`netWrite`) trimite `stale`, iar celelalte realm-uri se
  reîncarcă la 1s după rafală. În modul local, evenimentul `storage`. Coerență
  eventuală, ca între două file.
- **Reîncărcarea reface ambele panouri** (`horizontal:split`, ținut numai cu
  DOUĂ panouri); pornirea rece = un panou pe „Azi". Panourile nu scriu
  `LAST_VIEW_KEY`/ultimul proiect în `localStorage`: `viewStore` le ține pe ale
  lor în `sessionStorage`.
- **✕ (decizia omului):** garda de azi se aplică NUMAI panoului care se închide;
  celălalt nu se reîncarcă — iframe-ul lui se lărgește și rămâne aplicația,
  cu ce avea nesalvat, până la reîncărcare, care pornește aplicația normală din
  ruta lui (gazda îi scrie `LAST_VIEW_KEY`).
- **Bara laterală e a gazdei, comutatorul rămâne în panou.** Butonul din antet,
  `[` și `gs` trimit `toggle-sidebar`; gazda ține starea (aceeași cheie
  `horizontal:sidebar-collapsed`) și o întoarce în `peer`. Tot ce e „al
  gazdei” trebuie gândit la fel: puntea Electron nu ajunge în cadru, deci
  `getDesktopBridge()` e null într-un panou (cardul de web push se ascunde cu
  `isPane()`, altfel dădea „push service not available”).
- **Focusul**: linia accent de 2px. Ctrl+Shift+[ / ] (după `e.code`; pe RO
  tastele scriu ă/î) e ascultat în captură pe `window` în TOATE realm-urile,
  deci merge și dintr-un câmp. Un `focus()` din cod într-un cadru fără focus
  (titlul formularului la pornire) trage tastatura acolo — Chromium o face —,
  de-aia panoul o cedează (`yield`) dacă n-a fost un gest.
- Teste: `historyPort`, `narrow`, `pane`, `paneProtocol`, `splitState`
  (vitest); `test:nav` „Panoul dublu" cap-coadă; `test:layout` (gazda la
  1200/1366/1920, bara panoului la 420–844).
