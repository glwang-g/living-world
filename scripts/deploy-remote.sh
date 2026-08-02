#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/living-world

if [[ -f "$HOME/.cargo/env" ]]; then
  # rustup installs cargo for the ubuntu user rather than system-wide.
  source "$HOME/.cargo/env"
fi

npm ci
npm run build
cargo build --release --manifest-path engine/Cargo.toml -p world-server

sudo systemctl restart living-world-world.service
sudo systemctl restart living-world-web.service

curl --fail --silent http://127.0.0.1:8787/api/snapshot >/dev/null
curl --fail --silent http://127.0.0.1:3000/ >/dev/null
