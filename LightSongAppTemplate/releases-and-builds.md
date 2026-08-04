# Release-uri și build-uri — ca fiecare client să vadă modificarea

Ghid portabil pentru orice aplicație Vite + React găzduită pe Cloudflare Pages, cu sau fără
PWA. Scris după ce am măsurat că rețeta veche (`docs/pwa-cloudflare-playbook.md`) era ruptă
în trei locuri, deși arăta corect la citire.

**Simptomul pe care îl previi:** publici o modificare, iar un utilizator spune „eu nu văd
asta". Răspunsul „dă Ctrl+F5" nu e o soluție, e o scuză — și pe telefon, la o aplicație
instalată, de multe ori nici nu funcționează.

---

## Harta: sunt trei straturi, nu unul

| Strat | Ce ține versiunea veche | Cât de periculos |
|---|---|---|
| 1. Cache-ul de hosting (Cloudflare) | `index.html` sau `sw.js` servite din cache | mediu — se rezolvă din `_headers` |
| 2. Service worker (PWA) | aplicația e servită din memoria browserului, chiar online | **cel mai periculos** — poate ține un client pe versiunea veche la nesfârșit |
| 3. Ce nu trece prin `git push` | migrații de bază de date, edge functions | ridicat — produce erori, nu doar UI vechi |

Dacă sari peste oricare, publicarea „merge" la tine (browser curat) și nu merge la ei.

---

## Stratul 1 — `public/_headers`

