# Sistemul vizual „Senin”

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Sistemul vizual — „Senin" (din 2026-10-14)

Istoric: prima versiune arăta „AI-generated" (neon pe negru, chenar pe tot,
emoji); a urmat „Scholarly Editorial" (serif, mono, aproape monocrom), despre
care un client a zis „făcută în 1990, fadă". Acum: **„Senin"**, direcția A din
`design/redesign/index.html` (macheta aprobată — deschide-o înainte să atingi
stiluri). Abaterile asumate față de machetă, cu poze: `design/redesign/abateri/`.

### Regulile

1. **Alb curat, Inter, culoare cu rost.** Fontul de limbă e Inter (`--display`);
   cifrele (ore, ID-uri) rămân pe Geist Mono (`--mono`) — recomandarea
   designerului. Etichetele NU mai sunt mono cu majuscule: Inter 12px/650.
   Fără italice (doar `*text*` scris de om în descriere).
2. **Culoarea proiectului pe bifă.** Bifa e un inel `.ck` în `--pc` (accentul
   proiectului, pus inline de rând / de tablă), plin când e gata; urgentul e
   inelul chihlimbar (`.ck.urg`, `--urgent`), nu o iconiță. Același control în
   listă, pe carduri, în foaia de tichet și în formular.
3. **Rânduri plate.** Listele sunt rânduri pe `--bg` despărțite de o linie de
   păr (`::after`, pornește de sub titlu), nu carduri cu umbră. Ora / ziua
   ratată („11 oct") și proiectul stau în coada rândului.
4. **Fără chenare decorative.** Salt de fundal (`--surface-2/3`) sau umbră
   (`--amb`), niciodată amândouă cu chenar. Câmpurile de input își păstrează
   delimitarea; panoul lateral e o coloană lipită de listă cu o linie de păr.
5. **Un singur accent** (`--accent`, albastru) plus `--star` (galbenul lui
   „Azi", plin) și culorile de stare. **Iconițe, nu emoji** — `Icon.tsx`,
   vocabular pe ROL (`today` = steaua).
6. **Urgentul e chihlimbar, nu roșu** (decizia omului, 2026-10-16):
   `--urgent` / `--urgent-soft`, definite per temă (luminos `#D05A00` pe
   `#FFF0E3`, întunecat `#FF9548` pe 15%), ≥3:1 pe fundal și pe varianta pală.
   Pornit = fundal pal + culoare (inelul, jetonul din formular, ⚡ din foi),
   fără linia de 2px. **Roșul (`--blocked`) rămâne numai pentru restanță
   („ieri", Restanțe) și ștergere** — două sensuri pe aceeași culoare făceau
   o sarcină urgentă să arate întârziată. Distinct și de `--star` (galben).

### Raze, pe rol

`--r-s` 8px butoane/jetoane · `--r-m` 12px rânduri/câmpuri/tichete ·
`--r` 20px carduri/panouri/foi · `50%` ce e cu adevărat rotund. **Nu adăuga o
a patra valoare.**

### Layere și culori de temă

Rampa de layere e **secvențială** (albastru → verde), definită per temă în
`:root` ca `--layer-0..4`, fiindcă o culoare care se citește pe `#141517` nu se
citește pe `#FFFFFF`. `src/lib/layerColors.ts` întoarce `var(--layer-N)`, nu
hex. Culoarea layerului trăiește în coloana verticală a grupului, în numărul
layerului și în jetonul de dependență — **nu** pe conturul fiecărui card.
Culorile de temă și accentele de proiect sunt date de utilizator (DB), deci
rămân cum sunt.

### Bancul de probă

`design/preview.html` scoate CSS-ul **real** peste DOM-ul real al aplicației,
fără server și fără login în Supabase. Are patru ecrane, iar al patrulea,
„Controale", e o galerie cu fiecare clasă care și-a pierdut chenarul, în starea
normală și în cea activă — acolo se vede dacă un buton a rămas invizibil.

```bash
python3 design/build-preview.py   # regenerează, dacă s-a schimbat markup-ul
```

> **După orice schimbare de stil, deschide bancul în ambele teme.** Cea mai
> ușoară regresie de făcut e un control care rămâne fără fundal ȘI fără chenar:
> typecheck-ul și testele trec, iar butonul e invizibil.

### Rotița de setări: fundal și mărimea textului

Rotița (sertarul ☰ pe telefon, sidebar pe desktop) deschide `AppSettings.tsx`:
fundal + mărimea textului (`src/lib/textScale.ts`, patru trepte), ambele pe
DISPOZITIV (`localStorage`), aplicate în `theme.tsx`. **Orice `font-size` e
`calc(Npx * var(--text-scale))`**, și în CSS, și inline — un test
(`textScale.test.ts`) pică pe un px fix. Numai textul crește, nu pagina: un
`zoom` ar fi stricat foile lipite de tastatură (`--kb`, `--vvh` sunt în pixeli
reali). Peste „Normal", `<html data-text-large>` rupe pe două linii rândurile
care altfel ar tăia cu „…" (`.qs-bar`, `.list-group-head`). Verificare:
`TEXT_SCALE=1.5 npm run test:layout`.

Tot în rotiță stă, numai pentru admin, **„Utilizatori”** (secțiunea
„Administrare”; până pe 2026-10-15 era un rând permanent în bara laterală).
Foaia nu navighează singură: se închide și trimite `OPEN_USERS_EVENT`, iar
Shell-ul deschide ecranul după randare — pe telefon prin `goTop('users')`,
deci Back duce pe „Azi”, ca de pe orice tab.

### Vârsta buildului, sub numele omului

„Versiune · acum 2 min” stă sub nume, în sertar și în bara laterală
(`BuildAge.tsx`): omul vede dacă ultimul push a ajuns pe dispozitiv (service
worker-ul aplică buildul nou la revenirea în tab). `__BUILD_TIME__` și
`__BUILD_COMMIT__` vin din `define` (`vite.config.ts`; commitul din
`CF_PAGES_COMMIT_SHA`, altfel `git rev-parse`, altfel gol — buildul nu pică).
Tipurile Node ale configului sunt un shim (`vite-node.d.ts`), nu `@types/node`.
Textul e `formatBuildAge` (`src/lib/buildAge.ts`, pur, cu teste): minute, ore
cât e azi (sau sub 6 h peste miezul nopții), apoi „ieri” / „acum N zile” pe
calendarul local. Ceas propriu la 30 s + `visibilitychange`, ca bara laterală să
nu se randeze întreagă. Tooltipul: data exactă + commitul. **Nu folosi
constantele în `src/sw.ts`**: s-ar schimba la fiecare build și worker-ul ar
părea nou de fiecare dată. Rândul nu se taie cu „…” (vârsta e la coadă); trece
pe două rânduri la 320px și cu text mărit — `test:layout` verifică.

### Căutarea (O / Ctrl+F): cele mai noi întâi

`rankIssues` (`QuickSearch.tsx`, cu teste) ordonează după `createdAt`
descrescător (la egalitate, numărul din ID), și fără text, și în fiecare nivel
(potrivirile pe ID rămân înaintea celor pe titlu). Cerința omului, 2026-10-15:
„adaug ceva și-mi amintesc că mai trebuia altceva” — caută ce tocmai a scris.
Ordinea după ecranul de unde se deschidea căutarea (contextul) a ieșit.

**Calitatea potrivirii bate vechimea**: nivelurile sunt ID → titlu cu
potrivirea la început de cuvânt → în interiorul unui cuvânt → subsecvență
împrăștiată (`titleTier`); vechimea ordonează doar ÎN nivel. Cu vechimea
peste tot, „alex" aducea întâi „Adaugă … la … pe Linux" (subsecvență, dar
nou) și abia pe locul 4 „scrie lui Alex". Evidențierea marchează subșirul
întreg când există, nu literele împrăștiate.

**ID-ul fără cratimă** (D-394, 2026-11-12): `matchesId` compară fără
separatori, deci „nk57" și „nk 57" găsesc NK-57, iar „h4" găsește H-04
(numărul fără zerourile din față). Garda „măcar o cifră" rămâne.
