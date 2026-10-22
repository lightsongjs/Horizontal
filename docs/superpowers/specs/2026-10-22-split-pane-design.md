# Panou dublu (split pane) pe desktop — spec + plan

Data: 2026-10-22. Macheta aprobată: `design/dual-pane-v2/index.html`, **varianta A**
(fiecare panou = aplicația întreagă). Decis de om, nu se redeschide: două panouri
complet separate (listă/proiect/„Azi" + tichet, istoric, Back, tichet deschis
proprii), fără operații între ele, nicio scurtătură existentă schimbată.
Adăugări: Ctrl+Shift+[ / Ctrl+Shift+] = focus pe panoul stâng / drept.

## 1. Decizia: două `<iframe>` same-origin, gazdă subțire cu bara laterală

Topologia, cât split-ul e pornit:

```
documentul de sus („gazda")         = App în modul host: providerii (store) + Sidebar + 2 × <iframe>
  <iframe src="/?pane=L">           = App în modul pane: aplicația întreagă, fără Sidebar
  <iframe src="/?pane=R">           = idem
```

Fără split, documentul de sus e aplicația de azi, neschimbată.

### De ce nu in-app (două `Shell` peste un store comun) — citit, nu presupus

Starea de NAVIGARE nu e doar în `Shell`; e împrăștiată în locuri globale prin construcție:

- **Store-ul e al unui singur proiect pe ecran**: `projectId`, `activeWave`,
  `issuesLoadedFor`, `currentProjectRef` (`store.tsx` 331–337), consumate din 41 de
  componente prin `useHorizontal()`. Două panouri pe proiecte diferite cer spargerea
  store-ului în „date comune" + „vedere per panou" — refactor pe tot arborele.
- **Istoricul**: `App.tsx` are 53 de atingeri `window.history`/`popstate`
  (`goTop`/`goProject` cu `go(-n)`, `behindTicket`, `hzDepth`, `hzSheet`, foaia
  rapidă, sertarul, selecția). Un singur `window.history` pentru două panouri.
- **Tastatura și DOM-ul**: ~50 de ascultători `document`/`window` (`App.tsx` 16,
  `hooks.ts` 8, `vim.tsx` 6, `TaskActions` 4, `WaveTabs` 3 …) și 22 de
  `document.querySelector` numai în `vim.tsx` (`.split-pane .sh-header`,
  `.am-menu`, overlay-urile). Fiecare ar trebui învățat „sunt panoul cu focus?" și
  „caută doar în rădăcina mea". Inelul cursorului e o regulă CSS pe ID — global.
- **Pragurile**: `useMediaQuery` (6 locuri) și ~38 de `@media` se evaluează pe
  FEREASTRĂ. Macheta cere „decizia pe lățimea panoului" (1200 al `SplitView`,
  560/640/379 etc.) — in-app ar cere container queries peste tot, iar foile
  portalate în `body` scapă din container.
- **Evenimentele `window`** (`OPEN_USERS_EVENT`, `hz:open-filter`, `hz:wave`,
  `GO_TODAY_EVENT`) ar ajunge la ambele panouri.

