#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/living-world

sudo install -m 0644 deploy/systemd/living-world-web.service /etc/systemd/system/living-world-web.service
sudo install -m 0644 deploy/systemd/living-world-world.service /etc/systemd/system/living-world-world.service
sudo systemctl daemon-reload
sudo systemctl enable living-world-web.service living-world-world.service

# Install this only when no existing virtual-host configuration owns the domain.
# If HTTPS is already configured, merge the two proxy locations into that file.
sudo install -m 0644 deploy/nginx/living-world.conf /etc/nginx/sites-available/living-world
sudo ln -sfn /etc/nginx/sites-available/living-world /etc/nginx/sites-enabled/living-world
sudo nginx -t
sudo systemctl reload nginx

bash scripts/deploy-remote.sh
