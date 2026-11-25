# Reîmprospătare, liste lungi, offline

> Mutat din `CLAUDE.md` (2026-11-04), neschimbat.

## Reîmprospătarea datelor — de ce nu golește ecranul

Datele se cer din nou la revenirea în tab: asta e tot ce face „un tichet creat
pe telefon se vede pe web". Două reguli o țin suportabilă.

**`loading` e doar al PORNIRII.** Cât e true, `App` înlocuiește tot `<main>` cu
„Se încarcă…", deci vizualizarea se demontează — iar odată cu ea `SplitView`,
al cărui cleanup de `registerSplitHost` duce `dockedIssueId` la null și face
tichetul docat să clipească ca modal peste listă. De-aia `refresh()` ridică
`refreshing`, nu `loading`: datele vechi rămân pe ecran, iar singurul semn e
iconița care se rotește în header. Nu muta `loading` înapoi în `refresh()`.

**Revenirea în tab trece printr-un prag** (`src/lib/refreshGate.ts`, 30s):
comuți pe alt tab să copiezi un link și te întorci — asta nu e un motiv de
rundă completă către Supabase. Refresh-ul EXPLICIT (butonul din header,
tragerea în jos) nu consultă pragul niciodată: acolo omul a cerut datele, iar
un refuz tăcut ar arăta ca un buton stricat.

**`refresh()` reîncarcă și celelalte proiecte din memorie** (numai tichetele,
`otherLoadedProjects` din `refreshGate.ts`). Un tichet deschis din „Azi” își
încarcă proiectul în `allIssues`, iar acolo varianta din memorie bate lista
proaspătă (`dueIssues`). Reîncărcat doar proiectul de pe ecran, Inbox-ul
rămânea poza de la deschidere: restanțele mutate pe azi de pe telefon nu
dispăreau de pe laptop (2026-11-04).

Realtime (`postgres_changes`) ar da „instant" cu ambele dispozitive deschise,
dar nu înlocuiește nimic de mai sus: canalul cade cu tabul în fundal și cu
telefonul adormit, deci resyncul la revenire rămâne oricum necesar.

## Listele lungi nu se randează la o atingere

`TaskRow` și `TicketCard` sunt `memo` și **nu citesc `useUI()`**: contextul UI
se schimbă la orice deschidere de foaie, iar citit în rând randa din nou toată
lista (cu ~300 de sarcini, ~1s pe telefon până apărea foaia, 2026-10-13). Ce
le trebuie vine ca props stabile (`docked`, `onOpen` prin ref în `App` /
`OrdineView`). Deschiderea din „Azi" încarcă proiectul în store (în spate:
foaia nu-l mai așteaptă, vezi `planOpen` și `docs/agent/viteza-deschidere.md`), iar listele se
reconstruiesc cu obiecte noi pentru aceleași sarcini — de-aia `TaskRow` citește
store-ul într-un strat subțire și compară sarcina după valoare (`sameRow`).
Un câmp nou citit dintr-un context în rând trebuie să treacă pe aici, altfel
regresia revine fără să pice vreun test.

## Offline — baza locală și coada

Omul folosește aplicația ca listă zilnică de sarcini, iar regula de care
depinde tot restul e: **o sarcină capturată nu se pierde**, nici în metrou,
nici pe un semnal de o liniuță. Pe Supabase, `src/data/index.ts` învelește
repository-ul cu `createOfflineRepository` (`src/data/offline/`); nicio
componentă nu știe că învelișul există, în afară de indicatorul din header și
de puntea care redenumește un tichet provizoriu. Modul local
(`localRepository`) nu-l folosește — n-are server de așteptat. Spec:
`docs/superpowers/specs/2026-10-02-offline-baza-locala-design.md`.

**Baza e adevărul serverului; coada e ce încă n-a ajuns acolo.** În IndexedDB
(`kv.ts`, nu SQLite: merge la fel în browser, în Electron și în Capacitor) stau
două lucruri separate: ultimul răspuns primit de la server pentru fiecare listă
și coada de scrieri netrimise. Ce vede aplicația e baza cu coada rejucată
deasupra (`overlay` din `ops.ts`) — nu o bază pe care o editează clientul. Așa
un răspuns proaspăt de la server nu poate „anula" o scriere încă în coadă:
scrierea se rejoacă peste el până pleacă. Primul cadru citește `repository.cache`
direct, fără să aștepte rețeaua; o citire de rețea care pică (sau atârnă peste
prag, 10s) cade pe bază, una refuzată de server NU — un refuz nu e o lipsă de
rețea.

**Offline merg doar tichetele:** creare, editare, ștergere, „văzut". Restul
(proiecte, valuri, teme, obstacole, oameni, firul) trece prin `net()` și
spune onest `Necesită rețea — ești offline.` A pune la coadă fiecare entitate
ar fi cerut un `overlay` pentru fiecare, iar captura zilnică n-are nevoie de
ele. De-aia `IssueForm` scrie obstacolele DUPĂ tichet și doar dacă setul s-a
schimbat: offline tichetul se salvează, iar bannerul spune că obstacolele nu.

**Un tichet creat offline are ID provizoriu, `PREFIX-~abc123`** (`makeTempIssueId`,
`isTempIssueId`). Numărul real îl dă serverul, iar două dispozitive offline ar
fi ales amândouă `HZ-13`. La trimitere coada își rescrie scrierile rămase pe
ID-ul real (`remapOp`), emite `remap`, iar `remaps` ține minte traducerea
provizoriu → real, pe disc: un formular deschis pe `HZ-~…` își păstrează cheia
peste remapare (ca să nu piardă ce e nesalvat), deci salvarea lui poartă încă
ID-ul vechi, iar `resolveId` îl traduce în ultima clipă, sub lacătul cozii.
Remaparea se înregistrează ÎNAINTE de a elibera lacătul — altfel o salvare care
îl aștepta ar fi găsit coada goală și ID-ul netradus.

