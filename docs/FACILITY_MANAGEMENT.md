# Facility management and selected feature roadmap

Scope decision: **one room, one door, Node 1 access, Node 2 environment, Node 3 camera**. Extend the domain later without building a multi-building interface now. This follows the supplied Master Project Reference, release 2026-10-24. Firmware, exact board pinouts and electrical acceptance remain separate work.

## Selected product decisions

- Retain the current HTML/CSS/JavaScript interface and English terminology; add focused management views instead of replacing the frontend framework.
- Keep Admin and Viewer roles. Admin manages physical identities, accounts, settings and controls; Viewer monitors devices, trends and command history.
- Split dashboard users from people. A person can exist without a dashboard account, card, PIN or face record.
- Make node labels/IPs shared, durable settings. Keep the gateway host browser-specific; the application cannot reconfigure its own Docker bind address, firewall or the device's network interface from this page.
- Use explicit saved/pending/reported status. Never show a credential as device-applied without a real policy acknowledgement channel.
- Prefer a connected working demonstration and evidence over additional enterprise features.

## Available workflows

### People and credentials

`People & Credentials` creates a UUID-backed person using a name and optional reference. Search runs on the server; pages contain 20 records. Names support Unicode. Editing uses an optimistic `version` to reject lost updates. Suspend/reactivate preserves credential and audit history.

Cards support 4, 7 or 10 colon-separated hex bytes. The server canonicalizes uppercase and prevents multiple non-revoked assignments of the same UID. A blocked card remains reserved until revoked. UID-only RFID is a demonstration credential, not anti-cloning authentication.

PINs are exactly six **string** digits, retaining leading zeros. Scrypt verifiers stay in SQLite; raw PINs and verifiers never appear in directory or audit responses or MQTT. Reset atomically revokes the previous central PIN. Browser PIN fields are cleared before submission. Physical credentials never create a dashboard account.

All credential changes currently remain `PENDING_DEVICE_SYNC`. Suspending a person or blocking/revoking a card centrally **does not prove physical access has been revoked**, especially when a reader is offline. There is intentionally no button that fabricates device application or access-tested status.

Dashboard accounts are created separately in Administration using a password of at least 12 characters. Existing accounts and legacy provisioning records remain intact. Bootstrap is now one-time: restarting cannot reset a rotated password or recreate the old bootstrap username. Password input is treated as an opaque secret so quotes and spaces survive login unchanged. The older `/api/provision/user` compatibility route is unchanged; the dashboard uses `/api/v1/operators` for new operator accounts. Legacy person-like records are not automatically converted because there is no reliable identity mapping.

### Door-reader card enrollment

The software implements:

`Create person → request scan → ARMING → READY → CANDIDATE → confirm → central credential saved`.

The UI enables a request only through an authenticated Admin call; backend admission requires fresh ONLINE Node 1 evidence and the capability `RFID_ENROLL_V1`. Unsupported/offline/busy readers receive an explicit error. Waiting for a scan is shown only after READY. A candidate displays a masked UID before confirmation.

Session rules:

- One active session per reader; only the initiating Admin can inspect, confirm or cancel it.
- Fixed pilot TTL: 45 seconds, enforced on reads, events and new sessions. Expired sessions release ownership when the server next evaluates them.
- Events must match device ID, UUID, nonce digest, version and expected phase. A CARD before READY, wrong nonce, repeated candidate or event for a closed session is rejected.
- Confirmation and assignment are one transaction. Duplicate-card conflicts do not silently reassign an existing card.
- Cancel/confirm closes the central session and sends a best-effort non-retained CANCEL. `reader_release=REQUESTED` means published, not acknowledged; `WAIT_FOR_EXPIRY` means release could not be sent.
- Devices must enforce expiry locally, stop scanning on matching CANCEL, ignore expired/replayed requests and never unlock while enrolling. A new START must safely replace or reject a still-active earlier scan session.
- Process restart marks unfinished sessions FAILED. Reader expiry remains necessary if the server disappears.

This is a server-side contract, not supplied ESP32 firmware. No policy snapshot or PIN verifier is sent by this flow.

#### Proposed reader MQTT protocol v1

