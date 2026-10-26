# Coșul de gunoi — design

Data: 2026-10-26. Cerința omului: „un coș de gunoi, ca dacă ștergem ceva din
greșeală să putem face restore”. Domeniu: tichetele (`issues`).

## Decizia principală: trigger + poză, nu `deleted_at`

O coloană `deleted_at` ar fi cerut un filtru în fiecare cititor al tabelei
`issues`: pagina, cache-ul offline, `SyncWorker` și widget-ul din APK (care
le-ar fi arătat pe cele șterse până la un APK nou), `functions/api`,
`send-reminders`, `inbox_rows`, `reminder-action`. Oricare uitat = un tichet
șters care sună sau reapare.

Așa că ștergerea rămâne o ștergere reală. Un trigger `before delete` pe
`issues` (`issues_trash`) pune deoparte, în `issues_trash`, rândul
(`to_jsonb`) și tot ce ar lua cascada cu el: dependențele în ambele sensuri,
legăturile cu obstacole, firul (`issue_events`), rândurile de fișiere
(`attachments`), vizitele tuturor (`issue_seen`) și căile pozelor. Niciun
cititor nu se schimbă. `before delete` vede copiii, fiindcă `on delete cascade`
rulează ca trigger de sfârșit de instrucțiune — și la o ștergere de mai multe
tichete deodată.

Ce NU intră în coș:
- **mutarea** (`move_issue` șterge rândul vechi după ce i-a mutat copiii):
  `move_issue` pune `horizontal.trash = off` local tranzacției, înainte de
  delete, și îl scoate imediat după;
- **ștergerea proiectului**: cascada ajunge la trigger cu proiectul deja
  dispărut, deci triggerul sare; `issues_trash.project_id` are `on delete
  cascade`, așa că și coșul proiectului pleacă.

## Restaurarea — `restore_issue(p_trash_id)`

`security definer`, drepturile verificate explicit (ca `move_issue`): scriere
pe proiect sau admin. Erori: `HZT01` (nu mai e în coș / invizibil), `HZT02`
(fără drept). Întoarce `{ id, original_id }`.

- **Numărul**: cel vechi dacă e liber; altfel „cel mai mare + 1” (același
  algoritm ca `nextIssueId`, sub `for update` pe proiect, reîncercare la 23505).
  Toastul spune: „HZ-12 a revenit ca HZ-15 — numărul vechi fusese refolosit.”
- **Coloanele**: reinserarea (`trash_reinsert`) pune doar coloanele care există
  azi și apar în poză; o coloană adăugată între timp primește default-ul.
- **Ce s-a schimbat în jur**: val șters → valul activ; temă ștearsă → fără;
  persoană / autor / cont dispărut → null (ca `on delete set null`); un memento
  care a trecut cât a stat în coș e marcat trimis (nu sună pe loc).
- **Dependențele**: numai spre / dinspre tichete care încă există, și numai
  dacă muchia nu închide un ciclu cu ce s-a legat între timp. Două tichete
  legate, șterse împreună: muchia revine la al doilea restaurat.
- **Obstacolele**: numai cele care mai există.

## Pozele

Clientul nu mai șterge octeții la ștergerea unui tichet (`deleteIssuesImpl`
șterge doar rândurile); o restaurare le aduce înapoi rândurile din
`attachments`, iar politicile de Storage (proiectul din cale, sau rândul
`attachments`) le fac iar vizibile. Octeții pleacă abia când tichetul iese din
coș: „Șterge definitiv” (`purge_trash`) și expirarea (`purge_expired_trash`,
30 de zile) pun căile în `storage_purge`, iar funcția edge `purge-trash`
(cron zilnic, cheia de serviciu) le șterge prin Storage API — un `delete from
storage.objects` din SQL ar lăsa octeții în S3. `scripts/storage-report.mjs`
nu mai socotește orfane pozele din coș.

## Drepturi

- `issues_trash`: RLS doar `select`, pentru membrii proiectului (și admin);
  nicio scriere directă din aplicație.
- `trash_rows`: vedere `security_invoker`, fără poze, cu numele celui care a
  șters (`assignees.user_id = deleted_by`).
- `purge_expired_trash` și `storage_purge`: numai cheia de serviciu.
- `deleted_by` null = o unealtă cu cheia de serviciu (`functions/api`), ca
  `created_by`.

## Interfața

Rotița de setări → secțiunea „Date” → „Coș · tichete șterse”. Foaia `trash`
(`TrashSheet.tsx`) se împinge peste setări (`pushSheet`), deci „Înapoi” duce
pe rotiță. Fără ecran nou, fără URL, fără loc în bara laterală: se deschide
rar. Rânduri plate („Senin”): titlul, coada `ID · proiect · când · cine`, apoi
„Restaurează” și „Șterge definitiv” (două atingeri, ca `.sh-delete`). După
restaurare: toast + `refresh()` — tichetul revine pe drumul obișnuit.

Offline: lista, restaurarea și ștergerea definitivă trec prin `net()`
(„Necesită rețea”), ca proiectele. Restaurarea uită traducerea `moved` a
numărului care renaște. Modul local (`localRepository`) ține un coș în
`localStorage` cu aceleași reguli (`planRestore` din `src/lib/trash.ts`).

## Teste

- `src/lib/trash.test.ts` — textele, pluralul, `planRestore` (număr, val,
  temă, ciclu).
- `localRepository.test.ts`, `supabaseRepository.test.ts` — coșul.
- `npm run test:trash-sql` — Postgres de unică folosință (Docker), NICIODATĂ
  producția: poza completă, RLS, restaurarea cu același număr și cu număr nou,
  refuzurile, mutarea și ștergerea proiectului, ciclul, coloana nouă,
  expirarea, migrarea re-rulabilă.
- `npm run test:nav` — șters → așteptat după toast → Coș → Restaurează →
  tichetul revine, și după reîncărcare.
- `npm run test:layout` — rândul din coș la 320–430px.

## Ordinea de deploy

1. `supabase functions deploy purge-trash`
2. `npm run migrate supabase/migration-move-issue.sql` (re-rulare: fanionul
   `horizontal.trash`; altfel o mutare ar umple coșul).
3. `npm run migrate supabase/migration-trash.sql` (programează și cronul, cu
   secretele din Vault de la `migration-cron.sql`).
4. Push pe `master` (clientul nu mai șterge pozele și cheamă RPC-urile).

Fără APK nou: Android nu șterge tichete și citește doar `issues`.
