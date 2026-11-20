# Viteza deschiderii unui tichet

> 2026-11-20, sarcina de la Jarvis: „deschiderea unui tichet trebuie să fie
> instantanee (sub ~100 ms de la atingere până vezi tichetul complet)”.
> Trei commituri locale, **nepublicate** (push = producție, decide Ionuț):
> `ba798e6`, `7ecd765`, `b230b79`.

## Cum s-a măsurat

`npm run perf:open -- [eticheta] [phone|desktop|both] [rulări]`
(`scripts/perf-open/`). Aplicația reală, build de producție, pe backendul local
învelit în stratul offline (IndexedDB, ca pe Supabase), cu latența de rețea
injectată din cereri reale către producție (doar citiri, făcute o dată):
o cerere mică ~80–140 ms, `listIssues` pentru MS (241 tichete) ~370–440 ms și
**725 KB**. Date sintetice cu aceleași mărimi (MS 241 / ~620 KB, Inbox 178,
KATA 117), 6 sarcini pe azi în fiecare, cu fir. O sesiune anterioară a deschis
deja proiectele (baza locală plină — omul care folosește aplicația zilnic).

- **Telefon**: 390×844, touch, CPU 4× mai lent, ~4G (150 ms RTT, ~6 Mbps).
- **Desktop**: 1440×900, CPU normal, 100 ms RTT — „Listă” și „Azi” dochează
  tichetul în panoul lateral.

„Complet” = foaia e pe ecran **cu descrierea în editor** (CodeMirror), măsurat
în pagină de la evenimentul `click` până la primul cadru care o are.
„Liniștit” = ultima schimbare din foaie (rândul firului etc.). Mediane din 3.

## Înainte / după (ms)

### Telefon

| Deschidere | Înainte | #1 | #2 | #3 (final) | Liniștit înainte → după |
|---|---:|---:|---:|---:|---|
| „Azi” → MS, prima | **1329** | 241 | 152 | **156** | 1380 → 177 |
| „Azi” → MS, a doua | **1142** | 63 | 63 | **59** | 1291 → 72 |
| „Azi” → KATA | 683 | 64 | 60 | **63** | 833 → 76 |
| „Azi” → Inbox | 917 | 59 | 63 | **64** | 1066 → 79 |
| „Azi”, atingere la 0,5 s după pornire | 1338 | 271 | 268 | 281 | 1402 → 296 |
| lista Inbox, prima | 218 | 233 | 152 | **149** | 288 → 172 |
| lista Inbox, a doua | 67 | 74 | 71 | **60** | 88 → 81 |
| lista MS, prima | 221 | 233 | 149 | **152** | 298 → 173 |
| lista MS, a doua | 76 | 70 | 74 | **68** | 101 → 95 |

### Desktop

| Deschidere | Înainte | #1 | #2 | #3 (final) |
|---|---:|---:|---:|---:|
| „Azi” → MS, prima | 341 | 114 | 95 | **90** |
| „Azi” → MS, a doua | 285 | 32 | 33 | **34** |
| „Azi” → KATA / Inbox | 244 / 245 | 45 / 44 | 42 / 45 | **45 / 43** |
| lista Inbox / MS, prima | 80 / 83 | 78 / 85 | 43 / 49 | **44 / 47** |
| lista Inbox / MS, a doua | 25 / 27 | 23 / 26 | 26 / 31 | **22 / 28** |

**Saltul descrierii** (tichet cu fir): telefon 79 px, desktop 50 px înainte;
după #3, desktop 0, telefon 19 px — vezi „Ce n-am făcut”.

## Ce s-a găsit (ipotezele, confirmate sau nu)

1. **Confirmat, cel mai mare: deschiderea din „Azi” aștepta tot proiectul din
   rețea — la FIECARE deschidere.** `resolveTicketUrl` → `selectProject` →
   rezolvitorul de deep link așteaptă `issuesLoadedFor` (lista autoritară: 6
   cereri, ~620 KB pentru MS). Închiderea foii pe „Azi” trece prin
   `openScreen` → `selectProject(null)`, deci a doua deschidere reîncărca
   proiectul de la zero. Cadrul din baza locală sosea în câteva zeci de ms,
   dar nu conta: nu era „autoritar”.
2. **Parțial: CodeMirror.** Chunk-ul se preîncărca deja (1,5 s după pornire),
   dar primul `EditorView` din sesiune costa ~100 ms (telefon) și `React.lazy`
   mai suspenda un cadru cu modulul deja adus — primul tichet își arăta
   descrierea după restul foii.
