#!/usr/bin/env bash
# ==============================================================================
# LCI-SFM 2.0 Guided Deployment Assistant & Idempotent Installer
# Supports:
#   sudo ./install.sh --discover-only     (Read-only host, NIC, port & service audit)
#   sudo ./install.sh                     (Interactive guided assistant when TTY available)
#   sudo ./install.sh --non-interactive   (Automated / CI / env-driven installation)
# ==============================================================================
set -Eeuo pipefail
umask 077

REPO_URL="https://github.com/AbdullahNSarhan/Smart-Facility-Management-System.git"
INSTALL_DIR="/opt/lci-sfm"
BRANCH="${LCI_BRANCH:-main}"
FIRST_INSTALL=0
INITIAL_ADMIN_PASSWORD=""
DISCOVER_ONLY=0
NON_INTERACTIVE=0
ENABLE_TLS="${LCI_TLS_ENABLED:-false}"
FRONTEND_PORT_CHOICE="${LCI_FRONTEND_PORT:-80}"
MQTT_PORT_CHOICE="${LCI_MQTT_PORT:-1883}"
MQTT_BIND_CHOICE="${LCI_MQTT_BIND_IP:-127.0.0.1}"
ADMIN_USER_CHOICE="${LCI_ADMIN_USERNAME:-sfm_admin}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --discover-only) DISCOVER_ONLY=1; shift ;;
    --non-interactive|--local) NON_INTERACTIVE=1; shift ;;
    --tls) ENABLE_TLS="true"; shift ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *) shift ;;
  esac
done

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[LCI-SFM] %s\n' "$*"; }
warn() { printf '[LCI-SFM] WARNING: %s\n' "$*" >&2; }

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

