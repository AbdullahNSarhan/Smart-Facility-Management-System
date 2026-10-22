# LCI-SFM Deployment Guide

This guide prepares a Linux server and deploys the repository's current Docker Compose stack: Nginx frontend, Node.js backend, SQLite persistent storage, and authenticated Eclipse Mosquitto.

**Important scope:** This is deployment documentation, not proof that the stack has already been installed on a physical server. The current Compose file defines Nginx, Node.js, and Mosquitto. It does not define a Python/OpenCV vision container or deploy ESP32 firmware.

## 1. Deployment overview

| Service | Role | Container port | Published to host? |
|---|---|---:|---|
| `frontend_dashboard` | Nginx static frontend and reverse proxy | 80 | Yes, configurable host bind IP |
| `backend` | Node.js API, authentication, WebSockets, MQTT coordination, SQLite | 3000 | No; private Docker network only |
| `mqtt-service` | Eclipse Mosquitto MQTT broker | 1883 | Yes, configurable host bind IP |

Persistent data:
- `sqlite_data`: SQLite database at `/app/data/lci_sfm.db` inside the backend container.
- `mosquitto_data`: Mosquitto persistence files.
- `mosquitto/passwd`: private file containing hashed MQTT credentials; intentionally not committed to Git.
- `.env`: host-specific settings and secrets; intentionally not committed to Git.

Nginx proxies `/api/*` and `/ws/*` to Node.js. Browsers must not connect directly to Mosquitto and must never receive MQTT credentials.

## 2. Network and security decisions

Record actual addresses before deployment. These are examples only:

| Item | Example only |
|---|---|
| Server static LAN IPv4 | `192.168.43.225` |
| Node 1 — access controller | `192.168.43.11` |
| Node 2 — environmental controller | `192.168.43.12` |
| Node 3 — camera endpoint | `192.168.43.13` |
| Browser origin | `http://192.168.43.225` |

### Keep the initial deployment private

The included Nginx configuration uses HTTP port 80 and the Mosquitto listener uses non-TLS MQTT on port 1883. Use this configuration only on a trusted/private LAN or lab network. For public or untrusted networks, implement HTTPS for the web UI, TLS for MQTT, and review session-cookie, proxy, and firewall settings before exposure.

Docker-published ports can bypass common UFW filtering paths. Do not assume UFW alone protects Docker-published ports; review Docker's firewall guidance and use the appropriate upstream firewall or supported `DOCKER-USER` path:
https://docs.docker.com/engine/install/ubuntu/#firewall-limitations

The Compose file now defaults the published ports to loopback (`127.0.0.1`). To access the UI from other computers or allow ESP32 devices to connect to MQTT, intentionally bind the relevant port to the server's static **private LAN IP** and restrict traffic at the firewall/router. Avoid binding to `0.0.0.0` on a host with public interfaces.

## 3. Prepare an Ubuntu server

Recommended starting point: supported 64-bit Ubuntu Server LTS, static private address, SSH access, sufficient disk, and administrative sudo access. Follow Docker's official installation instructions for the supported release:
https://docs.docker.com/engine/install/ubuntu/

### 3.1 Check the host

SSH to the server:

```bash
ssh <your-user>@<server-ip>
```

Then run:

```bash
cat /etc/os-release
ip -br address
df -h
sudo ss -lntp | grep -E ':(22|80|1883|3000)\b' || true
```

Confirm that ports 80 and 1883 are not already in use. Identify the owner of any existing service before changing it.

