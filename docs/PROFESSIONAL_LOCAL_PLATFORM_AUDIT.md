# LCI-SFM 2.0 — Professional Local Platform Audit

**Release:** `2.0.0-rc.1`  
**Audit Scope:** Transition from single-room graduation demonstrator (`1.1.0-rc.1`) to dynamic multi-room, local-first, air-gapped smart facility management platform.

---

## 1. Non-Negotiable Architecture Principles Verification

| Principle | Implementation Status | Evidence in Repository |
|---|---|---|
| **Local-First** | Verified | All persistence in local SQLite WAL (`/app/data/lci_sfm.db`), local Mosquitto broker, same-origin API/WebSocket proxy. |
| **Edge-First Autonomy** | Verified | Server never overrides hardwired local safety interlocks or emergency egress; commands carry explicit `expires_at` and correlated ACKs. |
| **Air-Gapped-Ready** | Verified | Zero Google Fonts, CDNs, telemetry beacons, or external API calls. Verified via Playwright network monitor (`external_requests: 0`) and offline bundle builder (`scripts/build-offline-bundle.sh`). |
| **On-Premises Stack** | Verified | Self-contained 3-service Compose stack (`frontend_dashboard`, `backend`, `mqtt-service`) plus optional local TLS overlay (`docker-compose.tls.yml`). |
| **Wired LAN Focus** | Verified | Static IPv4 Netplan helper (`scripts/configure-static-ip.sh`) and guided installer target wired Ethernet interfaces; zero Wi-Fi/Bluetooth runtime dependencies. |
| **Dynamic Facility Model** | Verified | Additive SQLite migration `004_multi_room_platform.sql` establishes `facility -> rooms -> device_registry -> device_endpoints` while preserving legacy room and node records. |
| **Generic Endpoint Engine** | Verified | Capability (`SENSOR`, `SWITCH`, `ACCESS_STATE`, `CAMERA_SNAPSHOT`, `STATUS`) separated from data type (`NUMBER`, `BOOLEAN`, `ENUM`, `STRING`, `BINARY_IMAGE`) across backend schemas and frontend widget renderer (`frontend/widgets.js`). |
| **Least-Privilege Operations** | Verified | Backend container runs non-root with `no-new-privileges:true`, no Docker socket, no root host access. Per-device MQTT provisioning is isolated to a host-side allowlisted CLI helper (`scripts/provision-mqtt-device.sh`). |

---

## 2. Gaps Identified in `1.1.0-rc.1` and Resolved in `2.0.0-rc.1`

1. **Single-room constraint (`facility_settings.room_name`)**  
   - *Resolution:* Added first-class `rooms` table with `room_id`, `room_code`, `name`, `building`, `floor`, `status` (`ACTIVE`/`ARCHIVED`), and `room_id` foreign key on `device_registry`. Legacy room auto-migrates to `room-001` with all pre-existing nodes attached.
2. **Mandatory IPv4 address for MQTT-only devices**  
   - *Resolution:* Transport-conditional validation in `backend/src/validators/operationsSchemas.js`: `MQTT_V1` devices require zero IP address; `HTTP_JSON_V1` and `CAMERA_JPEG` continue enforcing private RFC1918 IPv4 addresses and strict SSRF bounds.
3. **Single-page view switcher mixing landing, auth, and operations**  
   - *Resolution:* Replaced with History API multi-page architecture: unauthenticated Local Landing (`/`), dedicated Login (`/login`), and authenticated Operations Shell (`/app/overview`, `/app/rooms`, `/app/rooms/:roomId`, `/app/devices`, `/app/devices/:deviceId`, `/app/devices/:deviceId/endpoints/:endpointKey`, `/app/alarms`, `/app/notifications`, `/app/events`, `/app/diagnostics`, `/app/users`, `/app/settings`, `/app/profile`).
4. **Device onboarding & schema drift visibility**  
   - *Resolution:* Added `pending_devices` quarantine table for unregistered MQTT manifest announcements (`lci/v1/devices/{id}/manifest`), Admin approve/reject/ignore workflows, and manifest drift detection for already-registered devices.
5. **Boolean & threshold alarm gap**  
   - *Resolution:* Extended `alarm_rules` with `condition_type` (`GREATER_THAN`, `LESS_THAN`, `EQUALS_BOOLEAN`, `EQUALS_ENUM`, `STALE`) so binary leak/tamper/contact sensors trigger stateful alarms with dwell and recovery evidence.
6. **Installer & air-gapped deployment friction**  
   - *Resolution:* Added `--discover-only` and Q1–Q6 guided flow to `install.sh`, Netplan static-IP helper with `netplan try` rollback, optional local HTTPS/TLS (`scripts/setup-local-tls.sh`), and SHA-256 verified offline release bundles (`build-offline-bundle.sh`, `install-offline.sh`, `update-offline.sh`).

---

## 3. Security Posture Summary

- **Authentication & Sessions:** Server-side scrypt password hashes, HttpOnly same-origin session cookies, idle + absolute TTL, explicit server-side revocation, CSRF header enforcement on every mutation, and strict RBAC (`Admin` vs `Viewer`).
- **Broker Security:** Anonymous MQTT disabled, per-device ACL blocks (`pattern`/`user`) managed only on the host via `scripts/provision-mqtt-device.sh`, and server-side tracking in `mqtt_identities` without storing plaintext broker passwords in SQLite.
- **Input & Query Safety:** Parameterized `node:sqlite` queries everywhere, Zod request validation, safe DOM construction (`el()`, `textContent`) with zero unsafe HTML injection.
- **Container Hardening:** `security_opt: ["no-new-privileges:true"]` on all containers, pinned base images (`nginx:1.27-alpine`, `eclipse-mosquitto:2.0`, `node:24-alpine`), internal-only backend port `3000`.

---

## 4. Explicit Remaining Physical / Hardware Boundaries

Software verification does **not** certify physical hardware acceptance. The following require on-site target hardware validation before live production commissioning:
- Physical ESP32/controller firmware integration and power/wiring inspection.
- Real Mosquitto broker ACL verification with physical board credentials.
- Sensor calibration verification (MQ-2 remains raw uncalibrated ADC/value until lab calibrated).
- Physical relay/lock fail-safe and hardwired emergency egress inspection.
- Target Ubuntu Server LTS clean-install and offline USB transfer validation.
