# Google Calendar

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Google Calendar (etapa 1: doar citire)

Evenimentele conturilor Google legate apar în „Azi" și „7 zile"
(NU în ecranul unui filtru și NU în numerele din sertar), amestecate pe oră
printre sarcini, și sună de două ori: cu 10 minute înainte și la start. Pașii
omului (proiect GCP, client OAuth, secrete): `docs/google-calendar-setup.md`.
Fără `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, Integrări spune „neconfigurat"
(`google-oauth` → `{action:'status'}`), iar cronul de sincronizare nu face nimic.

- **OAuth pe server** (`supabase/functions/google-oauth`, deploy cu
  `--no-verify-jwt`: callback-ul vine de la Google, fără sesiune). `start` și
  `disconnect` verifică JWT-ul cu `auth.getUser`; callback-ul verifică `state`
  semnat HMAC, legat de utilizator, 10 min (`_shared/oauthState.ts`). Întoarcerea
  e un 302 pe aplicație cu `?calendar=connected|error` — Supabase servește HTML-ul
  funcțiilor ca `text/plain`, deci nu există pagină „gata". `CalendarLanding`
  (`src/calendar.tsx`) citește parametrii LA ÎNCĂRCAREA MODULULUI, înainte ca
  `settleUrl` să rescrie bara. În cutiile Linux/Android adresa Google se
  deschide în browserul sistemului; tokenul ajunge oricum pe server.
- **Tokenurile nu ajung niciodată la client**: tabel separat `calendar_tokens`,
  RLS fără nicio politică + `revoke`, criptat AES-GCM cu `CALENDAR_TOKEN_KEY`
  (`_shared/secretBox.ts`). Nu Vault: Vault ține secrete de instanță, nu unul pe
  rând de utilizator. Clientul citește conturi/calendare/evenimente și poate
  scrie DOAR `calendar_calendars.enabled` (grant pe coloană).
- **Sincronizarea** (`calendar-sync`): pg_cron la 15 min (cheia de serviciu, toate
  conturile) + clientul la fiecare `refresh()` al store-ului (JWT, doar conturile
  lui, plafon 1/min pe server). Fereastră COMPLETĂ −1/+8 zile la fiecare rulare,
  NU `syncToken`: Google nu-l acceptă împreună cu `timeMin`/`timeMax`, iar
  fereastra alunecă. **Upsert, nu șterge-și-pune**: marcajele mementourilor
  (`pre_sent_at`, `start_sent_at`) trebuie să supraviețuiască rulărilor; triggerul
  `calendar_events_reset_sent` le golește doar când se mută `start_at`. Un calendar
  oprit își șterge evenimentele (trigger), pornirea cere o rundă forțată.
  `invalid_grant` → contul devine `reconnect` (arătat în Integrări); orice altă
  eroare e trecătoare.
- **Calendarul NU e în `Repository`** (`src/data/calendar.ts`): e o oglindă
  doar-de-citit, fără mod local. Cache-ul offline e în același IndexedDB
  (`cal:events`, `cal:accounts`), deci `sync.clear()` la logout îl golește.
  Contextul propriu (`src/calendar.tsx`) se reîmprospătează pe urmele
  `refreshing` din store — pragul rămâne unul singur (`refreshGate.ts`).
- **Logica pură**: `src/lib/calendarEvents.ts` (multi-zi cu „ziua 2/5", banda de
  toată ziua, amestecul cu sarcinile — fără oră sus, la egalitate evenimentul
  întâi —, estomparea, mementourile pentru Linux) și
  `supabase/functions/_shared/{eventReminders,calendarGoogle}.ts` (când sună,
  textul „Peste 10 min: …"/„Acum: …", maparea API-ului Google). `_shared` e
  importat și de client (`../../supabase/functions/_shared/…`), ca regula și
  textul să existe o singură dată pentru push, service worker și Linux.
- **Mementourile**: web push din `send-reminders` (destinatar = DOAR proprietarul
  calendarului; `kind:'event'`, fără token și fără butoane; `title` vine deja
  compus, ca un service worker vechi să arate textul corect). Linux: pagina pune
  evenimentele în aceeași listă (`upcomingEventReminders`, `kind:'event'`), cutia
  arată doar „Deschide" (din cutia reinstalată după 2026-10-10; una mai veche
  pune butoanele obișnuite, iar `NativeBridge` ignoră acțiunile pe id-uri `cal:`).
  Refuzate (`responseStatus = declined`) și de toată ziua nu sună.
- **Android NU primește încă evenimente** — deliberat. Planul nativ ar pune
  „Gata"/„Amână" pe ele, `DrainWorker` ar trimite un PATCH pe `issues?id=cal:…`,
  iar citirea nativă (`SyncWorker`, doar `issues`) ar rescrie lista paginii.
  Cere: un câmp `kind` în contractul `setReminders` (+ `API` nou), notificare fără
  acțiuni în Kotlin, citirea nativă a `calendar_events`, fixtures comune pentru
  textul evenimentului. Până atunci telefonul are web push-ul (dacă e abonat).
  Widget-ul de agendă nu arată evenimente (etapa 2).

Setup (făcut deja pe producție, 2026-10-10): `supabase secrets set
CALENDAR_TOKEN_KEY=$(openssl rand -hex 32) CALENDAR_STATE_SECRET=$(openssl rand -hex 32)`,
`supabase functions deploy google-oauth --no-verify-jwt`, `supabase functions
deploy calendar-sync`, `supabase functions deploy send-reminders`, apoi
`npm run migrate supabase/migration-calendar.sql` (tabelele + cronul).
