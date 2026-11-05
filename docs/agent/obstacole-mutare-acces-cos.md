# Obstacole, mutare, acces la Notițe, coș

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Obstacole — a doua axă de blocare

Un obstacol e o condiție din AFARA muncii, care trebuie să cadă înainte ca
tichetele legate să pornească — nu e muncă. **N-are val și n-are layer:**
`computeLayers` din `src/lib/engine.ts` rămâne neatins de întregul plan al
obstacolelor — layerul unui tichet nu se mișcă niciodată la depășirea unui
obstacol, altfel singurul lucru stabil din aplicație ar depinde de viteza cu
care răspund alte echipe. Obstacolele sunt orthogonale pe axa val/layer: se
văd pe hartă și în poarta valului, dar nu intră în niciun calcul de layer.

Patru stări, nu trei și nu cinci: `necunoscut` (nu s-a întrebat încă),
`asteptare` (s-a întrebat, se așteaptă răspuns — de aici pornește „fără
răspuns de N zile"), `depasit` (condiția a căzut) și `ocolit` (condiția n-a
căzut, dar munca poate porni pe altă cale). „Depășit" și „ocolit" sunt stări
separate, nu un singur „rezolvat", fiindcă răspund la întrebări diferite: una
spune „obstacolul nu mai există", cealaltă „există încă, dar l-am ocolit" — un
raport care le-ar contopi ar minți despre ce chiar s-a rezolvat.

`bypass !== null` e sursa unică a colțului retezat de pe hartă (`gatePath` din
`MapView.tsx`). La salvare, `ObstacleForm.tsx` normalizează un câmp de ocolire
gol (`''`) la `null` — gol înseamnă „nu are ocolire", nu „ocolire cu text
gol", și de-aia un obstacol fără ocolire nu are colțul retezat.

`blockedBy` din `src/lib/obstacles.ts` e **singura poartă** prin care UI-ul
află că un tichet e blocat de un obstacol — nicio componentă nu recalculează
asta pe cont propriu. Store-ul o memoizează în `blockedByObstacle`, iar
`ObstacleChip`, `TicketCard`, `ListView` și titlul de layer din „Ordine" citesc
toate doar rezultatul ei.

Dependențele obstacol-obstacol (`obstacle_deps`, cu propagarea `#1 → #19` din
`openObstacles`) există în model, în migrare și în motor, ciclul e refuzat la
scriere ca la dependențele de tichete — dar **nu au editor**. `ObstacleForm.tsx`
nu are câmp de `deps`, deliberat: lista de câmpuri din spec nu-l cere. Se
scriu azi doar direct în bază.

Setup: `npm run migrate supabase/migration-obstacles.sql`.

## Mutarea unui tichet în alt proiect

Spec: `docs/superpowers/specs/2026-10-12-mutare-tichet-intre-proiecte-design.md`
(D-156). Tichetul primește **număr nou** în proiectul țintă (`HZ-12` →
`APO-07`); linkul vechi nu redirecționează. Refuz la ORICE dependență (în
oricare sens), la o legătură cu un obstacol, la un ID provizoriu și fără drept
de scriere pe sursă ȘI pe țintă (sau admin). Valul devine cel activ al țintei,
tema se golește, persoana rămâne doar dacă e membru al țintei (sau admin);
firul, fișierele (rândurile) și vizitele urmează tichetul.

- **Server: o singură funcție**, `move_issue(p_id, p_target)`
  (`supabase/migration-move-issue.sql`, `security definer`, drepturile verificate
  explicit). Insert-copie (`jsonb_populate_record`, ca o coloană nouă să se
  copieze singură) → mută copiii → șterge vechiul: FK-urile n-au `on update
  cascade`. Numărul = `nextIssueId` în SQL, sub `for update` pe proiectul țintă,
  cu 3 reîncercări la 23505. Refuzurile au errcode `HZM01..06` și mesajul
  românesc pe care îl vede omul.
- **Pozele nu se mută fizic**: calea rămâne `vechiulProiect/HZ-12/…`; politicile
  de select/delete de pe `storage.objects` au un al doilea drum, prin rândul din
  `attachments` cu acel `path`.
