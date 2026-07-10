# Scratchpad — „val zero" per proiect

**Dată:** 2026-07-10
**Status:** aprobat de utilizator, în așteptarea planului de implementare

## Problemă

În fiecare proiect am nevoie de un loc unde țin chestii de setup / notițe pe care
trebuie mereu să le am la îndemână (sheet-uri, credențiale, notițe pe zone).
Vreau ca acestea să fie **carduri exact ca celelalte**, într-un spațiu dedicat,
fără să complic modelul de date sau UI-ul.

## Soluție (cât mai simplă)

Un **wave normal**, numit `Scratchpad`, poziționat ca „val zero" (înaintea lui
`Val 1`). Nu e un tip nou de entitate, nu are comportament special: e pur și
simplu primul wave. Cardurile aterizează acolo cu `wave === 0`, curge exact ca
orice alt wave.

### Forma wave-ului la creare de proiect

La `createProject` se creează **două** wave-uri în loc de unul:

| number | name         | label   | position |
|--------|--------------|---------|----------|
| 0      | `Scratchpad` | *(gol)* | 0        |
| 1      | `Val 1`      | `MVP`   | 1        |

`currentWave` rămâne `1` → proiectul se deschide pe `Val 1`, nu pe Scratchpad.

`number: 0` e sigur: în tot codebase-ul comparațiile pe `number` sunt de tip
`=== w.number` (nicio verificare de tip `if (number)` care s-ar strica cu zero).

## Comportamente cerute

1. **Creat automat** la fiecare proiect nou (nu există buton „adaugă Scratchpad").
2. **Nu poate fi șters niciodată.** `deleteWave` refuză `number === 0`; în
   `WaveManager` butonul de delete e ascuns pentru Scratchpad.
3. **Iconițe pe tab-uri (emoji):**
   - Scratchpad (`number === 0`) → 📝
   - orice alt wave → 🌊
   - Se afișează în rândul de tab-uri (`WaveTabs.tsx`).

## Locuri de modificat

- `src/data/localRepository.ts` — `createProject`: adaugă al doilea wave (Scratchpad number 0, position 0; Val 1 devine position 1).
- `src/data/supabaseRepository.ts` — `createProject`: la fel, inserează și wave-ul Scratchpad.
- `src/data/*Repository.ts` — `deleteWave`: guard pentru `number === 0` (nu se șterge).
- `src/components/WaveTabs.tsx` — emoji în funcție de `w.number === 0`.
- `src/components/WaveManager.tsx` — ascunde delete pentru `number === 0`.
- **Script de backfill** — bagă un wave Scratchpad în toate proiectele existente
  din baza de date, dintr-o singură rulare. Folosește pattern-ul de admin din
  `CLAUDE.md` (supabase-js din `node_modules`).
  - Proiectele existente au deja `Val 1` la `position: 0`. Ca Scratchpad-ul să
    apară primul **fără** să rescriu pozițiile existente, se inserează cu
    `number: 0, position: -1` (sortarea e `position` crescător → -1 vine primul).
  - Idempotent: sări peste proiectele care au deja un wave cu `number === 0`.

## Ce NU facem (YAGNI)

- Fără tip nou de card / entitate.
- Fără dependențe/layers speciale — dacă e nevoie, funcționează ca la orice wave.
- Fără șablon global (fiecare proiect are propriul Scratchpad, creat de la zero).
- Fără SVG custom — doar emoji.

## Note deschise

- Rename-ul Scratchpad-ului rămâne permis (ca la orice wave); doar ștergerea e blocată.
