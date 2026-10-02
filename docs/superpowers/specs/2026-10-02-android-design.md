# Aplicația Horizontal pentru Android — design

**Data:** 2 octombrie 2026. **Precedent:** `docs/superpowers/brainstorm/2026-08-25-clienti-nativi.md`
(secțiunile 1 și 4: plafonul măsurat al web push-ului pe Android) și
`docs/superpowers/brainstorm/2026-09-22-android-v1-predare.md` (v1 = alarme exacte +
offline). **Depinde de:** `2026-10-02-offline-baza-locala-design.md` (livrat) și reia
puntea din `2026-10-02-aplicatie-linux-design.md` („pagina știe, cutia sună").

Etapa **3** din cinci. Widget-urile (etapa 4) rămân pe dinafară, la cererea omului.

## Întrebări pentru om

> **Răspuns (2026-10-02): toate patru ca în recomandare.** Butoanele sunt „Gata · 15 min ·
> Amână…”. „Mâine 9:00” mută și sarcina. Golul din v1 e acceptat. Sunetul e clopoțelul
> Horizontal, care respectă „Nu deranja” și nu ocupă tot ecranul. Fără widgeturi în v1.

1. **Ce butoane are notificarea?** Android arată cel mult trei. Recomandare:
   **„Gata · 15 min · Amână…"**. „15 min" e același ca pe Linux, ca un gest să se
   învețe o dată; „Amână…" deschide o foaie mică, fără să pornească aplicația, cu
   **5 min · 30 min · 1 oră · 3 ore · mâine 9:00 · altă oră…**.
2. **„Mâine 9:00" mută doar mementoul sau și sarcina?** Recomandare: **pe amândouă**.
   Scadența trece pe mâine (ora ei, dacă are una, rămâne aceeași), iar mementoul
   sună la 9:00. Dacă s-ar muta doar mementoul, mâine sarcina ar apărea roșie în
   „Azi", ca restanță, deși tocmai ai amânat-o cu bună știință. Opțiunile mai scurte
   de o zi mută numai mementoul, exact ca „Amână" de azi.
3. **E acceptabil, în prima versiune, ca un memento pus pe laptop cu mai puțin de
   ~15–30 de minute înainte să nu sune pe telefon dacă telefonul doarme?**
   Recomandare: **da**. Dacă problema apare în practică, o reparăm la pasul următor,
   cu o schimbare pe server (vezi „Sincronizarea"). Tot ce e programat cu timp
   înainte (deci aproape tot) sună la secundă. Laptopul sună oricum la timp, prin
   aplicația de Linux.
4. **Cum sună?** Recomandare: **clopoțelul Horizontal** (aceeași notă E5 ca în
   pagină), pe un canal propriu. Poate fi schimbat oricând din setările Android.
   **Respectă „Nu deranja"** și **nu ocupă tot ecranul** ca o alarmă de ceas. Un
   memento care te trezește noaptea sau îți acoperă ecranul te învață să-l ignori.

## Scopul

Pentru un singur lucru, care pe web nu se poate: **mementoul sună pe telefon la
secundă, chiar dacă telefonul a dormit**, iar amânarea din notificare are mai multe
variante. Web push-ul trece prin Doze și prin managerele de baterie ale
producătorilor, și întârzie uneori cu ore (măsurat în brainstormul din august).
Singura garanție reală e o **alarmă exactă**, pusă local, pe telefon.

Singurul utilizator e proprietarul.

## Ce dă Android în plus față de web push

| Ce | Pe web | Pe Android, nativ | Folosim? |
|---|---|---|---|
| Alarme exacte (`AlarmManager.setExactAndAllowWhileIdle`) | nu există (`showTrigger` n-a ieșit din origin trial) | sună în Doze, fără rețea | **Da**, e motivul aplicației |
| `USE_EXACT_ALARM` (API 33+) | — | acordată la instalare, utilizatorul n-o poate retrage | **Da**, cu sideload (vezi Play) |
| `SCHEDULE_EXACT_ALARM` | — | pe 14+ e refuzată implicit; se acordă din „Alarme și mementouri" | doar pentru Android 12 (`maxSdkVersion="32"`) |
| Trei butoane pe notificare | Chrome arată două | trei, plus o activitate deschisă direct din buton | **Da** |
| Canal cu sunet propriu | imposibil (`Notification.sound` n-a fost implementat de niciun browser) | `NotificationChannel` cu un fișier `raw/` | **Da** |
| Reprogramare după repornire (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET`, `TIMEZONE_CHANGED`) | — | alarmele se pierd la repornire și trebuie puse din nou | **Da**, obligatoriu |
| Full-screen intent (preia ecranul, ca un ceas deșteptător) | — | pe Play, din Android 14, e doar pentru apeluri și alarme de ceas | **Nu** (întrebarea 4) |
| Scutire de optimizarea bateriei | — | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | **Nu se cere**. Alarmele exacte nu depind de ea. Ecranul de verificare doar arată starea. |

**Ce face Doze:** alarmele `…AllowWhileIdle` sună și în Doze, dar Android le
limitează la ~una la 9 minute pentru aceeași aplicație, iar **rețeaua rămâne
oprită** în Doze, inclusiv în secundele de după alarmă. Consecințe: mementourile din
același minut se grupează într-o singură alarmă, care arată mai multe notificări;
iar alarma **nu se bazează pe rețea**, ci decide doar din datele locale.

**Ce permite Play** pentru o aplicație de to-do: `USE_EXACT_ALARM` e rezervată
ceasurilor deșteptătoare și calendarelor, iar un to-do e respins sau la limită.
Varianta acceptată e `SCHEDULE_EXACT_ALARM`, pe care omul o acordă manual din
setări. Full-screen intent și scutirea de baterie cer și ele declarații pe care un
to-do nu le trece. **În afara Play, politica Play nu se aplică.** De-aia distribuția
e sideload (mai jos).

## Decizia 1: Capacitor, iar WebView-ul încarcă site-ul publicat

**Alegerea:** o cutie Capacitor al cărei WebView încarcă
`https://horizontal-dyx.pages.dev` (`server.url`), plus un plugin Kotlin propriu,
`HorizontalAndroid`, pentru alarme, notificări și acțiuni. Interfața rămâne cea de
azi, fără nicio linie rescrisă.

**De ce:** e decizia din Linux, cu același motiv. Un push pe `master` ajunge pe
telefon prin `src/pwa.ts` și service worker, fără APK nou. Stratul offline
(IndexedDB, coada, `HZ-·`) merge la fel în WebView, fiindcă e tot Chromium.
`src/lib/` se importă, nu se portează.

**Respinse:**
- **TWA:** e Chrome, deci aceleași limite ca web push-ul. N-are alarme.
- **Kotlin nativ sau Flutter:** rescrierea a ~11.000 de linii de interfață, 25–40
  de zile.
- **React Native:** Notifee e arhivat.
- **`@capacitor/local-notifications`:** handlerul lui de acțiuni nu e headless
  („Gata" pornește WebView-ul), nu oferă `setExactAndAllowWhileIdle` sub controlul
  nostru și nu repune alarmele cum vrem noi. Pluginul propriu are ~800–1.200 de linii
  Kotlin și înlocuiește tot ce ar fi dat el.

**Costul dacă e greșită:** Capacitor tratează `server.url` ca opțiune de dezvoltare,
nu de producție. Dacă puntea nu se injectează sigur în pagina de la distanță, varianta
de rezervă e `dist/` împachetat în APK. Puntea și pluginul rămân aceleași, dar se
pierde update-ul automat: fiecare push pe `master` ar cere un APK nou. Se verifică în
prima zi, înainte de orice altceva (Etapa 0).

**Unde stă:** `mobile/`, cu propriul `package.json` (`@capacitor/cli`,
`@capacitor/android`), `capacitor.config.ts` și proiectul `mobile/android/`. Folderul
e fratele lui `desktop/`. În Cloudflare Pages, „build watch paths" exclude
`mobile/**`. Pagina **nu** ia `@capacitor/core` ca dependință: citește
`window.Capacitor.Plugins.HorizontalAndroid` printr-un tip mic, ca build-ul site-ului
să rămână neatins. Lucrul se face pe ramură, nu pe `master`.

## Decizia 2: două surse pentru alarme, fără vreun al doilea creier

Problema: pe Linux pagina e rezidentă. Pe Android, WebView-ul trăiește doar cât e
deschisă aplicația. Captura principală se face din bara de pe laptop, deci telefonul
trebuie să afle de un memento nou **fără să fi fost deschis**.

### Sursa 1 — pagina, când rulează (calea principală)

E puntea de pe Linux, cu aceeași formă. `<DesktopBridge />` din `src/` (de
redenumit în `<NativeBridge />` când există amândouă) găsește adaptorul Android,
calculează mementourile cu `upcomingReminders()` și le trimite cu `setReminders(list)`.
Textul fiecărui memento vine din `planNotification` (`src/lib/pushPayload.ts`). Lista
**înlocuiește integral** ce era: tichetele bifate, amânate sau șterse dispar, iar cele
cu ID provizoriu se înlocuiesc după remapare, fiindcă `key = id@at`.

Pentru Android se schimbă doar doi parametri:
- **orizontul:** 7 zile, nu 24 h, cu un plafon de 100 de mementouri, ca un telefon
  nedeschis câteva zile să aibă tot planul;
- **`heldIds`:** id-urile cu scrieri încă în coada offline. Pentru ele, sincronizarea
  nativă (sursa 2) nu are voie să suprascrie ce a spus pagina. Fără regula asta, o
  bifare offline netrimisă ar fi „înviată" de serverul care încă n-a aflat de ea.

### Sursa 2 — sincronizarea nativă, când pagina nu rulează

Kotlin face o citire PostgREST: `issues` cu `remind_at` între acum−1 h și acum+7 zile,
cu `done=false`, plus numele proiectelor. Citirea trece prin RLS, deci vede exact ce
vede utilizatorul. Ea pornește:

- la fiecare 15 minute (WorkManager periodic, cu constrângere de rețea; minimul
  permis de Android);
- la revenirea rețelei;
- după fiecare alarmă sunată și după fiecare acțiune din notificare;
- la pornirea telefonului.

În Doze, WorkManager amână lucrul până la ferestrele de mentenanță. **Acesta e golul
din întrebarea 3:** un memento creat pe laptop chiar înainte să sune poate scăpa,
dacă telefonul doarme adânc.

**Textul e scris în două limbi**, cu fixtures comune, după tiparul recurențelor
(TS + PL/pgSQL). Partea Kotlin e un port de ~15 linii al lui `planNotification`.
`src/lib/pushPayload.fixtures.json` (intrare → `{title, body, tag}`) e citit și de
vitest, și de JUnit. Un caz nou se adaugă în fixtures, nu într-un test separat.

**Calculul rămâne pe server:** Kotlin nu calculează recurențe, liste inteligente sau
layere. Citește rânduri și programează ore.

### Regula de îmbinare (pură, testată)

Kotlin ține ca planul curent cea mai recentă dintre cele două liste, după momentul în
care a fost citită. Excepția sunt `heldIds`, pentru care ultima listă a paginii
câștigă până când pagina trimite alta fără ele. **La sunare**, alarma recitește
planul local: dacă tichetul a dispărut sau ora s-a mutat, nu sună. Nu cere rețea.

### Ratate

Rămâne regula de pe Linux: după repornire, după oprire forțată sau după o schimbare
de oră, mementourile ratate **din ultima oră** sună. Cele mai vechi se sar, fiindcă
listele le arată oricum ca restanțe. Regula e aceeași cu `TTL: 3600` de pe server.

**Costul dacă decizia e greșită:** dacă ratările din golul de mai sus deranjează, pasul
următor e un mesaj FCM fără conținut, „sincronizează-te acum", trimis de server când
se schimbă `remind_at`. Un mesaj FCM cu prioritate mare trezește aplicația din Doze.
**Asta cere server:** proiect Firebase, coloană sau tabelă pentru tokenuri FCM și
trimitere FCM HTTP v1 din `send-reminders` sau dintr-un trigger. De aceea nu intră
în v1.

## Decizia 3: sesiune nativă proprie, ca acțiunile să meargă fără WebView

„Gata" dintr-o notificare, cu aplicația închisă, trebuie să ajungă în Supabase fără
să pornească interfața. Asta e diferența față de brainstormul din august, care
accepta pornirea WebView-ului.

**Alegerea:** la login, în aplicația Android, formularul existent
(`src/auth.tsx`, `signInWithPassword`) dă **o dată** emailul și parola și pluginului.
Kotlin face propriul `POST /auth/v1/token?grant_type=password` și obține **o a doua
sesiune**, independentă. Supabase permite mai multe sesiuni pe utilizator. Refresh
token-ul se păstrează criptat cu Android Keystore. **Parola nu se păstrează.**

**De ce nu sesiunea WebView-ului:** refresh token-ul se rotește la fiecare
reîmprospătare. Doi clienți care și-l împart se deloghează unul pe altul, adică
exact bug-ul pentru care brainstormul a respins citirea sesiunii din service worker.
Nici `X-API-Key` din `functions/api` nu merge: ocolește RLS, iar `PATCH` nu acceptă
`remind_at` sau `due_at`. Ar însemna server modificat plus o cheie-maestru pe telefon.

**Costul:** un pas în plus la login, o singură dată pe dispozitiv. Dacă sesiunea
nativă moare (revocată), pe canalul „Stare" apare o notificare discretă:
„Reconectează mementourile". În aplicație apare un card cu un câmp de parolă. La
**logout**, pluginul șterge sesiunea, alarmele, planul și coada nativă. Dacă coada
nativă nu e goală, se avertizează, ca la regula offline.

## Acțiunile din notificare

| Buton | Ce face, imediat și local | Ce scrie în Supabase |
|---|---|---|
| **Gata** | închide notificarea | `PATCH issues {done: true}` |
| **15 min** | închide notificarea și pune o alarmă locală la +15 min | `PATCH {remind_at}` |
| **Amână…** | deschide `SnoozeActivity`, o foaie nativă mică (nu WebView), cu opțiunile din întrebarea 1 | `PATCH {remind_at}` sau, pentru „mâine 9:00", `{remind_at, due_at}` |
| atingere pe notificare | deschide aplicația pe `/${id}`, deep link-ul existent | — |

Patru reguli:

- **Scrierile sunt absolute, nu comutări.** `done: true`, niciodată `!done`, iar
  `remind_at` e o oră, nu un „+15". Asta e regula din `reminderMutation`
  (`src/lib/reminderAction.ts`), pe care o urmează și Kotlin: o sarcină bifată nu se
  debifează din notificare. Fiindcă scrierile sunt idempotente, aceeași acțiune
  ajunsă de două ori (o dată prin pagină, o dată nativ) nu strică nimic.
- **Ordinea de preferință e cea din `src/sw.ts`.** Cu WebView-ul viu, acțiunea merge
  la pagină (`onReminderAction`), iar pagina o execută prin store, deci prin coada
  offline, și își reîmprospătează interfața. Fără WebView, merge într-o **coadă
  nativă** persistentă, golită de WorkManager când există rețea. Cu
  `Prefer: return=representation`, răspunsul aduce scadența de după salt pentru o
  sarcină recurentă (saltul îl face trigger-ul `issues_zz_advance_recurrence`), iar
  alarma următoare se pune din el.
- **Offline merge tot ce e local:** notificarea dispare, amânarea sună la noua oră.
  Scrierea pleacă la revenirea rețelei. La pornire, pagina cere pluginului
  `pendingActions()` și le arată pe tichete până la confirmare, ca o bifă nativă să
  nu pară anulată.
- **Opțiunile foii de amânare** se calculează cu `snoozeTarget(option, now, issue)`,
  pur, adăugat în `src/lib/reminderAction.ts`, cu port Kotlin și fixtures comune
  (`reminderAction.fixtures.json`). `DesktopAction` se lărgește la
  `{ action: 'snooze', id, minutes } | { action: 'until', id, at, moveDue }`. Linux
  folosește aceeași formă pentru butoanele lui de 15 și 30 de minute.

`SnoozeActivity` se deschide **direct** din `PendingIntent.getActivity`: din Android
12, o activitate pornită dintr-un receiver după atingerea unui buton e blocată
(„trampoline"). Pe ecranul blocat, „Amână…" cere deblocarea. „Gata" și „15 min" merg
și fără ea. Foaia respectă sistemul vizual: suprafață peste fundal, fără chenare, ore
în mono, razele `--r-s`/`--r`.

## Notificarea

- Canalul **„Mementouri"** are `IMPORTANCE_HIGH` (apare peste ecran), sunetul e
  clopoțelul E5 randat în `res/raw/` cu sinteza din `tmp-calibrare/sunet/`, plus
  vibrație. Setările unui canal nu se mai pot schimba din cod după creare, deci un
  sunet nou cere un id nou (`mementouri-v2`).
- Canalul **„Stare"** are importanță mică: reconectare, permisiune pierdută.
- `tag` = id-ul tichetului, ca pe web: același tichet înlocuiește notificarea, nu se
  adaugă una nouă. Retragerea se face prin `cancel(tag)` ori de câte ori un plan nou
  (din oricare sursă) nu mai conține tichetul.
- Glisarea notificării o închide fără vreo acțiune. Sarcina rămâne în liste.

## Fără dubluri cu web push-ul de pe server

WebView-ul nu primește web push (`PushManager` lipsește), deci aplicația sună doar
local. Dublura apare doar dacă **Chrome-ul de pe același telefon** e încă abonat.

**Alegerea:** în aplicația Android, `PushToggle` nu mai oferă web push. Oferă
permisiunea nativă, cerută din butonul „Activează", niciodată la pornire. Lângă ea
listează rândurile proprii din `push_subscriptions` al căror `ua` conține „Android" și
le oferă spre ștergere: „Oprește notificările din Chrome pe telefon". Ștergerea e o
scriere de date permisă de RLS (`push_own`), nu o schimbare de server. Push-ul către
alte dispozitive (de exemplu un Chrome de desktop) rămâne cum e.

**Respins:** marcarea `reminder_sent_at` de pe telefon („l-am preluat eu"), ca
serverul să nu mai trimită. Coloana e per tichet, nu per utilizator, iar
`send-reminders` trimite tuturor membrilor proiectului. Telefonul ar fi tăiat
mementourile colegilor din proiectele comune.

**Serverul rămâne neatins:** `send-reminders`, pg_cron, `reminder-action`,
trigger-ele și `functions/api` rămân exact cum sunt.

## Ecranul de verificare

Un card în setările aplicației, doar în Android, care spune adevărul fără să ceară
nimic:

- notificări permise;
- alarme exacte posibile (`canScheduleExactAlarms()`);
- optimizarea bateriei, cu linkul spre setări pentru producătorii cunoscuți ca
  problematici;
- ultima sincronizare nativă;
- următoarea alarmă;
- abonamente Chrome rămase.

Dacă alarmele exacte nu sunt posibile, aplicația cade pe `setAndAllowWhileIdle`
(aproximativ, cu întârzieri de minute) și **spune asta** pe card.

## Distribuția și update-urile

- **Sideload, APK semnat cu o cheie proprie, instalat prin `adb install`.** Play
  internal testing e respins: politica Play se aplică și acolo, deci ar pierde
  `USE_EXACT_ALARM`, iar omul ar trebui să acorde manual „Alarme și mementouri".
  APK-ul **nu** se publică pe site-ul public.
- **Interfața** se actualizează la fiecare push pe `master`, prin service worker,
  ca pe Linux. **Cutia** (pluginul Kotlin) se reconstruiește doar când se schimbă
  `mobile/`, adică rar. Pagina citește `version` din punte. Dacă o funcție nouă din
  pagină cere o cutie mai nouă, pagina degradează onest („actualizează aplicația
  Android") în loc să cheme o metodă care nu există.
- **Cheia de semnare** (`mobile/android/keystore`, gitignorată) se salvează în afara
  repo-ului. Fără ea, un update cere dezinstalarea, adică re-login și pierderea
  cozii locale.
- **Toolchain:** nu există nimic pe mașină. Se instalează JDK 21 (AGP nu suportă încă
  25), `cmdline-tools`, `platform-tools` și `build-tools`, fără Android Studio. Build:
  `npm run android:apk` în `mobile/`.

## Ordinea lucrului

| # | Pas | Zile |
|---|---|---|
| 0 | Toolchain și o probă care se aruncă: Capacitor cu `server.url` → pagina vede `window.Capacitor`, service worker-ul se înregistrează, merge offline după prima încărcare, `test:upgrade` e reprodus manual (un push nou ajunge la revenirea în aplicație) | 1 |
| 1 | Pluginul: alarme, canal, trei butoane, reprogramare la boot/update/oră, regula „ultima oră"; puntea în pagină (`setReminders`, `onReminderAction`) | 2–3 |
| 2 | Sesiunea nativă, coada nativă de acțiuni, `SnoozeActivity`, `snoozeTarget` + fixtures | 2 |
| 3 | Sincronizarea nativă (WorkManager), îmbinarea cu `heldIds`, portul `planNotification` + fixtures | 1–2 |
| 4 | `PushToggle` pe Android, ecranul de verificare, ștergerea abonamentelor Chrome, APK-ul semnat | 1 |

Pasul 1 singur dă deja mementouri exacte pentru tot ce a văzut pagina. Merită o pauză
de folosire reală după el.

## Ce NU intră

Widget-uri; notificare permanentă cu rezumatul zilei; full-screen intent; FCM și
orice schimbare de server; Play Store; auto-update al cutiei; interfață nativă în
afară de `SnoozeActivity`; calcul de recurențe sau de liste inteligente în Kotlin;
comentarii și pasări din notificare; notificări pentru sarcini fără `remind_at`.

## Riscuri

- **`server.url` în producție:** acoperit de Etapa 0. Rezerva e `dist/` împachetat.
- **Managerele de baterie ale producătorilor** (MIUI, unele Samsung) pot opri
  procesul și, la oprire forțată, șterg alarmele. Ecranul de verificare arată
  problema, iar `MY_PACKAGE_REPLACED` și deschiderea aplicației le repun. Modelul
  telefonului omului încă nu e cunoscut și trebuie aflat la Etapa 0.
- **Golul de sincronizare în Doze** (întrebarea 3): asumat. Ieșirea e FCM, cu
  server.
- **A doua sesiune pe telefon:** un refresh token furat dă acces la cont. Riscul e
  de aceeași clasă cu tokenul din WebView, nu unul nou. E păstrat în Keystore.
- **Verificarea dezvoltatorilor pentru sideload**, anunțată de Google cu extindere
  globală din 2027: `adb install` a fost anunțat ca excepție. Dacă nu rămâne așa,
  contul gratuit de „hobbyist" e ieșirea. De reverificat la momentul respectiv.
- **Ceasul telefonului mutat sau fusul schimbat:** `TIME_SET` și `TIMEZONE_CHANGED`
  reprogramează tot. Ora din text se formatează în fusul dispozitivului, ca pe web.

## Testare

- **Unit (vitest):**
  - `upcomingReminders` cu orizontul de 7 zile și plafonul;
  - `heldIds` calculat din coada offline;
  - `snoozeTarget` (fiecare opțiune, inclusiv „mâine 9:00" peste o sarcină fără
    oră, cu oră, recurentă);
  - `reminderMutation`, care nu debifează niciodată;
  - adaptorul punții Android, cu un `window.Capacitor` fals.
- **Unit (JUnit, JVM pur, fără emulator):**
  - aceleași `pushPayload.fixtures.json` și `reminderAction.fixtures.json`;
  - regula de îmbinare a celor două surse;
  - regula „ultima oră";
  - gruparea pe minute (limita de ~9 min din Doze).
- **Manual, pe telefonul omului** (lista exactă în plan):
  - `adb shell dumpsys deviceidle force-idle` → mementoul sună la secundă;
  - repornire → alarmele revin;
  - mod avion → „Gata" închide notificarea, iar scrierea pleacă la revenire;
  - „15 min" → revine;
  - „Amână…" → „mâine 9:00" mută scadența;
  - memento creat pe laptop cu o oră înainte → sună pe telefon fără ca aplicația să
    fi fost deschisă;
  - o sarcină recurentă bifată din notificare → următoarea alarmă e pusă;
  - un singur sunet, nu două, după ștergerea abonamentului Chrome.
- Orice atingere a `src/sw.ts` sau `src/pwa.ts` cere `npm run test:upgrade`. Orice
  atingere a navigării sau a deep link-ului de la notificare cere `npm run test:nav`.
  Înainte de îmbinare: `npm test` și `npm run typecheck`.