- **Client**: `Repository.moveIssue`; regulile pure (motivul refuzului înainte de
  cerere, ținte cu Inbox primul, `movedIssue` pentru modul local) în
  `src/lib/moveIssue.ts`. Învelișul offline: prin `net()` și refuzat cât coada
  are scrieri pe tichet. Traducerea ID vechi → nou (`moved` în
  `offlineRepository.ts`) e **doar în memorie** și se uită când numărul renaște
  — „cel mai mare + 1" refolosește numărul, iar o traducere pe disc ar fi trimis
  editările capturii următoare la tichetul mutat.
- **Foaia și URL-ul**: `useMoveIssue` (`hooks.ts`) — `replaceState` ÎNAINTE de
  `renameIssueId`, ca Back să ducă pe lista de dinainte, nu pe `/HZ-12`. Foaia de
  telefon își păstrează cheia (fără remontare); formularul complet se remontează
  (`remount`), fiindcă și-a copiat valul și tema la montare — și de-aia, cu
  modificări nesalvate, meniul lui nu mută. Proiectul țintă devine cel încărcat.
- **UI**: jetonul de proiect din `EditSheet` (foaie mică), jetonul de lângă ID din
  `IssueForm` (`MoveChip`, `ChipPop`), „Mută în proiect…" în ⋮ (`MoreSheet`),
  pentru UN tichet. Confirmarea e un toast, fără anulare.
- **`#proiect` / `@persoană` în titlul formularului** (`titleProjectToken` /
  `titlePersonToken`, `captureTokens.ts`): evidențiate (`proj-mark`) cu un
  indiciu sub titlu; la salvare semnul iese din titlu, iar tichetul se mută,
  respectiv trece la omul acela (`assigneeId`, fără comentariu în fir — cerut de
  om, 2026-10-27). Proiectul / omul de acum nu e o cerere; foaia de telefon nu le are.
- Teste: `src/lib/moveIssue.test.ts`, `localRepository`/`offlineRepository`/
  `supabaseRepository`, `npm run test:move-sql` (pornește singur un container
  `supabase/postgres` de unică folosință, cu Docker; `MOVE_SQL_URL` pentru o
  bază dată — **niciodată** producția: testul scrie), `test:nav` (mutarea din
  foaie + Back, refuzul), `test:layout` (antetul și foaia la 320–430px).

