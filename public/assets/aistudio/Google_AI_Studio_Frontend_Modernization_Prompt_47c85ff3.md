# Prompt for Google AI Studio — LCI-SFM Frontend Modernization

You are modifying an existing, working codebase: **LCI-SFM (Smart Facility Management System)**. Your assignment is to modernize the **frontend first**. This is a real operations dashboard with authentication, RBAC, telemetry, networked edge devices, audit logs and hardware-actuation controls—not a static marketing page.

## Repository context

Repository: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System  
Review `main` and read these files completely before editing:

- `index.html`
- `styles.css`
- `app.js`
- `package.json`, `package-lock.json`, and any Vite config that exists
- `docker-compose.yml`, `nginx/nginx.conf`
- `backend/src/routes/apiRoutes.js`
- `backend/src/middleware/auth.js`
- `backend/src/config/env.js`
- `backend/src/utils/crypto.js`
- `backend/test/backend.test.js`
- `docs/FRONTEND_DOCUMENTATION.md` and `docs/BACKEND_ARCHITECTURE.md`

The current frontend is built with **vanilla JavaScript + HTML + CSS**. The package file may include React and `lucide-react`, but the current dashboard is not implemented as a React app. Do not migrate frameworks or add a React component layer as part of this task. Build output is produced in `dist/` and, in the deployed architecture, Nginx serves it and proxies `/api/` and `/ws/` to the Node.js backend.

## The mission

Make the dashboard more modern, compact, clear, icon-consistent and easier to operate, especially because the current `index.html` contains a lot of repetitive user-facing text and several stale implementation explanations. Keep the existing functionality and backend integration intact. First inspect, then implement a controlled redesign with a clear diff and regression evidence.

**Frontend-first means:** prefer changes to `index.html`, `styles.css` and the smallest necessary parts of `app.js`. Touch backend files only if you can point to a real integration defect or a specific frontend requirement that cannot be supported by the existing API. If a backend adjustment is needed, keep it small, test it and explain it separately. Do not redesign APIs or the database.

## 1. Current application areas you must preserve

The existing dashboard contains:

1. Login overlay with username/password, central-host override, authentication status and an offline/read-only inspection option.
2. Collapsible sidebar and top bar with six views, operator/role/session state, live data freshness, clock/date, fullscreen, theme and endpoint settings.
3. View 1 — Command Center: facility status banner, door/lock, temperature, humidity, smoke/gas, fan/light, MFA/connection snapshots, topology, hardware command buttons and recent events.
4. View 2 — Smart Access & Security: access/door status, 2-of-3 MFA, Node 3 camera snapshot and recent access logs.
5. View 3 — Environment & Actuator Control: gauges, trend charts (live/SQLite/aggregate modes), auto/manual control and fan/light actuation.
6. View 4 — Audit Explorer: table selection, filters, search, refresh, record detail inspection, CSV export and pagination.
7. View 5 — Diagnostics: central API/WebSocket states, node diagnostics and system-error logs.
8. View 6 — Administration: personnel provisioning, RFID/PIN, optional camera capture, admin-profile settings, endpoint settings, and user-role management. This area is restricted by existing Admin/RBAC checks.
9. Shared toast notifications, endpoint configuration, command confirmation and record-detail modals.

Do not delete a screen, control or feature simply because it makes the HTML shorter. If you consolidate a region, preserve its underlying behavior and map it to its old trigger/state.

## 2. Visual redesign requirements

Aim for a modern professional Building Management System / HMI console: calm, structured, dense enough for operations, but not like a wall of text. The interface should let an operator answer these questions immediately:

- Is the overall facility state normal, warning, critical, unknown, or offline?
- Is the displayed data fresh and verified?
- Which node/subsystem needs attention?
- What actions can the current role execute?
- What will an action do, and did it succeed, fail, remain pending, or receive a device acknowledgement?

Retain the existing dark/light theme and CSS-token-based palette unless there is a demonstrated contrast issue. The existing dark canvas is around `#090e17`, cards `#111a2b`, borders `#1e293b`; light canvas `#f1f5f9`, surfaces `#ffffff`. Existing color semantics include cyan/blue for neutral actions, emerald for healthy/confirmed, amber for warning/stale, rose/crimson for critical/offline and slate for unknown/unverified. Respect the existing CSS design system and improve it incrementally.

### Reduce text density intelligently

