# Widget-uri Android — design

2026-10-06. Mockup aprobat: `prototype-widget.html`.

## Ce vrea omul

Două widget-uri pe ecranul de start al telefonului (Redmi Note 13 Pro, Android 16):

1. **Quick add, 1×1** — un pătrat cu „+"; atingerea deschide foaia rapidă cu
   tastatura sus.
2. **Lista, 4×2 și mai mare** — agenda sarcinilor, ca widget-ul de listă din
   Google Calendar: `RESTANȚE` (roșu, mereu sus), `AZI · MAR 6 OCT`,
   `MÂINE · MIE 7 OCT`, apoi zilele până la a șaptea. Zilele goale nu apar.
   Fiecare rând are o căsuță; bifa scoate rândul **imediat** (fără fereastră de
   anulare — alegerea omului). Atingerea pe rând deschide tichetul; Back de acolo
   duce pe ecranul de start al telefonului.

Respins: grila pe coloane de zile (titluri ilizibile la ~70px/coloană); un singur
widget cu [+] (quick add-ul trebuie să stea unde ajunge degetul mare).

## Conținutul

- **Rând:** căsuță · titlu (un rând, „…") · proiectul sub titlu, mono mic ·
  în dreapta ora DOAR dacă are una (regula `DueChip`), ↻ dacă e recurentă,
  clopoțel dacă are memento. La restanțe, în dreapta stă ziua scadenței
  („ieri", „vin 2"), nu ora.
- **Antet widget:** „Horizontal · N" (atingere → aplicația pe „Azi"), ⟳
  (reîmprospătare acum), [+] (quick add).
- **Gol:** „Nimic restant, nimic azi." — golul e vestea bună.
- **Temă:** urmează telefonul (`values` / `values-night`), culorile din
  `:root` ale aplicației. Literata + IBM Plex Mono ca resurse de font.
  Fără chenare (sistemul vizual), un singur accent, restanțe în `--blocked`.

## Regula de grupare — scrisă în două limbi

Gruparea e `buildSmartLists` din `src/lib/schedule.ts`, rescrisă în Kotlin pur
(`core/Agenda.kt`): restanță = nebifat și trecut (cu oră: ora a trecut; toată
ziua: o zi anterioară); restanțele NU apar și în ziua lor; zile 0..6; ordinea
`compareDue`. Cazuri comune în `src/lib/agenda.fixtures.json`, citite de
vitest și de JUnit (tiparul `pushPayload.fixtures.json`). Un caz nou se adaugă
în JSON.

## Datele: două surse, câștigă cea mai proaspătă

Citirea nativă de azi (`SyncWorker`) ia doar tichete cu `remind_at` — nu ajunge
pentru widget (o sarcină de azi fără memento, o restanță veche). Deci:

- **Citire nativă nouă**, în același `SyncWorker` (aceeași sesiune nativă, aceeași
  cadență: 15 min, după acțiuni, după boot, plus ⟳): `done=false`,
  `due_at < sfârșitul zilei a 7-a`, fără limită inferioară, `limit=200`,
  ordonat pe `due_at`. Câmpuri: `id,title,due_at,all_day,remind_at,rrule,projects(name)`.
  O eroare de citire nu golește widget-ul: rămâne ultima listă.
- **Pagina împinge** lista ei de scadențe după orice schimbare
  (`setAgenda`, metodă NOUĂ de plugin → `API` crește la 2, pagina verifică
  `api >= 2` înainte de apel). `readAt` = pornirea ultimei citiri de rețea,
  0 offline — aceeași regulă ca `setReminders`.
- Stocare în `PlanStore` (`agendaPage`, `agendaNative`); câștigă `readAt` mai
  mare. Peste listă se aplică coada nativă: un id cu acțiune `DONE` în coadă
  nu se arată (asta face bifa „imediată", și offline).
- Orice schimbare a listei sau a cozii → `AppWidgetManager.notifyAppWidgetViewDataChanged`.
  La miezul nopții gruparea se schimbă fără date noi → o alarmă inexactă la
  00:00 locală reîmprospătează widget-ul.

## Acțiunile

- **Bifa:** `CheckBox` în `RemoteViews` cu `setOnCheckedChangeResponse`
  (Android 12+). Pune `NativeAction(DONE, prevDueAt = due_at)` în coada
  existentă → `DrainWorker` (garda pentru recurențe din `buildPatch` rămâne).
  O recurentă dispare și reapare la data nouă după `SyncWorker.now()`. Fără
  sesiune nativă: bifa deschide aplicația în loc să pună în coadă.
- **Rând:** `PendingIntent` spre `MainActivity` cu `EXTRA_OPEN` (drumul
  notificării) plus `EXTRA_FROM_WIDGET`. Pagina deschide tichetul.
- **Back după un tichet din widget:** `MainActivity` reține `fromWidget`; când
  foaia se închide (pagina anunță prin plugin, sau `canGoBack` e false),
  `moveTaskToBack(true)` — omul ajunge pe ecranul de start, chiar dacă aplicația
  era deja deschisă pe alt ecran. Orice altă navigare în aplicație șterge
  marcajul.
- **Quick add (ambele widget-uri):** `MainActivity` cu `EXTRA_QUICK`; pagina
  deschide foaia rapidă (`openQuick`). Tastatura: întâi probă pe telefon dacă
  focusul din pagină o ridică; dacă nu, pluginul cheamă
  `InputMethodManager.showSoftInput` pe WebView. Back închide foaia și, cu
  `fromWidget`, duce pe ecranul de start.
- **⟳:** `SyncWorker.now()`.

## Limite asumate

- Widget-ul de listă există doar pe Android 12+ (`minSdk` e 24); pe mai vechi nu
  apare în lista de widget-uri (`bool` în `values-v31`). Quick add-ul merge peste tot.
- Prospețimea cu aplicația închisă = cadența `SyncWorker` (15 min) — o sarcină
  creată pe laptop apare în widget în cel mult ~15 min, sau la ⟳.
- Fără creare din widget fără aplicație: quick add-ul trece prin pagină
  (recunoașterea datei, `#proiect`, coada offline există o singură dată).

## Teste

- `core/Agenda.kt` + fixtures comune (vitest + `npm run android:test`).
- Parsarea răspunsului nou și filtrul de coadă: JUnit în `core/`.
- Pe telefon (anunțat dinainte): adăugare widget-uri, bifă online și offline,
  recurentă, atingere rând + Back, quick add cu tastatura, temă închisă/deschisă,
  trecerea de miezul nopții.

## Livrare

APK nou (`versionCode` 4, `API` 2) + push pe `master` pentru partea de pagină
(`setAgenda`, `EXTRA_QUICK`/`fromWidget`). Ordinea: pagina întâi (verifică `api`,
deci e inofensivă pe APK-ul vechi), apoi APK-ul.
