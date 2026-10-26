# tk — ghidul complet pentru agenți

`tk` e CLI-ul de sistem pentru tichetele din **Horizontal**. E singura unealtă
prin care scrii sau citești tichete dintr-un proiect: nu Supabase direct, nu
`ticket-kit/ai-client.mjs` (vechi), nu curl. Ghidul ăsta e sursa unică de adevăr;
`TICKETING.md` din proiect doar trimite aici.

## Cum știe tk unde ești

- **Configurația** (URL + cheie API) e a calculatorului:
  `~/.config/horizontal/config.json` (sau `$XDG_CONFIG_HOME/horizontal/`),
  scrisă de `tk login`. `HORIZONTAL_API_URL` / `HORIZONTAL_API_KEY` din mediu o
  bat. Cheia nu se afișează și nu se pune în repo. Dacă tk spune „nu e
  configurat", cere-i omului să ruleze `tk login` — nu inventa o cheie.
- **Proiectul** e al repo-ului: fișierul `.horizontal` (`{ "project": "kata" }`),
  căutat din directorul curent în sus. `--project <id>` îl bate.
  `tk status` arată ce vede tk de unde ești.
- Repo nelegat? `tk projects`, apoi `tk init <id>` în rădăcina repo-ului.
  Un agent dă MEREU id-ul: `tk init` fără argument e alegerea interactivă a
  omului (caută / „+ Proiect nou…”) și, fără terminal, e o eroare de folosire.
- Proiectul nu există încă? `tk project-create "Nume" [--prefix X] [--type work|personal]`
  (vezi „Proiectele noi”), apoi `tk init <id>`.

## Comenzile

Ieșirea e pentru tine: un rând pe element, cuvinte fixe pe care le poți citi
(`updated:`, `duplicate:`, `not_found`…). `--json` dă răspunsul brut al API-ului
la `projects`, `waves`, `themes`, `assignees`, `list`, `attach`, `attachments`.
Codul de ieșire e 1 la orice refuz sau eroare.

### Citire

```bash
tk projects
# kata  KATA  Katalist  [work]          (id  prefix  nume  [tip])

tk waves
# 0  Scratchpad
# 1  I / MVP                            (număr  nume / etichetă, în ordinea coloanelor)

tk themes
# pasul-2-admiterea  #F06B1F  Pasul 2: Admiterea

tk assignees
# a3fa07cf-…  Ionut                     (lista e globală, nu per proiect)

tk list                                 # tot proiectul
tk list --wave 1                        # un val
tk list --theme pasul-2                 # o temă;  --theme "" = fără temă
tk list --done false                    # doar deschise (--done = doar bifate)
# KATA-12  [wave 1 · I / MVP]  #auth  Titlul  ← KATA-10,KATA-11  (due 2026-10-23T21:00:00.000Z)  !
#   ✓ după val = bifat;  ← = dependențele;  ! = urgent

tk lookup "Setup DB" --wave 1           # → KATA-03   sau   not_found

tk get KATA-03                          # JSON complet: desc, deps, notes, selectors,
                                        # scenarios, assigneeId, dueAt, urgent, attachments

tk attachments KATA-03
# <id-atașament>  eroare.png  84213  https://…?token=…   (link valabil 8 ore)
```

### Scriere

```bash
tk create "Auth flow" --deps KATA-03,KATA-04 --desc "…"
# → KATA-05   sau   duplicate: KATA-03
#   Fără --wave intră în valul ACTIV al proiectului (ca o captură din aplicație).
#   Opțiuni: --wave N  --theme <cheie>  --assignee <nume|id>  --notes "…"
#            --due "2026-10-24"  /  --due "2026-10-24 15:30"  --urgent

tk update KATA-05 --done                # bifat;  --done false = debifat
tk update KATA-05 --title "Nou titlu" --wave 2
tk update KATA-05 --deps KATA-01,KATA-02     # ÎNLOCUIEȘTE lista;  --deps "" o golește
tk update KATA-05 --assignee Ionut           # --assignee "" = înapoi la creator
tk update KATA-05 --theme pasul-2            # --theme "" = fără temă
tk update KATA-05 --due "2026-10-24 15:30"   # --due "" = fără scadență
tk update KATA-05 --urgent                   # --urgent false
tk update KATA-05 --selectors '["mobile","desktop"]'
tk update KATA-05 --scenarios '[{"given":"…","when":"…","then":"…"}]'
# → updated: KATA-05  |  duplicate: KATA-07  |  not_found  |  <eroare>

tk update KATA-05 --project ticket-kit       # MUTĂ (vezi mai jos);  alias: --move-to
# → moved: KATA-05 -> TK-12

tk delete KATA-05                       # → deleted: KATA-05

tk attach KATA-05 eroare.png log.txt    # unul sau mai multe fișiere
# <id-atașament>  eroare.png  84213  https://…

tk project-create "Turul României" --prefix TUR --type work
# → tur  TUR  Turul României  [work]    sau   prefix_taken: <id-proiect>
#   Fără --prefix: inițialele numelui (ca în aplicație). Tip implicit: personal.

tk theme-create "Pasul 2: Admiterea" --color "#F06B1F"   # → pasul-2-admiterea
tk theme-update pasul-2-admiterea --name "Pasul 2: Admis" --color "#1F9D60"
tk wave-create "Pilot"                  # → 4  IV / Pilot   (--name "Nu facem" pentru alt nume)
tk wave-update 2 --label "Pilot ~110 firme"
```

