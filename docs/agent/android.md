# Aplicația de Android (+ laptopul activ amână telefonul)

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Aplicația de Android

`mobile/` = cutie Capacitor (`server.url` = site-ul publicat) + pluginul Kotlin
`HorizontalAndroid`, pentru alarme exacte. Spec/plan:
`docs/superpowers/{specs,plans}/2026-10-02-android*`. Telefonul: Redmi Note 13
Pro (HyperOS 3, Android 16).

- **Pagina ȘTIE, cutia SUNĂ, ca pe Linux** — dar pe Android pagina trăiește doar
  cât e deschisă, deci planul are DOUĂ surse: lista paginii (`NativeBridge`,
  7 zile, max 100, plus `heldIds` = id-urile din coada offline) și citirea
  nativă (`SyncWorker`: −24 h / +7 zile / 100, la 15 min, după alarme, acțiuni
  și boot; `SyncWorker.now()` = APPEND_OR_REPLACE). Câștigă cea citită mai
  recent; `heldIds` rămân ale paginii. `readAt` al citirii native = PORNIREA
  cererii; al paginii = PORNIREA ultimei citiri de REȚEA reușite a scadențelor
  (`SyncControl.dueFetchedAt`, `pageReadAt`), 0 offline sau cât n-a fost niciuna —
  nu „acum": lista din cache ar fi bătut una nativă mai nouă. Intră în cheia de
  retrimitere. Regula: `core/Plan.kt` (`mergePlan`).
- **Doar ce e al meu** (`isMine`, din `versionCode 9`, API 4): `SyncWorker` își
  află întâi rândul din `assignees` (`meQuery`: `user_id = <contul sesiunii
  native>`, la fiecare rulare — o legare nouă se vede la următoarea), apoi cere
  `assignee_id,created_by` și taie la parsare (`parseIssues`/`parseAgenda` cu
  `Me`). Aceeași regulă intră și ca filtru `or=` în cerere (`mineFilter`), ca
  plafonul de 100/200 să numere doar ce e al meu. Un eșec al citirii din
  `assignees` reîncearcă, nu cade pe „toate". Cont nelegat → nu taie nimic, ca
  pagina. Pagina taie lista ei (`NativeBridge`) doar de la API 4 și nu trimite
  nimic cutiei până nu-i știe versiunea; `heldIds` și `hiddenUntil` rămân
  neatinse. Fără migrare: `assignees` e citibil de orice cont autentificat.
- **Tot ce decide e în `core/`** (Kotlin pur, JUnit pe JVM: `npm run android:test`).
  Textul notificării și amânarea sunt scrise în DOUĂ limbi, cu fixtures comune:
  `src/lib/pushPayload.fixtures.json`, `src/lib/reminderAction.fixtures.json`.
  Un caz nou se adaugă în JSON, nu într-un test.
- **Cheia** `id@ISO` e comparată între pagină și cutie: `isoJs` (cu `.000Z`),
  nu `Instant.toString()`. Kotlin o recalculează la intrare.
- **O acțiune, un executant.** Aplicația vizibilă → pagina (`reminderAction`).
  Altfel coada nativă: o trimite `DrainWorker`, SAU o preia pagina la deschidere
  (`takeActions`) — preluarea și „în zbor" sunt sub același lacăt (`PlanStore`).
  O bifă executată de două ori pe o recurentă ar sări de două ori; de-aia
  garda `or=(due_at.eq.X,rrule.is.null)` din `buildPatch` — DOAR pe recurente (pe
  celelalte `done` e idempotent, iar garda ar fi blocat un „Gata" pe o scadență
  mutată în altă parte). Pagina are aceeași gardă (`prevDueAt` în acțiunea `done`,
  `runNativeAction`; tichet necunoscut → nu se execută) și preia (`takeActions`)
  abia după prima citire de rețea a scadențelor, nu pe cadrul din cache.
  ID-urile provizorii (`HZ-~…`) nu le trimite `DrainWorker` (`nextToDrain` le
  sare): crearea e încă în coada paginii, PATCH-ul ar da 0 rânduri = „făcut",
  pierdut. Le preia pagina, care traduce ID-ul (`resolveId`). `DrainWorker` eliberează la start
  elementele rămase „în zbor" de o încercare ucisă; folosește REPLACE + backoff
  liniar de 30 s. Fiecare cerere poartă contul căruia îi aparține (`asUser`) și
  se aruncă dacă sesiunea nativă e acum a altcuiva.
