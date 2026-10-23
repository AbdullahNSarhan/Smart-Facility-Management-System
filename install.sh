#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPO_URL="https://github.com/AbdullahNSarhan/Smart-Facility-Management-System.git"
INSTALL_DIR="/opt/lci-sfm"
BRANCH="${LCI_BRANCH:-main}"
FIRST_INSTALL=0
INITIAL_ADMIN_PASSWORD=""

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[LCI-SFM] %s\n' "$*"; }
warn() { printf '[LCI-SFM] WARNING: %s\n' "$*" >&2; }

# Supports: curl -fsSL <raw-install-url> | sudo bash
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || true)"
if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" && $EUID -ne 0 ]]; then
  die "Run this installer with sudo, e.g. curl .../install.sh | sudo bash"
fi

if [[ ! -f "${SCRIPT_DIR:-/nonexistent}/docker-compose.yml" ]]; then
  log "Bootstrap mode: preparing repository at $INSTALL_DIR"
  command -v git >/dev/null 2>&1 || { apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates curl; }
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain)" ]]; then
      die "$INSTALL_DIR has local changes. Review them before running the remote installer; no files were overwritten."
    fi
    git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    git -C "$INSTALL_DIR" merge --ff-only "origin/$BRANCH"
  elif [[ -e "$INSTALL_DIR" ]]; then
    die "$INSTALL_DIR exists but is not a Git repository. Move it aside or inspect it manually; refusing to overwrite it."
  else
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
  exec "$INSTALL_DIR/install.sh" --local
fi

PROJECT_DIR="$SCRIPT_DIR"
cd "$PROJECT_DIR"