### 3.2 Update packages and install basic tools

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git openssh-client
```

If a reboot is required, reboot and confirm SSH connectivity again before proceeding.

### 3.3 Install Docker Engine and Compose plugin

Use Docker's official APT repository instructions. The core commands for supported Ubuntu releases are:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Reference: https://docs.docker.com/engine/install/ubuntu/

Use `sudo docker ...` commands below. Membership in the `docker` group can grant root-level control of the host; only grant it to trusted administrators.

## 4. Download the repository

For a new deployment:

```bash
sudo mkdir -p /opt/lci-sfm
sudo chown "$USER":"$USER" /opt/lci-sfm
git clone https://github.com/AbdullahNSarhan/Smart-Facility-Management-System.git /opt/lci-sfm
cd /opt/lci-sfm
```

If it is already cloned, inspect changes first:

```bash
cd /opt/lci-sfm
git status --short
git log -1 --oneline
```

Do not overwrite an existing `.env`, database, Mosquitto password file, or backup when updating an installation.

## 5. Configure environment variables

Create and protect the deployment file:

```bash
cd /opt/lci-sfm
cp .env.example .env
chmod 600 .env
nano .env
```

Review all values before starting. Do not commit `.env` or paste its contents into a ticket/chat.

### 5.1 Required production values

These are examples of the intended settings. Replace all placeholders and use your actual server address:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

LCI_BOOTSTRAP_ADMIN_USERNAME=sfm_admin
LCI_BOOTSTRAP_ADMIN_PASSWORD=REPLACE_WITH_YOUR_OWN_RANDOM_SECRET

SESSION_COOKIE_NAME=lci_sid
SESSION_IDLE_TTL_MS=1800000
SESSION_ABSOLUTE_TTL_MS=28800000
SESSION_SECURE_COOKIE=false
ALLOW_BEARER_COMPAT=false
ALLOWED_ORIGINS=http://<SERVER_LAN_IP>

MQTT_ENABLED=true
MQTT_BROKER_URL=mqtt://mqtt-service:1883
MQTT_USERNAME=lci_backend
MQTT_PASSWORD=REPLACE_WITH_THE_SAME_SECRET_USED_FOR_LCI_BACKEND

FRONTEND_BIND_IP=127.0.0.1
MQTT_BIND_IP=127.0.0.1
```

Replace `REPLACE_WITH...` and `<SERVER_LAN_IP>` with real values. Do not leave the placeholder strings in `.env`.

Generate two separate random secrets on the server:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Use the first for `LCI_BOOTSTRAP_ADMIN_PASSWORD`; use the second for `MQTT_PASSWORD`. Do not reuse secrets or commit them to source control.

The example Compose configuration overrides `SQLITE_DB_PATH` to `/app/data/lci_sfm.db` inside the container and mounts `/app/data` as the persistent `sqlite_data` volume.

**Bootstrap note:** the initial Admin username/password are used when the database has no enabled Admin. Keep the bootstrap configuration in the protected `.env` so the configured recovery path remains available. Change the initial account password in the application after the first login.

### 5.2 Origins, cookies, and bind addresses

- `ALLOWED_ORIGINS` must contain the exact browser origin, such as `http://192.168.43.225` only if that is the actual URL used.
- `SESSION_SECURE_COOKIE=false` is for the current HTTP-only private-LAN lab. Set it to `true` only after HTTPS is correctly configured.
- `ALLOW_BEARER_COMPAT=false` is the intended same-origin cookie mode. Keep frontend and backend session/CSRF/WebSocket settings consistent.
- Keep `FRONTEND_BIND_IP=127.0.0.1` and `MQTT_BIND_IP=127.0.0.1` for local-only smoke testing. Change each to the real static private IP only when LAN access is required and firewall policy is ready.

## 6. Prepare Mosquitto authentication before Compose startup

Compose bind-mounts `./mosquitto/passwd` into the broker. That file is intentionally absent from Git because it contains sensitive credential hashes. **Create it before `docker compose up`.**

The ACL file defines these broker identities:
- `lci_backend`: Node.js backend.
- `node1_access`: Node 1 access/MFA controller.
- `node2_env`: Node 2 environmental controller.
- `vision_service`: Python/OpenCV vision service, if deployed separately.

### 6.1 Create the password file

From the repository root:

```bash
cd /opt/lci-sfm
sudo touch mosquitto/passwd
sudo chmod 600 mosquitto/passwd
```

Create each account interactively using the official Mosquitto 2.x container. Use `-c` **only for the first account** because it creates/replaces the file:

