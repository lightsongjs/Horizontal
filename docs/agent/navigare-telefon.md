# Gesturi, tab-uri și Back, sertar și filtre

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Gesturile de pe telefon — glisare și selecție

Sub 900px, rândurile din listele inteligente se glisează (dreapta: „Mâine";
stânga: Dată, Oră, Șterge, ⋮ — Urgent e în ⋮) și intră în selecție la apăsare lungă. Pragurile și
blocarea direcției sunt în `src/lib/swipe.ts`, calculul scrierilor în
`src/lib/bulkActions.ts` — amândouă pure, cu fixtures. Pe desktop nu se
schimbă nimic: `TaskRow` randează același buton ca înainte.

**Glisarea completă spre dreapta execută, cea spre stânga nu.** „Mâine" e o
mutare mică și reversibilă; spre stânga sunt trei acțiuni, iar o glisare n-are
cum să aleagă între ele — deschide foaia de dată (presetări + „Alege data…"
nativ). Nu calendarul direct: la ridicarea degetului nu e niciun input sub el
(vezi mai jos de ce asta contează).
„Dreapta = gata" a fost refuzat: bifa face deja asta, la un deget distanță.

**Dată și Oră = selectorul SISTEMULUI, nu unul desenat de noi** (decizia
omului, 2026-10-11). Butonul ESTE un `<input type="date|time">` real,
transparent, întins peste tot cercul (`NativePick.tsx`, 16px ca iOS să nu
mărească): atingerea cade direct pe input și browserul deschide calendarul /
ceasul pe drumul lui obișnuit. **Nu `showPicker()`.** Prima variantă (be8d574)
crea un input ascuns și chema `showPicker()` din click: în Chromium mergea,
dar pe telefon (APK, HyperOS / Android 16) atingerea pe Dată și pe Oră nu
deschidea nimic. `test:nav` înlocuia `showPicker` cu o dublură, deci drumul
real nu rulase niciodată pe Android; câmpurile de dată VIZIBILE din foile de
tichet (atinse direct) mergeau pe același telefon. În plus `showPicker`
consumă activarea tranzitorie (al doilea apel din același gest aruncă
`NotAllowedError`, măsurat în Chromium) și cerea ghicirea anulării
(`cancel`/focus/timer). Cu inputul sub deget anularea pur și simplu nu trimite
`change`. Inputul rămâne montat cât trăiește rândul, iar
`.swipe-right:focus-within` ține banda randată cât selectorul e deschis: un
input trecut pe `display: none` își închide selectorul și `change` s-ar pierde.
`change` nativ, nu `onChange` din React (acela vine și pe `input`, la fiecare
segment tastat pe desktop). Dată păstrează ora; Oră (`preset: 'time'` în
`datePatch`) pune ora pe ziua proprie a sarcinii, sau azi dacă n-are dată ori
ziua a trecut; pe o recurentă ora mută seria (`rrule` neatins). Mementoul își
păstrează decalajul (`moveDue`), ca la orice mutare din listă. Prima zi a
săptămânii și formatul calendarului le dă locale-ul SISTEMULUI (Android:
limba/regiunea), nu `lang="ro"` al paginii — din web nu se pot forța. Foaia
de dată a selecției păstrează presetările, iar „Alege data…" / „Oră…" sunt tot
`NativePick`. Dată și Oră au aceeași greutate, neutre; doar „Mâine" e pe accent.

**Urgent a ieșit din bandă în ⋮** când a intrat Oră: patru butoane la 320px
lăsau din rând ~60px. Tot de-atunci `fullThreshold` nu coboară sub banda
deschisă + 24px — la 320px, 55% din rând (160px) cădea sub banda de 172px și
un rând deschis, tras încă puțin, executa.

**O singură regulă de direcție pentru rând și pentru tragerea de refresh.**
`lockAxis` decide o dată, după 10px; trage-pentru-refresh din `App.tsx`
folosește aceeași funcție, deci un gest blocat pe orizontală nu poate porni și
reîmprospătarea. Două praguri scrise separat ar fi lăsat un unghi în care se
declanșau amândouă.