**Captura intră întâi în coadă, apoi așteaptă puțin.** `createIssue` scrie pe
disc, pornește golirea și așteaptă numărul real cel mult 3s (`createWaitMs`).
Pe semnal slab `navigator.onLine` rămâne `true`, iar un fetch direct putea
atârna minute întregi: adăugarea rapidă stătea în „se salvează…", iar o
aplicație închisă între timp pierdea sarcina. După prag primești ecoul
provizoriu și golirea continuă în fundal. Pragul NU taie cererea — ea poate
încă ajunge la server, iar o retrimitere ar dubla tichetul; de-aia nicio
SCRIERE nu are timeout, doar citirile. Editarea și ștergerea merg direct la
server cât coada e goală și intră în coadă la eroare de rețea sau când coada
are deja ceva (altfel ar depăși scrieri mai vechi și ar inversa ordinea).

**Trei feluri de eșec, trei soarte** (`netError.ts`). *Rețea* (`isNetworkError`,
după mesaj, nu după `TypeError` — un bug de cod n-are voie să stea la coadă la
nesfârșit): elementul rămâne, se aprinde „offline". *Autentificare*
(`isAuthError`: 401/403, `PGRST301`/`PGRST302`/`42501`, iar `PGRST116` doar la
creare): elementul rămâne, „offline" NU se aprinde — fără sesiune supabase-js
cade pe cheia anonimă, RLS respinge tot, iar luate drept refuz golirea ar fi
aruncat coada întreagă. *Refuz* (orice altceva, inclusiv `PGRST116` la o
actualizare — tichetul chiar nu mai există): elementul iese din coadă, ca să n-o
blocheze, și se anunță prin `failed`; o creare refuzată își ia cu ea scrierile
care-i foloseau ID-ul și își spune titlul în mesaj, fiindcă după ea sarcina
dispare de pe ecran.

**Golirea pornește doar cu o sesiune** (`canFlush`, legat de utilizatorul din
`onAuthStateChange`) și o declanșează: încărcarea modulului, sosirea sesiunii
(`SIGNED_IN`/`TOKEN_REFRESHED`/`INITIAL_SESSION`), evenimentul `online`,
trecerea statusului din offline în online (o citire sau o scriere a răspuns),
fiecare scriere pusă la coadă, revenirea în tab (prin `refresh`) și un ceas de
reîncercare cât coada are elemente (5s, 15s, apoi la 60s; coada goală îl
oprește). Ceasul există pentru semnalul slab: acolo `online` nu vine niciodată.
Între file, Web Locks (`horizontal-outbox`) lasă o singură filă să golească, iar
`BroadcastChannel` le spune celorlalte ce s-a schimbat (`channel.ts`). Headerul
spune „se trimite" doar cât o golire chiar trimite (`syncing`), și altfel doar
„N în așteptare" (`src/lib/syncLabel.ts`) — o coadă oprită care s-ar anunța
„se trimite" ar minți exact când omul se uită de ce nu pleacă nimic.

**Deconectarea** (`src/lib/logoutPlan.ts`, `Sidebar.tsx`): refuzată offline —
`signOut` ar pica și coada ar fi fost deja ștearsă; cu scrieri netrimise cere
confirmare; iar coada se șterge (`sync.clear`) abia DUPĂ ce serverul a încheiat
sesiunea. După logout n-are cine s-o mai trimită.

**O citire depășită de o golire nu scrie peste bază.** Un `listIssues` plecat
înainte ca o scriere să intre pe server, dar întors după ce golirea a scos-o
din coadă, ar fi pus în bază lista veche, fără niciun element rămas care s-o
rejoace — modificarea abia sincronizată ar fi dispărut până la următorul
refresh. `settle` crește `generation` la fiecare element încheiat; citirea
compară generația de la plecare cu cea de la sosire și, dacă s-a mișcat,
răspunde din bază în loc s-o suprascrie.

**Reconectarea reîncarcă tot, fără prag.** Pornit offline, ecranul e din baza
locală, iar revenirea rețelei golea doar coada, deci listele rămâneau vechi.
`syncRefreshStep` (`refreshGate.ts`) cere un `refresh()` la offline → online și
încă unul când coada rămasă de offline ajunge la 0. O captură online (1 → 0) nu
contează. Mai declanșează și evenimentul `online`. **Lista de proiecte e
autoritară peste bază:** un proiect pe care serverul nu-l mai întoarce (șters,
acces pierdut) e filtrat din citirile offline (`allCachedIssues`), iar cheile
lui `p:<pid>:*` se șterg (`readProjects`). Altfel tichetele lui reapăreau ca
fantome la fiecare pornire fără rețea (2026-10-05, tichetele de probă Android).

Ce NU există, deliberat: o cheie de idempotență pe server pentru `createIssue`
(cere o migrare pe baza de producție — decizia omului; până atunci, singura
plasă contra dublurilor e că nimic nu retrimite o creare încă în zbor), un
timeout pe scrieri (o scriere abandonată poate ajunge totuși, iar retrimiterea
ar dubla-o) și reconectarea la o bază IndexedDB închisă de browser. Fără
IndexedDB deloc (fereastră privată pe unele browsere), învelișul trece direct
la server, ca înainte.

Teste: `src/data/offline/*.test.ts` (cu `fake-indexeddb`: coada, remaparea,
golirea, clasificarea erorilor, pragul capturii, generația) plus
`src/lib/syncLabel.test.ts` și `src/lib/logoutPlan.test.ts`. Rulează
`npx vitest run src/data/offline src/lib` după orice atingere a stratului.
