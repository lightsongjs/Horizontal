# Offline — baza locală și coada de scrieri — design

**Data:** 2 octombrie 2026. **Precedent:** `docs/superpowers/brainstorm/2026-08-25-clienti-nativi.md`
(analiza Linux + Android) și `docs/superpowers/brainstorm/2026-09-22-android-v1-predare.md`
(propunerea „taie coada în două"). Cerința s-a schimbat față de amândouă: aplicația de
Linux are ca acțiune principală **captura** dintr-o bară globală, deci crearea de
sarcini offline **intră** în v1 — exact piesa pe care ambele note o lăsau pe dinafară.

Este etapa **1** din cinci. Ordinea și motivul ei sunt la final.

## Scopul

Două lucruri, și al doilea îl dă gratis pe primul:

1. **Aplicația pornește instant**, din datele de data trecută, fără „Se încarcă…".
2. **Merge fără rețea**: se citește tot și se editează ce contează; la revenirea
   rețelei se sincronizează singură.

Viteza nu vine dintr-o bază mai rapidă, ci din a nu mai aștepta rețeaua. Datele unui
singur utilizator au câțiva MB și stau oricum toate în memorie (`store.tsx`); baza
locală e citită o dată la pornire și scrisă în fundal.

## Unde se pune: a treia implementare de `Repository`

`src/data/repository.ts` are interfața; `localRepository.ts` și
`supabaseRepository.ts` sunt implementările. Offline-ul e **un înveliș** —
`offlineRepository.ts` — care implementează aceeași interfață și deleagă la cel de
Supabase. Nicio componentă nu află ce backend are dedesubt.

Fiindcă stă în codul comun, îl primesc toate trei: **browserul**, **aplicația de
Linux** (care încarcă același site) și **Android** (Capacitor, mai târziu).

### De ce IndexedDB

Merge identic în browser, în Electron și în WebView-ul Capacitor — deci se scrie o
dată. În Chromium e LevelDB (C++) dedesubt. SQLite ar fi la fel de rapid aici, dar ar
cere o a doua implementare pentru browser și o a treia pe Android. Dacă volumul ar
crește cu ordine de mărime, se schimbă în spatele aceleiași interfețe.

Acces printr-un strat subțire scris de noi peste API-ul nativ (`idb` ca dependință e
acceptabil dacă scurtează codul; decizia în plan). Teste cu `fake-indexeddb` în vitest.

## Ce merge offline — decizia utilizatorului (varianta A)

| Merge offline | Cere rețea (eroare explicită „necesită rețea") |
|---|---|
| Citirea a tot ce e în cache | Comentariu și pasare (`postToThread`) |
| `createIssue` (bara de captură și aplicația) | Atașamente |
| `updateIssue`: bifare, amânare, titlu, scadență, proiect, val, prioritate, dependențe | `createProject` / `deleteProject` / `updateProject` |
| `deleteIssue`, `deleteIssues` | Valuri, teme, obstacole, membri, `ensureAssigneeForMember` |
| `markSeen` (pus la coadă, nu e critic) | Citirea firului (`listEvents`) — firele nu intră în cache |

Butoanele din coloana a doua rămân vizibile; la offline spun „necesită rețea" în loc
să pară că au mers. Eroarea e un tip propriu (`OfflineError`), nu un mesaj de rețea
generic, ca interfața să-l poată deosebi de o eroare reală.

## Citirile

- **Cache complet, nu doar ce s-a deschis.** Store-ul de azi încarcă numai proiectul
  curent; offline asta ar însemna că un proiect nedeschis recent n-are date. Deci,
  după pornire și după fiecare sincronizare, se aduc **toate** proiectele în fundal
  (volum mic, un singur utilizator). `listDueIssues` și `listInbox` se servesc din
  același cache când nu e rețea — derivate local, cu aceleași reguli ca serverul
  (`DueRange`, `assignee_id = al meu`).
- **Pornire.** Store-ul randează din cache imediat (`loading` devine `false` fără să
  aștepte rețeaua), apoi rulează drumul de reîmprospătare existent, care ridică
  `refreshing`, nu `loading` — regula din CLAUDE.md, „Reîmprospătarea datelor", se
  păstrează neschimbată. La primul login pe un dispozitiv cache-ul e gol și se
  așteaptă rețeaua, ca azi.
- **Rezultatul de la server înlocuiește cache-ul** pentru ce a adus, cu o excepție:
  tichetele cu scrieri încă în coadă păstrează valorile locale peste cele de la server
  (altfel un refresh ar „anula" vizual o bifare netrimisă).

## Scrierile — coada

- Fiecare scriere permisă offline se **aplică imediat în cache** și se adaugă într-o
  **coadă persistentă** în IndexedDB (supraviețuiește închiderii aplicației).
- Coada se golește **în ordine**, cât timp e rețea, și se reia la `online`, la
  revenirea în tab și la pornire. Un element reușit se scoate; o eroare de rețea
  oprește golirea (se reia mai târziu); o **eroare de server** (4xx, RLS, constrângere)
  scoate elementul, readuce tichetul la valoarea de pe server și arată eroarea — nu
  blochează restul cozii la infinit.
- **Se trimit doar câmpurile schimbate.** De aici iese regula de conflict cerută:
  ultima scriere câștigă, **câmp cu câmp**. Excepție asumată: `deps` e un set
  înlocuit întreg (`updateIssue` șterge și reinserează muchiile), deci pentru
  dependențe câștigă ultimul set, nu o unire.
- **Patch-uri succesive pe același tichet** se pot comprima într-unul înainte de
  trimitere; ordinea între tichete diferite se păstrează.
- `enqueueWrite` din `store.tsx` (serializarea per tichet) rămâne: coada offline e
  dedesubtul lui, deci promisiunea store-ului se rezolvă la aplicarea în cache, nu la
  confirmarea serverului.
- **Mai multe file:** doar una golește coada, prin Web Locks
  (`navigator.locks.request`). Celelalte află de schimbări prin `BroadcastChannel`.

### ID-uri provizorii

`HZ-12` e calculat de client ca „cel mai mare + 1" (`supabaseRepository.ts:386`). Două
dispozitive offline ar crea amândouă `HZ-13`. Deci:

- Un tichet creat offline primește un **ID provizoriu**, distinct vizual (afișat ca
  `HZ-·`) și imposibil de confundat cu unul real.
- La golire, `createIssue` primește ID-ul real de la server; coada și cache-ul
  **rescriu** ID-ul provizoriu peste tot: în patch-urile ulterioare din coadă, în
  `deps`-urile altor tichete, în URL dacă tichetul e deschis, în sheet-ul docat.
- Cât e provizoriu, linkul tichetului nu se poate copia (butonul spune de ce).
- Un tichet creat cu rețea primește ID-ul real direct, ca azi — calea provizorie e
  doar pentru offline.

### Recurențe

Saltul rămâne în trigger-ul Postgres (`issues_zz_advance_recurrence`) — autoritatea
nu se mută. Offline, cache-ul aplică saltul local cu aceeași funcție pe care o
folosește deja `localRepository` (`src/lib/recurrence.ts`), ca bifarea să se vadă.
La sincronizare serverul recalculează **din ziua trimiterii**; diferența (bifat luni
offline, trimis joi → ajustat la joi) e acceptată de utilizator. După răspuns,
cache-ul ia valoarea serverului. Anularea (`recurrenceUndo`) funcționează peste
cache la fel ca azi.

## Indicatorul din interfață

În header, discret, mono: `offline` și, dacă există, `· 3 în așteptare`. Nimic când
totul e sincronizat. Iconița de `refreshing` existentă rămâne semnul pentru
reîmprospătare.

## Sesiune și logout

- **Offline nu deloghează.** Cu tokenul expirat și fără rețea, supabase-js nu poate
  reîmprospăta sesiunea; aplicația trebuie să rămână în interfață pe cache, nu să
  arunce la `Login`. De verificat în plan cum se poartă `useAuth` / `App.tsx:952` în
  starea asta și de acoperit cu un test.
- **La logout** se șterg baza locală și coada de pe acel dispozitiv. Dacă coada nu e
  goală, logout-ul avertizează („3 modificări netrimise se vor pierde").

## Shell-ul aplicației offline

Service worker-ul face deja `precacheAndRoute` (`src/sw.ts:47`), deci JS/CSS sunt
locale. **De verificat în plan**: o navigare rece offline pe `/HZ-12` (deep link)
trebuie să primească `index.html` din precache — nu e clar că există o rută de
navigare. Orice atingere a lui `src/sw.ts` cere `npm run test:upgrade`.

## Ce NU intră

- Comentarii, pasări, atașamente, proiecte, valuri, teme, obstacole offline.
- Realtime (`postgres_changes`) — resyncul la revenire rămâne mecanismul.
- Rezolvare de conflicte cu interfață („alege versiunea"): ultimul câmp câștigă.
- SQLite, OPFS, orice al doilea motor de stocare.

## Riscuri cunoscute

- **Un patch pe un tichet șters între timp pe alt dispozitiv** → eroare de server la
  golire → elementul se scoate și se anunță. Nu se recreează tichetul.
- **Cota IndexedDB** — irelevantă la volumul ăsta; atașamentele (singurul lucru mare)
  nu intră în cache.
- **Divergența cache vs. server după o eroare** — tratată prin readucerea tichetului
  la valoarea de pe server, nu prin reîncercare oarbă.

## Testare

TDD, vitest + `fake-indexeddb`, pe `offlineRepository` izolat (Supabase mock-uit, ca
în `supabaseRepository.test.ts`):

1. Pornire cu cache plin → citirile răspund fără niciun apel de rețea.
2. Offline: creez, editez, bifez → cache-ul arată schimbările; coada are 3 elemente.
3. Revine rețeaua → coada se golește în ordine; ID-ul provizoriu e remapat în
   `deps`-ul altui tichet și în patch-ul care îl urma.
4. Repornire cu coada plină → coada supraviețuiește și se golește.
5. Conflict pe câmpuri diferite → ambele câmpuri rămân.
6. Eroare 4xx la golire → elementul se scoate, tichetul revine la valoarea serverului,
   restul cozii continuă.
7. Acțiune „necesită rețea" offline → `OfflineError`, nu eroare generică.
8. Două file → o singură golire (lock).

Plus `npm run test:nav` extins: pornire offline cu cache, fără clipirea lui `<main>`.

## Ordinea etapelor (contextul acestei specificații)

| # | Etapă | Spec |
|---|---|---|
| 0 | Proba de focus pe Wayland (cod de aruncat) | în `2026-10-02-aplicatie-linux-design.md` |
| **1** | **Offline + baza locală** | **acesta** |
| 2 | Aplicația Linux (Electron) | `2026-10-02-aplicatie-linux-design.md` |
| 3 | Android (Capacitor) + alarme exacte | ulterior |
| 4 | Widget-uri Android | ulterior |

Etapa 1 vine înaintea Linuxului fiindcă aplicația de Linux încarcă site-ul: fără
offline, ar fi o fereastră care așteaptă rețeaua, adică ce există azi. Și se poate
testa în browserul folosit zilnic, înainte să existe vreun client nativ.