**Selecția de pe telefon e `useSelection` din `hooks.ts`** — aceeași stare pe
care o folosește `useWaveActions` pentru bara de pe desktop, nu un al doilea
sistem. Ce e nou e doar cromul (`SelectionChrome.tsx`) și foile de acțiuni
(`TaskActions.tsx`). Selecția și foile au intrare în istoric (`hzSheet:
'layer'`, ca foaia rapidă), ca Back pe Android să iasă din selecție, nu din
aplicație; o acțiune care iese singură le desface cu un singur `go(-n)`.

**Anularea ține câmpurile de dinainte, nu o comandă inversă.** `snapshot` pune
deoparte exact ce atinge patch-ul, plus scadența la o bifă pe o recurentă —
triggerul o mută, deci anularea trebuie s-o știe (același motiv ca
`recurrenceUndo`). Scrierile trec prin `applyWrites` → `enqueueWrite`, ca o
anulare rapidă să nu fie depășită de scrierea pe care o anulează.

**Ștergerea nu întreabă, întârzie.** Rândurile dispar acum (`hideIssues`), iar
cererea pleacă la expirarea toastului sau când pagina se ascunde. Un dialog
„sigur?" la fiecare ștergere ar fi învățat omul să apese „da" fără să citească;
fereastra de 5s e confirmarea. Dacă aplicația e omorâtă înainte, sarcina pur și
simplu rămâne — prețul acceptat.

**„Fără dată" e oprit cât selecția are o recurentă**: `reschedule` ar șterge și
repetarea (o repetare fără zi de pornire e o stare din care interfața nu iese).

Teste: `npm run test:nav` glisează și apasă lung cu atingeri reale (CDP, vezi
`scripts/lib-touch.mjs` — `page.touchscreen` știe doar `tap`); `npm run
test:layout` măsoară bara de selecție și banda la 320–430px.

## Tab-urile de sus și Back

„Azi", „7 zile" și „Ale mele" sunt tab-uri de sus (bara de jos), nu pagini
una sub alta — de-aia antetul n-are săgeată: ar promite un „înapoi" spre un
loc care nu e în spatele lor. **Lista „Toate proiectele” nu mai există**
(2026-10-15): proiectele stau oricum, unul câte unul, în bara laterală și în
sertar. „Niciun ecran, niciun proiect” (proiect șters, `/project/<slug>`
necunoscut, pornire fără proiecte, o intrare veche `hzScreen: 'projects'`)
cade pe „Azi” — o singură regulă, efectul de după boot din `App.tsx` (gardat de
`booted`, ca să nu vadă starea dinainte de alegerile boot-ului).
**„Proiecte" nu mai e tab** (2026-10-10): pe
telefon proiectele stau în sertar (☰), iar colțul antetului e mereu ☰, și în
proiect — vezi „Sertarul și filtrele". Pe desktop `.back` e oricum ascunsă.

**„Azi" e rădăcina istoricului.** Convenția Android pentru o bară de jos: Back
de pe orice alt tab duce pe „Azi", Back de pe „Azi" iese. `goTop` din `App.tsx`
desface tot ce e peste rădăcină (`go(-n)`) și reclădește stiva canonică
`[Azi]` sau `[Azi, tab]`, toate pe `/`; `goProject` face la fel cu
`[Azi, /project/<slug>]`, deci Back din orice proiect duce pe „Azi". Fiindcă
toate tab-urile au același URL, fiecare intrare pe `/` își poartă ecranul în
`history.state.hzScreen` — fără el `popstate` n-ar ști pe ce tab a aterizat.
`go` e asincron, deci cât așteaptă (`tabPop`) efectul proiect → URL tace,
altfel s-ar înfige un push în mijloc.
Cu o foaie / selecție / foaie rapidă deschisă, `goTop` nu atinge istoricul:
intrările lor au propria mașinărie și se închid primele. Sidebar-ul de desktop
nu trece prin `goTop`; acolo doar se rescrie marcajul intrării curente.

