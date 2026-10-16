#!/bin/sh
# Pull the latest code and rebuild the production stack. Run on the server: ./deploy.sh
set -e
cd "$(dirname "$0")"
git pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
