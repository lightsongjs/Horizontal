# Tichete — Horizontal

Proiectul acesta e legat de proiectul Horizontal **Horizontal** (id `h`, prefix `H`), prin `.horizontal`.
Unealta de tichete e `tk` (CLI-ul Horizontal, instalat pe sistem) — nu scrie tichete altfel.

Rulează `tk guide` pentru tot: comenzi, reguli, dependențe.

```bash
tk list                                 # tichetele proiectului
tk get H-7                         # tot tichetul, cu atașamentele (uită-te la ele!)
tk create "Titlu" --deps H-3 --desc "…"   # tichet nou
tk update H-7 --done                       # bifat
```
