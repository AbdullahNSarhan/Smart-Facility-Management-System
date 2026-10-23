# LCI-SFM — Final Release Hardening & Operational Readiness Verification

This release-hardening update finalizes the LCI-SFM Smart Facility Management System by enforcing a strict liveness vs. readiness contract across the backend, frontend diagnostics, and deployment scripts, while synchronizing all operational documentation and regression tests with the production stack.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and release-verification policies were confirmed during interactive clarification and govern this implementation:

- **Confirmed Decision 1 — Readiness Policy for Disabled vs. Enabled MQTT**: When `MQTT_ENABLED=true`, `GET /api/health/ready` requires both a healthy SQLite database and an active MQTT broker connection (`connected: true`) to return HTTP `200` (`ok: true`, `status: "ready"`). If SQLite is unhealthy or an enabled MQTT broker is disconnected, `/api/health/ready` returns HTTP `503` (`ok: false`, `status: "degraded"`). When `MQTT_ENABLED=false` (intentionally disabled), `/api/health/ready` returns HTTP `200` (`ok: true`, `status: "ready"`) as long as SQLite is healthy, while explicitly reporting MQTT state as `"standby"` (`enabled: false`, `connected: false`, `state: "standby"`).
- **Confirmed Decision 2 — Installer & Updater Readiness Verification**: Both the initial installer and the guarded updater poll `/api/health/ready` with a bounded retry loop and timeout to confirm full operational readiness (SQLite + MQTT broker connectivity), while container-level health checks remain on `/api/health/live` so temporary broker restarts never block the reverse proxy container from starting.
- **Confirmed Decision 3 — Documentation & LAN Verification Alignment**: Operational documentation is updated to reflect the implemented Node.js/Express + SQLite + Mosquitto architecture, server-computed telemetry rollups, and `FRONTEND_BIND_IP`-aware manual health-check commands (distinguishing `127.0.0.1` loopback smoke tests from LAN IP verification), while preserving clearly labeled historical context.

---

## 1. Overview & Core Concept

- **What It Does**: Provides an air-gapped-ready Building Management System (BMS) and Human-Machine Interface (HMI) operations console with verified server-side session authentication, role-based access control, environmental telemetry monitoring, 2-out-of-3 multi-factor access tracking, audited hardware command dispatch, and deterministic health/readiness reporting.
- **Target Audience / Persona**: Facility operators, security administrators, and DevOps/site reliability engineers deploying and maintaining the LCI-SFM appliance on a private LAN.
- **Key Value**: Eliminates false-positive "ready" signals during MQTT broker outages, guarantees safe post-deployment verification in automated install/update workflows, and ensures documentation and manual verification steps match real network bindings.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **System Health & Readiness Inspection (View 5)**: Operators open View 5 to inspect Central Appliance diagnostics. The **Backend Readiness (`/api/health/ready`)** row displays the structured readiness summary (`OK (WAL) · MQTT: Connected`, `OK (WAL) · MQTT: Standby`, or `DEGRADED — SQLite: OK (WAL) · MQTT: Disconnected`) alongside live WebSocket and per-node evidence indicators.
  2. **Historical Telemetry Rollup (View 3)**: Operators toggle between the live 30-sample FIFO buffer, raw SQLite records, and server-aggregated 24-hour / 7-day rollups (`15m` or `1h` buckets) with explicit sample counts and min/max/average series.
  3. **Guarded Deployment & Upgrade Flow**: Site engineers run the installer or updater; the workflow validates the candidate build in an isolated worktree, creates a verified SQLite backup, brings up Mosquitto, the backend, and Nginx, and polls `/api/health/ready` with actionable diagnostic logs on timeout while preserving the previous release and database backup if readiness fails.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Utilitarian enterprise BMS/HMI control-room console with high-contrast legibility and zero external CDN dependencies.
  - *Color Palette & Mood*: 60% deep slate canvas (`#090e17` dark / `#f1f5f9` light), 30% structural slate panels (`#111a2b` / `#ffffff`) with `1px` hairline borders (`#1e293b`), and 10% semantic status accents (`#38bdf8` primary cyan, `#10b981` nominal emerald, `#f59e0b` warning amber, `#f43f5e` critical rose).
  - *Typography & Hierarchy*: Clean system UI geometric sans-serif headings paired with `tabular-nums` monospace numerals (`JetBrains Mono` / `IBM Plex Mono` / `ui-monospace`) across all telemetry cards, timers, readiness indicators, and SQLite audit tables.
  - *Component Styling & Layout*: Full-viewport 1440px desktop sidebar + top-bar shell with single-elevation cards, collapsible progressive-disclosure blocks for secondary endpoint metadata, and explicit text labels accompanying every semantic color state.
- **Interactive Feedback & Motion**: Immediate (<150ms) state transitions on view switches and filter tabs, 1.5-second anti-spam button spinners on hardware commands, and dismissible toast notifications with a bulk clear action.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Strict Separation of `/api/health/live` vs. `/api/health/ready`**
  - *Chosen Approach*: Keep `/api/health/live` as a lightweight process liveness probe (HTTP `200` whenever the Node.js event loop is responsive, independent of MQTT), and make `/api/health/ready` evaluate both SQLite health (`dbCheck.ok`) and MQTT operational state (`!mqttStatus.enabled || mqttStatus.connected`).
  - *Why*: Using `/api/health/live` for the Docker container health check allows the Nginx frontend container to start and serve the operator UI even if the MQTT broker is temporarily restarting, while `/api/health/ready` gives operators, CI, and deployment scripts an authoritative operational readiness signal.
  - *Alternatives Considered*: Using `/api/health/ready` for the Docker container health check was rejected because a transient broker outage would mark the backend container unhealthy and block Nginx from starting.
