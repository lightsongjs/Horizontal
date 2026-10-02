# Aplicația Horizontal pentru Linux — design

**Data:** 2 octombrie 2026. **Precedent:** `docs/superpowers/brainstorm/2026-08-25-clienti-nativi.md`,
secțiunea 2 (Linux), cu măsurătorile de pe mașina proprietarului (GNOME Shell,
Wayland, `GetCapabilities` → `actions, body, persistence, sound`). **Depinde de:**
`2026-10-02-offline-baza-locala-design.md` (etapa 1), care trebuie să fie gata întâi.

Etapele **0** și **2** din cinci.

## Scopul — în cuvintele utilizatorului

Folosește azi TickTick pe Linux pentru un singur lucru pe care browserul nu-l poate
da: **apasă o scurtătură, apare o bară, scrie un memento, gata** — fără să deschidă
browserul. Vrea același lucru în Horizontal, rapid și offline, ca să renunțe la
TickTick.

Deciziile utilizatorului, din brainstorm:

| Întrebare | Răspuns |
|---|---|
| La ce folosește bara în 90% din cazuri | **Captură**: scrie, Enter, dispare. Data din text, proiectul ultimul folosit. |
| Ce mai e aplicația pe lângă bară | **Horizontal complet** într-o fereastră proprie; nu mai deschide site-ul în browser. |
| Ce se întâmplă la închiderea ferestrei | **Pornește la login, rămâne în fundal**; închiderea doar ascunde. |
| Scurtătura | **Ctrl+Shift+A** (cea a TickTick, la care se renunță). |
| Ce merge offline | Varianta A — vezi specificația offline. |

Singurul utilizator e proprietarul.

## Decizia tehnică: Electron, fereastra încarcă site-ul

Evaluat și respins: **Tauri** (WebKitGTK ≠ Chromium — mai lent la React pe Linux,
diferențe de randare, limbaj nou, pune în pericol contractul de update păzit de
`npm run test:upgrade`), **Deno** (n-are fereastră; webview-urile pentru el sunt
imature), **UI nativ în Rust/GTK** (rescrierea a ~11.000 de linii de UI plus a
`src/lib/`, pentru o diferență imperceptibilă cu aplicația deja pornită și datele
locale). Întârzierile reale sunt rețeaua (rezolvată de etapa 1) și pornirea la rece
(rezolvată de rularea în fundal) — niciuna nu ține de limbajul cutiei.

Preț acceptat: ~150–250 MB RAM în fundal, ~150 MB pe disc.

**Fereastra încarcă `https://horizontal-dyx.pages.dev`**, nu un bundle împachetat.
După prima încărcare, service worker-ul servește totul local. Consecința care
contează: **un push pe `master` ajunge și pe desktop** prin mecanismul existent din
`src/pwa.ts`, fără reinstalare și fără un al doilea canal de update. Doar „cutia"
(procesul principal Electron) se reconstruiește, rar. Prima pornire după instalare
cere rețea; apoi nu mai cere.

## Etapa 0 — proba de focus (înainte de orice altceva)

