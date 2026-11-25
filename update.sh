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

if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" && $EUID -ne 0 ]]; then
  die "Run with sudo: sudo $PROJECT_DIR/update.sh"
fi
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

# Prevent concurrent install.sh or update.sh runs from racing over Git, SQLite, or Docker Compose.
LOCK_DIR="/var/lock"
[[ -d "$LOCK_DIR" ]] || LOCK_DIR="/run/lock"
[[ -d "$LOCK_DIR" ]] || LOCK_DIR="/tmp"
DEPLOY_LOCK_FILE="${LCI_DEPLOY_LOCK_FILE:-$LOCK_DIR/lci-sfm-deploy.lock}"
exec 9>"$DEPLOY_LOCK_FILE"
flock -n 9 || die "Another LCI-SFM install or update operation appears to be running (lock: $DEPLOY_LOCK_FILE)."

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
PREV_COMMIT="$CURRENT_FULL"
REMOTE_FULL="$(git rev-parse "origin/$BRANCH")"
CURRENT_SHORT="$(git rev-parse --short "$CURRENT_FULL")"
REMOTE_SHORT="$(git rev-parse --short "$REMOTE_FULL")"

if [[ "$CURRENT_FULL" == "$REMOTE_FULL" ]]; then
  # A current Git HEAD does not prove that the installer ever finished or that
  # the stack is healthy. Never report success when deployment is incomplete.
  if [[ ! -s "$PROJECT_DIR/dist/index.html" ]]; then
    die "Source is up to date ($CURRENT_SHORT), but dist/index.html is missing. Run: sudo bash $PROJECT_DIR/install.sh"
  fi
  if ! docker compose config -q || ! docker compose ps --status running --services | grep -Fxq mqtt-service || ! docker compose ps --status running --services | grep -Fxq backend || ! docker compose ps --status running --services | grep -Fxq frontend_dashboard; then
    docker compose ps >&2 || true
    die "Source is up to date ($CURRENT_SHORT), but the Compose stack is not fully running. Run: sudo bash $PROJECT_DIR/install.sh"
  fi
  FRONTEND_IP="$(sed -n 's/^FRONTEND_BIND_IP=//p' .env | tail -n1)"
  FRONTEND_IP="${FRONTEND_IP:-127.0.0.1}"
  if ! curl --connect-timeout 3 --max-time 8 -fsS "http://$FRONTEND_IP/api/health/ready" -o /dev/null; then
    docker compose logs --tail=80 frontend_dashboard backend mqtt-service >&2 || true
    die "Source is up to date ($CURRENT_SHORT), but the application is not ready. Run: sudo bash $PROJECT_DIR/install.sh"
  fi
  log "Source is up to date ($CURRENT_SHORT) and the running deployment passes basic checks. No update needed."
  exit 0
fi

if ! git merge-base --is-ancestor "$CURRENT_FULL" "$REMOTE_FULL"; then
  die "The remote branch is not a fast-forward of the deployed commit. Manual review is required; no reset was attempted."
fi

log "Update found: $CURRENT_SHORT -> $REMOTE_SHORT"
log "Testing the candidate commit in an isolated temporary worktree before changing the deployed checkout."

TMP_DIR="$(mktemp -d /tmp/lci-sfm-update.XXXXXX)"
TEST_TREE="$TMP_DIR/source"
PREVIOUS_DIST_BACKUP="$TMP_DIR/previous-dist"
WORKTREE_ADDED=0
HAD_PREVIOUS_DIST=0
FRONTEND_ARTIFACT_PUBLISHED=0
GIT_FAST_FORWARDED=0
COMPOSE_DEPLOY_STARTED=0
UPDATE_SUCCEEDED=0

