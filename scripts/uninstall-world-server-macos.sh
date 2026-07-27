#!/bin/sh
set -eu

LABEL="com.livingworld.world-server"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
USER_ID=$(id -u)

launchctl bootout "gui/${USER_ID}/${LABEL}" 2>/dev/null || true
rm -f "${PLIST_PATH}"
echo "uninstalled ${LABEL}; world data was kept in the project"
