#!/usr/bin/env bash
# ==============================================================================
# LCI-SFM Host-Side Allowlisted MQTT Device Identity Provisioning Helper
#
# Security Boundary:
# - The Node.js backend container NEVER receives root privileges, Docker socket
#   access, or write access to mosquitto/passwd.
# - This host-side CLI provides strict allowlisted operations to provision,
#   rotate, revoke, inspect, and ACL-verify per-device Mosquitto credentials.
#
# Usage:
#   sudo ./scripts/provision-mqtt-device.sh add <device_id> [--passwd-file PATH] [--out-dir PATH]
#   sudo ./scripts/provision-mqtt-device.sh rotate <device_id> [--passwd-file PATH] [--out-dir PATH]
#   sudo ./scripts/provision-mqtt-device.sh revoke <device_id> [--passwd-file PATH]
#   sudo ./scripts/provision-mqtt-device.sh status [device_id] [--passwd-file PATH]
#   sudo ./scripts/provision-mqtt-device.sh verify-acl [--acl-file PATH]
# ==============================================================================
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

PASSWD_FILE="$PROJECT_DIR/mosquitto/passwd"
ACL_FILE="$PROJECT_DIR/mosquitto/acl"
OUT_DIR="$PROJECT_DIR/mosquitto/provisioned-credentials"
MOSQUITTO_CONTAINER="${LCI_MOSQUITTO_CONTAINER:-lci_mqtt_broker}"
MOSQUITTO_IMAGE="${LCI_MOSQUITTO_IMAGE:-eclipse-mosquitto:2.0}"
NO_RELOAD="${LCI_NO_RELOAD:-0}"

die() { printf '[LCI-MQTT-PROVISION] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[LCI-MQTT-PROVISION] %s\n' "$*"; }

validate_device_id() {
  local id="$1"
  [[ "$id" =~ ^[a-z][a-z0-9_-]{0,47}$ ]] || die "Invalid device_id '$id'. Allowed pattern: ^[a-z][a-z0-9_-]{0,47}$"
  case "$id" in
    lci_backend|node1_access|node2_env|vision_service|root|admin)
      die "Identity '$id' is reserved and cannot be modified via device provisioning."
      ;;
  esac
}

run_mosquitto_passwd() {
  if command -v mosquitto_passwd >/dev/null 2>&1; then
    mosquitto_passwd "$@"
  elif command -v docker >/dev/null 2>&1; then
    local dir base
    dir="$(cd -- "$(dirname -- "$PASSWD_FILE")" && pwd -P)"
    base="$(basename -- "$PASSWD_FILE")"
    local args=()
    for a in "$@"; do
      if [[ "$a" == "$PASSWD_FILE" ]]; then
        args+=("/mosquitto/config/$base")
      else
        args+=("$a")
      fi
    done
    docker run --rm --user 0:0 --entrypoint mosquitto_passwd \
      -v "$dir:/mosquitto/config" \
      "$MOSQUITTO_IMAGE" "${args[@]}"
  else
    die "Neither local 'mosquitto_passwd' nor 'docker' is available on this host."
  fi
}

fix_passwd_permissions() {
  [[ -f "$PASSWD_FILE" ]] || return 0
  if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" && $EUID -eq 0 ]]; then
    chown 1883:1883 "$PASSWD_FILE" 2>/dev/null || true
  fi
  chmod 600 "$PASSWD_FILE"
}

reload_broker_if_running() {
  [[ "$NO_RELOAD" == "1" ]] && return 0
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -Fxq "$MOSQUITTO_CONTAINER"; then
    docker kill --signal=HUP "$MOSQUITTO_CONTAINER" >/dev/null 2>&1 || true
    log "Sent SIGHUP to running container '$MOSQUITTO_CONTAINER' to reload credentials."
  fi
}

verify_acl_file() {
  [[ -f "$ACL_FILE" ]] || die "ACL file not found: $ACL_FILE"
  local required=(
    "user lci_backend"
    "topic read lci/v1/devices/+/telemetry"
    "topic read lci/v1/devices/+/heartbeat"
    "topic read lci/v1/devices/+/ack"
    "topic write lci/v1/devices/+/command"
    "pattern write lci/v1/devices/%u/telemetry"
    "pattern write lci/v1/devices/%u/heartbeat"
    "pattern write lci/v1/devices/%u/ack"
    "pattern read lci/v1/devices/%u/command"
  )
  for line in "${required[@]}"; do
    grep -Fxq "$line" "$ACL_FILE" || die "Required least-privilege ACL directive missing: '$line'"
  done
  if grep -Eq '^\s*topic\s+(readwrite\s+)?#' "$ACL_FILE"; then
    die "Unsafe wildcard ACL rule detected in $ACL_FILE."
  fi
  log "ACL verification PASSED: per-device %u isolation and backend least-privilege rules are intact."
}

ACTION="${1:-}"
shift || true