- **Sesiune nativă proprie** (a doua, nu a WebView-ului — refresh token-ul se
  rotește): dată O DATĂ la login din `auth.tsx`; criptată cu Keystore;
  refresh serializat. Moartă → notificare „Reconectează" + cardul din „Azi".
  `classifyAuth` (`core/Auth.kt`) omoară sesiunea doar la coduri GoTrue
  (`invalid_grant`, `refresh_token_not_found`, `invalid_credentials`,
  `session_not_found`) sau 401 la refresh — o eroare de rețea sau 5xx nu.
  Logout → `signOut` șterge sesiunea, planul, coada, alarmele.
- **Retragerea** e pe CHEIE (amânat pe laptop → cheie nouă → se retrage), iar
  citirea nativă ia `remind_at` de la −24 h: cu −1 h o notificare neatinsă s-ar
  fi retras singură după o oră.
- **Canalul `mementouri-v2`**: setările unui canal nu se mai schimbă din cod; un
  sunet nou = id nou (la pornire se șterge `v1`). Sunetul e TRIPLU (E5 la
  0 / 0,6 / 1,2 s, ~2,2 s), ales de om pe 2026-10-02 fiindcă nota singulară de
  0,6 s nu s-a auzit pe telefon; pagina își păstrează nota singură
  (`chime.ts`). Se regenerează cu `node mobile/scripts/render-chime.mjs`.
- **Capacitor nu respinge niciodată** un apel către o metodă pe care cutia
  instalată n-o are — apelul pur și simplu nu se întoarce. Deci orice metodă
  NOUĂ de plugin crește `API` (`HorizontalAndroidPlugin.kt`), iar pagina verifică
  `getInfo().api >= N` (`ANDROID_API_REQUIRED` / o verificare pe funcție) ÎNAINTE
  de apel. Niciodată „apelez și sper".
- **`loggingBehavior: 'none'`** în `capacitor.config.ts` e deliberat: pe un build
  debuggable bridge-ul ar scrie în logcat datele apelului `signIn`, parola
  inclusă.
- **Build/instalare**: `source mobile/scripts/env.sh` (JDK 21 din `~/.local/opt`,
  SDK în `~/Android/Sdk`); `npm run android:install` (release, `adb install -r`;
  cu emulatorul atașat, `ANDROID_SERIAL=<serial>`). Cheia:
  `~/.local/share/horizontal/android-release.{jks,pass}`, NU în repo — fără ea
  update-ul cere dezinstalare (re-login, coada pierdută). Interfața se
  actualizează prin push pe master (service worker); APK nou doar când se
  schimbă `mobile/` — și `versionCode` (în `app/build.gradle`) crește.
- **Barele de sistem (D-324, `versionCode 19`, API 6)**: edge-to-edge (targetSdk
  36) + `SystemBars` din Capacitor = padding pe decorView, deci fâșiile de sub
  bara de stare și de navigare arată fundalul FERESTREI, nu pagina (era gri, de
  la tema DayNight). `windowBackground` = `hz_app_bg` (zi/noapte) până răspunde
  pagina; apoi `setSystemBars` cu `--bg` din pagină (fundalul din rotiță nu e
  tema telefonului). `SystemBars` repune fundalul temei la fiecare
  `onConfigurationChanged`, de-aia `MainActivity` cheamă `applyBars` după `super`.
- **„Distribuie → Horizontal" (`versionCode 21`)**: `ShareActivity` (exportată,
  fără UI, `ACTION_SEND` text/plain) deschide fereastra de quick add cu textul în
  titlu (`core/Share.kt`: linkul în titlu, unde se deschide cu o atingere;
  `EXTRA_SUBJECT` înaintea lui; după o ciornă existentă). `QuickAddActivity`
  rămâne neexportată; ținta doar umple câmpul, trimiterea e a omului. Fără pagină,
  deci fără `API` nou.
- **Xiaomi/HyperOS**: instalarea prin USB cere „Instalare prin USB" activat și o
  confirmare pe telefon. Glisarea aplicației din recente poate fi un force-stop,
  care omoară alarmele — ecranul de stare (`AndroidStatus`) arată starea
  bateriei pentru asta.
- **Depanare**: `node mobile/scripts/cdp.mjs '<expr>'` evaluează în WebView
  (adb forward + CDP). Doze: `adb shell dumpsys deviceidle force-idle`.
