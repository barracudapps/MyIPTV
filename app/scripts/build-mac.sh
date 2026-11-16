#!/usr/bin/env bash
# Application macOS et image disque. Les fichiers de mise à jour signés ne sont produits
# que si la clé privée est disponible (variable ou ~/.tauri/myiptv.key).
set -euo pipefail
cd "$(dirname "$0")/.."
KEY_FILE="${TAURI_SIGNING_KEY_FILE:-$HOME/.tauri/myiptv.key}"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$KEY_FILE" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
fi
EXTRA=()
[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || EXTRA=(--config src-tauri/tauri.no-updater.json)
npx tauri build --bundles app "${EXTRA[@]+"${EXTRA[@]}"}"
V=$(node -p "require('./package.json').version")
mkdir -p ../target/release/bundle/dmg
hdiutil create -volname "MyIPTV $V" -srcfolder ../target/release/bundle/macos/MyIPTV.app -ov -format UDZO "../target/release/bundle/dmg/MyIPTV_${V}_$(uname -m).dmg"
