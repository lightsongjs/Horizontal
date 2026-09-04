# Atașamentele tichetelor, prin API

**Data:** 2026-09-04

## Problema

Clientul deschide aplicația de pe telefon, scrie un tichet și pune un print
screen. Mai târziu, Claude ia tichetul și îl rezolvă: descrierea o primește
(`GET /api/tickets/{id}` întoarce `desc`), dar **poza nu ajunge nicăieri**.
Jumătate din ce a comunicat clientul se pierde exact la pasul unde contează, și
de multe ori poza e partea neambiguă a raportului.

Atașamentele există în aplicație din `2026-08-12-attachments-design.md`:
metadatele în tabelul `attachments`, octeții în bucketul privat cu același nume.
Doar că drumul spre ele trece prin RLS și prin sesiunea din browser, iar API-ul
din `functions/api/` nu le pomenea.

## Soluția

Un câmp în plus în răspunsul existent. Niciun endpoint nou, nicio comandă nouă.

```json
"attachments": [
  {
    "id": "9f3c…",
    "filename": "eroare-login.png",
    "contentType": "image/png",
    "size": 84213,
    "createdAt": "2026-09-03T18:22:04.113Z",
    "url": "https://<ref>.supabase.co/storage/v1/object/sign/attachments/…?token=…"
  }
]
```

Agentul vede URL-ul, descarcă poza unde vrea el, o citește. Unde o salvează nu e
treaba API-ului — de-aia nu există nici director convenit, nici comandă de
descărcare în `ticket-kit`.

Tichet fără atașamente → `[]`. Nu câmp lipsă, nu `null`: consumatorul iterează
fără gardă, iar prezența câmpului îi spune că serverul e cel nou.

## Cele trei lucruri care se pot strica

1. **`signedURL` vine relativ** (`/object/sign/attachments/...?token=...`) și
   trebuie prefixat cu `${SUPABASE_URL}/storage/v1`. Asta face și supabase-js pe
   dinăuntru. E singura parte care s-ar strica silențios, deci are test.
2. **Semnarea se cere într-un singur apel** (`POST /storage/v1/object/sign/attachments`
   cu `{expiresIn, paths}`), nu unul per fișier. Zero atașamente ⇒ zero apeluri
   la Storage.
3. **Un fișier nesemnabil se întoarce fără `url`, nu deloc** — „există o poză,
   n-am putut să ți-o dau" e informație, iar vecinii lui rămân buni. La fel,
   semnarea căzută în bloc nu strică tichetul: pleacă doar metadatele.

TTL 8 ore, ca `SIGNED_TTL_SECONDS` din `src/data/attachments.ts`.

Fără `download=<filename>`: în browser opțiunea e obligatorie (un `.svg` stocat
nu trebuie să se execute pe originea Supabase), dar aici consumatorul scrie
octeții într-un fișier și headerul nu schimbă nimic.

## Ce trebuie spus deschis

URL-ul e semnat cu service role, deci **ocolește RLS prin construcție**. Cine are
`X-API-Key` vede pozele oricărui proiect — exact cum vede deja tichetele oricărui
proiect. Nu e o poartă nouă, e aceeași poartă.

## Ce NU intră

- **Upload prin API.** Pozele le pune omul din aplicație, acolo e locul lor.
- **Migrare.** Tabelul, bucketul și politicile există deja.
- **Nimic în `src/`** — deci fără `npm run test:upgrade`: service worker-ul,
  `src/pwa.ts` și blocul VitePWA nu sunt atinse.

## Cod

- `functions/api/tickets/[id].ts` — `attachmentsPayload()` e pură și exportată
  (același tipar ca `buildIssueUpdate`), handler-ul doar aduce rândurile și cere
  semnarea.
- `functions/api/tickets/[id].test.ts` — maparea, prefixul, fișierul nesemnat,
  lista goală; plus, pe handler: un singur apel de semnare, zero apeluri la
  Storage fără atașamente, tichetul întors întreg când semnarea cade, `db_error`
  când interogarea de atașamente cade.
- `ticket-kit/CLAUDE.md` — rândul fără care agentul nu află că poate.