log "Installing required host tools (Docker is installed only if missing)"
if [[ "${LCI_SKIP_APT:-0}" != "1" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git openssl python3 util-linux

  if ! command -v docker >/dev/null 2>&1; then
    apt-get install -y docker.io docker-compose-v2
  fi
  systemctl enable --now docker
fi

# Acquire shared deployment lock so install.sh and update.sh never race concurrently.
LOCK_DIR="/var/lock"
[[ -d "$LOCK_DIR" ]] || LOCK_DIR="/run/lock"
[[ -d "$LOCK_DIR" ]] || LOCK_DIR="/tmp"
DEPLOY_LOCK_FILE="${LCI_DEPLOY_LOCK_FILE:-$LOCK_DIR/lci-sfm-deploy.lock}"
exec 9>"$DEPLOY_LOCK_FILE"
flock -n 9 || die "Another LCI-SFM install or update operation is already running (lock: $DEPLOY_LOCK_FILE)."

docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is missing. Install docker-compose-v2 and rerun."
docker info >/dev/null 2>&1 || die "Docker daemon is not responding."

validate_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local IFS='.'
  read -r o1 o2 o3 o4 <<< "$ip"
  for octet in "$o1" "$o2" "$o3" "$o4"; do
    (( 10#$octet >= 0 && 10#$octet <= 255 )) || return 1
  done
  return 0
}

# Choose the IPv4 address used for LAN web access; allow explicit override.
SERVER_IP="${LCI_SERVER_IP:-}"
if [[ -z "$SERVER_IP" ]]; then
  SERVER_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
fi
[[ -n "$SERVER_IP" ]] || die "Could not detect the server IPv4 address. Rerun with LCI_SERVER_IP=your.lan.ip."
validate_ipv4 "$SERVER_IP" || die "Invalid IPv4 address: $SERVER_IP"
log "Detected server IPv4: $SERVER_IP"

# Keep existing .env and credentials untouched on reruns.
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || die ".env.example is missing."
  cp .env.example .env
  chmod 600 .env
  ADMIN_PASSWORD="$(openssl rand -hex 24)"
  MQTT_PASSWORD="$(openssl rand -hex 24)"
  INITIAL_ADMIN_PASSWORD="$ADMIN_PASSWORD"
  FIRST_INSTALL=1
  export SERVER_IP ADMIN_PASSWORD MQTT_PASSWORD
  python3 - <<'PY'
import os
from pathlib import Path
p = Path(".env")
text = p.read_text()
values = {
    "LCI_BOOTSTRAP_ADMIN_USERNAME": "sfm_admin",
    "LCI_BOOTSTRAP_ADMIN_PASSWORD": os.environ["ADMIN_PASSWORD"],
    "MQTT_USERNAME": "lci_backend",
    "MQTT_PASSWORD": os.environ["MQTT_PASSWORD"],
    "FRONTEND_BIND_IP": os.environ["SERVER_IP"],
    # Keep MQTT loopback-only until LAN device access is deliberately configured.
    "MQTT_BIND_IP": "127.0.0.1",
    "ALLOWED_ORIGINS": "http://" + os.environ["SERVER_IP"],
    "SESSION_SECURE_COOKIE": "false",
    "ALLOW_BEARER_COMPAT": "false",
    "NODE_ENV": "production",
}
lines = text.splitlines()
seen = set()
out = []
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key = line.split("=", 1)[0]
        if key in values:
            out.append(f"{key}={values[key]}")
            seen.add(key)
            continue
    out.append(line)
for key, value in values.items():
    if key not in seen:
        out.append(f"{key}={value}")
p.write_text("\n".join(out) + "\n")
p.chmod(0o600)
PY
  CREDENTIALS_FILE="$PROJECT_DIR/DEPLOYMENT-CREDENTIALS.txt"
  cat > "$CREDENTIALS_FILE" <<EOF
LCI-SFM initial deployment credentials
Server URL: http://$SERVER_IP
Admin username: sfm_admin
Admin password: $ADMIN_PASSWORD
MQTT backend username: lci_backend
MQTT backend password: $MQTT_PASSWORD

Keep this file private. It is generated locally and must never be uploaded to GitHub.
Change the initial admin password after first login.
EOF
  chmod 600 "$CREDENTIALS_FILE"
  unset ADMIN_PASSWORD MQTT_PASSWORD
  log "Created protected .env and DEPLOYMENT-CREDENTIALS.txt"
else
  chmod 600 .env
  log "Existing .env detected; preserved it without overwriting secrets."
  # Repair example-only defaults without replacing deliberate user choices.
  if grep -q '^FRONTEND_BIND_IP=127\.0\.0\.1$' .env; then
    sed -i "s/^FRONTEND_BIND_IP=127\.0\.0\.1$/FRONTEND_BIND_IP=$SERVER_IP/" .env
    log "Changed FRONTEND_BIND_IP from loopback to the detected LAN IP."
  fi
  if grep -q '^ALLOWED_ORIGINS=.*192\.168\.43\.225' .env; then
    sed -i "s|^ALLOWED_ORIGINS=.*$|ALLOWED_ORIGINS=http://$SERVER_IP|" .env
    log "Updated the example ALLOWED_ORIGINS value."
  fi
fi

# Keep host-specific secrets out of Git without modifying tracked repository files.
if [[ -d .git ]]; then
  mkdir -p .git/info
  EXCLUDE_FILE=".git/info/exclude"
  touch "$EXCLUDE_FILE"
  for entry in "/.env" "/DEPLOYMENT-CREDENTIALS.txt" "/mosquitto/passwd" "/mosquitto/device-credentials.txt" "/backups/"; do
    grep -Fxq "$entry" "$EXCLUDE_FILE" || printf '%s\n' "$entry" >> "$EXCLUDE_FILE"
  done
fi
chmod 600 .env

# Set Mosquitto bind-mounted secret/ACL files to the broker's UID and restrictive
# permissions. The tracked ACL's executable bit is not changed, so Git stays clean.
[[ -f mosquitto/acl ]] || die "mosquitto/acl is missing."
[[ -f mosquitto/mosquitto.conf ]] || die "mosquitto/mosquitto.conf is missing."
if [[ ! -s mosquitto/passwd ]]; then
  log "Generating unique MQTT credentials for backend and edge identities."
  MQTT_BACKEND_PASSWORD="$(sed -n 's/^MQTT_PASSWORD=//p' .env | head -n1)"
  [[ -n "$MQTT_BACKEND_PASSWORD" && "$MQTT_BACKEND_PASSWORD" != *REPLACE* && "$MQTT_BACKEND_PASSWORD" != *replace_with* ]] || die "MQTT_PASSWORD in .env is missing or still a placeholder. Set a strong password and rerun."
  NODE1_PASSWORD="$(openssl rand -hex 24)"
  NODE2_PASSWORD="$(openssl rand -hex 24)"
  VISION_PASSWORD="$(openssl rand -hex 24)"
  CREDENTIALS_FILE="$PROJECT_DIR/mosquitto/device-credentials.txt"
  cat > "$CREDENTIALS_FILE" <<EOF
LCI-SFM MQTT credentials — keep private
lci_backend=$MQTT_BACKEND_PASSWORD
node1_access=$NODE1_PASSWORD
node2_env=$NODE2_PASSWORD
vision_service=$VISION_PASSWORD

These are unique broker credentials. Provision the matching values on each device/service.
Do not commit or share this file publicly.
EOF
  chmod 600 "$CREDENTIALS_FILE"
  docker pull eclipse-mosquitto:2.0
  docker run --rm --user 0:0 --entrypoint sh -v "$PROJECT_DIR/mosquitto:/mosquitto/config" \
    eclipse-mosquitto:2.0 -ec '
      mosquitto_passwd -c -b /mosquitto/config/passwd lci_backend "$1"
      mosquitto_passwd -b /mosquitto/config/passwd node1_access "$2"
      mosquitto_passwd -b /mosquitto/config/passwd node2_env "$3"
      mosquitto_passwd -b /mosquitto/config/passwd vision_service "$4"
    ' sh "$MQTT_BACKEND_PASSWORD" "$NODE1_PASSWORD" "$NODE2_PASSWORD" "$VISION_PASSWORD"
  unset MQTT_BACKEND_PASSWORD NODE1_PASSWORD NODE2_PASSWORD VISION_PASSWORD
else
  log "Existing Mosquitto password file detected; preserving its credentials."
fi

# Mosquitto runs as UID/GID 1883. The files are bind-mounted read-only by Compose.
if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" ]]; then
  chown 1883:1883 mosquitto/passwd mosquitto/acl
fi
chmod 600 mosquitto/passwd mosquitto/acl

# Build a dedicated validator with the host binaries required by integration tests.
# The plain node:24-alpine image lacks git (and may lack bash/flock), causing
# spawnSync git ENOENT before Compose services are ever started.
[[ -f deployment/validation.Dockerfile ]] || die "Deployment validation Dockerfile is missing."
log "Preparing Node.js 24 validation image (git, bash, flock)"
docker build -t lci-sfm-validator:node24 -f "$PROJECT_DIR/deployment/validation.Dockerfile" "$PROJECT_DIR/deployment" \
  || die "Could not build the Node.js validation image."

log "Building frontend and running lint/tests inside the deployment validation container"
docker run --rm -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
  -v "$PROJECT_DIR:/workspace" -w /workspace lci-sfm-validator:node24 sh -lc \
  'npm ci --no-audit --no-fund && npm run lint && npm test && npm run build' \
  || die "Frontend dependency installation, lint, tests or build failed; Compose services have not been started."

[[ -s dist/index.html ]] || die "Frontend build did not create dist/index.html."
chmod 755 "$PROJECT_DIR/dist"
find "$PROJECT_DIR/dist" -type d -exec chmod 755 {} +
find "$PROJECT_DIR/dist" -type f -exec chmod 644 {} +
[[ -f nginx/nginx.conf ]] || die "nginx/nginx.conf is missing."
docker compose config -q

log "Starting the stack (MQTT broker, backend, then frontend)"
docker compose up -d mqtt-service || { docker compose ps >&2 || true; docker compose logs --tail=100 mqtt-service >&2 || true; die "MQTT container failed to start."; }
sleep "${LCI_STARTUP_GRACE_SEC:-3}"
if ! docker compose ps --status running --services | grep -Fxq mqtt-service; then
  docker compose logs --tail=80 mqtt-service
  die "Mosquitto did not remain running. Review the logs above."
fi

docker compose up -d --build backend || { docker compose ps >&2 || true; docker compose logs --tail=100 backend mqtt-service >&2 || true; die "Backend container build or start failed."; }
sleep "${LCI_STARTUP_GRACE_SEC:-3}"
if ! docker compose ps --status running --services | grep -Fxq backend; then
  docker compose logs --tail=100 backend
  die "Backend did not remain running. Review the logs above."
fi

docker compose up -d --build frontend_dashboard || { docker compose ps >&2 || true; docker compose logs --tail=100 frontend_dashboard backend mqtt-service >&2 || true; die "Nginx frontend container failed to start."; }
docker compose ps

log "Checking backend liveness (/api/health/live) inside its container"
if ! docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/live', { signal: AbortSignal.timeout(5000) }).then(async r => { if (!r.ok) process.exit(1); const d = await r.json(); process.exit(d && d.ok === true && d.status === 'live' ? 0 : 1); }).catch(() => process.exit(1))"; then
  printf '\nBackend liveness check failed. Recent logs:\n' >&2
  docker compose logs --tail=100 backend >&2
  die "Backend liveness check failed. Fix the reported issue and rerun install.sh or update.sh."
fi

READINESS_TIMEOUT_SEC="${LCI_READINESS_TIMEOUT_SEC:-60}"
READINESS_POLL_SEC="${LCI_READINESS_POLL_SEC:-3}"
log "Waiting up to ${READINESS_TIMEOUT_SEC} seconds for backend operational readiness (/api/health/ready: SQLite + MQTT)"
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
  docker compose logs --tail=120 backend mqtt-service >&2 || true
  die "Backend operational readiness check (/api/health/ready) failed. Verify SQLite and Mosquitto MQTT credentials/logs and rerun."
fi

FRONTEND_BIND_IP="$(sed -n 's/^FRONTEND_BIND_IP=//p' .env | tail -n1)"
FRONTEND_BIND_IP="${FRONTEND_BIND_IP:-127.0.0.1}"
log "Checking frontend and reverse-proxied readiness through http://$FRONTEND_BIND_IP/"
if ! curl --connect-timeout 3 --max-time 10 -fsS "http://$FRONTEND_BIND_IP/" -o /dev/null; then
  docker compose logs --tail=100 frontend_dashboard >&2
  die "Frontend HTTP check failed at http://$FRONTEND_BIND_IP/."
fi
READY_JSON="$(curl --connect-timeout 3 --max-time 10 -fsS "http://$FRONTEND_BIND_IP/api/health/ready" || true)"
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
  docker compose logs --tail=100 frontend_dashboard backend mqtt-service >&2
  die "Reverse-proxied readiness check failed at http://$FRONTEND_BIND_IP/api/health/ready."
fi

for service in mqtt-service backend frontend_dashboard; do
  if ! docker compose ps --status running --services | grep -Fxq "$service"; then
    docker compose logs --tail=80 "$service" >&2
    die "Required service '$service' is not running."
  fi
done

cat <<EOF

============================================================
LCI-SFM installation finished successfully
============================================================
Dashboard URL : http://$FRONTEND_BIND_IP/
Admin username: sfm_admin
Project path  : $PROJECT_DIR
Credentials   : $PROJECT_DIR/DEPLOYMENT-CREDENTIALS.txt (mode 600)
Update command: sudo $PROJECT_DIR/update.sh

Service status:
EOF
docker compose ps

if [[ $FIRST_INSTALL -eq 1 && -n "$INITIAL_ADMIN_PASSWORD" ]]; then
  printf '\nIMPORTANT — initial administrator password (shown only on first install):\n'
  printf 'Admin password: %s\n' "$INITIAL_ADMIN_PASSWORD"
  printf 'Change it after your first login. The protected credentials file remains available locally.\n'
else
  printf '\nExisting installation detected: no password was generated or printed.\n'
  printf 'If you need the original credentials, inspect the root-protected credentials file locally.\n'
fi
unset INITIAL_ADMIN_PASSWORD

printf '\nMQTT bind setting: %s\n' "$(sed -n 's/^MQTT_BIND_IP=//p' .env | tail -n1)"
printf 'MQTT is not exposed to the LAN unless MQTT_BIND_IP is explicitly configured for it.\n'
printf 'Review docs/DEPLOYMENT_GUIDE.md before connecting physical hardware.\n\n'
