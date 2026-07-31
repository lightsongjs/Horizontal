# Mutarea unui tichet în alt proiect prin API

Data: 2026-07-31

## Problema

Am creat două proiecte și am început să scriu un tichet în cel greșit. Nu există
nicio cale — nici prin interfață, nici prin API — de a-l muta. Singura ieșire e
să-l ștergi și să-l rescrii.

`PATCH /api/tickets/:id` există deja și modifică `title`, `desc`, `theme`, `wave`,
`done`, `notes`, `selectors`, `scenarios`, `deps`. Lipsește exclusiv proiectul.

## Ce nu e trivial

Mutarea nu e un update de câmp, din cauza a trei lucruri din schemă:

1. **ID-ul conține prefixul proiectului** (`HZ-07`) și numerotarea e per-proiect.
   Un tichet mutat trebuie renumerotat, altfel ai prefix `HZ` într-un proiect `TK`.
2. **`issues.id` e PK referențiat de `dependencies`** cu `on delete cascade`, dar
   **fără** `on update cascade`. Redenumirea ID-ului cu rânduri care îl referențiază
   ar fi blocată de FK.
3. **`wave` și `theme` sunt per-proiect** — `waves` are PK `(project_id, number)`,
   `themes` are PK `(project_id, key)`. Valorile vechi pot să nu existe în țintă.

Singura tabelă care referențiază `issues.id` e `dependencies`. Nimic altceva.

## Decizii

| Decizie | Ce am ales | De ce |
|---|---|---|
| ID după mutare | **ID nou cu prefixul țintei** (`HZ-07` → `TK-12`) | Orice ID citit spune din ce proiect e. Linkul vechi moare — acceptat. |
| Dependențe | **Refuză mutarea dacă există deps**, în oricare sens | Nimic nu se pierde fără decizia utilizatorului. |
| Wave țintă | **`current_wave` al țintei**, override opțional prin `wave` | Aterizează unde se lucrează; validat că wave-ul există. |
| Theme | **`null`**, override opțional prin `theme` | Cheile de theme nu se potrivesc între proiecte. Fără magie tăcută. |
| Formă | **Același PATCH**, `projectId` e un câmp în plus | O cerere, o stare finală; validarea nu se duplică. |
| Mutare + `deps` | **Respins** (`400`) | Ar ocoli garda de deps și ar crea legături cross-project. |

Decizia despre deps face redenumirea simplă: fiindcă refuzăm când există
dependențe, `dependencies` n-are nicio referință la ID-ul vechi în momentul
redenumirii. Deci lipsa lui `on update cascade` nu ne atinge, și mutarea e un
singur `UPDATE`, nu o tranzacție multi-tabel.

## Contract

`PATCH /api/tickets/:id` acceptă în plus `projectId` (id-ul sau numele proiectului
țintă). Când e prezent, ordinea de execuție:

1. Rezolvă proiectul țintă după id sau nume → `404 project_not_found`.
2. Încarcă tichetul curent (`id`, `project_id`, `title`, `wave`) → `404 not_found`.
3. Dacă ținta e proiectul actual, mutarea e no-op: `projectId` se ignoră, restul
   câmpurilor se aplică normal, răspunsul nu conține `movedFrom`.
4. **Gardă deps:** interoghează `dependencies` pentru `issue_id=eq.:id` și
   `depends_on_id=eq.:id`. Orice rând → `409 has_dependencies` cu `dependsOn` și
   `dependedOnBy`.
4b. **Mutarea și `deps` nu se combină:** dacă body-ul conține și `projectId` (o
   mutare reală) și `deps`, → `400 cannot_move_and_set_deps`. Altfel garda de la
   pasul 4 ar trece (tichetul n-are deps încă) și cererea ar crea exact dependența
   cross-project pe care am respins-o. Setează deps într-un PATCH separat, după
   mutare.
5. Wave final = `body.wave ?? target.current_wave`. Validat că există în
   `waves(project_id=target, number=wave)` → `422 wave_not_in_target`.
6. Theme = `body.theme ?? null`. Dacă e non-null, validat în
   `themes(project_id=target, key=theme)` → `422 theme_not_in_target`.
7. ID nou = `<prefix_țintă>-NN`, unde `NN` e max+1 din tichetele țintei, pad 2.
8. Dup-check pe titlul final (`body.title ?? titlul curent`), filtrat pe
   **proiectul țintă** și wave-ul final → `409 duplicate_title` cu `existing_id`.
