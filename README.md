# LCI-SFM — Smart Facility Management System

LCI-SFM (Light Current Infrastructure for Smart Facility Management) is an edge-first facility monitoring and access-control project. Its operator dashboard brings together environmental telemetry, smart access, biometric camera status, event logs, endpoint configuration, and diagnostics for a local wired network.

The frontend is an air-gapped-friendly static web application built with HTML, CSS, and vanilla JavaScript ES modules. It communicates with the Node.js Central Backend HTTP API (`/api/*`) and WebSocket streams (`/ws/telemetry`, `/ws/mfa`), backed by SQLite (WAL) and Eclipse Mosquitto MQTT; the frontend does not replace the backend, database, or edge-controller firmware.

## Main capabilities

- **Operations overview:** facility status, recent events, telemetry cards, and device topology.
- **Smart access:** door and lock state, three-factor checkpoints for the documented 2-out-of-3 MFA flow, and biometric snapshot status.
- **Environment:** temperature, humidity, smoke/gas readings, live trend charts, stored telemetry history, and fan/light control.
- **Events and audit:** SQLite-backed access, camera, environment, and system-error tables with client-side search, time/severity filters, sorting, pagination, record inspection, and CSV export.
- **Diagnostics:** separate evidence-based status for the central service (`/api/health/ready` SQLite/MQTT readiness) and individual edge nodes.
- **Administration:** user provisioning and role management, administrator credential changes, and server/node endpoint configuration, subject to a verified Admin session.
- **Operator experience:** dark/light themes, responsive navigation, confirmation dialogs for consequential actions, progressive disclosure of technical metadata, and accessible status messaging.

## Architecture at a glance

```text
Browser / Frontend (index.html + styles.css + app.js)
    |-- Same-origin HTTP API (/api/*) & WebSockets (/ws/telemetry, /ws/mfa)
    v
Nginx Reverse Proxy (nginx/nginx.conf, mounts compiled ./dist only)
    |
    v
Node.js Central Backend (backend/src/server.js) ---- SQLite WAL (data/lci_sfm.db)
    |                                                   |-- system_users (scrypt hashes)
    |                                                   |-- sessions (SHA-256 verifiers + CSRF)
    |                                                   |-- access_logs, camera_events
    |                                                   |-- environmental_telemetry, command_audit
    +---- Eclipse Mosquitto 2.0 (mosquitto/mosquitto.conf + ACL) <---- Wired Ethernet Edge Nodes
    |
    +---- Python/OpenCV Biometric Service <---- Node 3 Camera Snapshots

Node 1: smart access / RFID / keypad / magnetic lock
Node 2: environmental sensors / fan and auxiliary-light relays
Node 3: PIR-triggered OV2640 camera / biometric capture
```

## Quick start — development & testing

Requirements: Node.js 22.5+ / 24 LTS (uses built-in `node:sqlite` and `crypto.scrypt`).

```bash
git clone https://github.com/AbdullahNSarhan/Smart-Facility-Management-System.git
cd Smart-Facility-Management-System
npm ci
npm run dev
```

`npm run dev` starts the unified Node.js Express + WebSocket + SQLite backend on port **3000** (`0.0.0.0`) with Vite middleware mounted for same-origin frontend operation. For a fresh development setup, do not copy the production `.env.example` first; its production secret checks intentionally require real credentials. Development mode has a local-only bootstrap credential configured by the code. Never use development credentials in production.

### Validation, Testing & Database Operations

```bash
npm test           # Run the 21-test full-stack & backend integration suite (Auth, CSRF, RBAC, SQLite, MQTT, WS, Commands, Readiness, DOM & Contracts)
npm run lint       # Verify syntax across frontend and backend ES modules
npm run build      # Build production static frontend bundle into dist/
npm run db:backup  # Perform online SQLite hot backup via VACUUM INTO
npm run db:restore # Restore SQLite database after PRAGMA integrity_check verification
```

## Production Docker Compose Deployment

The `docker-compose.yml` orchestrates three hardened services on an internal bridge network (`lci_internal_net`):
1. **`frontend_dashboard` (`nginx:alpine`)**: Mounts **only** compiled `./dist` assets (never the repository root) and reverse-proxies `/api/*` and `/ws/*` to `http://backend:3000`.
2. **`backend` (`node:24-alpine`)**: Runs as non-root `node` user, applies SQLite migrations at `/app/data/lci_sfm.db` (persistent `sqlite_data` volume), and connects a singleton MQTT client to `mqtt-service`.
3. **`mqtt-service` (`eclipse-mosquitto:2.0`)**: Enforces `allow_anonymous false`, password authentication (`mosquitto/passwd`), and per-identity topic ACLs (`mosquitto/acl`).