- Remove duplicated prose that repeats a card's title, node name, API path, table name or action.
- Convert long technical help paragraphs into compact tooltips, an information popover, or a collapsed “Technical details” section where appropriate.
- Keep developer implementation notes out of the main operator workflow. Put them into documentation or advanced diagnostics when useful.
- Keep the main labels short, consistent and scannable. Use a concise title plus one meaningful line rather than multiple paragraphs.
- Move raw API paths, filesystem details and low-level table names into diagnostics/details where engineers may need them.
- Do not remove meaningful warnings, confirmations, permissions, state labels, units, freshness indicators or validation errors.
- Keep “unknown”, “offline”, “stale” and “no verified data” distinct from healthy and from numeric zero. Never invent/sample telemetry to make the UI look alive.

### Icon system — important

The HTML already has numerous inline SVG icons; standardize and reuse them rather than blindly increasing icon count.

- Use local inline SVG icons or a small inline SVG sprite. Use `currentColor`, a consistent outline style, ideally a 24×24 `viewBox`, and approximately 1.8–2 stroke width.
- Use sizes consistently: 16px compact, 18–20px toolbar/navigation, 22–24px prominent status icons.
- Use standard icon metaphors: grid (overview), shield/door/key (access), thermometer/droplet/activity (environment), list/search/download (audit), network/activity/heart-pulse (diagnostics), users/settings (admin), sun/moon (theme), expand/compress, refresh, camera, sliders, logout/lock, warning, check, clock and info.
- Main actions should normally keep a short visible text label beside their icon. Do not make actuator controls, Admin actions, status indicators or risky commands icon-only.
- Icon-only is acceptable for obvious compact secondary controls such as theme, fullscreen, close, clear-search or collapse-sidebar, but each must have `aria-label`, useful `title`/tooltip, keyboard focus and a sufficiently large click target.
- Decorational SVG icons should have `aria-hidden="true"`. Screen-reader text and accessible names must remain available.
- Preserve the self-contained/offline-friendly approach. No remote fonts, icon CDNs, remote JavaScript, runtime web calls or new third-party dependencies for icons. Do not attempt to import `lucide-react` into the existing vanilla JS app.
- Keep textual state labels alongside colors/icons; color or an icon alone is not enough.

### Layout, accessibility and responsive UX

- Preserve the six-view navigation and meaning. Keep active, hover and keyboard focus states clear in expanded and collapsed sidebar modes.
- Keep the most important facility state and live metrics near the top of the Command Center. Move secondary topology/debug detail lower or under an expansion, but do not remove it.
- Make forms, tables, chart switches, modals, camera placeholders, toast notifications and page transitions consistent.
- Check desktop, laptop/tablet and phone layouts around 1440px, 1024px, 768px and 390px. No clipped high-priority action or hidden status without an alternative.
- Preserve keyboard operation, focus-visible styles, reduced-motion support, semantic buttons/labels, `aria-live` notices, error roles and modal `aria-labelledby` relationships.
- Ensure empty/loading/error/stale/offline states are intentional and understandable.

## 3. Branding: what exists and what does not

Current sidebar branding is static HTML: `.brand-logo` displays `LCI`; `.brand-text` includes `BMS / HMI Console` and `LCI-SFM`. The login panel uses a separate inline shield SVG and an `LCI-SFM` kicker. The sidebar mark does not have a dedicated `id` in the current markup. No current backend endpoint exists for uploading a logo or saving organization branding globally.

For this pass, unify the login/sidebar branding visually, keep the official default name `LCI-SFM`, and make the frontend label/mark easy to maintain in one documented place. Do not add a fake logo-upload button or promise cross-user/global persistence. If a local-only preview is ever added, label it as local-only and do not suggest that the backend saved it. Explain that global branding needs a separate authenticated persistence/API design.

## 4. Configuration and legacy endpoint cleanup — high priority

Current `app.js` stores the central server and edge node addresses in browser `localStorage`:

- `lci_server_host`: central API and WebSocket host, historically configured as `192.168.43.225:1880` for an older Node-RED arrangement.
- `ip_node1`, `ip_node2`, `ip_node3`: independent edge-node addresses.

The current server-side implementation is **Node.js/Express**, served behind Nginx in the deployed architecture. Nginx proxies same-origin `/api/` and `/ws/` to the central backend. Current `app.js` uses a saved `lci_server_host` before falling back to the current browser host, so an old saved address can override the correct same-origin host.

Implement a safe configuration strategy:

