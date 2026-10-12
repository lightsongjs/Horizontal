# Mutarea unui tichet în alt proiect — design

Data: 2026-10-12

## De ce

Omul capturează des în Inbox („Daily") o sarcină care de fapt e a altui
proiect. Azi nu există drum înapoi: proiectul unui tichet existent e afișat,
nu ales (`EditSheet.tsx`, `IssueForm.tsx`). Singura soluție e ștergere +
recreare, care pierde comentariile, pozele și scadența.

## Ce a decis omul

- **Tichetul primește număr nou** în proiectul țintă (`HZ-12` → `APO-7`).
  Linkul vechi nu mai găsește tichetul — acceptat, fără tabel de aliasuri.
- **Refuz la orice dependență**: dacă tichetul depinde de ceva SAU ceva
  depinde de el, mutarea e refuzată cu eroare, cu lista ID-urilor.
- **Drept**: scriere în AMBELE proiecte (`project_members.role = 'write'`
  pe sursă și pe țintă), sau admin (`is_admin()`).

## Regulile mutării

1. **Refuz** dacă:
   - există un rând în `dependencies` cu `issue_id = id` sau `depends_on_id = id`;
   - există un rând în `obstacle_issues` cu `issue_id = id` (obstacolele sunt
     ale proiectului și nu pot urma tichetul — aceeași familie ca dependențele);
   - lipsește dreptul de scriere pe sursă sau pe țintă;
   - ținta e chiar proiectul sursă;
   - ID-ul e provizoriu (`HZ-~…`): numărul real încă n-a venit.
2. **Numărul nou**: același algoritm ca `nextIssueId` (cel mai mare număr din
   proiectul țintă + 1, minim două cifre, prefixul țintei), calculat în SQL
   sub `for update` pe rândul proiectului țintă. O coliziune cu o creare din
   client care nu ia lacătul dă 23505; funcția reîncearcă de până la 3 ori,
   ca `createIssue`.
3. **Ce se schimbă pe tichet**:
   - `id` nou, `project_id` = ținta;
   - `wave` = `projects.current_wave` al țintei (valul activ);
   - `theme` = `null` (temele sunt per proiect, iar cheile nu se potrivesc);
   - `assignee_id` rămâne dacă persoana e legată de un cont membru în țintă
     (sau de un admin); altfel devine `null` — tichetul revine la creator, nu
     rămâne pasat cuiva care nu-l mai poate vedea.
   - Tot restul (titlu, descriere, scadență, memento, `rrule`, urgent, `done`,
     `created_by`, `reminder_sent_at`) se copiază neschimbat.
4. **Ce se mută cu el** (aceeași tranzacție): `issue_events` (firul),
   `attachments` (rândurile), `issue_seen`.

## Arhitectura

### Server: o singură funcție Postgres

`supabase/migration-move-issue.sql`:

```
move_issue(p_id text, p_target text) returns text   -- ID-ul nou
security definer, set search_path = ''
```

O tranzacție, ca `post_to_thread`: o rețea căzută la mijloc n-are cum să lase
firul pe un ID și tichetul pe altul.

Pași: `for update` pe tichet → verificările de mai sus (fiecare refuz e un
`raise exception` cu `errcode` propriu și mesaj românesc) → numărul nou →
`insert` al copiei prin `jsonb_populate_record(null::public.issues,
to_jsonb(old) || patch)` (preia automat orice coloană adăugată în viitor) →
`update` copiii pe noul `(id, project_id)` → `delete` vechiul rând.

Cheile străine n-au `ON UPDATE CASCADE`, iar `issue_events`/`attachments`
au FK compus pe `(issue_id, project_id)`. De-aia insert-nou → mută-copii →
șterge-vechi, nu un `update issues set id`.

Triggerele `before update` (recurență, `reminder_sent`) nu se ating: e un
insert, iar valorile se copiază ca atare.

Mesajele de refuz:
- `Nu se poate muta HZ-12: are dependențe (HZ-3, HZ-9). Scoate-le întâi.`
- `Nu se poate muta HZ-12: e legat de un obstacol. Scoate-l întâi.`
- `Nu ai drept de editare în proiectul „X".`

### Storage: pozele NU se mută fizic

Calea din bucket rămâne `vechiulProiect/HZ-12/<uuid>` (obiectele sunt imuabile,
nu există politică de update). Doar rândul din `attachments` primește noul
`project_id`/`issue_id`. Politicile de pe `storage.objects` (select, delete)
primesc un al doilea drum de acces: membru în proiectul rândului din
`attachments` cu acel `path` (`path` e UNIQUE, deci căutarea e indexată).
Fără asta, un membru al proiectului nou care nu e în cel vechi n-ar vedea
poza. Primul segment din cale devine o etichetă istorică, nu o regulă.

### Client

- `Repository.moveIssue(id, targetProjectId): Promise<Issue>` — în
  `supabaseRepository` (RPC), în `localRepository` (aceleași reguli în TS,
  pentru modul local) și în învelișul offline prin `net()`: offline →
  `Necesită rețea — ești offline.`
- Învelișul offline refuză și dacă coada are scrieri pe tichetul acela
  („Se sincronizează încă — încearcă peste câteva secunde"): o editare
  netrimisă ar ajunge altfel pe un ID care nu mai există.
- După răspuns: același drum ca redenumirea unui tichet provizoriu —
  `recordRemap` (o salvare întârziată pe ID-ul vechi e tradusă),
  `renameIssueInSheets` (foaia rămâne deschisă pe ID-ul nou, fără remontare),
  URL-ul se rescrie pe `/APO-7`. Store-ul scoate tichetul din proiectul sursă
  și din `dueIssues`/`openIssues`, apoi un `refresh()`.
- Regula de refuz e și în client (`src/lib/moveIssue.ts`, pur, cu teste) —
  pentru a arăta motivul ÎNAINTE de a cere, nu în loc de server. Serverul
  rămâne sursa de adevăr.

### Interfața

- **Foaia de tichet (telefon, `EditSheet`)**: jetonul de proiect devine
  buton; deschide o foaie mică (`KeyboardSheet`) cu proiectele în care ai drept
  de scriere, Inbox primul. Dacă tichetul are dependențe sau obstacol, foaia
  arată motivul în locul listei.
- **Formularul complet (`IssueForm`)**: același selector, lângă ID.
- **Glisarea / ⋮ din liste**: „Mută în proiect…" în `MoreSheet`, pentru un
  singur tichet. Selecția multiplă — nu în v1.
- Confirmarea e un toast: `Mutat în „Apologetica" ca APO-7.` Fără anulare în
  v1 (ar fi o a doua mutare, cu încă un număr nou).

UI-ul trece prin designer + PM înainte de implementare (regula omului).

## Ce NU face (v1)

- Linkurile vechi (`/HZ-12`) nu redirecționează.
- Nu mută dependențe sau obstacole — refuză.
- Nu mută mai multe tichete deodată.
- Android: o notificare deja afișată cu ID-ul vechi, apăsată, nu găsește
  tichetul; citirea nativă (`SyncWorker`) reface planul la următoarea rundă.
  Nicio schimbare în `mobile/`.

## Teste

- `src/lib/moveIssue.test.ts`: regulile de refuz, numărul nou (fixtures comune
  cu SQL-ul, ca la recurențe).
- `npm run test:move-sql` (nou, tiparul `test:recurrence-sql`): funcția pe
  baza reală — refuz cu dependență în ambele sensuri, refuz cu obstacol,
  refuz fără drept pe țintă, mutare reușită cu fir + atașament + văzut,
  numerotare, poza citibilă de un membru doar al țintei.
- `localRepository`: aceleași cazuri.
- `npm run test:nav`: mutarea din foaie lasă foaia deschisă pe ID-ul nou, URL
  rescris, Back te duce pe lista de dinainte.
- `npm run test:layout`: selectorul de proiect la 320–430px.

## Setup

`npm run migrate supabase/migration-move-issue.sql` ÎNAINTE de push (clientul
cheamă RPC-ul).
