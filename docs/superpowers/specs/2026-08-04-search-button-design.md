# Buton de căutare vizibil în header

Data: 2026-08-04

## Problema

`QuickSearch` se deschide **numai** de la tastatură — `App.tsx:423`, tasta `O`.
Pe mobil nu există tastatură fizică, deci căutarea e complet inaccesibilă. Am
construit potrivirea după numărul tichetului și pe telefon nu se poate folosi.

## Ce construim

Un buton-lupă în header care apelează același `setShowSearch(true)` pe care îl
apelează tasta `O`. Zero logică nouă de căutare — doar un al doilea declanșator
pentru ce există deja.

## Decizii

| Decizie | Ce am ales | De ce |
|---|---|---|
| Amplasare | **Iconiță în header**, între „+ Tichet" și roata de setări | Header-ul folosește deja vocabularul de buton-iconiță; o singură implementare pentru web și mobil, fără nimic plutitor peste conținut |
| Domeniu | **Doar în proiect** | Identic cu tasta `O` de azi. Pe lista de proiecte nu sunt tichete de căutat |
| Condiție de afișare | `project`, **nu** `project && canWrite` | Căutarea nu modifică nimic; un membru cu drept doar de citire trebuie să poată căuta |

Căutarea globală, peste toate proiectele, e în afara scopului: ar cere ca fiecare
rezultat să arate proiectul lui, iar deschiderea unui tichet din alt proiect ar
trebui să comute proiectul activ întâi. Muncă reală, nu o iconiță.

## Implementare

**`src/App.tsx`**

- `Header` primește o prop nouă `onSearch: () => void`.
- În render, `<Header … onSearch={() => setShowSearch(true)} />`.
- În `Header`, un buton nou după cel de `+ Tichet`:
  - clasă `header-search-btn`
  - condiționat pe `project` singur
  - `aria-label="Caută tichet"`, `title="Caută tichet (O)"` — titlul predă
    scurtătura, exact cum face `title="Tichet nou (C)"`
  - SVG inline: `width={15} height={15} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2} strokeLinecap="round"
    strokeLinejoin="round"`, cu `<circle cx="11" cy="11" r="8"/>` și
    `<line x1="21" y1="21" x2="16.65" y2="16.65"/>` — aceeași convenție ca
    roata de setări și butonul de refresh

**`src/styles.css`** — aici se greșește treaba

`.header-settings-btn` are reguli în **cinci** locuri, și lupa le are nevoie pe
toate cinci, altfel e invizibilă exact la un breakpoint:

| Loc | Ce face |
|---|---|
| ~2072, regula de bază | stilul butonului; **ascunde** (`display: none`) |
| ~2086 | `:hover` |
| ~2647, în `@media (min-width: 900px)` | reafișează pe desktop |
| ~3499, în `@media (max-width: 899px)` | reafișează pe mobil |
| ~3513, în același bloc | ținta de atins 36×36 |

Cel mai probabil să fie sărit e cel de mobil — adică exact cazul pentru care
există feature-ul. Verificarea trebuie să treacă explicit prin el.

## Testare

Nu există infrastructură de teste pentru componente în repo: nici
`@testing-library`, nici `jsdom`, nici `happy-dom`. Testele existente acoperă
numai funcții pure. Introducerea lor e o decizie separată și mai mare decât
feature-ul, deci **nu adăugăm teste automate aici**.

Logica de potrivire e deja acoperită: `src/components/QuickSearch.test.ts`,
11 teste pe `rankIssues`. Butonul nu o atinge.

Cele 140 de teste existente trebuie să treacă, iar `npm run typecheck` să fie
curat — `src/` e acoperit de typecheck (diferit de `functions/`, care nu e).

Verificare manuală, de făcut de utilizator:

| Verificare | Unde |
|---|---|
| Lupa apare într-un proiect, pe desktop | `npm run dev`, `localhost:5173` |
| Lupa apare și sub 900px | local, DevTools device toolbar |
| Nu apare pe lista de proiecte | local |
| Click-ul deschide aceeași căutare ca tasta `O` | local |
| Ținta de atins e confortabilă cu degetul | `horizontal-dyx.pages.dev`, telefon real |

Condiția `project` fără `canWrite` se verifică prin citirea diff-ului, nu vizual,
ca să nu ceară un al doilea cont.

## În afara scopului

- Căutare globală peste proiecte (vezi mai sus).
- Câmp de căutare mereu vizibil sub header — mâncă spațiu vertical permanent pe
  telefon și ar dubla `QuickSearch`.
- Un al doilea FAB — două butoane plutitoare concurează vizual și acoperă
  conținut.
