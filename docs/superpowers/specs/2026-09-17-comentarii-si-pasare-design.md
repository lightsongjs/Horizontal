# Comentarii, creator și pasarea tichetelor — design

**Data:** 17 septembrie 2026. **Prototip interactiv:** `prototype-comments.html`
(stare în memorie, cu un panou de regie care comută între Ionuț / Alex / Maria,
ca să se poată juca ambele capete ale pasei).

## Problema

Aplicația are `assignee_id` pe tichet de la început, dar el n-a fost niciodată un
mijloc de **comunicare**. Trei goluri îl fac inutilizabil pentru lucrul în doi:

1. **Nu se știe cine a făcut tichetul.** Un tichet apărut peste noapte n-are
   proveniență; singurul indiciu e stilul titlului.
2. **Nu există un loc de vorbit pe tichet.** Există `notes`, un bloc de text
   liber care se rescrie: n-are autor, n-are oră, iar doi oameni care scriu în
   el se suprascriu unul pe altul fără să observe.
3. **Assignee-ul nu e o predare.** E o etichetă pe care o pui și pe care
   celălalt n-are cum s-o vadă decât intrând în proiect și uitându-se atent.

Ciclul pe care îl cere omul e simplu și, azi, imposibil: *Alex face un tichet →
îl văd că e de la Alex → întreb ceva în scris → i-l dau înapoi lui Alex → Alex
răspunde și mi-l dă înapoi.*

## Regula centrală

**`assignee_id` gol înseamnă „al meu, prin creație". `assignee_id` pus înseamnă
„ți-l pasez ție".**

Atribuirea nu mai e o etichetă descriptivă, ci un act de predare. Consecința e
ce face întreaga funcționalitate suportabilă pentru cineva care își ține toate
gândurile în aplicație: **un ecran „Pe mine" e scurt prin definiție, nu prin
filtrare deșteaptă.** Cele opt sute de tichete pe care ți le faci singur au
`assignee_id` null și nu pot ajunge niciodată acolo.

Din regula asta decurge direct ștergerea lui `defaultAssigneeId` din
`IssueForm.tsx` (azi pune automat assignee = tu la tichetele noi din proiectele
personale). Fără ștergere, cutia de pase s-ar umple exact cu ce trebuie să
lipsească din ea, iar prima impresie a funcționalității ar fi „încă o listă cu
tot".

## Identitate: un singur om, nu doi

Azi există două sisteme paralele care nu se ating:

| | `auth.users` | `assignees` |
|---|---|---|
| ce e | contul real: email, membru de proiect, admin | un rând cu `id` + `name` |
| cine ești | sesiunea Supabase | `myAssigneeId` din `localStorage`, ales manual |

Creatorul unui tichet și autorul unui comentariu **trebuie** să fie contul: ele
sunt fapte, nu preferințe, și un „eu sunt X" din `localStorage` se poate minți.
Assignee-ul însă trebuie să rămână atribuibil și unui nume fără cont — „echipa
de API", „juridic" — exact ca `owner`-ul obstacolelor.

Soluția: `assignees` primește `user_id uuid null`. Un rând cu `user_id` e o
persoană cu cutie poștală; unul fără e un nume liber. La login, sesiunea își
găsește rândul prin `user_id`; dacă nu există niciunul, se caută după email și
se leagă, iar în ultimă instanță se creează unul din partea locală a emailului.

`myAssigneeId` nu mai e stare de utilizator, ci o valoare derivată din sesiune.
`setMyAssigneeId` și cheia lui din `localStorage` dispar din `store.tsx`.

## Ce NU se schimbă

Merită spus explicit, fiindcă e mult cod care s-ar putea crede atins:

- **`computeLayers` din `src/lib/engine.ts`.** Nici o pasă, nici un comentariu
  nu mișcă un layer. Axa val/layer rămâne ortogonală pe axa „cine ține tichetul",
  exact ca la obstacole.