**Pornirea rece aterizează pe „Azi", reîncărcarea rămâne unde erai**
(`SESSION_KEY` + `LAST_VIEW_KEY`). Lista memorată nu bate „Azi" la o pornire,
dar trebuie să bată la reîncărcare: `pwa.ts` aplică un build nou la revenirea
în tab, adică reîncarcă pagina sub om — n-are voie să-l mute pe „Azi".

**În APK, Back-ul era al activității, nu al paginii.** Fără `@capacitor/app`,
`BridgeActivity` lasă comportamentul implicit (închide aplicația de pe orice
ecran, chiar cu o foaie deschisă). `MainActivity.java` urmează acum istoricul
WebView-ului (`canGoBack` → `goBack`, altfel iese) — cere un APK nou; până
atunci, în cutie Back iese ca înainte, iar în Chrome/PWA merge deja.

## Sertarul și filtrele

Sub 900px, ☰ (sau o tragere din marginea stângă) deschide `Drawer.tsx`: cine
ești + rotița de setări (mutată din antet), rândul de pătrate fixate, listele,
apoi proiectele pe un salt de fundal. Bara de jos ține ce e zilnic; restul,
inclusiv Inbox-ul, stă în sertar, ca la TickTick.

- **Sertarul n-are URL, dar are intrare în istoric** (`hzSheet: 'drawer'`),
  tiparul foii rapide: Back îl închide, fundalul îl desface cu un `back()`
  înghițit (`drawerPop`). Un rând ales NU desface intrarea separat:
  `goTop`/`goProject` desfac oricum tot ce e peste rădăcină, deci Back după o
  navigare nu poate redeschide sertarul.
- **Se închide și trăgând spre stânga** oriunde pe el (`drawerDismiss`, `lib/swipe.ts`, aceeași blocare de direcție `lockAxis`). Pe desktop, în bara laterală derulează doar filtrele și proiectele (`.sidebar-scroll`); cine ești, căutarea și listele zilei stau pe loc.
- **Tragerea din margine pornește doar în `inEdge`** (zona pe care rândurile o
  lasă în pace) și trece prin `lockAxis` (`drawerSwipe`, `lib/swipe.ts`): o
  glisare de rând și deschiderea sertarului nu pot porni din același deget,
  iar o tragere oblică rămâne derulare. Pe Android cu navigare prin gesturi,
  sistemul poate înghiți marginea — atunci rămâne ☰.
- **Fixările sunt ale contului, nu ale dispozitivului** (decizia omului):
  `pinned_items` (`supabase/migration-filters.sql`, RLS `user_id = auth.uid()`),
  scrise prin `net()` — offline se citesc din bază, nu se pun la coadă (n-are
  rost o coadă pentru un pătrat). Ordinea = ordinea fixării, apoi trasă de
  mână (2026-11-06): `position` renumerotat 0…n-1 (`movePin`, `lib/pins.ts`),
  scris cu UPDATE pe rând (`movePins` — un upsert ar reînvia o fixare scoasă pe
  alt dispozitiv). Desktop: rândul din grupul „Fixate" al barei se trage cu
  mouse-ul după 5px (click rămâne click), Alt+↑/↓ pe rândul cu focus.
  Sertarul: pătratul ținut apăsat se ridică, tras își schimbă locul, ridicat
  fără mișcare deschide meniul (ca pe ecranul de pornire Android); ridicat,
  oprește derularea (ascultător nepasiv) și închiderea sertarului
  (`stopPropagation`). Geometria comună: `components/reorderDrag.ts`. Fără
  derulare automată la marginea rândului de pătrate. O țintă dispărută
  (proiect șters, acces pierdut) nu se arată (`livePins`), dar nici nu se
  șterge din bază: o listă de proiecte încă neîncărcată ar fi „șters" tot.
  „Azi" nu se fixează — e rădăcina.
