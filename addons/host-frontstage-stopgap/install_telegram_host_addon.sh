#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADDON_DIR="$SCRIPT_DIR"
BRIDGE_SRC="$ADDON_DIR/bridge"
RUNTIME_DIR="$ADDON_DIR/runtime"

FORCE=0

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/openclaw-state-dir [plugin-name] [--force]"
  exit 1
fi

STATE_DIR="$1"
PLUGIN_NAME="personal-hooks-bridge"
if [[ $# -ge 2 && "$2" != "--force" ]]; then
  PLUGIN_NAME="$2"
fi
if [[ "${@: -1}" == "--force" ]]; then
  FORCE=1
fi
PLUGIN_DST="$STATE_DIR/workspace/plugins/$PLUGIN_NAME"

mkdir -p "$STATE_DIR/workspace/plugins"
if [[ -e "$PLUGIN_DST" ]]; then
  if [[ $FORCE -ne 1 ]]; then
    echo "Refusing to overwrite existing plugin dir: $PLUGIN_DST"
    echo "Re-run with --force to back it up and replace it."
    exit 2
  fi
  BACKUP_DST="${PLUGIN_DST}.bak.$(date +%Y%m%d-%H%M%S)"
  mv "$PLUGIN_DST" "$BACKUP_DST"
fi
cp -R "$BRIDGE_SRC" "$PLUGIN_DST"

cat <<EOF
Installed Telegram host addon files to:
  $PLUGIN_DST

Included real files:
  - bridge/index.ts
  - bridge/openclaw.plugin.json
  - bridge/package.json
  - runtime/openclaw.heartbeat.sample.json
  - runtime/heartbeat_runtime_patch.template.js

Next host-side steps:
1. Merge runtime/openclaw.heartbeat.sample.json into your openclaw.json agent heartbeat config.
2. If you want persisted lastHeartbeatText to match final delivered text, apply runtime/heartbeat_runtime_patch.template.js to your gateway build.
3. Reload the gateway so the plugin is registered.
EOF
