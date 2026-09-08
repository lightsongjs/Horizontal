# Cum instalezi Horizontal ca aplicație pe desktop (Linux / GNOME)

Aplicația rulează pe <https://horizontal-dyx.pages.dev>. „Instalarea" locală nu
copiază nimic din cod — face doar o **fereastră proprie**, fără bara de adresă,
cu iconiță în Activities și fixabilă în dash.

## Varianta 1 — din Chrome, două click-uri

Deschizi <https://horizontal-dyx.pages.dev> în Chrome → meniu ⋮ →
*Cast, save and share* → *Install page as app*.

Chrome scrie singur fișierul `.desktop` și pune iconița corectă. E varianta
recomandată dacă nu vrei să reglezi nimic.

Dezavantajul: fereastra se deschide la dimensiunea pe care Chrome o reține, iar
`manifest.orientation` fiind `portrait-primary`, prima deschidere poate fi
îngustă → aplicația cade pe layout-ul mobil. Se rezolvă maximizând o dată;
Chrome ține minte.

## Varianta 2 — fișier `.desktop` scris de mână

Controlezi flag-urile de lansare (mărimea ferestrei, maximizat, fullscreen).
Trei pași:

### 1. Iconițele

Copiază-le din `public/` în tema de iconițe a utilizatorului, cu numele
`horizontal`:

```bash
ICODIR="$HOME/.local/share/icons/hicolor"
mkdir -p "$ICODIR"/{512x512,192x192}/apps "$ICODIR/scalable/apps"
cp public/pwa-512x512.png "$ICODIR/512x512/apps/horizontal.png"
cp public/pwa-192x192.png "$ICODIR/192x192/apps/horizontal.png"
cp public/icon.svg        "$ICODIR/scalable/apps/horizontal.svg"
gtk-update-icon-cache -f -t "$ICODIR"
```

Numele fișierului (`horizontal`) e ce pui la `Icon=` mai jos. De-aia nu e nevoie
de cale absolută: GNOME caută în temă și alege singur mărimea potrivită.

### 2. Fișierul `.desktop`

```bash
cat > "$HOME/.local/share/applications/horizontal.desktop" <<'DESKTOP'
[Desktop Entry]
Version=1.0
Type=Application
Name=Horizontal
Comment=Project planning with dependency layers and waves
Exec=/usr/bin/google-chrome-stable --app=https://horizontal-dyx.pages.dev/ --start-maximized
Icon=horizontal
Terminal=false
Categories=Office;ProjectManagement;
StartupNotify=true
StartupWMClass=chrome-horizontal-dyx.pages.dev__-Default
DESKTOP
chmod +x "$HOME/.local/share/applications/horizontal.desktop"
update-desktop-database "$HOME/.local/share/applications"
```

Ce face fiecare linie care contează:

- **`--app=URL`** — fereastră fără tab-uri și fără bara de adresă. Ăsta e tot
  „modul aplicație"; nu e nevoie de niciun ambalaj (Electron, Tauri).
- **`--start-maximized`** — aplicația e mobile-first, iar `styles.css` are
  breakpoint-uri la 780px și 900px. O fereastră îngustă arată layout-ul de
  telefon. Alternative: `--window-size=1200,900` pentru o mărime fixă, sau
  `--start-fullscreen` pentru fullscreen adevărat (fără bara de titlu).
- **`StartupWMClass`** — leagă fereastra de această intrare, ca GNOME să arate
  iconița aplicației în dash și nu pe cea de Chrome. Formatul e
  `chrome-<domeniu>__-Default` (dublu underscore, apoi numele profilului).
- **fără `--user-data-dir`** — deliberat: rulează pe profilul Chrome implicit,
  deci sesiunea Supabase și abonamentul de web push sunt aceleași ca în tab. Un
  profil separat ar cere login din nou și ar înregistra un al doilea dispozitiv
  la mementouri.

### 3. Fixează în dash

Activities → caută „Horizontal" → click dreapta → *Pin to Dash*.

## Dezinstalare

```bash
rm ~/.local/share/applications/horizontal.desktop
rm ~/.local/share/icons/hicolor/*/apps/horizontal.*
```

(Dacă ai folosit varianta 1, dezinstalezi din `chrome://apps` → click dreapta →
*Remove from Chrome*.)

## Ce NU rezolvă instalarea

Notificările tot depind de setup-ul de push descris în `CLAUDE.md` — fereastra
de aplicație nu schimbă nimic acolo. Iar service worker-ul se actualizează la
fel ca în browser: la deschidere/focus, prin `src/pwa.ts`.
