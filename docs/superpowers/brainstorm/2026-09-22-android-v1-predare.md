# Android v1 — notă de predare pentru un chat nou (2026-09-22)

Scop: să se poată relua discuția de la zero, fără contextul chatului în care s-a
scris asta.

## Citește întâi, în ordine

1. `docs/superpowers/brainstorm/2026-08-25-clienti-nativi.md` — analiza mare
   (Linux + Android). Secțiunile 4 și 5 sunt cele despre Android. Concluzia ei:
   **Capacitor**, fiindcă refolosește ~11.000 de linii de interfață și
   `src/lib/` se *importă*, nu se portează.
2. `CLAUDE.md`, secțiunile „Mod To-Do", „Pașii de setup pentru notificări (web
   push)" și „Service worker-ul e scris de mână".
3. `src/lib/pushPayload.ts` — contractul de notificare (titlu, corp, `tag`, cele
   două acțiuni, `SNOOZE_MINUTES = 5`). Android v1 trebuie să producă **aceeași**
   notificare, chemând aceeași funcție.

## Ce s-a verificat pe 2026-09-20 (nu presupune, e măsurat)

- **Pasul 0 din planul vechi e făcut integral**: token HMAC + `reminder-action`
  pentru acțiuni fără filă deschisă, `urgency:'high'` + `TTL:3600` în
  `send-reminders`, `renotify`+`tag` în `src/sw.ts`, snooze 5 min.
- **Pașii 1–4 sunt neîncepuți.** Realtime tot zero (`grep "\.channel(" src/`).
- **Nu există niciun toolchain Android pe mașina de dezvoltare**: fără `javac`,
  `gradle`, `adb`, fără SDK, `ANDROID_HOME` gol. Doar `java` (runtime, OpenJDK 25),
  plus `podman` și `docker`. Primul pas real e instalarea SDK-ului, nu cod.
- **Distribuția e sideload, decis**: doar pentru utilizator, APK instalat manual.
  Asta deblochează `USE_EXACT_ALARM`, care în Play ar fi respins pentru o
  aplicație de to-do.
- **Recurențele nu se reimplementează în client.** Saltul e un trigger Postgres
  (`issues_zz_advance_recurrence`), deci orice scriere `done=true` prin REST îl
  declanșează — inclusiv dintr-o aplicație nativă.

## v1 — cât mai mic, deliberat

Două obiective, și amândouă sunt lucruri pe care PWA-ul **nu** le poate face:

1. **Mementoul sună la secundă**, chiar dacă telefonul a dormit. Doze și
   managerele de baterie întârzie push-ul cu ore, iar niciun header nu repară
   asta — `USE_EXACT_ALARM` e singura garanție, și e disponibilă doar la sideload.
2. **Merge offline, deci se deschide instant.** Azi fiecare ecran așteaptă un
   drum până la Supabase. Cu datele locale, aplicația e rapidă pentru că nu
   așteaptă nimic — viteza e un efect secundar al lui offline, nu un obiectiv
   separat.

În v1 intră:

- `npx cap init` peste `dist/` — aceeași interfață, același cod, fără rescrieri.
- `@capacitor/local-notifications`, cu cele două acțiuni pe care le avem deja
  („Gata", „Amână 5 min"), construite din `pushPayload.ts`.
- `USE_EXACT_ALARM` în manifest; `POST_NOTIFICATIONS` cerut **din butonul
  „Activează"**, niciodată la pornire — regula pe care `PushToggle.tsx` o
  respectă deja pe web.
- Stratul offline (mai jos).
- Un APK semnat, instalat manual.

### Offline — unde se pune, și cât costă onest

**Cusătura există deja.** `src/data/repository.ts` definește o interfață
`Repository`, iar `localRepository.ts` (555 linii, localStorage) și
`supabaseRepository.ts` (725 linii, rețea) sunt două implementări ale ei.
Offline-ul e **a treia implementare**, nu o rescriere a aplicației: nicio
componentă nu știe pe care o folosește.

