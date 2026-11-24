#!/usr/bin/env bash
# ==============================================================================
# LCI-SFM Air-Gapped Offline Installer (Zero External Network Calls)
# Runs inside an extracted offline release bundle created by build-offline-bundle.sh.
# Verifies SHA256SUMS (and optional public key signature), loads bundled OCI Docker
# images, preserves existing .env/volumes, and verifies /api/health/live + /ready.
# ==============================================================================
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"

PUB_KEY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-pubkey) PUB_KEY="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) shift ;;
  esac
done

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[LCI-SFM OFFLINE INSTALL] %s\n' "$*"; }

if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" && $EUID -ne 0 ]]; then
  die "Run install-offline.sh with sudo."
fi

[[ -f SHA256SUMS ]] || die "SHA256SUMS missing; refusing unverified offline bundle."
if [[ -n "$PUB_KEY" ]]; then
  [[ -f SHA256SUMS.sig ]] || die "SHA256SUMS.sig missing while --verify-pubkey was requested."
  openssl dgst -sha256 -verify "$PUB_KEY" -signature SHA256SUMS.sig SHA256SUMS \
    || die "OpenSSL signature verification FAILED."
  log "OpenSSL bundle signature verified."
fi

log "Verifying SHA-256 checksums for all bundle files..."
sha256sum -c SHA256SUMS >/dev/null || die "SHA256SUMS verification FAILED. Bundle may be corrupted or tampered."

command -v docker >/dev/null 2>&1 || die "Docker must be pre-installed on the air-gapped host."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin must be pre-installed."

# Load bundled OCI images locally (ZERO docker pull calls)
shopt -s nullglob
for img in images/*.tar.gz; do
  log "Loading offline OCI image: $(basename "$img")"
  gunzip -c "$img" | docker load
done
shopt -u nullglob

# Discover local LAN IP without external probes
SERVER_IP="${LCI_SERVER_IP:-}"
if [[ -z "$SERVER_IP" ]]; then
  SERVER_IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(lo|docker|br-|veth)/ {split($4,a,"/"); print a[1]; exit}' || true)"
fi
SERVER_IP="${SERVER_IP:-127.0.0.1}"

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  ADMIN_PW="$(openssl rand -hex 24)"
  MQTT_PW="$(openssl rand -hex 24)"
  sed -i \
    -e "s|^LCI_BOOTSTRAP_ADMIN_PASSWORD=.*|LCI_BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PW}|" \
    -e "s|^MQTT_PASSWORD=.*|MQTT_PASSWORD=${MQTT_PW}|" \
    -e "s|^FRONTEND_BIND_IP=.*|FRONTEND_BIND_IP=${SERVER_IP}|" \
    -e "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=http://${SERVER_IP}|" \
    .env
  cat > DEPLOYMENT-CREDENTIALS.txt <<EOF
LCI-SFM Offline Installation Credentials
URL: http://${SERVER_IP}/
Admin Username: sfm_admin
Admin Password: ${ADMIN_PW}
MQTT Backend Password: ${MQTT_PW}
EOF
  chmod 600 DEPLOYMENT-CREDENTIALS.txt
  unset ADMIN_PW MQTT_PW
  log "Generated .env and DEPLOYMENT-CREDENTIALS.txt (mode 600)."
else
  log "Existing .env detected; preserving credentials."
fi

if [[ ! -s mosquitto/passwd ]]; then
  MQTT_PW="$(sed -n 's/^MQTT_PASSWORD=//p' .env | head -n1)"
  docker run --rm --user 0:0 --entrypoint sh -v "$SCRIPT_DIR/mosquitto:/mosquitto/config" \
    eclipse-mosquitto:2.0 -ec 'mosquitto_passwd -c -b /mosquitto/config/passwd lci_backend "$1"' sh "$MQTT_PW"
  unset MQTT_PW
fi
if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" ]]; then
  chown 1883:1883 mosquitto/passwd mosquitto/acl
fi
chmod 600 mosquitto/passwd mosquitto/acl

log "Starting air-gapped containers (no image pull)..."
docker compose up -d --no-build mqtt-service backend frontend_dashboard

log "Checking /api/health/live and /api/health/ready..."
docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/live',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  || die "Offline backend liveness check failed."

READY=0
for _ in $(seq 1 20); do
  if docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/ready',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(r.status!==200)process.exit(1);const d=await r.json();process.exit(d?.ok&&d?.status==='ready'?0:1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 3
done
[[ "$READY" -eq 1 ]] || die "Offline backend readiness check timed out."

log "Air-gapped offline installation complete. Dashboard: http://${SERVER_IP}/"
