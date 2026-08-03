#!/usr/bin/env bash
set -euo pipefail

exec 9>/tmp/living-world-bootstrap.lock
if ! flock -n 9; then
  echo "Another Living World bootstrap is still running; wait for it to finish." >&2
  exit 1
fi

if [[ $(id -un) != "ubuntu" ]]; then
  echo "Run this installer as the ubuntu user." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y build-essential ca-certificates curl git nginx pkg-config libssl-dev rsync

if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v cargo >/dev/null; then
  # A cancelled rustup download can leave incomplete artifacts behind. The
  # lock above ensures no other installer is using these temporary files.
  mkdir -p "$HOME/.rustup/downloads"
  find "$HOME/.rustup/downloads" -maxdepth 1 -type f -name '*.partial' -delete
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