Dar e cea mai mare piesă din v1, și merită spus limpede: o cache de citire e
ieftină, o coadă de scrieri nu. Scrierile offline aduc remaparea id-urilor
(`createIssue` întoarce un `Issue` cu id de la server — offline nu ai de unde),
ordinea de reluare, și conflictele cu ce s-a schimbat între timp pe alt
dispozitiv. Brainstormul din august excludea explicit coada de scrieri din v1;
cerința s-a schimbat de atunci, deci propunerea de mai jos e **de confirmat în
chatul nou**, nu o decizie luată.

Propunerea: **taie coada în două.**

- **Citirile: cache completă.** Un instantaneu local al ultimei încărcări.
  Aplicația randează din el imediat și cere datele proaspete în fundal — exact
  tiparul pe care `refresh()` îl are deja (`refreshing`, nu `loading`; vezi
  „Reîmprospătarea datelor" din `CLAUDE.md`). Asta singură dă toată senzația de
  viteză, și face aplicația **citibilă** fără rețea.
- **Scrierile: doar mutațiile care nu inventează id-uri.** Bifarea `done`,
  amânarea (`remind_at`), editarea unui tichet existent. Toate sunt `update` pe
  un id care există deja, deci coada e o listă de patch-uri rejucate în ordine —
  fără remapare, fără invenție. `store.tsx` serializează deja scrierile per
  tichet prin `enqueueWrite`, deci există unde se lega.
- **Crearea offline rămâne pe dinafară în v1.** E singura care cere id-uri
  provizorii, și e și cea mai rară: creezi o sarcină de obicei când ai semnal.

Dacă la revizuire pare prea mult chiar și așa, versiunea și mai mică e „doar
cache de citire, scrierile cer rețea" — tot se deschide instant, tot se citește
în metrou, doar că bifatul așteaptă semnal.

În v1 **nu** intră, și e în regulă:

- Notificări persistente în bara de sus, swipe pentru reorganizare, widget pe
  ecranul de start. Sunt cerințe reale ale utilizatorului, dar de v2 — vezi mai jos.
- Plugin Kotlin propriu pentru acțiuni headless. Fără el, „Gata" din notificare
  pornește WebView-ul: o întârziere vizibilă, nu o eroare. Se adaugă când
  deranjează.
- FCM. Cu alarme locale, v1 n-are nevoie de push de la server. Reține totuși:
  **Web Push nu funcționează într-un WebView Capacitor**, deci dacă vreodată se
  vrea push pe Android, se adaugă FCM pe server — nu se refolosește ce e acum.
- Crearea de tichete offline, Realtime, Play Store.

## Ce trebuie lămurit în chatul nou (nu are răspuns azi)

1. **„Să rămână în bara de sus"** — probabil o notificare `ongoing`, poate cu un
   rezumat al zilei. De decis ce scrie în ea și dacă e una singură sau una per
   sarcină.
2. **„Swipe ca să le reorganizăm"** — **de verificat înainte de orice design**:
   pe Android, swipe-ul pe o notificare o respinge; nu există reordonare de către
   utilizator în sertar, ordinea o dă sistemul. Dacă e așa, cerința se mută
   într-un ecran al aplicației sau într-un widget, nu în sertar. Nu construi
   nimic pe presupunerea că sertarul e reordonabil.
3. Ce se întâmplă cu sarcinile fără scadență — v1 nu le atinge deloc.

## Prima comandă din chatul nou

Nu cod. Toolchain:

```bash
# SDK Android fără Android Studio (cmdline-tools), plus un JDK cu javac
sudo dnf install -y java-25-openjdk-devel
```

Apoi `sdkmanager`, `platform-tools` (pentru `adb`), și abia după aceea
`npm i @capacitor/core @capacitor/cli && npx cap init`.

## Starea repo-ului la predare

`master`, curat în afară de `.claude/`, `.vscode/`, `ticket-kit/*` netrimise și
câteva scripturi (`w.mjs`, `scripts/create-issues.mjs`). Ultimul commit:
`2daffba docs(panou): cheia poartă și scadența`.