Fiecare dintre ele e o regresie tăcută posibilă („o tastă a lucrat în panoul
greșit"). Un iframe le rezolvă pe toate prin construcție: realm JS propriu
(module, store, `document`, ascultători), focus de tastatură propriu (evenimentele
merg numai în documentul cu focus), viewport propriu (toate pragurile se
evaluează pe lățimea panoului — exact regula machetei). „Complet separate" devine
o proprietate a platformei, nu o disciplină de cod.

### Ce costă iframe-ul (verificat) și cum se plătește

1. **Istoricul unui iframe e comun cu al sesiunii** (joint session history).
   `pushState` dintr-un panou intră în istoricul filei, Back-ul browserului scoate
   ultima intrare a ORICĂRUI cadru, iar `history.go(-n)` din `goTop` traversează
   istoricul comun — ar desface intrările celuilalt panou. **Rezolvare:** în modul
   pane, `App` nu atinge `window.history`; folosește un **port de istoric**
   (`src/lib/historyPort.ts`): implementarea `browser` (azi, pass-through) și
   `memory` (stivă în memorie, `popstate` emis asincron ca la browser — `tabPop`
   depinde de asincronie; persistată în `sessionStorage` `horizontal:pane:<L|R>`).
   Iframe-ul nu-și schimbă niciodată `src` după montare (ar împinge o intrare).
2. **La 567px, CSS-ul ar da layoutul de telefon** (bară de jos, FAB, sertar,
   foi de jos, glisări). Nu-l vrem: panoul e desktop cu mouse. **Rezolvare:**
   „îngust" devine o decizie a aplicației, nu a viewportului: `<html data-narrow>`
   pus sincron în `main.tsx` din `(max-width: 899px)` **și** `!pane`; cele 7+2+6+1
   blocuri `@media (max-width: 899px)` / `(min-width: 900px)` devin
   `:root[data-narrow]` / `:root:not([data-narrow])`; `useMediaQuery('(max-width:
   899px)')` (6 locuri) devine `useNarrow()`. Celelalte praguri rămân media
   queries — pe lățimea panoului, cum cere macheta. Consecință voită: sub 1200
   tichetul se deschide ca modal peste listă = „lista SAU tichetul"; „←" din bara
   panoului = Back-ul panoului.
3. **Store-urile celorlalte realm-uri.** Tichetele circulă deja: `offlineRepository`
   trimite `issue`/`removed`/`remap`/`failed` pe `BroadcastChannel`
   (`horizontal-sync`), iar `store.tsx` (917–944) face `upsertIssue` / `forget`.
   Dar: (a) `setDueRaw`/`setOpenRaw` doar ÎNLOCUIESC rânduri existente — o captură
   din panou nu crește numărul „Azi" din bara gazdei; (b) proiecte, valuri, teme,
   obstacole, firul, fixările din sertar, filtrele NU se anunță deloc (fixezi în
   panou → bara laterală nu se schimbă). **Rezolvare:** eveniment nou
   `{ type: 'stale' }` pe același canal, emis de store după orice scriere
   ne-tichet reușită, plus la primirea oricărui eveniment de pe canal un
   `refresh({ force: true })` cu debounce de ~1s (fără `loading`, deci fără
   clipire — regula din „Reîmprospătarea datelor"). Coerență eventuală în ~1s,
   aceeași ca între două file azi, doar mai vizibilă. Modul local (fără canal):
   neacoperit, asumat.
4. **Service worker-ul vede și iframe-urile**: `clients.matchAll({type:'window'})`
   le întoarce (`frameType: 'nested'`). `reminder-action` e trimis TUTUROR → bifa
   s-ar executa de 3 ori; `notificationclick` poate face `focus()`/`navigate()` pe
   un iframe. **Rezolvare:** `sw.ts` filtrează `frameType === 'top-level'` la
   acțiuni și la click (cere `npm run test:upgrade`); defensiv, modul pane ignoră
   oricum mesajele workerului.
5. **Efecte cu un singur executant**: `registerPWA`, `NativeBridge`,
   `DesktopBridge`, clopoțelul, sincronizarea de calendar, preluarea acțiunilor
   native rulează numai în gazdă. În pane sunt oprite (un singur loc: `isPane()`).
   `pwa.ts`: gazda reîncarcă documentul de sus, iframe-urile se reîncarcă odată
   cu el; un pane nu se reîncarcă singur.
6. **Cost**: trei boot-uri (gazdă + 2 panouri), fiecare cu primul cadru din
   IndexedDB și propriul `refresh` la revenire (pragul de 30s per realm). Bundle-ul
   e din cache-ul SW, CodeMirror rămâne leneș. Acceptabil pe desktop.
7. **Autentificarea**: sesiunea supabase e în `localStorage`, comună; supabase-js
   sincronizează între contexte (BroadcastChannel), deci logout-ul din gazdă
   ajunge în panouri. Logout-ul rămâne numai în gazdă.
8. **Electron**: preload-ul nu rulează în subcadre (`nodeIntegrationInSubFrames`
   e oprit) — exact ce vrem, puntea rămâne a gazdei. De verificat la probă:
   linkurile externe din panouri (`openExternal` lipsește acolo → `window.open`,
   prins de `setWindowOpenHandler` al webContents). **APK**: nu se aplică (sub
   1200, butonul nu apare).

## 2. Comportament

- **Pornire** (doar `min-width: 1200px`, nu în APK): (a) ▯▯ în antetul
  tichetului docat, lângă „Deschide mare": stânga = ecranul curent CU tichetul,
  dreapta = același ecran fără tichet; focus pe stânga. Cu formular murdar:
  refuz + clipirea săgeții (`nudgeSave`), ca la „Deschide mare" — e o remontare.
  (b) Buton jos în bara laterală: stânga = unde erai (cu tichetul, dacă era
  unul, aceeași gardă), dreapta = același ecran fără tichet (decis).
- **Focus**: `pointerdown`/`focusin` în panou → `postMessage({hz:'focus'})`;
  gazda pune linia accent 2px pe cel activ. Ctrl+Shift+[ / ] — ascultător în
  CAPTURĂ pe `window`, în fiecare realm (gazdă + panouri), după `e.code`
  `BracketLeft`/`BracketRight` cu `ctrlKey && shiftKey`, înaintea lui
  `isTypingTarget`, CodeMirror și dispecerul Vim; `preventDefault` +
  `stopPropagation`; gazda face `iframe.contentWindow.focus()`, panoul își
  readuce focusul pe ultimul element. Cu un singur panou: nimic.
- **Bara laterală (în gazdă)** nu mai cheamă `selectProject` direct: primește
  `onProject`/`onScreen`/… și gazda le trimite panoului cu focus, care le execută
  ca pe propriile clicuri (căutarea, setările, filtrul nou, proiectul nou,
  „Utilizatori" se deschid în panou). Gazda doar desenează și numără. „on" =
  locul panoului cu focus, punct gri = al celuilalt (panourile își anunță ruta
  la fiecare navigare). Un clic în bară redă focusul iframe-ului activ.
- **Același tichet în ambele**: permis; panourile își anunță tichetul deschis,
  antetul arată „deschis și în celălalt panou". Conflictul de scriere îl tratează
  regulile existente (formular curat se remontează, murdar nu).
- **Back-ul browserului** = Back-ul **panoului cu focus** (decis). La pornire gazda
  împinge o intrare-santinelă (`hzSplit: 'guard'`); un `popstate` care o
  părăsește re-împinge santinela și trimite `{hz:'back'}` panoului activ, care
  rulează `back()` pe portul lui (deci aceeași mașinărie: foaie → selecție →
  ecran → „Azi"). Pe rădăcina panoului („Azi"), Back nu face nimic (nu iese din
  aplicație, nu atinge celălalt panou). Forward: ignorat.
- **URL-ul de sus** = ruta panoului cu focus (`replaceState` la navigare și la
  schimbarea focusului), ca un link copiat să spună ce vezi. `src` real al
  iframe-urilor rămâne `/?pane=L|R`.
- **Reîncărcarea** (inclusiv cea din `pwa.ts`): `sessionStorage`
  `horizontal:split` = `{ focus }` + stivele `horizontal:pane:L|R` → gazda
  pornește direct în split, fiecare panou își reface stiva (Back merge și după
  reîncărcare). Calea din bară e ignorată la `navigation.type === 'reload'`; la
  o navigare (clic pe notificare, URL scris) un tichet din cale se deschide în
  panoul cu focus. **Pornirea rece** (filă nouă, aplicație repornită):
  `sessionStorage` e gol → un singur panou, pe „Azi" (regula `SESSION_KEY`
  neatinsă). Panourile NU scriu `LAST_VIEW_KEY`/`last-project`/`last-tab` (chei
  comune în `localStorage`); le țin în stiva lor.
- **Închiderea**: ✕ în bara panoului. Garda de close se aplică NUMAI panoului
  care se închide (formular murdar → refuz cu `nudgeSave`). Cel rămas **nu se
  reîncarcă și nu e verificat** (decizia omului, 2026-10-22): iframe-ul lui se
  lărgește pe toată lățimea și rămâne aplicația, cu tot ce avea nesalvat, până la
  următoarea reîncărcare sau pornire rece — atunci se pornește un singur panou
  normal, din ruta lui (`LAST_VIEW_KEY` scris de gazdă din ruta anunțată,
  santinela rescrisă pe calea lui, `horizontal:split*` golite). Cât trăiește așa,
  bara laterală a gazdei îl conduce ca înainte, iar butonul de pornire a split-ului
  redeschide al doilea panou alături.
- **Fereastra micșorată sub 1200 cu split pornit**: split-ul rămâne, strâns (e
  starea omului); dispare doar butonul de pornire; panourile nu scad sub
  `min-width: 420px`.

## 3. Plan de implementare

Ordinea contează: pașii 1–3 nu schimbă nimic vizibil și se pot publica separat.

1. **Portul de istoric** — `src/lib/historyPort.ts` (pur: `browserPort`,
   `memoryPort` cu persistență injectabilă). `App.tsx`, `hooks.ts`, `vim.tsx`,
   `calendar.tsx`, `NativeBridge.tsx` trec de la `window.history`/`location`/
   `popstate` la port (`appHistory`, un singur port pe realm — fiecare iframe
   are modulele lui, deci un context React n-ar adăuga nimic; ales o dată cu
   `setHistoryPort`). Excepții deliberate: `calendar.tsx` (curăță URL-ul REAL de
   după OAuth) și `main.tsx` (ramifică `/quick-add` după calea reală). Teste: `historyPort.test.ts`
   (push/replace/go asincron, `go` peste capete, state, persistență, reluare
   după „reîncărcare"). Regresia: `test:nav` întreg trebuie să treacă neschimbat.
2. **„Îngust" ca decizie** — `src/lib/narrow.ts` + `useNarrow()`, `data-narrow`
   în `main.tsx`; rescrierea blocurilor 899/900 din `styles.css`. Test vitest
   `?raw` care pică pe orice `@media (max-width: 899px)` / `(min-width: 900px)`
   rămas (ca `textScale.test.ts`). `test:layout` complet, ambele teme în banc.
3. **Canalul `stale`** — `SyncEvent` + emisie din store după scrierile ne-tichet,
   refresh forțat cu debounce la orice eveniment primit; inserarea în
   `dueRaw`/`openRaw` a tichetelor noi. Teste în `src/data/offline/*.test.ts` și
   un test de store pentru debounce.
4. **Modul pane** — `src/lib/pane.ts` (`isPane()`, `paneId()` din `?pane=`),
   ramificat în `main.tsx`: fără `registerPWA`, fără Sidebar/Drawer/TabBar,
   fără `NativeBridge`/`DesktopBridge`/clopoțel/calendar-sync; ignoră mesajele SW;
   bara panoului (`PaneBar.tsx`: firimitura, ←, ✕). `sw.ts`: filtrul
   `top-level` → `npm run test:upgrade`.
5. **Protocolul** — `src/lib/paneProtocol.ts` (pur: tipurile mesajelor,
   validarea `origin` + `source`, ruta ↔ marcajele barei laterale,
   `isPaneSwitchKey(e)` după `code`). Teste cu `key` = `ă`/`î`/`{`.
6. **Gazda** — `src/components/SplitHost.tsx` + `src/lib/splitState.ts` (pur:
   serializare, pornire rece vs reîncărcare vs navigare, alegerea panoului rămas,
   santinela). `Sidebar.tsx` primește acțiunile ca props. Butoanele: ▯▯ în
   `IssueForm` (doar docat), cel din bara laterală. Linia de focus, Ctrl+Shift+[ ].
7. **Închiderea** — iframe-ul rămas se lărgește (fără remontare); preluarea în
   documentul de sus se face abia la reîncărcare, prin `splitState`.
8. **Banc + teste de browser** (mai jos), apoi CLAUDE.md: secțiune „Panou dublu".

### Teste care o păzesc

- **vitest (pur)**: `historyPort`, `narrow` + garda `?raw` pe CSS, `paneProtocol`
  (taste pe RO, mesaje străine respinse), `splitState` (rece → un panou pe „Azi";
  reîncărcare → ambele + focus; navigare cu `/HZ-12` → tichet în panoul activ;
  închidere), canalul `stale`.
- **`test:nav`** (iframe-uri reale): pornirea din tichetul docat (stânga
  tichetul, dreapta lista); Ctrl+Shift+[ / ] dintr-un input și din CodeMirror
  mută `activeElement` în iframe-ul corect; o tastă (`j`, `O`, Esc) lucrează
  numai în panoul cu focus; clic în bara laterală navighează doar panoul activ;
  Back-ul browserului afectează doar panoul activ, nu iese pe rădăcină,
  `history.length` al filei nu crește cu navigarea din panouri; `goTop` într-un
  panou nu atinge celălalt; bifa/fixarea într-un panou apare în celălalt și în
  bara laterală; `page.reload()` reface ambele stive + focusul; pagină nouă (rece)
  → un panou pe „Azi"; ✕ cu formular murdar refuzat; ✕ curat → celălalt se lărgește
  fără remontare (o ciornă nesalvată în el rămâne), iar `page.reload()` după
  aceea → un singur panou normal, pe ruta lui; un `reminder-action` simulat se execută o dată.
- **`test:layout`**: la 1200/1366/1920, cu text ×1 și ×1.5: lățimile panourilor,
  fără derulare orizontală, layout desktop în panou (fără `.tabbar`/FAB), banda de
  valuri (`fitPills`) la 484/567, tichetul în panou, butonul ▯▯ prezent de la
  1200 și absent la 1199.
- **`test:upgrade`**: obligatoriu (sw.ts, pwa.ts).

## 4. Riscuri

- Portul de istoric atinge cea mai fragilă mașinărie din aplicație (Back pe
  Android, `behindTicket`, `goTop`). Pasul 1 trebuie publicat singur și verificat
  pe telefon înainte de restul.
- Rescrierea 899/900 în CSS: o regulă scăpată = un control de telefon pe desktop
  sau invers; garda `?raw` + `test:layout` + bancul în ambele teme.
- Coerența între panouri e eventuală (~1s) pentru ce nu e tichet.
- Trei store-uri = trei runde de citire la revenire în tab.
- Ctrl+Shift+[ ] poate fi prins de o extensie sau de un WM înaintea paginii; nu
  e în Chrome/Firefox pe Linux.
- Iframe-ul fără `frame-ancestors`: aplicația se poate încadra și de alte origini
  (azi la fel). Recomandat `Content-Security-Policy: frame-ancestors 'self'` în
  `public/_headers` — nu strică split-ul.

## 5. Decizii ale omului (luate pe 2026-10-22)

1. Sub 1200 cu split pornit: split-ul rămâne, strâns.
2. Back pe rădăcina unui panou: nu face nimic.
3. Butonul din bara laterală: în dreapta, același ecran (fără tichet).
4. La închiderea unui panou, cel rămas nu se reîncarcă și nu se refuză nimic
   pe motiv că e murdar: iframe-ul lui se lărgește pe toată lățimea până la
   următoarea reîncărcare / pornire rece, care dă un singur panou normal.
   Garda de murdărie se aplică doar panoului care se închide.

## 6. Implementat (2026-10-22) — ce s-a schimbat față de plan

- `appHistory` e un singur port pe realm (modul), nu un context React.
- Pe lângă `data-narrow` a intrat și `data-wide` (fostul `@media (min-width:
  1200px)` al panoului lateral): un panou e mereu „lat", deci tichetul se
  deschide DOCAT și ia tot panoul (lista ascunsă, nu demontată) — „lista SAU
  tichetul" din machetă, cu descrierea pe înălțimea textului. Modalul rămâne
  pentru vizualizările fără panou („Cards", „Ordine"), întins pe tot panoul.
- În antetul formularului din panou lipsesc ID-ul, ✕ și „Deschide mare" (sunt
  deja în bara panoului / n-au loc); proiectul, fixarea, linkul, ștergerea și
  salvarea rămân. Abatere asumată față de machetă (care n-are antet deloc),
  după verificarea designerului.
- Modul local: vestea între documente e evenimentul `storage` (baza e chiar
  `localStorage`). Temă, text, Vim: tot `storage`.
- Un `focus()` din cod într-un cadru fără focus e cedat înapoi (`yield`).
- Capturi: `design/dual-pane-v2/capturi/` (1366/1920, ambele teme, plus macheta).
