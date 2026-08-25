# Clienți nativi: Linux desktop + Android (2026-08-25)

Întrebarea de la care a pornit: *„vreau să trec de la lista mea de to-do la
Horizontal, dar sunt pe Android și vreau să pot amâna un memento cu 5 minute și
să revină. Se poate din PWA, sau am nevoie de aplicații native?"*

Răspuns scurt: **se poate din PWA, cu trei corecturi** — dar plafonul de
fiabilitate nu ține de codul nostru. Iar pe Linux, ce lipsește nu e o aplicație,
e un **proces rezident**.

## 1. Android / PWA — unde e plafonul

Ce merge azi: butoanele de acțiune (Chrome arată exact 2, cât avem în
`pushPayload.ts:55`), și cronul la fiecare minut din `migration-cron.sql`, deci o
amânare reintră în ~60 s de la țintă.

Trei goluri reale în cod:

1. **Amânarea nu face nimic fără filă deschisă** (`src/sw.ts:186`). Soluția
   corectă: un token HMAC de unică folosință pus în payload-ul de push, iar
   workerul face `fetch()` către o funcție edge nouă. Payload-ul de push e
   criptat per-abonament (RFC 8291), deci numai workerul acelui dispozitiv poate
   citi tokenul — niciun secret în bundle. Alternativele (sesiunea Supabase
   citită din SW, cheia anon + RLS) au fost respinse: prima se bate pe rotația
   refresh-tokenului și atinge contractul de update, a doua e imposibilă fiindcă
   politicile cer `auth.uid()`.
2. `send-reminders/index.ts:136` trimite **fără nicio opțiune**. `urgency: 'high'`
   + `TTL: 3600` sunt gratis, iar TTL împiedică un memento răsuflat să apară la 7
   dimineața.
3. `requireInteraction: true` e **ignorat în silență pe Android** (totul intră în
   tavă), iar `renotify` nu e pus niciodată — o reapariție cu același `tag` poate
   veni mută.

Și: `SNOOZE_MINUTES` e 10, cerința e 5.

**Riscul rezidual, pe care niciun header nu-l repară:** Doze și managerele de
baterie ale producătorilor. Chrome pe Android **nu trezește** dispozitivul
adormit nici cu `urgency: high`; MIUI/Samsung pot întârzia push-ul cu ore. Deci
un memento la 09:00 după o noapte de inactivitate e la noroc. Ăsta e plafonul
onest, și de asta un înveliș nativ are sens: `USE_EXACT_ALARM` e singura garanție
reală.

Notification Triggers (`showTrigger`) — programare offline în browser — n-a trecut
niciodată de origin trial. Nu există primitivă.

## 2. Linux — ce să construim, și în ce ordine

Verificat pe mașina proprietarului (GNOME Shell 50.4, Wayland),
`GetCapabilities` → `actions, body, body-markup, icon-static, persistence, sound`.

- GNOME **randează** butoane, dar `MAX_NOTIFICATION_BUTTONS = 3` taie restul în
  silență, și butoanele apar **doar când notificarea e extinsă**. `urgency=2`
  (CRITICAL) extinde automat — asta e pârghia. Cele două acțiuni pe care le avem
  deja sunt exact numărul potrivit.
- **GNOME ignoră complet `expire_timeout`.** Echivalentul lui
  `requireInteraction` e `urgency=2` + `persistence`. `resident` ține notificarea
  după ce o acțiune s-a executat — exact ce vrea „Amână".
- **Capcana:** GNOME distruge notificările când procesul care le-a trimis dispare,
  iar `ActionInvoked` e un broadcast către nimeni dacă emitentul a ieșit. Deci ori
  procesul **rămâne rezident**, ori se folosește
  `org.freedesktop.portal.Notification` (care activează aplicația prin D-Bus dar
  pierde `expire_timeout`, `replaces_id` și `resident`).
- `dunst` și `mako` anunță `actions` dar **nu desenează butoane** (doar meniu
  contextual). Regula de portabilitate: lipsa butoanelor înseamnă „pliază acțiunea
  în clickul implicit".

### Ce e instalat pe mașină (măsurat, nu presupus)

