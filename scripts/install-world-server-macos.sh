#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
LABEL="com.livingworld.world-server"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
DATA_DIR="${PROJECT_DIR}/engine/data"
BINARY="${PROJECT_DIR}/engine/target/debug/world-server"
USER_ID=$(id -u)

mkdir -p "${PLIST_DIR}" "${DATA_DIR}"
cargo build --manifest-path "${PROJECT_DIR}/engine/Cargo.toml" -p world-server

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${BINARY}</string></array>
  <key>WorkingDirectory</key><string>${PROJECT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict><key>LIVING_WORLD_DATA_DIR</key><string>${DATA_DIR}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${DATA_DIR}/world-server.stdout.log</string>
  <key>StandardErrorPath</key><string>${DATA_DIR}/world-server.stderr.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/${USER_ID}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${USER_ID}" "${PLIST_PATH}"
launchctl kickstart -k "gui/${USER_ID}/${LABEL}"
echo "installed ${LABEL}"
echo "data: ${DATA_DIR}"
