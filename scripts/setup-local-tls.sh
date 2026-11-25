#!/usr/bin/env bash
# ==============================================================================
# LCI-SFM Local LAN TLS Certificate Generator (Private Local CA + Server SAN Cert)
# Generates offline private LAN TLS certificates with strict 0600 key permissions.
# Usage:
#   sudo ./scripts/setup-local-tls.sh <LAN_IPV4> [HOSTNAME]
# ==============================================================================
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
CERT_DIR="${LCI_CERT_DIR:-$PROJECT_DIR/nginx/certs}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[LCI-SFM TLS] %s\n' "$*"; }

command -v openssl >/dev/null 2>&1 || die "openssl is required to generate local TLS certificates."

LAN_IP="${1:-}"
HOSTNAME_SAN="${2:-lci-sfm.local}"
DAYS="${LCI_TLS_DAYS:-825}"

[[ -n "$LAN_IP" ]] || die "Usage: $0 <LAN_IPV4> [HOSTNAME]"
[[ "$LAN_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "Invalid IPv4 address: $LAN_IP"
[[ "$HOSTNAME_SAN" =~ ^[a-zA-Z0-9.-]+$ ]] || die "Invalid hostname: $HOSTNAME_SAN"

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

CA_KEY="$CERT_DIR/local-ca.key"
CA_CRT="$CERT_DIR/local-ca.crt"
SRV_KEY="$CERT_DIR/server.key"
SRV_CSR="$CERT_DIR/server.csr"
SRV_CRT="$CERT_DIR/server.crt"
EXT_CFG="$CERT_DIR/server-san.ext"

if [[ ! -f "$CA_KEY" || ! -f "$CA_CRT" ]]; then
  log "Generating local facility root CA in $CERT_DIR"
  openssl genrsa -out "$CA_KEY" 4096 2>/dev/null
  chmod 600 "$CA_KEY"
  openssl req -x509 -new -nodes -key "$CA_KEY" -sha256 -days 3650 \
    -subj "/CN=LCI-SFM Local Facility CA/O=LCI-SFM On-Premises" \
    -out "$CA_CRT"
  chmod 644 "$CA_CRT"
else
  log "Reusing existing local facility root CA ($CA_CRT)"
fi

log "Generating server TLS key & SAN certificate for IP:$LAN_IP and DNS:$HOSTNAME_SAN"
openssl genrsa -out "$SRV_KEY" 2048 2>/dev/null
chmod 600 "$SRV_KEY"

openssl req -new -key "$SRV_KEY" \
  -subj "/CN=$HOSTNAME_SAN/O=LCI-SFM Server" \
  -out "$SRV_CSR"

cat > "$EXT_CFG" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
IP.1 = $LAN_IP
IP.2 = 127.0.0.1
DNS.1 = $HOSTNAME_SAN
DNS.2 = localhost
EOF

openssl x509 -req -in "$SRV_CSR" -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$SRV_CRT" -days "$DAYS" -sha256 -extfile "$EXT_CFG" 2>/dev/null

chmod 644 "$SRV_CRT"
rm -f "$SRV_CSR" "$EXT_CFG" "$CERT_DIR/local-ca.srl"

log "Local TLS certificates ready:"
printf '  Server Cert : %s\n' "$SRV_CRT"
printf '  Server Key  : %s (mode 600)\n' "$SRV_KEY"
printf '  Local CA    : %s (import on operator workstations to trust HTTPS)\n' "$CA_CRT"
printf '\nNext steps:\n'
printf '  1. Set TLS_ENABLED=true, SESSION_SECURE_COOKIE=true, and ALLOWED_ORIGINS=https://%s in .env\n' "$LAN_IP"
printf '  2. Start with TLS override: docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d\n'
