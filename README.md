# LCI-SFM — Smart Facility Management System

LCI-SFM (Light Current Infrastructure for Smart Facility Management) is an edge-first facility monitoring and access-control project. Its operator dashboard brings together environmental telemetry, smart access, biometric camera status, event logs, endpoint configuration, and diagnostics for a local wired network.

The frontend is an air-gapped-friendly static web application built with HTML, CSS, and vanilla JavaScript ES modules. It communicates with a Node-RED HTTP API and WebSocket streams; the frontend does not replace the backend, database, or edge-controller firmware.

## Main capabilities

- **Operations overview:** facility status, recent events, telemetry cards, and device topology.
- **Smart access:** door and lock state, three-factor checkpoints for the documented 2-out-of-3 MFA flow, and biometric snapshot status.
- **Environment:** temperature, humidity, smoke/gas readings, live trend charts, stored telemetry history, and fan/light control.
- **Events and audit:** SQLite-backed access, camera, environment, and system-error tables with client-side search, time/severity filters, sorting, pagination, record inspection, and CSV export.
- **Diagnostics:** separate evidence-based status for the central service and individual edge nodes.
- **Administration:** user provisioning and role management, administrator credential changes, and server/node endpoint configuration, subject to a verified Admin session.
- **Operator experience:** dark/light themes, responsive navigation, confirmation dialogs for consequential actions, and accessible status messaging.

## Architecture at a glance

```text
Browser / Frontend (index.html + styles.css + app.js)
    |-- HTTP API: login, logs, commands, user administration
    |-- WebSocket: /ws/telemetry
    |-- WebSocket: /ws/mfa
    |
    v
Node-RED API and flow logic ---- SQLite
    |
    +---- MQTT broker <---- wired Ethernet edge controllers
    |
    +---- Python/OpenCV biometric service <---- Node 3 camera snapshots

Node 1: smart access / RFID / keypad / magnetic lock
Node 2: environmental sensors / fan and auxiliary-light relays
Node 3: PIR-triggered OV2640 camera / biometric capture
```

The diagram shows the intended system relationships described by the architecture documents. The current `docker-compose.yml` starts **only the Nginx frontend container**; it does not deploy Node-RED, Mosquitto, SQLite, the Python vision service, or ESP32 firmware.

## Quick start — development

Requirements: a supported Node.js/npm installation and access to a reachable Node-RED backend for live features.

```bash
git clone https://github.com/AbdullahNSarhan/Smart-Facility-Management-System.git
cd Smart-Facility-Management-System
npm install
npm run dev
```

Vite serves the frontend on port **3000** (the script binds to `0.0.0.0`). Open the URL printed by Vite. If accessing from another machine, ensure the workstation/server firewall permits the port and that the browser can reach the configured backend and device endpoints.

Useful checks:

```bash
npm run lint       # JavaScript syntax check (node --check app.js)
npm run build      # Production static bundle in dist/
npm run preview    # Preview the production build locally
```

## Run the current Nginx container

The supplied Compose file exposes port 80 and mounts the repository root read-only into Nginx's document root:

```bash
docker compose up -d
docker compose ps
docker compose logs -f frontend_dashboard
docker compose down
```

**Deployment note:** because the current Compose volume mounts the repository root, files other than the three frontend assets may also be served as static files. Before using this configuration in a real facility, change the Nginx mount/configuration to expose only intended public frontend assets. This Compose file is frontend-only.

## Default local endpoints

The frontend currently defaults to these local-network addresses. They are configurable in the login endpoint disclosure and in the administrator endpoint settings.

| Component | Default |
|---|---|
| Node-RED HTTP API | `http://192.168.43.225:1880` |
| Telemetry WebSocket | `ws://192.168.43.225:1880/ws/telemetry` |
| MFA WebSocket | `ws://192.168.43.225:1880/ws/mfa` |
| Node 1 — smart access | `192.168.43.11` |
| Node 2 — environment | `192.168.43.12` |
| Node 3 — biometric camera | `192.168.43.13` |
| Node 3 snapshot | `http://192.168.43.13/capture.jpg` |

These are example defaults, not evidence that the endpoints are reachable on your network. Configure the actual addresses for the local installation.

## Documentation

- [Frontend Documentation](docs/FRONTEND_DOCUMENTATION.md) — views, operator workflows, authentication behavior, endpoint contracts, telemetry fields, deployment, validation, and known limitations.
- [Hardware & Embedded Systems Architecture](hardware_embedded_systems_architecture_reference_lci_sfm.md)
- [Programming & Software Concepts Guide](lci_sfm_ai_software_development_programming_concepts_guide.md)
- [System Workflows & Logic](lci_sfm_comprehensive_workflows_system_logic.md)
- [Docker Deployment Architecture](lci_sfm_docker_deployment_architecture.md)

## Important security and safety notes

- Keep this dashboard on the intended isolated local network. The default configuration uses plain HTTP and WebSocket (`http://`, `ws://`); an air-gapped design is not, by itself, encryption or authentication.
- Server-side authorization must validate every command and administrative API request. Hiding or disabling a browser button is not an authorization boundary.
- Hardware actions affect physical access-control and actuator systems. Confirm the backend acknowledgement and independently verify the controller/hardware state when required by operating procedures.
- When the authentication service is unreachable, the frontend offers an explicitly unverified, read-only inspection mode. It must not be used to authorize privileged actions.
- The UI displays an explicit dependency notice for multi-day time-bucketed telemetry because the current API contract does not implement the required aggregation endpoint.
- Do not expose password or PIN values, hashes, session tokens, biometric data, or other credentials in logs, browser storage, CSV exports, or unauthenticated API responses.

See the frontend documentation for the backend API contract the dashboard expects and the features that still require backend implementation.
