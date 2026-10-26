#!/usr/bin/env bash
# Instalează (sau actualizează) aplicația Horizontal pentru Linux pe acest
# calculator: fereastra proprie, bara de captură pe Ctrl+Shift+A, mementourile
# cu butoane și pornirea la login. Fără sudo: totul ajunge în ~/.local.
#
#   bash install-linux-app.sh
#
# Re-rulabil: aceeași comandă aduce ultima versiune și reinstalează. Interfața
# se actualizează oricum singură (aplicația încarcă site-ul publicat); scriptul
# trebuie rulat din nou doar când se schimbă `desktop/` din repo-ul Horizontal.
#
# Construiește din sursă (repo-ul Horizontal e public), nu descarcă un binar:
# un build gata făcut ar fi trebuit publicat și ținut la zi separat.
set -euo pipefail

SRC="${HORIZONTAL_SRC:-$HOME/.local/share/horizontal-src}"
REPO="https://github.com/lightsongjs/Horizontal.git"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Lipsește „$1”. Instalează-l întâi: $2" >&2; exit 1; }
}
need git       "sudo dnf install git        (Ubuntu: sudo apt install git)"
need node      "sudo dnf install nodejs     (Ubuntu: sudo apt install nodejs)"
need npm       "sudo dnf install nodejs-npm (Ubuntu: sudo apt install npm)"
need gdbus     "sudo dnf install glib2      (Ubuntu: sudo apt install libglib2.0-bin)"
need gsettings "sudo dnf install glib2      (Ubuntu: sudo apt install libglib2.0-bin)"

if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo "Trebuie Node 20 sau mai nou (ai $(node -v))." >&2
  exit 1
fi

# Scurtătura și notificările țin de GNOME; pe alt desktop aplicația merge, dar
# Ctrl+Shift+A trebuie pusă de mână din setările acelui desktop.
case "${XDG_CURRENT_DESKTOP:-}" in
  *GNOME*) ;;
  *) echo "Atenție: desktopul nu e GNOME (${XDG_CURRENT_DESKTOP:-necunoscut}); scurtătura Ctrl+Shift+A poate să nu funcționeze." >&2 ;;
esac

if [ -d "$SRC/.git" ]; then
  echo "Actualizez sursa din $SRC…"
  git -C "$SRC" fetch -q --depth 1 origin master
  git -C "$SRC" reset -q --hard origin/master
else
  echo "Descarc Horizontal în $SRC…"
  mkdir -p "$(dirname "$SRC")"
  git clone -q --depth 1 "$REPO" "$SRC"
fi

cd "$SRC"
echo "Construiesc aplicația (prima dată descarcă ~100 MB)…"
npm --prefix desktop ci --no-audit --no-fund
npm --prefix desktop run app:install

cat <<'EOF'

Gata. Pornește Horizontal din Activities și loghează-te o dată.
  • Ctrl+Shift+A — bara de captură (Enter salvează, Esc închide)
  • X pe fereastră o ascunde; aplicația rămâne pornită și sună mementourile
  • pornește singură la login, ascunsă
Dacă și Chrome-ul de pe acest calculator e abonat la notificările site-ului,
dezactivează-le acolo, altfel fiecare memento vine de două ori.
Dezinstalare: npm --prefix ~/.local/share/horizontal-src/desktop run app:uninstall
EOF