cleanup() {
  local rc=$?
  if [[ "$rc" -ne 0 && "${UPDATE_SUCCEEDED:-0}" -ne 1 ]]; then
    if [[ "${FRONTEND_ARTIFACT_PUBLISHED:-0}" -eq 1 && "${HAD_PREVIOUS_DIST:-0}" -eq 1 && -d "${PREVIOUS_DIST_BACKUP:-/nonexistent}" ]]; then
      rm -rf -- "$PROJECT_DIR/dist"
      cp -a -- "$PREVIOUS_DIST_BACKUP" "$PROJECT_DIR/dist" || true
      chmod 755 "$PROJECT_DIR/dist" || true
      find "$PROJECT_DIR/dist" -type d -exec chmod 755 {} + 2>/dev/null || true
      find "$PROJECT_DIR/dist" -type f -exec chmod 644 {} + 2>/dev/null || true
      warn "Restored the complete previous dist/ directory after a failed deployment check."
    fi
    if [[ "${GIT_FAST_FORWARDED:-0}" -eq 1 && -n "${PREV_COMMIT:-}" ]]; then
      if [[ -z "$(git -C "$PROJECT_DIR" status --porcelain --untracked-files=normal 2>/dev/null)" ]]; then
        git -C "$PROJECT_DIR" reset --hard "$PREV_COMMIT" >/dev/null 2>&1 || true
        warn "Rolled back Git working tree to previous commit $CURRENT_SHORT ($PREV_COMMIT) so a retry will not falsely report Already up to date."
      else
        warn "Skipped automatic Git rewind because local modifications were detected after merge; inspect git status."
      fi
    fi
    if [[ "${COMPOSE_DEPLOY_STARTED:-0}" -eq 1 ]]; then
      warn "Redeploying previous known-good container state after deployment check failure..."
      docker compose up -d --build >/dev/null 2>&1 || true
    fi
    if [[ -n "${BACKUP_PATH:-}" && -s "${BACKUP_PATH:-/nonexistent}" ]]; then
      warn "Verified pre-update SQLite backup preserved at: $BACKUP_PATH"
    fi
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

# Test in the same git/bash/flock-capable Alpine image used by install.sh.
# Use the candidate Dockerfile from the worktree before publishing any changes.
[[ -f "$TEST_TREE/deployment/validation.Dockerfile" ]] || die "Candidate deployment validation Dockerfile is missing."
docker build -t lci-sfm-validator:node24 -f "$TEST_TREE/deployment/validation.Dockerfile" "$TEST_TREE/deployment" \
  || die "Could not build candidate deployment validation image."
docker run --rm \
  -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
  -v "$TEST_TREE:/workspace" -w /workspace lci-sfm-validator:node24 sh -lc \
  'npm ci --no-audit --no-fund && npm run lint && npm test && npm run build' \
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
if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" ]]; then
  chown 1883:1883 mosquitto/passwd mosquitto/acl || die "Could not set Mosquitto file ownership."
fi
chmod 600 mosquitto/passwd mosquitto/acl || die "Could not set Mosquitto file permissions."

# Preserve the entire previous dist/ directory so the error trap can restore all assets
# and index.html if any post-merge deployment or readiness check fails.
if [[ -d "$PROJECT_DIR/dist" ]]; then
  cp -a -- "$PROJECT_DIR/dist" "$PREVIOUS_DIST_BACKUP"
  HAD_PREVIOUS_DIST=1
fi

log "Fast-forwarding the deployment checkout to $REMOTE_SHORT."
git merge --ff-only "$REMOTE_FULL" || die "Fast-forward failed. No reset was attempted."
GIT_FAST_FORWARDED=1

# The frontend is served from a bind-mounted dist/ directory; Compose does not build it.
# Publish the exact dist/ artifact produced by the candidate build, copying index.html last
# so users continue to receive the previous entry point until all new assets are present.
log "Publishing the tested frontend build artifact."
FRONTEND_ARTIFACT_PUBLISHED=1
mkdir -p "$PROJECT_DIR/dist"
# umask 077 is intentional for secrets, but the static asset tree must be
# traversable/readable by the unprivileged Nginx worker.
chmod 755 "$PROJECT_DIR/dist"
shopt -s dotglob nullglob
for artifact in "$TEST_TREE/dist"/*; do
  [[ "${artifact##*/}" == "index.html" ]] && continue
  rm -rf -- "$PROJECT_DIR/dist/${artifact##*/}"
  cp -a -- "$artifact" "$PROJECT_DIR/dist/"
done
shopt -u dotglob nullglob
find "$PROJECT_DIR/dist" -type d -exec chmod 755 {} +
find "$PROJECT_DIR/dist" -type f -exec chmod 644 {} +
install -m 0644 "$TEST_TREE/dist/index.html" "$PROJECT_DIR/dist/index.html" || die "Could not publish the tested frontend index. Database backup: $BACKUP_PATH"

log "Rebuilding and recreating services. Persistent Docker volumes will not be removed."
COMPOSE_DEPLOY_STARTED=1
docker compose up -d --build || {
  docker compose ps >&2 || true
  docker compose logs --tail=120 >&2 || true
  die "Docker Compose deployment failed. Database backup: $BACKUP_PATH"
}