`node v22.23.1`, `npm`, `rpmbuild`, `flatpak`. **Nu există `cargo`, `rustc`, `go`,
`flatpak-builder`, `appimagetool`.** Iar portalul
`org.freedesktop.portal.Notification` e **versiunea 1**: are `buttons`, dar nu
`expire_timeout`. Deci se vorbește **direct** cu `org.freedesktop.Notifications`,
nu prin portal — și se sare peste Flatpak.

Tray-ul merge azi (`org.kde.StatusNotifierWatcher` e ocupat de extensia
`appindicatorsupport`), dar e o extensie care se rupe la fiecare versiune majoră
de GNOME. **Nimic esențial nu trece prin tray.**

### De ce Node, și nu Go sau Rust

Cifra care decide: `src/lib/` are **~1.075 linii de logică pură testată** cu **~935
de linii de teste**, iar interfața de deasupra ~11.000. Orice opțiune care nu
rulează JS (Fyne, GTK4, Flutter, Kotlin nativ) înseamnă rescrierea ambelor —
inclusiv `parseDue.ts`, al cărui `fold()` păstrează *indicii caracterelor* ca
`spans` să rămână valide. Ăla nu e un port de 193 de linii: e 193 de linii plus
re-derivarea fiecărui caz limită din cele 261 de linii de teste.

Argumentul mai tare e însă celălalt: **un proces Node `import`ează `pushPayload.ts`
și `schedule.ts` direct.** Fără QuickJS, fără bridge, fără al doilea parser.
Aceeași logică, executată — nu reimplementată. Asta șterge din plan un pas întreg.

| Opțiune | Refolosește UI | Refolosește `src/lib/` | Verdict |
|---|---|---|---|
| **Electron + `dbus-next`** | 100%, **același Chromium** în care dezvolți | **100% — procesul principal e Node** | **Recomandat.** `dbus-next` e JS pur, fără compilare nativă. `electron-builder` → `.rpm`, iar `rpmbuild` e deja instalat. ~150 MB, irelevant pentru un utilizator. |
| Rust + Tauri | 100% din markup, dar **WebKitGTK ≠ Chromium** | 0% pe partea Rust — cere QuickJS sau un port | ~10 MB și `notify-rust` e curat. Dar instalează un limbaj nou, redeschide problema logicii partajate, și pune în pericol contractul de update din `src/sw.ts`/`src/pwa.ts` pe care `npm run test:upgrade` îl păzește. |
| Go + Wails | Același risc WebKitGTK | 0% — Go nu poate importa TS | Niciun avantaj față de Tauri. |
| Go + Fyne | 0% | 0% | Rescrie ~11.000 de linii, iar notificările lui **nu au butoane**. Nu. |
| GTK4/libadwaita | 0% | 0% | Cel mai frumos rezultat pe GNOME, cel mai scump cu un ordin de mărime. Nu. |

`Notification.actions` din Electron e doar pe macOS — de asta apelul D-Bus e
direct. Nu e un ocol: e ce ai face oricum.

## 3. Unde stă planificarea: hibrid

Calea de pe server rămâne autoritatea și e deja corectă: `send-reminders` +
`migration-cron.sql` + trigger-ul `reset_reminder_sent()` din `migration-push.sql`,
care golește `reminder_sent_at` de câte ori se mișcă `remind_at`. **Trigger-ul ăla
face deja amânarea să se propage** pe toate dispozitivele. Nu-l atinge.

Programarea locală se adaugă **doar pentru livrare**: agentul rezident ține un
timer per `remind_at` apropiat și revalidează rândul înainte de a suna. Push-ul de
pe server rămâne plasa de siguranță pentru o mașină care a dormit.

Golul de închis: **nu există Realtime** nicăieri (`grep` după `.channel(` în
`src/data/` și `App.tsx` — zero). Fără el, „am amânat pe telefon" nu stinge
bannerul de pe desktop.

Nu există nici strat de offline: `supabaseRepository.ts` e rețea directă. O coadă
de scrieri offline **nu se construiește în v1**.

## 4. Android nativ, când va fi cazul

