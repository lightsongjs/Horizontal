# Foaia rapidă și foaia de tichet (telefon)

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Foaia rapidă (telefon) și descrierea din quick add

Sub 900px FAB-ul deschide **numai** foaia rapidă (`QuickSheet.tsx`), lipită de
tastatură — și într-o listă, și într-un proiect. Rândul de quick add din listă
nu se mai randează sub prag: ar fi fost a doua intrare și ar fi ridicat
tastatura în mijlocul unei liste care derulează. Pe desktop rămân rândul (tasta
C) și „+ Tichet".

**O singură stare de captură.** Rândul din listă, bara de captură de pe Linux
și foaia stau toate pe `useQuickDraft` (`hooks.ts`), iar regulile pe
`src/lib/quickDraft.ts` (pur, cu teste). Titlul e un singur component,
`QuickTitle` (`QuickFields.tsx`) — oglinda care desenează data se strică la
orice diferență de font între straturi, deci un test `?raw` cere ca ambele
capturi să-l importe. Într-un proiect, fără dată în text tichetul rămâne
**fără scadență** și intră în valul activ; în listă primește ziua listei.

**Focusul se dă în handlerul atingerii** (`openQuick` din `App.tsx`:
`flushSync` + `focus()`), nu din efect: Android și iOS ridică tastatura doar la
un focus venit dintr-un gest. Butoanele foii au `onPointerDown` cu
`preventDefault`, ca atingerea lor să nu ia focusul și să nu coboare tastatura.

**Tastatura se măsoară, nu se presupune.** `useKeyboardInset` scrie `--kb` din
`visualViewport`: 0 unde WebView-ul se micșorează, exact tastatura unde nu
(iOS, edge-to-edge pe targetSdk 36). Neverificat încă pe telefon real:
`node mobile/scripts/cdp.mjs 'innerHeight+"/"+visualViewport.height'` cu
tastatura deschisă. Dacă nici nu se micșorează, nici nu mișcă
`visualViewport`, rămâne `@capacitor/keyboard` (APK nou).

**Istoricul.** Foaia n-are URL, dar împinge o intrare marcată `hzSheet:
'quick'`, ca Back să o închidă în loc să iasă din aplicație. Orice altă
închidere (trimite, fundal, Esc) desface intrarea cu un `back()` pe care
`onPop` îl înghite (`quickPop`); „…" (formularul complet) o moștenește prin
`replaceState`. După trimitere foaia se închide, iar confirmarea e Toast-ul
(`showToast` din `ui.tsx`) — cu tastatura jos, nu mai e acoperit.

**Data din foaia rapidă e tot `DuePanel`** (`QuickDue.tsx`), dar inline
deasupra rândului de controale (`.qs-when`), nu foaie de jos — foaia stă lipită
de tastatură. Nimic nu pleacă până la Trimite: fiecare alegere e `manual.due` în
ciornă, care bate data din titlu (`draftSchedule`); „scoate" = fără dată. Fără
rândul mementoului și fără „Se repetă" (captura pune mementoul implicit,
repetarea vine din titlu) — `DuePanel` le ascunde fără `onReminder` /
`onClearRrule`. Butoanele panoului nu iau focusul (`pointerdown` prevenit pe
container), deci după „Mâine" tastatura rămâne și scrisul în titlu continuă;
după calendar / ceas focusul revine pe titlu (✕ de lângă oră e tot buton, deci
nu ia focusul). Rândul din listă și bara de pe Linux (`QuickAdd`) au încă
inputurile native — sunt pe desktop.

**Descrierea pe desktop:** Tab peste un titlu început o deschide, Shift+Tab sau
Backspace pe descriere goală te întorc, Ctrl+Enter salvează din ea (tabelul e
`quickKey`). Pe un titlu gol Tab rămâne navigare. Bara de captură își cere
înălțimea prin `resizeBar` (puntea, opțional); o cutie instalată înainte de el
derulează în loc să crească — se reface cu `npm run desktop:install`.

### Foaia de tichet (telefon): același gest pentru a citi și a edita

