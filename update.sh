#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$PROJECT_DIR"
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[LCI-SFM] %s\n' "$*"; }

[[ $EUID -eq 0 ]] || die "Run with sudo: sudo $PROJECT_DIR/update.sh"
[[ -d .git ]] || die "This directory is not a Git checkout."
command -v docker >/dev/null 2>&1 || die "Docker is not installed."
command -v curl >/dev/null 2>&1 || die "curl is not installed."
docker info >/dev/null 2>&1 || die "Docker daemon is not responding."
[[ -f .env ]] || die ".env is missing. Run install.sh first."
[[ -s mosquitto/passwd ]] || die "mosquitto/passwd is missing or empty. Run install.sh first."
[[ -f mosquitto/acl && -f mosquitto/mosquitto.conf ]] || die "Mosquitto configuration is incomplete."

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  die "Working tree has local tracked/untracked changes. Review them before updating; no reset was attempted."
fi

BRANCH="$(git branch --show-current)"
[[ -n "$BRANCH" ]] || die "Could not determine current Git branch."
[[ "$BRANCH" != "HEAD" ]] || die "Detached HEAD detected. Check out the intended deployment branch before updating."

BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_NAME="lci_sfm_pre_update_$STAMP.db"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
HAD_BACKEND=0
HAD_DB=0

if docker ps --format '{{.Names}}' | grep -Fxq lci_backend; then
  HAD_BACKEND=1
  if docker exec lci_backend test -f /app/data/lci_sfm.db; then
    HAD_DB=1
    log "Creating SQLite backup before update"
    docker compose exec -T backend node backend/src/db/backup.js backup "/app/data/$BACKUP_NAME"
    docker cp "lci_backend:/app/data/$BACKUP_NAME" "$BACKUP_PATH"
    chmod 600 "$BACKUP_PATH"
    docker exec lci_backend rm -f "/app/data/$BACKUP_NAME"
    log "Database backup saved to $BACKUP_PATH"
  else
    log "Backend is running but the SQLite database file does not exist yet; no database backup was needed."
  fi
else
  log "No running backend container found; proceeding without a database backup."
fi

CURRENT_COMMIT="$(git rev-parse --short HEAD)"
log "Fetching latest changes for branch $BRANCH"
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH" || die "Fast-forward update failed. No reset was attempted; inspect Git history/status manually."
NEW_COMMIT="$(git rev-parse --short HEAD)"

if [[ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]]; then
  log "Already up to date ($NEW_COMMIT). No source changes to deploy."
  exit 0
fi

log "Source update: $CURRENT_COMMIT -> $NEW_COMMIT"
log "Running lint, tests, and frontend build inside Node.js 24"
docker run --rm -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
  -v "$PROJECT_DIR:/workspace" -w /workspace node:24-alpine sh -lc \
  'npm install --no-package-lock && npm run lint && npm test && npm run build'

[[ -s dist/index.html ]] || die "Frontend build did not create dist/index.html."
docker compose config -q

# Re-apply safe host permissions before restarting the broker. This repairs the
# manual Mosquitto permission fix without changing tracked executable bits.
chown 1883:1883 mosquitto/passwd mosquitto/acl
chmod 600 mosquitto/passwd mosquitto/acl

log "Rebuilding and recreating services without deleting persistent volumes"
docker compose up -d --build
docker compose ps

log "Checking backend liveness inside its container"
if ! docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
  docker compose logs --tail=120 backend >&2
  die "Backend liveness check failed after update. Database backup, if created, remains at $BACKUP_PATH. Review logs before attempting rollback."
fi

FRONTEND_BIND_IP="$(sed -n 's/^FRONTEND_BIND_IP=//p' .env | tail -n1)"
FRONTEND_BIND_IP="${FRONTEND_BIND_IP:-127.0.0.1}"
log "Checking frontend through http://$FRONTEND_BIND_IP/"
if ! curl --connect-timeout 3 --max-time 10 -fsS "http://$FRONTEND_BIND_IP/" -o /dev/null; then
  docker compose logs --tail=120 frontend_dashboard >&2
  die "Frontend HTTP health check failed after update at http://$FRONTEND_BIND_IP/. Database backup, if created, remains at $BACKUP_PATH."
fi

for service in mqtt-service backend frontend_dashboard; do
  if ! docker compose ps --status running --services | grep -Fxq "$service"; then
    docker compose logs --tail=100 "$service" >&2
    die "Required service '$service' is not running after update."
  fi
done

cat <<EOF

============================================================
LCI-SFM update finished successfully
============================================================
Previous commit: $CURRENT_COMMIT
Current commit : $NEW_COMMIT
Dashboard URL  : http://$FRONTEND_BIND_IP/
Admin username : sfm_admin (may have been changed in the UI)
Database backup: $([[ $HAD_DB -eq 1 ]] && printf '%s' "$BACKUP_PATH" || printf 'not created')
Update command : sudo $PROJECT_DIR/update.sh

Service status:
EOF
docker compose ps
printf '\nNo Docker volumes were deleted. Existing .env and MQTT credentials were preserved.\n'
printf 'A code rollback is not automatic if a post-deploy health check fails; inspect logs and the backup before recovery.\n'