9. Un singur `PATCH issues?id=eq.:id` cu `{ id: newId, project_id, wave, theme,
   ...restul câmpurilor din body }`.
10. `200 { id: newId, movedFrom: oldId, updated: [...] }`.

Exemplu:

```
PATCH /api/tickets/HZ-07
{ "projectId": "ticket-kit", "title": "Titlu corectat" }

200 { "id": "TK-12", "movedFrom": "HZ-07", "updated": ["projectId","title"] }
```

```
PATCH /api/tickets/HZ-07
{ "projectId": "ticket-kit" }

409 { "error": "has_dependencies",
      "dependsOn": ["HZ-03"], "dependedOnBy": ["HZ-09"] }
```

## Risc acceptat

Calculul ID-ului nou e read-then-write: două mutări simultane în același proiect
pot ținti același număr. E exact riscul care există deja în `onRequestPost` din
`tickets.ts`. Nu îl agravăm și nu îl rezolvăm aici.

## Structura codului

`resolveProject`, `sbHeaders` și calculul următorului ID sunt acum duplicate sau
îngropate în `tickets.ts`. Le extragem în **`functions/api/_tickets-lib.ts`**,
importat de `tickets.ts` și `tickets/[id].ts`:

- `sbHeaders(key)` — headerele Supabase.
- `resolveProject(param, url, headers)` → `{ id, prefix, current_wave } | null`
  (câmpul `current_wave` e nou; îl are nevoie mutarea).
- `nextIssueId(projectId, prefix, url, headers)` → `string`.

Fără asta, `[id].ts` crește urât și logica de numerotare există în două versiuni.

## Bug adiacent, reparat aici

Dup-check-ul de titlu din `onRequestPatch` (`tickets/[id].ts:117`) filtrează după
`wave` dar **nu** după `project_id` — deci refuză un titlu care e duplicat în
orice alt proiect. `onRequestPost` filtrează corect. Mutarea are nevoie de un
dup-check corect pe proiectul țintă, deci îl reparăm în același loc.

## Teste

Testele existente din `functions/api/tickets/[id].test.ts` acoperă doar funcția
pură `buildIssueUpdate`; nu există niciun harness care să execute handler-ul.
Fără el, cei 10 pași ai contractului rămân neverificați. Introducem în fișierul
de teste un mock pentru `globalThis.fetch` care rutează pe fragmente de URL și
înregistrează cererile, plus un constructor de `context` fals. Nu adăugăm
dependențe noi — doar `vitest`, care e deja acolo.

Cazuri:

- mutare reușită → ID nou cu prefixul țintei, `movedFrom` prezent
- refuz când tichetul depinde de altul (`dependsOn` populat)
- refuz când altul depinde de el (`dependedOnBy` populat)
- wave implicit = `current_wave` al țintei
- `wave` explicit valid → aplicat; invalid → `422 wave_not_in_target`
- `theme` implicit `null`; `theme` explicit invalid → `422 theme_not_in_target`
- `projectId` = proiectul actual → no-op, fără `movedFrom`
- proiect țintă inexistent → `404 project_not_found`
- titlu duplicat în țintă → `409 duplicate_title`
- mutare + editare de câmpuri în aceeași cerere
- mutare + `deps` în aceeași cerere → `400 cannot_move_and_set_deps`
- dup-check-ul NU mai declanșează pe un titlu duplicat din alt proiect (regresie
  pentru bugul de mai sus)

## CLI (`ticket-kit/ai-client.mjs`)

Clientul e flag-based, deci mutarea intră pe `--update`, consistent cu decizia
„un singur PATCH":

```
node ai-client.mjs --update --id HZ-07 --project ticket-kit
node ai-client.mjs --update --id HZ-07 --project ticket-kit --wave 2
```

- `project` intră în body ca `projectId` și în `knownFields`.
- La `200` cu `movedFrom` → afișează `moved: HZ-07 -> TK-12`; altfel `updated: <id>`.
- `409` cu `error: "has_dependencies"` → afișează dependențele și iese cu cod 1.

Apoi `README.md` și `ticket-kit/CLAUDE.md`, urmate de commit + push pe
`horizontal-ticket-kit` conform regulii de sync.

## În afara scopului

Zero modificări de interfață. Se depun două tichete separate în proiectul
Horizontal:

1. Mutarea unui tichet din interfață — label cu proiectul sub note, click →
   dropdown cu proiectele, selecție → mutare.
2. Căutarea („O" / find) să caute și după numărul tichetului, nu doar după titlu.
