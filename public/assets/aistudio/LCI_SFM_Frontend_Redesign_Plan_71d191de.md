# LCI-SFM Dashboard — Frontend Modernization Plan & Integration Map

**Purpose:** Prepare a controlled, frontend-first redesign for Google AI Studio. This document describes the current UI, the improvements to make, the backend contracts to preserve, configuration/branding boundaries, and the validation checklist.

**Repository reviewed:** `AbdullahNSarhan/Smart-Facility-Management-System`  
**Reviewed main commit:** `8bc064b2d835aeb38a9f6d577864ffa9ce264c3c` (merge of PR #4)  
**Scope:** Frontend UX, visual hierarchy, text density, inline SVG icon consistency, branding presentation, responsive behavior, and narrow compatibility fixes directly required by the new UI. Not a general backend rewrite.

## 1. Executive summary

Keep the existing application architecture: `index.html` + `styles.css` + vanilla JavaScript in `app.js`, built into `dist/` with Vite and served by Nginx. Although the root `package.json` includes React and `lucide-react`, the current dashboard is not a React application. **Do not migrate the dashboard to React or introduce a second UI framework as part of this redesign.**

The frontend already contains many inline SVG icons. The improvement is to standardize those icons, apply them with consistent sizing and accessible names, and remove repetitive explanatory copy from the primary viewing path. Do not turn the entire interface into icon-only controls: security state, hardware state, warnings, confirmations, data freshness, and unknown/offline conditions must remain explicit in text.

The highest-priority correctness issue is configuration/copy drift. The active backend source is Node.js/Express, but many visible labels, helper messages, and old defaults still describe a Node-RED endpoint at `192.168.43.225:1880`. The app currently prefers a saved `localStorage` value (`lci_server_host`) over the current browser host. A workstation with a legacy value can therefore keep sending API/WebSocket requests to an obsolete host/port after the server has moved behind Nginx. Address this deliberately, without silently overwriting intentional custom settings.

The UI also says credentials are checked with SHA-256, while the current backend implementation hashes secrets with Node's `scrypt` helper. Replace algorithm-specific user-facing claims with accurate wording about backend verification and secret protection.

## 2. Current frontend inventory

### Existing files

| File | Current responsibility | Redesign rule |
|---|---|---|
| `index.html` (~77 KB; 238 DOM IDs at review time) | Login overlay, application shell, six main views, forms, tables, charts, modals, many explanatory labels | Preserve every ID used by JavaScript, all form names/values and `data-*` navigation/table hooks. Simplify markup/text only with a traceable map. |
| `styles.css` (~41 KB) | Dark/light tokens, cards, sidebar, status states, modal styles, responsive breakpoints, focus-visible and reduced motion | Refine existing CSS variables and component styles; do not replace the design system wholesale. |
| `app.js` (~124 KB) | Auth/RBAC, local endpoint configuration, REST calls, WebSockets, live telemetry, charts, table filters/CSV/pagination, camera snapshots, actuator commands and diagnostics | Avoid broad refactors. Keep existing request paths, data parsing, event wiring, state names, safety checks and payloads. |
| `package.json` / lockfiles | Vite build and project scripts/dependencies; includes React-related dependencies but dashboard code is vanilla JS | Use existing tools only. Do not import `lucide-react` into a classic/vanilla script or add remote libraries. |
| `nginx/nginx.conf` | Serves static `dist/`, proxies `/api/` and `/ws/` to the backend | Do not alter routes or server deployment as part of cosmetic work. |

### Existing UI regions

1. **Login overlay:** username/password, current endpoint indicator, expandable server-host override, offline warning and read-only inspection option.
2. **Global shell:** collapsible sidebar, six view selectors, telemetry/MFA connection indicators, operator/role/session state, active-view title, data freshness, clock/date, fullscreen, theme and endpoint settings.
3. **View 1 — Command Center:** facility state banner; door, temperature, humidity, smoke/gas, fan, light, MFA and connectivity snapshots; network topology/status; high-risk command controls; recent activity.
4. **View 2 — Access & Security:** door/lock state, 2-of-3 MFA evidence, Node 3 camera preview/capture and recent access records.
5. **View 3 — Environment & Actuators:** temperature/humidity/smoke gauges, trend charts, live/SQLite/aggregate chart modes, auto/manual mode and manual fan/light commands.
6. **View 4 — Audit Explorer:** allowlisted SQLite log tables, time/status/search filters, record-detail inspector, refresh, CSV export and client-side pagination.
7. **View 5 — Diagnostics:** central API and WebSocket states, Node 1/2/3 diagnostic cards and system-error table.
8. **View 6 — Administration (Admin-only):** personnel provisioning, RFID/PIN fields, camera face capture, admin profile form, per-workstation endpoint configuration and user-role management.
9. **Shared overlays:** toasts, endpoint settings modal, hardware command confirmation modal, event-detail modal and mobile sidebar backdrop.

## 3. Proposed visual direction

### 3.1 Design goal

Make the dashboard feel like a clear, modern BMS/HMI operations console—not a documentation page. A user should understand the facility state, whether the data is current, and what needs attention at a glance. Technical detail remains available on demand.

Preserve the established palette and meaning:

- Dark canvas: `#090e17`; dark card: `#111a2b`; dark border: `#1e293b`.
- Light canvas: `#f1f5f9`; light surface: `#ffffff`.
- Cyan/blue for neutral system actions, emerald for nominal/confirmed, amber for warning/stale, rose/crimson for critical/offline, slate for unknown/unverified.
- Continue using CSS custom properties so dark and light themes remain synchronized.

### 3.2 Text-density rules

**Condense or move into progressive disclosure:**

- Repeated phrases such as “Node 2 Environmental & HVAC Telemetry Node” repeated across multiple cards when a short title plus a tooltip/detail panel is sufficient.
- Long helper paragraphs that simply repeat the panel title, endpoint path, database table, hardware model, or button action.
- Persistent implementation notes intended for developers (for example, statements about which backend API expansion is missing) from the main operator workflow. Put these into a diagnostics “Capability / integration note” or documentation instead, where still relevant.
- Verbose technical explanations under every card. Show one concise summary and use an info button, disclosure row, or details panel for advanced information.
- Full IPs, raw route strings and table names in primary cards unless an operator needs them for troubleshooting. Keep them discoverable in details and diagnostics.

**Keep explicit and visible:**

- Critical/warning/unknown/offline labels, data freshness, source/evidence, command result and pending/acknowledged/rejected states.
- Role and authentication status, access restrictions, command target, irreversible/high-risk action confirmation, and any offline/read-only warning.
- Field labels and validation errors for username, password, RFID, PIN, role and endpoint settings.
- Units, meaningful numeric values, alarms/thresholds and “no data / stale / not verified” distinctions. A zero value must not imply a healthy device if no verified telemetry has arrived.
- “Cancel” and clear confirmation wording for actuator actions. Never make a dangerous action more likely because a label was removed for compactness.

### 3.3 Icon system

- Use a coherent outline SVG style, `currentColor`, a consistent 24×24 viewBox, and approximately 1.8–2 stroke width. Standard sizes: 16px for compact controls, 18–20px for toolbar/navigation, 22–24px for major state cards.
- Reuse or normalize existing inline SVGs. A small inline SVG sprite or a documented local icon-snippet pattern is acceptable; no web fonts, icon CDN, remote JavaScript or new dependency.
- Prefer conventional icon meanings: grid/layout (overview), shield/door/key (access), thermometer/droplet/activity (environment), list/search/download (audit), activity/network/heart-pulse (diagnostics), users/shield/settings (admin), sun/moon (theme), expand/compress (fullscreen), refresh, camera, sliders/network (endpoints), logout/lock, alert triangle, check circle, clock, and info-circle.
- Primary and high-impact controls should usually retain a compact visible label next to the icon. Icon-only is appropriate for obvious, secondary toolbar controls such as theme, fullscreen, close, clear-search and collapse-sidebar **only** when `aria-label`, tooltip/title and keyboard focus remain available.
- Use `aria-hidden="true"` on decorative icons. Never use an SVG alone as the only representation of an operational state unless an accessible text alternative is provided.
- Keep semantic state labels alongside color. Icons are supporting cues, not replacements for “OFFLINE”, “UNKNOWN”, “STALE”, “CRITICAL”, “Admin”, or the actual door/fan/light state.

### 3.4 Navigation and page layout

- Keep the current six views and their current semantics. Group them logically (Monitoring & Operations / Administration); do not remove any view or hide Admin functions beyond the existing RBAC behavior.
- Improve the collapsed sidebar so every icon has a useful tooltip and active/focus state; ensure mobile opening/closing works with keyboard and pointer.
- Give each view a compact heading, concise subheading only when it adds information, and consistent spacing/card hierarchy.
- Keep the key facility status + most important live metrics near the top of View 1. Put deeper topology and technical detail lower or in a collapsible panel without removing it.
- Provide intentional empty/loading/stale/error states for charts, camera, tables and telemetry. Avoid fake sample numbers and decorative values that look live.
- Keep forms and tables usable at desktop (1440 px), laptop/tablet (1024/768 px) and phone (390 px). Tables may scroll horizontally or use a mobile row/card representation; never clip key actions silently.

## 4. Branding and “logo ID” findings

The current sidebar brand is static HTML: a `.brand-logo` element containing the text `LCI`, plus a `.brand-text` area with `BMS / HMI Console` and `LCI-SFM`. The login screen uses a different inline shield SVG and a `LCI-SFM` kicker. There is no logo upload or brand-settings endpoint in the current backend API, and the sidebar brand mark does not have a dedicated DOM `id` in the reviewed markup; the class is `.brand-logo`.

**First phase:** unify the sidebar and login brand treatment and make the visible brand/name/tagline easy to update in the frontend source. Keep the default product identity `LCI-SFM`; avoid adding a fake “upload logo” or “save brand globally” control. If local logo selection is proposed, make clear that it is browser-local only and not centrally persisted; preferably defer it.

**If globally editable branding is required later:** that is a real backend feature. It needs an explicit brand configuration data model and authenticated API/persistence policy, plus validation and safe file storage or a controlled logo URL policy. Do not invent `/api/settings/brand` or claim persistence where no endpoint exists.

## 5. Configuration and integration findings

### 5.1 Central server address / legacy endpoint

Current frontend endpoint state uses `localStorage` keys:

- `lci_server_host`: central API and WebSocket host (currently inherited from the older Node-RED setup).
- `ip_node1`, `ip_node2`, `ip_node3`: per-device/edge-node IPv4 addresses.

`app.js` chooses a saved `lci_server_host` before `window.location.host`; therefore an old value such as `192.168.43.225:1880` may override the host from which the new dashboard is served. Yet the current Nginx configuration serves the dashboard on its published HTTP port and reverse-proxies same-origin `/api/` and `/ws/` to the Node.js service.

**Required safe improvement:** central API/WebSocket requests should use the current origin by default (`/api/...`, `ws(s)://<current-host>/ws/...`) in the production Nginx setup. Preserve a custom external host only if there is an explicit, understood reason to use it. Add a carefully tested legacy migration for the known old default only; do not blindly discard a deliberately chosen host. Provide a “Use this dashboard’s server” / reset action and show the active API origin in advanced diagnostics. Keep the three edge-node IP fields independent because Node 3 camera capture currently goes directly to `http://<ip_node3>/capture.jpg`.

Check local/development mode before implementing this: the `package.json` `dev` command and the production Nginx path differ. If dev needs same-origin requests, use the existing Vite/dev tooling and a local proxy only when justified, without changing production URLs or introducing a new framework.

### 5.2 Current backend API contract

The active backend (`backend/src/routes/apiRoutes.js`) is Node.js/Express and has these routes. Preserve them and their existing payloads.

| HTTP / path | Purpose | Frontend integration rule |
|---|---|---|
| `GET /api/health/live` | Backend liveness | Use for diagnostic reachability only; does not prove database/MQTT/device health. |
| `GET /api/health/ready` | Backend + SQLite readiness; includes MQTT/WebSocket status metadata | Display each signal separately. `ok: true` currently fundamentally reflects database readiness, so do not label it “all devices online”. |
| `POST /api/auth/login` | Login; creates server-side session and cookie, returns role/CSRF/session information | Respect returned `authenticated`, `username`, `role`, `csrfToken`, and optional `token`. Do not assume `token` is always present: `ALLOW_BEARER_COMPAT=false` is configured for the intended cookie flow. |
| `POST /api/auth/logout` | Revoke current session and clear session cookie | Preserve session cleanup and status handling. |
| `GET /api/auth/session` | Validate current session and return user/role/CSRF state | Never treat browser-only local state as server verification. |
| `GET /api/logs/:table` | Read allowlisted operational records, generally authenticated | Keep allowlisted table names and returned row semantics. `system_users` is Admin-only and secret fields are omitted by the repository projection. |
| `GET /api/telemetry/aggregate?range=24h&bucket=15m` | Historical telemetry rollups | Keep valid ranges/buckets and existing response parsing; do not synthesize missing samples. |
| `POST /api/command` | Admin-authorized actuator command dispatch and lifecycle tracking | Preserve payload schema, CSRF/auth headers, confirmation and result lifecycle. Do not rename commands or dispatch on a visual-only click. |
| `POST /api/provision/user` | Admin provisioning of user credentials | Preserve schema, validation, PIN/RFID handling and role restrictions. Never log or render plaintext secrets. |
| `POST /api/auth/admin-profile` | Change active Admin profile/credentials | Preserve reauthentication/session behavior and field-validation flow. |
| `POST /api/users/role` | Admin role change | Preserve payload, authorization and UI refresh behavior. |
| `POST /api/users/delete` | Admin user disable/delete | Preserve last-active-Admin safeguards and confirmation. |
| WebSocket `/ws/telemetry` | Verified live telemetry stream | Keep same-origin URL by default, auth behavior and JSON parsing. |
| WebSocket `/ws/mfa` | MFA/access stream | Keep same-origin URL by default, auth behavior and current status semantics. |
| `http://<ip_node3>/capture.jpg` | Direct Node 3 camera JPEG snapshot | Not one of the current central backend routes. Preserve the device path unless a separately planned proxy integration exists. |

The backend uses `scrypt` helper code for password/PIN verifiers; visible UI must not promise SHA-256. API mutations use Admin authorization and cookie-authenticated changes require valid `X-CSRF-Token`. Keep cookies, CSRF handling and role gates intact.

### 5.3 Features that do NOT currently have backend persistence/endpoints

- Global/cross-workstation branding or logo uploads.
- Global server/node endpoint settings persisted by the server (current endpoint changes use browser `localStorage`).
- Alarm acknowledgement/resolution workflow; the current UI already notes error records are read-only and acknowledgement needs an API expansion.
- A central backend camera snapshot proxy; the UI requests the Node 3 endpoint directly.
- Arbitrary server-side filtering/pagination for audit explorer beyond the current logs endpoint behavior. Treat current filtering/pagination as UI-side unless actual API support is verified.

For these, either keep the feature explicitly local/UI-only or document a separate backend requirement. Do not ship a fake control with a success toast if it does not persist or trigger a real action.

## 6. Visible copy that should be corrected

Inspect all visible user-facing strings in `index.html` and dynamic status/toast strings in `app.js`:

- Replace user-facing `Node-RED` references with accurate, neutral names such as `Central Backend`, `Central API`, or `Facility Gateway` where the exact internal runtime is not useful. The current central implementation is Node.js/Express. Do not rename backend route paths or change internal identifiers just to update display copy.
- Replace statements claiming “SHA-256” password checking/hashing with accurate neutral copy: credentials are verified by the backend; secret values are never shown in the dashboard. The current helper uses `scrypt`.
- Remove stale static examples from the login subtitle and default HTML content when they imply the server is always `192.168.43.225:1880`. Runtime endpoint displays should be populated from the effective configuration.
- Remove hard-coded paths like `/home/Bedo/lci_sfm.db` from the operator UI. Database internals belong in developer documentation/diagnostics, not as assumed public filesystem facts.
- Keep raw route/table names in an advanced details area for engineers, or in tooltips, if they're genuinely useful.
- Update page title, description and accessibility metadata consistently if presentation naming changes; preserve LCI-SFM's product identity unless the user intentionally changes it.

## 7. Implementation phases

### Phase 0 — Audit and baseline

1. Read all of `index.html`, `styles.css`, `app.js`, root `package.json`, `vite.config.*` if present, `docker-compose.yml`, `nginx/nginx.conf`, current backend route definitions, auth middleware, and frontend documentation.
2. Record existing DOM IDs, `data-view`, `data-table`, form values/names, JavaScript event handlers and endpoint builders.
3. Establish baseline commands: `npm ci --no-audit --no-fund`, `npm run lint`, `npm test`, `npm run build`.
4. Do not edit until the baseline is recorded; report a failure separately from an intentional redesign change.

### Phase 1 — Copy and information hierarchy

1. Create a concise content inventory for every view.
2. Reduce duplicated helper text, convert advanced technical annotations to tooltips/disclosure panels, and remove developer-only notes from the operator workflow.
3. Correct stale Node-RED/SHA-256/server-address wording.
4. Keep statuses, labels, security warnings and command confirmations explicit.

### Phase 2 — Icon and component consistency

1. Define a small local SVG-icon pattern/sprite and document the allowed icon names/usage.
2. Normalize existing icons before adding large numbers of new ones.
3. Add icons to main navigation, compact tools, section headers, status cards and common action types where meaningful.
4. Ensure action labels remain clear and every icon-only control has `aria-label` and tooltip/title.
5. Keep status icons supplemental to text and never introduce remote icon resources/CDNs.

### Phase 3 — Layout, logo and responsive behavior

1. Unify login/sidebar branding while keeping the current product identity.
2. Refine top-bar density, card hierarchy, gutters, chart sizes, table layouts and mobile navigation.
3. Keep dark/light mode and reduced-motion support.
4. Add purposeful empty/loading/error/offline/stale states for all live data surfaces.
5. Do not create global logo management controls unless a real persistence API is separately planned.

### Phase 4 — Configuration compatibility

1. Centralize the frontend's central API-origin and WebSocket URL generation.
2. Use same-origin `/api` and same-origin `ws(s)` for the production Nginx reverse-proxy deployment.
3. Handle the known legacy `lci_server_host` default safely; preserve intentionally customized values until the user explicitly resets them.
4. Keep `ip_node1/2/3` separate from the central API origin, because device camera capture and physical endpoints are distinct.
5. Re-test CSP `connect-src`/`img-src`, auth cookie flow, CSRF and WebSocket authentication. Do not broaden CSP or add an external CDN to solve an icon or origin issue.

### Phase 5 — Regression and handoff

1. Run lint, automated backend tests, production build, and any existing browser/test scripts.
2. Check that no existing DOM IDs became duplicate/missing and that existing listeners still bind.
3. Audit diffs for changed URLs, payloads, API paths, command strings, auth/role gates and database assumptions.
4. Provide a screen-by-screen change summary, all modified files, any backend changes (with reason), residual manual checks, and screenshots if the environment supports them.
5. Do not deploy, merge or change the live/test server as part of a UI-only redesign unless explicitly authorized.

## 8. Acceptance checklist

### Visual and usability

- [ ] Clear visual hierarchy: overall state, key telemetry, primary navigation and primary actions stand out.
- [ ] Repetitive explanatory copy has been shortened or moved to advanced details.
- [ ] Icon stroke, size, baseline and padding are consistent.
- [ ] High-impact actions still have visible text and confirmation.
- [ ] State is represented through both text and visual cues, not color alone.
- [ ] Dark and light themes remain readable, including status and icon contrast.
- [ ] Keyboard focus, tab order, tooltip access and reduced-motion behavior are preserved.
- [ ] Layout tested at 1440, 1024, 768 and ~390 CSS-pixel widths.

### Function and integration

- [ ] Login success/failure/network-timeout/offline-read-only flow remains correct.
- [ ] Cookie session, CSRF header, logout, Viewer/Admin permissions still work.
- [ ] The active central API origin is correct; no stale Node-RED hostname/port remains in runtime defaults.
- [ ] WebSocket telemetry/MFA state and stale-data detection still work.
- [ ] Door, fan, light, Auto/Manual and confirmation modal preserve original behavior/payloads.
- [ ] Live / SQLite / aggregate chart modes continue to use real source data only.
- [ ] Audit filters, table selection, record inspector, pagination and CSV export work.
- [ ] Camera snapshot and capture failure state remain truthful.
- [ ] User provisioning/profile/role operations preserve existing backend contracts and RBAC.
- [ ] CSP continues to block unapproved third-party resources; no new CDN is present.
- [ ] `npm run lint`, `npm test`, `npm run build` all pass.

### Backend-change policy

A backend change is allowed only when an actual frontend requirement cannot be met through the existing contract or when a concrete integration defect is verified. Any such change must be small, separately explained, have tests, and avoid schema migrations unless explicitly justified. No API redesign, schema change, new endpoint, new dependency, deployment change or physical hardware command change should be smuggled into a visual PR.

## 9. Source files to review directly

- `index.html`: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/index.html
- `styles.css`: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/styles.css
- `app.js`: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/app.js
- `backend/src/routes/apiRoutes.js`: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/backend/src/routes/apiRoutes.js
- `backend/src/middleware/auth.js`: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/backend/src/middleware/auth.js
- `backend/src/config/env.js`: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/backend/src/config/env.js
- `backend/src/utils/crypto.js`: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/backend/src/utils/crypto.js
- `docker-compose.yml`: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/docker-compose.yml
- `nginx/nginx.conf`: https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/nginx/nginx.conf
- Existing frontend documentation (needs updating because some integration descriptions are stale): https://github.com/AbdullahNSarhan/Smart-Facility-Management-System/blob/main/docs/FRONTEND_DOCUMENTATION.md

## 10. Deliverables expected from Google AI Studio

1. Updated frontend files only, unless an essential backend integration defect is documented.
2. A DOM compatibility report: preserved IDs, IDs deliberately retired (with migration rationale), event hooks and `data-*` values checked.
3. A screen-by-screen UI change summary and before/after screenshots if the connected environment supports them.
4. An API compatibility table indicating whether each existing route/WebSocket/device endpoint remains unchanged.
5. A configuration/branding note stating which settings are browser-local and which, if any, are server-persisted.
6. Test command output and any remaining manual hardware/network checks.
7. No claim that devices or hardware are working unless they were actually tested.
