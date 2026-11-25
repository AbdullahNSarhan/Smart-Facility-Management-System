# LCI-SFM Frontend Documentation

> **Project:** Light Current Infrastructure for Smart Facility Management (`2.0.0-rc.1`)  
> **Component:** Browser-Based Multi-Room Smart Facility Operations Console  
> **Implementation:** Semantic HTML, Local CSS Design Tokens, Vanilla JavaScript ES Modules (zero external CDNs, remote fonts, or third-party UI frameworks)  
> **Primary Backend:** Node.js / Express HTTP API (`/api/*`, `/api/v1/*`) + WebSocket Gateway (`/ws/telemetry`, `/ws/notifications`, `/ws/mfa`), backed by SQLite (WAL) and Eclipse Mosquitto MQTT  
> **Operating Model:** Local-first, on-premises, air-gapped-ready private wired LAN

---

## 1. Architecture & Operating Boundaries

The LCI-SFM frontend is a multi-page History API web application built with Vite and served from the same origin as the Node.js backend (via Nginx in Docker Compose or Vite dev middleware during development).

```text
Operator Browser (index.html + styles.css + frontend/*.js)
  | Same-Origin HTTP: /api/public/info, /api/health/*, /api/auth/*, /api/v1/*, /api/logs/*
  | Same-Origin WebSocket: /ws/telemetry, /ws/notifications, /ws/mfa
  | Camera Snapshots: Authenticated backend proxy (/api/v1/registry/:id/snapshot)
  v
Nginx Reverse Proxy (Docker) / Vite Dev Middleware
  v
Node.js Central Backend (Express + ws) <----> SQLite (WAL + Foreign Keys)
  |
  +---- Eclipse Mosquitto MQTT Broker <----> Registered Edge Controllers (MQTT_V1 / Legacy)
  +---- Private LAN HTTP Probes / JPEG Proxy <----> Registered LAN Endpoints
```

### Non-Negotiable Product & Security Boundaries
- **Air-Gapped & Zero External Assets:** `index.html` enforces a strict Content Security Policy (`default-src 'self'`, `img-src 'self' data: blob:`, `connect-src 'self' ws: wss:`). All SVG icons live in a local inline sprite inside `index.html`.
- **Authenticated Camera Proxy:** Browser clients never request raw camera IPs directly; snapshots are fetched through `GET /api/v1/registry/:id/snapshot` with session cookie authentication and private-LAN IP validation on the backend.
- **Honest Operational Semantics:** Publishing a command (`PUBLISHED`) is distinguished from controller acknowledgement (`ACKNOWLEDGED`) and confirmed state (`STATE_REPORTED`). Registering a device IP updates server-side destinations only and does not configure physical controller NICs or edge safety thresholds.
- **Server-Enforced Security:** Sessions use `HttpOnly; SameSite=Strict` cookies (`lci_sid`), CSRF protection (`X-CSRF-Token`), and server-side Admin/Viewer RBAC. Passwords and PIN hashes are never returned to the browser.

---

## 2. Frontend File Structure

