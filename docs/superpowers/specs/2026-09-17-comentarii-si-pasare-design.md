# Comentarii, creator și pasarea tichetelor — design

**Data:** 17 septembrie 2026. **Prototip interactiv:** `prototype-comments.html`
(stare în memorie, cu un panou de regie care comută între conturi, ca să se
poată juca ambele capete ale pasei).

Partea de model de date și de SQL e scrisă **după** o inspecție a bazei de
producție și o revizuire adversarială: fiecare afirmație despre schema
existentă e verificată, nu presupusă.

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

Ciclul cerut e simplu și, azi, imposibil: *Alex face un tichet → îl văd că e de
la Alex → întreb ceva în scris → i-l dau înapoi lui Alex → Alex răspunde și mi-l
dă înapoi.*

## Regula centrală

**`assignee_id` gol înseamnă „al meu, prin creație". `assignee_id` pus înseamnă
„ți-l pasez ție".**

Atribuirea nu mai e o etichetă descriptivă, ci un act de predare. Consecința e
ce face întreaga funcționalitate suportabilă pentru cineva care își ține toate
gândurile în aplicație: **un ecran „Pe mine" e scurt prin definiție, nu prin
filtrare deșteaptă.** Cele câteva sute de tichete pe care ți le faci singur au
`assignee_id` null și nu pot ajunge niciodată acolo. (În producție, azi, exact
**5** din 486 de tichete au assignee — regula nu schimbă nimic din ce există,
doar dă sens la ce urmează.)

Din ea decurge direct ștergerea lui `defaultAssigneeId` din `IssueForm.tsx`
(azi pune automat assignee = tu la tichetele noi din proiectele personale).
Fără ștergere, cutia de pase s-ar umple exact cu ce trebuie să lipsească din ea,
iar prima impresie a funcționalității ar fi „încă o listă cu tot".

## Identitate: un singur om, nu doi

Azi există două sisteme paralele care nu se ating:

| | `auth.users` | `assignees` |
|---|---|---|
| ce e | contul real: email, membru de proiect, admin | un rând cu `id uuid` + `name text`, atât |
| cine ești | sesiunea Supabase | `myAssigneeId` din `localStorage`, ales manual |

Creatorul unui tichet și autorul unui comentariu **trebuie** să fie contul: sunt
fapte, nu preferințe, iar un „eu sunt X" din `localStorage` se poate minți.
Assignee-ul însă trebuie să rămână atribuibil și unui nume fără cont — „echipa
de API", „juridic" — exact ca `owner`-ul obstacolelor.

Soluția: `assignees` primește `user_id uuid null`. Un rând cu `user_id` e o
persoană cu cutie poștală; unul fără e un nume liber.