- **Apăsarea lungă** (`useLongPress`, `hooks.ts`) folosește atingeri, nu
  `pointer*`, și înghite click-ul ridicării (`swallowNextClick`) — altfel
  click-ul cade pe fundalul meniului abia deschis și-l închide pe loc. Pe
  desktop: click dreapta, sau ⋮ pe rândul de proiect.
- **Numerele de pe proiecte** vin din `openIssues` (`listOpenIssues`: toate
  tichetele nebifate, transversal) — `listDueIssues` vede doar cele cu
  scadență. Derivat ca `dueIssues`: varianta din `allIssues` câștigă.

**Filtrele salvate** (`src/lib/savedFilters.ts`, pur, cu teste; `saved_filters`
în aceeași migrare) sunt personale și arată doar tichete DESCHISE.

- **Regula persoanei e regula firului:** „ale lui X" = pasate lui X SAU
  nepasate și create de contul lui X (`assignee_id` gol = „al creatorului").
  „Eu" e un jeton separat, legat de cont, nu de rândul din `assignees`: merge
  și pentru un cont încă nelegat. OR în interiorul unui rând de jetoane, AND
  între rânduri; un rând gol = „oricare", și editorul o scrie.
- **Datele sunt `openIssues`, nu `dueIssues`:** un filtru „ale lui Mihai"
  trebuie să vadă și tichetele fără dată, iar `listDueIssues` nu le aduce.
  Scadența refolosește gălețile din `schedule.ts` (restanța nu e și „azi"),
  iar rutinele adormite lipsesc, ca în „Azi".
- **Ecranul filtrului e `filter:<id>` în `screen`**, un kind separat ca „Ale
  mele", nu un `SmartListKind`: n-are zi, deci nici FAB, nici rând de captură,
  nici `dueLoaded`. Pe `/` cu `hzScreen`, ca tab-urile. Grupat pe proiect
  (cerința omului), cu aceleași `TaskRow` (glisare, selecție) și panoul lateral.
  `offProject` din `App.tsx` taie cromul de proiect pe el (C, O, 1–4, „+ Tichet")
  — un tichet docat încarcă proiectul lui în store fără să fie ecranul.
- **Editorul (`FilterForm`, foaie în `SheetHost`) nu navighează singur:** cere
  Shell-ului ecranul prin `hz:open-filter` / `hz:filter-deleted`, iar Shell-ul
  îl deschide DUPĂ randare. Cu foaia încă în `sheetRef`, `goTop` ar fi sărit
  peste istoric și ar fi rescris rădăcina („Azi") cu filtrul — Back ar fi ieșit
  din aplicație. Ștergerea unui filtru își ia fixarea (trigger în bază,
  oglindit în `localRepository` și în store).
- Teste: `npm run test:nav` (☰ + Back, fundal, proiect din sertar → Back pe
  „Azi", tragerea din margine, fixarea prin apăsare lungă, „+ Filtru" →
  ecranul filtrului → Back pe „Azi"); `npm run test:layout` (sertarul,
  pătratele, jetoanele editorului și capul de grup la 320–430px).

**Linkurile din titlu** (2026-11-05): `lib/titleLinks.ts` (pur, cu teste) le
găsește (`http(s)://`, `www.`, aceleași scheme ca `safeHref`), `TitleText` le
arată fără `https://`. Linkul nu-și ia singur click-ul: rândul/cardul întreabă
`openTitleLink(e)` exact în locul în care ar deschide tichetul — așa selecția,
arborele, glisarea și rândul deschis au prioritate. Span, nu `<a>` (rândurile
sunt `<button>`). În foaia de tichet titlul e textarea: oglinda subliniază
linkul și o atingere pe el îl deschide **doar cât titlul nu are focus** (regula
descrierii); cu focus e text. Cu mausul, click-ul îl deschide oricând, și cu focus (decizia omului, 26 nov.: focusul vine des fără să scrii — Vim, un click anterior — și linkul părea stricat). La fel în panoul lateral / formular (`IssueForm`, `sh-title-mirror`); helperii comuni sunt `mirrorLinkDown`/`mirrorLinkHover` din `TitleText.tsx`. Păzit în `test:nav`.
