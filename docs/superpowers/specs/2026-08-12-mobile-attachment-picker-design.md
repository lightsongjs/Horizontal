# Alegerea fișierelor pe mobil — design

**Data:** 2026-08-12
**Stare:** aprobat, gata de plan de implementare

## Problema

Secțiunea de atașamente livrată în seria `feat(attachments)` are exact două căi de
intrare: `paste` (Ctrl+V) și `drop` (drag & drop). Ambele sunt gesturi de desktop.

Pe telefon nu există niciuna. Rezultatul: într-o aplicație declarat mobile-first,
secțiunea „Fișiere" e în practică read-only pe mobil — vezi ce e deja atașat, dar
nu poți adăuga nimic. Textul de empty-state chiar spune „Lipește o poză (Ctrl+V)
sau trage fișiere aici", instrucțiuni imposibil de urmat pe ecranul unde apar cel
mai des.

În tot proiectul nu există niciun `<input type="file">`.

## Ce construim

Trei căi de a alege fișiere, prezentate ca o zonă de acțiune deasupra grilei de
atașamente:

| Card | Atribute pe input | Când apare |
|---|---|---|
| **Fă o poză** | `accept="image/*" capture="environment"` | doar pointer coarse |
| **Din galerie** | `accept="image/*" multiple` | mereu |
| **+ Alt fișier** | `multiple` | mereu |

Sub carduri, o linie de ajutor cu tipurile de fișier acceptate. Pe pointer fine se
adaugă și hint-ul existent de paste/drop.

Referință vizuală: pattern-ul din proiectul „mate cu Simo" — două carduri mari cu
chenar punctat, iconiță, titlu și un rând de explicație. Îl urmăm ca formă, nu ca
politică: Simo e images-only și plafonat la 10 poze, noi nu suntem nici una nici
alta.

## Decizii luate

**Trei căi, nu două.** Simo acceptă doar imagini fiindcă e o temă la mate.
Horizontal acceptă orice fișier prin drop și paste — PDF-uri, arhive, fișiere de
cod. Dacă mobilul ar primi doar cameră și galerie, ar rămâne o asimetrie între
platforme pentru care n-avem niciun motiv.

**Camera doar pe pointer coarse.** Detecție prin `matchMedia('(pointer: coarse)')`,
nu prin user-agent. Pe desktop `capture` deschide webcam-ul, ceea ce e aproape
niciodată ce vrei. Un dispozitiv hibrid poate trece dintr-o stare în alta în timpul
sesiunii — hook-ul ascultă schimbarea, deci layout-ul urmează dispozitivul.

**Niciun plafon, nici pe număr de fișiere, nici pe octeți.** Un plafon pe număr ar
fi pur cosmetic — browserul urcă direct în Storage, fără server pe traseu — și ar
deschide o cale de eroare nouă (ai nouă fișiere, alegi cinci, ce se întâmplă cu
ultimele patru?). Un plafon pe octeți ar fi la fel de arbitrar: nu există un motiv
de produs pentru care un fișier de 25 MB să fie respins și unul de 19 MB acceptat.
Singura verificare care rămâne la intrare e cea care exista deja înainte de acest
picker — fișierele de 0 octeți (foldere trase din greșeală) cad, restul trece.

Rămâne o singură limită, și e în afara aplicației: proiectul Supabase are un
plafon global per fișier setat din dashboard (implicit ~50 MB pe planul gratuit).
Bucket-ul `attachments` însuși n-are `file_size_limit` sau `allowed_mime_types` —
limita aceea nu ține de cod, deci nu poate fi scoasă din cod. Un fișier peste ea
eșuează cu eroarea proprie a Supabase, care iese prin fluxul existent de mesaje —
deci raportată, nu tăcută.

**Picker-ul rămâne vizibil când există deja fișiere.** Azi hint-ul apare doar la
listă goală. Dacă păstram regula, pe mobil n-ai fi putut adăuga al doilea fișier.

**`capture` exclude `multiple`.** Așa e definit atributul: captura pornește camera
pentru un singur cadru. De-asta scrie și la Simo „o poză odată". Nu e o limitare pe
care o alegem, e una pe care o comunicăm.

## Arhitectură

### Componentă nouă: `src/components/AttachmentPicker.tsx`

```ts
{ onPick: (files: File[]) => void; disabled?: boolean }
```

Nu știe de Supabase, de `issueId`, de motivele de respingere, de redenumire. Deține trei
`<input type="file">` ascunse și `ref`-urile lor; fiecare card vizibil e un
`<button>` care cheamă `ref.current?.click()`.

