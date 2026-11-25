# Mod To-Do, notificări, service worker

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Mod To-Do — ce e și ce cere ca setup

Pe lângă proiecte cu layere și valuri, aplicația e și listă de sarcini: un tichet
poate avea **scadență** (`due_at`, `all_day`, `remind_at`), iar listele
inteligente **Azi / 7 zile** taie transversal toate proiectele.
Decizii și de-ce-uri: `docs/superpowers/brainstorm/2026-08-24-mod-todo.md`.
Mockup vizual: `prototype-todo.html`.

**„7 zile" începe de MÂINE** (decizia omului + designer, 2026-10-14): zilele
+1..+7 (`WEEK_FIRST_OFFSET`/`WEEK_LAST_OFFSET`, `buildSmartLists`), iar azi și
restanțele stau numai în „Azi" — nimic nu apare în ambele liste, deci nici nu
se numără de două ori. Lista „Mâine" a dispărut (era primul grup din „7 zile"
încă o dată); o stare veche `'tomorrow'` (`LAST_VIEW_KEY`, `hzScreen`) se
citește ca `'week'` (`toScreen` din `App.tsx`). Captura din „7 zile" primește
mâine (`smartListDueAt`), altfel ar dispărea din lista în care ai scris-o.
Fetch-ul (`smartListRange`) cere până la începutul zilei +8, exclusiv.
**Widget-ul și filtrele salvate NU s-au mutat:** ele rămân pe azi + 6
(`SMART_LIST_DAYS`), fiindcă widget-ul își grupează singur rândurile în
`core/Agenda.kt` (APK) și le arată pe toate într-o singură listă.