- **`blockedBy` din `src/lib/obstacles.ts`** și tot planul obstacolelor.
- **Scadențele și listele inteligente Azi / Mâine / 7 zile.** Cutia de pase e un
  ecran în plus, nu o rescriere a lor.
- **Bucketul de atașamente, politicile lui de storage, `shrinkImage`, galeria și
  lightbox-ul.** Atașamentele comentariilor intră prin aceeași conductă.

## Model de date

Fișier nou, idempotent, ca toate celelalte: `supabase/migration-comments.sql`.

### `assignees` — legătura cu contul

```sql
alter table assignees add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists assignees_user_idx on assignees(user_id) where user_id is not null;
```

Tabela `assignees` **nu apare în `supabase/schema.sql`** — a fost creată direct
în dashboard. Migrarea o creează dacă lipsește, ca fișierul să poată fi rulat pe
o bază curată.

Indexul e parțial fiindcă `null` nu e o identitate: pot exista oricâte nume
libere fără cont, dar un cont se leagă de cel mult un rând.

### `issues` — proveniența

```sql
alter table issues add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table issues add column if not exists created_at timestamptz not null default now();
```

`on delete set null` și nu `cascade`: ștergerea unui cont nu poate șterge munca.
Un tichet al cărui creator a plecat arată doar data — informația care rămâne
adevărată.

`created_at` nu există azi pe `issues`. Tichetele vechi primesc `now()` la
migrare, ceea ce e o minciună blândă și vizibilă (toate au aceeași oră); nu
există o sursă mai bună, iar alternativa — `null` — ar cere o ramură în fiecare
loc care afișează data.

### `issue_events` — firul

```sql
create table if not exists issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id text not null,
  project_id text not null,
  kind text not null check (kind in ('comment','handoff')),
  author_id uuid references auth.users(id) on delete set null,
  body text not null default '',
  handoff_from uuid references assignees(id) on delete set null,
  handoff_to   uuid references assignees(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  foreign key (issue_id, project_id) references issues (id, project_id) on delete cascade
);
```

**De ce `issue_events` și nu `comments`.** Firul arată două feluri de lucruri:
ce s-a zis și cine ține tichetul. Ele răspund la întrebări diferite, se
randează diferit (comentariul are casetă, pasa e o notă de margine) și au
autoritate diferită — o pasă e un fapt al sistemului, un comentariu e o
afirmație a unui om. Dacă ar fi două tabele, fiecare afișare a firului ar cere
un merge cronologic în client și o paginare care să se împace cu el. O tabelă cu
`kind` ține firul o singură citire ordonată.

**Un gest, două rânduri.** „Trimite și pasează" scrie un rând `comment` și un
rând `handoff`, în aceeași tranzacție. Nu se contopesc într-un singur rând cu
`handoff_to` opțional, fiindcă atunci o pasă fără comentariu ar fi un rând cu
`body` gol — adică o replică goală în fir — iar interfața ar trebui oricum să
le despartă la randare.

`handoff_from` se scrie din valoarea de dinainte a lui `issues.assignee_id`, ca
firul să rămână citibil fără să reconstitui starea din toate evenimentele
anterioare.

**De verificat la implementare:** tipul lui `assignees.id`. `localRepository`
generează `crypto.randomUUID()`, deci `uuid` e presupunerea; tabela fiind
creată în dashboard, se citește din `information_schema` înainte de a fixa
tipul coloanelor `handoff_*`. Dacă e `text`, referințele se scriu `text`.

Cheia externă compusă `(issue_id, project_id)` refolosește constrângerea
`issues_id_project_key` creată deja de `migration-attachments.sql`; migrarea o
creează dacă lipsește, cu același bloc `do $$`.

### `issue_seen` — necititele

```sql
create table if not exists issue_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  issue_id text not null references issues(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, issue_id)
);
```

