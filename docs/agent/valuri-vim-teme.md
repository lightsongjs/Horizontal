# Sprinturile, banda de valuri, Mod Vim, Teme × Valuri

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Sprinturile (valurile, în interfață)

Cerința omului, 2026-11-07: în aplicație nu mai scrie „val”, ci **sprint**
(taburi, foaia „Sprinturi”, meniuri, mesaje, panoul de taste, ghidul `tk`).
**Numele interne rămân** — tabela `waves`, câmpul `wave`, `/api/waves`,
componentele `Wave*` —, ca nimic să nu se strice. Un text nou vizibil spune
„sprint”; în cod și în comentarii „val” rămâne corect.

- Proiect nou = Notițele (0) + **Backlog** (1, activ), `initialWaves`.
- **Sprint nou = o dată** (foaia „Sprinturi”: butonul-calendar `NativePick`;
  `tk sprint-create --date AAAA-LL-ZZ`; `POST /api/waves { date }`). Numele și
  eticheta sunt data, `dd/mm/yy` (`sprintName`, `src/lib/sprints.ts`, pur, cu
  teste); aceeași dată de două ori e refuzată.
- **Ordinea rămâne `position`** (banda, grila, API-ul, tragerea o citesc pe
  ea). Data decide doar unde intră un sprint nou: înaintea primului sprint cu
  dată mai târzie, iar cele de după se dau cu un loc (`placeSprint`); fără
  unul, imediat după ultimul sprint cu dată (ms are Backlog-ul la coadă: un
  sprint nou intră înaintea lui, nu după); fără niciun sprint cu dată, la
  coadă. Backlog-ul și valurile fără dată își păstrează ordinea, deci la un
  proiect nou Backlog-ul rămâne primul, lângă Notițe. Tragerea de mână poate
  strica ordinea datelor, deliberat — e alegerea omului.
- `tk`: aliasuri `sprints`, `sprint-update/-delete/-archive/-unarchive`,
  `--sprint` = `--wave`; comenzile vechi merg (`wave-create "Etichetă"` face
  încă un val cu cifră romană, fără dată).

## Banda de valuri („Listă" și „Cards")

Mockup aprobat: `design/wave-bar/index.html`. Un singur rând deasupra listei:
`[Notițe N] [valurile] [+] [moduri ✕] … [⋯]` (`WaveTabs.tsx`, regulile pure
în `src/lib/waveBar.ts`, cu teste).

- **Pastila arată ETICHETA** valului (`label`) și numărul de tichete
  **deschise** (aceeași cifră ca grupurile de dedesubt; totalul cu bifate e în
  tooltip). Pe inactive eticheta se taie la 16 caractere (`truncateLabel`),
  activul se arată întreg; fără etichetă, „Val III". Cifra romană e **numele**
  valului (`name`), nu poziția — foaia „Valuri" o arată, iar `nextWaveName`
  continuă după cea mai mare cifră (după ștergerea lui I, nu dă „IX" de două ori).
- **Laptop: banda e UN rând fix** (cerut de om, 2026-10-14: în coloana docată
  se rupea pe trei rânduri). Ce nu încape intră în „Încă N ▾" (`ChipPop`,
  ←/→ sau ↑/↓ + Enter, Esc înapoi pe pastilă). Regula e `fitPills`
  (`waveBar.ts`): pastilele încap în ordine, iar valul activ e mereu pe rând —
  dacă ar cădea în meniu, ia locul ultimei vizibile. Notițele, „+" și modurile
  nu intră niciodată în meniu. Lățimile vin dintr-un strat ascuns
  (`.wb-measure`), NU de pe rând: acolo, strâmtorate, activul (apoi Notițele și
  modurile) cedează cu „…", iar o lățime cedată ar fi lăsat loc unei pastile în
  plus. Recalcul în `useLayoutEffect` la fiecare randare (starea se schimbă doar
  dacă s-a schimbat împărțirea) + `ResizeObserver` pe rând și pe strat (fereastra,
  panoul, mărimea textului, fontul). `test:layout` rulează `fitPills` real
  (esbuild) la 465px și 1100px.
