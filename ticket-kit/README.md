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
```

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
```
