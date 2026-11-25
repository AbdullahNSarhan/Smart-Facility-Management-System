#!/usr/bin/env bash
# ==============================================================================
# LCI-SFM Air-Gapped Offline Updater with Automatic SQLite Backup & Rollback
# Usage:
#   sudo ./update-offline.sh /path/to/lci-sfm-2.0.0-rc.1-offline.tar.gz [--verify-pubkey /path/to/pub.pem]
# ==============================================================================
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"

BUNDLE_ARCHIVE="${1:-}"
PUB_KEY=""
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-pubkey) PUB_KEY="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[LCI-SFM OFFLINE UPDATE] %s\n' "$*"; }

[[ -n "$BUNDLE_ARCHIVE" && -f "$BUNDLE_ARCHIVE" ]] || die "Usage: $0 <path-to-offline-bundle.tar.gz> [--verify-pubkey pub.pem]"
if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" && $EUID -ne 0 ]]; then
  die "Run update-offline.sh with sudo."
fi

LOCK_DIR="/var/lock"
[[ -d "$LOCK_DIR" ]] || LOCK_DIR="/tmp"
exec 9>"${LCI_DEPLOY_LOCK_FILE:-$LOCK_DIR/lci-sfm-deploy.lock}"
flock -n 9 || die "Another install or update operation is already running."

STAGE="$(mktemp -d)"
ROLLBACK_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE" "$ROLLBACK_DIR"' EXIT

log "Extracting and verifying offline release bundle..."
tar -C "$STAGE" -xzf "$BUNDLE_ARCHIVE"
BUNDLE_DIR="$(find "$STAGE" -mindepth 1 -maxdepth 1 -type d | head -n1)"
[[ -n "$BUNDLE_DIR" && -f "$BUNDLE_DIR/SHA256SUMS" ]] || die "Invalid offline bundle archive."

(
  cd "$BUNDLE_DIR"
  if [[ -n "$PUB_KEY" ]]; then
    openssl dgst -sha256 -verify "$PUB_KEY" -signature SHA256SUMS.sig SHA256SUMS || die "Signature verification failed."
  fi
  sha256sum -c SHA256SUMS >/dev/null || die "SHA256SUMS checksum verification failed."
)

# 1. Hot SQLite backup before touching running release
mkdir -p "$SCRIPT_DIR/backups"
BACKUP_FILE="$SCRIPT_DIR/backups/pre-offline-update-$(date -u +%Y%m%dT%H%M%SZ).db"
if docker compose ps --status running --services 2>/dev/null | grep -Fxq backend; then
  log "Creating hot SQLite backup at $BACKUP_FILE"
  docker compose exec -T backend node /app/backend/src/db/backup.js backup /tmp/pre-update.db
  docker cp lci_backend:/tmp/pre-update.db "$BACKUP_FILE"
  docker compose exec -T backend rm -f /tmp/pre-update.db || true
  chmod 600 "$BACKUP_FILE"
fi

# 2. Save rollback snapshot of current dist/ and compose configs
[[ -d "$SCRIPT_DIR/dist" ]] && cp -a "$SCRIPT_DIR/dist" "$ROLLBACK_DIR/dist"
cp -a docker-compose.yml nginx/nginx.conf "$ROLLBACK_DIR/" 2>/dev/null || true

rollback() {
  log "Readiness check failed — rolling back dist/ and compose configuration..."
  if [[ -d "$ROLLBACK_DIR/dist" ]]; then
    rm -rf "$SCRIPT_DIR/dist"
    cp -a "$ROLLBACK_DIR/dist" "$SCRIPT_DIR/dist"
  fi
  [[ -f "$ROLLBACK_DIR/docker-compose.yml" ]] && cp -a "$ROLLBACK_DIR/docker-compose.yml" "$SCRIPT_DIR/docker-compose.yml"
  [[ -f "$ROLLBACK_DIR/nginx.conf" ]] && cp -a "$ROLLBACK_DIR/nginx.conf" "$SCRIPT_DIR/nginx/nginx.conf"
  docker compose up -d --no-build mqtt-service backend frontend_dashboard || true
  die "Offline update rolled back. SQLite backup preserved at $BACKUP_FILE."
}

# 3. Load offline OCI images (zero internet calls)
shopt -s nullglob
for img in "$BUNDLE_DIR"/images/*.tar.gz; do
  log "Loading offline OCI image: $(basename "$img")"
  gunzip -c "$img" | docker load
done
shopt -u nullglob

# 4. Atomic replacement of dist/ and runtime configs (preserves .env, mosquitto/passwd, volumes)
rm -rf "$SCRIPT_DIR/dist"
cp -a "$BUNDLE_DIR/dist" "$SCRIPT_DIR/dist"
cp -a "$BUNDLE_DIR/docker-compose.yml" "$SCRIPT_DIR/docker-compose.yml"
cp -a "$BUNDLE_DIR/nginx/nginx.conf" "$SCRIPT_DIR/nginx/nginx.conf"

log "Starting updated offline services..."
docker compose up -d --no-build mqtt-service backend frontend_dashboard || rollback

READY=0
for _ in $(seq 1 20); do
  if docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/ready',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(r.status!==200)process.exit(1);const d=await r.json();process.exit(d?.ok&&d?.status==='ready'?0:1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 3
done
[[ "$READY" -eq 1 ]] || rollback

log "Offline update completed successfully! Pre-update SQLite backup: $BACKUP_FILE"