- **Sub 900px banda derulează** orizontal, cu
  estompare la capătul spre care mai sunt valuri și valul activ adus în cadru
  (prin `scrollLeft`, nu `scrollIntoView`, care ar derula și pagina). „⋯" stă
  în afara derulării. Glisarea sertarului din margine NU pornește de pe bandă
  (`onBand` în `App.tsx`) — `test:nav` verifică.
- **Un singur val de livrare (sau niciunul): fără bandă.** Notițele și „⋯"
  urcă la capătul rândului de taburi printr-un portal (`TabsSlot`, pus de
  `ProjectDetail`); acolo Notițele sunt comutator (a doua atingere te întoarce
  pe val). Fără niciun val, lista arată „Primul val" (`NoWaves`).
- **„⋯ Vizualizare"** (`ChipPop`, `align="end"`; foaie de jos pe telefon):
  Arbore (T), Ascunde bifatele, Selectează (S), „Al cui" (doar în „Listă",
  aceeași poartă dublă ca înainte), Val nou… (doar fără bandă), Gestionează
  valurile… (V). Un mod pornit apare în bandă ca jeton cu ✕, iar „⋯" are punct.
- **Foaia „Valuri"** (`WaveManager.tsx`): din „+", apăsare lungă / dublu-click
  pe pastilă (cu eticheta ei sub cursor), „⋯" sau V. Redenumire pe loc,
  ordinea prin tragere de mâner sau ↑/↓ (`moveWave` → `reorderWaves`, scrie
  doar `position`-urile schimbate, optimist, revine la eșec — fără migrare).
  Ștergerea unui val cu tichete rămâne refuzată.
- **Valurile arhivate** (H-17, 2026-11-06, `waves.archived_at`,
  `supabase/migration-wave-archive.sql`). Un val cu tichete GATA nu se șterge
  (tichetele țin valul prin număr, fără cheie străină — ar rămâne orfane): se
  arhivează. În foaia „Valuri", pe un val doar cu gata, coșul devine arhivă
  („Sigur?"); cu tichete deschise e refuzat, cu motivul. Store-ul scoate
  arhivatele din `waves` (`visibleWaves`, `lib/waveBar.ts`) — taburi, alegeri,
  „Cards", hartă — afară de cel deschis acum: „Arhivate (N)", jos în foaie,
  strânse, au „Deschide" (pastila apare marcată cu cutia cât îl consulți și
  dispare la plecare) și „Scoate". `archivedAt` absent (`undefined`) = baza n-are
  coloana: arhivarea nu se oferă, foaia e ca înainte. Proiectul nu se deschide
  pe un val arhivat (`landingWave`), iar un tichet nou nu cade în el.
  API / `tk`: `DELETE /api/waves/<n>` (`tk wave-delete`) și `PATCH { archived }`
  (`wave-archive` / `wave-unarchive`) — deschisele dau `wave_in_use` cu lista,
  `moveTo` le mută întâi; vezi `docs/agent/cli-tk.md`.
- Tastele `,` / `.` = valul anterior / următor (Notițele sunt primele, fără
  ocolire la capete). Toate trec prin `shouldIgnoreKey`.
- Rândurile din „Listă" au inelul `.ck` în culoarea proiectului (`--pc` pe
  `.panel`, ca în „Cards"); urgentul e inelul chihlimbar, ID-ul stă în coadă pe
  desktop și iese sub 900px.

## Navigarea din tastatură („Mod Vim”)

Prototipul aprobat (harta de taste, scenariile, scara Esc): `design/vim-nav/index.html`.
Setare de DISPOZITIV în rotiță („Tastatură”: Mod Vim, Panoul urmează cursorul;
`src/lib/vimSettings.ts`), pornită implicit. **Oprit = aplicația exact ca înainte**
(`,` `.` valuri, V, H J K L vechi) — `test:nav` verifică.

- **Un singur dispecer**, `src/vim.tsx`, ascultă pe `document` și ia DOAR tastele
  pe care le înțelege în contextul curent (`list | panel | sidebar | any`, local
  bate global); restul trec la ascultătorii vechi. Overlay-urile cu Esc în
  captură câștigă în continuare. Într-un câmp (`isTypingTarget`) trec numai Esc
  și combinațiile cu Ctrl.
- **Harta e DATE**, `src/lib/keymap.ts` (pur, cu teste): litere/ASCII după
  `e.key`, restul după `e.code` — pe tastatura RO standard `[ ] ;` scriu ă î ș,
  deci `:` și `[` `]` se recunosc după poziție. Secvențe cu 1000 ms, numărători
  doar pe mișcări; într-un proiect `1`–`4` rămân taburile.