```bash
sudo docker run --rm -it --user 0:0 \
  -v "$PWD/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0 \
  mosquitto_passwd -c /mosquitto/config/passwd lci_backend

sudo docker run --rm -it --user 0:0 \
  -v "$PWD/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0 \
  mosquitto_passwd /mosquitto/config/passwd node1_access

sudo docker run --rm -it --user 0:0 \
  -v "$PWD/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0 \
  mosquitto_passwd /mosquitto/config/passwd node2_env

sudo docker run --rm -it --user 0:0 \
  -v "$PWD/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0 \
  mosquitto_passwd /mosquitto/config/passwd vision_service

sudo chown 1883:1883 mosquitto/passwd
sudo chmod 0600 mosquitto/passwd
test -s mosquitto/passwd && echo "Mosquitto password file exists"
```

Enter a unique password at each prompt. Put the exact password entered for `lci_backend` into `MQTT_PASSWORD` in `.env`. The file stores hashes, not plaintext passwords.

Do not rerun the first command with `-c` when adding or updating another account, or existing account entries will be erased. The official utility manual describes the flags: https://www.mosquitto.org/man/mosquitto_passwd-1.html

After creation, the file must be readable by the broker process (UID/GID 1883 in the standard image) while remaining private. The commands above set ownership/mode for that purpose.

### 6.2 Review Mosquitto policy

Review `mosquitto/mosquitto.conf` and `mosquitto/acl`. Anonymous access should remain disabled. MQTT credentials must be unique per identity; the browser must not receive them.

The current documented topics include `lecf/env/telemetry` and `lecf/access/mfa_face`. Some state, command, acknowledgement, and heartbeat topics are proposed firmware extensions. A broker ACL does not implement firmware behavior; confirm the ESP32/vision publishers, subscribers, and payload schemas match the registry.

## 7. Build and validate

Use Node.js 24 LTS on the server or a controlled Node 24 build environment. Check:

```bash
node --version
npm --version
```

From the repository root:

```bash
npm install --no-package-lock
npm run lint
npm test
npm run build
```

The build should create `dist/index.html` and the bundled assets. Stop and resolve any failing lint, test, or build command before bringing services online.

If you do not want to install Node.js on the host, run the build/test commands inside a Node 24 container instead:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_cache=/tmp/npm-cache \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:24-alpine \
  sh -lc 'npm install --no-package-lock && npm run lint && npm test && npm run build'
```

This mounts the repository into a temporary build container and writes `dist/` and `node_modules/` into the checkout. Ensure the checkout directory is writable by the current deployment user.

Validate the essential deployment files and Compose syntax:

```bash
test -f .env
test -s mosquitto/passwd
test -f nginx/nginx.conf
docker compose config -q
```

Do not publicly share the output of `docker compose config` or `.env`; resolved configuration may reveal operational details.

## 8. Configure LAN access intentionally

### Local smoke test

Keep the bind values at loopback and start the stack first. In this mode, only the server itself can access published ports.

### Access from operator computers and ESP32 nodes

When ready:
1. Assign a static private LAN IP to the server.
2. Change `FRONTEND_BIND_IP` to that exact address if operators must access the UI from other machines.
3. Change `MQTT_BIND_IP` to that exact address if edge devices need LAN access to the broker.
4. Restrict TCP 80 to the operator network and TCP 1883 to authorized nodes using the correct upstream/host firewall. Do not rely on UFW alone for Docker-published ports.
5. Configure the ESP32 MQTT broker host to the server's private IP and port 1883, and set its per-device credentials.
6. Verify each device's topic/payload contract against `mosquitto/acl` and `backend/src/mqtt/topics.js`.
7. Confirm Node 3's snapshot endpoint is reachable from operator browsers as intended by the frontend CSP and network design.

Do not route plain MQTT port 1883 directly to the public internet. Use a VPN/private network for remote maintenance.

## 9. Start Mosquitto first, then the application

After environment setup, password provisioning, build, and network-policy review, validate the Compose file and start the broker by itself first:

```bash
docker compose config -q
docker compose up -d mqtt-service
docker compose ps mqtt-service
docker compose logs --tail=100 mqtt-service
```

Confirm Mosquitto stays running and loads its password/ACL files without errors. If it exits, fix the missing password file or permissions before continuing.

Then build/start the backend, followed by the frontend:

```bash
docker compose up -d --build backend
docker compose logs --tail=150 backend
docker compose up -d --build frontend_dashboard
docker compose ps
```

The backend must become healthy before Nginx starts because Compose waits for the backend health check. Check each service's logs if any container exits:

Follow live logs if debugging:

```bash
docker compose logs -f backend mqtt-service frontend_dashboard
```

Confirm all three containers are running and the backend becomes healthy. Backend SQLite readiness does not automatically prove MQTT is connected; check MQTT separately in the readiness response and backend logs.

## 10. Safety gate before connecting live hardware

**Do not treat the current telemetry fallbacks as calibrated sensor readings or confirmed hardware state.** During this review, the current `backend/src/mqtt/mqttClient.js` implementation was found to:
- Map a boolean `smoke` field to fixed numeric values (650 or 120) when an actual `smoke_gas_level`/`smoke_gas_ppm` value is absent. These fallback numbers are not a measured, calibrated PPM concentration.
- Infer a missing fan-relay state from temperature using a 28 °C threshold, while the current frontend displays a 30 °C fan threshold.
- Default missing light and door states to `OFF` and `CLOSED`, respectively, which can be mistaken for confirmed physical states.

Before using the interface for real safety/security operations, confirm the deployed firmware schema and calibrated units. Replace these fallbacks with explicit unknown/unavailable state or verified device feedback, align the control thresholds with the approved hardware/engineering requirements, add tests for missing fields, and verify the result with physical devices in a controlled environment. Do not certify fire/smoke alarms, a closed door, or a relay position from an inferred/default value.

Keep the deployment on a private test network and restrict access to trusted operators until this review is complete. The software dashboard must not replace the independent hardwired emergency-egress mechanism or local autonomous protections.

## 11. Verify the deployment

For loopback-only smoke tests on the server:

```bash
curl -fsS http://127.0.0.1/api/health/live
curl -fsS http://127.0.0.1/api/health/ready
```

For LAN deployment, use `http://<SERVER_LAN_IP>/api/health/live` and `http://<SERVER_LAN_IP>/api/health/ready` after replacing the placeholder. The liveness response should have `ok: true`; readiness should show healthy SQLite. Check the MQTT status separately.

