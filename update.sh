#!/usr/bin/env bash
# LCI-SFM guarded deployment updater.
# Run: sudo /opt/lci-sfm/update.sh
set -Eeuo pipefail
umask 077

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$PROJECT_DIR"

die() { printf '\n[LCI-SFM] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[LCI-SFM] %s\n' "$*"; }
warn() { printf '[LCI-SFM] WARNING: %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

[[ $EUID -eq 0 ]] || die "Run with sudo: sudo $PROJECT_DIR/update.sh"
[[ -d .git ]] || die "This directory is not a Git checkout."
for cmd in git docker curl flock mktemp python3; do
  have "$cmd" || die "Required command is missing: $cmd"
done
docker info >/dev/null 2>&1 || die "Docker daemon is not responding."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
[[ -f .env ]] || die ".env is missing. Refusing to recreate deployment secrets automatically."
[[ -s mosquitto/passwd ]] || die "mosquitto/passwd is missing or empty."
[[ -f mosquitto/acl && -f mosquitto/mosquitto.conf ]] || die "Mosquitto configuration is incomplete."
[[ -f docker-compose.yml && -f nginx/nginx.conf && -f backend/Dockerfile ]] || die "One or more required deployment files are missing."

# Prevent two update runs from racing over Git, the database, or Docker Compose.
exec 9>/run/lock/lci-sfm-update.lock
flock -n 9 || die "Another LCI-SFM update appears to be running."

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  git status --short >&2
  die "Working tree is not clean. Review local changes first; nothing was reset or deleted."
fi

BRANCH="$(git branch --show-current)"
[[ -n "$BRANCH" && "$BRANCH" != "HEAD" ]] || die "Detached HEAD or unknown branch. Check out the intended deployment branch."
git remote get-url origin >/dev/null 2>&1 || die "Git remote 'origin' is not configured."
git fetch --prune origin "$BRANCH" || die "Could not fetch origin/$BRANCH. Check network access and repository permissions."
git show-ref --verify --quiet "refs/remotes/origin/$BRANCH" || die "Remote branch origin/$BRANCH was not found."

CURRENT_FULL="$(git rev-parse HEAD)"
REMOTE_FULL="$(git rev-parse "origin/$BRANCH")"
CURRENT_SHORT="$(git rev-parse --short "$CURRENT_FULL")"
REMOTE_SHORT="$(git rev-parse --short "$REMOTE_FULL")"

if [[ "$CURRENT_FULL" == "$REMOTE_FULL" ]]; then
  log "Already up to date ($CURRENT_SHORT). No build, backup, or restart needed."
  exit 0
fi

if ! git merge-base --is-ancestor "$CURRENT_FULL" "$REMOTE_FULL"; then
  die "The remote branch is not a fast-forward of the deployed commit. Manual review is required; no reset was attempted."
fi

log "Update found: $CURRENT_SHORT -> $REMOTE_SHORT"
log "Testing the candidate commit in an isolated temporary worktree before changing the deployed checkout."

TMP_DIR="$(mktemp -d /tmp/lci-sfm-update.XXXXXX)"
TEST_TREE="$TMP_DIR/source"
PREVIOUS_INDEX_BACKUP="$TMP_DIR/previous-index.html"
WORKTREE_ADDED=0
HAD_PREVIOUS_INDEX=0
FRONTEND_ARTIFACT_PUBLISHED=0
cleanup() {
  local rc=$?
  if [[ "$rc" -ne 0 && "${FRONTEND_ARTIFACT_PUBLISHED:-0}" -eq 1 &&
        "${HAD_PREVIOUS_INDEX:-0}" -eq 1 &&
        -s "${PREVIOUS_INDEX_BACKUP:-/nonexistent}" ]]; then
    install -m 0644 "$PREVIOUS_INDEX_BACKUP" "$PROJECT_DIR/dist/index.html" || true
    warn "Restored the previous frontend index after a failed deployment check."
  fi
  if [[ "$WORKTREE_ADDED" -eq 1 ]]; then
    git -C "$PROJECT_DIR" worktree remove --force "$TEST_TREE" >/dev/null 2>&1 || true
    git -C "$PROJECT_DIR" worktree prune >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TMP_DIR"
  if [[ "$rc" -ne 0 ]]; then
    warn "Update stopped with exit code $rc. Review the message above and service logs before retrying."
  fi
  exit "$rc"
}
trap cleanup EXIT

git worktree add --detach "$TEST_TREE" "$REMOTE_FULL" >/dev/null || die "Could not create isolated test worktree."
WORKTREE_ADDED=1

# Supply local-only runtime settings to the test checkout; never copy them to GitHub.
install -m 600 .env "$TEST_TREE/.env"
install -m 600 mosquitto/passwd "$TEST_TREE/mosquitto/passwd"
install -m 600 mosquitto/acl "$TEST_TREE/mosquitto/acl"

# Test and compile candidate source without touching the live containers or database.
docker run --rm \
  -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
  -v "$TEST_TREE:/workspace" -w /workspace node:24-alpine sh -lc \
  'npm install --no-package-lock --no-audit --no-fund && npm run lint && npm test && npm run build' \
  || die "Candidate lint, tests, dependency installation, or frontend build failed. Live containers have not been redeployed."

[[ -s "$TEST_TREE/dist/index.html" ]] || die "Candidate build did not produce dist/index.html."
docker compose --project-directory "$TEST_TREE" -f "$TEST_TREE/docker-compose.yml" config -q \
  || die "Candidate Docker Compose configuration is invalid."

# Confirm the current deployment and database are present before moving the checkout.
docker compose config -q || die "Current Docker Compose configuration is invalid."
BACKEND_CONTAINER="lci_backend"
DB_CONTAINER_PATH="/app/data/lci_sfm.db"
BACKUP_DIR="$PROJECT_DIR/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PATH=""
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

if docker inspect "$BACKEND_CONTAINER" >/dev/null 2>&1 && docker exec "$BACKEND_CONTAINER" test -s "$DB_CONTAINER_PATH"; then
  BACKUP_NAME="lci_sfm_pre_update_$STAMP.db"
  BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
  log "Creating a SQLite backup before deployment."
  docker exec "$BACKEND_CONTAINER" node /app/backend/src/db/backup.js backup "/app/data/$BACKUP_NAME" \
    || die "SQLite backup command failed. Deployment cancelled."
  docker cp "$BACKEND_CONTAINER:/app/data/$BACKUP_NAME" "$BACKUP_PATH" \
    || die "Could not copy the database backup to the host. Deployment cancelled."
  docker exec "$BACKEND_CONTAINER" rm -f "/app/data/$BACKUP_NAME" \
    || warn "Could not remove the temporary in-container backup file."
  [[ -s "$BACKUP_PATH" ]] || die "Database backup is empty or missing. Deployment cancelled."
  chmod 600 "$BACKUP_PATH"
  python3 - "$BACKUP_PATH" <<'PYSQL' || die "SQLite integrity check failed for the backup. Deployment cancelled."
import sqlite3, sys
path = sys.argv[1]
con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
try:
    result = con.execute("PRAGMA integrity_check").fetchone()
    if not result or result[0] != "ok":
        raise SystemExit(f"SQLite integrity_check failed: {result!r}")
finally:
    con.close()
PYSQL
  log "Database backup passed SQLite integrity_check: $BACKUP_PATH"
else
  die "A running backend and non-empty SQLite database were not found. Refusing an update without a verified backup."
fi

# Keep the existing Mosquitto UID/GID and least-privilege file modes.
chown 1883:1883 mosquitto/passwd mosquitto/acl || die "Could not set Mosquitto file ownership."
chmod 600 mosquitto/passwd mosquitto/acl || die "Could not set Mosquitto file permissions."

# Keep the previous index so the error trap can restore it if a later deployment
# check fails. Old content-hashed assets are retained, so the previous index remains usable.
if [[ -s "$PROJECT_DIR/dist/index.html" ]]; then
  cp -p "$PROJECT_DIR/dist/index.html" "$PREVIOUS_INDEX_BACKUP"
  HAD_PREVIOUS_INDEX=1
fi

log "Fast-forwarding the deployment checkout to $REMOTE_SHORT."
git merge --ff-only "$REMOTE_FULL" || die "Fast-forward failed. No reset was attempted."

# The frontend is served from a bind-mounted dist/ directory; Compose does not build it.
# Publish the exact dist/ artifact produced by the candidate build, copying index.html last
# so users continue to receive the previous entry point until all new assets are present.
log "Publishing the tested frontend build artifact."
mkdir -p "$PROJECT_DIR/dist"
shopt -s dotglob nullglob
for artifact in "$TEST_TREE/dist"/*; do
  [[ "${artifact##*/}" == "index.html" ]] && continue
  cp -a -- "$artifact" "$PROJECT_DIR/dist/"
