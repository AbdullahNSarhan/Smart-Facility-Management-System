# LCI-SFM Full-Stack Productization & Release Plan

This plan details the end-to-end engineering, security hardening, contract integration, dependency reproducibility, automated verification, and documentation synchronization required to bring the **Light Current Infrastructure for Smart Facility Management (LCI-SFM)** system to a release-ready state.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and release-engineering decisions were confirmed during Phase 1 and govern execution across the stack:

- **Confirmed Decision 1 — Reproducible npm Lockfile Strategy**: Standardize on `npm` across the workspace root and backend service with committed lockfiles (`package-lock.json` in both the root and backend service), removing orphaned Bun lockfile artifacts so local builds, container builds, CI pipelines, and field installer/updater scripts all execute deterministically with `npm ci`.
- **Confirmed Decision 2 — Lean Production Dependency Tree**: Remove unused template dependencies (React, Lucide, Motion, Tailwind, and unused AI SDK packages) from the workspace manifest while retaining all required runtime, build, and test dependencies (Express, WebSocket, MQTT, Zod, dotenv, Vite, and Supertest).
- **Confirmed Decision 3 — Container Liveness vs. Operational Readiness**: Configure container health checks to probe `/api/health/live` so the reverse proxy and container orchestrator start reliably even when the MQTT broker is restarting, while preserving `/api/health/ready` for operational readiness checks, installer/updater gates, and the System Health & Diagnostics console view.

---

## 1. Overview & Core Concept

- **What It Does**: LCI-SFM is an air-gapped-ready Building Management System (BMS) and Human-Machine Interface (HMI) operations console and backend coordinator. It unifies smart door access and 2-out-of-3 multi-factor authentication (Node 1), environmental telemetry and HVAC/lighting actuation (Node 2), PIR-triggered optical camera capture (Node 3), SQLite audit persistence, and role-based operator administration.
- **Target Audience / Persona**: Facility security operators (Viewer role) who monitor real-time telemetry, access events, and system alarms, and privileged facility engineers (Admin role) who dispatch hardware overrides, provision credentials, and configure network endpoints.
- **Key Value**: Delivers honest, evidence-backed facility monitoring and actuation without cloud dependencies—strictly separating central API liveness, SQLite/MQTT readiness, WebSocket stream connectivity, and per-node hardware evidence so operators never mistake unverified or stale states for healthy hardware.

---

## 2. Design, Layout & Aesthetic Direction

- **Domain & Aesthetic Persona**: Industrial BMS / HMI Operations Console & Enterprise Monitoring Dashboard.
- **Color Palette**:
  - **Dark Theme (Default)**: Canvas `#090e17`, Sidebar `#0d1422`, Elevated Surface `#0c1320`, Card `#111a2b`, Hairline Border `#1e293b`, Primary Text `#f1f5f9`, Muted Text `#94a3b8`.
  - **Light Theme**: Canvas `#f1f5f9`, Card/Sidebar `#ffffff`, Hairline Border `#cbd5e1`, Primary Text `#0f172a`, Muted Text `#475569`.
  - **Semantic Status Tokens**: Interactive Accent `#38bdf8` (`#0284c7` in light mode), Confirmed Nominal `#10b981` (`#059669`), Warning/Stale/Override `#f59e0b` (`#d97706`), Critical/Offline `#f43f5e` (`#e11d48`), Unknown/Standby `#94a3b8`.