- **Cursorul comun** (`src/lib/cursor.ts`): vizualizările se anunță ca gazdă
  (ca `registerSplitHost`). Inelul e o regulă CSS pe ID, nu un prop — altfel
  fiecare `j` ar randa toată lista (vezi „Listele lungi”). Panoul urmează
  cursorul după 120 ms numai cu formularul curat; murdar, cursorul merge și
  panoul stă.
- **Acțiunile pe rând** (`x dd D t ! F M r yy yt . u`) au ținte în ordinea:
  intervalul `v` > selecția > rândul cursorului, și trec TOATE prin
  `TaskActions` (`run`/`remove`) — aceeași coadă (`enqueueWrite`), aceeași poză
  pentru anulare (și saltul recurenței) ca bara de selecție. `u` = „ANULEAZĂ”
  din toastul de pe ecran, nu o istorie proprie. `dd` întârzie ca glisarea
  (`hideIssues`, ascuns acum și din „Listă”/„Cards” prin `useOrderedLayers`).
  O acțiune care schimbă câmpurile formularului (dată, urgent, ștergere,
  mutare) pe tichetul docat **murdar** e refuzată cu `nudgeSave`: cheia
  panoului poartă `dueAt`, deci scrierea l-ar remonta și s-ar pierde ce scrii.
  Pe formularul **curat**, o scriere din afară (listă, click dreapta, alt
  dispozitiv) îl remontează (`formPrint` + `gen` în cheia din `SplitView`):
  altfel ar fi arătat valoarea veche, s-ar fi crezut „nesalvat” și Salvează ar
  fi scris-o înapoi.
- **Două selecții, rutate, nu una nouă:** în „Listă” `Space`/`Ctrl+A` aleg în
  selecția lui `useWaveActions` (`useVimSelection`, cu bara ei); în listele
  inteligente pe desktop nu există alta (cea din `TaskActions` e a telefonului),
  deci acolo e a dispecerului, desenată ca regulă CSS.
- **Meniul de acțiuni `m`** (listă, panou, interval) — `ActionMenu.tsx`,
  modelul pur în `src/lib/actionMenu.ts`: rânduri cu litera tastei directe
  (`t D - ! F w M @ r x y Del`), stinse cu motivul („doar pe un tichet”). Se
  execută tot prin dispecer → `TaskActions`, deci aceeași anulare și același
  refuz pe formularul murdar. `t` deschide direct sub-meniul datei (`a m l s c
  z -`; cifrele scriu ora, `1530` Enter = 15:30 pe ziua sarcinii — presetarea
  `time`), `M` / `w` direct pe ale lor. Tastele meniului sunt ascultate în
  captură și oprite acolo: cât e deschis, nimic din spate nu primește o literă.
- **Panoul e un inel scurt**: titlu → jetoane (UN popas; Enter = meniul) →
  descriere → fiecare dependență → fir; `J`/`K` sar pe secțiuni
  (`sectionStep`), `j`/`k` se opresc doar pe dependențe în plus. Ordinea o dă
  formularul docat (`useVimPanel`). Antetul (fixare, proiect) nu e în inel.
  Comentariul e `gc` (`m` e meniul). Tastele de pe tichetul docat (`! x F t w
  M`) scriu prin `TaskActions` ca din listă, nu în starea formularului:
  remontarea pe formularul curat (mai sus) le face vizibile, murdar sunt
  refuzate — un singur drum, fără excepția „în formular”.
- **Mnemonice în engleză, consecvent** (decizia omului, 2026-10-17): `gt`
  today, `gw` week, `gm` mine — nu `ga` „azi” lângă `gw` „week”. De-aia `gt`
  NU mai e valul următor (ca filele din Vim): valurile stau doar pe `[` `]`.
  Ca în yazi: `a` creează (`C` nu mai creează cu modul Vim; `cc` rămâne
  redenumirea), iar `/` e căutarea din toate proiectele (ca `O`); pentru lista
  curentă e `f` (filtru).
