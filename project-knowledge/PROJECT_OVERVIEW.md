# Project Overview — LCI-SFM (`2.0.0-rc.1`)

## 1. Executive Summary

**LCI-SFM** (*Light Current Infrastructure for Smart Facility Management*) is a **local-first, air-gapped-ready, on-premises Smart Facility Management platform** designed to monitor and manage building rooms, wired Power-over-Ethernet (PoE) edge microcontrollers (ESP32-S3), environmental sensors, relay actuators, physical access controllers, and LAN snapshot cameras over a private wired Ethernet network.

- **Repository Path:** `/opt/lci-sfm`
- **Git Remote:** `https://github.com/AbdullahNSarhan/Smart-Facility-Management-System.git` (`main` branch, commit `a44db21`)
- **Current Version:** `2.0.0-rc.1` (*Software Release Candidate*)
- **Target Topology:** `Facility → Rooms → Devices → Generic Capability Endpoints`
- **Core Runtime Stack:** Vanilla ES Modules SPA (Vite-bundled, zero CDN) + Nginx `1.27-alpine` + Node.js 24 LTS (`Express` + `ws` + built-in `node:sqlite` WAL) + Eclipse Mosquitto `2.0` MQTT broker, orchestrated via Docker Compose.

---

## 2. Project Evolution & Historical Context

Understanding the repository requires recognizing three evolutionary stages reflected in the schema migrations (`001`–`004`) and compatibility routes:

1. **Early Prototype Era (Deprecated / Pre-Repository Baseline):**
   - Originally conceived around **Node-RED** (`logic-service` on port `1880`) for visual flow automation and a single-room graduation demonstrator (Node 1 Smart Access 2-of-3 MFA, Node 2 Environmental/HVAC, Node 3 ESP32-CAM + external Python/OpenCV Vision Service).
   - **Important:** Node-RED has been **completely eliminated** from the target and implemented architecture. Several root-level reference Markdown files (`lci_sfm_docker_deployment_architecture.md`, `lci_sfm_comprehensive_workflows_system_logic.md`, `lci_sfm_ai_software_development_programming_concepts_guide.md`) still reference Node-RED and must be treated strictly as historical hardware/edge-logic context, **not** server implementation requirements.
2. **Release `1.0` / `1.1.0-rc.1` (Node.js Migration & Operations Baseline — Migrations `001`–`003`):**
   - Replaced Node-RED with a modular Node.js 24 backend (`backend/src/`), SQLite WAL persistence, `scrypt` password/PIN hashing, `HttpOnly` cookie + CSRF sessions, stateful alarms, scoped Notification Center, isolated simulator, and v1 device registry.
3. **Release `2.0.0-rc.1` (Current Multi-Room Platform — Migration `004`):**
   - Generalized the single-room demonstrator into a multi-room platform (`facilities`, `rooms`, room-scoped `device_registry`, typed `device_endpoints`, `device_endpoint_state`, and `pending_devices` quarantine).
   - Replaced single-page tab switching with a 15-route History API multi-page console (`/`, `/login`, and 13 `/app/*` views including `/app/network`).
   - Added guided Ubuntu Server installation (`install.sh`), Netplan static-IP helper, optional local HTTPS/TLS overlay, host-side Mosquitto credential provisioning CLI, and SHA-256 verified offline deployment bundles.

---

## 3. Core Architectural Principles

1. **Local-First & Air-Gapped Ready:**
   - Zero runtime dependencies on cloud APIs, external CDNs, Google Fonts, external icon libraries, or telemetry beacons.
   - Enforced by a strict Content Security Policy in `index.html` (`default-src 'self'`) and verified in Playwright E2E tests (`external_requests: 0`).
2. **Edge-First Physical Autonomy:**
   - Edge controllers (ESP32-S3 over wired PoE CAT6) execute autonomous local safety loops (e.g., local 2-of-3 MFA validation, local thermal/smoke fan activation, and hardwired series Break-Glass fail-safe magnetic lock release) even if the central server, MQTT broker, or network switch fails.
   - The central software console is an **observability, administration, audit, and bounded remote-command surface**—never a substitute for hardwired life-safety interlocks.
