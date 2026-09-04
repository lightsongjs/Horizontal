# Atașamentele tichetelor, prin API

**Data:** 2026-09-04
**Stare:** aprobat, gata de plan

## Problema

Fluxul real: clientul deschide aplicația de pe telefon, scrie un tichet și pune
un print screen. Mai târziu, Claude ia tichetul și îl rezolvă. Descrierea o
primește deja (`GET /api/tickets/{id}` întoarce `desc`), dar **poza nu ajunge
nicăieri**. Jumătate din ce a comunicat clientul se pierde exact la pasul unde
contează, iar imaginea e adesea partea neambiguă a raportului.

Atașamentele există în aplicație de la `2026-08-12-attachments-design.md`:
metadatele în tabelul `attachments`, octeții în bucketul privat `attachments`.
Doar că drumul spre ele trece prin RLS și prin sesiunea din browser — iar API-ul
din `functions/api/` nu le pomenește.

## Criteriul de design

**Claude nu poate „vedea" un URL.** Vede un fișier local, prin Read. Deci
livrabilul nu e „API-ul întoarce poze", e „agentul ajunge cu pozele pe disc, cu
căi absolute pe care le poate da mai departe". Orice formă care se oprește la un
link e neterminată.

## Soluția

Trei bucăți, în ordinea dependențelor.

### 1. `GET /api/tickets/{id}` capătă `attachments`

Un câmp în plus în răspunsul existent, niciun endpoint nou:

```json
"attachments": [
  {
    "id": "9f3c…",
    "filename": "eroare-login.png",
    "contentType": "image/png",
    "size": 84213,
    "createdAt": "2026-09-03T18:22:04.113Z",
    "url": "https://<ref>.supabase.co/storage/v1/object/sign/attachments/kata/KATA-07/9f3c…?token=…"
  }
]
```

Tichet fără atașamente → `[]`. Nu câmp lipsă, nu `null`: consumatorul scrie
`for (const a of t.attachments)` fără gardă, iar prezența câmpului îi spune că
serverul e cel nou.

**Implementare, în `functions/api/tickets/[id].ts`:**

1. `GET /rest/v1/attachments?issue_id=eq.<id>&select=id,path,filename,size,content_type,created_at&order=created_at`
   — al treilea fetch, lângă cel de `issues` și cel de `dependencies`.
2. Semnare în **un singur apel**, nu unul per fișier:
   `POST {SUPABASE_URL}/storage/v1/object/sign/attachments` cu
   `{"expiresIn": 3600, "paths": [...]}` → un array de `{path, signedURL, error}`.
3. `signedURL` vine **relativ** (`/object/sign/attachments/...?token=...`).
   Trebuie prefixat cu `${SUPABASE_URL}/storage/v1` — asta face și supabase-js
   pe dinăuntru, și e capcana cea mai probabilă la implementare. Se verifică pe
   un tichet real, nu doar în test.
