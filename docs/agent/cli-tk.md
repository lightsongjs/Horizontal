# CLI-ul tk și ticket-kit

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## CLI-ul `tk` (tichetele din orice proiect)

`cli/` = UN CLI de sistem pentru API-ul de tichete (`functions/api/`), în locul
copierii lui `ticket-kit/` în fiecare proiect. Node ≥ 20, fără dependențe npm.

- **Instalare**: `npm run tk:install` pune `~/.local/bin/tk` → `cli/tk.mjs` din
  repo (symlink, deci `git pull` îl actualizează fără reinstalare; avertizează
  dacă `~/.local/bin` nu e în PATH). `npm run tk:uninstall` îl scoate.
- **Config pe calculator**: `tk login` → `~/.config/horizontal/config.json`
  (`$XDG_CONFIG_HOME`, mod 600, `{ apiUrl, apiKey }`); `HORIZONTAL_API_URL` /
  `HORIZONTAL_API_KEY` din mediu îl bat. Cheia nu se afișează niciodată.
- **Legătura cu proiectul**: `tk init <id>` în rădăcina unui repo scrie
  `.horizontal` (`{ "project": "kata" }`, căutat din cwd în sus; `--project` îl
  bate), un `TICKETING.md` de câteva rânduri și adaugă `@TICKETING.md` în
  `CLAUDE.md`-ul proiectului (idempotent).
- **`tk init` fără argument** (numai cu stdin + stdout terminal; altfel eroare
  de folosire — agenții dau id-ul): o alegere în modul brut (`node:readline`,
  fără dependențe). Scrisul filtrează (fără diacritice și majuscule, pe id /
  prefix / nume, `rankProjects`), ↑↓ se rotesc, o interogare numai din cifre
  alege rândul cu acel număr, Enter confirmă. Ultimul rând, „+ Proiect nou…”,
  întreabă Nume (propus: ce ai scris în filtru), Prefix (sugerat din nume) și
  Tip (`work` sub `~/01Projects/Work`, altfel `personal`), face `POST
  /api/projects` și continuă init-ul. Esc / Ctrl+C = nimic scris. Tastele
  trec printr-o SINGURĂ coadă pe toată sesiunea, ca o tastă venită înainte ca
  întrebarea următoare să asculte să nu se piardă; `TK_INTERACTIVE=1` forțează
  modul pe un pipe, numai pentru proba de fum. Regulile (filtrul, tastele,
  desenul, prefixul, tipul) sunt pure în `cli/lib.mjs`, cu teste.
- **Proiectele noi**: `tk project-create "Nume" [--prefix X] [--type …]` →
  `POST /api/projects`, cu regulile formularului din `src/lib/newProject.ts`
  (prefixul, id = prefixul mic, valurile 0 + 1, culoarea și tipul implicite),
  folosite și de `ProjectForm` și de ambele repository-uri. Ocupat = același
  id SAU același prefix (`prefixOwner`) → 409 `prefix_taken`. CLI-ul (.mjs,
  fără build) oglindește `autoPrefix`/`cleanPrefix`/`prefixOwner`; un test le
  compară cu cele din `src/`. **Vizibilitatea**: ca în aplicație (unde numai
  adminul creează proiecte), proiectul nou n-are rând în `project_members`,
  deci îl văd adminii și cheia API; un cont obișnuit, abia după ce un admin îl
  adaugă din „Utilizatori”.
- **De ce ghidul stă în CLI, nu în proiect**: regulile (direcția dependențelor,
  refuzurile API-ului, mutarea cu ID nou, atașamentele) se schimbă odată cu
  API-ul. Copiate în fiecare proiect, rămâneau în urmă exact ca ticket-kit.
  `cli/guide.md` e sursa unică; `tk guide` o tipărește, iar `TICKETING.md` doar
  trimite la ea. **O schimbare în API = o schimbare în `cli/guide.md`** (și în
  `tk.mjs`, dacă e o comandă nouă).
- Partea pură (argumente, config, `.horizontal`, CLAUDE.md, corpurile cererilor)
  e în `cli/lib.mjs`, cu teste; `cli/tk.smoke.test.mjs` rulează `tk` ca proces
  contra unui server HTTP fals — niciodată producția.
- **Omul de pe calculator** (`tk whoami --set <nume>`, `me: { id, name }` în
  config; `HORIZONTAL_ME` / `--as` îl bat): autorul comentariilor (`tk comment`,
  obligatoriu) și creatorul tichetelor (`tk create`, opțional). Numai id-ul și
  numele rândului din `assignees` — niciun email nu pleacă nicăieri.
- **Paritate cu API-ul**: orice rută / câmp din `functions/api/` are comandă sau
  flag în `tk` (inclusiv firul, `--pin` → `pinned`, `--accent`/`--desc` la
  proiect). O rută nouă fără comandă în `tk` e o regresie.
- **„Ale mele” din API** (2026-11-06, cerut pentru Jarvis): `GET
  /api/tickets?assignee=<nume|id>` filtrează în bază pe `assignee_id`; FĂRĂ
  `project` caută în toate proiectele (singurul caz în care lista nu cere
  proiectul), `assignee=` gol = nepasate (numai cu proiect), `done=true|false`
  tot pe server. Rândurile listei au acum `projectId` și `assigneeId`. În `tk`:
  `tk mine` (alias `ale-mele`; `me` rămâne `whoami`) = omul din `tk whoami`,
  implicit nebifate ca ecranul, `--done` / `--all` / `--project` / `--as`; iar
  `tk list --assignee` trimite filtrul la server (înainte era ignorat tăcut).
  Regula e cea din `inbox_rows`, NU `isMine`: un tichet nepasat, creat de tine,
  nu intră. Plasă: dacă serverul publicat e mai vechi (rânduri fără
  `assigneeId`, sau 400 `missing_params` fără proiect), `tk` iese cu eroare în
  loc să dea tot proiectul drept „al meu”.
