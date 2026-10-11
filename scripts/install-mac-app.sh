#!/bin/zsh
# Installe (ou met à jour) Recap comme application Mac native.
#   - moteur : build Next autonome dans ~/Library/Application Support/Recap/app
#   - données : ~/Library/Application Support/Recap/data et /uploads (jamais touchées par ce script)
#   - app : Recap.app dans /Applications (ou ~/Applications), fenêtre WKWebView qui démarre le moteur
# Usage : zsh scripts/install-mac-app.sh   (depuis n'importe où ; quittez Recap.app avant)
set -euo pipefail
setopt null_glob

ROOT="${0:A:h:h}"
SUPPORT="$HOME/Library/Application Support/Recap"
DIST=".next-mac"
PORT=3217
NODE="$(command -v node || true)"
cd "$ROOT"

say() { print -P "%F{blue}▸%f $1"; }
fail() { print -P "%F{red}✗%f $1" >&2; exit 1; }

[[ -n "$NODE" ]] || fail "Node.js est introuvable. Installez-le (https://nodejs.org) puis relancez."
command -v swiftc >/dev/null || fail "Swift est introuvable. Lancez : xcode-select --install"
free_kb=$(df -k "$HOME" | tail -1 | awk '{print $4}')
(( free_kb > 1500000 )) || fail "Moins de 1,5 Go libres sur le disque : libérez de la place puis relancez."
if pgrep -f "Recap.app/Contents/MacOS/Recap" >/dev/null; then fail "Recap est ouvert : quittez l'app (⌘Q) puis relancez."; fi

say "Construction du moteur (1 à 2 minutes)…"
rm -rf "$DIST"
# next build réécrit tsconfig.json pour y ajouter son dossier de build : on le restaure après.
cp tsconfig.json /tmp/recap-tsconfig.json
NEXT_DIST_DIR="$DIST" npx next build >/tmp/recap-build.log 2>&1 || { cp /tmp/recap-tsconfig.json tsconfig.json; tail -30 /tmp/recap-build.log; fail "La construction a échoué (journal : /tmp/recap-build.log)."; }
cp /tmp/recap-tsconfig.json tsconfig.json

say "Assemblage du moteur…"
STAGE="$SUPPORT/app.new"
rm -rf "$STAGE"
mkdir -p "$SUPPORT/data" "$SUPPORT/uploads"
cp -R "$DIST/standalone/." "$STAGE/"
mkdir -p "$STAGE/$DIST"
cp -R "$DIST/static" "$STAGE/$DIST/static"
[[ -d public ]] && cp -R public "$STAGE/public"
cp -R drizzle "$STAGE/drizzle"
# Le traçage de Next peut embarquer des fichiers du projet : on ne garde jamais de données ni de secrets.
rm -rf "$STAGE/data" "$STAGE/uploads" "$STAGE"/.env* "$STAGE/tests" "$STAGE/docs" "$STAGE/mac" "$STAGE/.next"
[[ -f "$STAGE/server.js" ]] || fail "Build incomplet : server.js manquant."
rm -rf "$SUPPORT/app"
mv "$STAGE" "$SUPPORT/app"
rm -rf "$DIST"

say "Compilation de l'application Mac…"
BUILD="$(mktemp -d)"
APP="$BUILD/Recap.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 "$ROOT/mac/Recap.swift" -o "$APP/Contents/MacOS/Recap" 2>"$BUILD/swift.log" || { cat "$BUILD/swift.log"; fail "Compilation Swift échouée."; }
swift "$ROOT/mac/make-icon.swift" "$ROOT/mac/icon.svg" "$BUILD/Recap.iconset" && iconutil -c icns "$BUILD/Recap.iconset" -o "$APP/Contents/Resources/Recap.icns"
VERSION="$(node -p "require('./package.json').version")"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Recap</string>
  <key>CFBundleDisplayName</key><string>Recap</string>
  <key>CFBundleIdentifier</key><string>local.recap.app</string>
  <key>CFBundleExecutable</key><string>Recap</string>
  <key>CFBundleIconFile</key><string>Recap</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Recap — pilotage financier</string>
  <key>RecapNodePath</key><string>$NODE</string>
  <key>RecapPort</key><string>$PORT</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

DEST="/Applications"
[[ -w "$DEST" ]] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
rm -rf "$DEST/Recap.app"
mv "$APP" "$DEST/Recap.app"
rm -rf "$BUILD"
touch "$DEST/Recap.app"

say "Recap est installé : $DEST/Recap.app"
say "Vos données : $SUPPORT (data/ et uploads/)"