- **Typography**:
  - **UI & Navigation**: Clean system sans-serif stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) for zero-latency air-gapped rendering at `12px–16px` density.
  - **Telemetry, Timestamps, IPs & Identifiers**: Strictly enforced tabular monospace (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` with `font-variant-numeric: tabular-nums`) so live counters, gauges, and table columns never jitter on update.
- **Layout, Spatial Architecture & Functional Flows**:
  - **Workspace Shell**: Collapsible fixed sidebar (`248px` expanded / `68px` icon-rail on desktop; slide-over drawer with backdrop on viewports $\le 960\text{px}$) paired with a top context bar (operator identity, verification status, telemetry freshness indicator, live digital clock, fullscreen toggle, and theme switcher) and a 6-view main viewport.
  - **Progressive Disclosure Discipline**: Cards lead with operational state, numeric readings, and primary controls; secondary implementation details (REST paths, SQLite table names, MQTT topics, and read-only alarm lifecycle notes) reside inside compact collapsible disclosure panels (`<details class="tech-disclosure">`) and View 5 diagnostics.
  - **Standardized Inline Iconography**: Shared `24x24` inline SVG symbol sprite (`#icon-brand-emblem` and operational symbols) rendered at `16px`, `18px`, `20px`, and `24px` with explicit text labels alongside every critical status and actuator control.

---

## 3. Functional Architecture & System Design

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                   OPERATOR BROWSER (Vanilla ES6 + HTML/CSS)                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ Auth & RBAC  │ │ Live FIFO &  │ │ SQLite Audit │ │ Endpoint & Host   │  │
│  │ Session Gate │ │ Rollup Chart │ │ Explorer/CSV │ │ Auto-Migration    │  │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └─────────┬─────────┘  │
└─────────┼────────────────┼────────────────┼───────────────────┼────────────┘
          │ Same-Origin    │ /ws/telemetry  │ /api/logs/:table  │ Direct LAN
          │ /api/auth/*    │ /ws/mfa        │ /api/command      │ HTTP GET
          ▼                ▼                ▼                   │
┌──────────────────────────────────────────────────────────┐    │
│           NGINX REVERSE PROXY (Static dist/ Only)        │    │
│     Forwards /api/* and /ws/* with Upgrade & Headers     │    │
└─────────────────────────────┬────────────────────────────┘    │
                              │ Internal Bridge Network         │
                              ▼                                 │
┌──────────────────────────────────────────────────────────┐    │
│        NODE.JS CENTRAL BACKEND (Express + WS + Zod)      │    │
│  ┌────────────────────────┐  ┌────────────────────────┐  │    │
│  │ Auth, Session & CSRF   │  │ Command Coordinator &  │  │    │
│  │ Middleware (scrypt)    │  │ Lifecycle State Engine │  │    │
│  └───────────┬────────────┘  └───────────┬────────────┘  │    │
│              ▼                           ▼               │    │
│  ┌────────────────────────┐  ┌────────────────────────┐  │    │
│  │ SQLite WAL Repository  │  │ Singleton MQTT Client  │  │    │
│  │ Migrations & Hot Backup│  │ Topic Validation & ACL │  │    │
│  └────────────────────────┘  └───────────┬────────────┘  │    │
└──────────────────────────────────────────┼───────────────┘    │
                                           │ MQTT (Port 1883)   │
                                           ▼                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│               ECLIPSE MOSQUITTO 2.0 BROKER & LAN EDGE NODES                │
│  ┌──────────────────────┐ ┌──────────────────────┐ ┌────────────────────┐  │
│  │ Node 1 (192.168.43.11)│ │ Node 2 (192.168.43.12)│ │Node 3 (192.168.43.13│  │
│  │ Smart Access & 2/3 MFA│ │ Temp/Hum/MQ-2 & HVAC │ │PIR OV2640 Snapshot │  │
│  └──────────────────────┘ └──────────────────────┘ └────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Core Technical Execution Pillars

1. **Frontend–Backend Readiness & Diagnostics Contract Alignment**:
   - Align the frontend's `/api/health/ready` parser in View 5 (`probeBackendReadiness()`) with the backend's actual JSON payload (`{ ok, status, sqlite: { ok, journalMode }, mqtt: { enabled, connected }, websocket: { totalClients } }`) so `#diag-ready-state` accurately reports SQLite WAL health and MQTT broker connection state rather than falling back to `"unknown"`.
   - Preserve all 238 original DOM IDs, supplementary host-reset/diagnostic IDs, and exported state bindings (`window.LCI_STATE` and module exports).

2. **Safe Legacy-Host Migration & Same-Origin Operation**:
   - Default `server_host` to `window.location.host` when served over HTTP/HTTPS.
   - Auto-migrate `localStorage.lci_server_host` **only** when it equals the exact legacy Node-RED value (`192.168.43.225:1880`) and the page is served from a different host, preserving custom gateways and independent edge-node IPs (`192.168.43.11`, `192.168.43.12`, `192.168.43.13`).
   - Ensure dynamic Content Security Policy and CORS/origin rules support same-origin requests and local LAN camera snapshots (`http://<ip_node3>/capture.jpg`).

3. **Dependency Pruning & Reproducible Lockfile Generation**:
   - Prune unused frontend template packages from the workspace manifest, synchronize package versions between the root manifest and backend manifest, generate committed `package-lock.json` files in both locations, and remove the unused `bun.lock` file.
   - Verify clean `npm ci` execution and zero high/critical dependency vulnerabilities via `npm audit`.

4. **Container, Proxy & Script Hardening**:
   - Update the Docker Compose backend health check to probe `/api/health/live` via Node's native `fetch` (matching the backend container's `HEALTHCHECK` and avoiding external `wget` assumptions), while `install.sh`, `update.sh`, and CI continue to verify `/api/health/ready` for full stack readiness.
   - Verify executable permissions (`100755`) and `bash -n` syntax on `install.sh` and `update.sh`.

5. **Comprehensive Automated Test Suite & Release Gate Verification**:
   - Expand automated testing to verify:
     - Backend API routes, `scrypt` authentication, `HttpOnly` cookie sessions, session revocation/expiry, CSRF protection, Viewer vs. Admin RBAC, SQL injection table allowlisting, WebSocket authentication, MQTT payload validation, command lifecycle correlation, and SQLite hot backup/restore integrity.
     - Frontend DOM ID parity, selector completeness, `LocalFIFOChart` state management, input sanitization/validation helpers, legacy host auto-migration vs. custom host preservation, and `/api/health/ready` diagnostics parsing.
   - Synchronize operator and deployment documentation with the verified implementation and produce a complete Release Gate checklist classifying every verification item (`PASS`, `FAIL`, `BLOCKED`, or `NOT TESTED` with exact manual reproduction steps for any environment-restricted hardware/daemon checks).