done
shopt -u dotglob nullglob
install -m 0644 "$TEST_TREE/dist/index.html" "$PROJECT_DIR/dist/index.html" || die "Could not publish the tested frontend index. Database backup: $BACKUP_PATH"
FRONTEND_ARTIFACT_PUBLISHED=1

log "Rebuilding and recreating services. Persistent Docker volumes will not be removed."
docker compose up -d --build || {
  docker compose ps >&2 || true
  docker compose logs --tail=120 >&2 || true
  die "Docker Compose deployment failed. Database backup: $BACKUP_PATH"
}

log "Waiting up to 90 seconds for backend readiness."
READY=0
for _ in $(seq 1 30); do
  if docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 3
done
if [[ "$READY" -ne 1 ]]; then
  docker compose logs --tail=150 backend mqtt-service >&2 || true
  die "Backend readiness check failed. The database backup remains at $BACKUP_PATH; automatic database restore was intentionally not attempted."
fi

FRONTEND_BIND_IP="$(sed -n 's/^FRONTEND_BIND_IP=//p' .env | tail -n1)"
FRONTEND_BIND_IP="${FRONTEND_BIND_IP:-127.0.0.1}"
log "Checking frontend HTTP response at http://$FRONTEND_BIND_IP/."
if ! curl --connect-timeout 3 --max-time 10 --retry 3 --retry-delay 2 -fsS \
  "http://$FRONTEND_BIND_IP/" -o /dev/null; then
  docker compose logs --tail=150 frontend_dashboard backend >&2 || true
  die "Frontend HTTP check failed. Database backup remains at $BACKUP_PATH."
fi

for service in mqtt-service backend frontend_dashboard; do
  if ! docker compose ps --status running --services | grep -Fxq "$service"; then
    docker compose logs --tail=120 "$service" >&2 || true
    die "Required service '$service' is not running. Database backup remains at $BACKUP_PATH."
  fi
done

log "Deployment checks passed."
printf '\n============================================================\n'
printf 'LCI-SFM update completed successfully\n'
printf 'Previous commit: %s\n' "$CURRENT_SHORT"
printf 'Current commit : %s\n' "$(git rev-parse --short HEAD)"
printf 'Dashboard URL  : http://%s/\n' "$FRONTEND_BIND_IP"
printf 'Database backup: %s\n' "$BACKUP_PATH"
printf '============================================================\n\n'
docker compose ps
printf '\nSafety notes:\n'
printf -- '- No Docker volumes were deleted.\n'
printf -- '- .env and MQTT credentials were kept local.\n'
printf -- '- No git reset/clean or automatic database restore was used.\n'
printf -- '- If a post-deployment check fails, inspect logs and use the backup/recovery procedure; application/schema rollback is not automatic.\n'