Then verify manually:
1. Open `http://<SERVER_LAN_IP>/` from an authorized client.
2. Log in with the initial Admin credentials and confirm the expected role.
3. Check that Viewer permissions do not allow administrative actions or hardware commands.
4. Log out and verify the old session cannot be reused.
5. Confirm broker logs show the password/ACL configuration loaded and the backend establishes an MQTT connection.
6. Confirm anonymous MQTT connections are rejected and each device identity is limited to its allowed topics.
7. Confirm real telemetry from Node 2 reaches both SQLite and the dashboard.
8. Test command acknowledgement only in a controlled/safe environment. MQTT publish success alone is not proof of physical actuation.
9. Restart only the backend and confirm persisted records remain.

Do not test emergency door unlock against live hardware as an initial smoke test.

## 12. Backup and restore

Back up the database before each upgrade and on a schedule. Copies may contain sensitive logs and operator metadata, so protect them and store a copy outside the server.

### Create a consistent SQLite backup

```bash
mkdir -p backups
BACKUP_NAME="lci_sfm_$(date -u +%Y%m%dT%H%M%SZ).db"

docker compose exec -T backend node backend/src/db/backup.js backup "/app/data/$BACKUP_NAME"
docker cp "lci_backend:/app/data/$BACKUP_NAME" "backups/$BACKUP_NAME"
chmod 600 "backups/$BACKUP_NAME"
ls -lh "backups/$BACKUP_NAME"
```

Copy backups to separate protected/encrypted storage. A backup only on the same server does not protect against loss of that host. Test restore in a non-production environment.

### Restore a backup

Restore is a maintenance operation that replaces the current database. Confirm the backup is correct, then stop backend writes:

```bash
docker compose stop backend
docker cp backups/<BACKUP_FILE>.db lci_backend:/app/data/restore-source.db
docker compose run --rm --no-deps --user root backend \
  sh -lc 'node backend/src/db/backup.js restore /app/data/restore-source.db && chown -R node:node /app/data'
docker compose up -d backend
docker compose ps
docker compose logs --tail=100 backend
```

Replace `<BACKUP_FILE>.db` with the actual backup filename. Verify readiness, login, expected records, and logs before reopening normal operations. Keep a separate known-good backup; never delete the only copy.