READINESS_TIMEOUT_SEC="${LCI_READINESS_TIMEOUT_SEC:-90}"
READINESS_POLL_SEC="${LCI_READINESS_POLL_SEC:-3}"
log "Waiting up to ${READINESS_TIMEOUT_SEC} seconds for backend operational readiness (/api/health/ready: SQLite + MQTT)."
READY=0
DEADLINE=$((SECONDS + READINESS_TIMEOUT_SEC))
while (( SECONDS < DEADLINE )); do
  if docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/ready', { signal: AbortSignal.timeout(5000) }).then(async r => { if (r.status !== 200) process.exit(1); const d = await r.json(); const sqlOk = d?.sqlite?.ok === true; const mqttOk = d?.mqtt?.enabled === false ? d?.mqtt?.state === 'standby' : (d?.mqtt?.connected === true && d?.mqtt?.subscriptions_ready !== false && d?.mqtt?.state === 'connected'); process.exit(d?.ok === true && d?.status === 'ready' && sqlOk && mqttOk ? 0 : 1); }).catch(() => process.exit(1))" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep "$READINESS_POLL_SEC"
done
if [[ "$READY" -ne 1 ]]; then
  printf '\nBackend readiness check timed out after %s seconds. Last readiness payload:\n' "$READINESS_TIMEOUT_SEC" >&2
  docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/ready', { signal: AbortSignal.timeout(5000) }).then(async r => console.error(await r.text())).catch(e => console.error(e.message))" >&2 || true
  docker compose logs --tail=150 backend mqtt-service >&2 || true
  die "Backend readiness check failed. Previous dist/ and Git commit ($CURRENT_SHORT) will be restored automatically, and the database backup remains at $BACKUP_PATH; automatic database restore was intentionally not attempted."
fi

FRONTEND_BIND_IP="$(sed -n 's/^FRONTEND_BIND_IP=//p' .env | tail -n1)"
FRONTEND_BIND_IP="${FRONTEND_BIND_IP:-127.0.0.1}"
log "Checking frontend HTTP and reverse-proxied readiness at http://$FRONTEND_BIND_IP/."
if ! curl --connect-timeout 3 --max-time 10 --retry 3 --retry-delay 2 -fsS \
  "http://$FRONTEND_BIND_IP/" -o /dev/null; then
  docker compose logs --tail=150 frontend_dashboard backend >&2 || true
  die "Frontend HTTP check failed. Database backup remains at $BACKUP_PATH."
fi

READY_JSON="$(curl --connect-timeout 3 --max-time 10 --retry 3 --retry-delay 2 -fsS \
  "http://$FRONTEND_BIND_IP/api/health/ready" || true)"
if [[ -z "$READY_JSON" ]] || ! python3 - "$READY_JSON" <<'PYREADY'
import json, sys
data = json.loads(sys.argv[1])
sql_ok = data.get("sqlite", {}).get("ok") is True
mqtt = data.get("mqtt", {})
mqtt_ok = (
    mqtt.get("state") == "standby"
    if mqtt.get("enabled") is False
    else (
        mqtt.get("connected") is True
        and mqtt.get("subscriptions_ready") is not False
        and mqtt.get("state") == "connected"
    )
)
if data.get("ok") is not True or data.get("status") != "ready" or not sql_ok or not mqtt_ok:
    raise SystemExit(1)
PYREADY
then
  docker compose logs --tail=150 frontend_dashboard backend mqtt-service >&2 || true
  die "Reverse-proxied readiness check failed at http://$FRONTEND_BIND_IP/api/health/ready. Database backup remains at $BACKUP_PATH."
fi

for service in mqtt-service backend frontend_dashboard; do
  if ! docker compose ps --status running --services | grep -Fxq "$service"; then
    docker compose logs --tail=120 "$service" >&2 || true
    die "Required service '$service' is not running. Database backup remains at $BACKUP_PATH."
  fi
done

UPDATE_SUCCEEDED=1
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
printf -- '- Automatic database overwrite was not used; pre-update backup is preserved at %s.\n' "$BACKUP_PATH"
printf -- '- If a post-merge deployment check fails, update.sh automatically restores the previous dist/ bundle, rewinds the clean checkout to %s, and redeploys the previous containers while keeping the database backup intact.\n' "$CURRENT_SHORT"
