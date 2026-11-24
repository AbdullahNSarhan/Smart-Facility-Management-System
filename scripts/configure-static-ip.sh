#!/usr/bin/env bash
# ==============================================================================
# LCI-SFM Safe Ubuntu Netplan Static IPv4 Configuration Helper
# - Discovers wired Ethernet interfaces and current addresses
# - Validates IPv4/prefix, gateway, and checks for LAN IP conflicts via ARP
# - Backs up existing /etc/netplan/*.yaml before modifying anything
# - Supports --dry-run and uses `netplan try` for automatic rollback safety
#
# Usage:
#   sudo ./scripts/configure-static-ip.sh --discover
#   sudo ./scripts/configure-static-ip.sh --iface eth0 --cidr 192.168.10.20/24 --gateway 192.168.10.1 [--dns 192.168.10.1] [--dry-run]
# ==============================================================================
set -Eeuo pipefail
umask 077

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[LCI-SFM NET] %s\n' "$*"; }
warn() { printf '[LCI-SFM NET] WARNING: %s\n' "$*" >&2; }

IFACE=""
CIDR=""
GATEWAY=""
DNS_SERVERS=""
DRY_RUN=0
DISCOVER_ONLY=0
TRY_TIMEOUT="${LCI_NETPLAN_TRY_TIMEOUT:-120}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --discover) DISCOVER_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --iface) IFACE="${2:-}"; shift 2 ;;
    --cidr) CIDR="${2:-}"; shift 2 ;;
    --gateway) GATEWAY="${2:-}"; shift 2 ;;
    --dns) DNS_SERVERS="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
done

discover_interfaces() {
  log "Discovered non-loopback network interfaces:"
  printf '%-16s %-10s %-19s %s\n' "INTERFACE" "STATE" "MAC" "IPV4 ADDRESSES"
  local found=0
  if [[ -d /sys/class/net ]]; then
    for path in /sys/class/net/*; do
      [[ -e "$path" ]] || continue
      local name
      name="$(basename "$path")"
      [[ "$name" == "lo" || "$name" == docker* || "$name" == br-* || "$name" == veth* ]] && continue
      local state mac addrs
      state="$(cat "$path/operstate" 2>/dev/null || echo unknown)"
      mac="$(cat "$path/address" 2>/dev/null || echo unknown)"
      addrs="$(ip -4 -o addr show dev "$name" 2>/dev/null | awk '{print $4}' | paste -sd ',' - || true)"
      printf '%-16s %-10s %-19s %s\n' "$name" "$state" "$mac" "${addrs:-none}"
      found=1
    done
  fi
  if [[ "$found" -eq 0 ]] && command -v ip >/dev/null 2>&1; then
    while read -r _ name _ cidr _; do
      [[ -n "$name" ]] || continue
      [[ "$name" == "lo" || "$name" == docker* || "$name" == br-* || "$name" == veth* ]] && continue
      printf '%-16s %-10s %-19s %s\n' "$name" "unknown" "unknown" "$cidr"
      found=1
    done < <(ip -4 -o addr show 2>/dev/null || true)
  fi
  if [[ "$found" -eq 0 ]]; then
    printf '%-16s %-10s %-19s %s\n' "(none)" "-" "-" "-"
  fi
}

if [[ "$DISCOVER_ONLY" -eq 1 ]]; then
  discover_interfaces
  exit 0
fi

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

[[ -n "$IFACE" && -n "$CIDR" ]] || die "Provide --iface <nic> and --cidr <ip/prefix> (or run --discover)."
[[ "$IFACE" =~ ^[a-zA-Z0-9._:-]+$ ]] || die "Invalid interface name: $IFACE"
[[ -d "/sys/class/net/$IFACE" ]] || die "Network interface '$IFACE' does not exist on this host."
[[ "$CIDR" =~ ^([0-9.]+)/([0-9]{1,2})$ ]] || die "Invalid CIDR format: $CIDR (expected e.g. 192.168.10.20/24)"

TARGET_IP="${BASH_REMATCH[1]}"
PREFIX_LEN="${BASH_REMATCH[2]}"
validate_ipv4 "$TARGET_IP" || die "Invalid IPv4 address in CIDR: $TARGET_IP"
(( PREFIX_LEN >= 8 && PREFIX_LEN <= 30 )) || die "Prefix length must be between 8 and 30."

if [[ -n "$GATEWAY" ]]; then
  validate_ipv4 "$GATEWAY" || die "Invalid gateway IPv4 address: $GATEWAY"
fi

# Check whether target IP is already in use by another host on the LAN
if command -v arping >/dev/null 2>&1; then
  log "Checking for duplicate IP ($TARGET_IP) on $IFACE via ARP..."
  if arping -D -I "$IFACE" -c 2 "$TARGET_IP" >/dev/null 2>&1; then
    log "No ARP conflict detected for $TARGET_IP."
  else
    die "Duplicate IP conflict detected for $TARGET_IP on $IFACE. Choose an unused static IP."
  fi
else
  if ip neigh show dev "$IFACE" 2>/dev/null | awk '{print $1}' | grep -Fxq "$TARGET_IP"; then
    warn "Neighbor table already contains $TARGET_IP on $IFACE. Verify no other device owns this address."
  fi
fi

RENDERED_YAML="$(cat <<EOF
# Managed by LCI-SFM configure-static-ip.sh
network:
  version: 2
  renderer: networkd
  ethernets:
    ${IFACE}:
      dhcp4: false
      addresses:
        - ${CIDR}
EOF
)"

if [[ -n "$GATEWAY" ]]; then
  RENDERED_YAML="${RENDERED_YAML}
      routes:
        - to: default
          via: ${GATEWAY}"
fi

if [[ -n "$DNS_SERVERS" ]]; then
  DNS_LIST="$(printf '%s' "$DNS_SERVERS" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | paste -sd ', ' -)"
  RENDERED_YAML="${RENDERED_YAML}
      nameservers:
        addresses: [${DNS_LIST}]"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "Dry-run mode — proposed Netplan configuration (/etc/netplan/60-lci-sfm-static.yaml):"
  printf '%s\n' "$RENDERED_YAML"
  exit 0
fi

if [[ "${LCI_SKIP_ROOT_CHECK:-0}" != "1" && $EUID -ne 0 ]]; then
  die "Run with sudo to modify /etc/netplan."
fi
command -v netplan >/dev/null 2>&1 || die "netplan command not found. This helper targets Ubuntu Server."

BACKUP_DIR="/etc/netplan/lci-sfm-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
cp -a /etc/netplan/*.yaml "$BACKUP_DIR/" 2>/dev/null || true
chmod 700 "$BACKUP_DIR"
log "Backed up existing Netplan configs to $BACKUP_DIR"

TARGET_FILE="/etc/netplan/60-lci-sfm-static.yaml"
printf '%s\n' "$RENDERED_YAML" > "$TARGET_FILE"
chmod 600 "$TARGET_FILE"

log "Validating generated Netplan syntax..."
netplan generate || {
  rm -f "$TARGET_FILE"
  die "netplan generate failed; removed $TARGET_FILE. Original configs untouched."
}

warn "SSH SAFETY NOTICE: Applying a new IP on $IFACE may disconnect your active SSH session."
warn "Using 'netplan try --timeout ${TRY_TIMEOUT}'. If you do not press ENTER to confirm, Ubuntu automatically rolls back."
netplan try --timeout "$TRY_TIMEOUT"
log "Static IPv4 configuration confirmed on $IFACE ($CIDR)."