**Inbox e doar un proiect.** Fiecare sarcină are în continuare un proiect; Inbox
(fost „✅Daily", id `d`) e cel în care cade o captură fără proiect ales — din
liste, rândul de pe desktop, bara de pe Linux, fereastra nativă. Regula e
`captureDefaultProjectId` (`src/lib/quickDraft.ts`): dintr-un proiect deschis,
acela; altfel Inbox; fără Inbox, primul personal. Selectorul și `#nume` schimbă
doar sarcina în curs. **Nu se ține minte ultima alegere**, deliberat: memoria
trimitea capturile nevăzut într-un proiect „doar mementouri" (ascuns până sună)
— omul a scris aceeași sarcină de trei ori și n-a găsit-o. Inbox se recunoaște
după id, apoi după nume (`inboxProjectId`/`isInboxProject`, oglindit în
`core/Capture.kt`), nu după numele afișat: numele e al omului. `#inbox` și
`#daily` merg amândouă. Iconița lui (`inbox`) ține locul bulinei, prin
`ProjectMark` — de-aia numele nu mai are nevoie de emoji.
În sidebar Inbox stă **primul**, oricare ar fi ordinea trasă (`inboxFirst`
din `src/lib/projectOrder.ts`); nu se trage, iar un proiect lăsat peste el
trece imediat după (`reorderWithInboxFirst`). În sertar stă oricum deasupra
proiectelor, lângă liste.

**Închiderea unei foi nu e o navigare înapoi.** La deschidere se împinge o
intrare de istoric (ca Back să închidă foaia), iar la închidere se desface cu
`history.back()` — dar un back orb presupune că în spate e ecranul pe care
erai. Dacă acolo stă alt tichet, `popstate` își face datoria și îl deschide:
ștergeai o sarcină din „Azi" și îți sărea în panou un tichet din alt proiect.
De-aia `behindTicket` din `App.tsx` reține ce era în bară înainte de împingere,
iar `back()` se face doar dacă acolo NU e tot un tichet; altfel URL-ul se
rescrie pe ecranul curent, fără navigare. `null` (deep link rece, sau pagină
reîncărcată peste un card deschis) înseamnă „nu noi am împins-o", deci tot fără
navigare.

**Un URL de tichet spune CE e deschis, nu PE CE ecran.** Un card deschis dintr-o
listă inteligentă se deschide peste listă, iar `/HZ-12` din bară nu poartă
informația asta — de-aia ramura de tichet din efectul de boot (`App.tsx`)
restaurează lista memorată din `LAST_VIEW_KEY`, iar `settleUrl` așază `/` cât
timp o listă e pe ecran. Fără cele două, o repornire cu cardul deschis ateriza
pe boardul proiectului și ștergerea ducea mai departe, pe ultimul proiect
folosit. Repornirea nu e ipotetică: `pwa.ts` aplică un build nou la revenirea în
tab, adică reîncarcă pagina exact peste cardul deschis.

**Ordinea în „Azi” și „7 zile”** (fiecare grup de zi, și Restanțe):
urgentele întâi (între ele cele cu oră cronologic, apoi cele fără), apoi cele
cu oră cronologic, la coadă cele fără oră (decizia omului, 2026-10-11 — înainte
era invers). De ce: lista e ordinea în care se fac lucrurile — urgentul primul,
apoi ce are oră fixă, iar „cândva azi” umple golurile. În Restanțe (mai multe
zile) ziua rămâne criteriu în interiorul fiecărui nivel de urgență: cea mai
veche întâi. O singură regulă, `compareDue` (`schedule.ts`), folosită și de
filtrele salvate și de `mergeDay` (evenimentele de calendar intră printre cele
cu oră, nu între urgente). Widget-ul o oglindește în `core/Agenda.kt`
(`order`, fixtures `agenda.fixtures.json`) — ajunge pe telefon doar cu APK nou.

**„Azi” și „7 zile” arată doar sarcinile MELE** (`isMine`, vezi „Firul și
pasarea”): o sarcină pasată altcuiva dispare de aici, dar rămâne în proiect.

Scadența se vede și în **modul proiecte**, pe card („Ordine") și pe rând
(„Listă"): `src/components/DueChip.tsx` — ziua, ora **doar dacă** are una,
clopoțelul **doar dacă** are memento, roșu dacă e restanță. Un tichet fără
scadență nu arată nimic: acolo absența e informația, iar în modul proiecte
scadența e excepția. (În listele inteligente coloana de oră e goală fără oră, iar un grup
fără nicio oră n-o mai ține deloc — „—" ocupa ~50px pe rând și nu spunea nimic,
2026-10-14.) Clopoțelul e exportat din `DueChip` și folosit de
ambele, ca „are memento" să arate identic în cele două moduri.

Recunoașterea datei din text e legată de interfață printr-un singur hook,
`useTitleDate` din `src/hooks.ts` — folosit și de adăugarea rapidă, și de titlul
tichetului din formular. El ține și refuzul, iar refuzul e pe **fragment**, nu pe
stare: fragmentele refuzate se ascund de parser cu `maskRejected`, care păstrează
lungimea textului, deci indicii rămân valizi. Un refuz global se stinge la
următoarea tastă și fragmentul respins se reaprinde singur — de-aia nu mai există.
Refuzul ține însă doar cât ține fragmentul în text (`liveRejections`): ștergi
„la 10", refuzul se uită; îl scrii din nou, se recunoaște din nou.

Cod: `src/lib/schedule.ts` (bucketizare pe zile locale, restanțe, sortare),
`src/lib/parseDue.ts` (data din titlu, RO+EN), `src/lib/pushPayload.ts`
(contractul cu service worker-ul). Toate trei sunt pure și au fixtures — la fel
ca `engine.ts`. Nu pune logică de dată în componente.

### Referința din aplicație (Ctrl+,)

`src/components/InfoPanel.tsx` — scurtăturile, ce înțelege recunoașterea datei, și
regulile care nu se văd din interfață. Tabelul de exemple **nu e scris de mână**:
se calculează la randare cu `parseDue`, față de ora curentă. Un tabel scris ar
rămâne în urmă la prima schimbare a parserului și ar minți exact acolo unde
oamenii vin să afle adevărul. Dacă adaugi un tipar în parser, adaugă un exemplu
în `GROUPS` — nu o descriere.

### Pașii de setup pentru scadențe

```bash
npm run migrate supabase/migration-todo.sql
```

### Pașii de setup pentru notificări (web push)

Merg făcuți în ordine; până la pasul 4, comutatorul din lista „Azi" raportează
onest că nu se poate.

1. `npm run migrate supabase/migration-push.sql`
2. `npm run vapid` → pune cheia publică în `.env` ca `VITE_VAPID_PUBLIC_KEY`.
3. `supabase functions deploy send-reminders` și apoi
   `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:tu@exemplu.ro`
   - Și, ca butoanele notificării să meargă **fără nicio filă deschisă**:
     `supabase functions deploy reminder-action --no-verify-jwt` — fără flag nu
     pornește, fiindcă tokenul ESTE autorizarea, nu un JWT de Supabase. Apoi
     `supabase secrets set REMINDER_ACTION_SECRET=$(openssl rand -hex 32) APP_ORIGINS=https://domeniul-tau`.
     Dacă sari peste asta, mementourile merg în continuare — doar butoanele cad
     pe comportamentul vechi (cer o filă deschisă).
4. În SQL editor, o dată, pentru ca pg_cron să poată chema funcția:
   `select vault.create_secret('https://<ref>.supabase.co', 'project_url');`
   `select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');`
5. `npm run migrate supabase/migration-cron.sql` (dacă `pg_cron`/`pg_net` nu sunt
   activate, activează-le din Dashboard → Database → Extensions).
6. Pe iPhone: **adaugă aplicația pe ecranul de start**, altfel Push API nu există
   deloc. Permisiunea se cere din butonul „Activează" — niciodată la pornire.

Verificare, în două locuri — și al doilea e cel care contează:

```sql
-- 1. A pornit cronul? (`job_run_details` n-are `jobname` — join pe `jobid`)
select d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname = 'send-reminders' order by d.start_time desc limit 10;

-- 2. Ce a răspuns funcția? `succeeded` mai sus înseamnă doar „cererea a intrat
--    în coadă": pg_net e asincron. Aici se vede dacă s-a trimis ceva.
select status_code, content, created from net._http_response
order by created desc limit 5;   -- se păstrează ~6h (pg_net.ttl)
```

Un `{"reminders":1,"sent":0}` înseamnă „am găsit mementoul, dar niciun dispozitiv
nu e abonat" — și tichetul se marchează oricum ca trimis, deliberat (vezi
comentariul din funcție). Deci **abonează-te din browser înainte** de a testa cu
un memento la care ții.

### Serii de mementouri

„la fiecare 15 minute până la 10" e UN tichet cu `ping_every` (`remind_at` =
primul ping, `due_at` = capătul); `send-reminders` are pentru ele o a doua
interogare, care REVENDICĂ pingul curent (`reminder_sent_at` = ultimul ping
trimis) înainte să-l trimită, iar notificarea are doar „Gata" = am văzut pingul
(nu bifează; seria se bifează din aplicație). Tot restul —
vocabularul, fereastra, rostogolirea zilnică, ordinea de deploy — în
`recurente-fixate-rutine.md`, „Serii de mementouri". Un `{"series":N}` în
răspunsul funcției = câte pinguri a revendicat rularea.

### Service worker-ul e scris de mână

`src/sw.ts` + `strategies: 'injectManifest'`, pentru `push` și
`notificationclick`. El reproduce explicit contractul de care depinde strategia
de update din `src/pwa.ts` (precache, `clientsClaim`, **fără** `skipWaiting` la
instalare, ascultător de `SKIP_WAITING`).

> **După orice modificare în `src/sw.ts`, `src/pwa.ts` sau blocul VitePWA din
> `vite.config.ts`: `npm run test:upgrade`.** Testul acela e singurul care prinde
> clasa de bug „userul rămâne pe buildul vechi și trebuie să dea refresh".

Butoanele notificării („Gata", „Amână 5 min") NU lovesc `functions/api`: acela
cere `X-API-Key`, iar un service worker livrat browserului nu poate ține un
secret. Ordinea de preferință e în `resolveAction` din `src/sw.ts`:

1. **Cu o filă deschisă** — workerul trimite un mesaj paginii, iar pagina face
   mutația (ascultătorul din `App.tsx`). Preferată nu din constrângere, ci
   fiindcă pagina își reîmprospătează și interfața.
2. **Fără nicio filă** — cererea semnată către `supabase/functions/reminder-action`,
   cu un token HMAC pe care `send-reminders` l-a pus în payload. Payload-ul de
   push e criptat pentru abonament (RFC 8291), deci tokenul e un secret pe care
   workerul îl **primește**, nu unul pe care îl ține. Format și de-ce-uri:
   `supabase/functions/_shared/reminderToken.ts`.
3. **Dacă și asta cade** (offline, token expirat, secret nesetat) — se deschide
   tichetul. O atingere în loc de zero, dar onest: mai bine decât o acțiune care
   pare făcută și nu s-a întâmplat.

Ce nu repară niciun header: **Doze și managerele de baterie de pe Android.**
Chrome nu trezește un dispozitiv adormit nici cu `urgency: high`, iar
MIUI/Samsung pot întârzia livrarea cu ore. `TTL: 3600` există exact pentru asta
— un memento răsuflat nu mai e informație, e zgomot care învață omul să ignore
notificările. Plafonul, măsurat, și ce ar cere o garanție reală:
`docs/superpowers/brainstorm/2026-08-25-clienti-nativi.md`.

### Sunetul mementoului

**O notificare web nu poate avea sunet propriu.** `Notification.sound` a rămas în
draftul de spec și n-a fost implementat de niciun browser. Cu aplicația închisă
se aude sunetul sistemului, și nu se poate schimba — nu insista, nu există flag.

Ce se poate: cu o filă VIZIBILĂ, `src/sw.ts` trimite `reminder-arrived` paginii
și pune `silent: true` pe notificare, iar `src/lib/chime.ts` cântă. Condiționat,
nu necondiționat: cu aplicația închisă pagina nu poate cânta nimic, iar o
notificare mută la 7 dimineața e un memento ratat.

Clopoțelul e **generat cu Web Audio**, nu un fișier: un asset ar fi intrat în
manifestul de precache, adică în contractul de update de mai sus. Sunetul se
deblochează la primul `pointerdown`/`keydown` pe document — politica de autoplay
cere un gest, iar mesajul unui service worker nu e un gest; un `resume()` cerut
atunci e refuzat în silență și primul memento ar veni mut.

Pentru a itera pe sunet fără deploy: `tmp-calibrare/sunet/` (gitignorat) conține
variantele randate în WAV cu aceeași sinteză. Nota actuală (E5, o singură notă) a
fost aleasă prin ascultare comparativă.