Un tichet e necitit dacă are în fir un eveniment mai nou decât `seen_at`, **și**
acel eveniment nu e al tău. Fără a doua condiție, propriul tău comentariu ți-ar
aprinde bulina.

Aici `on delete cascade` e corect în ambele direcții: o urmă de citire n-are
sens fără omul sau fără tichetul ei.

### `attachments` — o coloană, nu o tabelă nouă

```sql
alter table attachments add column if not exists event_id uuid references issue_events(id) on delete cascade;
create index if not exists attachments_event_idx on attachments (event_id);
```

Un atașament cu `event_id` null e al tichetului, exact ca azi. Unul cu `event_id`
atârnă de un comentariu. Asta reciclează întreg lanțul existent: bucketul,
politicile pe `storage.objects`, `buildAttachmentPath`, `signedUrls`,
`shrinkImage`, `Lightbox`, `afterDelete` din `gallery.ts`.

Ștergerea unui comentariu ar lăsa obiectele din bucket orfane: `on delete
cascade` curăță rândul din `attachments`, nu și fișierul din storage. Nu e
încă o cale reală — ștergerea comentariilor n-are buton — dar când capătă
unul, trebuie să treacă prin `removeObjects`, ca `deleteIssue`.

Calea din storage rămâne cea de azi (`projectId/issueId/attachmentId`) — nu se
introduce un al treilea nivel. Calea servește regăsirea și ștergerea în masă pe
tichet și pe proiect (`pathsForIssues`, `pathsForProject`); dacă ar purta și
comentariul, ambele ar trebui rescrise fără să câștige nimic.

### RLS

Aceeași formă ca la `attachments`, pe `project_id` direct, plus o condiție care
nu există în restul aplicației:

```sql
create policy events_insert on issue_events for insert to authenticated
with check (
  author_id = auth.uid()
  and (is_admin() or exists (select 1 from project_members m
        where m.project_id = issue_events.project_id and m.user_id = auth.uid() and m.role = 'write'))
);
```

`author_id = auth.uid()` pe insert: un fir în care poți semna cu numele altuia
nu e o conversație, e o cursă. Update-ul se limitează la `body` și `edited_at`,
și doar pe rândurile proprii de tip `comment`; o pasă nu se editează niciodată —
s-a întâmplat sau nu.

Ștergerea: doar rândurile proprii, doar `comment`. Firul rămâne append-only
pentru pase.

## `notes` → primul comentariu

`notes` dispare din formular. Migrarea îl mută:

```sql
insert into issue_events (issue_id, project_id, kind, author_id, body, created_at)
select i.id, i.project_id, 'comment', i.created_by, i.notes, coalesce(i.created_at, now())
from issues i
where coalesce(trim(i.notes), '') <> ''
  and not exists (select 1 from issue_events e where e.issue_id = i.id and e.body = i.notes);
```

Subinterogarea `not exists` ține migrarea idempotentă: rulată de două ori, nu
duplică nota.

**Coloana `notes` rămâne în bază.** Se scoate din `Issue`, din `NewIssue`, din
ambele repository-uri și din formular, dar `drop column` nu se execută în
migrarea asta. Ștergerea unui text scris de om e ireversibilă, iar plasa costă
o coloană nefolosită. Se aruncă într-o migrare ulterioară, după ce firul are
câteva săptămâni de folosire.

`author_id` iese `i.created_by`, care pentru tichetele vechi e `null` — deci
nota migrată apare ca un comentariu fără autor. Interfața randează asta ca
„Notă mutată" cu avatar gol, nu ca un comentariu al cuiva.

## Straturi de cod

### Date

`Repository` primește patru metode. Ca `listObstacleLinks`, firul se încarcă
per tichet, nu per proiect: un proiect vechi are mii de evenimente și nimeni nu
le vede pe toate.