Setup: `npm run migrate supabase/migration-move-issue.sql` **ÎNAINTE** de push
(clientul cheamă RPC-ul; fără el, mutarea spune „lipsește migrarea").

## Notițele sunt ale omului, nu ale clientului

Decizia omului, 2026-10-29: în Notițe (valul 0) pune înregistrări, voice note-uri,
lucruri pe care clientul nu trebuie să le vadă. **Dreptul e pe proiect**,
`project_members.can_see_notes` (implicit `false`, și pentru membrii de
dinainte), comutatorul „Notițe” de lângă rol în foaia contului (`UserForm`).
Adminul vede tot.

- **Regula e în bază** (`supabase/migration-notes-access.sql`), nu în interfață —
  ascunse doar din UI, notițele ar fi fost citibile prin REST cu sesiunea
  clientului. Poarta: `notes_ok(proiect, val)` / `issue_notes_ok(id)` /
  `path_notes_ok(cale)` (`security definer`), adăugată la fiecare politică ce
  lasă un membru să citească ceva legat de un tichet: `issues`, `waves` (și
  rândul valului 0, deci clientul n-are pastila — `scratch` null în
  `WaveTabs`), firul, fișierele (rânduri + Storage, și cele încă fără rând sau
  din coș), dependențele (ambele capete), `obstacle_issues`, coșul;
  `inbox_rows` e `security_invoker`, deci urmează singur. Funcțiile `security
  definer` (`move_issue`, `restore_issue`, `purge_trash`) o verifică explicit:
  o notiță „nu există”. Mementourile push (`send-reminders`) unei notițe pleacă
  doar la admini + membrii cu drept.
- Clientul **nu poate scrie** în Notițe (creare, mutare acolo — `with check`).
- **Numărul unui tichet nou vine din `project_issue_ids(proiect)`** (`security
  definer`, `migration-issue-ids.sql`), nu din `select id from issues`: RLS
  ascunde notițele clientului, iar „cel mai mare + 1" nimerea numărul unei
  notițe → `duplicate key … "issues_pkey"` la fiecare creare (NEVEON,
  2026-11-05). Funcția dă doar id-urile, oricărui membru. Pagina
  (`createIssueOnce`) și cutia Android (`DrainWorker`) o cheamă amândouă.
- **Mutarea dintr-o parte în alta publică / ascunde tot tichetul** (fir,
  fișiere), fără nicio scriere în plus: totul se leagă de `issues.wave`.
- O regulă nouă de citire pe ceva legat de un tichet primește și ea poarta —
  altfel e o scurgere. Teste: `npm run test:notes-sql` (Docker de unică
  folosință, NICIODATĂ producția).

Deploy, în ordine: `npm run migrate supabase/migration-notes-access.sql` →
re-rulează `migration-move-issue.sql` și `migration-trash.sql` (au primit
poarta) → `supabase functions deploy admin-users` și `send-reminders` → push.
Fără funcția nouă, „Salvează” în foaia contului ar fi pus `can_see_notes` pe
`false` (delete + insert).

## Coșul de gunoi (tichete șterse)

Spec: `docs/superpowers/specs/2026-10-26-cos-de-gunoi-design.md`. **Ștergerea
rămâne o ștergere reală** — fără `deleted_at` pe `issues`, care ar fi cerut un
filtru în fiecare cititor (pagina, cache-ul offline, `SyncWorker`/widget-ul
din APK, `functions/api`, `send-reminders`). Triggerul `before delete`
`issues_trash` (`supabase/migration-trash.sql`) pune deoparte în
`issues_trash` rândul (`to_jsonb`) și tot ce ia cascada: dependențele în
ambele sensuri, obstacolele, firul, rândurile de fișiere, vizitele tuturor,
căile pozelor. Nimic din aplicație nu „mută în coș”: `deleteIssue(s)` și coada
offline sunt neschimbate.

- **Nu intră în coș:** mutarea (`move_issue` pune `horizontal.trash = off`
  local, înainte de delete — de-aia `migration-move-issue.sql` se re-rulează
  ÎNAINTE de `migration-trash.sql`) și ștergerea proiectului (triggerul sare
  când proiectul nu mai e; coșul lui pleacă prin cascadă).
- **`restore_issue`** (`security definer`, scriere sau admin; `HZT01`/`HZT02`)
  întoarce `{ id, original_id }`: numărul vechi dacă e liber, altfel „cel mai
  mare + 1” — toastul o spune (`restoreNotice`). Reinserarea pune doar
  coloanele de azi (`trash_reinsert`, o coloană nouă primește default-ul); val
  / temă / persoană dispărute cad pe valul activ / fără / null; un memento
  trecut nu sună; dependențele revin doar spre tichete existente și fără ciclu.
- **Pozele nu se mai șterg la ștergere** (`deleteIssuesImpl` șterge doar
  rânduri). Octeții pleacă când tichetul iese din coș: „Șterge definitiv”
  (`purge_trash`) și expirarea de 30 de zile pun căile în `storage_purge`, iar
  funcția edge `purge-trash` (cron zilnic) le șterge prin Storage API — nu
  `delete from storage.objects`, care ar lăsa octeții în S3.
  `storage-report --clean` sare peste pozele din coș.
- **UI:** rotița → „Date” → „Coș · tichete șterse” (`TrashSheet.tsx`, foaie
  `trash` împinsă peste setări, „Înapoi” = rotița). Fără ecran, fără URL.
  Lista vine din `trash_rows` (vedere `security_invoker`, cu numele celui care
  a șters), direct din `repository`, nu din store; restaurarea cere apoi un
  `refresh()`. Offline prin `net()`. Modul local oglindește tot în
  `localStorage` (`planRestore` din `src/lib/trash.ts`).
- Teste: `src/lib/trash.test.ts`, repo-urile, `npm run test:trash-sql`
  (Docker de unică folosință, ca `test:move-sql` — NICIODATĂ producția),
  `test:nav` („coș: …”), `test:layout` (rândul la 320–430px).

Deploy, în ordine: `supabase functions deploy purge-trash` →
`npm run migrate supabase/migration-move-issue.sql` →
`npm run migrate supabase/migration-trash.sql` → push.