- **Ștergerea temei** (2026-11-06): `DELETE /api/themes/<cheie>?project=…`,
  `tk theme-delete <cheie> [--force]` (alias `delete-theme`). Temele n-au coș și
  `issues.theme` n-are cheie străină, deci o ștergere oarbă ar lăsa tichetele
  „Fără temă” fără urmă. Regula: purtată de tichete → 409 `theme_in_use`
  (`count` + `tickets`), nicio scriere; `force=true` = gestul aplicației
  (`deleteTheme`: întâi `theme = null` pe tichete, apoi rândul temei — un eșec
  la mijloc lasă tema în picioare) și răspunde `{ deleted, cleared }`, destul
  ca s-o refaci (același nume → aceeași cheie). Un tichet din coș cu tema
  ștearsă revine „Fără temă” (`restore_issue` deja face asta).
- **Ștergerea / arhivarea valului** (H-17, 2026-11-06):
  `DELETE /api/waves/<n>?project=…[&moveTo=m]` (`tk wave-delete`), `PATCH
  { archived: true, moveTo? }` (`tk wave-archive`), `PATCH { archived: false }`
  (`tk wave-unarchive`). Regula pură e `waveRemovalPlan` (`_api-lib.ts`):
  tichete DESCHISE → 409 `wave_in_use` (`count` + `tickets`), nicio scriere;
  `moveTo` le mută întâi (orice val activ, 0 = Notițele). Tichetele GATA țin
  valul în ARHIVĂ (`waves.archived_at`), nu se șterg; un val gol se șterge la
  `DELETE`. Notițele (0) → 400. Fără `migration-wave-archive.sql`, arhivarea
  dă 409 `migration_missing` ÎNAINTE de mutare (coloana se vede în `select=*`).
  PostgREST n-are tranzacții: înainte de ștergerea rândului se verifică iar
  că valul e gol. `GET /api/waves` întoarce și arhivatele, cu `archived: true`
  (`tk waves` scrie „(arhivat)”).
- **Ștergerea tichetului** (2026-11-26, cerută de om): `DELETE
  /api/tickets/<id>` (`tk delete`) nu mai refuză un tichet cu comentarii /
  pase / fișiere (`has_activity` a dispărut). Refuzul venea din vremea fără
  coș; acum triggerul `issues_trash` pune deoparte firul, rândurile de fișiere
  și căile, iar octeții rămân în Storage până la `purge_trash` / expirare, deci
  `restore_issue` aduce tot înapoi. Agenții ajungeau să comenteze „rezolvat” în
  loc să șteargă. Rămâne doar `has_dependents` (ar rupe alt tichet).
- Ieșirea rămâne cea din ai-client (un rând pe element, `updated:`,
  `duplicate:`, `not_found`), iar forma veche a flagurilor (`tk --create
  --title …`, `--get --id`, `--attach --file`) merge în continuare.

**ticket-kit e LEGACY**: rămâne pentru proiectele care încă îl au copiat, dar
nu primește comenzi noi. Un proiect nou se leagă cu `tk init`.

## ticket-kit — sync (repo git separat, legacy — vezi „CLI-ul `tk`")

`ticket-kit/` are **propriul `.git`** (remote `github.com/lightsongjs/horizontal-ticket-kit`),
separat de repo-ul Horizontal. Master copy e un clone al aceluiași remote la
`C:\Users\User\OneDrive\03-RESURSE-MAIN\horizontal-ticket-kit\`.

După orice modificare în `ticket-kit/` (`ai-client.mjs`, `README.md`, `seed.mjs`, `CLAUDE.md`):
**nu copia fișiere** — sincronizează prin git.

```bash
cd ticket-kit && git add -A && git commit -m "..." && git push origin master
# apoi la master copy: git pull
```

Vezi și `ticket-kit/CLAUDE.md`. Endpoint-urile API pe care le lovește `ai-client.mjs`
sunt în `functions/api/`: tichete (cu scadență, urgent, fixare, ștergere), firul
(comentarii + pase, `author` obligatoriu — vezi „Firul și pasarea”), proiecte,
oameni, teme, valuri. Regulile comune cu aplicația se IMPORTĂ din `src/` (`themeKey`,
`nextWaveName`, `naturalCompare`), nu se rescriu. API-ul scrie cu cheia de serviciu,
deci ce nu se poate anula se refuză: o temă necunoscută la tichet, scadența pe o
recurentă, ștergerea unui tichet cu dependenți, comentarii sau fișiere. O oră de
scadență deja trecută nu primește memento (ar suna pe loc pe toate dispozitivele).
Fișierele (`POST/GET /api/tickets/<id>/attachments`, `--attach`) urmează drumul
aplicației — bucketul, calea și numele din `src/lib/attachmentPath.ts`, octeții
întâi, rândul după, `event_id` null —, dar fără micșorare (Workers n-are canvas),
de-aia plafonul de 25 MB / fișier.