## 13. Updating the deployment

Before an update, review the working tree and create/copy a database backup:

```bash
cd /opt/lci-sfm
git status --short
git pull --ff-only
npm install --no-package-lock
npm run lint
npm test
npm run build
docker compose config -q
docker compose up -d --build
docker compose ps
```

Inspect changes to `.env.example`, database migrations, Compose, Nginx, MQTT ACLs, and firmware topics before deploying. Keep local `.env` and `mosquitto/passwd` private. Never run `docker compose down -v` during routine upgrades; it can delete persistent volumes.

If an update fails, capture service logs, preserve the database and backups, and roll back to a reviewed Git commit. Avoid destructive reset commands on a host with local configuration/data.

## 14. Troubleshooting

| Symptom | Checks |
|---|---|
| Compose says `.env` is missing | Copy `.env.example` to `.env`, edit it, and set mode 600. |
| Mosquitto exits immediately | Confirm `mosquitto/passwd` exists, is non-empty, readable by UID 1883, and the config paths match mounts. |
| MQTT authentication fails | Confirm `MQTT_PASSWORD` matches the `lci_backend` entry; ensure the file was not recreated with `-c` after adding accounts. |
| Backend refuses production startup | Replace default/placeholder Admin and MQTT secrets. Do not turn off validation to bypass missing secrets. |
| Backend cannot resolve `mqtt-service` | Run backend through Compose on its private network; service DNS is not a host DNS name. |
| Frontend is unavailable | Confirm `npm run build` succeeded and `dist/index.html` exists. |
| Port 80 is unreachable from LAN | Check `FRONTEND_BIND_IP`, server IP, Compose status, routing, port conflicts, and the relevant firewall path. |
| ESP32 cannot connect to MQTT | Check `MQTT_BIND_IP`, TCP 1883 filtering, device credentials, broker IP, ACLs, and firmware topic support. |
| MQTT connected but telemetry is absent | Check device publisher topic/schema, ACLs, validation logs, and actual firmware fields. |
| Backend ready but commands do not work | SQLite readiness is not MQTT/device readiness. Check MQTT connection, command lifecycle state, firmware ACK support, and observed hardware state. |
| Cookie login works but API mutation fails | Check CSRF token, same-origin URL, cookie settings, and `ALLOW_BEARER_COMPAT` consistency. |
| WebSocket authentication fails | Check the same-origin `/ws/telemetry` and `/ws/mfa` paths, cookie delivery, session validity, and logs. |
| Data disappeared after recreating services | Confirm you did not run `down -v`, inspect the `sqlite_data` volume, and verify `SQLITE_DB_PATH=/app/data/lci_sfm.db`. |

## 15. Deployment completion checklist

- [ ] Server patched with supported Docker Engine and Compose plugin.
- [ ] Actual static private server IP and client/device networks documented.
- [ ] Protected `.env` exists and all placeholders are replaced.
- [ ] `mosquitto/passwd` exists with separate credentials and safe permissions.
- [ ] Published web/MQTT ports bind only to intentionally selected interfaces.
- [ ] Firewall/router restrictions are implemented and reviewed.
- [ ] Frontend build, lint, and automated tests pass.
- [ ] Compose validation passes and all three services start.
- [ ] Backend health, SQLite readiness, and MQTT connectivity are checked separately.
- [ ] Authentication, session revocation, and Viewer/Admin boundaries are verified.
- [ ] MQTT topic ACLs and real telemetry are verified with authorized devices.
- [ ] Device acknowledgement and resulting state are checked in a safe test environment.
- [ ] Backup is copied outside the live database volume.
- [ ] Public access remains disabled unless TLS and network security have been reviewed.

## 16. Scope and limitations

- The Compose stack includes Nginx, the Node.js backend, and Mosquitto. It does not define a Python/OpenCV container or deploy ESP32 firmware.
- Physical devices must be configured for this broker, per-device credentials, and compatible topic/payload schemas.
- HTTP and MQTT are unencrypted in the current configuration; keep them within a trusted private network until TLS is implemented.
- Record actual command output and physical integration results from the target server. This guide does not mean the target host has already been configured or that physical hardware has been tested.