Forma veche, din ai-client, merge în continuare: `tk --create --title "…" --wave 1`,
`tk --get --id KATA-03`, `tk --attach --id KATA-03 --file a.png --file b.png`,
`tk --update --id KATA-03 --done true`, `--create-theme`, `--update-wave --number 2`.

## Regulile care contează

### Proiectul se dă prin id, nu prin nume

Folosește **id-ul scurt** din `tk projects` (`kata`), nu numele afișat: un nume cu
diacritice sau spații poate întoarce `project_not_found`. API-ul acceptă și
numele, dar id-ul nu se schimbă niciodată. Același lucru pentru teme (cheia, nu
numele) și valuri (numărul).

### Layer și val sunt două axe

- **Layerul** se calculează din dependențe, nu se setează („ce pot începe acum").
- **Valul** e manual, sprintul de livrare („ce livrez acum"). Valul 0 e
  Scratchpad/Notițe — un val ca oricare: `create`, `list`, `lookup` merg pe el.
- Dependențele între valuri nu blochează nimic în vederea filtrată pe val.

### ⚠️ Direcția dependențelor — regula care NU trebuie greșită

`deps: [X]` pe tichetul A înseamnă **„A depinde de X / A e blocat de X / X
deblochează A"**. X se face întâi.

```
X  ──deblochează──▶  A          (A.deps = [X])
```

Tichetele **fără** deps sunt rădăcinile: apar la „Începe aici / layer 1" și sunt
task-urile primare de la care pornește totul.

**De la mic la mare.** Task-ul atomic, concret, e rădăcina; el deblochează
părintele (umbrela). Un părinte („zona X e gata") se bifează doar după copii,
deci **părintele depinde de copii, nu invers**:

```
X schema  ──▶  X APIs  ──▶  X (umbrelă „gata")
(rădăcină)     deps=[schema]   deps=[APIs]
```

- `X schema` — fără deps, layer 1, primul lucru pe care-l faci.
- `X APIs` — `deps = [X schema]`: nu scrii API până n-ai schema.
- `X` (umbrela) — `deps = [X APIs]`: zona e gata abia când API-ul e gata.
- Un tichet-finale („Finalizează totul") depinde de toate umbrelele.

**Anti-pattern #1 — direcția inversată.** ❌ `X schema.deps = [X umbrelă]`. Atunci
la „Începe aici" apar umbrelele, iar munca de bază e împinsă jos. Complet invers.

**Anti-pattern #2 — dependențe între siloz-uri din cauza datelor.** ❌ `projects
schema` NU depinde de `org_units schema` doar fiindcă există un foreign key între
tabele. Asta leagă două coloane de muncă independente și murdărește layerele.
Fiecare siloz e o coloană verticală curată (`schema → API → umbrelă`). Ordinea
reală de migrare/execuție se scrie în `desc`-ul tichetului-finale, nu ca deps.

**`--deps` la update înlocuiește lista**, nu adaugă. Ca să adaugi una: `tk get`,
iei `deps`, pui lista întreagă înapoi.

### Înainte să te apuci de un tichet: uită-te la atașamente

`tk get <ID>` întoarce și `attachments`, fiecare cu un `url` valabil 8 ore. Omul
pune adesea o captură de ecran, iar aceea e partea neambiguă a raportului —
descrierea singură te poate trimite în direcția greșită. Descarcă fișierul și
citește-l. Un atașament fără `url` înseamnă „există, dar linkul n-a putut fi
semnat" — reîncearcă mai târziu, nu presupune că nu există.

### Flow tipic

```bash
tk list --wave 1                              # 1. ce există deja (fără dubluri)
tk lookup "Setup DB" --wave 1                 # 2. id-ul dependenței → KATA-03
tk create "Deploy" --wave 1 --deps KATA-03    # 3. tichetul, cu deps rezolvate → KATA-05
tk get KATA-05                                # 4. verifici ce s-a scris
tk update KATA-05 --done                      # 5. după ce e gata
```

Creezi întâi rădăcinile, apoi ce depinde de ele — un `--deps` spre un ID care nu
există e refuzat (`invalid_deps: …`).

### Mutarea în alt proiect

`tk update HZ-07 --project ticket-kit [--wave 2] [--theme api]`

- Tichetul primește **ID nou**, cu prefixul țintei (`HZ-07` → `TK-12`); linkul
  vechi nu mai merge. Folosește de aici încolo ID-ul din `moved: … -> …`.
- Fără `--wave` aterizează în valul activ al țintei (`wave_not_in_target` dacă
  dai un val care nu există acolo). Tema se golește (cheile sunt per proiect);
  `--theme` trebuie să existe în țintă (`theme_not_in_target`).
- **Refuzată** (`has_dependencies`) dacă orice dependență atinge tichetul, în
  oricare sens. Golește-le întâi (`--deps ""` pe el și pe cei care depind de el),
  apoi mută. Din același motiv `--project` nu merge cu `--deps` în aceeași comandă
  (`cannot_move_and_set_deps`).

### Ce refuză API-ul și de ce

API-ul scrie cu cheia de serviciu, deci ce nu se poate anula se refuză:

| Răspuns | Când | Ce faci |
|---|---|---|
| `duplicate: <ID>` | există deja un tichet cu titlul ăsta în proiect | folosește-l pe acela |
| `theme_not_found: <cheie>` | temă necunoscută (înainte cădea tăcut în „Fără temă") | `tk themes` sau `tk theme-create` |
| `assignee_not_found` | numele nu e în `tk assignees` | se creează din aplicație |
| `invalid_deps: A, B` | dependențe spre ID-uri inexistente | creează-le întâi |
| `invalid_due` | scadența nu e `AAAA-LL-ZZ` sau `AAAA-LL-ZZ HH:MM` | |
| `recurring` | scadență pe un tichet care se repetă | se schimbă din aplicație |
| `has_dependents: …` | ștergi un tichet de care depind altele | scoate-l din deps-urile lor |
| `has_activity` | ștergi un tichet cu comentarii sau fișiere | se șterge din aplicație |
| `has_dependencies` | muți un tichet legat prin deps | vezi „Mutarea" |
| `temp_id` | atașezi pe un ID provizoriu (`HZ-~abc`) | așteaptă sincronizarea |
| `project_not_found` | id de proiect greșit | `tk projects` |
| `prefix_taken: <id>` | `project-create` cu un prefix (sau id) deja folosit | alt `--prefix` |
| `invalid_prefix` | prefixul nu are nicio literă A–Z / cifră (ex. numele „Știri”) | dă `--prefix` |
| `unauthorized` | cheia API e greșită | omul rulează `tk login` |

### Scadența și urgentul

- O zi fără oră = toată ziua, fără memento (ca în aplicație). Cu oră = ora
  României; sună la scadență pe dispozitivele omului.
- O oră deja trecută nu primește memento (ar suna pe loc peste tot).
- Urgentul e un comutator (`--urgent` / `--urgent false`).

### Ștergerea

Pentru o încărcare greșită. Trece prin coșul aplicației, dar din API nu există
„restaurează" — tratează-o ca definitivă. Refuzată cu dependenți sau activitate.

### Fișierele

- Se pun **pe tichet** (bara de fișiere din aplicație), nu pe un comentariu.
- Maxim **10 fișiere** pe comandă, **25 MB** fiecare, **50 MB** în total.
- Tipul se ghicește după extensie; doar png/jpg/webp/gif apar ca miniatură.
- Pozele **nu se micșorează** pe drum — micșorează o poză de cameră înainte,
  dacă nu-ți trebuie la rezoluția completă.
- Un fișier pus nu se mai șterge din CLI, iar tichetul nu se mai poate șterge
  din API (`has_activity`).
- Dacă un fișier din mijloc pică, tk spune care și listează ce a ajuns deja —
  acelea rămân pe tichet; nu le urca din nou.

### Temele și valurile

- O temă are o **cheie** (o folosesc tichetele), un nume și o culoare. Cheia se
  face din nume, ca în aplicație, și nu se mai schimbă (`theme-update` schimbă
  doar numele/culoarea). Un nume existent → `duplicate_theme: <cheie>`.
- Un val nou primește numărul și locul următoare; numele implicit e cifra romană
  următoare. Ordinea valurilor se schimbă din aplicație, nu de aici.

### Proiectele noi

`tk project-create` face exact ce face formularul din aplicație: prefixul
(A–Z, 0–9, max 6, majuscule; fără `--prefix`, inițialele numelui), id-ul =
prefixul cu litere mici (`TUR` → `tur`), valul 1 activ, valurile „Scratchpad”
(0) și „Val 1 / MVP” (1). Un prefix ocupat (de prefixul sau de id-ul altui
proiect) se refuză. Proiectul nou n-are membri: îl văd adminii; altcineva îl
vede abia după ce un admin îl adaugă din „Utilizatori”. Nu crea proiecte din
proprie inițiativă — numai când omul ți-o cere.

### Oamenii

`--assignee` ia un nume (fără majuscule: `ionut` = `Ionut`) sau un id. Gol
(`--assignee ""`) = „al creatorului". Lista e globală, nu per proiect.
