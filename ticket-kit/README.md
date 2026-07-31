# ticket-kit

Kit portabil pentru crearea de tichete în baza de date Horizontal.

Copiază întregul folder în proiectul tău, configurează `.env` (după `.env.example`), și rulează scriptul.

## Setup

```bash
cp ticket-kit/.env.example ticket-kit/.env
# Completează valorile în .env
node ticket-kit/create-tickets.mjs
```

## Utilizare cu AI (ai-client.mjs)

`ai-client.mjs` e un CLI pentru agenți AI care vor să caute sau să creeze
tichete incremental — fără să știe de Supabase sau de credențiale DB.

Necesită în `.env`-ul de la rădăcina proiectului:
```
HORIZONTAL_API_URL=https://your-horizontal-app.pages.dev
HORIZONTAL_API_KEY=<cheia din Cloudflare env vars>
```

### Comenzi

`--project` acceptă fie numele vizibil din interfață (`Katalist`), fie ID-ul intern (`kata`).

```bash
# Listează toate proiectele (id, prefix, nume, tip)
node ticket-kit/ai-client.mjs --projects
# output: kata  KATA  Katalist  [work]

# Listează toate tichetele unui proiect (opțional filtrare pe wave)
node ticket-kit/ai-client.mjs --list --project Katalist --wave 1
# output: KATA-01  [wave 1]  Setup DB

# Caută ID-ul unui tichet după titlu
node ticket-kit/ai-client.mjs --lookup --project Katalist --title "Setup DB" --wave 1
# output: KATA-03   (sau "not_found")

# Creează un tichet
node ticket-kit/ai-client.mjs --create --project Katalist --title "Auth flow" --wave 1 --deps KATA-03
# output: KATA-04   (sau "duplicate: KATA-03")

# Vezi toate detaliile unui tichet (desc, deps, selectors, scenarios, notes etc.)
node ticket-kit/ai-client.mjs --get --id KATA-03
# output: JSON complet cu toate câmpurile

# Actualizează câmpuri ale unui tichet existent (PATCH)
node ticket-kit/ai-client.mjs --update --id KATA-03 --title "Nou titlu"
node ticket-kit/ai-client.mjs --update --id KATA-03 --wave 2 --done true
node ticket-kit/ai-client.mjs --update --id KATA-03 --deps KATA-01,KATA-02
node ticket-kit/ai-client.mjs --update --id KATA-03 --deps ""   # șterge toate deps
node ticket-kit/ai-client.mjs --update --id KATA-03 --selectors '["mobile","desktop"]'
node ticket-kit/ai-client.mjs --update --id KATA-03 --scenarios '[{"given":"...","when":"...","then":"..."}]'
# output: updated: KATA-03   (sau duplicate: KATA-07 / not_found)
```

### Mutarea unui tichet în alt proiect

```bash
node ai-client.mjs --update --id HZ-07 --project ticket-kit
node ai-client.mjs --update --id HZ-07 --project ticket-kit --wave 2 --theme api
```

Tichetul primește un **ID nou** cu prefixul proiectului țintă (`HZ-07` → `TK-12`);
linkul vechi nu mai funcționează. Fără `--wave` aterizează în wave-ul activ al
țintei. Tema se golește, fiindcă cheile de theme sunt per-proiect.

Mutarea e **refuzată** (`has_dependencies`) dacă orice dependență atinge tichetul,
în oricare sens — nimic nu se rupe fără decizia ta. Golește-le întâi cu
`--update --id <id> --deps ""`, apoi mută. Din același motiv, `--project` nu se
combină cu `--deps` în aceeași comandă.

## Dependențe (`deps`) — direcția și cum le structurezi corect

⚠️ **Citește asta înainte să pui `deps` pe tichete.** E ușor de greșit direcția.

### Ce înseamnă `deps`

`deps: [X]` pe tichetul A înseamnă **„A este blocat de X / X trebuie făcut întâi"**.
Echivalent: **X deblochează A**. Săgeata de muncă curge dinspre dependință spre tichet:

```
X  ──deblochează──▶  A          (A.deps = [X])
```

În vederea „Începe aici / layer 1" apar tichetele **fără** `deps` (rădăcinile).
Ele sunt **task-urile primare** — de la ele pornește totul.

### Regula de aur: de la mic la mare

Task-ul **atomic/concret** e rădăcina; el deblochează tichetul-**părinte** (umbrela),
nu invers. Un părinte („zona X e gata") se poate marca done **doar după** ce copiii lui sunt gata,
deci **părintele depinde de copii**.

Model tipic per unitate de muncă (ex. un tabel de DB):

```
X schema  ──▶  X APIs  ──▶  X (umbrelă „gata")
(rădăcină)     deps=[schema]   deps=[APIs]
```

- `X schema` — fără deps, layer 1. Primul lucru pe care-l faci.
- `X APIs` — `deps = [X schema]`. Nu scrii API până n-ai schema.
- `X` (umbrela) — `deps = [X APIs]`. Zona e „gata" abia când API-ul e gata.
- Un tichet-finale („Finalizează totul") depinde de toate umbrelele.

### Anti-pattern #1: direcția inversată

❌ Umbrela deblochează copiii (`X schema.deps = [X umbrelă]`). Atunci sus, la „Începe aici",
apar umbrelele, iar munca reală de bază e împinsă jos. **Complet invers.** Rădăcina trebuie să fie
tot ce e mai atomic, iar umbrela — la vârf.

### Anti-pattern #2: dependențe cross-siloz

❌ Nu lega siloz-uri diferite doar pentru că datele se referențiază între ele.
Exemplu: `projects schema` **nu** ar trebui să depindă de `org_units schema` doar pentru că
`projects` are un foreign key spre `org_units`. Asta amestecă două coloane de muncă independente
și murdărește layer 2 (`org_units schema` ar deschide brusc și `projects schema`, fără sens).

Fiecare siloz rămâne o coloană verticală curată (`schema → API → umbrelă`).
Ordinea reală de execuție/migrare (ex. „org_units înainte de projects") se **documentează în
`desc`-ul tichetului-finale**, nu se codifică drept `deps` de planificare.

### Flow tipic pentru AI

```bash
# 1. Verifică ce există
node ticket-kit/ai-client.mjs --list --project Katalist --wave 1

# 2. Găsește ID-ul dependinței
node ticket-kit/ai-client.mjs --lookup --project Katalist --title "Setup DB" --wave 1
# → KATA-03

# 3. Creează tichetul cu deps rezolvate
node ticket-kit/ai-client.mjs --create --project Katalist --title "Deploy" --wave 1 --deps KATA-03
# → KATA-05

# 4. Verifică tichetul creat
node ticket-kit/ai-client.mjs --get --id KATA-05
# → JSON cu toate câmpurile confirmate

# 5. Actualizează un tichet după review
node ticket-kit/ai-client.mjs --update --id KATA-05 --done true
# → updated: KATA-05
```
