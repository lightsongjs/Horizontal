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

```bash
# Caută ID-ul unui tichet după titlu
node ticket-kit/ai-client.mjs --lookup --project KATA --title "Setup DB" --wave 1
# output: KATA-03   (sau "not_found")

# Creează un tichet (deps = ID-uri reale, obținute via --lookup)
node ticket-kit/ai-client.mjs --create --project kata --title "Auth flow" --wave 1 --deps KATA-03
# output: KATA-04   (sau "duplicate: KATA-03")

# Listează toate tichetele unui proiect (opțional filtrare pe wave)
node ticket-kit/ai-client.mjs --list --project KATA --wave 1
# output: KATA-01  [wave 1]  Setup DB
#         KATA-02  [wave 1]  ...
```

### Flow tipic pentru AI

```bash
# 1. Verifică ce există
node ticket-kit/ai-client.mjs --list --project KATA --wave 1

# 2. Găsește ID-ul dependinței
node ticket-kit/ai-client.mjs --lookup --project KATA --title "Setup DB" --wave 1
# → KATA-03

# 3. Creează tichetul cu deps rezolvate
node ticket-kit/ai-client.mjs --create --project kata --title "Deploy" --wave 1 --deps KATA-03
# → KATA-05
```