- **Valurile** sunt `[` `]` și foaia `gv`, prin evenimentul
  `hz:wave` ascultat de `WaveTabs`; cu modul pornit `,` `.` `V` nu mai sunt ale
  valurilor (`.` repetă, `V` e selecția), iar `[` nu mai ascunde bara (`gs`).
- **Esc face un singur pas**: secvența → popoverul (al lui, în captură) →
  câmpul → panoul → lista → selecția → închide panoul (garda de close rămâne)
  → căutarea/filtrul → cursorul. Primul Esc într-un câmp din panou NU mai
  închide panoul, doar iese din câmp.
- **Ajutorul** (`?`) se generează din `KEYMAP` cât modul e pornit; tabelul scris
  rămâne doar pentru modul oprit. O tastă nouă se adaugă în hartă, nu în panou.
## Teme × Valuri (H-13)

Macheta aprobată: `design/valuri/index.html` (2026-10-23). Un **mod al tabului
Teme**, nu un tab nou (ședința de triere e rară): comutatorul „Valuri” din
rândul de jetoane pune tichetele pe rânduri, grupate pe teme, și valurile pe
coloane. **Numai de la 900px** — pe telefon comutatorul nu apare. Modul se ține
pe dispozitiv (`horizontal:themes-grid`), ca o reîncărcare în mijlocul ședinței
să nu-l piardă. Panoul dublu (iframe-urile) nu e luat în calcul aici.

- **Nimic nou în bază.** Rândul e un tichet, grupul e tema, coloana e un val,
  punctul e `issue.wave`. Regulile pure: `src/lib/waveGrid.ts` (cu teste).
  Temele în ordine naturală (`naturalCompare`: „Pasul 2” înaintea lui „Pasul
  10”; și jetoanele din Teme), „Fără temă” ultima; rândurile după numărul din
  ID, nu după layer — layerul se mișcă la o mutare și rândul ar sări de sub
  cursor. Notițele (valul 0) sunt prima coloană, restul după `position`.
- **Mutarea** e un clic pe cercul unei coloane (cercul pal se vede mereu, ca să
  fie clar unde se dă clic), prin `TaskActions.run({ kind: 'wave' })`: același
  toast cu „Anulează”, aceeași coadă. Pe tichetul docat murdar e refuzată
  (`nudgeSave`), ca orice câmp al formularului.
- **Valurile n-au culoare**: coloana spune deja valul; punctul e neutru și nu
  seamănă cu bifa `.ck` („e în valul ăsta” ≠ „e gata”).
- **Avertismentul pe dependențe** (`depWarning`) e numai informație, gri, sub
  titlu: „cere HZ-12 · Val 2”. O dependență DESCHISĂ din același proiect e
  într-un val de după (după `position`, nu `number`) sau încă în Notițe.
  Nu blochează nimic — dependențele dintre valuri nu blochează nicăieri.
- **Gramatica de clase e a „Listei”** (`.list-group` > `.list-row[data-issue-id]`
  + `.list-title`), deci cursorul Vim, `x`, `dd`, `m`, `f`, selecția și Enter
  (panoul, prin `SplitView`) merg fără cod nou. În plus, contextul `grid` din
  `keymap.ts` (`registerGrid` din `vim.tsx`): `h` / `l` valul vecin, `0` / `$`
  Notițe / ultimul. Ale lui bat lista, lista bate globalele. **Fără
  numărătoare** (`2l`): cifrele 1–4 rămân taburile, pe loc (decizia omului).
- Ecran lat: `.split-list` nu se mai derulează, ci `.wg-scroll` — antetul
  valurilor stă sus, coloana titlului în stânga. Titlul ia tot ce rămâne, deci
  valurile stau lipite de marginea din dreapta (decizia omului, 2026-10-23).
- **Panoul se trage** (numai aici, prin `resizeKey` pe `SplitView`): linia
  dintre listă și panou lățește / îngustează panoul, ținut pe dispozitiv
  (`horizontal:themes-pane-w`), dublu-clic = implicit. Panoul nu scade sub
  460px, iar lista nu scade sub `dockMinWidth` — altfel tabelul ar înceta să
  fie gazdă și tichetul ar sări ca modal sub mouse.
- Teste: `waveGrid.test.ts`, `keymap.test.ts` (grid), `test:nav` „Teme ×
  Valuri” (clic pe cerc, `u`, panoul docat, `l`, cifra 1).
