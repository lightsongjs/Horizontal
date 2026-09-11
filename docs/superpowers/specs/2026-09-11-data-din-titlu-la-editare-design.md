# Data din titlu, și la editare — design

**Data:** 2026-09-11
**Atinge:** `src/components/IssueForm.tsx`, `src/lib/` (modul nou), `src/hooks.ts` (neschimbat)

## Problema

Recunoașterea datei din titlu (`useTitleDate`) e stinsă la editarea unui tichet
existent. `IssueForm.tsx:299`:

```ts
enabled: !isEdit && !dueOwned && canWrite
```

Două excepții, cu două motivații diferite:

- `isEdit` — „o retușare de titlu n-are voie să schimbe planificarea" (comentariul
  de la efectul din `IssueForm.tsx:380-386`).
- `dueOwned` — o scadență aleasă din câmp/calendar nu se lasă rescrisă de titlu.

Consecința trăită: scrii „la masa la 2p" la un tichet nou, parserul înțelege
altceva decât voiai, deschizi tichetul, ștergi ora și data — și de-acum înainte
titlul nu mai poate pune o scadență. Corectarea, care e chiar gestul cel mai
firesc („hai la masa luni la 12"), e singurul lucru care nu merge. Singura cale
rămasă e câmpul de scadență, care pe telefon cere mai multe atingeri decât
scrisul.

Nu există un al doilea bug: dus-întorsul `toDisplayDate`/`fromDisplayDate` și
`toTimeInput`/`fromTimeText` e corect, iar salvarea trimite `schedule.dueAt`.
Scadența dispărea pentru că o ștergea utilizatorul, nu formularul.

## Decizii (luate cu utilizatorul, 2026-09-11)

1. **Titlul e stăpânul.** O dată recunoscută în titlu rescrie scadența
   existentă, fără confirmare. Motivul e viteza: schimbarea din titlu trebuie să
   fie mai ieftină decât deschiderea câmpului de scadență, altfel nu se folosește.
2. **Se aplică doar în urma unei tastări în titlu.** Deschiderea unui tichet nu
   schimbă nimic și nu evidențiază nimic.
3. **Ștergerea fragmentului din titlu e un „anulează".** Se retrage ce a pus
   recunoașterea și revine valoarea dinaintea editării, nu golul.

Decizia 2 nu e un detaliu de implementare: fără ea, decizia 1 ar muta scadența
la fiecare deschidere a unui tichet vechi al cărui titlu conține încă un
fragment relativ („la 2p" se recalculează față de *azi*).

## Regula, după

Cele două excepții dispar, înlocuite de una singură:

> Recunoașterea e pornită mereu (cât timp `canWrite`), dar se aplică **doar ca
> urmare a unei tastări în câmpul de titlu**.

Ridicarea lui `isEdit` nu schimbă nimic la un tichet nou: titlul pornește gol,
deci orice dată din el vine oricum dintr-o tastare. Ridicarea lui `dueOwned`,
în schimb, **schimbă** — vezi paragraful următor.

`dueOwned` se șterge complet, inclusiv de pe tichetele noi. E o schimbare de
comportament acceptată explicit: dacă alegi 8 sept din calendar și *apoi* scrii
„luni" în titlu, luni câștigă. (`setDueOwned` se chema din `onChange`-ul
câmpului de dată, al celui de oră și din butonul „×" — deci protecția asta
chiar exista și chiar dispare. O versiune mai veche a specului susținea
contrariul; era greșită.) Alternativa — `dueOwned` păstrat doar la tichete
noi — ar fi însemnat două reguli care se contrazic între crearea și editarea
aceluiași tichet.

Ce **nu** se schimbă:

- Refuzul pe fragment (`rejectAll`, `liveRejections`, `maskRejected`) rămâne
  neatins. Devine mai important decât era: cu suprascriere directă, „nu e o
  dată" e singura plasă de siguranță împotriva unui „Podul 5" luat drept oră.
- `cleanTitleFromDate` („curăță fragmentul din titlu") rămâne cu semantica de
  azi: uită ce a completat, deci scadența aplicată devine definitivă.
- `QuickAdd` nu e atins — acolo tichetul e mereu nou.
- `useTitleDate` nu e atins: `enabled` rămâne un parametru, doar expresia care
  îl calculează în `IssueForm` se schimbă.

## Stare nouă în formular

**`titleTyped`** — a atins utilizatorul câmpul de titlu în această sesiune de
editare? Fals la montare, adevărat la primul `onChange` al inputului de titlu
(inclusiv la scrierea făcută de `onChange`-ul hook-ului, la refuz). Alimentează
și `enabled`, și poarta efectului — evidențierea și aplicarea se aprind
împreună, ca omul să nu vadă un fragment marcat care nu face nimic.

**Baza de retragere.** Azi `autoFilled` reține doar ce a scris recunoașterea, iar
retragerea pune gol — corect, fiindcă la un tichet nou baza *e* goală. Se adaugă
a doua jumătate: la prima completare (când nu există deja o bază) se
fotografiază valorile curente ale câmpurilor. Când titlul rămâne fără dată și
câmpurile sunt încă exact ce scrisese recunoașterea, se pune fotografia înapoi.
La tichete noi fotografia e goală, deci comportamentul de azi rămâne bit-cu-bit.

## Unde stă logica

`CLAUDE.md` cere ca logica de dată să nu trăiască în componente. Efectul din
`IssueForm.tsx:387-411` devine o funcție **pură** într-un modul nou din
`src/lib/`, cu forma:

```
(câmpuri curente, ce a înțeles parserul, memoria de dinainte)
  → { câmpuri de scris, memoria nouă }
```

Trei intrări, două ieșiri, nicio referință la React. Componenta păstrează
`useState`/`useRef` și un singur apel în efect. Modulul se testează cu fixtures,
ca `parseDue` și `schedule`.

Cazurile care trebuie să fie fixtures, nu clickuri:

| Pornind de la | Titlul devine | Rezultat |
|---|---|---|
| tichet nou, câmpuri goale | conține o dată | câmpurile se completează, baza = gol |
| tichet nou, completat din titlu | fără dată | câmpurile se golesc |
| scadență 8 sept, netastat | orice | nimic nu se schimbă |
| scadență 8 sept, tastat | conține „luni la 14" | câmpurile devin luni 14:00, baza = 8 sept |
| ...continuare | fragmentul se șterge | câmpurile revin la 8 sept |
| ...continuare | fragment refuzat | câmpurile revin la 8 sept |
| scadență 8 sept, tastat, câmp schimbat cu mâna între timp | fără dată | **nu** se retrage nimic |

Ultimul rând e regula care ține azi retragerea onestă (`dueText === auto.date &&
timeText === auto.time`) și trebuie să supraviețuiască mutării.

## Verificare

- `npm test` — fixtures pe modulul nou; testele existente de `parseDue` și
  `schedule` rămân verzi.
- `npm run typecheck`.
- `npm run test:layout` / `test:nav` nu ating zona asta; nu se rulează.
- Trecere manuală în formularul mare, pe un tichet cu scadență: deschide (nimic
  nu se mișcă) → tastează o dată (se suprascrie) → șterge fragmentul (revine
  scadența veche) → salvează.

## Ce rămâne în afara scopului

- Ștergerea automată a fragmentului din titlu la salvare. Azi „la 2p" rămâne în
  titlu, iar cu decizia 2 asta nu mai face rău. O curățare automată e o
  schimbare separată, cu propriile ei consecințe.
- Editorul de dependențe obstacol-obstacol, listele inteligente, `QuickAdd`.
