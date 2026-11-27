# Aplicația de Linux

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Aplicația de Linux

`desktop/` = cutie Electron rezidentă (Fedora/GNOME): bara de captură pe
Ctrl+Shift+A și mementouri cu aplicația în fundal. Spec/plan:
`docs/superpowers/{specs,plans}/2026-10-02-aplicatie-linux*`.

- **Cutia încarcă site-ul publicat** (`loadURL` pe `horizontal-dyx.pages.dev`;
  `HORIZONTAL_URL` pentru probă locală). Un push pe `master` ajunge pe desktop
  prin service worker; cutia se reconstruiește doar când se schimbă `desktop/`:
  `npm run desktop:install`. `/quick-add` și puntea trebuie publicate ÎNAINTE de
  instalare. Fără punte (`window.horizontalDesktop` lipsește) site-ul se poartă
  ca înainte. **Ferestrele se reîncarcă singure** (`load` din `main.ts`): la
  pornirea sesiunii rețeaua poate lipsi, iar bara picată cu `ERR_FAILED` stătea
  albă toată ziua (2026-11-06). Reîncercare la 5 s, plus reîncărcare la `showBar`.
- **`desktop/` are `package.json` propriu**, dar testele lui (`scheduler.test.ts`,
  `scripts/gsettings.test.mjs`) rulează din vitest-ul rădăcinii. Tipurile cutiei:
  `npm --prefix desktop run typecheck`.
- **Contractul `HorizontalDesktop` e scris de două ori**: `src/lib/desktopBridge.ts`
  (tipuri) și `desktop/src/preload.ts` (sandbox, fără import). Se schimbă
  împreună, ca și `DesktopAction` vs `NotifyAction` din `notify.ts`. Preload-ul
  expune puntea doar pe originea aplicației.
- **`/quick-add` e ramificată în `main.tsx` ÎNAINTE de `App`** (altfel boot-ul o
  ia drept deep link de tichet și `settleUrl` o rescrie); `parseTicketPath`
  întoarce `null` pentru ea. Cod: `QuickAddPage.tsx`, `QuickAdd` cu `rich` /
  `defaultProjectId`, `src/lib/captureTokens.ts` (pur). Rulează
  `npm run test:quick-add` după orice atingere.
- **Capturi.** Semnele (`#proiect`, `@persoană`, `!`) se recunosc doar la început
  de cuvânt; unul necunoscut rămâne în titlu. Butonul are ultimul cuvânt
  (`manual ?? tokens ?? implicit`). Proiect implicit Inbox, ca peste tot
  (`captureDefaultProjectId`), nu ultimul folosit; fără dată → fără scadență (D-241; înainte azi). Implicitul se
  calculează la fiecare randare, nu la montare: proiectele sosesc după bară.
- **Bara arată ca foaia rapidă** (varianta A din `design/quick-bar/index.html`,
  2026-10-26, capturile `real-*.png` lângă): inelul `.ck` în culoarea
  proiectului (chihlimbar cu urgent), titlul de 17px, dedesubt rândul
  `[Dată] [proiect] (inițiale) ··· indiciu [⚡] (↑)` — `.qs-bar` cu ramura
  `rich` din `QuickAdd`. **Fără agrafă** (decizia omului) și fără selectul de
  persoană: `@nume` în text, inițialele numai citite. Data = jetonul (gol:
  „Dată”) → `QuickDue`/`DuePanel` inline (sau Alt+D), care crește fereastra în
  jos; ✕ pe jeton refuză o dată recunoscută. Fereastra are înălțimea
  conținutului (`resizeBar`): ~96px goală, ~161 cu descrierea, ~241 cu panoul;
  plafoanele din `main.ts` sunt 90–420. Fără bandă rezervată sus: indiciul datei
  e `.qa-tip.below`. Bara nu e „îngustă” la 720px (`installNarrow({ desktop })`),
  deci panoul are mărimile de desktop. **Esc în doi pași:** cu panoul deschis îl
  închide doar pe el (în captură, `stopPropagation`, tiparul `ChipPop`), abia
  apoi golește + ascunde.
