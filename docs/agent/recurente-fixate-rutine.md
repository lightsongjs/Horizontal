# Recurențe, sarcini fixate, rutine

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Recurențe — un tichet care sare

O sarcină cu `rrule` bifată **nu se închide**: `due_at` avansează la următoarea
apariție, `remind_at` se mută cu același decalaj, `done` rămâne `false`. Nu
există rânduri-instanță și nu există istoric al apariției — asumat, vezi
`docs/superpowers/specs/2026-09-20-recurente-design.md`. Migrarea
(`supabase/migration-recurrence.sql`) nu adaugă nicio coloană: `rrule` exista
deja din `migration-todo.sql`, iar anularea (mai jos) nu ține valorile vechi în
bază — n-are nevoie de `prev_due_at`/`prev_remind_at`.

**Saltul se calculează din ziua CURENTĂ**, nu cu un pas de la scadență: bifezi
joi o sarcină zilnică restantă de luni → sare pe vineri. Zilele sărite dispar;
nu sunt datorate. Altfel o sarcină făcută ar rămâne roșie și ar acumula o
datorie pe care nimeni n-o plătește.

**Saltul trăiește într-un trigger Postgres** (`issues_zz_advance_recurrence`,
`supabase/migration-recurrence.sql`), nu în store. Trei drumuri bifează un
tichet și doar unul e interfața: butonul „Gata" din notificare **fără nicio
filă deschisă** scrie prin `reminder-action` direct în REST, iar `functions/api`
scrie cu cheia de serviciu. Logica în client le-ar fi lăsat pe ultimele două să
închidă definitiv o sarcină recurentă. Ordinea alfabetică a trigger-elor
`before update` contează, și de-aia numele are `zz_`: saltul trebuie să ruleze
**după** `issues_reset_reminder_sent`, fiindcă el decide singur și
`reminder_sent_at` — un memento care cade în trecut (decalaj „cu o zi înainte"
peste o sarcină zilnică) pleacă marcat ca livrat, altfel cronul l-ar trimite în
minutul următor, în fiecare zi. `localRepository` (modul local, fără Postgres)
oglindește același trigger în TS și verifică aceeași **tranziție** `false →
true` — nu doar valoarea din patch — citind `wasDone` înainte de a aplica
patch-ul, exact ca `new.done and not old.done` din SQL: un `updateIssue(id,
{ done: true })` pe un tichet deja bifat n-are voie să sară scadența a doua
oară.

**Regula de salt e scrisă în două limbi** — `src/lib/recurrence.ts` (interfață +
modul local) și `next_occurrence()` în PL/pgSQL. Cele două parsează RRULE cu
aceeași listă ALBĂ de patru chei (`FREQ`, `INTERVAL`, `BYDAY`, `BYMONTHDAY`):
orice cheie necunoscută, orice valoare în afara intervalului ei, întorc `null`
în amândouă — nu o listă neagră de nume de ținut la zi manual. `UNTIL` și
`COUNT` cad prin construcție (nu sunt în listă), nu printr-o verificare
separată. De aceea **`npm run test:recurrence-sql`** trece ACELEAȘI 24 de
fixtures din `src/lib/recurrence.fixtures.ts` prin baza reală, cu
`TZ=Europe/Bucharest` fixat înainte de a construi vreo dată. Rulează-l după
orice atingere a oricăreia dintre cele două. Un caz nou se adaugă în
`FIXTURES`, nu într-un `it` separat — acolo îl vede și SQL-ul.

Fusul din SQL e constanta `'Europe/Bucharest'`. Un utilizator în alt fus ar
sări cu o zi; atunci `p_tz` devine o coloană, nu un default.

