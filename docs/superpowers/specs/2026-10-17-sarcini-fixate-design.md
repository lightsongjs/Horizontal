# Sarcini fixate („Fixează sus") — design

Data: 2026-10-17. Decizia omului (must-have, fără machetă): înainte de ANAF
pune credențialele într-un tichet și vrea ca tichetul să stea **sus de tot**
toată ziua, deși n-are scadență. Ca „Pin" din TickTick.

## Ce face TickTick (pe scurt)

- **Unde se fixează:** din „…" al paginii de detalii a sarcinii, din apăsarea
  lungă pe rând sau din glisarea rândului (opțiunile „Done" și „Pin"); pe
  desktop din meniul contextual (click dreapta → „Pin").
- **Efectul:** sarcina fixată stă **mereu în vârful listei** în care se află,
  ca să se vadă dintr-o privire ce contează. Fixarea e pe listă; și în listele
  inteligente (Today, Tomorrow, Inbox) o sarcină fixată care face parte din
  listă apare sus.
- **Despre bifare și ordinea între fixate** documentația publică nu spune
  nimic explicit; în aplicație o sarcină bifată coboară în „Completed", iar
  fixatele noi apar deasupra celor vechi.

Surse: help.ticktick.com („List View", „Task Details"), makeuseof.com („A
Complete Guide to Organizing Tasks in TickTick"), App Store (Mac story).

## Ce facem noi — și de ce diferă de TickTick

1. **Model:** `issues.pinned_at timestamptz null` (`supabase/migration-pinned-tasks.sql`).
   `null` = nefixat; valoarea = când a fost fixat. Un câmp de tichet, nu un rând
   în `pinned_items` (acolo sunt pătratele din sertar, ale contului): fixarea e
   un patch de tichet ca urgentul, deci trece prin aceeași coadă offline, fără
   cod nou de sincronizare. RLS neschimbat. `move_issue` copiază coloana singur.
2. **„Azi": grupul „Fixate", primul**, deasupra restanțelor și a urgentelor.
   Intră orice tichet fixat, **deschis** și **al meu** (`isMine`), cu sau fără
   scadență. Fixatele fără scadență nu vin din `listDueIssues`, deci store-ul
   le adaugă din `openIssues` (`withPinned`, fără dubluri), înainte de `onlyMine`.
   TickTick ar arăta în Today doar fixatele care sunt oricum azi; cazul ANAF
   (fără dată) cere mai mult — de-aia fixarea înseamnă „în Azi, sus".
3. **O fixată stă NUMAI în „Fixate".** Nu se mai arată nici în Restanțe, nici
   în Azi, nici în ziua ei din „7 zile": o fixare e o declarație că sarcina e
   a zilei de azi, iar două locuri ar număra-o de două ori (badge-ul „Azi" și
   cel din „7 zile") — exact ce a refuzat deja regula „7 zile începe de mâine".
   Rândul își spune singur ziua când nu e azi („Mâine 10:00", ora cade sub
   380px) și roșu dacă e restant, deci informația nu se pierde. Numărul din
   „Azi" (antet, sertar, sidebar) le include; badge-ul roșu de restanțe nu.
4. **Fixarea bate rutina adormită** (proiect „doar mementouri"): e un gest
   explicit al omului, regula proiectului e implicită.
5. **Bifarea nu scoate fixarea.** Un tichet bifat iese din grup pentru că e
   bifat (`isPinnedOpen`), iar debifat revine sus. Motiv: bifa vine pe patru
   drumuri (interfața, notificarea fără filă prin `reminder-action`,
   `functions/api`, Android) — scoaterea fixării ar fi cerut un trigger nou și
   ar fi stricat anularea. O fixată bifată azi cade în „Terminate azi", ca
   oricare.
6. **Recurentele:** bifa nu închide, scadența sare (triggerul) — tichetul
   rămâne deschis, deci rămâne fixat și sus. Nimic special de scris.
7. **Ordinea între fixate:** cel fixat cel mai recent primul; la egalitate,
   după ID (`comparePinned`). Fixarea unei selecții dă aceeași oră tuturor.
   Re-fixarea unuia deja fixat dintr-o selecție nu-i schimbă ora (locul).
8. **„Listă" dintr-un proiect:** fixatele deschise urcă primele **în layerul
   lor**, nu peste layere — layerul e calculat din dependențe („ce pot începe
   acum") și rămâne read-only. Rândul are semnul de piuneză în coadă.
   „Cards" (Ordine) nu arată fixarea deloc; filtrele salvate arată semnul, dar
   nu reordonează; „7 zile" nu le arată deloc (punctul 3).
9. **Unde se fixează:**
   - foaia de tichet de pe telefon (`EditSheet`): piuneza de pe rândul ID-ului
     (rândul de jetoane e plin la 320px și e despre când/unde);
   - ⋮ al unui rând glisat și „Mai mult" al selecției (`MoreSheet`): „Fixează
     sus" / „Scoate de sus" (selecție: toate fixate → scoate, altfel fixează);
   - formularul complet (`IssueForm`): piuneza din antet, imediată (nu prin
     Salvează — e locul tichetului, nu conținutul), ascunsă sub 900px (antetul
     e plin; acolo e foaia de tichet);
   - desktop: tasta **F** cu un card deschis (panou sau modal), lângă `Y`.
     Liberă: Ctrl+F e căutarea, iar modificatorii sunt ignorați.
10. **Ce nu e încă:** widget-ul de agendă, notificarea fixă din bară și
    fereastra nativă de pe Android nu știu de fixări (cer APK nou); web push
    și Linux nu au nevoie.

## Fișiere

- Reguli pure: `src/lib/pinned.ts` (+ test), `buildSmartLists` în `src/lib/schedule.ts`,
  acțiunea `pin` în `src/lib/bulkActions.ts`.
- Date: `src/lib/types.ts` (`pinnedAt`), `supabaseRepository`, `localRepository`,
  ecoul offline (`ops.ts`), store (`withPinned`).
- UI: `SmartListView`, `TaskRow`, `ListView`, `EditSheet`, `IssueForm`,
  `TaskActions`, `InfoPanel`, `Icon` (rolul `pin`).
