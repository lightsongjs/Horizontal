# Horizontal — brief pentru design

## Pe scurt

Horizontal e o aplicație de sarcini și planificare de proiecte pentru o persoană
care lucrează cu o echipă mică. Are două fețe, care trebuie să pară un singur
produs:

- **lista zilnică**: ce am de făcut azi, mâine, săptămâna asta, din toate
  proiectele la un loc;
- **planificarea proiectelor**: ce depinde de ce, ce pot începe acum și ce livrăm
  în etapa curentă.

## Cine o folosește și cum

- Jumătate din timp pe **telefon** (Android), jumătate pe **laptop** (browser).
- Pe telefon, aplicația e folosită în mișcare:
  - notezi repede o sarcină;
  - bifezi;
  - amâni pe mâine;
  - vezi ce urmează;
  - faci poza unei table sau a unui bon și o atașezi.
- Pe laptop, aplicația e folosită stând la birou:
  - citești și scrii descrieri lungi;
  - organizezi proiecte;
  - comentezi și pasezi o sarcină unui coleg.
- Utilizatorul e „power user”, cu scurtături de tastatură pentru tot. Totuși, un
  client sau un coleg care o vede prima dată trebuie s-o înțeleagă și să-i placă.

## De ce vrem design nou

Un client a spus că aplicația „arată făcută în 1990”, „ca făcută de AI”, „fără
culori, fadă — nu-ți face plăcere să te uiți la ea”. Vrem:

- o aplicație **curată, aranjată, cu culoare și personalitate**, pe care s-o
  deschizi cu plăcere;
- credibilă în fața unui client;
- compactă pe telefon. Acum totul pare prea mare, iar o listă zilnică trebuie să
  arate multe rânduri dintr-o privire.

## Lucrurile din aplicație

- **Sarcina (tichetul)**:
  - titlu și un ID scurt (ex. `HZ-12`);
  - descriere cu formatare simplă: titluri, liste, căsuțe de bifat în text, cod,
    linkuri;
  - bifă de „gata”.
- **Scadența unei sarcini**:
  - o zi, opțional cu oră;
  - opțional un memento, care vine ca notificare;
  - poate fi recurentă: zilnic, în fiecare luni, pe 15 ale lunii etc.
  - Data se poate scrie direct în titlu („mâine la 10”), iar aplicația o
    recunoaște și o evidențiază.
- **Urgent**: un semn pe sarcină. Sarcinile urgente stau primele în listă.
- **Proiect**:
  - fiecare sarcină aparține unui proiect;
  - proiectul are nume, culoare și un prefix pentru ID-uri;
  - **Inbox** e proiectul implicit pentru capturi rapide;
  - un proiect poate fi „doar mementouri” (rutine): sarcinile lui apar în listă
    abia când le sună mementoul.
- **Atașamente**: poze și fișiere pe sarcină, plus „descarcă tot”.
- **Firul**:
  - comentarii pe sarcină;
  - pasarea către un coleg („ți-l dau ție”) se face odată cu un comentariu, nu
    separat.
- **Evenimente din Google Calendar**: apar printre sarcini, la ora lor, dar nu se
  bifează.

### Doar în planificarea proiectelor

- **Dependențe**: o sarcină poate aștepta după altele. Aplicația calculează
  singură „ce pot începe acum”, apoi „ce urmează după”, ca niște trepte.
- **Etape de livrare** („valuri”): grupe de sarcini pe care le livrezi împreună.
  Treptele de dependență și etapele sunt două lucruri separate.
- **Obstacole**: condiții din afară care blochează munca (ex. „aștept răspuns de
  la bancă”). Au patru stări:
  - necunoscut;
  - aștept;
  - rezolvat;
  - ocolit.
- **Teme**: etichete colorate pe sarcini.

## Ecranele

**Pe telefon** (bară de jos cu trei taburi, plus un meniu lateral):

1. **Azi**:
   - întâi restanțele (în roșu, cu ziua ratată și butonul „mută toate pe azi”);
   - apoi sarcinile de azi: urgentele, apoi cele cu oră, în ordine, apoi cele
     fără oră;
   - evenimentele din calendar, printre sarcini, la ora lor;
   - sarcinile terminate azi, ascunse sub un buton.