3. **Confirmat: rândul firului și miniaturile împingeau descrierea în jos.**
   Stau DEASUPRA ei (telefon și formular) și soseau după o rundă la server.
   `refresh()` (orice revenire în tab după 30 s) golea rezumatele, deci saltul
   revenea. În producție: din 45 de sarcini „de azi”, 3 au fir și 8 au fișiere.
4. **Infirmat: re-randarea listei la deschidere.** Long task-ul de la
   deschidere e chiar randarea foii (~60 ms pe telefon la a doua, ~150 ms la
   prima, când se compilează codul foii); `TaskRow`/`memo` își fac treaba.

## Ce s-a schimbat

- **#1 `ba798e6` — `planOpen`** (`src/lib/openEarly.ts`, folosit în `App.tsx`).
  Telefonul deschide foaia la atingere (`EditSheet` citește sarcina din
  `dueIssues`/`openIssues` și se rebazează din store); formularul docat se
  deschide din primul cadru care are tichetul (memorie sau baza locală) și se
  remontează singur pe datele noi (`formPrint` din `SplitView`). Proiectul se
  încarcă tot, dar în spate. Verdictul „nu mai există” rămâne doar pe lista
  autoritară. `ui.canDock` spune dacă formularul ar sta în panou.
- **#2 `7ecd765` — editorul cald.** După preîncărcare, în idle, un editor
  ascuns se montează o dată peste un text cu toate decorările, apoi pleacă; cu
  modulul în mână, `DescField` folosește editorul direct (ales o dată pe câmp).
- **#3 `b230b79` — fără salt.** `usePrefetchSheets` (`src/data/sheetPrefetch.ts`):
  listele cer în idle, în lot, rezumatele firului (`repository.threadSummaries`,
  2 cereri) și fișierele + URL-urile miniaturilor (`prefetchAttachments`, 1+1
  cereri) pentru primele 60 de rânduri. Rezumatele nu se mai șterg la
  invalidare (stale-while-revalidate, doar pentru rând; offline pleacă, ca
  înainte); lista de fișiere a unui tichet se ține în memorie și se
  reîmprospătează pe loc.

Verificat după fiecare: `npm run typecheck`, `npm test` (2134), `npm run test:nav`.

## Ce n-am făcut, și de ce

- **Fișierele în lot n-au fost măsurate în browser**: backendul local n-are
  atașamente, deci drumul ăla e acoperit doar de typecheck și de citirea
  codului. De verificat pe producție, pe un tichet cu poze.
- **Modalul de desktop (fereastră între 900 și 1200 px) așteaptă ca înainte**:
  formularul modal își copiază câmpurile la montare și nu se remontează, deci
  deschis dintr-un cadru vechi al bazei locale ar fi salvat valori vechi.
- **Proiectul se descarcă tot la fiecare deschidere din „Azi”** (în spate, nu
  mai blochează). Pe telefon, pentru MS: ~600 KB și un long task la sosire.
  Ar putea rămâne în memorie câteva minute — e o alegere între prospețime și
  date mobile (întrebarea 2).
- **Atingerea în primele ~1,5 s după pornire** (~270 ms): editorul nu e încă
  adus. Preîncărcarea mai devreme ar concura cu primul cadru.
- **Prima deschidere din sesiune pe telefon, ~150 ms**: e randarea foii cu
  cod încă necompilat de motorul JS; a doua e ~60 ms. N-am încălzit și foaia.
- **19 px în primul cadru pe telefon**: foaia își mută conținutul o dată, în
  cadrul de după montare (preexistent, apare și înainte). Cade în primul cadru
  al animației de intrare (opacitate ≈ 0), deci nu se vede.
- **Nicio măsurătoare pe telefonul real** și niciuna în browser pe Supabase
  (n-am cont de test); rețeaua e simulată din timpi reali.

## Întrebări pentru Ionuț

1. Un tichet deschis **din afara unei liste** (notificare, link) cu fir sau
   fișiere poate încă sări la prima deschidere. Mutăm rândul firului și
   miniaturile **sub** descriere pe telefon, sau rămâne cum e?
2. Proiectul unei sarcini din „Azi” să rămână în memorie (fără redescărcare)
   câteva minute după închiderea foii? Mai puține date mobile, dar o sarcină
   editată pe laptop între timp s-ar vedea abia la următoarea reîmprospătare.
3. Folosești vreodată fereastra de desktop îngustă (900–1200 px), unde
   tichetul se deschide ca modal? Acolo „Azi” e încă ~250 ms.
4. Verifici pe telefon înainte de push? Ce să încerci: „Azi” → o sarcină,
   închide, alta; un tichet cu poze; un tichet cu comentarii după ce revii în
   aplicație.
