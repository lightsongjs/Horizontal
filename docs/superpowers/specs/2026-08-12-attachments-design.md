# Attachments pe tichete — design

**Data:** 2026-08-12

Poze și fișiere atașate direct pe un tichet. Deschizi tichetul, dai Ctrl+V sau tragi
fișierul peste sheet, și fișierul e sus. Îl vezi ca miniatură, îl deschizi cu un click,
îl ștergi cu două atingeri. Când dispare tichetul, dispar și fișierele.

## Ce se stochează și unde

Bucket **Supabase Storage privat** numit `attachments`. Nu R2: aplicația vorbește direct
cu Supabase din browser, iar ruta R2 ar fi cerut `wrangler.toml`, un binding nou, un cont
nou și rescrierea lui `functions/api/_middleware.ts` ca să accepte JWT-ul sesiunii pe
lângă `X-API-Key` — adică un al doilea model de autentificare într-un fișier de 16 linii
cu o singură regulă. Supabase Storage merge pe sesiunea și pe RLS-ul care există deja.

1 GB pe planul gratuit ajunge: după micșorare o imagine e de ordinul a câteva sute de KB,
deci mii de imagini. Riscul real sunt fișierele care nu se pot micșora (PDF, zip, log),
de-aia au plafon explicit. Când se umple, se șterg attachment-uri din tichete — nu se
migrează nimic. **Nu există strat de abstracție peste stocare**: ar fi o indirecție care
nu se plătește niciodată, fiindcă decizia de a rămâne pe Supabase e luată.

Bucketul e privat, nu public: proiectele sunt deja izolate prin `project_members`, iar un
bucket public ar face orice poză vizibilă oricui nimerește URL-ul.

### Calea obiectului

```
{projectId}/{issueId}/{attachmentId}
```

Fără extensie în cale — `content_type` real trăiește în DB, iar numele de afișat în
coloana `filename`. `projectId` e primul segment **intenționat**: politica RLS pe
`storage.objects` compară `(storage.foldername(name))[1]` cu `project_members`, deci
accesul la fișiere urmează exact regula de acces la tichete, fără reguli paralele.

### Tabelul

```sql
create table attachments (
  id           uuid primary key default gen_random_uuid(),
  issue_id     text not null,
  project_id   text not null,
  path         text not null unique,
  filename     text not null,
  size         int  not null,
  content_type text not null,
  created_at   timestamptz not null default now(),
  foreign key (issue_id, project_id) references issues (id, project_id) on delete cascade
);
create index attachments_issue_idx   on attachments (issue_id);
create index attachments_project_idx on attachments (project_id);
```

`project_id` e denormalizat **din necesitate, nu din comoditate.** Politica de storage
dovedește că segmentul 1 e un proiect în care ai drept de scriere; nu dovedește că
`issueId` din cale aparține acelui proiect. Fără asta, cineva cu drept de scriere în
proiectul A poate scrie octeți la `A/{tichet-din-B}/x`. Cheia compusă către
`issues (id, project_id)` face perechea consistentă prin construcție. Cere
`unique (id, project_id)` pe `issues` (`id` e deja cheie primară, deci unicitatea e
gratuită — constrângerea există doar ca țintă a cheii externe).

Bonus: ștergerea unui proiect devine `select path from attachments where project_id = $1`,
o interogare indexată, în loc de o plimbare paginată prin Storage.

`size` și `content_type` vin de la browser neverificate — nu există server pe traseu. Se
stochează, dar nu sunt autoritare: nicio cotă nu se calculează din `sum(size)`, iar
randarea inline se face **doar** pentru tipuri din lista albă de imagini.

### Politicile RLS

Pe `attachments`, oglindesc politicile existente de pe `issues` (via `is_admin()` și
`project_members`), verificând direct `project_id`.

Pe `storage.objects` — bucketul trebuie să existe înainte, creat din dashboard sau cu un
script service-role; cheia anon nu poate insera în `storage.buckets`:

```sql
create policy attachments_select on storage.objects for select to authenticated
using (
  bucket_id = 'attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = (storage.foldername(name))[1]
        and m.user_id = (select auth.uid())
    )
  )
);

create policy attachments_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = (storage.foldername(name))[1]
        and m.user_id = (select auth.uid())
        and m.role = 'write'
    )
  )
);

create policy attachments_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = (storage.foldername(name))[1]
        and m.user_id = (select auth.uid())
        and m.role = 'write'
    )
  )
);
```

Trei capcane, în ordinea probabilității de a mușca:

1. **Totul se califică pe schemă** — `public.is_admin()`, `public.project_members`.
   `search_path` al conexiunii storage-api nu garantează `public`, iar `is_admin()` e
   declarat cu `set search_path = ''`. Referințele necalificate dau clasicul
   „function is_admin() does not exist" exact la upload.
2. **`bucket_id = 'attachments'` e obligatoriu** în fiecare politică, altfel ai scris o
   politică pentru toate bucketurile.
3. `(storage.foldername(name))[1]` **nu e indexabil** contra indexului existent
   `(bucket_id, name)`. Irelevant la upload/download/delete, unde storage-api găsește un
   singur rând după `bucket_id + name` exact. Dar contează la `list()`, care evaluează
   politica pe fiecare rând al unei scanări de prefix — deci **`storage.list()` nu se
   apelează niciodată din client**; căile se citesc din tabelul `attachments`.

Nu există politică de `update`: `attachmentId` e un uuid nou la fiecare upload, `upsert`
nu se folosește, deci obiectele sunt imuabile odată scrise.

## Unde trăiește în interfață

### Ce înseamnă de fapt „deschid un tichet"

Verificat în cod, fiindcă e ușor de presupus greșit: `src/ui.tsx:56-58` arată că
`openIssue(id)` și `openEditIssue(id)` fac **exact același lucru** —
`setSheets([{ kind: 'issue-form', issueId }])`. Deci un tap pe un card, un deep link, un
rezultat din QuickSearch, toate deschid **`IssueForm`**.

`IssueSheet` (`kind: 'issue'`) se atinge numai prin `pushSheet`, adică apăsând o
dependență din alt tichet. E **cardul de previzualizare a unei dependențe**, împins
deasupra — de-aia are buton „✎ Editează", care duce la formular. Un ecran nu are buton de
editare către sine.

### Consecința

**Secțiunea editabilă stă în `src/components/IssueForm.tsx`.** Acolo ajunge utilizatorul
când deschide un tichet, deci acolo trebuie să poată lipi.

**Aceeași componentă se randează read-only în `src/components/IssueSheet.tsx`** — fără
paste, fără drop, fără X — ca previzualizarea unei dependențe să arate că are poze, în loc
să te oblige să intri în ea ca să afli.

Două lucruri pe care plasarea în formular le aduce cu ea:

- **Tichetele noi n-au id**, iar `IssueForm` servește și crearea (`issueId` lipsă). La
  tichet nou zona afișează un singur rând — „Salvează tichetul, apoi atașează fișiere" — și
  nu acceptă nici paste, nici drop. Fără auto-save, fără tichete pe jumătate scrise.
- **Formularul are câmpuri de text** (descriere, notițe). Regula care închide ambiguitatea:
  **dacă clipboard-ul conține fișiere, e attachment, oriunde ar fi cursorul.** Un paste de
  imagine într-un `textarea` nu face nimic oricum, iar paste-ul de text rămâne neatins
  fiindcă renunțăm imediat când nu există fișiere. Nicio euristică pe focus.

Attachment-urile sunt **o listă separată**, nu referințe markdown în descriere.
Descrierea nu se atinge, deci nu pot exista link-uri rupte în text și ștergerea e
neambiguă.

### Ce vezi

Secțiune nouă, cu titlu „Fișiere": miniaturi pătrate pentru imagini, rânduri cu iconiță +
nume + mărime pentru restul. Fiecare cu un X. În `IssueForm` stă imediat sub secțiunea de
notițe; în `IssueSheet` sub „Permite", fără X și fără drop-zone.