2. **7 zile**: același lucru, grupat pe zile.
3. **Ale mele**: sarcinile pe care mi le-a pasat cineva, cu cele necitite
   separate.
4. **Meniul lateral**:
   - cine sunt și setările;
   - scurtături fixate;
   - liste și filtre salvate;
   - proiectele, cu numărul de sarcini deschise.
5. **Captura rapidă**: un buton plutitor deschide o foaie lipită de tastatură.
   - Pe foaie: titlu, opțional descriere, dată și oră, proiect, atașament.
   - Se scrie și se trimite în câteva secunde.
6. **Foaia unei sarcini** se deschide de jos, pentru citit și editat rapid:
   - bifă, titlu, dată și oră, proiect, atașamente, descriere;
   - se salvează singură, fără buton de salvare;
   - un buton deschide formularul complet.
7. **Formularul complet**: tot ce e mai sus, plus:
   - dependențele;
   - etapa;
   - responsabilul;
   - recurența;
   - firul de comentarii.
8. **Proiectul**:
   - listă grupată pe trepte;
   - tablă cu carduri în coloane pe trepte („Ordine”);
   - harta dependențelor;
   - temele.
9. **Căutare**: în toate sarcinile; implicit deschise, opțional și închise.
10. **Setări**: temă luminoasă sau întunecată, fundal, mărimea textului (patru
    trepte).

**Pe laptop**:

- Bară laterală permanentă în locul meniului.
- Lista în stânga și sarcina deschisă într-un panou în dreapta, ca într-un client
  de mail.
- Sarcina se poate deschide și mare, peste listă, pentru descrieri lungi.
- Captura rapidă e un rând deasupra listei.

## Gesturi și interacțiuni importante

- Pe telefon, rândul unei sarcini se glisează:
  - spre dreapta: mută pe mâine;
  - spre stânga: dată, oră, șterge, mai multe.
- Apăsarea lungă pe un rând intră în selecție multiplă, pentru acțiuni pe mai
  multe sarcini deodată.
- Ștergerea nu cere confirmare. Apare un mesaj „Anulează” câteva secunde.
- Pe laptop: tastatură pentru tot (căutare, sarcină nouă, navigare).
- Merge și **offline**: ce scrii se trimite când revine semnalul. Interfața arată
  discret „N în așteptare”.

## Unde mai trăiește aplicația

- **Notificări** cu butoane („Gata”, „Amână”).
- **Widget pe Android**:
  - agenda pe 7 zile, cu bifă;
  - un buton de captură rapidă.
- **Bară de captură pe Linux**: o singură linie, deschisă cu o scurtătură de
  tastatură.

Ar fi bine ca acestea să aibă același limbaj vizual, dar sunt pe locul doi.

## Ce vrem și ce nu

**Vrem**:

- culoare folosită cu sens: proiectele au culori reale, iar starea se vede dintr-o
  privire (restant, urgent, azi, gata);
- ierarhie clară și listă densă, dar aerisită;
- ambele teme, luminoasă și întunecată, la fel de îngrijite;
- iconițe, nu emoji;
- texte în română, care sunt mai lungi decât în engleză („Mută restanțele pe
  azi”);
- textul trebuie să se poată mări din setări fără să se strice ecranul.

**Nu vrem**:

- aspect „generat de AI”: gradient mov, neon pe negru, sticlă peste tot, chenar
  pe fiecare cutie;
- aspect de document sau ziar;
- elemente mari care lasă doar 5–6 rânduri pe ecranul telefonului.

## Ce ne-ar ajuta să primim

1. O direcție vizuală: culori, fonturi, iconițe, colțuri, umbre.
2. Ecranele prioritare:
   - **„Azi” pe telefon**;
   - **foaia sarcinii pe telefon**;
   - **captura rapidă**;
   - **lista cu panoul lateral pe laptop**;
   - **meniul lateral**.
3. Dacă e timp, mai departe:
   - formularul complet;
   - tabla proiectului;
   - harta dependențelor;
   - widgetul.
4. Fiecare ecran în ambele teme și în câteva stări:
   - listă goală;
   - restanțe;
   - selecție multiplă;
   - glisare deschisă.