1. Make current-origin API requests (`/api/...`) and same-origin WebSockets (`ws(s)://<current-host>/ws/...`) the normal production behavior for the Nginx deployment.
2. Do not let a known old default such as `192.168.43.225:1880` silently keep hijacking requests after the dashboard is served from a newer host/port. If you migrate this known legacy value, make the rule precise and test it. Do not blindly discard a deliberately customized endpoint.
3. Keep an explicit, understandable “Use this dashboard’s server” / reset-to-current-host action if a manual override remains supported. Show the effective central API/WebSocket target in advanced diagnostics.
4. Do not conflate the central API origin with `ip_node1`, `ip_node2`, or `ip_node3`. Edge-node addresses remain independent. In particular, Node 3 camera capture currently requests `http://<ip_node3>/capture.jpg` directly; do not break it by redirecting it to the central API.
5. Audit the login endpoint indicator, endpoint modal, topology, diagnostics and toast text so they all derive from the *effective* configuration, rather than a hard-coded old address.
6. Check local/development mode and the existing Vite/dev setup before deciding how same-origin API calls work there. Add/use an existing dev proxy only if needed; do not break the deployed Nginx architecture.
7. Re-check the current Content Security Policy in `index.html`, including `connect-src` and `img-src`. Do not weaken the policy broadly or add a CDN just to make icons work.

## 5. Correct stale user-facing claims

The front-end currently contains user-facing text describing a central Node-RED endpoint and credential hashing as SHA-256. The current central API implementation is Node.js/Express, and `backend/src/utils/crypto.js` uses `scrypt` for secret hashing. Therefore:

- Replace visible `Node-RED` references with “Central Backend”, “Central API” or “Facility Gateway” where runtime implementation is not an operator concern. Do not rename route paths, topic names, JavaScript identifiers or backend symbols merely to change visible copy.
- Replace inaccurate SHA-256 claims with “Credentials are verified by the central backend. Secret values are never displayed.” Do not hard-code algorithm claims unless they are maintained as accurate documentation.
- Remove fixed `192.168.43.225:1880` examples from default operator text when the runtime address can be different; fill endpoint displays from the effective config.
- Do not expose stale host filesystem paths such as `/home/Bedo/lci_sfm.db` in normal operator UI.
- Remove or relocate the developer note that backend error records are read-only and need future API work; an operator-facing screen should not present a source-code limitation as normal operational status. Document the missing alarm-acknowledgement workflow separately.

## 6. Existing backend integration contracts — DO NOT BREAK

The active API is defined in `backend/src/routes/apiRoutes.js`; auth/CSRF rules are in `backend/src/middleware/auth.js` and settings in `backend/src/config/env.js`.

Preserve these routes and payload semantics:

- `GET /api/health/live`
- `GET /api/health/ready`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/logs/:table` (existing allowlist: `access_logs`, `camera_events`, `environmental_telemetry`, `system_errors`, `system_users`; `system_users` is Admin-only and sensitive hashes are omitted)
- `GET /api/telemetry/aggregate?range=24h&bucket=15m` (respect valid ranges/buckets and response shape)
- `POST /api/command` (Admin-only; preserve current payload schema, command strings, confirmation, CSRF, lifecycle result/acknowledgement handling)
- `POST /api/provision/user` (Admin-only; preserve validation, role, RFID/PIN rules and secret handling)
- `POST /api/auth/admin-profile` (Admin-only)
- `POST /api/users/role` (Admin-only)
- `POST /api/users/delete` (Admin-only, retain last-active-Admin protection)
- WebSocket `/ws/telemetry`
- WebSocket `/ws/mfa`
- Node 3 direct camera endpoint `http://<ip_node3>/capture.jpg`

Authentication details that must remain correct:

- The login response supplies server-verified `authenticated`, `username`, `role`, `csrfToken`, session expiry information and may supply a `token` when Bearer compatibility is enabled. Do not assume `token` always exists; production configuration may use an HttpOnly cookie flow.
- When cookie session authentication is used, changing requests require the valid `X-CSRF-Token` header.
- The client must never treat browser-only state as proof of a verified Admin session.
- Preserve logout, expired-session, rejected-login and network-timeout behavior.
- Do not remove or weaken Admin/Viewer gating and do not dispatch any hardware command because of a presentation-only click.

Readiness caveat: `/api/health/ready` currently reports backend/SQLite readiness with MQTT and WebSocket metadata. Do not relabel `ok: true` as “all hardware operational”; render API/SQLite/MQTT/WebSocket/node evidence separately.

## 7. Explicit boundaries: features needing separate backend work

Do not fake the following as frontend-only features:

- Globally stored brand/logo/tenant settings. No corresponding endpoint currently exists.
- Globally shared endpoint settings. Current endpoint settings are browser-local via `localStorage`.
- Persistent alarm acknowledgement/resolution. Current system-error listing is read-only and needs a separate API workflow for acknowledgement.
- A central proxy for the camera snapshot. Current image comes directly from Node 3.
- Server-side audit search/pagination beyond what the current log APIs actually support.