```bash
# 1. Build static frontend assets into ./dist
npm run build

# 2. Create the production environment file, then edit every placeholder/secret
cp .env.example .env
chmod 600 .env
nano .env

# 3. Generate mosquitto/passwd interactively (see mosquitto/README.md)
# Do this before starting the broker. Set .env MQTT_PASSWORD to the same lci_backend password.

# 4. Start the broker first, then the application
docker compose config -q
docker compose up -d mqtt-service
docker compose logs --tail=100 mqtt-service
docker compose up -d --build backend
docker compose up -d --build frontend_dashboard
docker compose ps
```

For the complete server preparation, private-LAN binding, firewall, verification, backup/restore, and update process, follow [Deployment Guide](docs/DEPLOYMENT_GUIDE.md). The example bind IPs default to `127.0.0.1`; change them to the server's actual static private LAN IP only when LAN access is required and firewall rules are in place.

## Automated Ubuntu Server Deployment

For a fresh Ubuntu Server on a trusted private LAN, the repository includes `install.sh` and `update.sh`. The installer installs missing host prerequisites, clones this repository to `/opt/lci-sfm`, generates local production secrets and Mosquitto credentials, runs frontend lint/tests/build inside Node.js 24, validates Compose, and starts the services. It preserves an existing `.env` and Mosquitto password file on reruns.

Run the installer from the server:

```bash
curl -fsSL https://raw.githubusercontent.com/AbdullahNSarhan/Smart-Facility-Management-System/main/install.sh | sudo bash
```

The generated administrator and MQTT credentials are stored in root-protected local files under `/opt/lci-sfm`; keep them private and provision device credentials securely. The dashboard URL is printed at the end of installation. MQTT remains bound to loopback by default until LAN device access is deliberately configured.

Update later with:

```bash
sudo /opt/lci-sfm/update.sh
```

The update script refuses a dirty Git checkout, backs up SQLite when the backend is running, fast-forwards the current branch, reruns validation/build, and rebuilds the Compose stack without deleting persistent volumes. Review `docs/DEPLOYMENT_GUIDE.md` before connecting physical hardware. The current HTTP/MQTT configuration is intended only for a trusted private network, not public internet exposure.

## Default endpoints

When served behind Nginx or `npm run dev`, the frontend automatically targets the same-origin host (`window.location.host`) while allowing field engineers to override the target gateway or edge node IPs in the UI.

| Component | Default |
|---|---|
| Same-Origin / Gateway HTTP API | `http://<host>/api/*` (or `http://192.168.43.225:1880`) |
| Telemetry WebSocket | `ws://<host>/ws/telemetry` |
| MFA WebSocket | `ws://<host>/ws/mfa` |
| Node 1 — smart access | `192.168.43.11` |
| Node 2 — environment | `192.168.43.12` |
| Node 3 — biometric camera | `192.168.43.13` |
| Node 3 snapshot | `http://192.168.43.13/capture.jpg` |

## Documentation

- [Implementation Plan & Contract Matrix](docs/IMPLEMENTATION_PLAN_AND_MATRIX.md) — verified vs. proposed topic registry, route matrix, and runtime architecture notes.
- [Frontend Documentation](docs/FRONTEND_DOCUMENTATION.md) — views, operator workflows, authentication behavior, endpoint contracts, telemetry fields, deployment, validation, and known limitations.
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) — prepare Ubuntu, install Docker, configure production secrets, provision Mosquitto credentials, deploy the stack, verify it, and back up/restore SQLite.
- [Backend Architecture](docs/BACKEND_ARCHITECTURE.md) — Node.js, Mosquitto/MQTT, SQLite, WebSockets, authentication, command lifecycle, security, deployment, and open firmware dependencies.
- [Mosquitto Broker & ACL Guide](mosquitto/README.md) — provisioning per-node broker credentials and least-privilege topic ACLs.
- [Hardware & Embedded Systems Architecture](hardware_embedded_systems_architecture_reference_lci_sfm.md)
- [Programming & Software Concepts Guide](lci_sfm_ai_software_development_programming_concepts_guide.md)
- [System Workflows & Logic](lci_sfm_comprehensive_workflows_system_logic.md)
- [Docker Deployment Architecture](lci_sfm_docker_deployment_architecture.md)