3. **Truthful Operational Semantics ("Evidence Over Assumptions"):**
   - Broker connectivity (`mqtt.connected`) is reported separately from device heartbeat liveness (`device.fresh`) and per-endpoint sensor freshness (`endpoint.fresh`).
   - Command dispatch tracks distinct states (`PUBLISHED` → `ACKNOWLEDGED` → `STATE_REPORTED` or `TIMED_OUT`/`FAILED`), never equating an MQTT publish with confirmed physical actuation.
   - Registering an IPv4 address in the dashboard updates the server's outbound probe/proxy target in SQLite only; it does not reconfigure an edge controller's NIC.
   - Physical credentials (`people` / `physical_credentials`) are explicitly marked `PENDING_DEVICE_SYNC` because firmware policy synchronization is not yet implemented.
4. **Same-Origin Security & Least Privilege:**
   - Browsers talk exclusively to Nginx over HTTP/HTTPS (`/api/*`, `/ws/*`), never directly to Mosquitto TCP `1883` or directly to camera LAN IPs.
   - Containers run non-root with `no-new-privileges:true`, and the backend container has no Docker socket or write access to `mosquitto/passwd`.

---

## 4. Primary Users & Roles

| Actor / Identity Domain | Storage Table | Capabilities & Boundaries |
|---|---|---|
| **Administrator (`Admin`)** | `system_users` | Full read/write console access: manage facility/rooms/devices/endpoints, approve quarantined devices, create/edit alarm rules, acknowledge/resolve alarms, dispatch allowlisted MQTT switch & legacy commands, manage dashboard operators, manage facility people & RFID/PIN credentials, run reader card enrollment, configure retention. |
| **Viewer (`Viewer`)** | `system_users` | Read-only operational monitoring across Overview, Rooms, Devices, Endpoint History, Network Topology, Alarms, Events, and Diagnostics; can manage only their own personal Notification read/unread states and critical-sound preference, and view their own Profile. Blocked on server and hidden in UI from `/app/users`, `/app/settings`, and all state-mutating Admin endpoints. |
| **Facility Person (Occupant)** | `people` + `physical_credentials` | Physical building occupant (non-console identity). Can hold masked RFID UID and scrypt-hashed 6-digit PIN records centrally (`PENDING_DEVICE_SYNC`). Cannot log into the web console. |
| **Edge Devices & Services** | `mosquitto/passwd` + `device_registry` | Authenticate to Mosquitto using unique per-device credentials (`lci_backend`, `node1_access`, `node2_env`, `vision_service`, or `%u` = immutable `device_id` for `MQTT_V1` nodes). |

---

## 5. Current Project Status (`2.0.0-rc.1`)

### Verified & Working (Software Layer)
- **Live Stack on Host (`/opt/lci-sfm`):** Currently deployed and running via Docker Compose on Ubuntu 26.04.1 LTS (`lci_frontend`, `lci_backend`, `lci_mqtt_broker`), bound to `127.0.0.1:80` and `127.0.0.1:1883`, with `GET /api/health/live` and `GET /api/health/ready` returning HTTP `200` (`status: "ready"`, SQLite WAL + FK enabled, all 4 migrations applied, MQTT connected with all 10 topic subscriptions active).
- **Automated Verification:** 65 backend/integration tests (`backend/test/*.test.js`), JavaScript syntax lint checks across 45+ modules (`npm run lint`), Vite production bundle (`dist/`), Playwright multi-route air-gap UI suite (`scripts/ui-release-smoke.mjs`), and 20-room/100-device/10,000-frame scale benchmark (`scripts/load-test.mjs`).

### Pending / Incomplete (Hardware & Integration Boundaries)
- **Physical Edge Firmware & Hardware Commissioning:** ESP32-S3 firmware (`node1`, `env_02`, `node3` and `MQTT_V1` custom nodes) is external to this repo and has not yet completed physical bench/on-site acceptance.
- **Device Credential Policy Sync:** Central RFID/PIN assignments, suspensions, blocks, and revocations remain `PENDING_DEVICE_SYNC` in SQLite; no MQTT/HTTP sync protocol pushes credential whitelists to Node 1 EEPROM yet.
- **Python/OpenCV Biometric Vision Service:** Referenced in `mosquitto/acl` (`vision_service`) and subscribed on `lecf/access/mfa_face`, but no Vision container or source code is included in this repository.
- **Known Software Bugs & Debt Identified in Onboarding:** Several high/medium software bugs were discovered during code inspection (e.g., unverified `currentPassword` in Admin credential rotation, broken credential revoke/masking UI in `/app/users`, unignored `mosquitto/provisioned-credentials/` secret directory, and synchronous N+1 SQLite queries in the 1-second `tick()` loop). See `TECHNICAL_DEBT_AND_ISSUES.md` for full evidence.
