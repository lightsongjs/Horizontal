# Harta — dependențele ca ramuri

## Decizia omului (2026-11-25)

Ionuț e „foarte vizual": vrea dependențele ca într-o organigramă, de la stânga
la dreapta, „ca niște ramuri care se extind", și pe telefon. Implicit **doar ce
e deschis**; „Arată și închise" aduce înapoi tichetele terminate dinaintea lor.
Excalidraw (cu care era obișnuit) a fost respins: e o tablă de desen, nu un
afișaj de dependențe, iar ce ai muta acolo nu s-ar întoarce în tichete.

Macheta aprobată („arată extraordinar"): `design/harta/index.html` (datele reale
Dolmenwood + o ramură inventată, stufoasă). Specificația designerului e în ea.

Harta veche (coloane globale, carduri pe un rând, totul pe același ecran, linia
„azi", benzile de sprint) era de necitit pe Dolmenwood: 84 din 117 tichete n-au
nicio legătură și umpleau prima coloană, iar închisele (tăiate) înecau cele
câteva deschise.

## Cum e făcută

Aritmetica e în `src/lib/branchMap.ts` (pură, cu teste), desenul în
`src/components/MapView.tsx`.

- **Ramura = componentă conexă** (dependențe de tichete, legături
  obstacol→tichet, dependențe între obstacole). Fiecare pe rândul ei, cele cu
  mai multe deschise primele; numele e primul element fără predecesori.
  Ramurile închise de tot apar doar cu „Arată și închise", sub „Ramuri
  terminate".
- **Rădăcina strânsă** („✓ 14", `ROOT`): închisele unei ramuri, din care pleacă
  câte O muchie spre fiecare deschis cu un predecesor DIRECT închis. Închisele
  de după un deschis se ascund și ele. Atingerea pe ea = „Arată și închise".
- **Așezarea** (Sugiyama în mic): coloana = cel mai lung drum; muchiile lungi
  trec prin puncte intermediare, câte unul pe coloană, ca să nu taie un card;
  ordinea în coloană din baricentre (8 treceri →/←); pozițiile verticale spre
  media vecinilor, fără suprapuneri, cu spațiu de 2,5× între copiii unor
  părinți diferiți (grupurile se citesc separat). Muchiile sunt în unghi drept,
  cu magistrala la jumătatea culoarului din fața țintei — de-aia părinții
  multipli se unesc și frații se ramifică din același punct.
- **Mărimile**: nodul 240px (260 pe telefon), culoar 72 (56). Înălțimea
  nodului și lățimea rădăcinii se MĂSOARĂ pe o probă ascunsă (`.bm-probe`,
  `ResizeObserver`), ca să urmeze fontul și mărimea textului din rotiță; toate
  nodurile au aceeași înălțime (titlul pe max. 2 rânduri).
- **Stările nodului**: gata (fundal + umbră, inel `--pc`), blocat (fără umbră,
  `--surface-2`, inel punctat — dependențe deschise SAU `blockedByObstacle`),
  închis (fără fundal, bifă verde, **fără text tăiat**), obstacol (poarta cu
  muchia stângă teșită prin `clip-path`, colțul dreapta-sus retezat = are
  ocolire; muchia lui e `blk`, roșie punctată, cât blochează). Roșul rămâne
  numai pentru asta; un tichet blocat NU e roșu.
- **„Fără legături"**: rânduri plate pe teme (ordinea temelor proiectului, apoi
  „Fără temă", apoi „Obstacole"); un grup de peste 8 pornește strâns.

## Gesturile

- Desktop: hover aprinde lanțul (tot ce îl blochează și tot ce deblochează, în
  `--accent`), restul coboară la 30%; clicul deschide tichetul (panoul lateral)
  și lasă lanțul aprins. Clic pe fundalul benzii îl stinge.
- Telefon: prima atingere alege nodul, îl centrează (`scrollIntoView`, și în
  bandă, și în pagină) și arată bara de jos cu „așteaptă …"; a doua atingere
  (sau „Deschide") deschide foaia. Bara stă `sticky` deasupra butonului +.
- „Arată și închise" se ține minte **pe proiect** (`horizontal:map-all:<id>`),
  separat de „ascunde gata" al Listei/Cards (`useHideDone`): harta pornește
  implicit pe deschise, orice ar fi ales omul în listă.
- La comutare, primul deschis al fiecărei ramuri rămâne pe loc pe ecran cât
  permite derularea benzii (corecție de `scrollLeft`), iar nodurile alunecă din
  pozițiile vechi / ies din rădăcină (FLIP, 240 ms; oprit la reduce motion).
  Banda derulată spre stânga își stinge marginea (`.cut-l`), ca istoria
  ascunsă să se vadă că există.

## Ce a ieșit

Linia „azi" (coloanele sunt ordinea dependențelor, nu timp), benzile de sprint
și culoarea layerului pe carduri. `mapLayout.ts` a fost șters.

## Bancul

Ecranul „Hartă" din `design/preview.html` e scris de mână în
`design/build-preview.py` (`HARTA`, cu `ortho` = port 1:1 al `orthoPath`):
rădăcină, obstacol cu ocolire, gata, blocați, o ramură terminată, „Fără
legături".
