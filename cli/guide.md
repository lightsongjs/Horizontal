# hz — ghidul complet pentru agenți

`hz` e CLI-ul de sistem pentru tichetele din **Horizontal**. E singura unealtă
prin care scrii sau citești tichete dintr-un proiect: nu Supabase direct, nu
`ticket-kit/ai-client.mjs` (vechi), nu curl. Ghidul ăsta e sursa unică de adevăr;
`TICKETING.md` din proiect doar trimite aici.

## Cum știe hz unde ești

- **Configurația** (URL + cheie API) e a calculatorului:
  `~/.config/horizontal/config.json` (sau `$XDG_CONFIG_HOME/horizontal/`),
  scrisă de `hz login`. `HORIZONTAL_API_URL` / `HORIZONTAL_API_KEY` din mediu o
  bat. Cheia nu se afișează și nu se pune în repo. Dacă hz spune „nu e
  configurat", cere-i omului să ruleze `hz login` — nu inventa o cheie.
- **Proiectul** e al repo-ului: fișierul `.horizontal` (`{ "project": "kata" }`),
  căutat din directorul curent în sus. `--project <id>` îl bate.
  `hz status` arată ce vede hz de unde ești.
- Repo nelegat? `hz projects`, apoi `hz init <id>` în rădăcina repo-ului.

## Comenzile

Ieșirea e pentru tine: un rând pe element, cuvinte fixe pe care le poți citi
(`updated:`, `duplicate:`, `not_found`…). `--json` dă răspunsul brut al API-ului
la `projects`, `waves`, `themes`, `assignees`, `list`, `attach`, `attachments`.
Codul de ieșire e 1 la orice refuz sau eroare.

### Citire

```bash
hz projects
# kata  KATA  Katalist  [work]          (id  prefix  nume  [tip])

hz waves
# 0  Scratchpad
# 1  I / MVP                            (număr  nume / etichetă, în ordinea coloanelor)

hz themes
# pasul-2-admiterea  #F06B1F  Pasul 2: Admiterea

hz assignees
# a3fa07cf-…  Ionut                     (lista e globală, nu per proiect)

hz list                                 # tot proiectul
hz list --wave 1                        # un val
hz list --theme pasul-2                 # o temă;  --theme "" = fără temă
hz list --done false                    # doar deschise (--done = doar bifate)
# KATA-12  [wave 1 · I / MVP]  #auth  Titlul  ← KATA-10,KATA-11  (due 2026-10-23T21:00:00.000Z)  !
#   ✓ după val = bifat;  ← = dependențele;  ! = urgent

hz lookup "Setup DB" --wave 1           # → KATA-03   sau   not_found

hz get KATA-03                          # JSON complet: desc, deps, notes, selectors,
                                        # scenarios, assigneeId, dueAt, urgent, attachments

hz attachments KATA-03
# <id-atașament>  eroare.png  84213  https://…?token=…   (link valabil 8 ore)
```

### Scriere

```bash
hz create "Auth flow" --deps KATA-03,KATA-04 --desc "…"
# → KATA-05   sau   duplicate: KATA-03
#   Fără --wave intră în valul ACTIV al proiectului (ca o captură din aplicație).
#   Opțiuni: --wave N  --theme <cheie>  --assignee <nume|id>  --notes "…"
#            --due "2026-10-24"  /  --due "2026-10-24 15:30"  --urgent

hz update KATA-05 --done                # bifat;  --done false = debifat
hz update KATA-05 --title "Nou titlu" --wave 2
hz update KATA-05 --deps KATA-01,KATA-02     # ÎNLOCUIEȘTE lista;  --deps "" o golește
hz update KATA-05 --assignee Ionut           # --assignee "" = înapoi la creator
hz update KATA-05 --theme pasul-2            # --theme "" = fără temă
hz update KATA-05 --due "2026-10-24 15:30"   # --due "" = fără scadență
hz update KATA-05 --urgent                   # --urgent false
hz update KATA-05 --selectors '["mobile","desktop"]'
hz update KATA-05 --scenarios '[{"given":"…","when":"…","then":"…"}]'
# → updated: KATA-05  |  duplicate: KATA-07  |  not_found  |  <eroare>

hz update KATA-05 --project ticket-kit       # MUTĂ (vezi mai jos);  alias: --move-to
# → moved: KATA-05 -> TK-12

hz delete KATA-05                       # → deleted: KATA-05

hz attach KATA-05 eroare.png log.txt    # unul sau mai multe fișiere
# <id-atașament>  eroare.png  84213  https://…

hz theme-create "Pasul 2: Admiterea" --color "#F06B1F"   # → pasul-2-admiterea
hz theme-update pasul-2-admiterea --name "Pasul 2: Admis" --color "#1F9D60"
hz wave-create "Pilot"                  # → 4  IV / Pilot   (--name "Nu facem" pentru alt nume)
hz wave-update 2 --label "Pilot ~110 firme"
```