validate_port() {
  local p="$1"
  [[ "$p" =~ ^[0-9]{1,5}$ ]] && (( 10#$p >= 1 && 10#$p <= 65535 ))
}

discover_lan_ips() {
  # Air-gap safe discovery: enumerates ALL non-loopback, non-container IPv4 addresses
  # without requiring internet reachability (unlike `ip route get 1.1.1.1`).
  local found=()
  if command -v ip >/dev/null 2>&1; then
    while IFS= read -r line; do
      local dev addr ip_only
      dev="$(awk '{print $2}' <<< "$line")"
      addr="$(awk '{print $4}' <<< "$line")"
      ip_only="${addr%%/*}"
      [[ "$dev" == "lo" || "$dev" == docker* || "$dev" == br-* || "$dev" == veth* ]] && continue
      validate_ipv4 "$ip_only" && found+=("${dev}:${ip_only}")
    done < <(ip -4 -o addr show scope global 2>/dev/null || true)
  fi
  printf '%s\n' "${found[@]}"
}

run_host_discovery() {
  printf '============================================================\n'
  printf 'LCI-SFM Read-Only Host & Network Discovery Report\n'
  printf '============================================================\n'
  printf 'OS / Kernel : %s (%s)\n' "$(uname -s -r)" "$(uname -m)"
  if [[ -f /etc/os-release ]]; then
    printf 'Distribution: %s\n' "$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '"')"
  fi
  printf 'CPU Cores   : %s\n' "$(nproc 2>/dev/null || echo unknown)"
  printf 'Memory      : %s\n' "$(free -h 2>/dev/null | awk '/Mem:/ {print $2 " total, " $7 " available"}' || echo unknown)"
  printf 'Disk Free   : %s\n' "$(df -h . 2>/dev/null | awk 'NR==2 {print $4 " available on " $6}' || echo unknown)"
  printf 'Docker      : %s\n' "$(command -v docker >/dev/null 2>&1 && docker --version || echo 'NOT INSTALLED')"
  printf 'Compose v2  : %s\n' "$(docker compose version 2>/dev/null || echo 'NOT INSTALLED')"

  printf '\nNetwork Interfaces (Non-Loopback IPv4):\n'
  local ips
  ips="$(discover_lan_ips || true)"
  if [[ -n "$ips" ]]; then
    while IFS=: read -r nic ipaddr; do
      [[ -z "$nic" ]] && continue
      local state mac
      state="$(cat "/sys/class/net/$nic/operstate" 2>/dev/null || echo unknown)"
      mac="$(cat "/sys/class/net/$nic/address" 2>/dev/null || echo unknown)"
      printf '  - %-12s IPv4=%-16s state=%-8s mac=%s\n' "$nic" "$ipaddr" "$state" "$mac"
    done <<< "$ips"
  else
    printf '  (No non-loopback global IPv4 interfaces detected; loopback 127.0.0.1 fallback)\n'
  fi

  printf '\nListening Port Check (80, 443, 1883):\n'
  if command -v ss >/dev/null 2>&1; then
    for port in 80 443 1883; do
      if ss -tlnH "sport = :$port" 2>/dev/null | grep -q .; then
        printf '  - Port %-4s : IN USE (%s)\n' "$port" "$(ss -tlnpH "sport = :$port" 2>/dev/null | head -n1 | awk '{print $4}')"
      else
        printf '  - Port %-4s : AVAILABLE\n' "$port"
      fi
    done
  else
    printf '  (ss command unavailable)\n'
  fi

  printf '\nConflicting Host Services Check:\n'
  for svc in nginx apache2 mosquitto; do
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$svc" 2>/dev/null; then
      printf '  - %-10s : ACTIVE (may conflict if bound to the same interface/port)\n' "$svc"
    else
      printf '  - %-10s : inactive / not installed\n' "$svc"
    fi
  done
  printf '============================================================\n'
}

if [[ "$DISCOVER_ONLY" -eq 1 ]]; then
  run_host_discovery
  exit 0
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || true)"
if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" && $EUID -ne 0 ]]; then
  die "Run this installer with sudo (or use --discover-only for read-only inspection)."
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
  exec "$INSTALL_DIR/install.sh" --non-interactive
fi

PROJECT_DIR="$SCRIPT_DIR"
cd "$PROJECT_DIR"

# Run discovery report first
run_host_discovery

# Detect candidate server IPv4 cleanly (works offline/air-gapped without 1.1.1.1)
SERVER_IP="${LCI_SERVER_IP:-}"
if [[ -z "$SERVER_IP" ]]; then
  FIRST_NIC_IP="$(discover_lan_ips | head -n1 | cut -d: -f2 || true)"
  if [[ -n "$FIRST_NIC_IP" ]]; then
    SERVER_IP="$FIRST_NIC_IP"
  else
    SERVER_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
  fi
fi
SERVER_IP="${SERVER_IP:-127.0.0.1}"

# Interactive Guided Assistant (Q1–Q12 condensed confirmation flow when interactive TTY)
if [[ "$NON_INTERACTIVE" -eq 0 && -t 0 && -t 1 && ! -f .env ]]; then
  log "Interactive Deployment Assistant (press Enter to accept defaults)"
  read -r -p "Q1. Dashboard Bind IPv4 [$SERVER_IP]: " ans
  [[ -n "${ans:-}" ]] && SERVER_IP="$ans"
  read -r -p "Q2. Dashboard HTTP Port [$FRONTEND_PORT_CHOICE]: " ans
  [[ -n "${ans:-}" ]] && FRONTEND_PORT_CHOICE="$ans"
  read -r -p "Q3. Enable Local LAN HTTPS/TLS (true/false) [$ENABLE_TLS]: " ans
  [[ -n "${ans:-}" ]] && ENABLE_TLS="$ans"
  read -r -p "Q4. Expose MQTT broker on LAN IP ($SERVER_IP) instead of loopback 127.0.0.1? (y/N): " ans
  if [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]; then
    MQTT_BIND_CHOICE="$SERVER_IP"
  fi
  read -r -p "Q5. MQTT Broker Port [$MQTT_PORT_CHOICE]: " ans
  [[ -n "${ans:-}" ]] && MQTT_PORT_CHOICE="$ans"
  read -r -p "Q6. Initial Administrator Username [$ADMIN_USER_CHOICE]: " ans
  [[ -n "${ans:-}" ]] && ADMIN_USER_CHOICE="$ans"

  printf '\n--- Deployment Plan Summary ---\n'
  printf '  Dashboard Bind : %s:%s (TLS=%s)\n' "$SERVER_IP" "$FRONTEND_PORT_CHOICE" "$ENABLE_TLS"
  printf '  MQTT Bind      : %s:%s\n' "$MQTT_BIND_CHOICE" "$MQTT_PORT_CHOICE"
  printf '  Admin Username : %s (strong random password will be generated)\n' "$ADMIN_USER_CHOICE"
  printf '-------------------------------\n'
  read -r -p "Proceed with installation? (Y/n): " confirm
  if [[ "${confirm,,}" == "n" || "${confirm,,}" == "no" ]]; then
    die "Installation cancelled by operator before making changes."
  fi
fi

validate_ipv4 "$SERVER_IP" || die "Invalid IPv4 address for FRONTEND_BIND_IP: $SERVER_IP"
validate_ipv4 "$MQTT_BIND_CHOICE" || die "Invalid IPv4 address for MQTT_BIND_IP: $MQTT_BIND_CHOICE"
validate_port "$FRONTEND_PORT_CHOICE" || die "Invalid FRONTEND_PORT: $FRONTEND_PORT_CHOICE"
validate_port "$MQTT_PORT_CHOICE" || die "Invalid MQTT_PORT: $MQTT_PORT_CHOICE"

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

LOCK_DIR="/var/lock"
[[ -d "$LOCK_DIR" ]] || LOCK_DIR="/run/lock"
[[ -d "$LOCK_DIR" ]] || LOCK_DIR="/tmp"
DEPLOY_LOCK_FILE="${LCI_DEPLOY_LOCK_FILE:-$LOCK_DIR/lci-sfm-deploy.lock}"
exec 9>"$DEPLOY_LOCK_FILE"
flock -n 9 || die "Another LCI-SFM install or update operation is already running (lock: $DEPLOY_LOCK_FILE)."

docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is missing. Install docker-compose-v2 and rerun."
docker info >/dev/null 2>&1 || die "Docker daemon is not responding."

log "Selected bind IPv4: $SERVER_IP (port $FRONTEND_PORT_CHOICE)"

# Keep existing .env and credentials untouched on reruns.
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || die ".env.example is missing."
  cp .env.example .env
  chmod 600 .env
  ADMIN_PASSWORD="$(openssl rand -hex 24)"
  MQTT_PASSWORD="$(openssl rand -hex 24)"
  INITIAL_ADMIN_PASSWORD="$ADMIN_PASSWORD"
  FIRST_INSTALL=1
  SCHEME="http"
  SECURE_COOKIE="false"
  if [[ "$ENABLE_TLS" == "true" ]]; then
    SCHEME="https"
    SECURE_COOKIE="true"
  fi
  ORIGIN_PORT_SUFFIX=""
  if [[ "$SCHEME" == "http" && "$FRONTEND_PORT_CHOICE" != "80" ]]; then
    ORIGIN_PORT_SUFFIX=":$FRONTEND_PORT_CHOICE"
  fi
  ALLOWED_ORIGIN_VAL="${SCHEME}://${SERVER_IP}${ORIGIN_PORT_SUFFIX}"
  export SERVER_IP ADMIN_PASSWORD MQTT_PASSWORD ADMIN_USER_CHOICE FRONTEND_PORT_CHOICE MQTT_BIND_CHOICE MQTT_PORT_CHOICE ENABLE_TLS SECURE_COOKIE ALLOWED_ORIGIN_VAL
  python3 - <<'PY'
import os
from pathlib import Path
p = Path(".env")
text = p.read_text()
values = {
    "LCI_BOOTSTRAP_ADMIN_USERNAME": os.environ["ADMIN_USER_CHOICE"],
    "LCI_BOOTSTRAP_ADMIN_PASSWORD": os.environ["ADMIN_PASSWORD"],
    "MQTT_USERNAME": "lci_backend",
    "MQTT_PASSWORD": os.environ["MQTT_PASSWORD"],
    "FRONTEND_BIND_IP": os.environ["SERVER_IP"],
    "FRONTEND_PORT": os.environ["FRONTEND_PORT_CHOICE"],
    "TLS_ENABLED": os.environ["ENABLE_TLS"],
    "MQTT_BIND_IP": os.environ["MQTT_BIND_CHOICE"],
    "MQTT_PORT": os.environ["MQTT_PORT_CHOICE"],
    "ALLOWED_ORIGINS": os.environ["ALLOWED_ORIGIN_VAL"],
    "SESSION_SECURE_COOKIE": os.environ["SECURE_COOKIE"],
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
Server URL: ${ALLOWED_ORIGIN_VAL}
Admin username: ${ADMIN_USER_CHOICE}
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
  if grep -q '^FRONTEND_BIND_IP=127\.0\.0\.1$' .env && [[ "$SERVER_IP" != "127.0.0.1" ]]; then
    sed -i "s/^FRONTEND_BIND_IP=127\.0\.0\.1$/FRONTEND_BIND_IP=$SERVER_IP/" .env
    log "Changed FRONTEND_BIND_IP from loopback to the detected LAN IP."
  fi
fi

# Optionally generate local TLS certificates when TLS_ENABLED=true
TLS_ACTIVE="$(sed -n 's/^TLS_ENABLED=//p' .env | tail -n1)"
COMPOSE_FILES=(-f docker-compose.yml)
if [[ "$TLS_ACTIVE" == "true" ]]; then
  if [[ ! -f nginx/certs/server.crt || ! -f nginx/certs/server.key ]]; then
    bash "$PROJECT_DIR/scripts/setup-local-tls.sh" "$SERVER_IP" "lci-sfm.local"
  fi
  COMPOSE_FILES+=(-f docker-compose.tls.yml)
fi

if [[ -d .git ]]; then
  mkdir -p .git/info
  EXCLUDE_FILE=".git/info/exclude"
  touch "$EXCLUDE_FILE"
  for entry in "/.env" "/DEPLOYMENT-CREDENTIALS.txt" "/mosquitto/passwd" "/mosquitto/device-credentials.txt" "/nginx/certs/" "/backups/" "/dist-release/"; do
    grep -Fxq "$entry" "$EXCLUDE_FILE" || printf '%s\n' "$entry" >> "$EXCLUDE_FILE"
  done
fi
chmod 600 .env

[[ -f mosquitto/acl ]] || die "mosquitto/acl is missing."
[[ -f mosquitto/mosquitto.conf ]] || die "mosquitto/mosquitto.conf is missing."
if [[ ! -s mosquitto/passwd ]]; then
  log "Generating unique MQTT credentials for backend and edge identities."
  MQTT_BACKEND_PASSWORD="$(sed -n 's/^MQTT_PASSWORD=//p' .env | head -n1)"
  [[ -n "$MQTT_BACKEND_PASSWORD" && "$MQTT_BACKEND_PASSWORD" != *REPLACE* && "$MQTT_BACKEND_PASSWORD" != *replace_with* ]] || die "MQTT_PASSWORD in .env is missing or still a placeholder."
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

Provision per-device v1 credentials with:
  sudo ./scripts/provision-mqtt-device.sh add <device_id>
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

if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" ]]; then
  chown 1883:1883 mosquitto/passwd mosquitto/acl
fi
chmod 600 mosquitto/passwd mosquitto/acl

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
docker compose "${COMPOSE_FILES[@]}" config -q

log "Starting the stack (MQTT broker, backend, then frontend)"
docker compose "${COMPOSE_FILES[@]}" up -d mqtt-service || { docker compose logs --tail=100 mqtt-service >&2 || true; die "MQTT container failed to start."; }
sleep "${LCI_STARTUP_GRACE_SEC:-3}"
docker compose "${COMPOSE_FILES[@]}" ps --status running --services | grep -Fxq mqtt-service || die "Mosquitto did not remain running."

docker compose "${COMPOSE_FILES[@]}" up -d --build backend || { docker compose logs --tail=100 backend >&2 || true; die "Backend container failed to start."; }
sleep "${LCI_STARTUP_GRACE_SEC:-3}"
docker compose "${COMPOSE_FILES[@]}" ps --status running --services | grep -Fxq backend || die "Backend did not remain running."

docker compose "${COMPOSE_FILES[@]}" up -d --build frontend_dashboard || { docker compose logs --tail=100 frontend_dashboard >&2 || true; die "Nginx frontend container failed to start."; }
docker compose "${COMPOSE_FILES[@]}" ps

log "Checking backend liveness (/api/health/live)"
docker compose "${COMPOSE_FILES[@]}" exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/live', { signal: AbortSignal.timeout(5000) }).then(async r => { if (!r.ok) process.exit(1); const d = await r.json(); process.exit(d && d.ok === true && d.status === 'live' ? 0 : 1); }).catch(() => process.exit(1))" \
  || die "Backend liveness check failed."

READINESS_TIMEOUT_SEC="${LCI_READINESS_TIMEOUT_SEC:-60}"
READINESS_POLL_SEC="${LCI_READINESS_POLL_SEC:-3}"
log "Waiting up to ${READINESS_TIMEOUT_SEC}s for backend operational readiness (/api/health/ready)"
READY=0
DEADLINE=$((SECONDS + READINESS_TIMEOUT_SEC))
while (( SECONDS < DEADLINE )); do
  if docker compose "${COMPOSE_FILES[@]}" exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health/ready', { signal: AbortSignal.timeout(5000) }).then(async r => { if (r.status !== 200) process.exit(1); const d = await r.json(); const sqlOk = d?.sqlite?.ok === true; const mqttOk = d?.mqtt?.enabled === false ? d?.mqtt?.state === 'standby' : (d?.mqtt?.connected === true && d?.mqtt?.subscriptions_ready !== false && d?.mqtt?.state === 'connected'); process.exit(d?.ok === true && d?.status === 'ready' && sqlOk && mqttOk ? 0 : 1); }).catch(() => process.exit(1))" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep "$READINESS_POLL_SEC"
done
[[ "$READY" -eq 1 ]] || die "Backend operational readiness check (/api/health/ready) timed out."

FRONTEND_BIND_IP="$(sed -n 's/^FRONTEND_BIND_IP=//p' .env | tail -n1)"
FRONTEND_BIND_IP="${FRONTEND_BIND_IP:-127.0.0.1}"
FRONTEND_PORT="$(sed -n 's/^FRONTEND_PORT=//p' .env | tail -n1)"
FRONTEND_PORT="${FRONTEND_PORT:-80}"
DASHBOARD_URL="http://${FRONTEND_BIND_IP}${FRONTEND_PORT:+$([[ "$FRONTEND_PORT" == "80" ]] || echo ":$FRONTEND_PORT")}/"
if [[ "$TLS_ACTIVE" == "true" ]]; then
  DASHBOARD_URL="https://${FRONTEND_BIND_IP}/"
fi

log "Checking reverse-proxied dashboard endpoint ($DASHBOARD_URL)"
if [[ "$TLS_ACTIVE" == "true" ]]; then
  curl --connect-timeout 3 --max-time 10 -kfsS "${DASHBOARD_URL}api/health/ready" >/dev/null || die "Reverse-proxied HTTPS readiness check failed at $DASHBOARD_URL"
else
  curl --connect-timeout 3 --max-time 10 -fsS "$DASHBOARD_URL" -o /dev/null || die "Frontend HTTP check failed at $DASHBOARD_URL"
  curl --connect-timeout 3 --max-time 10 -fsS "${DASHBOARD_URL}api/health/ready" >/dev/null || die "Reverse-proxied HTTP readiness check failed at $DASHBOARD_URL"
fi

cat <<EOF

============================================================
LCI-SFM installation finished successfully
============================================================
Dashboard URL : $DASHBOARD_URL
Project path  : $PROJECT_DIR
Credentials   : $PROJECT_DIR/DEPLOYMENT-CREDENTIALS.txt (mode 600)
Update command: sudo $PROJECT_DIR/update.sh
MQTT CLI      : sudo $PROJECT_DIR/scripts/provision-mqtt-device.sh add <device_id>
============================================================
EOF
if [[ $FIRST_INSTALL -eq 1 && -n "$INITIAL_ADMIN_PASSWORD" ]]; then
  printf 'Initial admin username: %s\n' "$ADMIN_USER_CHOICE"
  printf 'Initial admin password: %s\n' "$INITIAL_ADMIN_PASSWORD"
fi
unset INITIAL_ADMIN_PASSWORD