Dedicated ACL-scoped topics (QoS 1, command retain=false):

| Topic | Publisher | Subscriber |
|---|---|---|
| `lecf/access/enrollment/command` | `lci_backend` | `node1_access` |
| `lecf/access/enrollment/event` | `node1_access` | `lci_backend` |

Node 1 capability advertisement on its own heartbeat topic:

```json
{"node_id":"node1","status":"ONLINE","firmware_version":"example-1","capabilities":["RFID_ENROLL_V1"]}
```

START command:

```json
{"schema_version":1,"action":"START","session_id":"<uuid>","node_id":"node1","nonce":"<48 hex characters>","expires_at":"<UTC timestamp>"}
```

Events must have exactly the following fields, with `card_uid` supplied on CARD:

```json
{"schema_version":1,"session_id":"<same uuid>","node_id":"node1","nonce":"<same nonce>","event":"READY"}
```

```json
{"schema_version":1,"session_id":"<same uuid>","node_id":"node1","nonce":"<same nonce>","event":"CARD","card_uid":"A4:9F:21:0B"}
```

`event=FAILED` closes the session. CANCEL has `schema_version`, `action=CANCEL`, `session_id`, `node_id`, `expires_at`; no nonce is needed on the backend-only command topic. Never log or return nonce material in the browser. Firmware integration must validate these contracts and the broker ACL with real devices before claiming reader support.

### Devices and shared settings

`Devices & Room` shows all three configured identities even if no device has ever connected. UNKNOWN, STALE, reported status and last observation are independent of broker health. Firmware/capabilities are displayed only when reported. Fixed one-room identities/topics remain configured by the server environment; changing a label/IP cannot redirect a command to an arbitrary MQTT topic.

Shared settings include names, labels, private IPv4 addresses and **display-only** temperature/MQ-2 warning limits. Validation requires distinct RFC1918 IPv4 addresses with final octet 1–254 and warning below critical. These are host-address conventions for this demonstrator, not a general subnet calculator. Save uses a monotonically increasing settings revision; stale editors receive 409. SQLite settings override environment defaults after initial seeding.

Changing Node 3's registered IP changes the backend capture destination immediately. Snapshot retrieval is authenticated, fixed to HTTP port 80 `/capture.jpg`, restricted to a literal registered private address, bounded to four seconds and 2 MiB, and refuses redirects, non-JPEG content and invalid JPEG markers. Snapshots are returned privately without persistent storage. Browsers load a blob from the API, avoiding cross-origin camera CSP/mixed-content problems. This validates a JPEG envelope, not face identity or liveness.

Admin node-address forms save to the same registry. The gateway host remains local to the browser; changing it signs the console out. For production, prefer the same-origin Nginx route. The CSP has no hardcoded legacy Node-RED IP; it permits configurable HTTP/WebSocket connections while scripts and fonts stay local.

Display limits do not program Node 2 automation. Firmware owns fan control, and electrical/exit interlocks remain independent of the dashboard. MQ-2 values use raw labels until calibrated. A stale high value is shown as stale rather than announced as a new live critical event.

## API summary

