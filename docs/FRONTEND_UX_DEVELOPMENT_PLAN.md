# LCI-SFM Frontend & UX Modernization — Execution Roadmap

> **Document type:** Implementation blueprint and engineering backlog  
> **Repository:** AbdullahNSarhan/Smart-Facility-Management-System  
> **Baseline branch:** main  
> **Baseline commit reviewed:** 08648c43669170ab0a7853e9630fc0c1853e4cc7  
> **Current release metadata:** 2.0.0-rc.1  
> **Scope:** Frontend visual redesign, UX improvement, and only the backend compatibility work proven necessary by the approved interface  
> **Status:** Proposed execution plan. This document does not change application behavior or production data.

---

## 1. Executive direction

LCI-SFM should evolve into a polished, operator-friendly **on-premises Facility Operations Platform**. The target is not a decorative dashboard with many charts. It is a visual control surface where an operator can understand the Facility, identify the origin and seriousness of an issue, reach the relevant Room/Device/Endpoint quickly, and perform only the actions allowed by server-side roles and device-safety contracts.

The repository already contains a functional multi-page frontend, a local design-token system, SVG icons, a generic Endpoint widget engine, authenticated REST/WebSocket integration, multi-room management, alarms, notifications, audit views, and diagnostics. An immediate framework migration or ground-up rewrite is not justified. The preferred strategy is to improve the existing modular Vanilla JavaScript ES-module application incrementally, preserving its current security and offline posture.

The delivery sequence is:

1. Establish and document the current UI/API baseline.
2. Define the visual language and reusable UI primitives.
3. Improve the shared application shell and navigation.
4. Redesign Overview as the primary operator command center.
5. Improve Rooms, Devices, and Endpoints as the core facility-management workflow.
6. Add a dedicated Network & Connectivity view using existing, truthful connectivity evidence.
7. Improve Alarms, Notifications, Events, and Diagnostics.
8. Improve Administration, People & Credentials, Settings, and Profile.
9. Make only API/backend changes required by the approved UI.
10. Complete regression, responsive, accessibility, local-network, and deployment acceptance.

**The UI drives the feature specification.** Backend changes follow a defined screen/interaction contract. Do not add speculative endpoints or database tables simply because they might be useful later.

---

## 2. Repository audit — current implementation

This plan is based on the repository source and file tree at baseline commit 08648c43669170ab0a7853e9630fc0c1853e4cc7.

### 2.1 Frontend architecture already present

| Area | Current implementation | Implication |
|---|---|---|
| Application entry | index.html mounts #app-root; app.js calls mountLciPlatform | Keep the existing boot path unless a measured issue requires change |
| UI implementation | HTML, CSS, Vanilla JavaScript ES modules | Do not migrate to React/Vue or add a component framework in this phase |
| Main bootstrap | frontend/main.js | Retain a single frontend mount point |
| Routing | frontend/router.js, History API, auth guards, deep links | Extend the route table for approved pages |
| Shared shell | frontend/pages/shell.js | Main target for navigation, topbar, global status, and responsive improvements |
| Shared state | frontend/store.js | Continue to own session, theme, WebSocket state, telemetry cache, notifications, and UI events |
| API client | frontend/api.js | Keep all HTTP access centralized and same-origin |
| UI helpers | frontend/utils.js | Reuse safe DOM construction, formatting, SVG chart, and CSV helpers |
| Endpoint widgets | frontend/widgets.js | Extend generic rendering rather than writing sensor-specific page code |
| Styles | styles.css | Evolve the existing tokenized dark/light design system |
| Icon assets | Local SVG sprite in index.html | Keep icons local and consistent; do not add CDN dependencies |

### 2.2 Current authenticated routes

| Route | Current responsibility | Planned direction |
|---|---|---|
| / | Public local landing page | Keep as product/deployment introduction, not the operator dashboard |
| /login | Dedicated operator sign-in | Refine visual clarity and error/help states without changing auth semantics |
| /app/overview | Facility KPIs, Rooms, alarms, service health | Redesign as the primary command center |
| /app/rooms | Room directory and management | Improve room discovery, filtering, cards/table |
| /app/rooms/:roomId | Room detail and assigned devices | Improve Room context and device grouping |
| /app/devices | Device inventory and onboarding | Improve filters, status, endpoint counts, registration |
| /app/devices/:deviceId | Device detail, endpoint widgets, MQTT information | Improve device summary and operational sections |
| /app/devices/:deviceId/endpoints/:endpointKey | Endpoint history and export | Improve history controls and empty/unknown states |
| /app/alarms | Alarm list and monitoring rules | Separate incident workflow from rule configuration |
| /app/notifications | Per-user notifications | Improve inbox, filters, read states, and live refresh |
| /app/events | Access, telemetry, errors, command/admin audit | Improve event exploration and filtering |
| /app/diagnostics | SQLite, MQTT, WebSocket, freshness, simulator-only controls | Improve service and device diagnostics presentation |
| /app/users | Dashboard operators and physical people/credentials | Clarify the two identity domains and their actions |
| /app/settings | Facility settings | Separate Facility profile from server-side device destination records |
| /app/profile | Current operator profile and theme | Improve account/session clarity |

**Proposed new route:** /app/network for a consolidated Network & Connectivity view. It should use currently available device registry and diagnostics data. It must not claim network discovery, packet inspection, or device-side IP configuration.

### 2.3 Existing backend capabilities relevant to the UI

The backend already exposes substantial functionality through backend/src/routes/apiRoutes.js, backend/src/routes/operationsRoutes.js, and backend/src/routes/managementRoutes.js.

