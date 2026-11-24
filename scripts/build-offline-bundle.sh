#!/usr/bin/env bash
# ==============================================================================
# LCI-SFM Air-Gapped Offline Release Bundle Builder
# Builds a self-contained, SHA-256 verified release archive suitable for USB or
# private LAN transfer into an air-gapped Ubuntu Server with ZERO internet access.
#
# Usage:
#   ./scripts/build-offline-bundle.sh [--skip-docker-images] [--sign-key /path/to/priv.pem] [--out-dir dist-release]
# ==============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
cd "$PROJECT_DIR"

SKIP_DOCKER_IMAGES=0
SIGN_KEY=""
OUT_DIR="${LCI_OUT_DIR:-$PROJECT_DIR/dist-release}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-docker-images) SKIP_DOCKER_IMAGES=1; shift ;;
    --sign-key) SIGN_KEY="${2:-}"; shift 2 ;;
    --out-dir) OUT_DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) printf 'ERROR: Unknown option %s\n' "$1" >&2; exit 1 ;;
  esac
done

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[LCI-SFM BUNDLE] %s\n' "$*"; }

VERSION="$(node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).version")"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'no-git')"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BUNDLE_NAME="lci-sfm-${VERSION}-offline"

log "Building frontend production bundle (dist/) for version ${VERSION}..."
npm run build
[[ -s dist/index.html ]] || die "dist/index.html missing after build."

STAGE_ROOT="$(mktemp -d)"
trap 'rm -rf "$STAGE_ROOT"' EXIT
STAGE_DIR="$STAGE_ROOT/$BUNDLE_NAME"
mkdir -p "$STAGE_DIR/images" "$STAGE_DIR/nginx" "$STAGE_DIR/mosquitto" "$STAGE_DIR/scripts" "$STAGE_DIR/deployment"

log "Staging runtime artifacts..."
cp -a dist "$STAGE_DIR/dist"
cp -a backend "$STAGE_DIR/backend"
rm -rf "$STAGE_DIR/backend/node_modules" "$STAGE_DIR/backend/test"
cp -a .env.example docker-compose.yml docker-compose.tls.yml package.json package-lock.json install-offline.sh update-offline.sh "$STAGE_DIR/"
cp -a nginx/nginx.conf nginx/nginx-tls.conf "$STAGE_DIR/nginx/"
cp -a mosquitto/mosquitto.conf mosquitto/acl "$STAGE_DIR/mosquitto/"
cp -a scripts/provision-mqtt-device.sh scripts/configure-static-ip.sh scripts/setup-local-tls.sh "$STAGE_DIR/scripts/"
cp -a deployment/validation.Dockerfile "$STAGE_DIR/deployment/"

IMAGES_BUNDLED="false"
if [[ "$SKIP_DOCKER_IMAGES" -eq 0 ]]; then
  command -v docker >/dev/null 2>&1 || die "Docker is required to export OCI images (or pass --skip-docker-images)."
  log "Building & exporting Docker OCI image archives..."
  docker build -t "lci-sfm-backend:${VERSION}" -f backend/Dockerfile .
  docker pull nginx:1.27-alpine
  docker pull eclipse-mosquitto:2.0
  docker save "lci-sfm-backend:${VERSION}" | gzip -9 > "$STAGE_DIR/images/lci-sfm-backend.tar.gz"
  docker save nginx:1.27-alpine | gzip -9 > "$STAGE_DIR/images/nginx-1.27-alpine.tar.gz"
  docker save eclipse-mosquitto:2.0 | gzip -9 > "$STAGE_DIR/images/eclipse-mosquitto-2.0.tar.gz"
  IMAGES_BUNDLED="true"
else
  log "Skipping Docker OCI image export (--skip-docker-images)"
fi

cat > "$STAGE_DIR/release-manifest.json" <<EOF
{
  "product": "LCI-SFM",
  "version": "${VERSION}",
  "commit": "${COMMIT}",
  "built_at": "${BUILT_AT}",
  "images_bundled": ${IMAGES_BUNDLED},
  "air_gapped_install": true
}
EOF

log "Generating SHA256SUMS manifest..."
(
  cd "$STAGE_DIR"
  find . -type f ! -name 'SHA256SUMS' ! -name 'SHA256SUMS.sig' | sort | xargs sha256sum > SHA256SUMS
)

if [[ -n "$SIGN_KEY" ]]; then
  [[ -f "$SIGN_KEY" ]] || die "Signing key not found: $SIGN_KEY"
  openssl dgst -sha256 -sign "$SIGN_KEY" -out "$STAGE_DIR/SHA256SUMS.sig" "$STAGE_DIR/SHA256SUMS"
  log "Signed SHA256SUMS with OpenSSL private key."
fi

mkdir -p "$OUT_DIR"
ARCHIVE_PATH="$OUT_DIR/${BUNDLE_NAME}.tar.gz"
tar -C "$STAGE_ROOT" -czf "$ARCHIVE_PATH" "$BUNDLE_NAME"
sha256sum "$ARCHIVE_PATH" > "${ARCHIVE_PATH}.sha256"

log "Offline release bundle created:"
printf '  Archive : %s\n' "$ARCHIVE_PATH"
printf '  SHA-256 : %s.sha256\n' "$ARCHIVE_PATH"