4. Fișierele pentru care semnarea eșuează se întorc **fără** `url`, restul cu.
   Un atașament nesemnabil e informație („există o poză, n-am putut să ți-o
   dau"), nu motiv să cadă tot răspunsul.

**Fără `download=<filename>`.** Opțiunea aia pune `Content-Disposition:
attachment`, ceea ce în browser e obligatoriu (`attachments.ts` o folosește
tocmai ca un `.svg` stocat să nu se execute pe originea Supabase). Aici
consumatorul e un client de linie de comandă care scrie octeții într-un fișier
cu numele din metadate — headerul nu schimbă nimic, deci nu-l cerem.

**TTL: o oră.** Clientul descarcă imediat. `src/data/attachments.ts` folosește 8
ore pentru un motiv care nu se aplică aici (URL nou = altă cheie de cache HTTP,
deci miniaturi redescărcate la fiecare deschidere); un CLI nu are galerie de
reafișat.

**De ce nu proxy prin funcția Pages:** octeții ar trece printr-un worker fără
motiv, iar `X-API-Key` nu devine mai sigur decât e. Ce trebuie spus deschis:
URL-ul semnat **ocolește RLS prin construcție**, fiindcă e semnat cu service
role. Cine are cheia de API vede pozele oricărui proiect — exact cum vede deja
tichetele oricărui proiect. Nu e o slăbire nouă, e aceeași poartă.

### 2. `ticket-kit`: comanda care aduce fișierele

```bash
node ai-client.mjs --attachments --id KATA-07 [--dir <path>]
```

- descarcă fiecare atașament în `<dir>/<ID>/` (implicit
  `.horizontal-attachments/`, adăugat la `.gitignore`);
- tipărește **o cale absolută pe linie**, precedată de tip și dimensiune, ca
  agentul să dea Read direct;
- tichet fără atașamente → `niciun atașament` și ieșire 0. Absența nu e eroare;
- `not_found` pe tichet inexistent, la fel ca `--get`;
- coliziune de nume în același folder (doi clienți, doi `Screenshot.png`) →
  sufix cu primele 8 caractere din id-ul atașamentului;
- atașament întors fără `url` → linie de avertisment pe stderr, celelalte se
  descarcă oricum, ieșire 0.

`--get` rămâne cum e: întoarce JSON-ul întreg, deci de acum și metadatele. Așa
află agentul că *există* poze fără să descarce nimic — pasul de descoperire e
separat de cel de descărcare.

**Nume de fișier de pe disc:** se folosește `filename` din metadate, curățat de
separatori de cale (`/`, `\`, `..`) — vine de la client, deci e input
neîncrezut, nu identitate.

### 3. Ghidul

Secțiune în `ticket-kit/CLAUDE.md`: când rezolvi un tichet, uită-te la
`attachments` și trage-le înainte să te apuci. Fără rândul ăsta, agentul nu află
că poate — la fel cum nu afla că `--create` acceptă `--desc` până la `c78cfc9`.

`ticket-kit/` are propriul `.git`; se sincronizează prin push pe
`horizontal-ticket-kit`, nu prin copiere de fișiere.

## Ce NU intră

- **Upload prin API.** Pozele le pune clientul din aplicație, acolo e locul lor.
- **Migrare de bază de date.** Tabelul, bucketul și politicile există.
- **Nimic în `src/`.** Deci **fără `npm run test:upgrade`**: service worker-ul,
  `src/pwa.ts` și blocul VitePWA nu sunt atinse.
- **Miniaturi, conversii, redimensionări la citire.** Octeții s-au micșorat deja
  la upload (`src/lib/shrinkImage.ts`).

## Teste

În repo-ul Horizontal, unde există vitest:

- `functions/api/tickets/[id].test.ts` — maparea rând-DB → payload, ca funcție
  pură exportată (același tipar ca `buildIssueUpdate`): nume de câmpuri,
  `contentType` din `content_type`, prefixarea URL-ului relativ, atașament fără
  `url` când semnarea a eșuat, `[]` la tichet fără poze.
- Un test că un tichet fără atașamente nu cere semnare deloc: zero căi ⇒ zero
  apeluri la Storage, `attachments: []` întors direct.

În `ticket-kit` **nu există runner de teste** și nu se adaugă unul: kitul e
portabil și n-are decât `ai-client.mjs` și `seed.mjs`. Logica riscantă de acolo
(numele de pe disc, coliziunile) stă într-o funcție mică și pură, iar comanda se
verifică pe un tichet real cu o poză pusă din aplicație — verificare manuală
declarată ca atare, nu presupusă.

## Ordinea livrării

1. Endpoint + teste. Rulează `npm test` și `npm run typecheck`.
2. Push (= publicare — `functions/api` se deployează cu Pages).
3. `--attachments` în ticket-kit, verificat pe un tichet real cu poză.
4. Ghidul + push în repo-ul ticket-kit.

Pasul 3 depinde de pasul 2: până nu e endpoint-ul în producție, comanda n-are ce
consuma.