Pe GNOME Wayland, o fereastră arătată la cerere poate să **nu primească focusul**
(GNOME afișează „Horizontal e gata" în loc s-o aducă în față). Asta ar strica bara:
scurtătură apăsată, tastatura nu ajunge în câmp.

Probă, ~30 min, cod **de aruncat**, într-un folder ignorat de git:

1. Electron minimal, rezident, cu o fereastră ascunsă care conține un `<input>`.
2. Scurtătură GNOME (Ctrl+Shift+A) → `gdbus call` către procesul rezident → `show()` +
   `focus()`.
3. Verificat pe mașina proprietarului: cu altă aplicație în față (terminal, Chrome),
   apăs scurtătura și **scriu imediat**, fără click.

Dacă nu merge din prima, ocolișurile de încercat, în ordine: token de activare XDG
(`XDG_ACTIVATION_TOKEN`) trimis de la scurtătură; recrearea ferestrei în loc de
`show()`; rularea sub XWayland (`--ozone-platform=x11`) doar pentru bară. Rezultatul
probei decide cum se implementează bara; designul de mai jos presupune că una dintre
variante merge, iar planul începe cu proba.

## Componente

Totul trăiește într-un folder nou, `desktop/`, în repo-ul Horizontal — nu într-un repo
separat: stratul offline și ruta `/quick-add` sunt cod al site-ului oricum, iar contractul
`window.horizontalDesktop` ar trebui ținut în pas de mână între două repo-uri (lecția
`ticket-kit`). `desktop/` are **propriul `package.json`**, ca Electron să nu intre în
build-ul site-ului, iar în Cloudflare Pages „build watch paths” exclude `desktop/**`, ca o
schimbare doar în cutie să nu redeployeze site-ul. Lucrul se face pe ramură, nu pe `master`.

### 1. Procesul principal (rezident)

- Pornește la login (`~/.config/autostart/horizontal.desktop`, cu `--hidden`), fără
  să arate fereastra.
- **Instanță unică** (`requestSingleInstanceLock`); o a doua lansare doar trezește
  prima.
- Exportă un serviciu D-Bus mic (`ro.horizontal.App`, metode `QuickAdd`, `Show`) prin
  `dbus-next` — JS pur, fără compilare nativă.
- Nicio funcție esențială prin tray: nu există tray.

### 2. Fereastra principală

- `BrowserWindow` cu `horizontal-dyx.pages.dev`, sesiune persistentă (login o dată).
- **Închiderea ascunde** (`close` → `hide`); ieșirea reală doar din meniul aplicației
  sau la logout din sesiunea GNOME.
- Rămâne încărcată și ascunsă — e și cea care știe mementourile (mai jos).

### 3. Bara de captură

- `BrowserWindow` separat, fără ramă, centrat sus, `alwaysOnTop`, creat **la pornire
  și ținut ascuns** — de-aia apare instant.
- Încarcă o rută nouă a site-ului, `/quick-add`: o intrare **ușoară**, nu aplicația
  întreagă — câmpul de titlu cu `useTitleDate` (aceeași recunoaștere a datei ca în
  aplicație, cu refuzul pe fragment), selectorul de proiect care ține minte ultima
  alegere (`horizontal:last-task-project`), și scrierea prin `offlineRepository`
  (merge offline). Fereastra principală află de sarcina nouă prin `BroadcastChannel`
  (mecanismul din specificația offline), fără reîncărcare.
- **Enter** salvează și ascunde. **Esc** sau pierderea focusului ascunde fără să
  salveze. La fiecare arătare câmpul e gol și focusat.
- Ruta `/quick-add` nu trebuie să fie interpretată ca deep link de tichet
  (`/HZ-12`) de efectul de boot din `App.tsx`.

### 4. Scurtătura

- Scurtătură GNOME personalizată (`org.gnome.settings-daemon.plugins.media-keys`
  `custom-keybindings`), **Ctrl+Shift+A**, care rulează `horizontal-quick-add`:
  un script de o linie — `gdbus call` către `ro.horizontal.App.QuickAdd` (~10 ms), cu
  rezervă `horizontal --quick-add` dacă aplicația nu rulează.
- Verificat pe 2026-10-02: GNOME nu are nimic legat de Ctrl+Shift+A. Ca scurtătură
  globală, o ia de la toate aplicațiile (în Chrome, căutarea în file). TickTick
  (Flatpak, pornit acum) o poate revendica și el până e dezinstalat.
- Instalarea adaugă scurtătura fără să atingă `custom0` existent (`Alt+Shift+W`).

### 5. Mementourile

- **Cine știe ce urmează:** fereastra principală (React + store, alimentată din
  cache-ul offline) calculează mementourile din următoarele 24 h și le trimite
  procesului principal printr-un API îngust expus din preload
  (`window.horizontalDesktop`), ori de câte ori se schimbă. Textul fiecărui memento
  vine din **aceeași** funcție ca pe web (`planNotification`, `src/lib/pushPayload.ts`).
- **Cine sună:** procesul principal ține câte un timer per memento și trimite
  `org.freedesktop.Notifications.Notify` direct pe D-Bus (nu prin portal — v1 al
  portalului n-are ce trebuie): două acțiuni („Gata", „Amână 5 min"),
  `urgency=2` (extinde notificarea, deci butoanele se văd), `resident` (rămâne după
  acțiune). `Notification.actions` din Electron nu există pe Linux — de-aia D-Bus.
- **Butoanele:** `ActionInvoked` → procesul principal → IPC către fereastra
  principală → aceleași mutații din store ca pe web (bifare, amânare 5 min). Trec
  prin coada offline, deci merg fără internet. Bifarea unei sarcini recurente sare
  prin aceeași cale ca oriunde.
- **După somn:** la trezire (`powerMonitor` `resume`), mementourile ratate **din
  ultima oră** sună; cele mai vechi se sar — aceeași regulă ca `TTL: 3600` pentru push.
- **Retragere:** un memento bifat sau amânat în altă parte (alt dispozitiv,
  aplicația) își închide notificarea la următoarea sincronizare (`CloseNotification`
  pe `tag`).
- **Dubluri:** Electron nu primește Web Push, deci desktopul sună doar local; telefonul
  primește în continuare push de la server, corect. Dacă și Chrome-ul de pe laptop e
  abonat la push, același memento apare de două ori — se recomandă dezactivarea
  notificărilor din Chrome după instalare (pas în README-ul de instalare).
- **Server neatins:** `send-reminders`, pg_cron, `reminder-action` și trigger-ele
  rămân exact cum sunt; ele acoperă telefonul și desktopul oprit.

### 6. Securitatea punții

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Preload-ul expune
doar `window.horizontalDesktop` cu patru funcții (programează mementouri, primește
acțiuni, ascunde bara, versiunea cutiei), și doar dacă originea paginii e
`https://horizontal-dyx.pages.dev`. Navigarea spre alte origini se deschide în
browserul sistemului. Codul web detectează puntea (`if (window.horizontalDesktop)`)
și altfel se poartă exact ca azi.

## Instalare și update

- `npm run desktop:install`: `electron-builder` → `.rpm` (`rpmbuild` e instalat),
  instalează pachetul, scrie autostart-ul și scurtătura. Re-rulabil.
- **Interfața** se actualizează la fiecare push pe `master`, prin service worker.
- **Cutia** se reconstruiește doar când se schimbă `desktop/` — rar. Fără
  auto-update propriu în v1.
- Dezinstalare: un script care scoate pachetul, autostart-ul și scurtătura.

## Ce NU intră

Tray; Flatpak/AppImage; auto-update al cutiei; bundle local al interfeței; Web Push
în Electron; orice al doilea planificator care nu tratează rândul din bază ca
autoritate; bara cu lista „Azi" sau căutare (utilizatorul a ales captura pură).

## Riscuri

- **Focusul pe Wayland** — tratat de etapa 0, înainte de orice cod păstrat.
- **GNOME pliază butoanele** dacă notificarea nu e extinsă — `urgency=2` e pârghia;
  de confirmat vizual în probă, cu o notificare `gdbus` de test.
- **Fereastra principală descărcată din memorie** de Chromium în fundal (throttling
  de timere) — timerele stau în procesul principal, nu în pagină, tocmai de-aia.
- **Sesiunea Supabase expiră offline** — acoperit în specificația offline.

## Testare

- **Unit (vitest):** planificatorul de mementouri din procesul principal, ca funcție
  pură — dată lista și ora, ce timere există; regula „ratat în ultima oră"; retragerea
  la schimbare. Și ruta `/quick-add`: Enter creează prin repository cu data
  recunoscută și proiectul memorat.
- **Manual, pe mașina proprietarului** (listă de verificare în plan): scurtătura cu
  altă aplicație în față → scriu imediat; Enter offline → sarcina apare în fereastra
  principală și pleacă la revenirea rețelei; memento → notificare cu două butoane →
  „Amână 5 min" → revine; repornire → aplicația pornește ascunsă și scurtătura merge.
- Orice atingere a `src/sw.ts`/`src/pwa.ts` → `npm run test:upgrade`; a navigării →
  `npm run test:nav`.