- **Camera din `<input capture>`**: `BridgeWebChromeClient` (Capacitor) pornește
  `ACTION_IMAGE_CAPTURE` doar dacă `resolveActivity` o vede, iar de la targetSdk
  30 n-o vede fără `<queries>` în manifest (din `versionCode 2`). Fără ea cade în
  tăcere pe alegătorul de fișiere — „Fă o poză" merge, dar ca „Alege fișier".
  Permisiunea CAMERA NU se declară: declarată, Capacitor o cere la runtime;
  nedeclarată, aplicația de cameră face poza și noi doar primim fișierul.
- **Contractul** `HorizontalAndroidPlugin` e scris de două ori:
  `src/lib/androidBridge.ts` și `HorizontalAndroidPlugin.kt`. Se schimbă împreună.

- **Widget-urile** (spec: `docs/superpowers/specs/2026-10-06-widget-android-design.md`):
  `AgendaWidget` (fixate + restanțe + 7 zile, cu bifă; doar Android 12+, `@bool/widget_agenda_enabled`)
  și `QuickWidget` (1×1). Gruparea e `buildSmartLists` scrisă a doua oară în
  `core/Agenda.kt`; fixtures comune `src/lib/agenda.fixtures.json`. Două surse ca la
  mementouri: pagina (`setAgenda`, API 2) și a doua citire din `SyncWorker` pe
  `due_at` (fără limită inferioară); câștigă `readAt`. Bifa = `Actions.dispatch`
  prin `WidgetTapActivity` — o colecție are UN singur șablon de `PendingIntent`, iar
  un receiver n-ar avea voie să pornească `MainActivity`. Rândul bifat e ascuns cât
  „Gata" stă în coadă (`visibleAgenda`). `Widgets.refresh` e chemat din
  `Engine.reschedule`, deci orice listă/acțiune redesenează; plus o alarmă inexactă
  la miezul nopții (gruparea se schimbă fără date noi). Întoarcerea pe ecranul de
  start o decide pagina (`NativeBridge`): primul `popstate` care nu e tichet sau
  foaie după o atingere din widget → `leave()` (`moveTaskToBack`).
  **Fixatele** („Sarcini fixate", regula TickTick din `versionCode 15`):
  `pinnedAt` în `AgendaItem`. Apartenența e `daySections` (restanțe + zilele
  0..6, ca fără fixări); `buildAgenda` urcă fixatele ei într-un grup „Fixate"
  primul — widget-ul e O listă, deci și cele din zilele +1..+6 — cel fixat cel
  mai recent primul, nu și în ziua lor. Fără scadență, dincolo de fereastră
  sau rutină adormită = nu e în agendă, deci nici sus. `todayCount(sections,
  now, zone)` și `freeToday` recalculează din apartenență (restanțe + azi):
  o fixată de mâine stă sus, dar nu se numără și nu ține ziua ocupată.
  Rândul are piuneza în coadă (`r_pin`, `ic_widget_pin`) și își spune ziua
  (`rowMeta(…, pinned)`, roșie dacă e restantă); capul are piuneza în locul
  ceasului. Pagina trimite agenda ca înainte (fără fixatele nedatate);
  citirea nativă cere `pinned_at` doar ca ordine (`due_at=lt.…`,
  `order=due_at.asc`). O pagină veche poate trimite încă o fixată fără dată
  (`dueAt` null pe punte): se primește, dar nu intră în agendă. Fără `API`
  nou. Fixtures: `agenda.fixtures.json` (`pinnedAt`, secțiunea `pinned`,
  `todayCount`).
  **Desenul e „Senin"** (din `versionCode 10`, macheta `design/android-widget/index.html`):
  antet cu steaua, „Azi" și numărul de azi (restanțele incluse, `todayCount`), rânduri
  cu inelul în culoarea proiectului (urgent = inelul roșu — încă, `w_ck_urgent.xml`; chihlimbarul paginii cere un APK nou —, a doua `CheckBox` comutată
  prin vizibilitate), capete în litere obișnuite (`sectionHead`; „Azi" primul n-are cap,
  `showsHead`), rândul „Nimic pe azi" (`freeToday`). Două forme alese de launcher după
  mărime (`RemoteViews(Map<SizeF,…>)`, API 31): 4×4 și compactul 4×2 (plafon de 60 de
  elemente — fiecare formă își poartă lista prin binder). Rândurile se REFOLOSESC la
  derulare: culoarea, inelul urgent și linia de păr se pun explicit la fiecare legare.
  Culoarea vine ca `accent` în `AgendaItem` (pagina: `agendaItems`; citirea nativă:
  `projects(name,accent,…)`; o creare nativă o ia de la un rând al aceluiași proiect);
  un APK vechi ignoră câmpul, deci `API` nu crește. Fontul e `sans-serif`/`-medium` de
  sistem (pe HyperOS: MiSans), cu cifre tabelare (`tnum`): Inter ca `@font/` nu e
  garantat într-un `RemoteViews` umflat de launcher.

- **Notificarea fixă din bară** (D-185, „ca TickTick", din `versionCode 11`, API 5):
  `Shade.kt`, canal propriu `bara-azi` (LOW, fără sunet), `ongoing`. Arată numărul
  de azi (`todayCount`, același cu al widget-ului — e aceeași agendă,
  `AgendaWidget.stateOf`), prima sarcină și ziua ei (`dueChipDay`, cuvintele
  aplicației; fixtures comune `src/lib/dueChipDay.fixtures.json`), sau „Nimic pe
  azi" + ce urmează. Prima e fixata cea mai recentă dintre cele de azi și
  restante („Fixată · Azi · încă 2"), altfel prima de azi (restanțele întâi);
  o fixată de mâine nu e prima și nu ține ziua ocupată (`todayItems`, `ShadeTest`). Textul e pur, în `core/Shade.kt`. „+" = `QuickAddActivity`
  (`Widgets.quick`); atingerea = aplicația pe „Azi" (evenimentul `shade`, separat
  de `widget`, pe care o pagină veche l-ar fi luat drept „quick" → `GO_TODAY_EVENT`
  în `App.tsx`). Se redesenează din `Widgets.refresh`, deci la orice listă, acțiune,
  repornire și la alarma de la miezul nopții — care acum țintește `RefreshReceiver`,
  nu `AgendaWidget` (dezactivat sub Android 12), și se armează și fără widget. Fără
  agendă (instalare proaspătă, deconectat) nu apare. Comutatorul e al TELEFONULUI
  (`hz-shade` în SharedPreferences, pornit implicit, supraviețuiește logout-ului):
  `getShade`/`setShade`, în rotița de setări (`AndroidShadeSetting.tsx`, doar la
  `api >= ANDROID_API_SHADE`). Pe Android 14+ sistemul lasă orice
  notificare „ongoing" să fie glisată; `deleteIntent` (`REPOST` →
  `RefreshReceiver` → `Shade.dismissed`) o pune la loc pe loc, ca TickTick
  (din `versionCode 12`). Oprirea e numai din setări.

- **Fereastra de quick add** (spec: `docs/superpowers/specs/2026-10-06-quick-add-nativ-design.md`):
  butonul widget-ului deschide `QuickAddActivity` — nativă, fără WebView. Regulile
  de captură au O SINGURĂ sursă: `computeDraft` (`src/lib/quickDraft.ts`), folosit
  de `useQuickDraft` și împachetat (`scripts/build-capture-engine.mjs` →
  `assets/capture-engine.js`, gitignorat, făcut de `android:apk`/`android:install`)
  pentru `CaptureEngine` (`androidx.javascriptengine`, minSdk 26). **O schimbare în
  parser ajunge în fereastră doar cu un APK nou.** Testul `src/capture/engine.test.ts`
  rulează pachetul în `node:vm` pe `capture.fixtures.json`. Fără motor → modul brut
  (`rawDraft`). Un eșec al motorului NU mai ține fereastra pe modul brut până la
  închidere (D-227, din `versionCode 16`): pornirea are firul ei și 10 s, apoi se
  reîncearcă (`core/EngineRetry.kt`), iar la reușită fereastra recalculează (`onReady`).
  Nota „indisponibilă” apare doar cu motorul chiar căzut (`down`), nu cât pornește;
  trimiterea așteaptă o pornire în curs până la 3 s. Creările stau în `PlanStore.creates` (coadă separată de acțiuni —
  `take` nu le dă paginii); `DrainWorker` le trimite întâi, cu ID-ul (`attemptId`)
  salvat ÎNAINTE de POST: 409 + rând al nostru = gata, al altcuiva = ID nou (max 5).
  Pagina reîncearcă și ea la 23505. Fișierele: cale și ID fixe, urcate după creare,
  abandonate după o oră. Proiectele/oamenii vin de la pagină (`setCaptureData`, API 3).
  Proiectul implicit e Inbox după id (`inboxProjectId`, din `versionCode 8`); un APK
  mai vechi îl caută după numele „Daily" și cade pe primul personal — de-aia
  `captureData` trimite Inbox primul, ca redenumirea să nu strice telefoanele vechi.
  **Arată ca foaia rapidă din pagină** (D-205, din `versionCode 13`): Inter din
  `res/font/` (o activitate, spre deosebire de `RemoteViews`, îl poate folosi;
  licența OFL în `app/Inter-OFL.txt`), culorile `q_*` copiate din `:root`
  (`values`/`values-night`, după tema sistemului), rândul `[zi] [proiect] ···
  [⚡] [📎] (↑)` ca în „Ordinea rândului" — fără persoană: `@nume` în text merge
  în continuare. Tema `Hz.QuickAdd` e numai a ei; „Amână…" și `TicketActivity`
  au rămas pe culorile vechi `hz_*`.
  **Captura de ecran oferită** (decizia omului, 2026-11-05, din `versionCode 18`):
  gestul din Claude („am o poză în clipboard, dau click și e atașată"). Pe telefon
  captura nu ajunge în clipboard, ci în galerie (`DCIM/Screenshots/` pe HyperOS),
  deci fereastra caută în MediaStore cea mai nouă captură din ultimele 10 min
  (`core/Screenshot.kt`, `screenshotOffer`, testat) și o pune primă în banda de
  miniaturi: miniatură + „Atașează captura". NU în rândul de jetoane — pe 360–390dp
  nu încape fără să taie proiectul. O captură se oferă O SINGURĂ dată: atașată sau
  ignorată la Trimite → `seen` (`hz-quick-shots`, separat de ciornă); voalul/Back
  păstrează oferta, ca ciorna. Nu cade pe o captură mai veche dacă cea mai nouă e
  tratată. Dreptul la poze (`READ_MEDIA_IMAGES`, sub 33 `READ_EXTERNAL_STORAGE`) se
  cere o singură dată (`asked`); refuzat → fereastra merge ca înainte. Pe desktop
  nu e nevoie: omul lipește direct (Ctrl+V).

- **Foaia tichetului din widget** (`TicketActivity`): atingerea pe un rând o
  deschide nativ, peste ecranul de start (fără sesiune nativă → aplicația). Titlul
  și descrierea se salvează singure prin coada `edits` (`core/Edit.kt`, separată de
  acțiuni, ca `creates`), doar câmpurile schimbate față de server; descrierea nu se
  editează până nu e citită de pe server. O editare pe o creare netrimisă schimbă
  crearea; cu ID deja ales stă la coadă (titlul e garda lui `conflictOf`) și e
  remapată în `markCreated` / tradusă în `applyEdit`. Atașamentele: URL-uri
  semnate, cache în `cacheDir/attach/<id>`, deschise prin FileProvider.

## Laptopul activ amână telefonul (30 s)

Când omul lucrează la laptop, mementoul telefonului așteaptă 30 s. Dacă în
intervalul ăsta omul dă „Gata” sau „15 min” pe laptop, telefonul nu mai sună.
Decizia omului, 2026-10-05. Telefonul tace doar la un răspuns sigur. Orice
eroare, lipsă de rețea sau Doze înseamnă „sună acum”: o regulă de confort n-are
voie să piardă un memento.

- **Laptop:** `desktop/src/presence.ts` întreabă GNOME la 30 s. „Activ” =
  deblocat (`ScreenSaver.GetActive`) + atins în ultimele 2 min
  (`Mutter.IdleMonitor`). Prin D-Bus, nu prin `powerMonitor`: pe Wayland acela
  nu vede intrarea. Cutia trimite starea paginii (`onPresence`, contract scris
  de două ori), iar pagina o scrie cu `touch_presence` (`NativeBridge.tsx`).
- **Server:** `supabase/migration-presence.sql`. `desktop_active()` = bătaie în
  ultimele 75 s, după ceasul SERVERULUI. Ceasurile dispozitivelor nu se compară.
- **Telefon:** `AlarmReceiver` → `DeferGate.onAlarm`, cu regula în `core/Gate.kt`.
  Laptop activ și telefonul nu e în Doze → pune mementoul în `deferred` și
  armează `RecheckReceiver` la +30 s. Acolo citește tichetul și sună doar dacă
  e nebifat și cu `remind_at` neschimbat. În Doze nu amână: Android lasă ~o
  alarmă `AllowWhileIdle` la 9 min, deci reverificarea ar putea întârzia.
  Repornirea în cele 30 s → `flush`: sună tot ce aștepta.
- **Ce NU face:** retrage o notificare deja afișată pe telefon când acționezi
  după cele 30 s. Pentru asta e nevoie de FCM (Etapa 2).