| File | Responsibility |
|---|---|
| `index.html` | Strict air-gapped CSP, metadata, local 24×24 inline SVG icon sprite, `#app-root` mount |
| `styles.css` | Dark Industrial Graphite (default) + Light Technical Neutral CSS custom properties, 6-state semantic tokens, adaptive table/mobile cards, slide-over drawers, wizard stepper, SVG topology styles, `prefers-reduced-motion` |
| `app.js` / `frontend/main.js` | Application bootstrap and exported helpers |
| `frontend/router.js` | History API router for `/`, `/login`, and 13 authenticated `/app/*` routes with auth guards and overlay cleanup |
| `frontend/api.js` | Same-origin `fetch` client with `X-CSRF-Token` injection aligned 1:1 with `/api/*` and `/api/v1/*` routes |
| `frontend/store.js` | Reactive session/theme store, WebSocket manager with exponential backoff, toasts, focus-trapped modals, and accessible slide-over detail drawers |
| `frontend/utils.js` | Safe DOM constructor (`el()`), formatting, CSV formula-safe export, local SVG sparklines and history trend charts |
| `frontend/components/ui.js` | Shared primitives: 6-state `statusIndicator` (icon + color + text), `pageHeader`, `kpiCard`, `loadingSkeleton`, `emptyState`, `errorPanel`, `disclaimerBanner`, `copyableValue`, `keyValueList`, `timelineList`, `segmentedFilter`, and `renderAdaptiveCollection` |
| `frontend/widgets.js` | Generic endpoint widget renderer (`METRIC_TREND`, `BOOLEAN_STATE`, `SWITCH_CONTROL`, `ACCESS_STATE`, `CAMERA_SNAPSHOT`) driven strictly by endpoint metadata |
| `frontend/pages/shell.js` | Collapsible desktop sidebar, mobile drawer (`Esc` dismiss), breadcrumbs, local host origin readout, live connectivity status, notification bell, and theme toggle |
| `frontend/pages/landing.js` | Local appliance landing page (`/`) consuming `/api/public/info` |
| `frontend/pages/login.js` | Dedicated operator login (`/login`) with accessible password visibility toggle and safe relative redirect |
| `frontend/pages/overview.js` | Facility Overview (`/app/overview`) with isolated section loading (`Promise.allSettled`), KPI row, Central Service Readiness Strip, Managed Rooms grid, Priority Attention Queue, and Compact Activity Feed |
| `frontend/pages/rooms.js` | Rooms directory (`/app/rooms`) and Room detail (`/app/rooms/:roomId`) with adaptive table/cards and safe room reassignment |
| `frontend/pages/devices.js` | Devices directory (`/app/devices`), Guided 4-Step Device Registration Wizard, Quarantined device review, Device detail (`/app/devices/:deviceId`) with command history and copyable MQTT topics/CLI, and Endpoint history (`/app/devices/:deviceId/endpoints/:endpointKey`) with server-filtered time presets |
| `frontend/pages/network.js` | Interactive Network & Connectivity view (`/app/network`) with clickable/keyboard-selectable SVG topology diagram, synchronized Node Inspection Panel, and Device Connectivity Matrix |
| `frontend/pages/operations.js` | Alarms & Monitoring Rules (`/app/alarms`, 1:1 `ruleSchema` + Slide-Over Timeline Drawer), Notifications (`/app/notifications`), and Events & Audit Logs (`/app/events` + Slide-Over Record Detail Drawer) |
| `frontend/pages/admin.js` | Diagnostics (`/app/diagnostics`), separated Dashboard Operators & Facility People/Credentials (`/app/users`), Facility Settings & Server-Side Destinations (`/app/settings`), and Operator Profile (`/app/profile`) |

---

## 3. Route Map

| Route | Access | Purpose |
|---|---|---|
| `/` | Public | Local appliance overview and safe `/api/public/info` status |
| `/login` | Public | Dedicated operator sign-in (`?next=/app/...` validated relative redirect) |
| `/app/overview` | Auth | Facility KPIs, service readiness strip, managed rooms, attention queue, and activity feed |
| `/app/rooms` | Auth | Active/archived rooms directory (Admin CRUD) |
| `/app/rooms/:roomId` | Auth | Room summary, assigned devices, room alarms, and move-device workflow |
| `/app/devices` | Auth | Device registry, quarantine approval queue, and 4-step registration wizard |
| `/app/devices/:deviceId` | Auth | Heartbeat vs endpoint freshness, manifest drift alerts, generic widgets, command history, MQTT CLI |
| `/app/devices/:deviceId/endpoints/:endpointKey` | Auth | Time-windowed (`1h`/`6h`/`24h`/`7d`/`All`) SVG trend chart, summary stats, samples, and CSV export |
| `/app/network` | Auth | Interactive SVG infrastructure/device topology, node inspector, and connectivity matrix |
| `/app/alarms` | Auth | Severity-ordered alarm queue with lifecycle drawer + deterministic sensor rules |
| `/app/notifications` | Auth | Role-scoped operator inbox, read tracking, and per-user critical alert sound preference |
| `/app/events` | Auth | Allowlisted SQLite audit/log explorer with structured slide-over inspector and filtered CSV export |
| `/app/diagnostics` | Auth | Platform readiness, SQLite WAL, MQTT broker, WebSocket channel stats, and simulation controls (if enabled) |
| `/app/users` | Admin | Separated Dashboard Operators (`/api/v1/operators`) and Facility People/Credentials (`/api/v1/people`) |
| `/app/settings` | Admin | Facility profile (`/api/v1/facility`) and server-side baseline node destinations (`/api/v1/settings`) |
| `/app/profile` | Auth | Session details, Dark/Light theme toggle, Admin credential rotation, and sign-out |

---

## 4. Verification & Quality Gates

```bash
npm run lint        # Syntax verification across all frontend ES modules, backend modules, and scripts
npm test            # Full Node.js backend integration, security, multi-room, and management test suite
npm run build       # Vite production static bundle into dist/
npm run test:ui     # Headless Playwright E2E, RBAC, responsive (1440/768/390/360px), and zero-external-request check
```

All Playwright E2E tests assert zero uncaught console/page errors, zero horizontal overflow across desktop/tablet/mobile viewports, Viewer RBAC enforcement, and `external_requests === 0` for air-gapped compliance.