```ts
listEvents(issueId: string): Promise<IssueEvent[]>
/** Scrie comentariul ȘI pasa, într-un singur apel. Întoarce rândurile create
 *  plus tichetul actualizat, ca apelantul să nu reciteasă. */
postToThread(input: NewThreadPost): Promise<{ events: IssueEvent[]; issue: Issue }>
markSeen(issueId: string): Promise<void>
/** Perechile (issue_id, ultimul eveniment) + seen_at, pentru buline și badge.
 *  O singură interogare transversală, ca `listDueIssues`. */
listInbox(): Promise<InboxRow[]>
```

`postToThread` e o funcție Postgres (`rpc`), nu trei apeluri din client. Trei
apeluri pot reuși pe jumătate: comentariul scris, tichetul rămas la tine — adică
exact modul de eșec pentru care am ales „un gest, nu două".

Pe `localRepository` (modul seeded, fără Supabase) firul funcționează complet,
iar atașamentele lipsesc, ca azi.

### Logică pură

`src/lib/thread.ts`, testabil ca `engine.ts` și `schedule.ts`, cu fixtures:

- `isUnread(events, seenAt, meId)` — regula de mai sus, inclusiv „nu al meu".
- `handoffSummary(events, issueId)` — cine ți l-a pasat și când, pentru rândul
  din cutia de pase.
- `groupInbox(rows, now)` — „Necitite" / „Mai devreme".

Nicio componentă nu recalculează necititul pe cont propriu, la fel ca `blockedBy`
la obstacole: store-ul memoizează, componentele citesc rezultatul.

### Interfață

**`src/components/Thread.tsx`** — firul plus caseta de scris. Trăiește în
formularul tichetului, sub descriere, în locul secțiunii NOTE.

- Comentariul: avatar, nume (serif), oră (mono), casetă pe `--surface` cu
  `--amb`. Al meu urcă pe `--surface-2`.
- Pasa: **fără casetă**. O linie „Ionuț → Alex" cu ora la capăt. E un eveniment,
  nu un mesaj; o casetă ar face-o să se citească drept replică goală.
- Caseta: `textarea` cu chenar (excepția din regula „fără linii"), un buton de
  agrafă care refolosește `AttachmentPicker`, un buton „către…" și „Trimite".
  Cu destinatar ales, butonul scrie „Trimite și pasează".
- `Enter` trimite, `Shift+Enter` face rând nou — ca `QuickAdd`.

**Ciorna nu se pierde la comutarea între tichete.** Formularul docat își
raportează deja starea murdară prin `setDockedDirty` (`src/ui.tsx`); un corp de
comentariu nescris intră în aceeași socoteală, altfel un click în listă ar
arunca în tăcere ce tocmai ai scris — exact plasa descrisă în CLAUDE.md.

**`src/components/IssueSheet.tsx`** — sub titlu, linia de proveniență: avatar,
„creat de Alex", punct median, data. Sub ea, jetonul de deținător: „→ Ionuț",
sau „nepasat — stă la Alex" când `assignee_id` e null.

**Filtrul de om în „Listă"** — o bară de jetoane deasupra rândurilor: „Toți",
„Nepasate", apoi câte un jeton per om **care chiar are ceva în proiect** (un
filtru cu zero e zgomot), fiecare cu numărul lui în mono. Activ = text plin plus
o linie de 2px, niciodată o casetă umplută.