```
# Shell-ul și service worker-ul se revalidează MEREU, ca un build nou să fie detectat.
/sw.js
  Cache-Control: no-cache
/registerSW.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/
  Cache-Control: no-cache

# Assets-urile au hash de conținut în nume → alt build = alt nume. Sigur de cache-uit.
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

`no-cache` nu însemnă „nu stoca", însemnă „revalidează înainte de a folosi". Fără el,
Cloudflare poate servi un `sw.js` vechi și **nimic din stratul 2 nu mai are efect** — asta e
piesa pe care lumea o uită.

**Verifică în producție, nu în fișier:**

```js
for (const p of ['/', '/index.html', '/sw.js', '/manifest.webmanifest']) {
  const r = await fetch(HOST + p, { cache: 'no-store' })
  console.log(p, r.headers.get('cache-control')) // aștept: no-cache
}
```

---

## Stratul 2 — service worker-ul

### `vite.config.ts`

```ts
VitePWA({
  registerType: 'prompt',   // NU 'autoUpdate': buildul nou intră în „waiting", nu deturnează sesiunea
  injectRegister: null,     // înregistrăm noi, din src/pwa.ts
  workbox: {
    // FĂRĂ skipWaiting — vrem să controlăm noi momentul activării
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  },
})
```

### `src/pwa.ts` — copiază fișierul, nu rescrie logica

Sursa de adevăr: **`src/pwa.ts` din proiectul Horizontal**. Copiază-l ca atare. Dacă vrei
totuși să înțelegi ce face, astea sunt cele cinci reguli, fiecare scrisă după un bug real
și măsurat:

1. **Reîncarcă tu pagina.** `updateSW(true)` activează workerul dar **nu** reîncarcă
   documentul. Fără un `window.location.reload()` propriu (pe `controllerchange`),
   utilizatorul are versiunea nouă în cache și pe cea veche pe ecran — starea care cere
   refresh manual. Un tab lăsat deschis nu se actualiza niciodată.
2. **Aplică pe starea `installed`, nu după `update()`.** `registration.update()` se rezolvă
   **înainte** ca noul worker să termine instalarea. Deci „verific și apoi aplic" nu
   funcționează; singurul semnal corect e `installing.state === 'installed'`.
3. **Ignoră prima instalare.** `controllerchange` se emite și la primul vizitator (fără
   controller → cu controller). Dacă nu faci distincția (`hadController`), reîncarci pagina
   degeaba în fața fiecărui om nou.
4. **Celelalte taburi.** Cine aplică buildul consumă `registration.waiting`, deci restul
   taburilor deschise nu mai au ce aplica și rămân pe versiunea veche **la nesfârșit**.
   Marchează documentul ca vechi și reîncarcă la revenirea pe tabul respectiv — nu imediat,
   fiindcă un reload într-un tab din fundal aruncă ce a scris omul în el.
5. **Verificarea periodică doar CAUTĂ, niciodată nu aplică.** Altfel un deploy reîncarcă
   pagina peste cineva care tocmai completează un formular. Aplicarea se leagă de revenirea
   pe tab, cu o fereastră de câteva secunde (constanta `APPLY_WINDOW_MS`).

---

## Stratul 3 — ce NU trece prin `git push`

Pages construiește la push, deci frontendul se publică singur. **Migrațiile de bază de date
și edge functions nu.** De aici vine cea mai urâtă categorie de bug: frontend publicat și
backend desincronizate.

Regula de ordine, când o modificare atinge amândouă:

1. **Întâi migrația**, scrisă ca să fie compatibilă cu frontendul *deja publicat* — parametru
   nou cu `default null` și comportamentul vechi păstrat cât timp e null.
2. **Apoi push** pentru frontend.
3. Abia după ce frontendul nou e live, poți strânge compatibilitatea.

Dacă publici invers, între cele două momente aplicația e ruptă în producție. Precedent
concret: o edge function care cerea un câmp nou, deployată peste un frontend care nu-l
trimitea încă → comenzile au picat cu `400 Missing required fields`.

---

## Cum verifici un release (trei verificări, în ordinea asta)

### 1. Testul automat al drumului de upgrade

```
npm run test:upgrade
```

Copiază `scripts/test-upgrade-path.mjs` din Horizontal — e scris să fie portabil (citește
titlul de bază din `index.html`, nu presupune nicio rută). Servește `dist` cu aceleași
headere ca Cloudflare, face build-uri succesive și verifică:

- o revenire pe tab e de ajuns (două ar însemna că prima doar detectează);
- o verificare *fără* revenire pe tab **nu** reîncarcă pagina;
- buildul amânat se aplică la revenirea următoare;
- al doilea tab iese și el de pe versiunea veche.

**Verifică și că testul pică pe codul vechi.** Un test de upgrade care trece indiferent de
implementare e decor. Rulează-l o dată cu `pwa.ts` de la commit-ul anterior; trebuie roșu.

### 2. Markerul din bundle — și să fie unic pentru commit-ul tău

După push, confirmă că bundle-ul servit conține chiar codul nou:

```js
const html = await (await fetch(HOST + '/?cb=' + Date.now(), { cache: 'no-store' })).text()
const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1]
const js = await (await fetch(HOST + asset)).text()
console.log(js.includes('UN_ȘIR_INTRODUS_DE_ACEST_COMMIT'))
```

**Capcană trăită:** am căutat un nume de parametru ca dovadă că buildul e nou — dar șirul
exista deja în bundle de la altă funcție, iar hash-ul fișierului nu se schimbase. Fals verde.
Markerul trebuie să fie ceva **introdus de commit-ul tău**. Nu te lua nici după hash-ul
local: Cloudflare construiește cu alt mediu și poate ieși alt hash.

### 3. „Built: 3 minutes ago" în interfață

Vezi `relative-build-time.md` din același folder. Nu e cosmetic: e detectorul de simptom.
Intri în aplicație și, dacă scrie „5 days ago", știi imediat că te uiți la un build vechi —
fără să deschizi DevTools.

---

## Cine vede modificarea și când (după ce toate trei straturile sunt corecte)

| Client | Când |
|---|---|
| intră prima dată | imediat |
| tab deschis, revine pe el | la revenire |
| tab deschis și uitat | la următoarea revenire (verificarea orară doar pregătește) |
| al doilea tab | la revenirea pe el |
| PWA instalată | la următoarea deschidere |

---

## Aplicație care are DEJA useri cu versiunea veche instalată

Dacă adaugi rețeta asta într-o aplicație cu useri existenți, ei rulează încă service
worker-ul vechi, deci e nevoie de **un deploy de tranziție**: SW-ul lor trebuie să preia o
dată noul `sw.js`. Dacă vechiul cod verifica pe focus și activa workerul (chiar dacă nu
reîncărca pagina), tranziția se încheie de la sine — la a doua deschidere logica nouă
guvernează. Dacă vechiul hosting cache-uia `sw.js` (fără `_headers`), browserul
force-revalidează un service worker cel mult o dată la 24h; pentru un client complet blocat,
ultima soluție e reinstalarea aplicației.

Într-o aplicație **nouă**, pune ambele straturi de la primul commit și nu ai nicio tranziție.

---

## Checklist pentru o aplicație nouă

- [ ] `public/_headers` cu `no-cache` pe shell + `immutable` pe `/assets/*`
- [ ] `registerType: 'prompt'`, fără `skipWaiting`, `cleanupOutdatedCaches: true`
- [ ] `src/pwa.ts` copiat din Horizontal, `registerPWA()` apelat din `main.tsx`
- [ ] `/// <reference types="vite-plugin-pwa/client" />` în `src/vite-env.d.ts`
- [ ] `scripts/test-upgrade-path.mjs` copiat + `"test:upgrade"` în `package.json`
- [ ] testul rulat, **și** verificat că pică pe o versiune anterioară a `pwa.ts`
- [ ] headerele verificate direct în producție, nu doar în fișier
- [ ] „Built: X ago" afișat în interfață
- [ ] regula de ordine pentru migrații/edge functions scrisă în `CLAUDE.md`-ul proiectului