Forma veche, din ai-client, merge în continuare: `hz --create --title "…" --wave 1`,
`hz --get --id KATA-03`, `hz --attach --id KATA-03 --file a.png --file b.png`,
`hz --update --id KATA-03 --done true`, `--create-theme`, `--update-wave --number 2`.

## Regulile care contează

### Proiectul se dă prin id, nu prin nume

Folosește **id-ul scurt** din `hz projects` (`kata`), nu numele afișat: un nume cu
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

**`--deps` la update înlocuiește lista**, nu adaugă. Ca să adaugi una: `hz get`,
iei `deps`, pui lista întreagă înapoi.

### Înainte să te apuci de un tichet: uită-te la atașamente

`hz get <ID>` întoarce și `attachments`, fiecare cu un `url` valabil 8 ore. Omul
pune adesea o captură de ecran, iar aceea e partea neambiguă a raportului —
descrierea singură te poate trimite în direcția greșită. Descarcă fișierul și
citește-l. Un atașament fără `url` înseamnă „există, dar linkul n-a putut fi
semnat" — reîncearcă mai târziu, nu presupune că nu există.

### Flow tipic

```bash
hz list --wave 1                              # 1. ce există deja (fără dubluri)
hz lookup "Setup DB" --wave 1                 # 2. id-ul dependenței → KATA-03
hz create "Deploy" --wave 1 --deps KATA-03    # 3. tichetul, cu deps rezolvate → KATA-05
hz get KATA-05                                # 4. verifici ce s-a scris
hz update KATA-05 --done                      # 5. după ce e gata
```

Creezi întâi rădăcinile, apoi ce depinde de ele — un `--deps` spre un ID care nu
există e refuzat (`invalid_deps: …`).

### Mutarea în alt proiect

`hz update HZ-07 --project ticket-kit [--wave 2] [--theme api]`

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
| `theme_not_found: <cheie>` | temă necunoscută (înainte cădea tăcut în „Fără temă") | `hz themes` sau `hz theme-create` |
| `assignee_not_found` | numele nu e în `hz assignees` | se creează din aplicație |
| `invalid_deps: A, B` | dependențe spre ID-uri inexistente | creează-le întâi |
| `invalid_due` | scadența nu e `AAAA-LL-ZZ` sau `AAAA-LL-ZZ HH:MM` | |
| `recurring` | scadență pe un tichet care se repetă | se schimbă din aplicație |
| `has_dependents: …` | ștergi un tichet de care depind altele | scoate-l din deps-urile lor |
| `has_activity` | ștergi un tichet cu comentarii sau fișiere | se șterge din aplicație |
| `has_dependencies` | muți un tichet legat prin deps | vezi „Mutarea" |
| `temp_id` | atașezi pe un ID provizoriu (`HZ-~abc`) | așteaptă sincronizarea |
| `project_not_found` | id de proiect greșit | `hz projects` |
| `unauthorized` | cheia API e greșită | omul rulează `hz login` |

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
- Dacă un fișier din mijloc pică, hz spune care și listează ce a ajuns deja —
  acelea rămân pe tichet; nu le urca din nou.

### Temele și valurile

- O temă are o **cheie** (o folosesc tichetele), un nume și o culoare. Cheia se
  face din nume, ca în aplicație, și nu se mai schimbă (`theme-update` schimbă
  doar numele/culoarea). Un nume existent → `duplicate_theme: <cheie>`.
- Un val nou primește numărul și locul următoare; numele implicit e cifra romană
  următoare. Ordinea valurilor se schimbă din aplicație, nu de aici.

### Oamenii

`--assignee` ia un nume (fără majuscule: `ionut` = `Ionut`) sau un id. Gol
(`--assignee ""`) = „al creatorului". Lista e globală, nu per proiect.
