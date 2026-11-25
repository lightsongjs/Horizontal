# Firul și pasarea

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Firul și pasarea

Regula centrală, de care depinde tot restul: `assignee_id` gol înseamnă „al
creatorului" — tichetul stă la cine l-a făcut, fără nicio scriere în plus.
`assignee_id` pus înseamnă „ți-l pasez ție", indiferent cine l-a scris sau cine
l-a pasat înainte. Nu există o a treia stare („nimănui, dar totuși urmărit de
cineva") și nu există un pas separat de „preluare" — a pasa ȘI a scrie un
comentariu sunt un singur gest, `post_to_thread`, ca să nu existe o fereastră
în care comentariul a plecat dar tichetul n-a ajuns la nimeni.

Din regula asta iese direct forma lui „Ale mele": e scurtă **prin definiție**,
nu prin filtrare deșteaptă. Interogarea (`inbox_rows`) cere `assignee_id = al
meu` — un tichet pe care ți-l faci singur n-are niciodată `assignee_id` pus
(rămâne gol, „al creatorului"), deci n-are cum să treacă vreodată de filtrul
ăsta. Golul e vestea bună, nu o eroare, și de-aia ecranul spune asta direct în
loc să tacă. Consecința practică, verificată manual: un tichet pe care l-ai
creat și nu l-ai pasat NIMĂNUI nu apare în „Ale mele" — nici la tine, nici la
altcineva — indiferent de câte comentarii capătă.

Aceeași listă, din API: `GET /api/tickets?assignee=<om>` / `tk mine` (vezi
`docs/agent/cli-tk.md`) — tot `assignee_id = omul`, filtrat în bază.

**Aceeași regulă taie „Azi” și „7 zile”** (2026-10-14): acolo intră doar ce e
al meu — `isMine` (`src/lib/ownership.ts`, pur, cu teste): pasat mie, sau
nepasat și creat de mine ori fără autor (`created_by` null = unealtă cu cheia de
serviciu; nu dispare). Pasat altcuiva sau nepasat-dar-al-altcuiva iese. Se
aplică o dată, pe intrarea lui `buildSmartLists` din `store.tsx`, deci și
numerele (sertar, sidebar, bara de jos, antetul).
Proiectele și filtrele salvate văd tot (au regula lor). Fără identitate
completă (mod local, fără sesiune, cont nelegat de `assignees`) nu taie nimic.
Mementourile de pe Linux urmează regula, și cele de pe Android + widget-ul de
agendă din `versionCode 9` (API 4): regula e scrisă a doua oară în
`core/Ownership.kt`, cu fixtures comune `src/lib/ownership.fixtures.json`, iar
pagina taie lista trimisă cutiei doar dacă `getInfo().api >= 4`
(`ANDROID_API_MINE`) — o cutie mai veche primește tot, altfel ar clipi între
„ale mele" (pagina) și „toate" (citirea ei nativă). Detalii în „Aplicația de
Android". Web push-ul (`send-reminders`) e încă neatins.

**Comentariile proprii se editează** (creionul din capul comentariului,
`updateComment` în `Repository`, prin `net()` offline). `edited_at` îl pune
garda din bază (`issue_events_guard`), nu clientul — grantul e numai pe `body`;
„· editat" apare lângă oră când există. Pasele nu se editează.

**Comentariile proprii se șterg** (2026-11-12, coșul de lângă creion, cu
`confirm`). `deleteComment` e optimist; fișierele comentariului se șterg abia
după ce rândul a dispărut din bază — la eșec rămân pe tichet (`event_id` →
null), nu se pierd. Supabase: `.select('id')` după `delete`, fiindcă RLS
ignoră tăcut un rând refuzat. Baza lasă și adminul să șteargă orice
comentariu; interfața arată coșul doar pe ale tale. Pasele nu se șterg.

**Numerele lui „Ale mele": necititele roșii, totalul gri și mereu vizibil**
(decizia omului, 23 nov. 2026). Până atunci necititele erau pe accent („o pasă
necitită e o chemare, nu o restanță"); Ionuț vrea ca un tichet necitit să sară
în ochi, deci `.sl-new` și `.tb-badge` sunt pe `--blocked`, ca `.sl-late`.
Totalul (deschise pe mine, `fresh + rest` din `groupInbox`, adică `inbox_rows`
`done = false`) stă lângă, gri: `.sl-count` în sidebar, `count` (`.dr-count`)
pe rândul din sertar și `.tb-count` lângă eticheta tabului de pe telefon —
inclusiv pe tabul activ, unde eticheta e albastră și numărul rămâne gri.

**Notificarea „ți-a dat un tichet" pe telefon** (APK, `versionCode 27`, API 8):
în cutie nu există web push, deci `SyncWorker` compară la fiecare rulare
mulțimea tichetelor deschise de pe mine (aceeași regulă ca `inbox_rows`) cu cea
de data trecută — toate drumurile de scriere (fir, `tk comment --to`, formular,
`/api/tickets`) se termină în `assignee_id`, dar numai pasele lasă eveniment.
Detalii, regula „cine a fost" și golurile: „Aplicația de Android" →
`docs/agent/android.md`, „Tichete primite".

**„Nimeni" în selectorul de responsabil** (bug raportat de Ionuț, 24 nov.
2026: „nu pot scoate un tichet de pe mine"). Golirea exista doar ca X-ul mic de
pe numele ales, iar lista se deschidea abia la focus pe căutare — apăsarea pe
chipul persoanei arăta un câmp gol, nimic de ales. Acum `AssigneeSearch`
(`IssueForm.tsx`, același pe desktop și în foaia de pe telefon) pornește cu
lista deschisă, iar primul rând e „Nimeni — rămâne la creator" (`assignee_id`
null, regula de mai sus). Firul are deja echivalentul („rămâne la creator"),
iar acțiunea pe selecție („Pasează") pe „Înapoi la creator".

**Lista „Ale mele" e derivată, nu un al doilea adevăr.** `inbox_rows` e o poză
a acelorași câmpuri care trăiesc și în tichete (`assignee_id`, `done`, titlu),
adusă doar la pornire, la refresh și după `post_to_thread`. Orice altă scriere
o lăsa în urmă: îți puneai numele din formular și ecranul rămânea gol, ți-l
scoteai și rândul rămânea acolo. De-aia `reconcileInbox`
(`src/lib/thread.ts`) trece instantaneul prin `allIssues` înainte de grupare —
același tipar ca `dueIssues`. Un tichet dintr-un proiect NEîncărcat nu se
atinge (absența lui înseamnă „nu știu", nu „nu mai e al meu"), deci ștergerea
îl scoate din `inboxRaw` explicit, ca la `dueRaw`.

**Crearea e primul eveniment** (2026-11-06). Un tichet creat de altcineva
direct pe numele tău (Alex, NK-56…62) n-are nicio pasă, deci `inbox_rows` n-avea
nici autor, nici oră: rândul ieșea „de la cineva —", cercul scria „CI"
(inițialele lui „cineva"), iar bulina nu se aprindea. Acum `listInbox` aduce
și `created_by`/`created_at` (o a doua citire pe `issues`, fără migrare), iar
`withCreation` (`lib/thread.ts`) le folosește când firul tace: „de la"
creatorul și ora creării, necitit până îl deschizi. Creat de tine → „de la
tine", fără bulină. Creator necunoscut (`null`: importul din 17 sep. sau API
fără `author`) → „cineva" și „?" în cerc, nu un expeditor inventat.

**De ce „Ale mele" nu e un `SmartListKind`.** Ar trece de typecheck ca al
patrulea membru, dar ar strica trei lucruri deodată: ecranul ar aștepta
`dueLoaded`, o încărcare de scadențe care nu-l privește (un tichet ajunge aici
prin pasă, nu prin dată); quick add-ul de pe un `SmartListKind` cere o zi
implicită, iar „Ale mele" n-are — nu există „azi" pentru o pasă; și FAB-ul de
adăugare rapidă ar apărea pe un ecran unde „sarcină nouă" n-are sens: aici nu
se creează, aici se primește. `screen` din `App.tsx` ține „Ale mele" ca un
`kind` separat, în afara `SmartListKind`, tocmai ca aceste trei să rămână
neatinse.

**De ce firul e o singură tabelă, cu `kind`, nu două.** Un comentariu și o pasă
sunt evenimente pe aceeași axă de timp, iar orice loc care le arată (Thread.tsx,
un export, un raport viitor) le vrea împreună, cronologic. Cu două tabele,
fiecare loc ar fi trebuit să interclaseze după `created_at` — un merge pe care
l-ai fi scris din nou de fiecare dată, cu ocazia să greșești ordinea o dată din
n. `issue_events.kind` (`comment`/`handoff`) plus constrângerea de formă
(`issue_events_shape_chk`: un comentariu n-are `handoff_from`/`handoff_to`, o
pasă n-are `body`) țin „un gest, două rânduri posibile" ca invariant de bază,
nu de proză.

**De ce scrierea trece printr-o funcție Postgres, nu prin apeluri separate din
client.** Trei apeluri (insert comentariu, update assignee, atașare fișiere la
eveniment) pot reuși pe jumătate — rețeaua pică exact între al doilea și al
treilea, și rezultatul e un comentariu scris care spune „ți-l pasez", dar
tichetul a rămas la tine. `post_to_thread` (`supabase/migration-comments.sql`)
face totul într-o singură tranzacție, cu `for update` pe rândul tichetului ca
două pase simultane să nu scrie două rânduri cu același `handoff_from` —
istoric fals, nu doar o stare pierdută.

**„Creat de X" (`IssueSheet.tsx`, pe cardul de dependență) vine dintr-un
default de bază, nu dintr-o scriere de client.** `created_by` are
`default auth.uid()` (`supabase/migration-comments.sql`) — la fel ca
`issue_seen.user_id` mai sus. Un client care ar trimite `created_by` explicit
ar putea numi pe altcineva drept autor, plus că un `null` explicit e o
valoare, nu o absență, deci ar bloca exact default-ul pe care ne bazăm;
`supabaseRepository.createIssue` nu-l trimite niciodată la insert. Ecoul
optimist întors imediat (înainte de orice refetch) citește totuși sesiunea
locală (`db.auth.getSession()`, de obicei fără rundă către rețea — dar nu
garantat: cu tokenul aproape de expirare, chiar `getSession()` îl
reîmprospătează, ceea ce E o cerere de rețea) ca să-l aproximeze corect —
altfel un card de dependență deschis pe tichetul abia creat, înainte de
următoarea reîncărcare, ar arăta gol deși rândul din bază e deja corect.

**Un tichet scris cu cheia de serviciu n-are autor uman, și așa trebuie să
rămână.** `functions/api/` (ticket-kit) scrie direct prin REST cu
`SUPABASE_SERVICE_ROLE_KEY`, fără sesiune de utilizator — `auth.uid()` e
`null` în contextul ăla, deci `created_by` rămâne `null`, la fel ca înainte de
fix. Nu e o gaură: e coloana spunând adevărul. Un tichet creat de o unealtă nu
are cine să fie „Alex" sau „Bogdan", și inventarea unui autor ar fi mai rea
decât lipsa lui. **Excepția (2026-10-27): autorul DAT, nu inventat.** `POST
/api/tickets` primește opțional `author` (nume / id assignee / id cont, legat de
un cont), iar `tk` trimite omul configurat pe calculator (`tk whoami --set`):
atunci `created_by` = contul lui. Fără `author`, tot `null`.

**Firul din API** (`GET/POST /api/tickets/<id>/comments`, `tk comments` /
`tk comment`). Decizia omului: un comentariu pus prin `tk` e **al omului**
(„Ionut”), nu al unei „unelte” — deci `author` e OBLIGATORIU la POST (fără el
`author_required`; `tk` refuză cu „rulează `tk whoami --set`”), validat ca rând
din `assignees` cu `user_id` (`author_not_found` / `author_not_linked`). Scrierea
e `post_to_thread_api` (`supabase/migration-thread-api.sql`, numai
`service_role`): același gest ca `post_to_thread` — comentariu + pasă într-o
tranzacție, `for update` pe tichet, `handoff_from` = cine îl avea înainte,
„văzut” pentru autor —, cu autorul ca parametru în loc de `auth.uid()`.
**Drepturile nu se lărgesc:** cheia API e deja cheie de serviciu și poate scrie
orice rând (inclusiv `author_id`) direct; regula doar cere un om real. De aceea
interfața n-are nimic nou: un comentariu din API arată ca unul din aplicație, iar
`author_id` null rămâne numai „notă mutată”. Fișierele unui comentariu urcă
întâi pe tichet (`/attachments`), apoi `attachmentIds` le leagă (drumul
aplicației). `notes` e câmpul vechi (mutat o dată în fir, §10 din
migration-comments.sql) — ghidul `tk` trimite discuția în fir. Din 2026-10-30
nu se mai SCRIE deloc: `tk` și `ai-client` refuză `--notes`, API-ul răspunde
`notes_removed` la orice conținut (doar golirea trece), `tk get` nu-l mai arată.
Ce se scrisese după migrarea în fir a fost mutat la finalul `desc`-ului, sub
„## Note de lucru (mutate din câmpul vechi „notes”)”. Coloana rămâne în bază.
Teste: `functions/api/_thread-lib.test.ts`, `tickets/[id]/comments.test.ts`,
`cli/*`, `npm run test:thread-api-sql` (Docker de unică folosință — NICIODATĂ
producția). Setup: `npm run migrate supabase/migration-thread-api.sql`
**ÎNAINTE** de push (fără ea POST-ul răspunde `migration_missing`, citirea merge).

`localRepository` (modul local, fără conturi) rămâne cu `createdBy: null` la
creare, deliberat: n-are cine să fie creatorul, la fel cum autorul unui
comentariu local e string-ul `'local'` și `myAssigneeId` e mereu `null` — nu
un rest uitat, ci aceeași lipsă de identitate peste tot.

Verificat manual, cu conturi reale (`.superpowers/sdd/2026-09-17-comentarii-si-pasare/verify-rpc.mjs`
e tiparul pentru fir/pasă; ciclul complet — creare, comentariu + atașament +
pasă într-un singur gest, bulina de necitit, pasă înapoi — a fost dus până la
capăt cu conturi temporare, șterse la final): un tichet creat prin interfață
arată „creat de <numele contului>" pe cardul de dependență, imediat, fără
reîncărcare; un tichet creat prin `POST /api/tickets` are `created_by null` în
bază.

Pasul de setup: `npm run migrate supabase/migration-comments.sql`, apoi
`node scripts/link-assignees.mjs` ca să legi conturile de rânduri din
`assignees` (fără el, „Ale mele" spune corect „nu ești legat de niciun nume" —
nu e o eroare, e starea de dinainte de legare). Pe o bază nouă `assignees` e
goală — nu există niciun `<assigneeId>` de dat scriptului — deci primul rând se
creează ȘI se leagă într-un singur pas: `node scripts/link-assignees.mjs
--create <nume> <email>`. Fără argumente, scriptul listează conturile și
rândurile existente, ca să știi ce id să folosești la o legare ulterioară.
