# Development & Operations Guide — LCI-SFM

## 1. Host & Runtime Requirements

### Verified Current Host State (`/opt/lci-sfm`)
- **OS**: Ubuntu `26.04.1 LTS` (`x86_64`, Linux kernel `7.0.0-44-generic`, 4 vCPUs, 5.2 GiB RAM).
- **Installed on Host**:
  - `docker` (`29.1.3`) & `docker compose` (`v2.40.3`)
  - `git`, `curl`, `openssl`, `python3`
  - Pre-built validation container image: `lci-sfm-validator:node24` (contains Node.js `v24.22.3`, `npm 11.19.1`, Vite, and full `node_modules`).
- **Important Host Environment Notes**:
  1. **`node` and `npm` are NOT installed directly on the host OS.** All Node.js lint, build, test, and simulator scripts are currently executed either inside Docker (`lci-sfm-validator:node24` / `docker compose build`) or require installing Node.js **24 LTS** (`>=22.5.0` required for built-in `node:sqlite`) on the host if bare-metal execution is desired.
  2. **Docker Socket Privileges**: User `bedo` is in the `sudo` group (`uid=1000`), not the `docker` group; `docker` CLI commands require `sudo docker ...` unless `bedo` is added to the `docker` group.
  3. **Live Stack Currently Running**: `lci_frontend` (`127.0.0.1:80`), `lci_backend` (`3000/tcp` internal, `healthy`), and `lci_mqtt_broker` (`127.0.0.1:1883`) are actively running on this machine. Do not bind conflicting host ports (`80`, `1883`) or run destructive container resets against the live `/opt/lci-sfm` data volume without taking a backup first.

### Software Requirements Summary
| Dependency | Minimum Version | Purpose |
| :--- | :--- | :--- |
| **Node.js** | `>= 22.5.0` (`24.x` LTS used in Docker/CI) | Required for built-in `node:sqlite` (`DatabaseSync`), native `fetch`, and `node --test` |
| **npm** | `>= 10.x` (`11.19.1` in validator image) | Dependency installation & workspace scripts |
| **Docker Engine + Compose v2** | Docker `24+`, Compose `v2.20+` | Production/appliance runtime (`nginx`, `backend`, `mosquitto`) |
| **Eclipse Mosquitto** | `2.0.x` (`eclipse-mosquitto:2.0`) | Authenticated MQTT v3.1.1/v5 broker with per-identity ACLs |
| **Nginx** | `1.27-alpine` | Reverse proxy (`/api`, `/ws`) + static SPA bundle serving |
| **Playwright + Chromium** *(optional)* | `@playwright/test ^1.52.0` | Required only when running browser E2E tests (`npm run test:ui`) |

---

## 2. NPM Scripts Reference