- **Click pe imagine** → lightbox în aplicație, cu buton de descărcare. Nu tab nou:
  Horizontal e PWA instalabil, iar un tab nou aruncă utilizatorul în browser cu un URL
  semnat urât în bară, greu de închis pe telefon.
- **Click pe fișier** → descărcare directă cu numele original, prin opțiunea `download`
  pe URL-ul semnat, care forțează `Content-Disposition: attachment`. Fără ea un `.log`
  sau, mai rău, un `.svg`/`.html` stocat s-ar randa pe originea Supabase.
- **Offline**: URL-urile semnate nu funcționează offline, iar shell-ul aplicației e
  precachat — deci sheet-ul se randează cu `<img>`-uri moarte, ceea ce se citește ca
  pierdere de date. Fiecare imagine primește un `onError` care arată „indisponibil
  offline". Nu se construiește cache de blob-uri în versiunea asta.

### Ștergerea unui attachment

**Două atingeri.** Primul tap pe X îl schimbă în „Șterg?"; al doilea șterge definitiv.
Octeții sunt singurul lucru irecuperabil din Horizontal — orice altceva e text pe care îl
poți rescrie — iar X-ul stă lângă miniatură pe un ecran de telefon, unde atingerile
greșite sunt normale. Nu soft delete: ar contrazice direct planul de a elibera spațiu
ștergând din tichete, fiindcă cele șterse ar continua să ocupe.

Starea „Șterg?" e per attachment și se anulează singură: la un tap oriunde altundeva, la
un al doilea attachment pus în starea de confirmare, sau după ~3 secunde. Altfel un X
rămas armat devine chiar capcana pe care confirmarea trebuia să o închidă.

## Micșorarea imaginilor