Vocabularul din text (`parseDue`): `zilnic`, `la 2 zile`, `în fiecare luni`,
`lunea și joia`, `în zilele lucrătoare`/`de luni până vineri`/`every weekday`
(caută-le PRIMELE: altfel „în fiecare zi lucrătoare” ar fi prins ca „în fiecare zi”), `săptămânal`, `lunar`, `pe 15 ale lunii`, `anual`, plus EN.
**Prima apariție (decizia omului, 2026-10-05):** cu oră scrisă, azi contează,
dacă azi se potrivește și ora n-a trecut („în fiecare luni la 15”, spus luni
dimineața, e azi). Fără oră pornește de după azi („în fiecare luni”, spus luni,
e lunea viitoare). O oră deja trecută azi sare la următoarea apariție, și pe
`pe N ale lunii`. Regula stă în `parseDue`, după oră, nu în `firstOccurrence`.
„daily” e cuvânt-cheie, deși e și numele unei ședințe. Se refuză prin atingere,
iar click-ul care urmează atingerii e înghițit (`swallowNextClick`, `hooks.ts`):
foaia scade sub deget, iar click-ul ar fi căzut pe fundal și ar fi închis-o.
**Forma articulată e semnalul:** „luni" e o dată, „lunea" e o recurență — fără
distincția asta, „programează luni" (o dată) și „în fiecare luni" (o
recurență) ar cere același cuvânt pentru două lucruri diferite, și parserul
ar trebui să ghicească din context. Subsetul RRULE e mic și închis (`FREQ`,
`INTERVAL`, `BYDAY`, `BYMONTHDAY`); `UNTIL` și `COUNT` sunt **refuzate**, nu
ignorate — ignorate ar face o serie mărginită să curgă la nesfârșit.

**Repetarea nu se alege din butoane** (decizia omului, 2026-10-14): se scrie
în titlu, iar `parseDue` o recunoaște. Formularul doar o arată — jetonul
„Săptămânal” în rândul de jetoane (`recurChipLabel`) și, în popoverul datei,
„Se repetă: săptămânal · scoate”. Preseturile și `RecurrencePicker` au fost
scoase. O recurență fără dată nu se arată și nu se salvează (`rruleOut`).

Anularea e un pas, ținut în memoria paginii cât ține toast-ul (`recurrenceUndo`
în `store.tsx`), nu în bază — de-aia nu există `prev_due_at`/`prev_remind_at`.
`didJumpOnComplete` și `jumpNotice`, ambele exportate din `recurrence.ts`,
decid dacă bifarea chiar a sărit ceva (după ce a răspuns baza, nu după ce a
cerut clientul) și ce scrie toast-ul. Fiindcă anularea n-are niciun ecou
optimist care s-o arate imediat pe ecran, o bifă și o anulare pe același
tichet, la câteva secunde una de alta, pot ajunge la Supabase în ordine
inversă celei în care s-au cerut — un `updateIssue` mai lent ar rescrie peste
anulare. De-aia `store.tsx` serializează scrierile per tichet printr-o coadă
mică (`enqueueWrite`): a doua scriere pe același id așteaptă răspunsul primei,
nu pornește în paralel cu ea.

Setup: `npm run migrate supabase/migration-recurrence.sql`.

## Serii de mementouri („la fiecare 15 minute până la 10")

