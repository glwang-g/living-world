#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${LIVING_WORLD_DEPLOY_LOCKED:-}" ]]; then
  exec env LIVING_WORLD_DEPLOY_LOCKED=1 flock -n /tmp/living-world-deploy.lock "$0" "$@"
fi

cd /home/ubuntu/living-world

if [[ -f "$HOME/.cargo/env" ]]; then
  # rustup installs cargo for the ubuntu user rather than system-wide.
  source "$HOME/.cargo/env"
fi

# A cancelled bootstrap can leave rustup's cargo shim in PATH while the stable
# toolchain itself is incomplete. Revalidate here as a final guard before any
# build step, independent of how this script was invoked.
if ! cargo --version >/dev/null 2>&1; then
  bash scripts/install-remote-prerequisites.sh
  source "$HOME/.cargo/env"
fi

npm ci
npm run build
cargo build --release --manifest-path engine/Cargo.toml -p world-server

sudo install -m 0644 deploy/systemd/living-world-web.service /etc/systemd/system/living-world-web.service
sudo install -m 0644 deploy/systemd/living-world-world.service /etc/systemd/system/living-world-world.service
sudo systemctl daemon-reload
sudo systemctl restart living-world-world.service
sudo systemctl restart living-world-web.service

wait_for_service() {
  local service_name=$1
  local health_url=$2
  local attempt

  for attempt in $(seq 1 30); do
    if curl --fail --silent "$health_url" >/dev/null; then
      echo "$service_name is ready: $health_url"
      return 0
    fi
    sleep 2
  done

  echo "$service_name did not become ready: $health_url" >&2
  sudo systemctl status "$service_name" --no-pager || true
  sudo journalctl -u "$service_name" -n 80 --no-pager || true
  return 1
}

wait_for_service living-world-world.service http://127.0.0.1:8787/api/snapshot
wait_for_service living-world-web.service http://127.0.0.1:3000/