- **Focusul barei: `showInactive()`, nu `show()` + `focus()`** (2026-10-28).
  Pe Wayland Chromium cere focusul cu un token xdg-activation făcut din propria
  suprafață (fără focus → invalid), iar scurtătura GNOME nu dă niciun token:
  mutter răspundea „Horizontal is ready” și bara stătea fără tastatură, de
  câte ori omul tocmai scrisese în altă fereastră (proba din 2026-10-02
  trecuse din noroc). Fără cerere, mutter dă singur focusul unei ferestre noi
  (Chromium refă suprafața la fiecare `show`) și o centrează pe ecranul cu
  mouse-ul. NU trece cutia pe X11: focusul se poate repara și acolo, dar
  Chromium își fixează poziția și bara apare mereu pe ecranul principal.
  **Ascunderea nu golește** (decizia omului, 2026-10-10):
  bara se ascunde la orice click în afară, iar omul revine des ca să lipească
  ceva copiat din pagina din spate („user: ion", apoi parola). Ciorna — titlu,
  descriere (deschisă + conținut), alegerile de mână, refuzurile de dată și
  câmpul în care era cursorul — stă în `sessionStorage` (`src/lib/barDraft.ts`),
  nu doar în memorie: `registerPWA` rulează și pe bară și reîncarcă pagina la
  revenire când există un build nou. Golesc DOAR Esc (ascultătorul din
  `QuickAddPage`: șterge ciorna, remontează, ascunde) și o trimitere reușită.
  Esc-ul e ascultat la urcare, nu în captură, ca lista de sugestii (`#`/`@`) să-l
  oprească și să se închidă doar ea. La arătare (`visibilitychange`, NU `focus`
  — popup-ul unui `<select>`/câmp de dată ia focusul și îl dă înapoi) cursorul
  revine în câmpul unde era, la sfârșit, fără selecție (`focusSignal` +
  `keepDraft` în `QuickAdd`). Excepție: la prima arătare `visibilitychange` nu
  vine (fereastra e deja `visible`), deci primul `focus` dă primul semnal. `blur`
  ascunde cu 150 ms întârziere + reverificare, din același motiv. Rândul din
  listă și foaia rapidă nu țin ciorna — `keepDraft` e numai al barei. Cutia rulează
  cu `lang=ro-RO` (înainte de `ready`), ca și calendarul nativ din panoul datei
  să fie în ordinea zz.ll.
- **Pagina ȘTIE, cutia SUNĂ.** Timerele sunt în procesul principal (Chromium
  sugrumă timerele unei ferestre ascunse; cele Node nu numără somnul →
  `resume`/`unlock-screen` re-planifică). `planReminders` rulează de la zero la
  fiecare listă, timer și trezire. Pagina trimite mementourile din ultimele
  **24 h** (`REMINDER_LOOKBACK_MS`), cutia sună doar pe cele din ultima **oră**
  (`MISSED_WINDOW_MS`): cutia închide notificările ale căror chei lipsesc din
  listă, deci o fereastră scurtă ar închide un memento nebifat după o oră.
  `fired` (în memorie, nepersistat) previne dublurile la reîncărcarea paginii.
  `DesktopBridge` NU trimite nimic până la `dueLoaded` — un `[]` timpuriu ar
  închide notificările de pe ecran, care apoi nu mai revin (`fired`).
- **Seriile de mementouri** („la fiecare 15 minute"; regula în
  `recurente-fixate-rutine.md`): pagina le DESFĂȘOARĂ în pinguri pentru cutie
  (`upcomingReminders`: de la pingul curent la capăt, fiecare cu cheia
  `id@ping`, max `SERIES_PINGS_LIMIT` = 60 — lista se retrimite oricum la 15
  min și pornește mereu de la pingul curent). Rândul poartă `series: true`:
  cutia arată un singur buton, „Gata" = am văzut pingul (`seen`,
  `notifyActions.ts`): închide doar notificarea, seria continuă; bifa seriei
  stă doar în aplicație. Închide și notificarea pingului de dinainte al
  aceluiași tichet (`notify.ts`). **Decizia omului (10 nov. 2026):** „e un
  reminder repetat, nu înseamnă că am completat task-ul". Înainte butonul era
  „Gata azi" = bifă, iar pe o notificare rezidentă clicul din reflex oprea
  seria după primul ping. Pagina refuză oricum „done" pe o serie
  (`reminderMutation`), deci și o cutie veche e inofensivă. Asta cere `npm run desktop:install`; o cutie
  veche pune „15 min · 30 min", iar pagina refuză amânarea unei serii.
- **„Gata" trece prin `reminderMutation`** (`src/lib/reminderAction.ts`, comun cu
  service worker-ul): nu comută orb, ca o notificare veche să nu debifeze o
  sarcină bifată pe telefon.
- **Notificări pe D-Bus** (`notify.ts`; `Notification` din Electron n-are acțiuni
  pe Linux). `urgency=2` ca butoanele să se vadă; `resident` → le închidem noi
  imediat după acțiune. GNOME arată max 3 butoane: pe desktop **Gata · 15 min ·
  30 min** (`minutes` în `DesktopAction`), pe web push **Gata · Amână 5 min**
  (construit de server, neatins). Scurtătura cheamă `ro.horizontal.App.QuickAdd`
  prin `gdbus` (~10 ms), cu rezervă `horizontal --quick-add`. X pe fereastra
  principală o ascunde (ea știe mementourile); ieșire: Ctrl+Q / `Quit`.
- **Alt+Shift+H = arată / ascunde fereastra principală** (decizia omului,
  2026-11-27): `horizontal-show` cheamă `ro.horizontal.App.Toggle` (în față →
  ascunde, altfel `showMain`), cu rezervă pe pornirea aplicației. `showMain`
  ascunde și arată din nou o fereastră acoperită — fără token xdg-activation,
  `focus()` nu făcea nimic (tiparul `showBar`). **Nu Super+H:** tasta F5 de pe
  tastaturile Logi („dictare") trimite chiar Super+H. Nu Ctrl+Shift+H / Ctrl+H:
  scurtătura GNOME e globală și le-ar fura din Firefox și editoare.
- **`openExternal` doar `http:`/`https:`/`mailto:`** (linkuri din comentarii scrise
  de oameni); orice navigare în altă origine pleacă în browserul sistemului.
- **Instalare**: `npm run desktop:install` → `~/.local/opt/horizontal` (build
  `--linux dir`, re-rulabil, oprește întâi instanța prin `Quit`). Nu `.rpm`:
  cere `sudo` la fiecare reinstalare și `fpm` nu merge pe Fedora fără
  `libxcrypt`; se poate adăuga un target în `build.linux.target`. Scurtătura se
  ADAUGĂ la `custom-keybindings` (nu rescrie lista). Iconița din dash depinde de
  `horizontal.desktop` = `desktopName` + `StartupWMClass` (Wayland leagă după
  `app_id`). `npm run desktop:uninstall` șterge tot, mai puțin iconițele — și
  un `horizontal.desktop` vechi de la PWA, dacă are același nume.
- **Dublură**: un Chrome abonat la web push + cutia = fiecare memento de două
  ori; dezactivează notificările site-ului în Chrome.
