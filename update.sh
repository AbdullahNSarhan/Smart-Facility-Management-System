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
docker info >/dev/null 2>&1 || die "Docker daemon is not responding."
[[ -f .env ]] || die ".env is missing. Run install.sh first."
[[ -s mosquitto/passwd ]] || die "mosquitto/passwd is missing or empty. Run install.sh first."

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  die "Working tree has local tracked/untracked changes. Review them before updating; no reset was attempted."
fi

BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_NAME="lci_sfm_pre_update_$STAMP.db"
HAD_BACKEND=0

if docker ps --format '{{.Names}}' | grep -Fxq lci_backend; then
  HAD_BACKEND=1
  log "Creating an online SQLite backup before update"
  docker compose exec -T backend node backend/src/db/backup.js backup "/app/data/$BACKUP_NAME"
  docker cp "lci_backend:/app/data/$BACKUP_NAME" "$BACKUP_DIR/$BACKUP_NAME"
  chmod 600 "$BACKUP_DIR/$BACKUP_NAME"
  docker exec lci_backend rm -f "/app/data/$BACKUP_NAME"
  log "Database backup saved to $BACKUP_DIR/$BACKUP_NAME"
else
  log "No running backend container found; skipping database backup."
fi

CURRENT_COMMIT="$(git rev-parse --short HEAD)"
BRANCH="$(git branch --show-current)"
[[ -n "$BRANCH" ]] || die "Could not determine current Git branch."
log "Fetching latest changes for branch $BRANCH"
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH" || die "Fast-forward update failed. No reset was attempted; inspect Git history/status manually."

NEW_COMMIT="$(git rev-parse --short HEAD)"
log "Updated source: $CURRENT_COMMIT -> $NEW_COMMIT"
log "Building frontend and running lint/tests inside Node.js 24 container"
docker run --rm -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
  -v "$PROJECT_DIR:/workspace" -w /workspace node:24-alpine sh -lc \
  'npm install --no-package-lock && npm run lint && npm test && npm run build'

[[ -s dist/index.html ]] || die "Frontend build did not create dist/index.html."
docker compose config -q

log "Rebuilding and recreating services without deleting persistent volumes"
docker compose up -d --build
docker compose ps

log "Checking backend liveness"
if ! curl --connect-timeout 3 --max-time 10 -fsS "http://127.0.0.1/api/health/live"; then
  docker compose logs --tail=120 backend >&2
  die "Update was applied but backend liveness check failed. Backup is preserved at $BACKUP_DIR/$BACKUP_NAME (if a backup was made). Review logs before any rollback."
fi

cat <<EOF

Update finished.
Previous commit: $CURRENT_COMMIT
Current commit:  $NEW_COMMIT
Database backups (if the backend was running): $BACKUP_DIR
No Docker volumes were deleted.
EOF
