# Membrii proiectului în selectoarele „către…" / „Assigned to"

Cerut: la click pe „către" din fir (`Thread.tsx`) și la click pe „Assigned to"
(`AssigneeSearch` din `IssueForm.tsx`), lista să arate cine ANUME are acces la
proiectul curent — nu toate conturile aplicației — plus numele libere de
totdeauna, sub ele.

## Regula exactă (precizată de om în timpul lucrului)

Primul draft includea orice admin în rosterul oricărui proiect ("are acces
peste tot"). Om a corectat: lista trebuie să fie **exact membrii literali din
`project_members` ai proiectului curent**, cu O SINGURĂ excepție — **apelantul
se vede întotdeauna pe sine**, chiar fără rând de membership. Excepția există
fiindcă adminul unic al aplicației (`lightsongjs@gmail.com`, legat de
assignee-ul „Ionut") nu are niciun rând în `project_members` — vede/scrie tot
prin `is_admin()` (`migration-access.sql`). Fără excepție, orice proiect fără
membri expliciți i-ar arăta o listă goală, exact opusul lui „doar pe mine,
atât".

Excepția e strict per-apelant: se adaugă doar `auth.uid()` (cine cheamă
funcția), nu „orice cont cu rol admin". Verificat separat, în browser: un alt
cont admin fără rând explicit pe un proiect NU apare în lista pe care o vede
altcineva pe acel proiect — cele două cerințe („mă văd mereu pe mine" / „un
admin nu apare la alții fără să fi fost adăugat") nu se bat, fiindcă prima se
aplică rândului „eu" din rezultatul FIECĂREI cereri, a doua rezultatului
cererii ALTCUIVA.

## Vizibilitate: funcții `SECURITY DEFINER`, nu o politică nouă pe `project_members`

`supabase/migration-members-visible.sql` adaugă două funcții RPC:

- **`project_member_roster(p_project_id text)`** → `(user_id, email)[]`.
  Verifică întâi că apelantul are el însuși acces la proiect (admin sau rând
  în `project_members`); dacă nu, întoarce listă goală (ca un `select` filtrat
  de RLS, nu o eroare). Rezultatul: membrii literali ai proiectului, UNION
  apelantul însuși.
- **`ensure_project_assignee(p_project_id text, p_user_id uuid)`** →
  rândul din `assignees` (creat dacă lipsește).

De ce funcție, nu o politică nouă pe `project_members` sau o vedere
`security_invoker`: „cine are acces" trebuie citit ca EMAIL, altfel un
selector cu id-uri goale n-ar ajuta pe nimeni. Dar `auth.users` nu are niciun
`GRANT` pentru `authenticated` — nu e o chestiune de RLS, lipsește privilegiul
de bază — deci o vedere `security_invoker` ar eșua pentru orice user obișnuit
indiferent cât de permisivă ar fi politica de pe `project_members`. Din moment
ce tot ne trebuie o funcție care rulează cu alt rol ca să ajungă la email, ea
poate face ȘI verificarea de membership — deci politica `members_select` de pe
`project_members` rămâne neatinsă („doar rândul tău", ca azi). Suprafața nouă
e minimă: `user_id` + `email`, doar pentru proiectul cerut, doar dacă
apelantul are el însuși acces la acel proiect.

## Legarea la prima alegere

Un membru cu acces la proiect poate să nu aibă încă rând în `assignees` — și
atunci nu poate fi ales ca destinatar (`issues.assignee_id` /
`issue_events.handoff_to` referă `assignees(id)`). Ales: **se creează rândul
la prima alegere** (`ensure_project_assignee`), nu la legarea contului — nu
există un moment separat de „legare de cont" în aplicație în afara acestui
flux, deci celălalt braț al alternativei n-ar avea unde să trăiască.

`ensure_project_assignee` verifică separat apelantul (acces la proiect) și
ținta (membru literal SAU apelantul însuși — aceeași regulă „exact membri +
eu" ca la roster), apoi upsert cu `on conflict (user_id) where user_id is not
null do nothing` — **partial**, ca să se potrivească cu indexul unic parțial
`assignees_user_idx` din `migration-comments.sql` (`where user_id is not
null`); un `on conflict (user_id)` simplu dă `42P10` („no unique or exclusion
constraint matching") pe un index parțial. Numele: partea locală a emailului
(`split_part(email, '@', 1)`), la fel ca fallback-ul din UI
(`memberDisplayName` din `src/lib/assigneeOptions.ts`), ca „Ana l-a creat" să
nu difere de ce vede toată lumea după aceea. Cursă cu o a doua cerere
concurentă pentru ACELAȘI `user_id`: indexul unic refuză a doua inserare,
funcția re-citește rândul câștigător.

Politica `assignees_write` de azi lasă un user obișnuit să insereze DOAR
`user_id is null or user_id = auth.uid()` — Ana nu poate crea direct rândul
lui Bogdan. `ensure_project_assignee` rulează `SECURITY DEFINER`, deci ocolește
asta explicit, dar doar după ce a verificat accesul amândurora.

## Cod

- `src/lib/assigneeOptions.ts` (nou, pur, cu fixtures) — `buildAssigneeOptions`
  îmbină `assignees` + `members` într-o listă unică de opțiuni: conturi (eu
  primul dacă am acces, apoi alfabetic), apoi nume libere (alfabetic). Un
  cont din `assignees` care nu mai are acces la proiectul curent dispare din
  listă — exact drumul înfundat pe care voia să-l evite omul. Un cont cu acces
  dar fără rând încă apare ca `kind: 'member'`, cu numele derivat din email
  (`memberDisplayName`).
- `src/store.tsx` — `projectMembers` (cache-uit per proiect, ca
  `waves`/`obstacles`, în ACELAȘI `Promise.all` din `refresh()`/
  `selectProject()`) și `ensureAssigneeForMember(projectId, userId)`, care
  scrie rezultatul RPC-ului direct în `assignees` local (fără refresh întreg).
- `src/data/repository.ts` / `supabaseRepository.ts` / `localRepository.ts` —
  `listProjectMembers` (RPC) și `ensureAssigneeForMember` (RPC). În modul
  local (fără Supabase, fără multi-user) `listProjectMembers` întoarce `[]` —
  bucata de conturi rămâne goală, numele libere tot apar.
- `src/components/IssueForm.tsx` (`AssigneeSearch`) și
  `src/components/Thread.tsx` (dropdown-ul „către…") consumă amândouă
  `buildAssigneeOptions`; alegerea unei opțiuni `kind: 'member'` cheamă
  `ensureAssigneeForMember` înainte de a seta id-ul real.

## Verificare

- `npm test` — 928 teste, toate trec (inclusiv 8 noi în
  `src/lib/assigneeOptions.test.ts`).
- `npm run typecheck` — curat.
- `npm run test:layout` — toți invarianții trec.
- Migrare rulată pe producție: `npm run migrate
  supabase/migration-members-visible.sql` (aplicată de două ori — a doua oară
  după fixul `on conflict ... where user_id is not null`, găsit chiar de
  scriptul de verificare de mai jos).
- **RPC, cu sesiuni reale** (patru conturi temporare: u1, u2, u3, admin
  temporar; trei proiecte de unică folosință): 15/15 verificări trecute —
  rosterul exact pe membri literali + eu, „doar pe mine" pentru admin fără
  rând explicit, adminul nu apare la alții, `ensure_project_assignee`
  idempotent și refuzat corect pentru ținte fără acces sau apelanți fără
  acces. Tot curățat (conturi, proiecte, rândurile din `assignees` create în
  test) — a rămas doar „Ionut" (`lightsongjs@gmail.com`), cel real.
- **Browser, cu sesiuni reale** (Playwright, `vite` local pe backendul de
  PRODUCȚIE din `.env`, două conturi temporare membre pe un proiect + un al
  treilea cont membru DOAR pe alt proiect + un admin temporar pe un proiect
  fără membri expliciți): 11/11 verificări trecute.
  - u1 și u2 se văd reciproc în „către…" ȘI în „Assigned to"; niciunul nu-l
    vede pe u3 (membru al altui proiect).
  - Selectarea lui u2 (fără rând încă în `assignees`) din „către…", ca u1,
    creează rândul pe loc și butonul arată imediat numele lui — fluxul de
    legare la prima alegere, prin UI real, nu doar prin RPC direct.
  - Admin temporar, pe un proiect fără niciun rând explicit în
    `project_members`: se vede DOAR pe sine, în ambele selectoare — „doar pe
    mine, atât".
  - Reciproc: după ce adminul temporar a vizitat acel proiect, u1 redeschide
    „către…" pe proiectul lui (unde adminul n-are rând) și adminul NU apare —
    excepția de auto-vizibilitate nu s-a scurs la alți useri.
  - Tot curățat la final (conturi, proiecte, tichete, rândurile din
    `assignees`) — a rămas doar „Ionut".
- În plus, curățat un artefact orfan găsit în producție dintr-o verificare
  anterioară neterminată (proiectul `tmpverify1789676938995`, „TMP verify
  browser", fără membri, cu un singur tichet) — nu era creat de sesiunea asta,
  dar era clar debris de test, nu date reale.
