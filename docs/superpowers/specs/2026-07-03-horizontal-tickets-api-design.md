# Horizontal Tickets API — Design Spec
**Data:** 2026-07-03  
**Status:** Draft

---

## 1. Problema

Când un agent AI vrea să creeze un ticket cu dependențe, nu știe ID-urile tichetelor existente. Fără un lookup, nu poate exprima `deps: ["KATA-03"]` — nu știe că "Setup DB" are ID-ul KATA-03.

Soluția: expunem două endpoint-uri HTTP pe app-ul Horizontal (Cloudflare Pages Functions) pe care orice copie de ticket-kit le poate apela.

---

## 2. Arhitectură

```
Proiect extern (ex: calendar-app)
    └── ticket-kit/
            ├── .env
            │     HORIZONTAL_API_URL=https://horizontal.yourdomain.com
            │     HORIZONTAL_API_KEY=<secret>
            │
            └── ai-client.mjs          ← CLI folosit de AI
                    │
                    │  HTTP + X-API-Key header
                    ▼
        Horizontal (Cloudflare Pages)
            └── functions/
                    ├── _middleware.ts  ← verifică X-API-Key
                    └── api/
                        └── tickets.ts ← GET + POST
                                │
                                │  fetch() Supabase REST API
                                ▼
                        Supabase (întotdeauna activ)
```

`seed.mjs` rămâne neschimbat — continuă să apeleze Supabase direct pentru setup inițial în batch.

---

## 3. Endpoint-uri

### GET /api/tickets — Lookup

Caută un ticket după titlu și wave. Folosit de AI înainte de a crea dependențe.

**Request:**
```
GET /api/tickets?project=KATA&title=Setup+DB&wave=1
X-API-Key: <secret>
```

**Response 200:**
```json
{
  "id": "KATA-03",
  "title": "Setup DB",
  "wave": 1,
  "done": false
}
```

**Response 404:**
```json
{ "error": "not_found" }
```

Parametrul `project` este case-insensitive (normalizat la lowercase intern, deci `KATA` și `kata` sunt echivalente).  
Căutarea pe titlu este **case-insensitive, exact match**. Dacă există mai multe tichete cu același titlu în același wave, returnează primul după ID.

---

### POST /api/tickets — Create

Creează un ticket nou. `deps` conține ID-uri reale (obținute prin GET în prealabil).

**Request:**
```
POST /api/tickets
X-API-Key: <secret>
Content-Type: application/json

{
  "projectId": "kata",
  "title": "Auth flow",
  "wave": 1,
  "deps": ["KATA-03"],
  "theme": "auth",
  "desc": "Flux de autentificare complet",
  "notes": "",
  "assigneeId": null
}
```

Câmpuri obligatorii: `projectId`, `title`, `wave`.  
Câmpuri opționale: `deps` (default `[]`), `theme`, `desc`, `notes`, `assigneeId`.

**Response 201:**
```json
{
  "id": "KATA-04",
  "title": "Auth flow",
  "wave": 1,
  "deps": ["KATA-03"]
}
```

**Response 400** (câmpuri lipsă):
```json
{ "error": "missing_fields", "required": ["projectId", "title", "wave"] }
```

**Response 409** (titlu duplicat în același wave):
```json
{ "error": "duplicate_title", "existing_id": "KATA-03" }
```

**Response 422** (dep inexistent):
```json
{ "error": "invalid_deps", "unknown": ["KATA-99"] }
```

---

## 4. Autentificare

Toate rutele `/api/*` sunt protejate de `functions/_middleware.ts`.

- Header așteptat: `X-API-Key: <valoare>`
- Valoarea e comparată cu env var `TICKETS_API_KEY` din Cloudflare
- Nepotrivire sau lipsă header → `401 Unauthorized`
- `TICKETS_API_KEY` **nu are prefix `VITE_`** — nu ajunge niciodată în JS bundle-ul din browser

Generare cheie (o singură dată, la setup):
```bash
openssl rand -hex 32
```

---

## 5. Modificări în Horizontal (repo)

```
functions/
  _middleware.ts      ← nou
  api/
    tickets.ts        ← nou
```

Implementarea apelează Supabase via `fetch()` nativ (Cloudflare nu are Node.js). Folosește `SUPABASE_URL` și `SUPABASE_SERVICE_ROLE_KEY` ca env vars în Cloudflare (deja necesare pentru app).

---

## 6. Modificări în ticket-kit

```
ai-client.mjs         ← nou
.env.example          ← adaugă HORIZONTAL_API_URL + HORIZONTAL_API_KEY
README.md             ← secțiune nouă: "Utilizare cu AI"
```

### Comenzi ai-client.mjs

```bash
# Lookup — returnează ID sau "not found"
node ai-client.mjs --lookup --project KATA --title "Setup DB" --wave 1

# Create — returnează ID-ul creat
node ai-client.mjs --create --project kata --title "Auth flow" --wave 1 --deps KATA-03

# Create cu mai multe deps
node ai-client.mjs --create --project kata --title "Deploy" --wave 1 --deps KATA-03,KATA-04

# List — listează toate tichetele unui proiect (opțional filtrare pe wave)
node ai-client.mjs --list --project KATA --wave 1
```

Output-ul e întotdeauna **text simplu pe stdout** (nu JSON) — ușor de citit de AI din terminal.

---

## 7. Flow complet — exemplu

AI primește task: *"Creează un ticket 'Deploy pe Cloudflare' cu dependență pe 'Auth flow'"*

```bash
# 1. Caută ID-ul lui "Auth flow" pe wave 1
node ai-client.mjs --lookup --project KATA --title "Auth flow" --wave 1
# → KATA-04

# 2. Creează tichetul cu deps rezolvate
node ai-client.mjs --create --project kata --title "Deploy pe Cloudflare" --wave 1 --deps KATA-04
# → KATA-05
```

---

## 8. Out of scope (această iterație)

- Update ticket prin API
- Delete ticket prin API
- Generare/revocare chei API din UI
- List all tickets fără filtru de proiect
- Fuzzy search pe titlu

---

## 9. Setup la primul deploy

1. Generează `TICKETS_API_KEY`: `openssl rand -hex 32`
2. Adaugă în Cloudflare Pages → Settings → Environment Variables:
   - `TICKETS_API_KEY` = valoarea generată
   - `SUPABASE_URL` = URL-ul Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` = service role key
3. În fiecare ticket-kit nou, copiază `.env.example` în `.env` și completează:
   - `HORIZONTAL_API_URL` = URL-ul app-ului deployed
   - `HORIZONTAL_API_KEY` = aceeași valoare din pasul 1