| Capability | Existing route/API area | Notes for UI design |
|---|---|---|
| Auth and session | /api/auth/* | Cookie-backed session, CSRF-protected mutations, server-verified role |
| Health | /api/health/live, /api/health/ready | Distinguish liveness from readiness |
| Overview and diagnostics | /api/v1/overview, /api/v1/diagnostics | Existing source for executive summary and system status |
| Capability metadata | /api/v1/capabilities | Use to describe supported Endpoint widgets/capabilities |
| Facility | /api/v1/facility | Facility update uses a version/revision contract |
| Rooms | /api/v1/rooms | Create, edit, archive, restore, detail |
| Device registry | /api/v1/registry | Register, edit, move, archive, restore, probe, maintenance |
| Endpoint history | /api/v1/registry/:id/endpoints/:endpointKey/history | Range query supports from/to; current frontend wrapper exposes only limit |
| Device commands | /api/v1/registry/:id/commands | Admin-only mutation; command lifecycle must be represented truthfully |
| Pending onboarding | /api/v1/pending-devices | Admin-only review queue; unknown announcements must not auto-register |
| Alarms and rules | /api/v1/alarms, /api/v1/rules | Acknowledge/resolve and sensor rule management |
| Notifications | /api/v1/notifications | Per-user read state, preferences, WebSocket invalidation |
| Events/audit | /api/logs/* and management/command audit routes | Preserve role-based access and secret-safe projections |
| Operators and people | Existing auth, people, operator, and credential routes | Dashboard login accounts are separate from physical access people |
| Simulator | /api/v1/simulator | Must remain isolated and visibly labelled SIMULATION |

### 2.4 Existing design and interaction foundation

The current stylesheet already provides:
- Dark graphite and light neutral themes.
- CSS variables for canvas, surfaces, borders, text, accent, and operational statuses.
- Cards, tables, inputs, buttons, alerts, modals, toasts, layout grids, responsive sidebar behavior, and chart styling.
- A local SVG icon sprite and system-font stack.
- No runtime dependency on external fonts or icon CDNs.

The authenticated shell already includes a collapsible desktop sidebar, mobile navigation drawer, breadcrumbs, notification badge, theme toggle, profile entry, logout, WebSocket indicators, and an MQTT readiness summary.

The application already includes modal confirmations, role-aware UI, generic Endpoint widgets, local SVG trend charts, CSV export, and route cleanup hooks. The work should strengthen consistency and completeness rather than replace these primitives blindly.

### 2.5 Existing automated verification

The repository provides:
- npm run lint: JavaScript syntax checks across frontend/backend modules.
- npm test: Node test-runner backend/integration suite.
- npm run build: Vite production bundle.
- npm run test:ui: Playwright browser smoke test against an isolated in-memory backend and simulator.

The UI smoke flow already checks routes, login/deep-link behavior, Room creation, Device registration, Endpoint rendering, theme toggling, Viewer restrictions, 390px mobile overflow, JavaScript errors, and zero external network requests. This is the regression baseline to preserve and expand.

### 2.6 Audit findings and opportunities

1. **Broad functionality, uneven information hierarchy.** The existing cards/tables work, but the redesigned interface should consistently distinguish summary, detail, status, and action.
2. **The shell has good fundamentals.** It needs clearer grouping, more informative connectivity states, a stronger active-route treatment, and responsive behavior that remains understandable when collapsed.
3. **Overview can become more actionable.** It should answer: Is the Facility operating normally? What requires attention? Which Room/Device is affected? What should the operator inspect next?
4. **Device onboarding is powerful but form-heavy.** Registration and Endpoint definition should be grouped into logical steps, with contextual explanations and validation before saving.
5. **Network information is distributed.** Device transport/address, MQTT status, server readiness, Endpoint freshness, and diagnostics are spread across pages. A dedicated view can consolidate this without inventing connectivity capabilities.
6. **Some frontend API methods expose fewer filters than the backend already supports.** This is primarily an API-client/UI gap, not automatically a backend gap.
7. **Frontend documentation contains legacy descriptions.** After implementation, update docs/FRONTEND_DOCUMENTATION.md to match the modular current UI and authenticated proxy-based camera flow.
8. **Software connectivity is not proof of physical hardware acceptance.** The UI must distinguish broker connectivity, device heartbeat, Endpoint freshness, command acknowledgement, and physical state confirmation.

---

## 3. Non-negotiable architecture and safety rules

These constraints apply to every phase and every pull request.

### 3.1 Local-first and air-gap requirements

- All JavaScript, CSS, fonts, icons, illustrations, and chart assets must be served locally.
- No external CDN, remote font, online icon library, analytics beacon, telemetry exporter, cloud API, or runtime network dependency.
- No hidden external image requests. Use a local checked-in asset or CSS/SVG authored in the repository.
- Continue same-origin HTTP(S) and WebSocket(S) communication through Nginx.
- The browser must never connect directly to the MQTT broker.
- Respect the existing Content Security Policy in index.html; any CSP change requires a documented reason and security test.
- Avoid introducing a heavy dependency unless the benefit is clear, offline packaging is validated, and bundle impact is measured.

### 3.2 Backend, database, and identity boundaries

- Keep Node.js/Express, SQLite WAL, Mosquitto, Nginx, and Docker Compose as the current architecture.
- Keep one installation mapped to one Facility with dynamic Rooms, Devices, and Endpoints.
- Keep the current Admin/Viewer server-side authorization model. Frontend hiding is usability only, never a security boundary.
- Preserve cookie sessions, CSRF checks, request validation, rate limits, audit records, and optimistic concurrency/version checks.
- Do not expose password hashes, PINs, card identifiers, broker passwords, session tokens, or other secrets in UI payloads, logs, exports, screenshots, or diagnostic panels.
- Physical people/credentials and dashboard operator accounts remain separate concepts.
- Any schema change must be additive, migration-tested, backed up, and explicitly justified by an approved feature that cannot be represented by the current data model.

### 3.3 Device and physical safety boundaries

- Edge-level safety and emergency egress remain autonomous; they must not depend on the dashboard, backend, or MQTT broker.
- Preserve the dedicated, audited emergency access workflow and confirmation step. Never create a generic Unlock control that bypasses it.
- Do not imply a command was executed because a publish succeeded. Distinguish request accepted/published, device acknowledged, and reported state confirmed.
- A device heartbeat does not make old Endpoint readings fresh. Display device liveness and per-Endpoint freshness separately.
- Unknown, unobserved, disabled, archived, standby, stale, and offline are distinct states. Do not collapse them into one red/green badge.
- Changing a registered device address changes the server-side destination record only. It does not configure the physical device's IP/network interface.
- Do not add network scanning, auto-discovery, arbitrary MQTT publishing, firmware update, reboot, OTA, or device-side network configuration controls without a separately approved and verified implementation.
- Do not claim offline buffering or physical acceptance without test evidence.

### 3.4 Explicitly out of scope for this roadmap

- Reintroducing Node-RED.
- Adding the Python/OpenCV Vision Service to the current Compose deployment.
- Face-recognition enrollment or biometric inference redesign.
- Multi-Facility/cloud management, email/SMS, or third-party hosted services.
- Automatic subnet scanning or arbitrary device discovery.
- Firmware-side IP configuration, OTA update, or generic shell/terminal controls.
- Rewriting the application into React/Vue or adopting a new component framework as a prerequisite for visual polish.

---

## 4. Target product experience

### 4.1 Operator experience goals

The redesigned UI should make it possible to:
- Understand the overall Facility condition immediately after login.
- Tell the difference between healthy, warning, critical, stale, unknown, disabled, archived, and standby states.
- Navigate from Facility summary to a Room, Device, Endpoint, Alarm, or Event quickly.
- Find a Device by name, immutable Device ID, Room, transport, or current status.
- Add a Room or Device through guided, comprehensible forms.
- Define supported Endpoints with correct capability/data-type pairing.
- Inspect last observation, freshness, history, command status, and diagnostics without confusing them.
- Review alarms and notifications, acknowledge/resolve only where authorized, and understand the audit trail.
- Use the console on desktop, laptop, tablet, and mobile without horizontal page overflow.
- Operate the platform without internet access.

### 4.2 Information architecture

Recommended sidebar groups:

**Facility**
- Overview
- Rooms
- Devices
- Network & Connectivity

**Monitoring**
- Alarms & Rules
- Notifications
- Events & Audit

**Administration**
- Diagnostics
- Users & Access (Admin)
- Settings (Admin)

**User**
- Profile (through user menu/footer)

Do not add sidebar links for pages without defined behavior. If Network & Connectivity is approved, add its route and view in the same implementation phase. Keep Overview as the default authenticated destination.

### 4.3 Core visual direction

Use a **professional industrial operations console** style:
- Dark graphite as the default operating theme, with the existing light theme retained.
- Clear typography and spacing. Important numbers/statuses should be easy to scan without turning every card into a large billboard.
- Neutral surfaces and subtle borders, restrained shadows, consistent alignment.
- Clear cards, structured tables, compact charts, status timelines, and readable topology diagrams.
- Make actions visually distinct from navigation and status indicators.
- Keep information density appropriate for engineering operators, but do not dump every raw field on Overview.
- Use consistent page headers with title, concise explanation, breadcrumbs/context, and a small number of primary actions.
- Prefer meaningful labels over abbreviations. Put technical protocol names and immutable IDs in secondary metadata/detail sections.

### 4.4 Status color and icon semantics

| Semantic state | Color family | Meaning / use |
|---|---|---|
| Healthy / Online / Fresh | Green | Verified healthy state or fresh observation |
| Warning / Stale / Attention | Amber | Degraded, aging, or needs operator review |
| Critical / Error | Red | Verified critical condition or operation failure |
| Informational / Selected | Blue | Navigation, information, focus, or non-alarm state |
| Pending / Review / Maintenance | Violet | Awaiting explicit review or administrative workflow |
| Unknown / Disabled / Archived / Standby | Gray | No current positive/negative evidence, intentionally disabled, archived, or not applicable |

Rules:
- Every status uses **icon + text label + color**. Color alone is never sufficient.
- Do not style UNKNOWN as healthy or failed.
- MQTT disabled/standby is not an MQTT failure.
- A Device may be ONLINE while one Endpoint is STALE; show both facts.
- A camera not actively capturing may be in standby; do not label it broken solely due to absent snapshots.
- Keep severity colors separate from decorative product accents.
- Reuse the existing tokens in styles.css; update tokens centrally rather than hardcoding hex values in page modules.

### 4.5 Iconography

- Continue using the inline/local SVG icon sprite or a locally maintained SVG module.
- Standardize on a single outline style, consistent stroke width, optical size, and alignment.
- Use icons for familiar concepts: Facility, Room, Node/Device, Endpoint/Sensor, Network, Alarm, Notification, Event, User, Configuration, Database, Broker, and Connectivity.
- Keep a textual label beside navigation icons; collapsed sidebar icons need accessible labels/tooltips.
- Never use emojis as production status icons.

### 4.6 Shared interaction states

Every data-driven page must define:
1. Initial loading state (skeleton or clear progress indicator).
2. Loaded state with timestamp/freshness context where relevant.
3. Empty state that explains why the list is empty and provides a valid next action.
4. Filtered-empty state that suggests clearing filters.
5. Partial failure state that preserves already loaded sections when possible.
6. Error state with safe error text and retry action.
7. Unknown/unobserved state before the first valid reading.
8. Disabled/archived/permission-restricted state.
9. Pending action state, with controls disabled while a request is in progress.
10. Success/failure feedback tied to the actual server response.

Avoid fake values, fabricated trends, or success toasts before a mutation response confirms success.

---

## 5. Page-by-page design and behavior specification

### 5.1 Overview — Facility Command Center

**Route:** /app/overview  
**Primary question:** "What is happening across the Facility, and what needs attention now?"

**Layout**
1. **Page header:** Facility name/location, last-refresh indicator, shortcuts to Add Room/Register Device (Admin) and Network view.
2. **Facility KPI row:** Active Rooms/Total Rooms; Devices Online/Registered; Active Alarms with severity breakdown where available; Pending Device Reviews; overall service readiness as a separate system-health indicator.
3. **Service health strip:** Backend HTTP readiness; SQLite health/WAL mode; MQTT enabled/standby/connected/degraded; WebSocket telemetry/notification connection state.
4. **Room overview:** Room cards with code, name, building/floor, Device count, online count, alarm count, status label, and drill-down.
5. **Attention queue:** Active critical/warning alarms, pending Device approvals/manifest drift, stale Endpoints or disconnected Devices only when supported by current evidence.
6. **Recent activity:** Small feed of events/notifications only if a reliable source is available.

**Required behavior**
- Refresh re-fetches data and indicates progress.
- Partial API failure must not silently replace data with zeros.
- Live telemetry should update relevant widgets without rebuilding the entire page unnecessarily.
- KPI click-through must lead to a supported relevant page/filter.
- Empty Facility state explains how to add the first Room/Device.
- Default route remains Overview after successful sign-in.

**Acceptance**
- Operator can identify a critical alarm and open its source in no more than two interactions.
- No placeholder metrics or invented time series.
- Readiness semantics match /api/health/ready and Device/Endpoint status semantics match backend responses.

### 5.2 Rooms — Facility organization

**Routes:** /app/rooms, /app/rooms/:roomId

**Room directory**
- Present a clear grid/list toggle only if both layouts can be maintained accessibly; otherwise use a strong table with responsive card fallback.
- Search by Room Code, Room Name, Building, and Floor where data supports it.
- Filters: Active / Archived.
- Show count summary and Create Room action for Admin.
- Include Room code, friendly name, location, assigned Device count, online count, active Alarm count, and status.
- Keep archive/restore confirmation and historical-data preservation explanation.

**Room detail**
- Room identity, building/floor, description, state, and aggregate counts.
- Sections: Devices in this Room, Active Alarms, Endpoint overview.
- Device cards show transport, observed status, last heartbeat, endpoint count.
- Move Device shows target Room and explains historical telemetry is preserved.
- Add Device shortcut pre-fills the Room in the registration workflow.

**Forms**
- Group fields into Identity, Location, and Notes.
- Explain required fields and allowed Room Code format.
- Inline validation before submission; preserve typed values after server errors.
- Show version conflict (HTTP 409) as "This Room changed elsewhere; reload before saving."

### 5.3 Devices — Inventory and onboarding

**Routes:** /app/devices, /app/devices/:deviceId

**Inventory**
- Search by friendly name or immutable Device ID.
- Filters: Room, Transport, archived visibility; add status/freshness filter only if returned data can be mapped truthfully.
- Compact table on wide screens and stacked cards on narrow screens.
- Columns: Device, Room, Capability/Endpoint count, Transport, Server destination, Device/telemetry status, Last seen, Actions.
- MQTT-only displays "Broker-mediated — no direct IP required", not a missing-configuration error.
- Show manifest drift, maintenance, quarantine/pending state as explicit labels.
- Archived and disabled states are unmistakable but visually subdued.
- Do not treat heartbeat-only Devices as having fresh Endpoint readings.

**Device registration/editing**  
Convert the long form into logical sections or wizard steps:

**Step 1 — Identity**
- Device ID (immutable after creation), display name, description, Room, device type.

**Step 2 — Transport**
- MQTT v1, HTTP JSON v1, Camera JPEG, or existing Legacy profile.
- Explain whether a private LAN IPv4 address is required.
- Explain that changing the address changes the server-side destination, not the controller's network configuration.
- Show only relevant fields for the selected transport.

**Step 3 — Endpoints**
- Add/remove Endpoint rows.
- Endpoint Key, Label, Kind, Data Type, Unit, Readable/Writable, limits/allowed values where supported.
- Show allowed combinations using current capability metadata and validation.
- Reject incompatible kind/data-type combinations before submit.
- Explain that adding an Endpoint definition does not create arbitrary hardware/transport support.

**Step 4 — Review**
- Read-only summary of Device ID, Room, transport, destination, and Endpoint definitions.
- Confirm before creation/update.

Keep immutable-ID and Endpoint schema constraints. Server validation remains final authority.

**Device detail**
- Header: friendly name, Device ID, Room, transport, enabled/archive/maintenance state.
- Device heartbeat/liveness and Endpoint freshness as separate facts.
- Last heartbeat, last telemetry, firmware/protocol/manifest metadata when reported.
- Admin actions grouped into a compact toolbar/menu.
- Sections: Endpoint widgets; Endpoint freshness; manifest drift; MQTT identity/provisioning instructions; recent command lifecycle/history; Device specification/server-side destination; maintenance/archive/restore.
- Do not show secret broker credentials. A provisioning command may be displayed, but generated credentials remain in protected host-side workflow.

### 5.4 Endpoint widgets and history

**Route:** /app/devices/:deviceId/endpoints/:endpointKey

Preserve the generic widget contract. Use capability/data-type metadata rather than hard-coded sensor names.

| Capability / data type | UI presentation | Allowed action |
|---|---|---|
| SENSOR / NUMBER | Numeric metric, unit, freshness, compact trend | Read-only; alarm eligibility supported |
| SENSOR / BOOLEAN | Clear active/inactive/unknown state | Read-only; boolean alarm eligibility supported |
| SWITCH / ENUM or BOOLEAN | Reported state plus approved ON/OFF control | Admin-only; only when Endpoint/Device/profile allow it |
| ACCESS / ENUM | Door/access state and dedicated audited safety action | No generic writable toggle |
| CAMERA / MEDIA | Authenticated snapshot preview and capture status | Read-only preview via backend proxy |

History page:
- Endpoint title, Device link, current/last value, unit, last observation.
- Time range selector using server-supported from/to query parameters.
- Trend chart for numeric/boolean samples only.
- Empty/unknown states for no valid samples.
- Recent samples table and CSV export.
- Disclose the returned sample window; do not imply unlimited/full-history export when only a bounded result was fetched.

### 5.5 Network & Connectivity — proposed new page

**Route:** /app/network

**Purpose:** Give operators one visual explanation of the local communication path and observed state of each registered Device.

**Proposed sections**
1. **Local platform path:** Operator Browser → Nginx Frontend → Node.js Backend → SQLite; Backend → MQTT Broker (if enabled); Broker-mediated MQTT Devices; registered direct HTTP/JSON and camera destinations. Use a local SVG/CSS topology diagram; no external graph library is required for the first release.
2. **Service connection cards:** Backend readiness; MQTT Disabled/Standby, Connected, Disconnected, or Degraded; WebSocket Telemetry/Notifications/MFA; SQLite health and journal mode.
3. **Device connectivity table:** Device, Room, Transport, configured server destination (where applicable), MQTT identity status, Device heartbeat, Endpoint freshness, manifest drift.
4. **Connectivity explanation:** MQTT_V1 is broker-routed and needs no direct node IP; HTTP_JSON_V1 uses a bounded backend request to a registered private LAN destination; CAMERA_JPEG uses the authenticated backend snapshot proxy; LEGACY_V1 retains legacy integration semantics.

**Explicit limits**
- No subnet scan or automatic IP discovery in this phase.
- A registered IP is not proof that the physical Device is configured with that IP.
- No broker credentials or arbitrary topic publishing.
- A connected central MQTT broker does not prove every Device is online.
- If evidence is unavailable, label it Unknown/Not reported.

### 5.6 Alarms & Monitoring Rules

**Route:** /app/alarms

Recommended internal tabs:
- Active & Historical Alarms
- Monitoring Rules

Alarm list:
- Critical first, then Warning, then Info if the API returns Info for that record.
- Filters: state, severity, Room, Device, search, time range, page.
- Show title, severity, source Device/Endpoint, Room, opened age, current state, actions.
- Alarm detail exposes current evidence and available event timeline.
- Acknowledge/Resolve dialogs explain the action and use the existing comment contract.
- Show actor/timestamp after API confirms update.
- Viewer sees read-only details; backend continues to enforce mutations.

Rule editor:
- Filter by Room/Device.
- Show target Endpoint, condition type, threshold/recovery, dwell, severity, enabled/paused.
- Numeric thresholds only for numeric sensors; boolean rules only for boolean sensors.
- Explain dwell and recovery/hysteresis in plain language.
- Do not present rules for SWITCH, ACCESS, or CAMERA where backend does not support them.
- Preserve optimistic version checks and show HTTP 409 conflicts.

### 5.7 Notifications

**Route:** /app/notifications

- Treat as a personal operator inbox, not the same view as Alarm management.
- Summary: unread count and available severity/category breakdown.
- Filters: unread/read, severity, category, search, Device/Room, time range, page where supported.
- Each notification includes title, message, severity, category, timestamp, read status, source/deep link where possible.
- Support mark read/unread and mark-all-read with explicit success/failure feedback.
- Notification WebSocket messages are invalidation signals; after receiving one, refetch the authenticated user's scoped records through the API.
- Preserve per-user notification preferences. Show sound setting only when browser behavior and preference are actually implemented/tested.
- Do not play sound unexpectedly; critical sound must be explicitly controlled.

### 5.8 Events & Audit Explorer

**Route:** /app/events

- Organize event sources: access, telemetry, system errors, command audit, admin/management audit.
- Keep tables/projections server-allowlisted and role-protected.
- Filters: source, severity/outcome where present, Device, Room when available, time range, search, pagination.
- Show structured record details in a side panel/modal rather than dumping large JSON by default.
- Keep CSV export limited to currently loaded/filtered records and label the exported time window.
- Distinguish source timestamp from browser receipt timestamp when both exist.
- Never export secrets or hidden credential fields.

### 5.9 Diagnostics

**Route:** /app/diagnostics

Organize by category:
- Platform: version/release stage, process uptime, startup time, monitoring error.
- Database: SQLite health, WAL mode, foreign keys, backup status only if authoritative data exists.
- MQTT: enabled/standby/connected, subscription readiness, observed nodes where available.
- WebSocket: connected client counts by channel.
- Devices: heartbeat and Endpoint freshness.
- Deployment posture: safe, non-secret configuration indicators.
- Simulator: visible only when backend confirms isolated simulator mode, with prominent SIMULATION label.

Do not display environment secrets, cookie values, password data, broker credentials, or raw sensitive logs. Do not equate software release readiness with physical hardware acceptance. Keep diagnostics read-only unless a separate safe operation is approved.

### 5.10 Users & Access

**Route:** /app/users

Make the identity boundary explicit with separate tabs:

1. **Dashboard Operators**
   - Login username, role, account state, safe metadata, actions.
   - Account creation/deletion and role changes as supported.
   - Preserve last-Admin protection and session revocation behavior.

2. **Facility People & Physical Credentials**
   - Physical person name, department, active/suspended state, credential count, masked metadata.
   - Credential types and status; no raw PIN/card secrets.
   - Enrollment workflow states such as Pending/Awaiting Reader/Confirmed/Cancelled/Expired only when returned by server.
   - Explain that storing credentials in SQLite and syncing them to physical firmware are separate states. Never label Pending Device Sync as enrolled/active on hardware.

Admin-only enforcement remains server-side even when UI elements are hidden.

### 5.11 Settings

**Route:** /app/settings

Organize settings into explicit groups:
- Facility Profile: name, description, location, timezone.
- Registered Device Destinations: supported server-side destination settings, with per-transport explanation.
- Operational defaults/preferences only where a current backend field exists.
- System/deployment information as read-only guidance.

Do not place host firewall, Docker, Netplan, broker password, TLS private keys, or arbitrary server configuration in the browser dashboard unless a secure backend administration workflow is designed and approved.

Explain clearly:
- Facility/Room names are organizational metadata.
- Device IP/Port/Path values configure where the backend sends a request.
- They do not change a board's static IP, DHCP lease, Wi-Fi, or Ethernet configuration.
- Dashboard bind address and LAN exposure are deployment/installer settings, not a browser preference.

### 5.12 Profile and sign-in

**Routes:** /app/profile, /login

- Retain dark/light theme preference.
- Show current username and server-verified role.
- Password update flow preserves validation and session semantics.
- Explain session expiry and sign-out state clearly.
- Keep password visibility toggle accessible; never reveal credentials in browser logs.
- Login retains safe relative redirect behavior and clear rate-limit/invalid-credential/network error messages.

---

## 6. Design system and shared UI component backlog

Implement reusable primitives in the existing Vanilla JS/CSS structure. Avoid creating an abstraction layer harder to maintain than the pages.

| Component / primitive | Purpose | Required variants/states |
|---|---|---|
| PageHeader | Title, description, breadcrumbs/context, primary action | Default, compact, action group |
| StatusBadge / StatusLine | State label with icon and semantic color | Healthy, warning, critical, info, pending, unknown, disabled, archived, standby |
| MetricCard | Value with title and supporting detail | Normal, warning, critical, loading, unknown |
| SectionCard | Consistent titled content region | Standard, compact, collapsible only if useful |
| EmptyState | No data or no filter match | First setup, no records, no matches, unavailable |
| LoadingSkeleton | Reserve layout while loading | KPI, card, table row, detail header |
| ErrorPanel | Safe error/retry surface | Section-level and page-level |
| FilterBar | Search, selects, time range, clear filters | Desktop/mobile wrapping |
| DataTable | Accessible data table | Loading, empty, responsive wrapper |
| ResponsiveRecordCard | Mobile equivalent for dense records | Device, Room, Alarm, Event |
| IconButton | Accessible icon-only action | Tooltip, aria-label, disabled |
| Modal/Drawer | Forms and record detail | Focus handling, Escape, close, loading/error |
| ConfirmDialog | Destructive or safety-sensitive action | Standard and danger with context |
| Toast/InlineFeedback | Mutation outcome | Success, info, warning, error |
| TrendChart | Existing local SVG chart abstraction | Numeric series, empty, unknown, insufficient samples |
| Timeline | Alarm/command/event sequence | Timestamp, actor/source, status, evidence |
| StatusLegend | Explain semantic colors | Full and compact |
| CopyableValue | Copy non-secret IDs/IP/topic references | Copy feedback and accessible label |

### Component standards

- Semantic HTML and correct heading levels.
- All interactive controls keyboard accessible.
- Visible focus ring; do not remove outline without replacement.
- Buttons have clear labels and disabled/loading states.
- Inputs have labels, helper text, error text, and correct autocomplete/type attributes.
- Modal dialogs should trap focus, restore focus to opener, and close predictably. Audit the current openModal helper before treating it as fully accessible.
- Use textContent/safe DOM helpers. Avoid innerHTML for untrusted values.
- No status is indicated solely by color.
- Support reduced-motion preference; animations are subtle and nonessential.

---

## 7. Technical implementation strategy

### 7.1 Keep the current frontend stack

Continue with Vanilla JavaScript ES modules, Vite production build, existing History API router, shared store, centralized API client, CSS tokens, and local SVG assets.

**Do not introduce React, Vue, Tailwind, a remote component library, or a chart CDN during this roadmap.** The current stack builds quickly, has no runtime framework, is compatible with local/air-gapped deployment, and is covered by Playwright smoke tests. A framework migration would add risk without solving the immediate UX problems. Any later migration needs a separate Architecture Decision Record (ADR), measured justification, offline dependency review, and migration acceptance plan.

### 7.2 Proposed source organization

Retain the current folder structure initially. Introduce small modules only when reused by at least two screens or when separation improves testability.

Suggested additions (proposals, not mandatory):
- frontend/components/status.js — semantic status/icon helpers.
- frontend/components/pageHeader.js — page heading and actions.
- frontend/components/feedback.js — empty/loading/error states.
- frontend/components/filterBar.js — common filters.
- frontend/components/dataTable.js — reusable table behavior.
- frontend/pages/network.js — proposed Network & Connectivity page.
- frontend/design-tokens.css — only if moving tokens out of styles.css improves maintainability.

Before creating a new component, inspect existing helpers in frontend/utils.js and frontend/store.js. Reuse rather than duplicate modal, toast, formatting, and chart code.

### 7.3 Page data lifecycle

Each page must define:
- Required API data.
- Calls that can run in parallel.
- Whether a failure affects the whole page or only one section.
- Whether live WebSocket events should invalidate/refetch the page.
- How the page cleans subscriptions/timers on route change.
- What stale cached data can be shown, and how it is labelled.
- How refresh is triggered and duplicate requests are prevented.

Preserve the router cleanup contract: page views may return a cleanup function. Ensure listeners and timers are removed on navigation.

### 7.4 API-client contract gaps to address

The backend's shared list query schema already supports parameters that some frontend wrappers do not expose. Prefer expanding frontend/api.js before changing backend routes.

| Frontend API method | Current wrapper behavior | Existing backend support / improvement |
|---|---|---|
| api.listAlarms | state, severity, Room, Device, limit | Extend wrapper for supported search, page, from, to; verify response shape in tests |
| api.listNotifications | unread, severity, limit | Extend wrapper for search, category, page, Device/Room, from/to where accepted |
| api.getEndpointHistory | limit only | Expose server-supported from/to query parameters |
| api.listDevices | Room, transport, search, include archived | Keep within actual /registry route schema; do not pass arbitrary filters that the route rejects |
| api.listRooms | status/search simplified to active or include archived | Confirm archive/status semantics and preserve expected behavior |

For every wrapper extension:
- Add unit/integration coverage or expand existing route tests.
- Validate query serialization, especially empty values and date ranges.
- Keep the API client same-origin and cookie-authenticated.
- Preserve CSRF on all non-safe methods.
- Keep ApiError status/code/details behavior.
- Do not swallow failed requests or convert them to successful empty data.

### 7.5 Backend change gate

Backend work is allowed only when:
1. A specific user-visible interaction is approved.
2. The current backend contract cannot satisfy it.
3. The missing contract is documented with request/response schema, role permission, error cases, and audit requirement.
4. The change does not violate local-first, security, or edge-safety boundaries.
5. Automated test cases are defined before implementation.

Backend additions should use:
- Zod schema validation in the matching validator module.
- Route-level auth/RBAC and rate limiting.
- Service/repository ownership rather than business logic inside route handlers.
- Safe response projections.
- Request ID/audit context for mutations.
- Additive SQLite migration only where persistence is truly required.
- Unit + integration tests for valid/invalid payloads, Admin/Viewer, CSRF, conflicts, persistence, and failure cases.

Do not create new tables for purely presentational preferences unless cross-session/account persistence is a confirmed requirement.

---

## 8. Phased delivery plan and engineering backlog

Each phase should be a separate feature branch/PR or a small coherent PR set. Keep main deployable. Do not merge a phase until its acceptance checklist passes.

### Phase 0 — Baseline, evidence, and UX inventory

**Goal:** Freeze a known working baseline before visual modifications.

Tasks:
- [ ] Confirm repository HEAD and clean working tree.
- [ ] Install from lockfile using npm ci.
- [ ] Run npm run lint, npm test, npm run build, and npm run test:ui.
- [ ] Save baseline screenshots for every authenticated route at 1440px and 390px.
- [ ] Record console errors, page errors, failed requests, external requests, and route failures.
- [ ] Build a route-to-API inventory documenting every data dependency and action.
- [ ] Build a role/permission matrix for Admin and Viewer.
- [ ] Record which UI states are missing or misleading.
- [ ] Confirm which statuses reflect server evidence and which are browser-derived hints.
- [ ] Review docs/FRONTEND_DOCUMENTATION.md and mark legacy descriptions to correct after implementation.

**Deliverables:** baseline test report, screenshot set, route/API matrix, role matrix, UX issue backlog.

**Exit gate:** all baseline results are recorded; existing failures are separated from new regressions.

### Phase 1 — Design system and global shell

**Target files:** styles.css, index.html, frontend/pages/shell.js, frontend/utils.js, optional shared components.

Tasks:
- [ ] Define semantic design tokens for surfaces, borders, typography, spacing, radii, elevation, focus, and statuses.
- [ ] Preserve dark graphite default and light neutral theme.
- [ ] Normalize colors so healthy/warning/critical/info/pending/unknown states match global semantics.
- [ ] Standardize icon sizes and add missing local SVG sprite symbols.
- [ ] Improve sidebar grouping, active route, collapsed state, labels/tooltips, and mobile drawer.
- [ ] Improve topbar hierarchy, page title, breadcrumbs, notification entry, connection summary, and user menu.
- [ ] Add reusable PageHeader, Status, Empty, Loading, Error, and Filter primitives where they reduce duplication.
- [ ] Improve modal focus handling, Escape handling, focus restoration, and accessible labels.
- [ ] Ensure keyboard focus and reduced-motion behavior remain usable.
- [ ] Add a clear local server/host context using the browser's current origin, not a hardcoded IP.
- [ ] Review CSS breakpoints and overflow behavior.

**Exit gate:** shared shell is consistent across routes; keyboard navigation works; desktop/mobile layout has no horizontal overflow; zero external asset requests.

### Phase 2 — Overview redesign

**Target files:** frontend/pages/overview.js, frontend/api.js, styles.css, shared components.

Tasks:
- [ ] Implement Facility header and concise system context.
- [ ] Redesign KPI cards with explicit values, units, labels, and supporting detail.
- [ ] Separate central service readiness from Room/Device health.
- [ ] Redesign Room grid with status and drill-down actions.
- [ ] Add prioritized Attention Queue based only on API-backed alarms/pending Devices/drift.
- [ ] Add concise recent activity preview if a reliable source is available.
- [ ] Keep loading, partial failure, empty, stale, and unknown states explicit.
- [ ] Connect cards to relevant filtered pages only when supported.
- [ ] Avoid full-page rerender on every telemetry frame where targeted update is possible.

**Exit gate:** Overview communicates actual state without fabricated values; key issue can be traced to its source quickly; current API error behavior is preserved.

### Phase 3 — Rooms and Device workflows

**Target files:** frontend/pages/rooms.js, frontend/pages/devices.js, frontend/widgets.js, frontend/api.js, shared components, styles.css.

Tasks:
- [ ] Improve Rooms directory and Room Detail hierarchy.
- [ ] Improve Device inventory filters and responsive table/cards.
- [ ] Redesign Device registration/edit form into Identity, Transport, Endpoints, and Review groups.
- [ ] Add contextual transport explanations and dynamic field visibility.
- [ ] Add Endpoint compatibility hints from capability metadata.
- [ ] Improve Pending Device Quarantine and Manifest Drift presentation.
- [ ] Improve Device Detail sections for liveness, Endpoint freshness, MQTT identity, transport, commands, and maintenance.
- [ ] Improve Endpoint widgets with consistent labels, icons, values, freshness, and last-update text.
- [ ] Improve history date-range selection using existing backend support.
- [ ] Improve move/archive/restore/maintenance confirmation and result feedback.
- [ ] Preserve immutable Device ID, optimistic concurrency, strict Endpoint schema, and Admin/Viewer gates.

**Exit gate:** Admin can add a Room, register a supported Device, define compatible Endpoints, inspect the Device, and understand onboarding status without bypassing backend validation. Viewer remains read-only.

### Phase 4 — Network & Connectivity view

**Target files:** new frontend/pages/network.js, frontend/router.js, frontend/pages/shell.js, frontend/api.js, styles/shared components.

Tasks:
- [ ] Add route /app/network.
- [ ] Build local visual topology: Browser → Nginx → Backend → SQLite/MQTT → registered Devices.
- [ ] Show service states using /api/health/ready and diagnostics.
- [ ] Show registered Devices with transport, configured server destination, heartbeat, Endpoint freshness, and drift.
- [ ] Distinguish MQTT broker connection from each Device's last heartbeat.
- [ ] Add links to Device Detail and Diagnostics.
- [ ] Provide explicit legend and evidence/last-observed timestamps.
- [ ] Show Unknown when data is unavailable; do not infer connection state from missing data.
- [ ] Keep diagram responsive and understandable without animation.

**Exit gate:** every visual link/state has a defined source and truthful meaning; no claim of automatic discovery or physical IP configuration.

### Phase 5 — Monitoring: alarms, notifications, events

**Target files:** frontend/pages/operations.js, frontend/api.js, frontend/store.js, relevant backend tests only if an API gap is proven.

Tasks:
- [ ] Separate Alarm list and Rule editor into clear sections/tabs.
- [ ] Improve severity/state/Room/Device/search/time-range filters.
- [ ] Expand frontend wrappers to expose already-supported query filters.
- [ ] Add paging/bounded result navigation where supported.
- [ ] Add Alarm detail/evidence/timeline using existing data contract.
- [ ] Improve acknowledge/resolve dialogs and outcome feedback.
- [ ] Redesign Notifications as a scoped inbox with read/unread and severity/category filters.
- [ ] Ensure notification WebSocket messages trigger scoped API refresh, not direct untrusted UI insertion.
- [ ] Improve Event/Audit source navigation, filters, record detail, timestamps, and CSV export labels.
- [ ] Preserve privacy and Admin-only audit/user table restrictions.

**Exit gate:** alarm transitions are clear and audited; notification state is accurate per user; filtered/exported records match visible data; no private data leaks between users.

### Phase 6 — Administration, people/access, settings, diagnostics

**Target files:** frontend/pages/admin.js, frontend/pages/login.js, frontend/pages/shell.js, frontend/api.js, shared components.

Tasks:
- [ ] Improve Diagnostics grouping and evidence.
- [ ] Separate Dashboard Operator and Physical Access People workflows visually and conceptually.
- [ ] Improve credential enrollment state display using existing session status/API.
- [ ] Distinguish database-stored credentials from physical-device synchronization.
- [ ] Improve operator creation, role, deletion, and last-Admin error messages.
- [ ] Improve Facility settings form, revision display, and conflict handling.
- [ ] Distinguish Device server-destination settings from physical NIC/IP configuration.
- [ ] Improve Profile and Login hierarchy and validation states.
- [ ] Keep simulator controls visible only in isolated simulator mode with an unmistakable banner.
- [ ] Ensure Viewer cannot access Admin routes/actions even by direct URL or forged requests.

**Exit gate:** identity boundaries, credentials, configuration, and role restrictions are explicit; no sensitive values appear in the browser.

### Phase 7 — Backend/API compatibility (only approved gaps)

This phase can run alongside Phases 2–6 only when a specific UI dependency is identified.

Candidate work, in preferred order:
1. **Frontend API wrapper expansion** for query filters the backend already supports. This is frontend work and can be completed in the relevant phase.
2. **Read-only aggregation endpoint** only if Network/Overview demonstrably needs a server-computed aggregate not already available from /overview or /diagnostics.
3. **Server-side pagination/search for a specific collection** only if current routes are insufficient for real data volume. Define bounded limits and indexes based on measured needs.
4. **Persisted UI preferences** only if cross-browser/session persistence is confirmed and current local preferences are inadequate.
5. **New data fields/tables** only if a signed-off feature cannot be supported by current Facility/Room/Device/Endpoint/Alarm/Notification models.

For each backend change:
- [ ] Write an API contract proposal first.
- [ ] Define Admin/Viewer permissions and CSRF needs.
- [ ] Define validation and error cases.
- [ ] Add service/route/validator tests.
- [ ] Add migration only if persistent schema is required.
- [ ] Verify backup/restore and migration compatibility.
- [ ] Update frontend client and tests in the same change set.
- [ ] Update relevant docs and API contract matrix.

**Exit gate:** no backend change is speculative; all new contracts are validated and regression-tested.

### Phase 8 — Final integration, accessibility, and release candidate

Tasks:
- [ ] Run lint, backend tests, production build, and Playwright smoke tests.
- [ ] Expand Playwright coverage for new navigation, forms, filters, and representative detail states.
- [ ] Add screenshot comparison/manual visual review at defined viewports.
- [ ] Validate contrast, keyboard-only navigation, focus, labels, dialog behavior, and screen-reader status announcements.
- [ ] Verify all routes with Admin and Viewer.
- [ ] Simulate failed API requests, MQTT disconnected/standby, no telemetry, stale telemetry, manifest drift, pending Device, and notification invalidation.
- [ ] Verify zero external network requests.
- [ ] Verify no direct MQTT browser connection.
- [ ] Verify production build is served through Nginx and same-origin API/WebSocket proxy remains intact.
- [ ] Update docs/FRONTEND_DOCUMENTATION.md and relevant architecture/release docs to describe the actual UI.
- [ ] Record screenshots and test outputs as release evidence.
- [ ] Take and verify a database backup before deploying frontend/backend changes to a live installation.
- [ ] Keep rollback instructions available; never use volume-destructive compose commands for routine UI deployment.

**Exit gate:** CI and UI acceptance checks pass, deployment bundle is local/offline compatible, and release notes distinguish software verification from physical hardware acceptance.

---

## 9. API and backend contract matrix

| UI feature | Existing source | Backend change expected now? | Notes |
|---|---|---|---|
| Overview KPIs | /api/v1/overview, /api/health/ready | No | Use current data and preserve partial error states |
| Rooms and Room Detail | /api/v1/rooms, /api/v1/rooms/:id | No | Versioned update/archive already exists |
| Device registry and detail | /api/v1/registry, /api/v1/registry/:id | No | Use supported query schema; no network discovery |
| Endpoint widget definitions | /api/v1/capabilities and Device Endpoint schema | No | Use generic capability metadata |
| Endpoint trends | /api/v1/registry/:id/endpoints/:key/history | Probably no | Expose existing from/to in frontend wrapper |
| Network view | /api/v1/diagnostics, /api/health/ready, registry | No for first iteration | Add aggregate endpoint only if current response shapes prove insufficient |
| Alarms | /api/v1/alarms, detail, acknowledge/resolve | No initially | Expand API wrapper for supported filters; verify detail response |
| Rules | /api/v1/rules | No | Preserve SENSOR-only rule contract |
| Notifications | /api/v1/notifications, read/read-all, preferences, WS invalidation | No initially | Extend wrapper for supported query parameters |
| Events/audit | /api/logs/*, /api/v1/commands, /api/v1/management-audit | Maybe later | New query/pagination only if bounded logs do not meet measured usage |
| Users/People | Existing auth, people, credentials, operator routes | No initially | Match actual route contract; never expose secrets |
| Diagnostics | /api/v1/diagnostics, /api/health/ready | No initially | No secrets or unsupported health assertions |
| Settings | /api/v1/facility and management settings routes | No initially | Keep destination semantics clear |

**Implementation rule:** a UI requirement must not translate directly into a new database column or route. First inspect whether existing data can produce the required view. Prefer composing existing API responses or expanding frontend query wrappers.

---

## 10. Testing and acceptance matrix

### 10.1 Functional regression

- [ ] Public Landing loads.
- [ ] Unauthenticated deep link redirects to Login with safe relative return path.
- [ ] Admin login/logout work.
- [ ] Viewer login/logout work.
- [ ] Session expiry redirects and clears live streams.
- [ ] Overview loads with data and with no configured Rooms/Devices.
- [ ] Room create/edit/archive/restore works and preserves historical-data semantics.
- [ ] Device registration/edit/move/archive/restore works.
- [ ] MQTT_V1 can be registered without a direct IP.
- [ ] HTTP_JSON_V1/CAMERA_JPEG enforce private destination requirements.
- [ ] Endpoint kind/data-type incompatibility is rejected.
- [ ] Pending Device and manifest drift states are visible without auto-approval/schema mutation.
- [ ] Endpoint widgets correctly represent live, stale, unknown, disabled, archived.
- [ ] Endpoint history and CSV export use the expected sample window.
- [ ] Alarm acknowledge/resolve is Admin-only and comment-backed.
- [ ] Rules are only created for supported Endpoint capabilities.
- [ ] Notification read/unread is scoped to current operator.
- [ ] Event/audit access remains role-protected and secret-safe.
- [ ] Operator and physical-person records remain separate.
- [ ] Admin settings conflicts display a recoverable message.
- [ ] Emergency access control retains explicit confirmation and audit behavior.

### 10.2 Responsive checks

Minimum test viewports:
- Desktop: 1440 × 900.
- Laptop: 1280 × 800 and 1024 × 768.
- Tablet: 768 × 1024.
- Mobile: 390 × 844 and 360 × 800.

Acceptance:
- No page-level horizontal overflow.
- Navigation is reachable by keyboard/touch.
- Tables are scroll-contained or transform into readable stacked cards.
- Dialogs fit viewport and can scroll internally.
- Topbar content does not overlap.
- Important status text is not clipped or conveyed by color alone.

### 10.3 Accessibility checks

Target WCAG 2.2 AA as the design objective:
- Text contrast and focus indicators.
- Keyboard navigation across sidebar, topbar, forms, tables, menus, and dialogs.
- Visible focus states.
- Semantic heading order and landmarks.
- Accessible names for icon-only buttons.
- Labels and inline validation for every form field.
- Focus trap/restoration for modal dialogs.
- ARIA live announcements for important asynchronous results, not noisy full-page updates.
- Reduced-motion support.
- Charts have equivalent textual values and table data.

### 10.4 Security and local-first checks

- [ ] Zero external runtime requests in Playwright.
- [ ] No CDN/remote font/icon dependency.
- [ ] Browser requests are same-origin for APIs and WebSockets.
- [ ] No direct MQTT connection from browser.
- [ ] CSRF token remains present on mutations.
- [ ] Viewer cannot mutate by hiding/unhiding UI.
- [ ] Server role enforcement is tested directly.
- [ ] No credential/hash/session/broker secret in response rendering or export.
- [ ] Inputs continue to use safe DOM/text APIs.
- [ ] CSP and Nginx deny rules remain correct.
- [ ] Camera requests continue through authenticated backend proxy.
- [ ] Destructive actions require confirmation.

### 10.5 Observability and regression evidence

For each PR, report:
- Commands run and pass/fail.
- Tests added/changed.
- Screenshots of changed pages at desktop/mobile.
- New/changed routes and API contracts.
- Intentional UI behavior changes.
- Unresolved items or unsupported states.
- Bundle size change and any new local dependency.
- Confirmation of zero external requests and zero browser console/page errors.

---

## 11. Visual quality acceptance criteria

A phase is not complete just because the page builds. It must pass:

1. **Hierarchy:** the page's primary task is obvious within the first screen.
2. **Scanability:** operators distinguish important status/number/action without reading every field.
3. **Consistency:** shared components have the same behavior and meaning across pages.
4. **Context:** every detail view identifies its Facility/Room/Device/Endpoint context.
5. **Evidence:** every operational state has a defined data source and, where useful, last-observed time.
6. **Action clarity:** primary, secondary, destructive, and unavailable actions are visually distinct.
7. **Error recovery:** errors explain what failed and offer a safe next step.
8. **Truthfulness:** unknown data is not rendered as healthy zero; sent command is not rendered completed without confirmation.
9. **Responsive behavior:** no clipped controls, unusable tables, or overlapping navigation.
10. **Local operation:** interface remains usable without internet access.

---

## 12. Implementation discipline and pull-request workflow

1. Start every implementation phase from latest green main.
2. Use a dedicated feature branch for one coherent phase or small related task set.
3. Avoid mixing broad visual changes with database migrations unless the UI truly depends on a new contract.
4. Prefer small PRs reviewable against screenshots and acceptance criteria.
5. Keep existing routes working while pages are redesigned.
6. Do not remove old behavior until its replacement is tested.
7. Do not run destructive data migrations for UI convenience.
8. Never commit .env, credentials, generated passwords, broker passwd files, SQLite production data, or local secrets.
9. Keep package-lock.json synchronized if a reviewed dependency is added/removed.
10. Do not merge PRs with failing CI or unresolved security/safety concerns.
11. After merge, deploy via the documented updater/release procedure and take a verified SQLite backup first.
12. Record on-host deployment results separately from CI and simulator results.

---

## 13. Open decisions to settle during visual design

These are intentionally not hard-coded assumptions. Decide them with a design mock/screenshot review before locking implementation:

- [ ] Final product naming/branding treatment (LCI-SFM remains baseline).
- [ ] Exact dark/light palette values after contrast checks.
- [ ] Whether Rooms and Devices need both grid and table modes or one adaptive layout is sufficient.
- [ ] Whether Network topology should be static or interactive in first release. Recommendation: start static and evidence-led.
- [ ] Whether Overview shows a small event preview or only critical attention items.
- [ ] Which notification categories are filterable based on actual backend values.
- [ ] Whether event record detail uses modal, side drawer, or dedicated route.
- [ ] Whether operator preference persistence needs to be per-browser or per-account.
- [ ] Whether any collection has enough production data to justify server-side paging/aggregation beyond current support.

Do not block design-system and Overview work on decisions that do not affect them.

---

## 14. Recommended execution order

The recommended critical path is:

Baseline Audit → Design Tokens & Shared Shell → Overview → Rooms & Devices → Network & Connectivity → Alarms/Notifications/Events → Admin/Diagnostics → Contract Gaps → Full Regression & Release

This order creates visible value early while preserving the existing working application. Network is scheduled after Device inventory/detail because it depends on those transport semantics being clear first.

### Definition of Done — overall frontend modernization

The roadmap is complete only when:
- All agreed pages are redesigned with one consistent design system.
- Existing functional routes and protected navigation still work.
- The Device/Endpoint engine remains generic and schema-driven.
- Current backend is reused wherever it already supports the UX.
- Required backend contract changes are validated, documented, and tested.
- Admin/Viewer and physical-access safety boundaries remain intact.
- The application remains local-first and air-gap ready with zero external runtime requests.
- Desktop/mobile/accessibility acceptance checks pass.
- Backend tests, lint, production build, and Playwright smoke tests pass.
- Frontend documentation and release evidence match the delivered implementation.
- Deployment and rollback are verified with a protected database backup.

---

## 15. Final implementation principle

**Make the system easier to understand before making it capable of doing more.**

LCI-SFM already has a meaningful operational and data model. The immediate priority is to make that model visible, predictable, and easy to operate. Build the UI around real Facility → Room → Device → Endpoint relationships, verified service/device evidence, and safe workflows. Expand backend behavior only when the approved experience demonstrates a real contract gap.