# Deep links pentru tickete

**Data:** 2026-07-28
**Status:** aprobat, gata de plan

## Problema

Utilizatorul își planifică munca în calendar: un event pe zi conține task-urile pe
care vrea să le atace. Ca să ajungă din calendar direct la ticket, are nevoie de un
URL copiabil care deschide **exact acel ticket**, nu pagina generală de proiect.

Azi URL-ul se sincronizează doar cu proiectul (`/project/<slug>`, în `src/App.tsx`).
Deschiderea unui card nu schimbă URL-ul, deci nu există nimic de copiat.

## Decizia

URL-ul unui ticket este **doar id-ul ticketului, la rădăcină**:

```
horizontal.app/MS-03
horizontal.app/TUR-01
horizontal.app/TUR-API
```

Fără slug de proiect, fără prefix `/project/`, fără query params. Id-urile de issue
sunt deja URL-safe (`prefix-număr`, ex. `TUR-01`), deci se folosesc verbatim.

**De ce merge fără proiect în URL:** prefixul e per-proiect (`Project.prefix`), deci
`MS-03` identifică unic ticketul și implicit proiectul lui. Un singur lookup la load.

Ruta existentă `/project/<slug>` rămâne neschimbată pentru vizualizarea de proiect.

## Comportament

### Deschiderea unui card
`pushState('/MS-03')`. Închiderea sheet-ului (X sau Escape) apelează `history.back()`,
nu un `pushState` nou — astfel istoricul nu se umple cu intrări duplicate, iar URL-ul
revine la ce era înainte (tipic `/project/<slug>`).

### Butonul Back / swipe pe mobil
Pentru că deschiderea folosește `pushState`, Back **închide sheet-ul** și te lasă în
proiect. Al doilea Back te scoate din proiect. Handler-ul `popstate` existent trebuie
extins ca să înțeleagă și path-urile de ticket.

### La load, cu un path de ticket
Path-ul se potrivește cu `/^\/[A-Za-z0-9]+-[A-Za-z0-9]+$/`:
1. caută issue-ul după id, **case-insensitive**
2. selectează automat proiectul lui
3. deschide sheet-ul de ticket

Nu e nevoie ca utilizatorul să știe în ce proiect e ticketul.

### Ticket inexistent (șters)
Aterizează în ultimul proiect folosit (`horizontal:last-project`) și afișează un toast:
`Ticketul MS-03 nu mai există`. Fără ecran de eroare dedicat.

### Buton de copiere link
Icòn discret în header-ul sheet-ului de ticket, care copiază URL-ul **absolut**
(`window.location.origin + '/' + issue.id`) în clipboard, plus scurtătura `y`
(convenția GitHub/Linear). Confirmare prin toast: `Link copiat`.

Necesar pentru că în PWA-ul instalat nu există bară de adrese din care să copiezi.

## Ce deschide link-ul

Exact ce deschide click-ul pe un card azi: `openIssue(id)` din `src/ui.tsx`, care
afișează sheet-ul `issue-form`. Nu se introduce niciun ecran nou.

## Ce NU intră în scope

- Deep links pentru celelalte sheet-uri (project-settings, wave-manage, theme-manage).
- Deep link către un tab anume din proiect.
- Validarea unicității prefixelor de proiect (vezi mai jos).

## Risc cunoscut, acceptat

Nimic nu împiedică azi două proiecte să aibă același `prefix`. În acel caz `MS-03`
devine ambiguu, iar rezoluția ia **primul issue găsit**. Acceptat conștient; nu se
rezolvă în această tranșă.

## Fișiere atinse

- `src/App.tsx` — parsarea path-ului la load, sync URL, handler `popstate`
- `src/ui.tsx` — sheet-urile trebuie să poată fi deschise dintr-un id venit din URL
- `src/components/IssueForm.tsx` (header sheet) — butonul de copiere
- rezoluția id → issue: helper nou în `src/lib/`