Atributele stau fixe în JSX și nu se mută niciodată. Alternativa — un singur input
cu atribute rescrise înainte de `.click()` — economisește două noduri și cumpără un
bug: Safari citește atributele în momentul gestului, iar React nu garantează că
DOM-ul s-a actualizat înainte de apel.

După fiecare alegere, `e.target.value = ''`. Fără reset, a doua oară când alegi
*același* fișier evenimentul `change` nu se mai declanșează, iar butonul pare mort.

Iconițele sunt SVG inline, ca în `Sidebar.tsx` și `QuickSearch.tsx`. Restul din
`Attachments.tsx` folosește emoji, dar acolo etichetează tipuri de fișier; astea
sunt acțiuni.

### Hook nou: `useCoarsePointer()` în `src/hooks.ts`

Citește `matchMedia('(pointer: coarse)')` și se reabonează la schimbare. Fișierul
există deja și e locul firesc.

### Modificări în `src/components/Attachments.tsx`

Textul de empty-state se înlocuiește cu picker-ul, randat ori de câte ori `canEdit`,
deasupra grilei:

```tsx
<AttachmentPicker
  onPick={(files) => void addFiles(['Files'], files)}
  disabled={busy > 0}
/>
```

`['Files']` literal, exact ca pe calea de paste: prezența fișierelor e deja
dovedită de faptul că le ținem în mână, n-o deducem din `types`. Adulmecarea lui
`types` are rost doar la drop, unde încă n-avem lista.

### Ce NU se schimbă

`addFiles`, `pickFiles`, `shrinkImage`, `attachmentFilename`, `uploadAttachment`,
stratul de date, migrarea SQL, politicile RLS. Zero linii în `src/data/`.

Calea nouă intră exact în același `addFiles` ca paste-ul și drop-ul, deci
micșorarea imaginilor, sintetizarea numelor și mesajele de respingere funcționează
din prima fără nimic în plus.

### Stiluri

Clasele noi merg în `src/styles.css`, lângă cele `att-*` existente, cu același
prefix `att-`. Cardurile stau într-un grid (`grid-template-columns: repeat(auto-fit,
minmax(150px, 1fr))`), care cade la o singură coloană când containerul, nu
viewport-ul, ajunge sub ~150 px pe coloană — esențial cât timp secțiunea
trăiește într-un bottom sheet, a cărui lățime nu e neapărat cea a ecranului.
Ținta de atingere minimum 44 px înălțime.

Linia de ajutor de sub carduri, literal: `Poze, PDF-uri, arhive — orice fișier`. Pe
pointer fine se adaugă dedesubt rândul existent `Lipește o poză (Ctrl+V) sau trage
fișiere aici.`

## Erori

Nicio cale de eroare nouă. Foldere trase din greșeală peste zonă ajung ca intrări
de 0 octeți; `pickFiles` le respinge, raportate separat de `rejectMessage`, și apar
în bara de mesaje existentă. Nu e o limită de dimensiune — e o gardă contra
folderelor.

Anularea din file picker-ul nativ produce o listă goală — `pickFiles` returnează
`accept` gol, `rejectMessage` returnează `null`, nu se afișează nimic. Corect:
anularea nu e eroare.

## Testare

Vitest rulează pe `environment: 'node'` în acest repo — de-aceea e `pickFiles.ts`
scris fără DOM. Componenta nouă e aproape numai markup: trei input-uri, un `.click()`,
un reset de `value`. Politica reală — ce se acceptă, ce se respinge, cum se numesc
screenshot-urile — e deja acoperită de testele existente și nu se schimbă.

Nu adăugăm jsdom în proiect ca să afirmăm că un buton cheamă `click()`.

Verificarea e manuală, pe dispozitiv real:

1. Android, tichet existent: „Fă o poză" → camera → poza apare în grilă
2. Android: „Din galerie" → selecție multiplă → toate apar
3. Android: „+ Alt fișier" → un PDF → apare cu iconița de PDF
4. Desktop: cardul de cameră lipsește, hint-ul de paste/drop e prezent
5. Desktop: paste și drag & drop funcționează ca înainte
6. Membru read-only: picker-ul nu se randează
7. Tichet nou (fără `issueId`): rămâne mesajul „Salvează tichetul, apoi atașează fișiere."

## Limitare cunoscută

Pozele făcute pe iPhone vin HEIC. `shrinkImage` micșorează pe canvas: Safari
decodează HEIC, Chrome pe Android nu. Pe iOS deci merge normal. Un HEIC ajuns pe
Android trece nemicșorat — se urcă, dar ocupă mai mult.

Nu rezolvăm acum. Conversia HEIC ar însemna o bibliotecă wasm de câteva sute de KB
pentru un caz care, pe fluxul principal (faci poza pe telefonul tău, o urci de pe
el), nu apare.