**Legarea nu se poate face automat.** `assignees` n-are coloană de email, iar
cele trei rânduri din producție sunt nume scrise de mână („Alexandru", „ionu",
„ionut" — ultimele două arată a duplicat de tastare). Deci:

- legătura inițială se face **o singură dată, printr-un script**
  (`scripts/link-assignees.mjs`), care listează conturile și rândurile și cere
  perechile;
- la login, sesiunea își caută rândul **doar** prin `user_id`. Dacă nu găsește
  niciunul, **nu inventează**: `myAssigneeId` rămâne null, iar „Pe mine" spune
  onest că nu ești legat de niciun nume.

O potrivire ghicită după nume ar lega tăcut contul greșit de munca altcuiva, iar
greșeala s-ar vedea abia în firul unui tichet.

`myAssigneeId` nu mai e stare de utilizator, ci valoare derivată din sesiune.
`setMyAssigneeId` și cheia lui din `localStorage` dispar. Sunt cinci puncte de
atins, nu unul: `store.tsx`, `IssueForm.tsx` (de trei ori, inclusiv
`AssigneeSearch`) și `IssueSheet.tsx`.

## Ce NU se schimbă

Merită spus explicit, fiindcă e mult cod care s-ar putea crede atins:

- **`computeLayers` din `src/lib/engine.ts`.** Nici o pasă, nici un comentariu
  nu mișcă un layer. Axa val/layer rămâne ortogonală pe axa „cine ține
  tichetul", exact ca la obstacole.
- **`blockedBy` din `src/lib/obstacles.ts`** și tot planul obstacolelor.
- **Scadențele și listele inteligente Azi / Mâine / 7 zile.** Cutia de pase e un
  ecran în plus, nu o rescriere a lor; nu atinge `schedule.ts`.
- **Politicile de storage și calea din bucket.** Ele decid pe
  `(storage.foldername(name))[1] = project_id`, iar calea rămâne
  `projectId/issueId/attachmentId`. Zero impact.
- **`functions/api/`.** `notes` e câmp în API-ul public lovit de
  `ticket-kit/ai-client.mjs` (repo git separat). Scoaterea lui de acolo ar fi o
  schimbare de contract, nu de interfață, și nu e cerută aici.

## Model de date

Fișier nou, idempotent: `supabase/migration-comments.sql`, rulat cu
`npm run migrate`.

**Două constrângeri ale mediului, amândouă cu consecințe:**

1. `scripts/apply-migration.mjs` trimite tot fișierul ca un singur query, deci
   **o singură tranzacție**. Nimic `create index concurrently`. În schimb,
   backfill-ul rulează ca owner, cu RLS ocolit — fără asta, politica
   `author_id = auth.uid()` l-ar refuza.
2. `assignees` **și** `issues.assignee_id` au fost create în dashboard și nu
   apar în nicio migrare. Migrarea trebuie să le poată crea pe amândouă.

### Tipurile, deduse — nu ghicite

Inspecția bazei spune `assignees.id uuid default gen_random_uuid()` și
`issues.assignee_id uuid`. Migrarea **nu se bazează** pe asta: citește tipul din
`pg_attribute` cu `format_type` și îl folosește în `execute format(...)` pentru
coloanele `handoff_from` / `handoff_to`. Funcția `post_to_thread` vorbește `text`
la margini și lasă cast-ul de atribuire al Postgres să facă restul, deci merge
neschimbată și dacă tipul ar fi `text`.

Costă zece rânduri și scoate din spec singura presupunere care ar fi putut da o
migrare care nu pornește.

### `assignees` — legătura cu contul, și strângerea RLS

```sql
alter table public.assignees add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists assignees_user_idx on public.assignees(user_id) where user_id is not null;
```

Indexul e parțial fiindcă `null` nu e o identitate: pot exista oricâte nume
libere fără cont, dar un cont se leagă de cel mult un rând.

**Politica de azi e `using (true) with check (true)`** — singura tabelă din
aplicație fără reguli de membru. Cât timp rândurile erau doar niște nume, n-a
contat. Din momentul în care poartă `user_id`, contează foarte tare: oricine
autentificat ar putea revendica rândul tău. Se înlocuiește:

```sql
create policy assignees_select on public.assignees for select to authenticated using (true);
create policy assignees_write on public.assignees for all to authenticated
using      (public.is_admin() or user_id is null or user_id = (select auth.uid()))
with check (public.is_admin() or user_id is null or user_id = (select auth.uid()));
```

Numele rămân vizibile tuturor — nu sunt secrete, iar selectorul de destinatar le
cere. Ce nu se mai poate e să pui `user_id`-ul altuia.

`enable row level security` fără politici **golește aplicația**, deci ambele se
creează în același bloc cu `drop policy if exists`, ca peste tot.

### `issues` — proveniența

```sql
alter table public.issues add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.issues add column if not exists created_at timestamptz not null default now();
```

`on delete set null` și nu `cascade`: ștergerea unui cont nu poate șterge munca.
Un tichet al cărui creator a plecat arată doar data — informația care rămâne
adevărată.

`created_at` nu există azi. Cele 486 de rânduri existente primesc toate `now()`,
adică ora migrării. E o minciună blândă și vizibilă; nu există sursă mai bună,
iar `null` ar cere o ramură în fiecare loc care afișează data.

`issues_id_project_key` **există deja** (a creat-o `migration-attachments.sql`).
Blocul care o creează rămâne, ca fișierul să meargă și pe o bază curată.

### `issue_events` — firul

```sql
create table if not exists public.issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id   text not null,
  project_id text not null,
  kind       text not null check (kind in ('comment','handoff')),
  author_id  uuid references auth.users(id) on delete set null,
  body       text not null default '',
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
-- handoff_from / handoff_to se adaugă separat, cu tipul dedus din assignees.id.
```

Plus o constrângere de formă, care ține promisiunea „un gest, două rânduri" în
bază, nu doar în proză:

```sql
check ((kind = 'comment' and handoff_from is null and handoff_to is null)
    or (kind = 'handoff' and body = ''))
```

**De ce `issue_events` și nu `comments`.** Firul arată două feluri de lucruri:
ce s-a zis și cine ține tichetul. Răspund la întrebări diferite, se randează
diferit (comentariul are casetă, pasa e o notă de margine) și au autoritate
diferită — o pasă e un fapt al sistemului, un comentariu e o afirmație a unui
om. Două tabele ar muta un merge cronologic în fiecare apelant. O tabelă cu
`kind` ține firul o singură citire ordonată.

**Un gest, două rânduri.** „Trimite și pasează" scrie un rând `comment` și un
rând `handoff`. Nu se contopesc într-un singur rând cu `handoff_to` opțional:
atunci o pasă fără comentariu ar fi un rând cu `body` gol — o replică goală în
fir — iar interfața ar trebui oricum să le despartă la randare.

`handoff_from` se scrie din valoarea de dinainte a lui `issues.assignee_id`, ca
firul să fie citibil fără să reconstitui starea din toate evenimentele
anterioare.

**Index:** unul singur, `(issue_id, created_at)`. Btree se scanează și invers,
deci acoperă și „ultimul eveniment". Un al doilea index pe
`(issue_id, author_id, created_at)` pentru „ultimul care nu e al meu" s-ar plăti
la fiecare comentariu scris, ca să economisească o filtrare peste zeci de
rânduri.

Pe `issues` se adaugă `(assignee_id) where assignee_id is not null` — parțial
din exact motivul regulii centrale: majoritatea tichetelor au null și nu pot
ajunge niciodată în cutia de pase.

### `issue_seen` — necititele

```sql
create table if not exists public.issue_seen (
  user_id  uuid not null references auth.users(id) on delete cascade,
  issue_id text not null references public.issues(id) on delete cascade,
  seen_at  timestamptz not null default now(),
  primary key (user_id, issue_id)
);
```

Un tichet e necitit dacă are în fir un eveniment mai nou decât `seen_at`, **și**
acel eveniment nu e al tău. Fără a doua condiție, propriul tău comentariu ți-ar
aprinde bulina.

`on delete cascade` în ambele direcții: o urmă de citire n-are sens fără omul
sau fără tichetul ei. PK-ul `(user_id, issue_id)` acoperă joinul; niciun index
în plus.

### `attachments` — o coloană, nu o tabelă nouă

```sql
alter table public.attachments add column if not exists event_id uuid references public.issue_events(id) on delete set null;
create index if not exists attachments_event_idx on public.attachments (event_id) where event_id is not null;
```

Un atașament cu `event_id` null e al tichetului, ca azi. Unul cu `event_id`
atârnă de un comentariu. Se reciclează bucketul, politicile pe `storage.objects`,
`buildAttachmentPath`, `signedUrls`, `shrinkImage`, `Lightbox` și `afterDelete`.

**`on delete set null`, nu `cascade`** — și asta **dizolvă** problema
atașamentelor orfane în loc s-o administreze. Cu `cascade`, ștergerea unui
comentariu ar șterge rândul din `attachments` și ar lăsa octeții în bucket, ceea
ce ar cere un `pathsForEvent` nou plus o secvență de curățare. Cu `set null`,
fișierul se întoarce pur și simplu la tichet, rămâne vizibil în bara lui, iar
ștergerea tichetului sau a proiectului îl curăță prin `pathsForIssues` /
`pathsForProject`, care filtrează pe `issue_id` — coloană pe care atașamentele
de comentariu o păstrează oricum.

Nici nu s-ar putea rezolva în bază: un trigger care șterge din `storage.objects`
lasă octeții în backing store. Curățarea trăiește în aplicație, ca azi.

Calea din storage rămâne `projectId/issueId/attachmentId`. Ea servește regăsirea
și ștergerea în masă pe tichet și pe proiect; dacă ar purta și comentariul,
ambele ar trebui rescrise fără să câștige nimic.

### `post_to_thread` — o funcție, nu trei apeluri

```sql
post_to_thread(
  p_issue_id text, p_project_id text,
  p_body text default '', p_handoff boolean default false,
  p_to text default null, p_attachment_ids uuid[] default '{}'
) returns jsonb
```

Cinci decizii, fiecare cu motivul ei:

**`security invoker`, nu definer.** Cu invoker, `author_id = auth.uid()` din
politica de insert și rolul `write` din `issues_write` se aplică gratis. Cu
definer ar trebui reimplementate toate verificările, iar un singur bug ar deveni
bypass total. `set search_path = ''` și calificare `public.`, ca `is_admin()`.

**`p_handoff boolean` separat de `p_to`.** Un `assigneeId?: string | null` nu
poate exprima trei stări prin PostgREST: „nu pasez" și „pasez către nimeni" ajung
amândouă `null`. Or „către nimeni" e exact cum iei un tichet înapoi.

**`p_attachment_ids`.** `AttachmentPicker` urcă fișierul **înainte** de
„Trimite", deci atașamentul există înaintea evenimentului de care ar trebui să
atârne. Funcția primește id-urile, verifică să fie ale tichetului și nelegate, și
le leagă după ce scrie comentariul. Fără parametrul ăsta, regula „scrie
comentariul doar dacă are corp SAU atașamente" nu e verificabilă.

**`select ... for update`, dar numai pe ramura de pasă.** Nu pentru lost update
— last-write-wins pe `assignee_id` ar fi acceptabil — ci fiindcă două pase
simultane ar citi același `assignee_id` și ar scrie **două rânduri cu același
`handoff_from`**: firul ar arăta „Ionuț→Alex" și „Ionuț→Maria" când de fapt a
fost Ionuț→Alex→Maria. Istoric fals, nu doar stare pierdută. Un comentariu
simplu nu ia lock.

**`get diagnostics` după update.** Un UPDATE filtrat de RLS nu dă eroare, dă
zero rânduri. Fără verificare, un membru cu rol `read` ar primi „pasă trimisă"
fără nicio pasă.

Funcția marchează și tichetul ca văzut: cine scrie în fir l-a și citit. Întoarce
`{ events, issue }` ca `jsonb`; **rândul întors n-are `deps`**, deci clientul le
păstrează din tichetul vechi.

### RLS

Aceeași formă ca la `attachments`, pe `project_id` direct — de aceea ambele
tabele noi poartă `project_id` denormalizat; fără el, politica ar cere un join
în `issues` la fiecare rând. `(select auth.uid())` în loc de `auth.uid()`, ca să
fie InitPlan evaluat o dată, nu per rând.

- **select:** admin sau membru al proiectului.
- **insert:** `author_id = (select auth.uid())` **și** rol `write`. `is_admin()`
  nu apare aici: nici adminul nu semnează cu numele altuia.
- **update:** doar `kind = 'comment'` și rândurile proprii, în **ambele** clauze
  — `using` alege rândul, `with check` împiedică mutarea lui în afara zonei
  proprii.
- **delete:** doar `kind = 'comment'`, rândurile proprii **sau** admin. Adminul
  e acolo pentru un motiv precis: notele migrate au `author_id = null`, deci
  fără el n-ar mai putea fi șterse niciodată de nimeni.
- `issue_seen`: strict `user_id = (select auth.uid())`, în ambele sensuri.

**Restrângerea updateului la o singură coloană nu se poate face din RLS** — RLS
alege rânduri, nu coloane. Se face cu două mecanisme, deliberat amândouă:

1. `revoke update on issue_events from authenticated;` +
   `grant update (body) on issue_events to authenticated;` — singurul care se
   aplică *înaintea* RLS.
2. Un trigger `before update` care refuză orice modificare în afara lui `body`,
   refuză orice editare pe `kind = 'handoff'`, și pune singur `edited_at`.
   Există fiindcă punctul 1 se pierde tăcut la primul
   `grant all on all tables in schema public to authenticated` — o linie care
   apare în jumătate din exemplele Supabase.

Triggerul are o scurtătură obligatorie: `if current_user <> 'authenticated' then
return new; end if;`. Fără ea, `on delete set null` de pe `author_id` și
`handoff_*` — care emite UPDATE-uri pe tabelă, ca owner — ar face **ștergerea
unui cont sau a unui assignee imposibilă**.

Din același motiv, **nu există trigger care să interzică ștergerea paselor**,
deși regula e „pasele nu se șterg niciodată": `on delete cascade` de la `issues`
declanșează triggerele de rând, iar un `raise` acolo ar face ștergerea unui
tichet sau a unui proiect imposibilă. Regula o ține RLS; `service_role` poate
șterge, exact ca peste tot în aplicație.

### `inbox_rows` — o vedere, nu o interogare

Cutia de pase cere „pentru fiecare tichet al meu, ultimul eveniment și ultimul
eveniment care nu e al meu". Asta e un `lateral`, iar **PostgREST nu-l poate
exprima** — `listDueIssues` e un select plat, ăsta nu e. Deci o vedere, din care
clientul filtrează și sortează ca înainte:

```sql
create view public.inbox_rows with (security_invoker = on) as …
```

`with (security_invoker = on)` **nu e opțional**: fără el vederea rulează ca
proprietarul ei și publică inboxul fiecărui proiect către oricine.

Necitit = `last_foreign_at > coalesce(seen_at, '-infinity')`, calculat din două
coloane, fără să treacă firul întreg prin rețea.

Semnalul că ceva e stricat, la `explain`: orice `Seq Scan on issue_events` sau un
`HashAggregate` peste toate evenimentele înseamnă că planificatorul a ales
`group by` în loc de lateral — de obicei fiindcă lipsește `issues_assignee_idx`.

### `notify pgrst, 'reload schema'`

Ultima linie din migrare. Fără ea, primul `supabase.rpc('post_to_thread')` dă
`PGRST202` până la următorul reload al schemei.

## `notes` → primul comentariu

`notes` dispare din formular. Migrarea îl mută, cu un **id determinist**:

```sql
insert into public.issue_events (id, issue_id, project_id, kind, author_id, body, created_at)
select md5('notes:' || i.id)::uuid, i.id, i.project_id, 'comment', null, i.notes, i.created_at
  from public.issues i
 where coalesce(btrim(i.notes), '') <> ''
on conflict (id) do nothing;
```

`md5('notes:' || id)::uuid` e cheia de idempotență, nu `where not exists (…
e.body = i.notes)` cum scria varianta dintâi a specului: aceea re-inserează nota
în clar dacă cineva editează comentariul migrat.

`author_id` e **`null` explicit**, nu `i.created_by`: coloana tocmai a fost
adăugată, e null pe toate rândurile. Interfața randează asta ca „Notă mutată", cu
avatar gol — nu ca un comentariu al cuiva.

În producție sunt **266 din 486** de tichete cu `notes` netrivial, deci migrarea
creează 266 de comentarii. Nu o mână.

**Coloana `notes` rămâne în bază.** Se scoate din `Issue`, din `NewIssue`, din
ambele repository-uri și din formular, dar `drop column` nu se execută aici —
nici acum, nici „ca să fie curat". Ștergerea unui text scris de om e
ireversibilă, plasa costă o coloană nefolosită, iar `functions/api/` o expune
oricum.

## Straturi de cod

### Date

`Repository` primește patru metode (`src/data/repository.ts`, lângă
`listAssignees`):

```ts
listEvents(issueId: string): Promise<IssueEvent[]>
postToThread(input: NewThreadPost): Promise<{ events: IssueEvent[]; issue: Issue }>
markSeen(issueId: string): Promise<void>
listInbox(): Promise<InboxRow[]>
```

Pe `localRepository` (modul seeded) firul funcționează complet, iar atașamentele
lipsesc, ca azi.

### Logică pură

`src/lib/thread.ts`, testabil ca `engine.ts` și `schedule.ts`, cu fixtures:

- `isUnread(lastForeignAt, seenAt)` — regula de mai sus.
- `groupInbox(rows, now)` — „Necitite" / „Mai devreme".

Nicio componentă nu recalculează necititul pe cont propriu, la fel ca `blockedBy`
la obstacole: store-ul memoizează, componentele citesc rezultatul.

### Store

- **`listInbox` e tovarășul lui `listDueIssues`** — transversal pe proiecte.
  Stare proprie plus un `loadInbox` modelat după `loadDue`, chemat din boot și
  din `refresh()`. **Nu** în `Promise.all`-urile per-proiect: acolo ar fi refăcut
  la fiecare comutare de proiect și ar lipsi exact când nu e niciun proiect
  deschis — adică fix pe ecranul „Pe mine".
- **`listEvents` NU intră în store.** E per-tichet; modelul e `Attachments.tsx`,
  cu stare locală încărcată la montare.
- **`refresh()` reîncarcă inboxul** (bulina de necitite e chiar lucrul care se
  schimbă cât ești pe alt dispozitiv), dar **nu ridică `loading`**. Contractul e
  scris în `store.tsx`: demontarea lui `<main>` scoate `SplitView`,
  `dockedIssueId` cade la null și tichetul docat clipește ca modal.

### Interfață

**`src/components/Thread.tsx`** — firul plus caseta de scris, montat exact în
locul secțiunii NOTE, ca ultim copil al coloanei drepte din formular.

- Comentariul: avatar, nume (serif), oră (mono), casetă pe `--surface` cu
  `--amb`. Al meu urcă pe `--surface-2`.
- Pasa: **fără casetă**. O linie „Ionuț → Alex" cu ora la capăt. E un eveniment,
  nu un mesaj; o casetă ar face-o să se citească drept replică goală.
- Caseta: `textarea` cu chenar (excepția din regula „fără linii"), agrafă care
  refolosește `AttachmentPicker`, buton „către…" și „Trimite". Cu destinatar
  ales, butonul scrie „Trimite și pasează".
- `Enter` trimite, `Shift+Enter` face rând nou — ca `QuickAdd`. Nu trebuie gardă
  de tastatură: `shouldIgnoreKey` iese deja pe `TEXTAREA`.
- **Firul lipsește pe un tichet nesalvat.** `existing` e `undefined` până la
  primul save, iar salvarea remontează formularul prin `openEditIssue`; firul
  apare abia atunci.
- **Fără `overflow` propriu.** În modal, coloana dreaptă se derulează deja; în
  panoul docat, se derulează corpul întreg. Un al treilea scroller ar face firul
  inaccesibil în modal.
- Mecanica `notesMaxH` **nu se portează**: `closest('.sheet')` e null în panoul
  lateral, deci e deja moartă acolo. Pleacă odată cu secțiunea NOTE.

**Ciorna nu se pierde la comutarea între tichete.** Corpul de comentariu nescris
intră în expresia `isDirty` existentă, pe ramura de editare — ramura de creare
nu se atinge, acolo nu există fir. `setCloseGuard` și `setDockedDirty` sunt deja
legate de `isDirty`, deci nu trebuie nicio linie nouă în `ui.tsx`.

Două capcane: trimiterea unui comentariu **trebuie să golească draftul**, altfel
formularul rămâne murdar pe veci și fiecare click în listă e refuzat cu clipire;
și un draft aprinde săgeata de salvare, care salvează **tichetul**, nu
comentariul — dacă asta deranjează, draftul intră doar în `setDockedDirty`, nu
și în clasa butonului.

**`src/components/IssueSheet.tsx`** — sub titlu, linia de proveniență: avatar,
„creat de Alex", punct median, data. Sub ea, jetonul de deținător: „→ Ionuț",
sau „nepasat — stă la Alex" când `assignee_id` e null.

**Filtrul de om în „Listă"** — un rând de jetoane: „Toți", „Nepasate", apoi câte
unul per om **care chiar are ceva în proiect** (un filtru cu zero e zgomot),
fiecare cu numărul lui în mono. Activ = text plin plus o linie de 2px, niciodată
o casetă umplută.

Starea filtrului e locală vizualizării, nu se salvează în DB și nu intră în URL:
e o întrebare pusă acum („ce are Alex pe cap"), nu o preferință.

Bara de sus a Listei (`.wave-sel`) conține azi taburile de val și acțiunile lor —
**nu** căutarea; regresia de 0px din CLAUDE.md a fost în `.deps-bar` din
formular, nu aici. Riscul e însă din aceeași familie: `.wave-tabs` are `flex: 1`,
`.wave-actions` are `flex-shrink: 0`, deci un al treilea copil fură din taburile
de val. De aceea rândul de jetoane e **frate** al lui `.wave-sel`, nu copil, cu
`flex-wrap: nowrap`, `overflow-x: auto` și `flex-shrink: 0` pe jetoane — nu
`flex-wrap`, fiindcă numărul de oameni nu e mărginit ca numărul de valuri.

**`src/components/InboxView.tsx`** — „Pe mine", al patrulea tab, cu badge de
necitite. Rânduri grupate „Necitite" / „Mai devreme", fiecare cu titlul, ID-ul în
mono, cine ți l-a pasat și când. Gol e starea normală, iar textul gol o spune:
*„Aici ajunge doar ce ți-a pasat cineva."*

**„Pe mine" NU e un `SmartListKind`.** Un al patrulea `kind` ar trece de
typecheck și ar strica trei lucruri: ecranul ar aștepta `dueLoaded`, deci o
încărcare de scadențe care nu-l privește; ar cere un `defaultDueAt` pentru
`QuickAdd`, pe un ecran care n-are zi; și ar primi FAB-ul de adăugare rapidă,
unde crearea unei sarcini n-are sens.

Forma corectă: un tip de ecran la stratul de rutare — `Screen = SmartListKind |
'inbox'` — din care `smartList` se derivă. `Header`, `Sidebar` și `SmartListView`
rămân neatinse ca semnătură, iar `InboxView` intră ca ramură nouă în lanțul de
randare din `App.tsx`. Tichetele se deschid prin `openTaskAnywhere`, singurul
drum care încarcă proiectul unui tichet străin.

Patru locuri sunt obligatorii, altfel se reproduc bug-uri deja documentate în
CLAUDE.md: `parseLastView` (fără el „Pe mine" nu supraviețuiește unei reporniri,
iar `pwa.ts` reîncarcă pagina la revenirea în tab), `settleUrl` (fără el,
ștergerea din „Pe mine" lasă `/project/<slug>` în bară și repornirea te mută pe
board), efectul de boot, și `exitSmartList`.

Bara de jos are azi trei butoane. Al patrulea le îngustează pe toate — de
verificat la 320px, unde „Proiecte" e cea mai lungă etichetă.

**Bulina de necitit se stinge cu întârziere** (~900ms după deschidere), nu
instant: altfel dispare sub deget înainte să apuci să vezi de ce era acolo.

## Ce las afară, deliberat

- **Push la pasă.** Infrastructura există, dar cere o funcție edge nouă și un
  trigger, deployate înaintea unui push pe master. Vine separat, după ce se vede
  dacă ecranul „Pe mine" e destul.
- **Inițialele deținătorului pe cardurile din „Ordine" și pe rândurile din
  „Listă".** Cerute și respinse explicit în brainstorming.
- **Filtru de om pe hărți.** Ar ascunde noduri dintr-un graf și ar face
  dependențele să arate rupte.
- **Grupare pe om în „Listă".** Se bate cu gruparea pe val/layer care există.
- **Editarea și ștergerea comentariilor din interfață.** `edited_at`, triggerul
  și politicile există; butoanele nu — ca `obstacle_deps`, care trăiesc în model
  fără editor până când cineva le cere. Când vor apărea, ștergerea are nevoie și
  de un `pathsForEvent(eventId)` înaintea `removeObjects`.
- **@-menționări, reacții, fire imbricate.** Nimic din ce cere doi oameni care
  își pasează un tichet.

## Testare

**`npm test` (vitest), fără browser:**

- `src/lib/thread.test.ts` — necititul (inclusiv „propriul comentariu nu aprinde
  bulina"), gruparea cutiei, rezumatul pasei. Fixtures, ca `engine.ts`.
- `src/data/localRepository.test.ts` — `postToThread` scrie două rânduri la un
  gest cu destinatar și unul fără; mută `assignee_id`; nu scrie pasă când
  destinatarul e cel care deja ține tichetul; leagă atașamentele date.
- `src/components/IssueForm.test.ts` — corpul de comentariu nescris marchează
  formularul ca murdar, iar trimiterea îl curăță.

**`npm run test:layout` (Chromium):** bloc nou în `scripts/test-layout.mjs`
pentru rândul de jetoane lângă `.wave-sel` la lățimile de telefon — testul de azi
nu se uită deloc la bara aia — plus bara de jos cu patru butoane la 320px.

**`npm run test:nav` (Chromium):** o pasă trimisă din panoul lateral nu mută
foaia; „Pe mine" supraviețuiește unei reporniri, ca „Azi".

**`design/preview.html`:** ecrane noi pentru fir, casetă, bara de filtre și cutia
de pase, plus intrări în galeria „Controale" pentru jetonul de filtru și butonul
„către" — normal și activ, în ambele teme. Regenerat cu
`python3 design/build-preview.py`.

**Nu se atinge `npm run test:upgrade`:** nimic din planul ăsta nu intră în
`src/sw.ts`, `src/pwa.ts` sau blocul VitePWA.

## Pași de setup

```bash
npm run migrate supabase/migration-comments.sql
node scripts/link-assignees.mjs          # o singură dată: leagă conturile de nume
```

Fără funcții edge, fără secrete, fără cron — de aceea am lăsat push-ul afară.

## Decizii luate fără confirmare explicită

1. **`issue_events` în loc de `comments`,** cu pasele în aceeași tabelă.
2. **Calea din storage rămâne pe tichet,** fără nivel de comentariu.
3. **`attachments.event_id` e `on delete set null`,** deci ștergerea unui
   comentariu întoarce fișierul la tichet în loc să-l orfelinizeze.
4. **Coloana `notes` nu se aruncă acum,** deși dispare din cod.
5. **`post_to_thread` e o funcție Postgres,** `security invoker`, cu lock doar pe
   ramura de pasă.
6. **Filtrul de om nu intră în URL.**
7. **Pasa nu se poate edita.** Ștergerea ei o oprește RLS, nu un trigger — un
   trigger ar rupe `on delete cascade` de la `issues`.
8. **Legarea cont ↔ assignee se face printr-un script, o singură dată**, nu
   ghicind după nume.