**Numerele se stabilesc prin măsurare, nu prin presupunere** (vezi „Calibrare" mai jos).
Ce e decis acum e *forma* regulii.

Calibrarea din `2026-07-22__mateSimo3aug` (`maxEdge 2000`, `quality 0.85`, ieșire mereu
JPEG) e făcută pe poze de scris de mână de la telefon și **nu se poate porta ca atare**.
Attachment-urile din Horizontal vor fi în covârșitoare majoritate screenshot-uri — cod,
terminal, UI, mockup-uri — unde:

- PNG→JPEG pierde canalul alpha: o captură de fereastră cu umbră transparentă capătă
  halou negru.
- Subeșantionarea chroma din JPEG (4:2:0) întinde culorile pe text mic colorat, adică
  exact syntax highlighting-ul.
- Un PNG cu linii curate recomprimat în JPEG **crește** adesea.

Astea sunt greșeli de corectitudine, nu de gust. Deci regula se ramifică pe tipul de
intrare:

| intrare | politică |
|---|---|
| `image/png` | WebP fără pierderi. Prag de dimensiune și de octeți mai generos decât la poze. Niciodată JPEG. |
| `image/jpeg`, `image/heic` | numerele de tip fotografie (calibrarea mateSimo e punctul de start) |
| `image/webp` | neatinsă |
| `image/gif`, `image/svg+xml`, APNG | **niciodată atinse** — canvas distruge animația, iar rasterizarea unui SVG e o degradare |

Când se micșorează, **scara e o împărțire cu un număr întreg** (÷2, ÷3), niciodată o
potrivire exactă pe latura maximă: scalarea fracționară aliazează liniile de 1px, iar ÷2
filtrează curat.

`outputType: 'image/webp' | 'image/jpeg' | null` (`null` = păstrează originalul) e câmp
de prim rang în planul de micșorare, ca decizia de format să fie **date testabile**.
Garda „dacă rezultatul e ≥ originalul, păstrează originalul" din mateSimo rămâne, dar
doar ca plasă de siguranță: ea compară un singur candidat cu originalul, deci singurele
două rezultate pe care le poate produce sunt „JPEG cu culori stricate" sau „PNG de 12 MB
neatins" — „rămâne PNG, dar mai mic" nu e atins niciodată. Și o comparație de octeți nu
poate vedea pierderea de alpha.

Micșorarea e o optimizare, nu o apărare: nu există plafon de dimensiune impus de
aplicație — singura limită reală e cea de proiect a Supabase (setare din dashboard, ~50 MB
pe planul gratuit), în afara controlului aplicației — fiindcă `shrinkImage` poate eșua
(format nedecodabil) și atunci pleacă originalul.

### Ce se acceptă

Orice fișier. Imaginile trec prin micșorare; non-imaginile urcă așa cum sunt. Nu există
plafon de dimensiune impus de aplicație — decizia de a renunța la plafoane e ulterioară
acestui document și e înregistrată în
`docs/superpowers/specs/2026-08-12-mobile-attachment-picker-design.md`.

Singura respingere pe dimensiune e garda contra folderelor trase din greșeală peste zonă:
ajung ca intrări de 0 octeți, pe care `pickFiles` le respinge — nu e o limită de mărime, e
o gardă contra unei greșeli de manipulare.

Limita reală care rămâne e externă aplicației: plafonul de proiect al Supabase pe fișier
încărcat (setare din dashboard, ~50 MB pe planul gratuit), pe care aplicația nu îl
verifică și nu îl poate schimba.

Nu există plafon pe numărul de attachment-uri per tichet: spațiul total e oricum mărginit
de bucket, iar `storage-report.mjs` îți arată unde s-a dus. Un plafon pe număr ar bloca
cazul legitim (o serie de capturi dintr-un flux) fără să apere de nimic real.

Nu se ține listă albă la *stocare* — dar se ține la *randare*: inline doar tipurile de
imagine din lista albă, restul forțat la descărcare.

### Calibrare

Pas explicit, înainte de a îngheța constantele. `shrinkPlan()` e o funcție pură care
primește opțiunile ca parametru, deci **numerele sunt o decizie-frunză**: tot restul
(tabel, upload, listă, lightbox, cascadă) se construiește fără ele.

Se portează `scripts/test-shrink-image.mjs` din mateSimo, inclusiv modul `--calibrate`:
Playwright + `page.evaluate` + canvas real, scriind pe disc decupaje 1:1 din zonele cu
text dens. Se măsoară octeții, dar **decizia se ia privind decupajele.**

Corpus de test: screenshot de terminal întunecat cu culori ANSI, editor de cod la ~12px,
panou DevTools, mockup cu gradienți, captură de fereastră cu umbră transparentă, poză
portret de telefon, captură 5K. Materialul real vine de la utilizator.

#### Ce arată materialul existent (măsurat 2026-08-12, 70 de imagini)

Din `Pictures/Screenshots`, `OneDrive/Pictures/Screenshots`, `Downloads`, `Desktop`:

| grup | câte | median | maxim | dimensiuni |
|---|---|---|---|---|
| PNG — capturi de desktop | 23 | 35 KB | 395 KB | maxim 1847×961 |
| JPEG — capturi de telefon | ~45 | 701 KB | 1,1 MB | 1080×2400 |
| JPEG — poze de cameră | 2 | — | 13,4 MB | 12288×16320 (200 MP) |

Trei concluzii care **fixează forma regulii pe date, nu pe presupuneri**:

1. **Toate cele 23 de PNG-uri sunt sub 400 KB și niciunul nu trece de 1847px** — ar fi
   sărite integral. Riscul PNG→JPEG e real în principiu, dar nu se declanșează pe
   materialul acestui utilizator. Ramificarea pe format rămâne totuși în cod: e ieftină și
   apară cazul viitor (monitor 4K, ecran Retina), unde PNG-urile devin mari.
2. **Peste 2000px: 43 din 70. Peste 3072px: 2 din 70.** `maxEdge 2000` ar redimensiona
   majoritatea, inclusiv capturile de telefon de 1080×2400, care au text mic.
   `maxEdge 3072` atinge exact cele două fișiere care au nevoie. Corpusul alege numărul.
3. **Ținta reală sunt cele două poze de cameră** (200 MP / 13,4 MB) — exact cazul pe care
   e calibrată mateSimo, și fără text fin, deci strivirea nu costă nimic.

#### Cazul greu, măsurat direct

Un screenshot de terminal luat de utilizator pe ecranul lui de lucru — monospace mic, pe
fundal întunecat, colorat: **1787×481, ~53 KB PNG.** Sub pragul de octeți și sub orice
`maxEdge` candidat, deci **ar fi sărit complet.** Micșorarea nu atinge screenshot-urile de
cod pe hardware-ul actual (ecran ~1920 lat, non-Retina).

Deci grija cu care a început designul — „nu strica textul din capturile de cod" — nu are
de fapt un caz care să o declanșeze azi. Ramificarea pe format rămâne în cod ca asigurare
pentru un ecran 4K sau Retina viitor, unde aceleași capturi ar depăși pragurile.

#### Singura întrebare rămasă

**Capturile de telefon, 1080×2400, 700 KB – 1,1 MB.** Sunt peste pragul de octeți dar sub
`maxEdge 3072`, deci cad pe ramura „doar recomprimare": JPEG peste JPEG, a doua generație
de pierderi, pe capturi care au și ele text mic (WhatsApp, Chrome).

Asta e singurul lucru pe care harnessul mai trebuie să-l arate ca decupaj 1:1, și singura
valoare care mai are nevoie de ochiul utilizatorului: `quality` pe ramura de fotografie.
Restul constantelor sunt fixate de măsurătorile de mai sus.

**Criteriu de ieșire:** textul mic dintr-un screenshot cu cod rămâne citibil la 100%, iar
fișierul e cât mai mic în condiția asta.

Două aserțiuni **automate** intră în suita Vitest, independent de calibrare:

1. Niciun candidat nu depășește numărul de octeți ai originalului.
2. Intrare PNG nu produce niciodată ieșire `image/jpeg`.

#### Rezultatul calibrării

Rulat cu `npm run test:shrink -- --calibrate <cale-poza>` pe două fișiere reale de pe
discul utilizatorului (2026-08-12), iar utilizatorul a comparat decupajele 1:1 rezultate
înainte să aleagă valoarea.

**Cazul 1, decisiv — o captură de telefon.**
`Screenshot_2026-02-05-20-39-01-973_com.sonar.app.jpg`, 1240 KB, 1080×2400. Latura lungă e
sub `maxEdge` (3072), deci fișierul se **recomprimă, nu se redimensionează** — JPEG peste
JPEG, a doua generație de pierderi, pe o captură cu text mic. De-asta acesta, și nu poza de
cameră, decide `photoQuality`.

| maxEdge | quality | rezultat | dimensiuni | vs. original |
|---|---|---|---|---|
| 3072 | 0.92 | 561 KB | 1080×2400 | 2,2× mai mic |
| 3072 | 0.85 | 423 KB | 1080×2400 | 2,9× mai mic |
| 3072 | 0.78 | 349 KB | 1080×2400 | 3,6× mai mic |
| 2048 | 0.85 | 128 KB | 540×1200 | 9,7× mai mic |

**Cazul 2 — o poză de cameră de 200 MP.** `IMG_20260805_113025.jpg`, 13366 KB,
12288×16320.

| maxEdge | quality | rezultat | dimensiuni | vs. original |
|---|---|---|---|---|
| 3072 | 0.92 | 528 KB | 2048×2720 | 25,3× mai mic |
| 3072 | 0.85 | 363 KB | 2048×2720 | 36,9× mai mic |
| 3072 | 0.78 | 288 KB | 2048×2720 | 46,4× mai mic |
| 2048 | 0.85 | 240 KB | 1536×2040 | 55,6× mai mic |

De reținut: la `maxEdge 3072` poza de cameră ajunge la 2048×2720, adică exact ÷6 din
12288×16320 — confirmă regula divizorului întreg funcționând pe un fișier real.

**Decizia: `photoQuality: 0.92`.** Nu 0.85, deși diferența pe hârtie pare mică. Motivul e
marja, nu estetica: la scara asta de stocare (planul gratuit Supabase, sute de KB pe
atașament), diferența de octeți între 0.92 și 0.85 e neglijabilă, dar textul mic dintr-o
captură de telefon care devine ilizibil costă mult mai mult decât spațiul economisit.
Poza de cameră nu are opinie aici — la orice calitate din tabel iese de peste 25× mai mică
decât originalul, deci nu ea decide; capturile de telefon, care se recomprimă fără să se
micșoreze, sunt singurul caz unde calitatea JPEG contează vizibil. Utilizatorul a ales
partea sigură a intervalului.

## Ștergerea în cascadă

Cheia externă șterge **rândurile** din `attachments`, niciodată **octeții**. Trasee
afectate: `deleteIssue` și `deleteProject` (care se sprijină pe cascada din Postgres).

`deleteWave` **nu** are implicații: șterge doar rândul din `waves`, iar `issues.wave` e un
`int` fără cheie externă. În plus, `WaveManager` blochează ștergerea unui val care încă
ține tichete.

**Ordinea: citește căile → șterge rândurile → șterge octeții, best-effort.**

Căile se citesc *înainte*, fiindcă cascada le duce cu ea. Octeții la final, fiindcă dacă
pică ștergerea lor rămân fișiere orfane — invizibile, costă doar spațiu. Invers, rânduri
care arată către obiecte inexistente dau URL-uri semnate care întorc 404 și miniaturi
rupte, adică stricăciune **vizibilă**. Se preferă mereu eșecul invizibil.

`storage.remove()` **nu are voie să arunce** din metoda de repository: altfel `deleteIssue`
raportează eșec pentru o operație care a reușit, iar reîncercarea eșuează altfel (tichetul
nu mai există). Eroarea se înghite și se loghează.

`storage.remove(paths)` e un singur POST cu corp JSON, cu plafon practic în jur de 1000 de
obiecte, iar clientul JS nu împarte singur. Se împarte în tranșe de 100–200, secvențial.

### `deleteIssues(ids)`

Metodă nouă în `Repository`. `src/hooks.ts:167` face acum
`Promise.all([...selectedIds].map(deleteIssue))`, care are două probleme — preexistente,
dar agravate de attachment-uri: lansează 3N cereri concurente (20 de tichete selectate →
60 de cereri), iar `Promise.all` respinge la primul eșec în timp ce restul rămân în zbor,
fără rollback — ștergere parțială plus toast de eroare.

Varianta nouă: un `select ... in (...)`, un `delete ... in (...)`, un `storage.remove()`
în tranșe. 3N cereri devin 3.

### Orfani

Un script, rulat la cerere: `scripts/storage-report.mjs` arată spațiul ocupat per proiect
și obiectele fără rând în tabel, cu opțiune de curățare. Fără trigger și fără coadă de
ștergeri — orfanii apar doar la eșec de rețea în fereastra dintre ștergerea rândului și a
octeților, iar scriptul acoperă și nevoia reală de „cât spațiu mai am".

## URL-uri semnate

`createSignedUrls(paths, ttl)` pentru toate căile unui sheet, într-o singură cerere.

**Se memorează.** Tokenul stă în query string, deci un URL semnat nou e o altă cheie de
cache — iar Supabase servește obiectele cu `cache-control: max-age=3600`. Fără memorare,
fiecare deschidere de sheet redescarcă fiecare miniatură. Un `Map<path, {url, expiresAt}>`
la nivel de modul, refolosit cât timp `expiresAt - now > 60s`, transformă re-randările în
zero trafic.

Expirare **8–24h**, iar upload-ul pune `cacheControl: '31536000'`. Obiectele de la
`{attachmentId}` sunt imuabile (fără upsert), deci cache-ul agresiv e onest. O expirare de
o oră nu e mai sigură — obiectul e oricum accesibil ora aceea — doar garantează ratări de
cache.

Nu există un URL separat de „mărime întreagă": fără transformări de imagine Supabase există
un singur obiect per attachment, deci URL-ul semnat al miniaturii **este** URL-ul folosit și
de lightbox. Deschiderea unui attachment refolosește URL-ul deja semnat pentru miniatură —
fără o a doua rundă de semnare — ceea ce păstrează și hit-ul de cache HTTP descris mai sus.

`vite.config.ts` are acum doar două reguli `runtimeCaching`, ambele pentru Google Fonts,
deci nimic nu prinde `*.supabase.co` și URL-urile semnate **nu** sunt cachate de service
worker azi. Se adaugă totuși o regulă explicită
`{ urlPattern: /\/storage\/v1\/object\/sign\//, handler: 'NetworkOnly' }`, ca documentație
în cod: o viitoare regulă `CacheFirst` pe imagini ar transforma asta într-un bug real.

Transformările de imagine din Supabase (`transform: {width, height}`) sunt Pro+ — exact
motivul pentru care micșorarea din browser duce toată greutatea.

## Paste și drag&drop

**Nu e nevoie de mecanism pentru sheet-uri suprapuse.** `src/ui.tsx` ține `sheets` ca
istoric de navigare, iar `SheetHost` randează exact un copil, cel de deasupra
(`SheetHost.tsx:42-47`). `IssueForm` e montat doar cât e în vârf, deci un listener legat în
propriul `useEffect` nu poate dubla-declanșa.

**Paste:** `document.addEventListener('paste', …)` într-un `useEffect` din `IssueForm`,
curățat la demontare, înregistrat **numai** când tichetul e salvat (`issueId` există). Un
`onPaste` pe containerul secțiunii n-ar fi de ajuns: cursorul e aproape sigur în descriere
sau în notițe, nu în zona de fișiere, deci evenimentul n-ar urca prin ea.

Se renunță imediat dacă `clipboardData` nu are elemente cu `kind === 'file'` — asta lasă
paste-ul de text complet neatins, în orice câmp. **Nu** se filtrează pe `e.target`: dacă
paste-ul aduce fișiere, e attachment oriunde ar fi cursorul, fiindcă un paste de imagine
într-un `textarea` n-ar face nimic oricum. `preventDefault()` doar după ce fișierele au
fost efectiv consumate.

Listenerul **nu** se pune în `SheetHost` cu un `if (sheet.kind === 'issue-form')`: ar
scurge logica de tichet în router și s-ar reînregistra la fiecare schimbare de sheet.
`key={sheet.issueId ?? '__new__'}` din `SheetHost` dă deja remontare per tichet.

**Drop:** browserul navighează dacă nu se cheamă `preventDefault()` pe **amândouă**,
`dragover` și `drop`. Doar pe `drop` e eșecul clasic — `dragover` trebuie prevenit ca
drop-ul să fie permis în primul rând. În plus, un drop care aterizează *în afara* zonei
lovește comportamentul implicit al documentului și scoate utilizatorul din SPA, deci
`App.tsx` primește o pereche `dragover`/`drop` inertă, înregistrată o singură dată.

`Sidebar.tsx:109` are deja un `onDrop` pentru reordonarea proiectelor, cheiat pe
`dragId.current`. Interacțiunea e inofensivă, dar cere o gardă în fiecare direcție:
ambele handlere verifică `e.dataTransfer.types.includes('Files')` — cel din sheet îl cere,
cel din sidebar renunță dacă e prezent. Iar `dragleave` se declanșează la trecerea în
elemente-copil, deci evidențierea zonei folosește un contor sau verifică `relatedTarget`,
altfel pâlpâie (bug latent pe care Sidebar-ul îl are deja).

### `pickFiles` — seam-ul testabil

Nu există `vitest.config.*` și nici jsdom în `devDependencies`, deci Vitest rulează în
`environment: 'node'`. Seam-ul trebuie să fie **fără DOM**, nu doar cu puțin DOM:

```ts
// src/lib/pickFiles.ts — date simple intră, date simple ies
export interface FileLike { name: string; type: string; size: number }
export interface PickInput { types: readonly string[]; files: readonly FileLike[] }
export function pickFiles(input: PickInput): {
  accept: FileLike[]
  rejected: { name: string; reason: 'gol' }[]
}
```

Două adaptoare de trei linii (`fromClipboard(e)`, `fromDrop(e)`) doar reformează
evenimentul; sunt netestate prin design. Toată politica trăiește în `pickFiles`: prezența
lui `'Files'` în `types`, respingerea fișierelor de zero octeți, folderele trase care nu
produc niciun fișier decât intrări de 0 octeți — toate testabile cu obiecte literale. Fără
plafoane de dimensiune — vezi `docs/superpowers/specs/2026-08-12-mobile-attachment-picker-design.md`.

Aceeași separație ca `shrinkPlan` / `shrinkImage`, și e cel mai valoros lucru de portat
din mateSimo.

**Screenshot-urile lipite ajung toate cu numele `image.png`**, deci fiecare `filename` din
tabel ar fi identic. Numele se sintetizează în funcția pură — `screenshot-2026-08-12-14-32-07.png`
— cu ceasul injectat, ca să fie testabil.

Extensia din `filename` urmează `outputType`-ul micșorării, nu formatul de intrare: un PNG
convertit în WebP se salvează ca `.webp`. Extensia e cosmetică (`content_type` din DB e
sursa de adevăr la descărcare), dar un nume care minte despre conținut încurcă pe oricine
descarcă fișierul. Redenumirea se face **după** micșorare, fiindcă abia atunci se știe
formatul final — inclusiv cazul în care garda de dimensiune a păstrat originalul.

## Fișiere

**Noi:**

| Fișier | Ce face |
|---|---|
| `src/lib/shrinkImage.ts` | `shrinkPlan()` pur (decizie + `outputType`) și micșorarea pe canvas |
| `src/lib/pickFiles.ts` | Event → listă de fișiere, plafoane, nume sintetizate. Fără DOM |
| `src/data/attachments.ts` | `listAttachments` / `uploadAttachment` / `deleteAttachment` / cache de URL-uri semnate |
| `src/components/Attachments.tsx` | Secțiunea: miniaturi, rânduri, X cu confirmare, drop-zone. Prop `readOnly` pentru randarea din `IssueSheet` |
| `src/components/Lightbox.tsx` | Imagine pe tot ecranul, cu descărcare |
| `supabase/migration-attachments.sql` | Tabel, indecși, RLS pe `attachments` și pe `storage.objects` |
| `scripts/test-shrink-image.mjs` | Harnessul de calibrare (portat), cu `--calibrate` |
| `scripts/storage-report.mjs` | Spațiu per proiect, obiecte orfane, curățare opțională |

**Modificate:**

| Fișier | Ce se schimbă |
|---|---|
| `src/components/IssueForm.tsx` | Randează `<Attachments>` sub notițe; leagă paste și drop când `issueId` există |
| `src/components/IssueSheet.tsx` | Randează `<Attachments readOnly>` sub „Permite" |
| `src/data/repository.ts` | `deleteIssues(ids)` în interfață |
| `src/data/supabaseRepository.ts` | `deleteIssue` / `deleteProject` curăță octeții; `deleteIssues` |
| `src/data/localRepository.ts` | `deleteIssues` (fără attachment-uri — nu au sens în modul local seeded) |
| `src/hooks.ts` | Ștergerea în masă folosește `deleteIssues` |
| `src/App.tsx` | Pereche `dragover`/`drop` inertă la nivel de document |
| `vite.config.ts` | Regulă `NetworkOnly` pe `/storage/v1/object/sign/` |
| `src/styles.css` | Stiluri pentru miniaturi, rânduri de fișier, drop-zone, lightbox |

`Repository` **nu** primește metode de attachment: interfața are și o implementare locală
(`localRepository`), iar attachment-urile n-au sens în modul local seeded. În modul local
secțiunea nu se randează.

## Ce nu se face

- Nu se schimbă navigația: `openIssue` continuă să deschidă `IssueForm`. `IssueSheet`
  rămâne cardul de previzualizare a unei dependențe.
- Nu se adaugă attachment-uri în API-ul din `functions/api/` (ticket-kit nu le cere).
- Nu există referințe markdown în descriere.
- Nu există soft delete, coș de gunoi, trigger de ștergere sau coadă de curățare.
- Nu se cachează octeții pentru offline.
- Nu se folosesc transformările de imagine din Supabase (sunt Pro+).
- Nu se apelează `storage.list()` din client.