DEVICE_ID=""
if [[ "$ACTION" == "add" || "$ACTION" == "rotate" || "$ACTION" == "revoke" ]]; then
  DEVICE_ID="${1:-}"
  [[ -n "$DEVICE_ID" ]] || die "Missing <device_id> argument for '$ACTION'."
  shift || true
elif [[ "$ACTION" == "status" && "${1:-}" != "" && "${1:-}" != --* ]]; then
  DEVICE_ID="$1"
  shift || true
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --passwd-file) PASSWD_FILE="${2:-}"; shift 2 ;;
    --acl-file) ACL_FILE="${2:-}"; shift 2 ;;
    --out-dir) OUT_DIR="${2:-}"; shift 2 ;;
    --no-reload) NO_RELOAD=1; shift ;;
    *) die "Unknown option: $1" ;;
  esac
done

case "$ACTION" in
  add|rotate)
    validate_device_id "$DEVICE_ID"
    verify_acl_file
    mkdir -p "$(dirname -- "$PASSWD_FILE")" "$OUT_DIR"
    chmod 700 "$OUT_DIR"
    touch "$PASSWD_FILE"
    chmod 600 "$PASSWD_FILE"

    if [[ "$ACTION" == "add" ]] && grep -Eq "^${DEVICE_ID}:" "$PASSWD_FILE"; then
      die "Identity '$DEVICE_ID' already exists in $PASSWD_FILE. Use 'rotate $DEVICE_ID' to replace its password."
    fi
    if [[ "$ACTION" == "rotate" ]] && ! grep -Eq "^${DEVICE_ID}:" "$PASSWD_FILE"; then
      die "Identity '$DEVICE_ID' does not exist in $PASSWD_FILE. Use 'add $DEVICE_ID' first."
    fi

    PASSWORD="$(openssl rand -hex 24)"
    run_mosquitto_passwd -b "$PASSWD_FILE" "$DEVICE_ID" "$PASSWORD"
    fix_passwd_permissions

    CRED_FILE="$OUT_DIR/${DEVICE_ID}.cred"
    cat > "$CRED_FILE" <<EOF
# LCI-SFM Provisioned MQTT Device Identity (Mode 0600 — Keep Private)
device_id=$DEVICE_ID
mqtt_username=$DEVICE_ID
mqtt_password=$PASSWORD
publish_telemetry=lci/v1/devices/$DEVICE_ID/telemetry
publish_heartbeat=lci/v1/devices/$DEVICE_ID/heartbeat
publish_ack=lci/v1/devices/$DEVICE_ID/ack
subscribe_command=lci/v1/devices/$DEVICE_ID/command
provisioned_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
    chmod 600 "$CRED_FILE"
    unset PASSWORD
    reload_broker_if_running
    log "Provisioned MQTT identity '$DEVICE_ID' ($ACTION)."
    log "One-time credentials stored at: $CRED_FILE (mode 0600; never stored in SQLite or UI)."
    log "Next step: Mark '$DEVICE_ID' as PROVISIONED in the LCI-SFM Console -> Devices -> $DEVICE_ID."
    ;;

  revoke)
    validate_device_id "$DEVICE_ID"
    [[ -f "$PASSWD_FILE" ]] || die "Password file not found: $PASSWD_FILE"
    if ! grep -Eq "^${DEVICE_ID}:" "$PASSWD_FILE"; then
      die "Identity '$DEVICE_ID' is not present in $PASSWD_FILE."
    fi
    run_mosquitto_passwd -D "$PASSWD_FILE" "$DEVICE_ID"
    fix_passwd_permissions
    rm -f "$OUT_DIR/${DEVICE_ID}.cred"
    reload_broker_if_running
    log "Revoked MQTT identity '$DEVICE_ID' from $PASSWD_FILE."
    ;;

  status)
    [[ -f "$PASSWD_FILE" ]] || { log "Password file not found: $PASSWD_FILE"; exit 0; }
    if [[ -n "$DEVICE_ID" ]]; then
      validate_device_id "$DEVICE_ID"
      if grep -Eq "^${DEVICE_ID}:" "$PASSWD_FILE"; then
        printf 'PROVISIONED %s\n' "$DEVICE_ID"
      else
        printf 'UNPROVISIONED %s\n' "$DEVICE_ID"
      fi
    else
      log "Provisioned MQTT identities in $PASSWD_FILE (passwords never displayed):"
      cut -d: -f1 "$PASSWD_FILE" | sort
    fi
    ;;

  verify-acl)
    verify_acl_file
    ;;

  *)
    cat >&2 <<EOF
Usage:
  sudo $0 add <device_id> [--passwd-file PATH] [--out-dir PATH]
  sudo $0 rotate <device_id> [--passwd-file PATH] [--out-dir PATH]
  sudo $0 revoke <device_id> [--passwd-file PATH]
  sudo $0 status [device_id] [--passwd-file PATH]
  sudo $0 verify-acl [--acl-file PATH]
EOF
    exit 1
    ;;
esac
