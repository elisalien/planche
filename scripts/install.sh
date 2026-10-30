#!/bin/sh
# Planche installer for macOS / Linux.
#
#   curl -fsSL https://github.com/elisalien/planche/releases/latest/download/install.sh | sh
#   sh install.sh [--version v0.1.0] [--dir ~/apps/planche]
#
# Downloads the release, installs production dependencies and adds a `planche`
# command (plus a desktop entry on Linux). Re-running updates the app and keeps boards (data/).
set -eu

REPO="${PLANCHE_REPO:-elisalien/planche}"
VERSION="latest"
INSTALL_DIR="${PLANCHE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/planche}"
BIN_DIR="$HOME/.local/bin"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
done

info() { printf '\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mErreur : %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- Node.js
command -v node >/dev/null 2>&1 || fail "Node.js 22+ est requis (https://nodejs.org, ou 'brew install node', ou nvm)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 22+ est requis (version actuelle : $(node -v))."
info "Node.js $(node -v)"

# ---------------------------------------------------------------- download
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
info "Téléchargement de Planche ($VERSION) depuis $REPO"
OK=0
# gh handles private repositories with the user's own login.
if command -v gh >/dev/null 2>&1; then
  if [ "$VERSION" = "latest" ]; then
    gh release download --repo "$REPO" --pattern planche.tar.gz --dir "$TMP" >/dev/null 2>&1 && OK=1 || true
  else
    gh release download "$VERSION" --repo "$REPO" --pattern planche.tar.gz --dir "$TMP" >/dev/null 2>&1 && OK=1 || true
  fi
fi
if [ "$OK" -ne 1 ]; then
  if [ "$VERSION" = "latest" ]; then URL="https://github.com/$REPO/releases/latest/download/planche.tar.gz"
  else URL="https://github.com/$REPO/releases/download/$VERSION/planche.tar.gz"; fi
  curl -fsSL "$URL" -o "$TMP/planche.tar.gz" || fail "téléchargement impossible ($URL)."
fi
tar -xzf "$TMP/planche.tar.gz" -C "$TMP"
[ -f "$TMP/planche/server/server.mjs" ] || fail "archive de release invalide."

# ---------------------------------------------------------------- install
info "Installation dans $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# Replace application files, keep the boards stored in data/.
find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +
cp -R "$TMP/planche/." "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/planche.sh"

info "Installation des dépendances (npm ci)"
(cd "$INSTALL_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

# ---------------------------------------------------------------- launcher
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/planche" <<EOF
#!/bin/sh
exec "$INSTALL_DIR/planche.sh" "\$@"
EOF
chmod +x "$BIN_DIR/planche"

if [ "$(uname)" = "Linux" ]; then
  APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$APPS"
  cat > "$APPS/planche.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Planche
Comment=Tableau blanc collaboratif
Exec=$BIN_DIR/planche
Terminal=true
Categories=Office;Graphics;
EOF
fi

echo
printf '\033[32mPlanche %s installé.\033[0m\n' "$(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo '')"
echo "  Lancer : planche   (ou $INSTALL_DIR/planche.sh)"
echo "  Adresse : http://localhost:8787"
echo "  Mettre à jour : relancer ce script (les tableaux dans data/ sont conservés)"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "  Note : ajoutez $BIN_DIR à votre PATH." ;; esac