Keep them local or read-only if that is the current behavior and explain the limitation. If the new UX requires one of these, list the exact backend change separately and do not implement an imaginary route.

## 8. DOM compatibility and safety constraints

The reviewed `index.html` has around 238 IDs. Many are referenced by `document.getElementById`, while others are referenced by `querySelector`, `data-view`, `data-table`, CSS selectors, or dynamic status logic. Do not equate “not found by a simple getElementById search” with unused.

- Preserve existing IDs unless you make a complete, verified reference migration. Prefer changing classes/containers and visual text while leaving ID hooks intact.
- Preserve form input names/values, CSS classes used for RBAC (`rbac-protected`, `rbac-protected-input`), `data-view`, `data-nav-jump`, `data-table`, and other JavaScript hooks.
- Do not rename the route IDs or status IDs solely for aesthetics.
- Do not replace native buttons with clickable `div` elements.
- Do not remove `aria` attributes/roles, keyboard handlers, CSRF, session state, permission gates or command confirmation logic.
- Do not use dangerous HTML injection for dynamic text. Continue escaping user/device content where it is rendered.
- Do not add mock live values, a fake backend, a demo bypass, or “success” messages that are not backed by an actual successful API response.

## 9. Required workflow

### Step A — Baseline audit
Before changing files:

1. Inspect the complete relevant files and map all six views, all existing IDs and event-hook selectors, API/WebSocket URLs, forms, command payload builders, auth state, endpoint storage and camera origin.
2. Run `npm ci --no-audit --no-fund`, `npm run lint`, `npm test`, and `npm run build` if the environment permits.
3. Record baseline failures before editing. Do not “fix” unrelated backend behavior as part of a visual pass.
4. Summarize the plan briefly, then continue with the defined scope rather than asking for repeated clarification.

### Step B — Implement the UI refresh
1. Reduce redundant visible text and adopt progressive disclosure for advanced detail.
2. Standardize and reuse existing SVG icons; add only meaningful icons to controls/cards that need them.
3. Refine hierarchy, spacing, surfaces, typography, tables, charts, dialogs and responsive navigation using current CSS tokens.
4. Unify sidebar and login branding.
5. Correct stale user-facing Node-RED/SHA-256/legacy-host references.
6. Implement the safe central-origin strategy and preserve separate edge device addresses.
7. Avoid new dependencies, frameworks and broad rewrites.

### Step C — Regression verification
Run all available project checks after changes:

- `npm run lint`
- `npm test`
- `npm run build`

Also verify:

1. No duplicate DOM IDs; every JS-bound ID/selector still resolves where it should.
2. Login accepted/rejected/network timeout, offline read-only behavior, session verification, logout and session expiration.
3. Admin versus Viewer controls, CSRF header use and protected form inputs.
4. Both WebSockets connect to the effective current origin and update their own status independently.
5. Current telemetry remains marked unknown/stale until valid fresh data arrives.
6. Each actuator command still requires its intended flow and confirmation; API payloads and command strings are unchanged.
7. Live/SQLite/aggregate chart modes, audit search/filter/detail/CSV/pagination, camera capture/fallback, endpoint settings and admin user operations behave as before.
8. Dark/light themes, keyboard access, screen-reader names, focus visible and small-screen layouts.
9. CSP still allows only intended local/dashboard/device resources and no remote script/icon requests were added.

If you do not have a real browser, physical devices or a live test server, say so and provide a manual test checklist; do not claim those systems were tested.

## 10. Deliverables and final report

Make the actual changes in the connected working tree if tools allow. Do not stop at a generic design suggestion. At completion provide:

1. A short summary of the new information hierarchy and visual system.
2. Exact file list changed and the reason for each file.
3. A before/after screen summary and screenshots if supported.
4. A DOM compatibility report: IDs/hooks preserved, any renamed/deleted IDs and proof their consumers were updated.
5. A route contract report confirming which REST routes, WebSockets, command values and camera path remain unchanged.
6. A configuration and branding report: central API origin, migration behavior for the old `lci_server_host`, remaining edge IP settings, and the fact that global logo persistence is not present.
7. Actual results of lint/tests/build, including warnings or failures.
8. A separate “backend changes required later” section only when a genuine unmet requirement exists.
9. Remaining manual checks for the test server/real devices.

Do not deploy to the server, merge a pull request, alter credentials, modify persistent data, or execute hardware actions as part of the frontend redesign. This task is to produce a safe, verified UI change set and an honest handoff.