Sub 900px, un tichet **existent** se deschide în `EditSheet.tsx` — aceeași
cochilie ca foaia rapidă (`KeyboardSheet`), cu bifa lângă titlu și descrierea
întreagă; „…" duce la formularul complet. Decizia se ia la RANDARE
(`compactIssueIdFrom` din `ui.tsx`, citită de `SheetHost`), ca la panoul
lateral: stiva rămâne un `issue-form` cu id, deci URL-ul `/HZ-12`,
`behindTicket`, Back și deep linkul merg fără nicio ramură nouă în `App.tsx`
— un deep link pe telefon aterizează în foaie, fiindcă asta e forma unui
tichet acolo, iar formularul e la o atingere. „…" pune `full: true` pe
aceeași intrare (fără istoric nou), deci Back închide formularul și te lasă
pe lista din care ai pornit. Un tichet creat din formularul complet
(`openEditIssue(id, { full: true })`) rămâne în formular.

**Rândul de jetoane stă sub titlu** în foaia de tichet (redesignul „Senin", 2026-10-14): foaia se deschide ca să citești, deci ziua se vede odată cu titlul, chiar peste o descriere lungă. În foaia rapidă rămâne jos, lângă tastatură — acolo întâi scrii. Mânerul de sus închide foaia trăgând-o în jos (`sheetDismiss`, `lib/swipe.ts`).

**Ordinea rândului, în ambele foi** (decizia omului, 2026-10-16, macheta
`design/quick-row/index.html`, varianta A): `[zi] [proiect] (inițiale) ···
[⚡] [📎] [⋯] (↑)`. Jetoanele cu text (când + unde) la stânga, ele se taie
primele cu „…"; comutatoarele (iconițe fixe) grupate la dreapta, lângă
Trimite, în arcul degetului mare. Grupul e un singur element (`.qs-tools`,
`margin-left: auto` = golul elastic), ca la text mărit să treacă întreg pe
rândul al doilea, nu rupt. Pornit = fundal pal + culoare (⚡ pe
`--urgent-soft`, 📎 pe `--accent-soft`), ca data; fără linia de 2px.
`test:layout` verifică grupul la 320–430px.

**Nu ia focusul la deschidere:** deschizi ca să citești, iar tastatura ar
acoperi exact descrierea. Proiectul e afișat, nu ales — ID-ul îi poartă
prefixul, iar formularul complet nu-l schimbă nici el.

**Data din titlu se aplică la un gest de încheiere, nu la pauză.** Titlul
recunoaște data (`useTitleDate`, evidențiere + refuz la atingere, oglinda
`EditTitle` după tiparul `sh-title-mirror` — titlul se rupe pe rânduri, deci nu
`QuickTitle`). Cu salvare automată, un „mâine" aplicat la pauza de 800ms și-ar
muta scadența sub degete, la jumătatea frazei. De-aia: cât e evidențiată o
dată, `normalize` ține titlul pe loc (pauza nu-l trimite), iar aplicarea vine
la blur, Enter, „…" sau închidere — un singur patch, titlul fără fragment plus
scadența. Jetonul de dată arată dinainte rezultatul (`.qs-due.pending`, inelul
evidențierii). Ce era deja în titlu la deschidere pornește refuzat
(`initialRejected` + `dateFragments`): „Ședință la 17", scris acum o lună, e
text, nu o cerere de a muta scadența azi.

**Peste o scadență existentă textul înseamnă altceva** decât la captură:
„la 17" pe o ședință de joi e „joi la 17", nu „azi/mâine la 17". Regula e
`mergeTitleDue` (`src/lib/titleDue.ts`, pur, tabel de cazuri în test), iar
`parseDue` spune ce a fost SCRIS (`hasDay`/`hasTime`), nu doar ce a ieșit —
ziua implicită a parserului nu se poate deosebi altfel de una scrisă. Excepția
(D-317): dacă ziua păstrată + ora cad în trecut — sarcină de azi, „at 8" scris
seara, sau o restantă — câștigă rostogolirea parserului (mâine la 8). Pe o
recurentă, ora schimbă seria, ziua mută doar apariția; `rrule` se schimbă
numai la o expresie de recurență.

**Jetonul de dată deschide panoul formularului** (D-197): `DuePanel`
(`src/components/DuePanel.tsx`, același corp ca popoverul datei din formularul
complet), în `ChipPop` ca foaie de jos — nu cele două inputuri native, care pe
un telefon en-US arătau `10/16/2026` și `--:-- --`. `SheetDue` (`EditSheet.tsx`)
scrie pe loc, prin `reschedule` (mementoul își ține decalajul, `rrule` neatins):
presetările, calendarul, ceasul și ✕ de lângă oră (= toată ziua), imediat.
Deschiderea aplică întâi o dată evidențiată în titlu (gest de încheiere, ca „…").

**Data nu se scrie de mână** (decizia omului, 2026-10-17: „aleg mereu din
calendar"). Sub presetări, `DuePanel` are două butoane, nu câmpuri: ziua
(„Azi" + „sâm 17 oct" dedesubt, altfel „Lun 20 oct"; fără dată „Alege data";
`pickDayLabel` din `schedule.ts`) și ora („10:30" cu ✕, sau „Oră"). Fiecare
buton ESTE un `NativePick` — inputul nativ transparent peste tot butonul —,
deci atingerea / clicul deschide direct calendarul / ceasul sistemului, în
toate trei gazdele (foaia de tichet, foaia rapidă, popoverul formularului).
Valoarea întoarsă se validează (`fromInputDate`, `fromTimeText`). Tastatura
(desktop): butonul e focusabil, Enter/Space cheamă `showPicker()` (acolo e un
gest de tastatură pe desktop, nu drumul atingerii de pe telefon), iar celelalte
taste de editare sunt oprite — inputul e transparent, un segment schimbat cu
săgeata n-ar fi văzut. `useDueFields`, masca `zz/ll/aaaa` și câmpurile scrise
au ieșit.

**Fără buton de salvare.** `src/lib/autosave.ts` (pur, cu teste) + `useAutosave`
din `hooks.ts` — gândite să fie reluate de formularul complet când pierde și el
butonul. Textul pleacă după 800ms de pauză și la orice închidere (demontare,
`pagehide`); jetoanele imediat. Patch-ul conține **numai** câmpurile schimbate
față de ultima valoare știută ca fiind în bază: un patch cu tot tichetul ar
rescrie în tăcere o schimbare venită de pe alt dispozitiv sau saltul unei
recurențe. O poză nouă din store nu calcă un câmp murdar sau în zbor. Ordinea
spre bază o ține `enqueueWrite` — `updateIssue` trece acum și el prin coadă,
nu doar `toggleDone`.

**De ce n-are nevoie de cheia cu `dueAt`** (regula din „Panoul lateral"):
scadența din foaie nu e o copie făcută la montare, ci ciorna rebazată din store
la fiecare randare, deci saltul unei recurențe bifate din foaie se vede pe loc.
Toastul de anulare urcă sus cât e o foaie lipită de jos deschisă — altfel
stătea peste titlu.

**Rândul de controale la 390px:** agrafa e numai iconiță, anul curent nu se
scrie în jeton, iar pe rândul cu Trimite (foaia rapidă) ora cedează locul sub
~380px (container query pe `.qs-form`) — altfel ieșea „Mâine 10:…" și „Exem…".
`npm run test:layout` verifică „Mâine" + „Exemplu" întregi în ambele foi.

**Fără tastatură, foaia are minim ~43% din înălțimea vizibilă** (`--vvh`, nu
`dvh`), ca titlul să cadă la ~57% de sus, sub degetul mare ținut puțin sub
mijlocul telefonului. Încercate pe telefon, 2026-10-03: 20% (foaia lipită de
bara de navigare) era prea jos, 70% prea sus. Spațiul în plus e al descrierii, deci o atingere sub text începe
scrisul. Pe `--vvh`, nu `dvh`, ca la tastatura deschisă minimul să scadă singur.

### Firul în foaia de tichet

Sub jetoane, foaia arată **un singur rând de fir** (`SheetThreadRow.tsx`,
macheta `design/sheet-comments/index.html`) — numai dacă tichetul are cel puțin
un eveniment: ultimul (avatar, autor, ora scurtă, text) + numărul. Necitit =
ultimul eveniment e al altcuiva și mai nou decât `issue_seen.seen_at`
(`threadRowState`, `src/lib/thread.ts`, pur, cu teste; o notă migrată nu e
necitită): accent-soft, „nou", corpul pe 2 rânduri. Citit: o linie gri. O pasă
către mine scrie „Ți l-a pasat X" + mesajul (comentariul și pasa au același
`created_at`, de-aia rezumatul aduce ultimele DOUĂ). Se ascunde cât titlul sau
descrierea au focus.

- **Datele:** `repository.threadSummary` (count exact + ultimele două + vizita),
  cerut leneș la deschidere, ținut în memorie de `src/data/threadSummary.ts`
  (nu în store — ar fi randat listele). Invalidat la `postToThread`/
  `updateComment` și la `refresh()`; offline (`net()`) sau la eroare rândul
  lipsește. Primul cadru, pentru un tichet pasat mie, vine din `inbox`
  (`threadRowFromInbox`), numai în starea necitită.
- **Fără salt (2026-11-20):** rândul (și miniaturile) stau DEASUPRA
  descrierii, deci sosite după o rundă la server o împingeau în jos. Listele
  își cer rezumatele și fișierele în lot, în idle (`src/data/sheetPrefetch.ts`,
  `threadSummaries`, `prefetchAttachments`), iar invalidarea NU mai șterge:
  valoarea veche stă pe ecran cât vine cea nouă (numai pentru rând — vizita
  pentru „nou" din `Thread` e mereu proaspătă; offline valoarea veche pleacă).
  Vezi `docs/agent/viteza-deschidere.md`.
- **Atingerea** = „…" cu `at: 'thread'` (`expandIssue`, aceeași intrare de
  istoric): `Thread` se derulează la separatorul „nou" (`firstUnreadId`), fără
  focus în casetă.
- **Citit se face în `Thread`**, pe telefon și pe desktop, când firul **intră
  în vedere** (`IntersectionObserver` pe separatorul „nou", altfel pe tot firul),
  nu la încărcare — în panou firul stă sub descriere, iar un „nou" stins la
  încărcare s-ar fi stins nevăzut. Condiția e `needsSeen` (`lib/thread.ts`):
  ceva străin mai nou decât vizita. Rândul de sus rămâne „nou" cât stă tichetul
  deschis (`keepUnread`), ca separatorul din fir — altfel ar fi clipit și s-ar
  fi stins la deschidere. Înainte doar „Ale mele" marca, deci un tichet deschis
  din „Azi" rămânea necitit la nesfârșit.

### Fișierele din foi și de ce persoana a ieșit din rând

În ambele foi, locul persoanei e al agrafei (meniu: „Fă o poză" = `<input
capture>`, „Alege fișier" = input simplu). De pe telefon se face poza tablei
sau a bonului; pasarea nu e un gest de rând de controale. **Foaia de tichet
nu mai scrie `assigneeId`:** pasarea trece prin fir (`post_to_thread`, în
formularul complet), unde comentariul și pasa sunt un singur gest — un select
în foaie pasa fără niciun cuvânt, pe lângă fir. Rămân inițialele, numai
citite, care deschid formularul. Captura păstrează `@nume` în text.

Foaia de tichet urcă pe TICHET (`event_id` null, ca bara formularului) prin
`uploadPicked` (`data/attachments.ts`, un singur drum de micșorare + nume
pentru bară și foi). Rândul de miniaturi apare doar cu fișiere; ștergerea e în
`Lightbox`, nu pe miniatura de sub degetul mare. Progresul e „se urcă", nu un
procent: `storage.upload` nu dă octeți.

Foaia rapidă ține fișierele în memorie și le urcă după creare. **Fișierele nu
trec prin coada offline:** offline sau cu ID provizoriu (`HZ-~…`) se refuză cu
un toast (`attachBlocked`). O coadă de poze ar fi pus octeți în IndexedDB lângă
tichete și ar fi reluat urcări pe date mobile ore mai târziu — v1 spune pe
față ce n-a plecat.

**„Descarcă tot"** (`DownloadAll` din `Attachments.tsx`, de la 2 fișiere, în
bară și în rândul de miniaturi): un browser nu poate crea un folder în
Descărcări, deci folderul e ÎN arhivă — `HZ-12 Titlu.zip` → `HZ-12 Titlu/…`
(`src/lib/zipName.ts`, pur). `fflate` se încarcă la cerere, fără compresie.
Ascuns în APK: WebView-ul n-are `DownloadListener`, iar un `blob:` n-ar face
nimic acolo — ar cere un APK nou.