- **Decision 2 — Explicit `state` Field on MQTT Health Payload**
  - *Chosen Approach*: Include an explicit `state` property (`"connected"`, `"disconnected"`, or `"standby"`) in `mqttService.getHealthStatus()` and `/api/health/ready` so consumers never confuse an intentionally disabled broker (`MQTT_ENABLED=false`) with a broken connection.
  - *Why*: Supports both air-gapped production deployments (where MQTT is enabled and mandatory for readiness) and isolated test/standby environments without fabricating connectivity.
  - *Alternatives Considered*: Returning HTTP `503` when `MQTT_ENABLED=false` was rejected because it breaks intentional offline/test configurations where MQTT is disabled by design.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                     Operator Browser (BMS/HMI Console)                     │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │ View 1-3: Telemetry  │  │ View 4: SQLite Audit │  │ View 5: Readiness│  │
│  │ & Rollup Charts      │  │ Explorer & CSV       │  │ & Node Evidence  │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬─────────┘  │
└─────────────┼─────────────────────────┼───────────────────────┼────────────┘
              │ HTTP /api/* + WS /ws/*  │                       │ GET /api/health/ready
              ▼                         ▼                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│             Nginx Reverse Proxy (Bound to FRONTEND_BIND_IP:80)             │
│         Serves compiled static bundle & proxies /api/* and /ws/*           │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                   Node.js Central Backend (Port 3000)                      │
│  ┌────────────────────────────────────┐  ┌──────────────────────────────┐  │
│  │ GET /api/health/live               │  │ GET /api/health/ready        │  │
│  │ Always 200 OK while process alive  │  │ Checks SQLite + MQTT Policy  │  │
│  │ Used by Docker container health    │  │ Used by View 5, CI & Scripts │  │
│  └────────────────────────────────────┘  └──────┬────────────────┬──────┘  │
└─────────────────────────────────────────────────┼────────────────┼─────────┘
                                                  │                │
                              SQLite WAL Health   │                │ MQTT Broker State
                                                  ▼                ▼
                                      ┌──────────────────┐  ┌──────────────────┐
                                      │ SQLite Database  │  │ Mosquitto Broker │
                                      │ (WAL + FK=ON)    │  │ (Port 1883 ACLs) │
                                      └──────────────────┘  └──────────────────┘
```

### Data Model & State

- **Readiness Response Envelope (`GET /api/health/ready`)**:
  - `ok` (`boolean`): `true` when `sqlite.ok === true` AND (`mqtt.enabled === false` OR `mqtt.connected === true`); otherwise `false` (HTTP `503`).
  - `status` (`"ready" | "degraded"`): Overall operational status string.
  - `sqlite` (`{ ok: boolean, journal_mode: string, foreign_keys: number }`): Live SQLite pragma verification.
  - `mqtt` (`{ enabled: boolean, connected: boolean, state: "connected" | "disconnected" | "standby", broker_url: string, last_activity_at: string | null, observed_nodes: object }`): Truthful broker state.
  - `websocket` (`{ totalClients: number, telemetryClients: number, mfaClients: number }`): Active authenticated WebSocket connection counts.

### Interactive Component & State Mapping

- **View 5 Readiness Probe (`probeBackendReadiness` & `formatReadinessSummary`)**:
  - Fetches `GET /api/health/ready` and parses both HTTP `200` and HTTP `503` JSON payloads.
  - Maps `data.ok`, `data.sqlite`, and `data.mqtt` into a concise, unambiguous diagnostic string in `#diag-ready-state` (e.g., `SQLite: OK (WAL) · MQTT: Connected`, `SQLite: OK (WAL) · MQTT: Standby`, or `DEGRADED — SQLite: OK (WAL) · MQTT: Disconnected`).
- **Installer & Updater Readiness Gate**:
  - Both scripts poll `http://127.0.0.1:3000/api/health/ready` inside the backend container (and verify HTTP reachability through `http://$FRONTEND_BIND_IP/api/health/ready`) across a bounded retry window before declaring deployment success.
  - If readiness fails to converge within the timeout window, the scripts dump recent `backend` and `mqtt-service` logs, preserve the pre-update SQLite backup and previous release artifacts, and exit non-zero.
- **Automated Regression Suite**:
  - Verifies four distinct readiness/liveness states:
    1. `MQTT_ENABLED=false` + healthy SQLite → `/api/health/ready` returns `200` with `mqtt.state === "standby"`.
    2. `MQTT_ENABLED=true` + MQTT connected + healthy SQLite → `/api/health/ready` returns `200` with `mqtt.state === "connected"`.
    3. `MQTT_ENABLED=true` + MQTT disconnected + healthy SQLite → `/api/health/ready` returns `503` with `ok: false`, `status: "degraded"`, `mqtt.state === "disconnected"`, while `/api/health/live` still returns `200`.
    4. SQLite failure (`db.healthCheck()` returning `{ ok: false }`) → `/api/health/ready` returns `503` with `ok: false`, `status: "degraded"`.
