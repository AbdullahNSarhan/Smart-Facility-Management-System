# LCI-SFM 2.0 — Deployment & Verification Test Results

**Release:** `2.0.0-rc.1`  
**Test Environment (Automated Software Verification):** Linux `x86_64` (2 vCPU, 4.0 GiB RAM sandbox), Node.js `v22.23.5`, Chromium Headless Shell via Playwright `1.64.1`, isolated SQLite WAL databases.

> **Truthfulness Notice:** Results below reflect **actual executed software tests** in the build/verification environment. Bare-metal Ubuntu Server LTS, offline USB transfer, real Mosquitto hardware ACLs, and physical ESP32/camera commissioning remain **PENDING** until executed on target hardware.

---

## 1. Automated Software Verification Summary

| Test ID | Suite / Command | Result | Observed Evidence |
|---|---|---|---|
| **T-01** | `npm run lint` | **PASS** | Zero syntax errors across `app.js`, 14 `/frontend/**/*.js` modules, backend services/routes/validators, all 4 test suites, and automation scripts. |
| **T-02 & T-03** | `npm test` (`backend/test/*.test.js`) | **PASS** | **64 / 64** automated tests passing across `backend.test.js` (31), `management.test.js` (13), `operations.test.js` (15), and `multiroom.test.js` (5). |
| **T-04** | `npm run build` | **PASS** | Vite built `dist/` cleanly in `~153–214 ms` (`dist/index.html` 7.74 kB, `index-*.css` 21.13 kB / 4.67 kB gzip, `index-*.js` 107.39 kB / 27.95 kB gzip). |
| **T-05** | `npm run test:ui` (`scripts/ui-release-smoke.mjs`) | **PASS** | All **14 routes** verified (`/`, `/login`, `/app/overview`, `/app/rooms`, `/app/rooms/:id`, `/app/devices`, `/app/devices/:id`, `/app/alarms`, `/app/notifications`, `/app/events`, `/app/diagnostics`, `/app/users`, `/app/settings`, `/app/profile`); **`external_requests: 0`** (air-gap proven); **`mobile_overflow_px: 0`** at `390×844`; **`rbac_viewer_gated: true`**. |
| **T-06** | `npm run test:load` (`scripts/load-test.mjs`) | **PASS** | 20 rooms, 100 `MQTT_V1` devices (zero IPs), 500 endpoints, **10,000 / 10,000** frames persisted in SQLite (`369.0 fps`), **200,000** WebSocket deliveries across 20 clients, **100 / 100** concurrent API calls succeeded (`25` parallel sessions). |
| **T-07** | Shell syntax, Discovery & Offline Bundle | **PASS** | `bash -n` passed on `install.sh`, `update.sh`, `install-offline.sh`, `update-offline.sh`, `scripts/*.sh`; `install.sh --discover-only` and `configure-static-ip.sh --discover` ran read-only without error; `build-offline-bundle.sh --skip-docker-images` produced archive and passed `sha256sum -c` on both outer tarball and inner `SHA256SUMS`. |

---

## 2. Multi-Room Scale & Concurrency Benchmark (`scripts/load-test.mjs`)

Measured on the 2-vCPU, 4.0 GiB RAM sandbox host:

```json
{
  "ok": true,
  "scenario": {
    "rooms": 20,
    "devices": 100,
    "endpoints": 500,
    "frames_ingested": 10000,
    "frames_persisted_sqlite": 10000,
    "ws_clients": 20,
    "ws_frames_delivered": 200000,
    "concurrent_api_sessions": 25,
    "api_requests_completed": 100
  },
  "metrics": {
    "seed_topology_ms": 168.1,
    "ingest_duration_ms": 27101.3,
    "ingest_throughput_fps": 369,
    "api_total_ms": 8089.1,
    "api_p50_ms": 1781.97,
    "api_p95_ms": 2815.35,
    "api_p99_ms": 2992.39,
    "rss_memory_mb": 220.5,
    "heap_used_mb": 26.1,
    "sqlite_db_size_mb": 2.5
  }
}
```

**Observations:**
- Zero telemetry frame loss (`10,000` ingested → `10,000` persisted in `device_frames`) and zero cross-device contamination.
- Compact storage footprint (`2.5 MB` SQLite file after 10,000 multi-endpoint frames) and low JS heap (`26.1 MB` heap used / `220.5 MB` RSS).
- Under 25 simultaneous full-topology HTTP bursts (`100` concurrent requests including `/api/v1/overview`, `/api/v1/rooms`, `/api/v1/registry`, `/api/v1/diagnostics`) on a constrained 2-vCPU container, p95 latency was `2,815.35 ms`; re-run `npm run test:load` on the production Ubuntu server to baseline target hardware latency.

---

## 3. Target Server / Physical Hardware Verification Status

| Test ID | Target Test | Status |
|---|---|---|
| **H-01** | Fresh Online Ubuntu 24.04 LTS Install (`sudo ./install.sh`) | **PENDING** (requires target Ubuntu server/VM) |
| **H-02** | Air-Gapped Offline USB Bundle Install (`sudo ./install-offline.sh`) | **PENDING** (requires Docker Engine + offline host) |
| **H-03** | Static IPv4 Netplan Apply & `netplan try` Rollback | **PENDING** (requires target Linux host with Netplan) |
| **H-04** | Local HTTPS/TLS (`setup-local-tls.sh` + `docker-compose.tls.yml`) | **PENDING** (requires target host + Docker) |
| **H-05** | Live Mosquitto Per-Device ACL Isolation (`provision-mqtt-device.sh`) | **PENDING** (requires running Mosquitto container) |
| **H-06** | Offline Upgrade & Readiness-Failure Rollback (`update-offline.sh`) | **PENDING** (requires target host + Docker) |
| **H-07** | Physical ESP32 Nodes, Camera & Hardwired Safety Sign-Off | **PENDING** (requires physical hardware commissioning) |