**Capacitor + un plugin Kotlin mic** (5–8 zile): refolosește ~100% din UI și
logică. `@capacitor/local-notifications` folosește alarme exacte și butoane, dar
handlerul JS **nu e headless** — „Gata" pornește WebView-ul. Deci ~200–300 linii
Kotlin (BroadcastReceiver + `setAlarmClock` + `BOOT_COMPLETED`) ca acțiunile să fie
silențioase. Kotlin nativ/Flutter = 25–40 zile și rescrierea interfeței. React
Native: **Notifee e arhivat** (repo read-only, apr. 2026) — de evitat.

Permisiuni: `POST_NOTIFICATIONS` se cere din butonul „Activează", niciodată la
pornire — regula pe care `PushToggle.tsx` o respectă deja. `SCHEDULE_EXACT_ALARM`
e refuzat implicit pe Android 14+; `USE_EXACT_ALARM` e auto-acordat dar
**restricționat de Play**, iar o aplicație de to-do e la limită sau respinsă.

**Deci: sideload sau F-Droid.** Politica Play nu se aplică în afara Play, iar
sistemul acordă permisiunea la instalare. De reținut: **Web Push nu funcționează
într-un WebView Capacitor** — pe Android ori se adaugă FCM pe server, ori se merge
pe alarme exclusiv locale.

## 5. Logica partajată: o singură implementare, executată

Ambii clienți recomandați sunt runtime-uri JS, deci `schedule.ts`, `parseDue.ts` și
`pushPayload.ts` se **importă, nu se portează**: în procesul principal Electron
(Node) și în WebView-ul Capacitor. Cost: **zero mașinărie nouă.** Ăsta e cel mai
puternic argument împotriva lui Tauri/Wails/Flutter, și valorează mai mult decât
orice câștig de dimensiune a binarului.

Respinse: **autoritate în Postgres/edge** — `buildSmartLists` are nevoie de fusul
orar al *privitorului*, iar `parseDue` în plpgsql e o glumă proastă. **WASM** — TS
nu compilează în WASM (AssemblyScript e alt limbaj); versiunea reală e QuickJS, adică
plătești costul lui Tauri ca să ajungi unde Electron e deja. **Duplicare + fixtures
comune** — plasa de siguranță dacă vreodată se merge nativ; fixtures există deja
(`_EXPECTED_LAYERS` din `data-model.json` plus cele 935 de linii de teste).

## 6. Ordinea

| # | Pas | Zile |
|---|---|---|
| 0 | Cele trei corecturi PWA (token HMAC pentru amânare fără filă, `urgency`+TTL, `renotify`; 10→5 min) | 0,5–1 |
| 1 | **Demon de mementouri**, Node, unit `systemd --user`: `@supabase/supabase-js` (deja dependință) + `dbus-next`; `Notify` cu două acțiuni, `expire_timeout: 0`, `urgency: 2`; `ActionInvoked` scrie în bază. Importă `planNotification` din `pushPayload.ts`, deci textul e identic cu al webului. Scrierile pot merge prin `functions/api/` — un proces desktop **poate** ține `X-API-Key`, spre deosebire de `src/sw.ts` | 2–3 |
| 2 | Coerență prin Realtime: abonare pe `issues`, retragerea notificărilor răsuflate pe toți clienții | 2–3 |
| 3 | Înveliș Electron peste `dist/`, absorbind demonul ca proces principal; tray + autostart; `electron-builder` → `.rpm` | 3–5 |
| 4 | Capacitor Android + plugin Kotlin, sideload | 5–8 |

Pasul 1 singur dă mementouri reale pe desktop, cu amânare funcțională, în timp ce
browserul rămâne interfața. **De făcut primul, și merită o pauză după el.**

**De NU construit:** o interfață Fyne/GTK4/Flutter/RN/Kotlin nativ (toate implică
rescrierea celor ~11.000 de linii); un nucleu Rust/Go (forțează a doua copie a
creierului); distribuție prin Play Store; Flatpak în v1; o coadă de scrieri offline
în v1; orice al doilea planificator care nu tratează rândul din bază ca autoritate;
orice funcție ajunsă doar prin tray. Și nu se atinge calea pg_cron — ea rămâne
plasa de siguranță pentru când desktopul e închis.

**Un lucru de verificat cu ochii, nu cu o sondă:** că GNOME 50 randează *ambele*
butoane, nu le pliază. `GetCapabilities` zice `actions`; o notificare de test
trimisă cu `gdbus` lămurește în 30 de secunde, înainte să se construiască ceva
deasupra.
