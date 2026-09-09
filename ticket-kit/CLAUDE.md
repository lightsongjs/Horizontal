# CLAUDE.md — ticket-kit

Kit portabil pentru gestionarea tichetelor în baza de date **Horizontal**.
Se copiază în orice proiect. Când lucrezi cu tichete, folosește `ai-client.mjs`
(NU `seed.mjs`). Comenzi complete și exemple: vezi [`README.md`](README.md).

## Sync — acest folder e propriul repo git

`ticket-kit/` are propriul `.git`, remote `github.com/lightsongjs/horizontal-ticket-kit`.
Master copy (source of truth) e un clone al aceluiași remote la
`C:\Users\User\OneDrive\03-RESURSE-MAIN\horizontal-ticket-kit\`.

**După orice modificare aici** (`ai-client.mjs`, `README.md`, `seed.mjs`, `CLAUDE.md`):
NU copia fișiere. Folosește git:

```bash
cd ticket-kit && git add -A && git commit -m "..." && git push origin master
# apoi la master copy: git pull
```

Wave 0 e **Scratchpad**-ul și e un wave ca oricare altul — create/list/lookup merg pe el.
Numele wave-urilor se văd cu `--waves`.

```bash
node ai-client.mjs --waves  --project <Nume>
node ai-client.mjs --list   --project <Nume> --wave <n>
node ai-client.mjs --lookup --project <Nume> --title "<titlu>" --wave <n>
node ai-client.mjs --create --project <Nume> --title "<titlu>" --wave <n> --deps ID1,ID2
node ai-client.mjs --get    --id <ID>
node ai-client.mjs --update --id <ID> --deps ID1,ID2   # --deps "" șterge toate
node ai-client.mjs --update --id <ID> --project <Nume>   # mută tichetul în alt proiect (ID nou)
```

## ⚠️ Direcția dependențelor (`deps`) — regula care NU trebuie greșită

`deps: [X]` pe tichetul A înseamnă **„A e blocat de X / X deblochează A"**.
Tichetele fără `deps` sunt rădăcinile — apar la „Începe aici / layer 1" și sunt
**task-urile primare** de la care pornește totul.

**Regula de aur — de la mic la mare:** task-ul atomic e rădăcina; el deblochează
tichetul-părinte (umbrela). Părintele („zona X e gata") depinde de copii, **nu invers**.

```
X schema  ──▶  X APIs  ──▶  X (umbrelă „gata")
(rădăcină)     deps=[schema]   deps=[APIs]
```

**Nu greși direcția:** rădăcina e mereu cel mai atomic lucru, umbrela stă la vârf.
Un tichet-finale („Finalizează totul") depinde de toate umbrelele.

**Nu lega siloz-uri diferite prin foreign keys:** ex. `projects schema` NU depinde
de `org_units schema` doar fiindcă există un FK între tabele. Fiecare siloz e o
coloană verticală curată (`schema → API → umbrelă`). Ordinea reală de migrare se
notează în `desc`-ul tichetului-finale, nu ca `deps` de planificare.

Detalii complete + anti-pattern-uri: secțiunea „Dependențe (`deps`)" din [`README.md`](README.md).