Un memento care revine din N în N minute într-o fereastră: rugăciunea din oră în
oră, pastilele la 10 minute. Cererea omului, 2026-11-06 („mergeți pe
recomandările voastre"). Se scrie în titlu, ca repetarea — nu din butoane.

**O serie e UN tichet + o coloană** (`issues.ping_every`, minute, 1–720,
`supabase/migration-ping-series.sql`). Câmpurile vechi își păstrează rostul:
`remind_at` = primul ping și ANCORA grilei, `due_at` = capătul ferestrei
(inclusiv: ultimul ping e ≤ el), `rrule` = în ce zile revine (null = doar azi;
`zilnic`/`lunea`… prin lista albă de azi — `UNTIL`/`COUNT` tot refuzate,
`next_occurrence` neatins). Seria NU se codifică în `rrule`: peste tot în cod
`rrule` nenul înseamnă „recurentă". **Nimic nu se scrie la fiecare ping**: cine
sună calculează unde e pe grilă — `pings(remindAt, every, dueAt, now)` →
`{ current, next }` în `supabase/functions/_shared/pings.ts` (importat de
`send-reminders`, de pagină și portat în `core/Pings.kt`), fixtures comune
`src/lib/pings.fixtures.json`. Grila e în milisecunde ABSOLUTE de la `remind_at`:
în noaptea schimbării orei „din oră în oră" rămâne o oră reală între pinguri
(fixtures 29 martie / 25 octombrie). Un ping mai vechi de min(pas, 10 min)
(`pingFreshMs`) nu mai sună — vine oricum următorul.

**Vocabularul** (`matchSeries` din `parseDue`, RO+EN) se caută PRIMUL și se
MASCHEAZĂ cu lungimea păstrată, altfel „la 15" din „la 15 minute", „la 2" din „la
2 ore" și „până la 10" ar fi fost citite drept oră. Pasul: `la fiecare N
minute/ore`, `la N minute` (numai cu unitate de minute/ore), `din N în N
minute`, `la fiecare oră`/`din oră în oră`/`în fiecare oră`, `la (fiecare)
jumătate de oră`, `every N minutes/mins/m/hours/h`, `every hour`, `hourly`,
`every half hour`. Peste 720 de minute rămâne text (mascat, ca „la 1000 minute"
să nu devină ora 10). Alinierea: `la fix`, `la ore fixe`, `on the hour`. Startul:
`de la 9`, `începând cu 9:30`, `from 9`, `starting at 9`, `între 9 și 17`,
`between 9 and 5pm`, `9-17` (numai lângă un pas). Capătul: `până la (ora) 10`,
`until/till 10am`, `to 17` (numai după un start). Zilele: nimic sau `azi` = doar
azi; `zilnic`/`daily`/`lunea`… prin recurența obișnuită (`every 15 minutes daily`
→ `FREQ=DAILY` + 15). O oră liberă rămasă e startul („every hour at 14"). Un
capăt fără am/pm înaintea startului e după-amiaza („from 9 to 5" = 17:00).

**Fereastra** (`seriesWindow`, `src/lib/pingSeries.ts`): fără start, de acum
(rotunjit la minut) + pas; cu `la fix`, primul punct al grilei de ceas (multiplii
pasului dacă împarte ora/ziua, altfel ora fixă următoare). Fără capăt, 23:59.
Fereastra deja trecută → următoarea zi a seriei (sau mâine), la start ori la
09:00. O zi numită fără start → 09:00.
**Abatere de la designul inițial, deliberată:** cu un START scris, ancora rămâne
pe start chiar dacă a trecut („de la 9" scris la 9:20 → `remind_at` 9:00), nu pe
următorul punct de după „acum". Sună tot doar pingurile care vin (cel curent
numai dacă e proaspăt, deci cel mult unul cu ≤ 10 min întârziere chiar la
creare). Motivul: ancorată pe primul ping de după „acum", o serie ZILNICĂ ar fi
pornit în fiecare zi de la ora la care a fost scrisă (saltul ține distanța
`due_at − remind_at`) — „din oră în oră între 9 și 17 zilnic", scris la 11:30,
ar fi început mâine la 12.

**Afișarea.** Un rând în „Azi", ora din coloană = capătul; restanță abia după
capăt (iese singur din `due_at`). Formularul arată jetonul `pingChipLabel`
(„La 15 min · 09:00–10:00", lângă „Zilnic") în locul celui de memento, iar în
popoverul datei „Serie: … · scoate" (`DuePanel`, `series`/`onClearSeries`);
scoasă, mementoul revine la implicitul formei. O mutare a scadenței duce
fereastra întreagă (`reschedule`, `mergeTitleDue`: primul ping își ține distanța
față de capăt); fără oră, seria cade. O zi aleasă de mână în captură o anulează,
ca pe recurență (`draftSchedule`).

**Mecanica pe server.** `send-reminders`: interogarea veche ia doar
`ping_every is null`; a doua (`claimSeriesPings`) ia seriile deschise care au
început, calculează pingul curent și îl REVENDICĂ înainte să trimită —
`update … set reminder_sent_at = <ping> where reminder_sent_at is null or
reminder_sent_at < <ping> returning id`, deci pe o serie `reminder_sent_at` =
ultimul ping trimis. Revendicarea schimbă doar coloana asta, deci
`issues_reset_reminder_sent` și saltul (care urmăresc `remind_at`) nu se bat cu
ea. Push-ul: `tag` = id (pingul nou îl înlocuiește), `renotify`, `TTL` = min(pas,
1 h), `Topic` = id, payload `series: true` → un singur buton, **„Gata" = am văzut
pingul** (`seen`, `SERIES_SEEN_LABEL`): închide doar notificarea, seria continuă.
**Decizia omului (10 nov. 2026):** „e un reminder repetat, nu înseamnă că am
completat task-ul". Înainte butonul era „Gata azi" = bifă, iar clicul din reflex
oprea seria după primul ping. „Amână" ȘI bifa din notificare sunt refuzate pe o
serie peste tot — `reminderMutation`, `runNativeAction`, `reminder-action`
(filtrul `ping_every is null`) — fiindcă un worker, o cutie sau un APK vechi încă
trimit „done"/„Amână". Seria se bifează doar din aplicație → trigger-ul de
recurență: doar-azi se închide, zilnică sare pe mâine cu aceeași fereastră. **Nebifată**, o serie zilnică trece singură pe
ziua ei următoare: `roll_ping_series()` (pg_cron, la minut, jobul
`roll-ping-series`) mută `due_at` cu `next_occurrence` și `remind_at` cu aceeași
distanță, golind `reminder_sent_at`. Una doar de azi rămâne restantă.
`localRepository` oglindește rostogolirea la citire (`rollPingSeries`).

**Cutiile.** Linux: pagina desfășoară seria în pinguri (`upcomingReminders`, de
la cel curent la capăt, max `SERIES_PINGS_LIMIT`), cutia arată „Gata" (= am văzut) și
închide pingul de dinainte (`desktop/src/notify.ts`, cere `npm run
desktop:install`; o cutie veche pune butoanele obișnuite, amânarea e refuzată de
pagină). Android: UN rând cu `every`, desfășurat de cutie — vezi `android.md`.

Teste: `pings.test.ts` (fixtures), `pingSeries.test.ts`, „serii" în
`parseDue.test.ts`, `capture.fixtures.json`, **`npm run test:ping-series-sql`**
(Docker de unică folosință: constrângerea, migrarea de două ori, paritatea
`roll_ping_series` ↔ `rollPingSeries`, revendicarea, bifa din aplicație).

**Ordinea de deploy:** `npm run migrate supabase/migration-ping-series.sql` →
`supabase functions deploy send-reminders` și `supabase functions deploy
reminder-action --no-verify-jwt` → push → APK (`versionCode 23`) și
`npm run desktop:install`. Fără coloană, `send-reminders` nou și citirea nativă
cad (filtrează/cer `ping_every`), iar pagina n-ar putea salva o serie.

## Sarcini fixate („Fixează sus", ca Pin din TickTick)

Spec: `docs/superpowers/specs/2026-10-17-sarcini-fixate-design.md`.
**Regula e cea din TickTick, întocmai** (decizia omului, 2026-10-17, a doua
versiune: „să respectăm întru totul, să nu tot facem excepții"): **fixarea
doar ORDONEAZĂ — urcă un tichet în vârful unei liste din care face oricum
parte; nu aduce niciodată un tichet într-o listă.** Prima versiune (o fixată
stătea în „Azi" cu sau fără dată, peste rutina adormită) a fost refuzată. Coloana `issues.pinned_at` (`null` = nefixat, altfel când),
`supabase/migration-pinned-tasks.sql` — **rulată ÎNAINTE de push**: fără ea
„Fixează sus" trimite `pinned_at` și PostgREST îl refuză (citirile merg).

- **Un câmp de tichet, nu `pinned_items`.** Acelea sunt pătratele din sertar
  (`pins.ts`, ale contului); fixarea unei sarcini e `pinned.ts`. Fiind un
  patch de tichet ca urgentul, merge offline prin coadă, fără cod nou.
- **„Azi" are primul grup „Fixate"**, deasupra restanțelor și a urgentelor,
  numai cu fixatele care sunt oricum în „Azi" (restante sau de azi, `isMine`,
  rutina adormită ascunsă ca oricare). **„7 zile" are și ea un grup „Fixate"**
  sus, cu fixatele din zilele +1..+7. Fixată în Inbox fără dată = sus în
  Inbox (și în filtrele care o prind), nicăieri altundeva; mutată pe mâine
  iese din „Azi" și urcă în „7 zile". Regula e în `buildSmartLists`:
  `pinned`/`weekPinned` sunt extrase din `overdue`/`today`/`week`, care
  rămân EXACT listele de fără fixare (apartenența).
- **Fără dublură, fără numere noi.** Ecranul scoate fixatele din grupul zilei
  (`unpinned`, `lib/pinned.ts`) fiindcă stau deja sus; numerele (antet,
  sertar, sidebar, widget) numără `overdue`/`today`/`week` întregi — deci
  sunt exact cele de fără fixare, prin construcție. Rândul din „Fixate" își
  spune ziua (`day` pe `TaskRow`: „Mâine 10:00", ora cade sub 380px) și roșul
  de restanță. O zi al cărei singur rând e fixat nu mai arată „—"/„Nimic pe azi".
- **Bifa nu scoate fixarea**: bifat iese din grup (`isPinnedOpen`), debifat
  revine. Bifa vine pe patru drumuri (interfață, `reminder-action`,
  `functions/api`, Android), deci un „scoate la bifă" ar fi cerut un trigger,
  iar anularea s-ar fi complicat. O recurentă sare și rămâne fixată, gratis.
- Ordinea: fixat cel mai recent primul (`comparePinned`). **Din 2026-11-06 se
  trage de mână** în grupul „Fixate" din „Azi"/„7 zile" (`PinnedRows`): desktop =
  tragi rândul (după 5px; click-ul rămâne click) + Alt+↑/↓; telefon = mânerul
  `.pin-grip` din dreapta (rândul are glisarea și apăsarea lungă), ↑/↓ pe el.
  **Ordinea manuală e tot `pinned_at`, nu o coloană nouă**: `movePinned`
  (`lib/pinned.ts`) pune un timestamp între vecini (sus: ≥ acum; jos: −1 s;
  fără loc la mijloc: renumerotează lista afișată). Cum pagina, cutia de Linux
  și `pinnedOrder` din `Agenda.kt` ordonează deja după el, noua ordine ajunge
  peste tot fără migrare și fără APK; `pinned_at` nu se afișează nicăieri ca
  dată. Ordinea e a tichetului (ca fixarea), nu a omului. Sub 380px rândurile
  din „Fixate" pierd numele proiectului (rămâne punctul), ca mânerul să nu
  strivească titlul. Teste: `pinned.test.ts`, `test:layout` (mânerul), `test:nav`
  („ordine fixate": mouse, Alt+↓, reîncărcare, atingeri pe mâner).
- **Filtrele salvate:** fixatele primele (`compareFilterRows`), deci sus în
  grupul proiectului lor (`groupByProject` păstrează ordinea) — nu un grup
  „Fixate" separat, care ar fi rupt gruparea pe proiect cerută de om.
- **„Listă": fixatele urcă primele ÎN layerul lor**, nu peste layere — layerul
  e read-only (dependențe). „Cards" nu arată fixarea.
- **Unde:** piuneza de pe rândul ID-ului din `EditSheet` (`.es-pin`; iese în
  jos, fiindcă `.kb-grab` sticky acoperă 4px de sus), ⋮ al rândului și „Mai
  mult" al selecției (acțiunea `pin` din `bulkActions`), antetul `IssueForm`
  (`.sh-pin`, imediat, nu prin Salvează; ascuns sub 900px — antetul e plin și
  jetonul de proiect s-ar strivi) și tasta **F** cu un card deschis.
- **Din listă, pe desktop** (decizia omului, 2026-10-17: „pin și pe browser"):
  `RowPin` (`src/components/RowPin.tsx`) în coada rândurilor din `TaskRow`
  („Azi", „7 zile", filtre — și în „Fixate", ca să scoți de acolo) și din
  „Listă". `span role="button"` (rândul e deja buton), `mousedown` prevenit
  + `stopPropagation`: nu deschide tichetul și nu ia focusul. Pe un rând
  nefixat e transparentă dar **își ține locul** (22px), deci hover-ul nu mută
  și nu taie titlul; fixat = accent, capul plin, mereu vizibilă. Poarta:
  componenta o randează doar `!ta.narrow` + drept de scriere + nebifat (în
  „Listă" și în afara arborelui/selecției); CSS-ul o arată doar sub
  `(hover: hover) and (pointer: fine)` — altfel rămâne numai semnul de pe
  rândurile fixate. **Click dreapta** pe rând: `RowMenu` din
  `TaskActions.tsx` („Fixează sus"/„Scoate de sus" + Urgent, cutia
  `.ctx-menu` din sidebar, Esc în captură). Starea meniului stă în provider,
  în afara `value`, iar `openRowMenu` e stabil — rândurile `memo` nu se
  randează la deschidere. **F pe rând** (`useRowPinKey`): rândul cu focus de
  tastatură (Tab) sau cel ales cu H J K L în „Listă", numai fără foaie
  deschisă — cu un tichet deschis (docat sau modal) F e a formularului.
  Toate trei trec prin `ta.run({ kind: 'pin' })`, deci au toastul cu anulare.
- **Widget-ul și notificarea din bară: regula TickTick din `versionCode 15`**
  (vezi „Aplicația de Android"): agenda e aceeași ca fără fixări, iar
  fixatele ei urcă într-un grup „Fixate" primul. `versionCode 14` (regula
  veche) aducea în widget și fixatele fără dată — pagina nu i le mai trimite,
  dar citirea lui nativă încă le cere până la APK-ul nou.
  Fereastra nativă de quick add și foaia nativă a tichetului nu fixează.
- Teste: `src/lib/pinned.test.ts`, „fixate" în `schedule.test.ts` și
  `bulkActions.test.ts`, repo-urile; `test:layout` (grupul, semnul, `.es-pin`
  la 320–430px; piuneza de rând la 1100/1400 nu mută titlul la hover, lipsește
  fără mouse la 390); `test:nav` (piuneza din foaie → grupul primul, fără
  dublură, un tichet fără dată fixat NU intră, mutată pe mâine trece în „Fixate"
  din „7 zile"; pe desktop piuneza de rând nu deschide
  tichetul, click dreapta o scoate, F o comută). Capturi:
  `design/pinned/desktop-*.png`, `banc-rand-*.png`.

## Rutine — proiect „doar mementouri"

Bifa din setările proiectului (`projects.reminders_only`) face tichetele lui
invizibile în „Azi", „7 zile" și widget până sună (`remindAt ?? dueAt`), apoi
apar ca orice sarcină până la bifă — un memento ratat nu se pierde (decizia
omului, 2026-10-07). În proiect se văd toate, ca listă de rutine. Mementourile
(push, Linux, Android) nu se schimbă deloc.

- Regula: `src/lib/routines.ts`; filtrul stă în `buildSmartLists`, iar store-ul
  își armează un ceas pe următoarea ieșire (`nextReveal`) — fără date noi
  listele nu s-ar recalcula.
- Widget: pagina trimite rutinele ȘI pe cele încă ascunse, cu `hiddenUntil`;
  cutia filtrează în `buildAgenda` și armează redesenarea pe min(miezul
  nopții, următoarea rutină). Citirea nativă calculează `hiddenUntil` din
  `projects(reminders_only)`. Fixtures comune: `agenda.fixtures.json` (`routine`).
- O captură din fereastra nativă într-un proiect de rutine se vede pe widget
  până la următoarea citire (`createsAsAgenda` nu știe de rutine) — asumat.
- Setup: `npm run migrate supabase/migration-routines.sql` ÎNAINTE de APK-ul
  nou (`versionCode 7`): citirea nativă cere coloana, altfel agenda rămâne veche.