Starea filtrului e locală vizualizării, nu se salvează în DB și nu intră în URL:
e o întrebare pusă acum („ce are Alex pe cap"), nu o preferință.

Bara conține deja căutarea și taburile de val, iar al treilea element a strivit
o dată câmpul de căutare la 0px pe telefon. Jetoanele merg într-un rând propriu,
cu scroll orizontal, și **`npm run test:layout` e obligatoriu** după.

**`src/components/InboxView.tsx`** — „Pe mine", al patrulea tab din bara de jos,
cu badge de necitite. Rânduri grupate „Necitite" / „Mai devreme", fiecare cu
titlul, ID-ul proiectului în mono, cine ți l-a pasat și când. Gol e starea
normală, iar textul gol o spune: *„Aici ajunge doar ce ți-a pasat cineva."*

Bara de jos are azi trei butoane (Azi, 7 zile, Proiecte). Al patrulea le
îngustează pe toate — de verificat la 360px lățime în `test:layout`.

**Bulina de necitit se stinge cu întârziere** (~900ms după deschidere), nu
instant: altfel dispare sub deget înainte să apuci să vezi de ce era acolo.

## Ce las afară, deliberat

- **Push la pasă.** Infrastructura există (VAPID, `send-reminders`, service
  worker), dar cere o funcție edge nouă și un trigger, deployate înaintea unui
  push pe master. Vine separat, după ce se vede dacă ecranul „Pe mine" e destul.
- **Inițialele deținătorului pe cardurile din „Ordine" și pe rândurile din
  „Listă".** Cerute și respinse explicit în brainstorming.
- **Filtru de om pe hărți.** Ar ascunde noduri dintr-un graf și ar face
  dependențele să arate rupte.
- **Grupare pe om în „Listă".** Se bate cu gruparea pe val/layer care există.
- **Editarea și ștergerea comentariilor din interfață.** Coloana `edited_at` și
  politicile există, butoanele nu — ca `obstacle_deps`, care trăiesc în model
  fără editor până când cineva le cere.
- **@-menționări, reacții, fire imbricate.** Nimic din ce cere doi oameni care
  își pasează un tichet.

## Testare

**`npm test` (vitest), fără browser:**

- `src/lib/thread.test.ts` — necititul (inclusiv „propriul comentariu nu
  aprinde bulina"), gruparea cutiei, rezumatul pasei. Fixtures, ca `engine.ts`.
- `src/data/localRepository.test.ts` — `postToThread` scrie două rânduri la un
  gest cu destinatar și unul fără; mută `assignee_id`; nu scrie pasă când
  destinatarul e cel care deja ține tichetul.
- `src/components/IssueForm.test.ts` — corpul de comentariu nescris marchează
  formularul ca murdar.

**`npm run test:layout` (Chromium):** bara de filtre a „Listei" la 360px —
câmpul de căutare nu scade sub lățimea lui minimă; bara de jos cu patru butoane.
Regresia asta a ajuns în producție o dată deja.

**`npm run test:nav` (Chromium):** o pasă trimisă din panoul lateral nu mută
foaia; „Pe mine" supraviețuiește unei reporniri, ca „Azi".

**`design/preview.html`:** ecrane noi pentru fir, casetă, bara de filtre și
cutia de pase, plus intrări în galeria „Controale" pentru jetonul de filtru și
butonul „către" — normal și activ, în ambele teme. Regenerat cu
`python3 design/build-preview.py`.

**Nu se atinge `npm run test:upgrade`:** nimic din planul ăsta nu intră în
`src/sw.ts`, `src/pwa.ts` sau blocul VitePWA.

## Pași de setup

```bash
npm run migrate supabase/migration-comments.sql
```

Atât. Fără funcții edge, fără secrete, fără cron — de aceea am lăsat push-ul
afară.

## Decizii luate fără confirmare explicită

1. **`issue_events` în loc de `comments`,** cu pasele în aceeași tabelă.
   Alternativa (două tabele) mută un merge cronologic în fiecare apelant.
2. **Calea din storage rămâne pe tichet,** fără nivel de comentariu.
3. **Coloana `notes` nu se aruncă acum,** deși dispare din cod.
4. **`postToThread` e o funcție Postgres,** nu trei apeluri din client.
5. **Filtrul de om nu intră în URL.** Un deep link către „ce are Alex pe cap"
   n-a fost cerut, iar starea din bară s-ar bate cu restaurarea listei memorate
   din `LAST_VIEW_KEY`.
6. **Pasa nu se poate edita sau șterge.** Firul e append-only pentru evenimente;
   un istoric de predări care se poate rescrie nu răspunde la nicio întrebare.