All routes below are under `/api/v1`; all require a server session. Cookie mutations require `X-CSRF-Token`. Mutation bodies reject unknown fields; route limits prevent unbounded administrative request volume.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/settings` | Any authenticated | Read shared names, nodes, display limits and revision |
| PUT | `/settings` | Admin | Save complete settings with current revision |
| GET | `/devices` | Any authenticated | Registered nodes plus observed evidence |
| GET | `/devices/node3/snapshot` | Any authenticated | Bounded private JPEG proxy |
| GET | `/people?search=&page=1&limit=20` | Admin | Search/paginate people and masked credentials |
| POST | `/people` | Admin | Name and optional reference; no physical credential required |
| PUT | `/people/:id` | Admin | Name, reference, status and current version |
| POST | `/people/:id/credentials` | Admin | `{modality: RFID, card_uid}` or `{modality: PIN, pin}` |
| PUT | `/credentials/:id` | Admin | `{status: BLOCKED}` or `{status: REVOKED}` |
| POST | `/operators` | Admin | Username, independent password, Admin/Viewer role |
| GET | `/management-audit` | Admin | Latest 100 administration events, excluding secrets |
| GET | `/commands` | Any authenticated | Latest 100 command outcomes |
| POST | `/people/:id/cards/enrollment-sessions` | Admin | Start reader session with empty object body |
| GET | `/enrollment-sessions/:id` | Initiating Admin | Poll phase, masked candidate and expiry |
| POST | `/enrollment-sessions/:id/confirm` | Initiating Admin | Confirm with empty object body |
| POST | `/enrollment-sessions/:id/cancel` | Initiating Admin | Cancel with empty object body |

PUT `/settings` accepts `revision`, `facility_name`, `room_name`, `nodes` and `display_thresholds`. Response-only `updated_at`/`updated_by` must be omitted. Nodes are keyed `node1`, `node2`, `node3`, each containing `name` and `ip`. Limits are `temperature_warning`, `gas_warning_raw`, `gas_critical_raw`.

## Upgrade and validation

Migration `002_facility_management.sql` adds settings, people, physical credentials, enrollment sessions and management audit. Migration 001 and existing rows are not rewritten. Startup seeds settings only when absent. Operator roles, sessions, old event tables and the existing command coordinator remain compatible.

Take a database backup before applying. An older application can ignore the additive tables; rolling back application code does not automatically roll back settings/people changes. Restore only through the documented database recovery process when needed.

Run `npm test`, `npm run lint`, `npm run build`. The new tests cover shared persistence/conflicts/validation, Admin/Viewer+CSRF, identity separation, masked cards, PIN secrecy/leading zeros/reset, suspension/revocation, search/pagination, reader capability gating, owner/nonce/phase/expiry/replay, cancellation/restart, and bounded JPEG retrieval. Existing auth, WebSocket, MQTT command, backup and rollback tests continue to run.

## Evaluated features and priority

| Feature | Decision | Reason / dependency |
|---|---|---|
| Shared IP/name registry, people, credentials, audit, command history | Implemented now | Core administration and truthful state |
| Reader-based enrollment | Software implemented now | Physical acceptance requires compatible Node 1 firmware |
| Device policy revisions and applied acknowledgements | Next integration priority | Must agree firmware storage, verifier transport, offline/revocation policy and same-person RFID+PIN binding |
| Local simulator | Existing integration fixtures/test harness | Do not add a production button that can forge live device state |
| Camera-based face enrollment | Next separate service | Requires consent, protected template storage, quality tests and Vision API; face remains non-actuating by default |
| Alert acknowledgement and retention policies | Later | Requires an event model and measured thresholds; current display warnings and audit remain available |
| Entry schedules and temporary visitor cards | Later | Depends on trusted device time and working policy synchronization |
| Backup/download/restore buttons | Keep CLI workflow for now | Existing verified deployment backup path; browser restore introduces unnecessary destructive scope |
| Operator role between Admin/Viewer | Later if needed | Existing two-role model is sufficient for one-room demonstration |
| DHCP/static-IP push, reboot, OTA, arbitrary MQTT terminal | Deferred | No supported firmware management channel or acceptance evidence |
| Email/SMS, cloud sync, multi-building dashboards | Deferred | Extra services and configuration distract from the connected one-room demo |
| Arabic localization | Deferred | Consistent English UI selected; Unicode names already supported |

## Remaining physical acceptance

Connect actual nodes and verify board identities/pinouts, power budget, reader compatibility, same-person RFID+PIN, offline policy, command expiry/deduplication, local exit, sensor calibration and real relay feedback. Do not treat passing software tests or a broker ACK as evidence of safe physical motion. Record firmware versions and acceptance results before enabling real lock operation.

## Verification record

Validated locally with 44 automated backend/integration tests, JavaScript syntax checks and a production Vite build. A headless Chromium smoke run exercised Admin login, shared settings/IP save, person creation, card and leading-zero PIN assignment, credential blocking, independent operator creation, login with a quoted password, Viewer restrictions and a 390px layout. Screenshots contain sample data with hardware disconnected. Docker/Mosquitto deployment validation and physical-node acceptance were not run in this environment.