Defined in root [package.json](file:///opt/lci-sfm/package.json) and [backend/package.json](file:///opt/lci-sfm/backend/package.json):

| Command (from `/opt/lci-sfm`) | Underlying Execution | Description |
| :--- | :--- | :--- |
| `npm run dev` | `vite` (port `5173` default) | Starts Vite frontend dev server (expects backend API/WS proxy or standalone backend on `:3000`). |
| `npm run build` | `vite build` | Bundles the SPA (`index.html`, `app.js`, `frontend/**`, `styles.css`, `public/**`) into `dist/`. |
| `npm run preview` | `vite preview` | Serves the built `dist/` bundle locally. |
| `npm run backend:dev` | `node --watch backend/src/server.js` | Starts the Express + WebSocket + SQLite + MQTT backend in watch mode. |
| `npm run backend:start` | `node backend/src/server.js` | Starts the backend in production/standard mode. |
| `npm run lint` | `node --check ...` across root, `frontend/`, `scripts/`, and `backend/src/` + `backend/test/` | Syntax-checks JavaScript/ESM modules (`0` external linter dependencies). |
| `npm test` | `npm --prefix backend test` (`node --test test/*.test.js`) | Runs all **65** automated backend integration & unit tests across 4 test suites using isolated temporary SQLite DBs and ephemeral TCP MQTT brokers. |
| `npm run test:ui` | `node scripts/ui-e2e.mjs` | Builds `dist/`, boots an ephemeral backend + simulated MQTT broker, and runs headless Chromium UI verification across all SPA routes. |
| `npm run test:load` | `node scripts/load-test.mjs` | Runs high-throughput multi-device telemetry + API load benchmark (`100` simulated devices). |
| `npm run simulate` | `node scripts/device-simulator.mjs` | Publishes realistic `LEGACY_V1` + `MQTT_V1` telemetry/heartbeats, handles actuator commands, and optionally serves a mock HTTP/JPEG endpoint (`SIM_HTTP_PORT=3101`). |
| `npm run db:backup` | `node scripts/db-backup.mjs` | Creates an online `VACUUM INTO` SQLite backup in `backups/` and verifies `PRAGMA integrity_check`. |
| `npm run db:restore -- <file>` | `node scripts/db-restore.mjs <file>` | Verifies and restores a SQLite backup file safely (requires backend stopped). |
| `npm run bundle:offline` | `bash scripts/build-offline-bundle.sh` | Builds Docker images, exports `.tar.gz` archives + scripts + SHA-256 checksums into `dist-release/` for air-gapped installation. |

### Running Validation Commands Without Host `node` (Verified Safe Pattern)

Because `node` is not installed directly on the host OS, run lint and unit/integration tests safely inside the pre-built `lci-sfm-validator:node24` image with a read-only source bind mount and an in-memory `tmpfs` for `/workspace/data`:

```bash
sudo docker run --rm \
  -v /opt/lci-sfm:/workspace:ro \
  --mount type=tmpfs,destination=/workspace/data,tmpfs-mode=1777 \
  -w /workspace \
  lci-sfm-validator:node24 \
  sh -lc 'npm run lint && npm test'
```

*(Verified result: `npm run lint` exits `0`; `npm test` passes **65 / 65** tests in ~12 seconds without touching host files.)*

---

## 3. Environment Variables Reference

Validated by Zod in [env.js](file:///opt/lci-sfm/backend/src/config/env.js) and templated in [.env.example](file:///opt/lci-sfm/.env.example). **Never commit `.env` or print secret values.**

| Variable | Required in Prod | Default (Dev / Compose) | Purpose & Validation Rules |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | Yes | `development` (`production` in Compose) | Runtime mode (`development`, `test`, `production`). Production enforces strict secret & CORS checks. |
| `PORT` | No | `3000` | Internal HTTP/WebSocket port for `lci_backend`. |
| `FRONTEND_PORT` | No | `80` | Host port mapped to `lci_frontend` (`nginx`) HTTP listener. |
| `FRONTEND_TLS_PORT` | No | `443` | Host port mapped to `lci_frontend` HTTPS listener when `docker-compose.tls.yml` is active. |
| `FRONTEND_BIND_IP` | No | `0.0.0.0` (`127.0.0.1` on current host) | Host interface IP for Nginx port binding. |
| `MQTT_PORT` | No | `1883` | Host port mapped to `lci_mqtt_broker` (`mosquitto`). |
| `MQTT_BIND_IP` | No | `127.0.0.1` | Host interface IP for Mosquitto (`127.0.0.1` keeps broker local-only; set LAN IP for physical ESP32 nodes). |
| `TLS_ENABLED` | No | `false` | Enables `docker-compose.tls.yml` + `nginx/nginx-tls.conf` (`Secure` session cookies when `COOKIE_SECURE=true`). |
| `TLS_SERVER_NAME` | No | `localhost` | CN / SAN hostname or LAN IP generated into self-signed TLS certs by `install.sh`. |
| `DB_PATH` | No | `./data/lci_sfm.sqlite` (`/app/data/lci_sfm.sqlite` in Docker) | Path to SQLite database file (directory must be writable). |
| `MQTT_BROKER_URL` | Yes | `mqtt://127.0.0.1:1883` (`mqtt://mosquitto:1883` in Compose) | Broker connection URL for backend MQTT client. |
| `MQTT_USERNAME` | Yes (Prod) | `lci_backend` | Mosquitto username for backend service (rejected in prod if empty). |
| `MQTT_PASSWORD` | Yes (Prod) | *(secret in `.env`)* | Mosquitto password for `lci_backend` (must be `>= 12` chars in prod, cannot be `change-me` / `password` / `admin`). |
| `MQTT_CLIENT_ID_PREFIX` | No | `lci-backend` | Prefix for backend's MQTT client ID. |
| `BOOTSTRAP_ADMIN_USERNAME` | Yes (Prod) | `admin` | Initial `Admin` username seeded when `system_users` has no enabled admin. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Yes (Prod) | *(secret in `.env`)* | Initial `Admin` password (must be `>= 12` chars in prod; cannot be placeholder). |
| `SESSION_SECRET` | Yes (Prod) | *(64-hex secret in `.env`)* | Server cryptographic secret (`>= 32` chars required in prod). |
| `SESSION_TTL_HOURS` | No | `12` | Sliding/fixed web session lifetime in hours (`1..168`). |
| `COOKIE_SECURE` | No | `false` (`true` when TLS enabled) | Marks `lci_session` cookie as `Secure` (only enable over HTTPS or `localhost`). |
| `ALLOW_BEARER_COMPAT` | No | `false` | Legacy `Authorization: Bearer` token fallback (`false` in production so auth uses `HttpOnly` cookies + CSRF). |
| `ALLOWED_ORIGINS` | Yes (Prod) | `http://localhost:80,http://127.0.0.1:80` | Comma-separated exact origins permitted by CORS and WebSocket `Origin` validation (no `*` wildcards allowed in prod). |
| `CAMERA_SNAPSHOT_URL` | No | `""` | Optional fallback JPEG snapshot URL for legacy `/api/camera/snapshot` (`http://` or `https://`). |
| `CAMERA_SNAPSHOT_TIMEOUT_MS` | No | `3500` | Upstream timeout (`500..15000` ms) for camera snapshot proxy requests. |
| `COMMAND_ACK_TIMEOUT_MS` | No | `6000` | Timeout waiting for edge command `ACK` (`1000..60000` ms). |
| `COMMAND_CONFIRM_TIMEOUT_MS` | No | `10000` | Timeout waiting for physical state telemetry confirmation (`1000..120000` ms). |
| `HEARTBEAT_STALE_MS` | No | `65000` | Legacy node heartbeat staleness window (`5000..600000` ms). |
| `LOG_LEVEL` | No | `info` | Structured JSON logger level (`debug`, `info`, `warn`, `error`). |
| `APP_SIMULATION` | No | `false` | Marks `/api/public/info` `simulation: true` in demo environments. |

---

## 4. Network Ports & Service Topology

| Port | Protocol | Bind Default | Container / Process | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `80` | HTTP + WS | `${FRONTEND_BIND_IP}:80` | `lci_frontend` (`nginx`) | Primary operator UI, `/api/*` reverse proxy, `/ws/*` WebSocket upgrade |
| `443` | HTTPS + WSS | `${FRONTEND_BIND_IP}:443` | `lci_frontend` (`nginx` w/ TLS) | Encrypted operator UI & API when `TLS_ENABLED=true` (`docker-compose.tls.yml`) |
| `3000` | HTTP + WS | Docker bridge (`lci_net`) only | `lci_backend` (`node`) | Express REST API, `/ws/live`, `/ws/mfa`, health probes (`/api/health/live`, `/api/health/ready`) |
| `1883` | MQTT TCP | `${MQTT_BIND_IP}:1883` | `lci_mqtt_broker` (`mosquitto`) | Edge device & backend MQTT broker (`allow_anonymous false`, ACL enforced) |
| `5173` | HTTP | `127.0.0.1:5173` | `vite` (dev only) | Local frontend HMR server (`npm run dev`) |
| `3101` | HTTP | `127.0.0.1:3101` | `device-simulator.mjs` (optional) | Simulated `HTTP_JSON_V1` probe & `CAMERA_JPEG` snapshot test server |

---

## 5. Deployment, Provisioning & Maintenance Procedures

### Standard Appliance Installation & Updates
- **Fresh Online Install**: `sudo ./install.sh` (supports `--non-interactive`, `--lan-mqtt`, `--tls`, `--tls-host <ip-or-fqdn>`). Generates `.env`, `mosquitto/passwd` (`lci_backend`, `node1_access`, `node2_env`, `vision_service`), optional self-signed TLS certs, writes initial credentials to `DEPLOYMENT-CREDENTIALS.txt` (`0600`), builds `dist/` and Docker images, starts Compose, and verifies `/api/health/ready`.
- **In-Place Online Update**: `sudo ./update.sh` — creates a pre-update SQLite backup in `backups/`, verifies clean Git tree, fast-forwards Git, rebuilds images, restarts containers, and rolls back automatically if `/api/health/ready` fails.
- **Air-Gapped Offline Install / Update**: Build bundle on an internet-connected build host via `npm run bundle:offline` (outputs `dist-release/`), transfer to target server, and run `sudo ./install-offline.sh` or `sudo ./update-offline.sh`.
- **Per-Device MQTT Provisioning (`MQTT_V1` hardware)**:
  ```bash
  sudo ./scripts/provision-mqtt-device.sh <device_id>
  ```
  Generates a unique strong password, updates `mosquitto/passwd` via `mosquitto_passwd` inside the `eclipse-mosquitto:2.0` container, appends scoped `lci/v1/d/<device_id>/#` rules to `mosquitto/acl`, sends `SIGHUP` to `lci_mqtt_broker` for zero-downtime reload, marks `mqtt_identity_status = 'PROVISIONED'` in SQLite, and writes credentials to `mosquitto/provisioned-credentials/<device_id>.cred` (`0600`).

---

## 6. Critical Operational Caveats for `/opt/lci-sfm`

1. **Mosquitto File Ownership (`UID 1883`) vs. Workspace Ownership (`bedo:bedo`)**:
   - Inside `eclipse-mosquitto:2.0`, Mosquitto drops privileges to container `uid=1883(mosquitto)` / `gid=1883(mosquitto)`.
   - `install.sh` and `update.sh` set `mosquitto/passwd` and `mosquitto/acl` to `1883:1883` (`chmod 0600`).
   - Because `/opt/lci-sfm` was recursively changed to `bedo:bedo` so Antigravity can access the repository, `mosquitto/passwd` and `mosquitto/acl` (`0600`) are currently owned by `1000:1000`. The already-running `lci_mqtt_broker` continues operating from in-memory loaded credentials, **but before restarting or `SIGHUP`-reloading `lci_mqtt_broker`**, `mosquitto/passwd` and `mosquitto/acl` must be made readable by GID/UID `1883` (for example `sudo chown bedo:1883 /opt/lci-sfm/mosquitto/passwd /opt/lci-sfm/mosquitto/acl && sudo chmod 0640 /opt/lci-sfm/mosquitto/passwd /opt/lci-sfm/mosquitto/acl`, or `1883:1883` as `install.sh` expects).
2. **`sudo ./update.sh` Git Safe-Directory & Clean Working Tree**:
   - Because `/opt/lci-sfm` is now owned by `bedo:bedo`, running `sudo ./update.sh` executes `git` as `root`, which Git blocks with `detected dubious ownership` unless `/opt/lci-sfm` is registered via `sudo git config --global --add safe.directory /opt/lci-sfm`.
   - Additionally, [update.sh](file:///opt/lci-sfm/update.sh#L37) checks `git status --porcelain` and aborts if untracked files/directories (such as `project-knowledge/` or `mosquitto/provisioned-credentials/`) exist and are not ignored in `.gitignore` or `.git/info/exclude`.
3. **Secret Files Present on Disk (Never Commit or Print)**:
   - `/opt/lci-sfm/.env`
   - `/opt/lci-sfm/DEPLOYMENT-CREDENTIALS.txt`
   - `/opt/lci-sfm/mosquitto/passwd`
   - `/opt/lci-sfm/mosquitto/device-credentials.txt`
   - `/opt/lci-sfm/mosquitto/provisioned-credentials/*.cred` *(if created by `provision-mqtt-device.sh` — currently NOT in `.gitignore`!)*
