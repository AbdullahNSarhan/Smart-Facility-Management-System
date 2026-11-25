# LCI-SFM Visual Asset Manifest & Offline Licensing Record

> **Platform:** Light Current Infrastructure for Smart Facility Management (`2.0.0-rc.1`)
> **Operating Model:** 100% Local-First / Air-Gapped (`default-src 'self'`, zero runtime CDNs, zero remote fonts)

---

## 1. Visual Identity & Semantic Color System

Device category colors communicate **what hardware role a node performs** and remain invariant across operational health transitions (`ONLINE`, `STALE`, `OFFLINE`, `MAINTENANCE`, `UNKNOWN`).

| Category Key | Hardware Domain | Dark Accent / Text | Light Accent / Text | Representative Icon |
|---|---|---|---|---|
| `env` | Environmental Sensors (Temp, Humidity, Smoke/Gas) | `#22D3EE` / `#67E8F9` | `#0891B2` / `#0E7490` | `icon-thermometer`, `icon-droplet`, `icon-flame` |
| `access` | Access Control, Smart Doors, RFID & PIN Readers | `#F59E0B` / `#FCD34D` | `#D97706` / `#B45309` | `icon-door`, `icon-id-badge`, `icon-lock` |
| `camera` | Security Cameras & Snapshot Endpoints | `#A78BFA` / `#C4B5FD` | `#7C3AED` / `#6D28D9` | `icon-camera` |
| `relay` | Relays, Actuators & Smart Switches | `#FB923C` / `#FDBA74` | `#EA580C` / `#C2410C` | `icon-toggle`, `icon-bolt` |
| `network` | LAN Gateways, Routers & Mosquitto MQTT Broker | `#60A5FA` / `#93C5FD` | `#2563EB` / `#1D4ED8` | `icon-broadcast`, `icon-router`, `icon-topology` |
| `infra` | Central LCI-SFM Server, SQLite WAL & Fallback Nodes | `#818CF8` / `#A5B4FC` | `#4F46E5` / `#4338CA` | `icon-server`, `icon-database`, `icon-cpu` |

### Independent Operational Status Palette
| Operational State | Dark Token | Light Token | Non-Color Cue |
|---|---|---|---|
| `ONLINE` / `FRESH` / `HEALTHY` | `#34D399` | `#047857` | `icon-check-circle` + explicit text |
| `WARNING` / `STALE` / `DEGRADED` | `#FBBF24` | `#B45309` | `icon-warning` / `icon-clock` + explicit text |
| `OFFLINE` / `CRITICAL` / `ERROR` | `#F87171` | `#B91C1C` | `icon-x-circle` + explicit text |
| `MAINTENANCE` / `PENDING` | `#38BDF8` / `#A78BFA` | `#0284C7` / `#6D28D9` | `icon-wrench` / `icon-clock` + explicit text |
| `UNKNOWN` / `UNSEEN` / `STANDBY` | `#94A3B8` | `#475569` | `icon-info` + explicit text |

---

## 2. Offline Asset Directory Architecture

```text
frontend/assets/
├── fonts/
│   └── README.txt                          # Native OS/monospace stack policy (zero remote webfont requests)
├── icons/
│   ├── actions/edit.svg                    # Canonical 24x24 action outline SVG
│   ├── devices/{camera,door,thermometer,toggle}.svg
│   ├── navigation/arrow-up-right.svg
│   └── status/check-circle.svg             # Paired with inline <symbol> sprite in index.html (49 symbols total)
├── illustrations/
│   ├── dashboard/
│   │   ├── facility-hub.svg                # Multi-zone smart facility hero cutaway
│   │   └── room-zone.svg                   # Isometric smart room zone module
│   ├── empty-states/
│   │   ├── empty-alarms-ok.svg             # All-clear facility shield
│   │   ├── empty-audit.svg                 # Clean SQLite audit ledger
│   │   ├── empty-devices.svg               # Unpopulated controller slot
│   │   └── empty-telemetry.svg             # Idle telemetry waveform
│   └── nodes/
│       ├── env-sensor.svg                  # Multi-sensor environmental enclosure (Cyan)
│       ├── temp-humidity-sensor.svg        # Dual temperature & humidity probe (Cyan)
│       ├── gas-smoke-sensor.svg            # Louvered optical gas/smoke detector (Cyan)
│       ├── smart-door-controller.svg       # Door access strike controller (Amber)
│       ├── rfid-keypad-reader.svg          # RFID card + 3x4 PIN reader (Amber)
│       ├── security-camera.svg             # PoE turret/bullet security camera (Violet)
│       ├── relay-switch.svg                # DIN-rail smart relay actuator (Orange)
│       ├── network-gateway.svg             # Managed LAN / PoE gateway switch (Blue)
│       ├── mqtt-broker.svg                 # Mosquitto pub/sub broker hub (Blue)
│       ├── server-controller.svg           # Central LCI-SFM server & SQLite WAL (Indigo)
│       └── generic-node.svg                # Generic wired controller fallback (Indigo)
└── licenses/
    ├── LCI-SFM-CUSTOM-ASSETS.txt           # MIT first-party SVG illustration license
    └── TABLER-ICONS-MIT.txt                # MIT license for Tabler-compatible 24x24 outline icons
```

---

## 3. Asset Inventory & Licensing Matrix

| Asset Group | Local Path(s) | Source / Author | License | Bundling & Attribution |
|---|---|---|---|---|
| **24×24 Outline Icons (`49` symbols)** | `index.html` (`<symbol id="icon-*">`) & `frontend/assets/icons/**/*.svg` | LCI-SFM & Tabler Icons geometry (`https://github.com/tabler/tabler-icons`) | **MIT** | Permitted for commercial/offline bundling; license preserved in `frontend/assets/licenses/TABLER-ICONS-MIT.txt`. No UI footer credit required. |
| **Custom Node Illustrations (`11` SVGs)** | `frontend/assets/illustrations/nodes/*.svg` | First-party authored for LCI-SFM | **MIT** | Bundled locally into `dist/assets/*.svg` via Vite (`assetsInlineLimit: 0`). |
| **Empty-State & Dashboard Illustrations (`6` SVGs)** | `frontend/assets/illustrations/{empty-states,dashboard}/*.svg` | First-party authored for LCI-SFM | **MIT** | Bundled locally into `dist/assets/*.svg` via Vite. |
| **Typography** | System UI & `ui-monospace` (`styles.css`) | Host OS native fonts | N/A | Zero network requests; complies with `font-src 'self'`. |
