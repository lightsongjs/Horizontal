# Quick add nativ (fereastra mică de pe telefon) — design

2026-10-06. Continuă `2026-10-06-widget-android-design.md`. Design tehnic propus
de un agent de arhitectură după citirea codului; deciziile de produs sunt ale
omului.

## Ce vrea omul (decizii de produs)

- Butonul 1×1 și [+] din widget-ul de agendă deschid o **fereastră mică nativă**
  peste ecranul de start (ca TickTick), instant, cu tastatura sus — NU aplicația.
- Ce are bara de captură de pe Linux (Ctrl+Shift+A): titlu cu recunoașterea
  datei, **evidențiere + refuz la atingere**, `#proiect @persoană !`, descriere,
  jetoane dată / proiect / persoană / urgent / **atașament** (poză sau fișier),
  Trimite. Proiect implicit **mereu ✅Daily**; fără dată → azi; mementoul
  implicit ca în aplicație.
- Merge offline: sarcina stă în coada telefonului și apare imediat în widget.
  Atașamentele offline sunt refuzate pe față (ca în aplicație).
- După Trimite fereastra se închide.

## Decizii tehnice

**Recunoașterea rulează codul paginii**, nu o copie: `androidx.javascriptengine`
(proba pe Redmi: conectare 105–115 ms o dată, apoi 2–6 ms pe apel, fus corect).
Cere `minSdk 26` (era 24).

1. **O singură funcție pură pentru pagină și fereastră:** `computeDraft` în
   `src/lib/quickDraft.ts` (liveRejections → maskRejected → parseDue →
   stripSpans → parseCaptureTokens → proiectul → resolveDraft). `useTitleDate` /
   `useQuickDraft` o folosesc; un test `?raw` cere asta.
2. **Pachetul:** `src/capture/engine.ts` → esbuild IIFE (`HzCapture`) în
   `mobile/android/app/src/main/assets/capture-engine.js` (gitignorat, făcut de
   `npm run android:apk`). Un test vitest rulează pachetul construit în
   `node:vm` pe aceleași fixtures ca `computeDraft`.
   *Simplificare față de agent:* fără reîmprospătarea pachetului de pe site în v1
   — o schimbare de parser ajunge în fereastră cu următorul APK. Cost: o
   diferență temporară între aplicație și fereastră după o schimbare de parser.
3. **Motorul** (`CaptureEngine.kt`) pornește în `onCreate` al ferestrei, în paralel
   cu tastatura; rezultatele vechi (după număr de secvență) se aruncă. Cade (nu e
   suportat, moare, >500 ms) → **mod brut**: titlul = textul, jetoanele merg,
   Daily + azi; o linie discretă „recunoașterea datei indisponibilă”. Nu
   deschide niciodată aplicația.
4. **Fereastra:** `QuickAddActivity` (AppCompat, `taskAffinity` propriu,
   `excludeFromRecents`, `adjustResize`, temă translucidă), tastatura arătată în
   `onWindowFocusChanged`. Evidențiere prin span-uri; atingerea pe un span îl
   refuză. Dată: `DatePickerDialog` + `TimePickerDialog`; proiect/persoană:
   liste; urgent: comutator; agrafă: „Fă o poză” / „Alege fișier”. Ciorna supraviețuiește morții
   procesului cât camera e deschisă (`onSaveInstanceState`).
5. **Datele:** API 3 `setCaptureData({projects, assignees, readAt})`, împinse de
   pagină (proiectele în care se poate scrie). Fără date → fereastra spune
   „Deschide aplicația o dată”.
6. **Crearea, coadă separată** (`NativeCreate` în `PlanStore.creates`, nu în coada
   de acțiuni — o pagină veche ar fi putut-o „prelua”). `DrainWorker` trimite
   întâi creările:
   - ID-ul (`nextIssueId`, ca pagina) se calculează și se **salvează înainte de
     POST** (`attemptId`) — o retrimitere după o eroare de rețea folosește același
     ID, deci nu poate dubla sarcina;
   - 409/23505: dacă rândul cu acel ID e al nostru (creat de noi, același titlu)
     → gata; altfel ID nou, max 5;
   - alt refuz: iese din coadă + notificare „Sarcina „X” n-a putut fi salvată”;
   - după succes: ID provizoriu → real în coadă, `fired`/`shown`, apoi
     `changed` către pagină, `SyncWorker.now`.
   Sarcina apare imediat în agendă (și mementoul ei sună) până o agendă citită
   după trimitere o conține.
   **Pagina:** `createIssue` reîncearcă cu un ID nou la 23505 (max 3) — azi
   pierde sarcina dacă telefonul a luat același număr.
7. **Atașamente:** copiate și micșorate la alegere (aceleași reguli ca pagina,
   din pachetul JS); urcate după creare de `DrainWorker` pe o cale fixă (o
   retrimitere nu dublează), apoi rândul din `attachments` cu ID fix. Offline la
   Trimite → refuz, fereastra rămâne. Reîncercări max 1 h.
8. `versionCode 5`, `API 3`, `Widgets.quick()` → `QuickAddActivity`.

## Teste

JUnit (`core/`): `nextIssueId` (fixtures comune cu TS), corpul insertului, tabelul
409, remaparea, modul brut, agenda cu creările. vitest: `computeDraft`, pachetul
în `vm`, garda `?raw`, reîncercarea 23505. Pe telefon: deschidere <300 ms cu
tastatura, evidențiere + refuz, offline → apare în widget și pleacă la revenire,
aplicație omorâtă în timpul POST → fără dublură, poză, atașament offline refuzat,
mod brut.
