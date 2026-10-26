# Release acceptance — 1.1.0-rc.1

Software release candidate for one room and one door, with three preloaded team nodes and additional registered devices. Checked software rows are implemented and exercised locally; GitHub CI evidence belongs in the PR. Physical rows stay unchecked until the team records real device results.

## Notification Center (N1–N6)

- [x] N1: bell, recent preview, unread badge and full inbox.
- [x] N2: SQLite persistence across refresh and backend restart.
- [x] N3: server-produced auth/admin/device/command/diagnostic/alarm events; role/account privacy.
- [x] N4: search, category, severity, device, time range and pagination.
- [x] N5: account-specific read/unread, mark-all snapshot and WebSocket invalidation with polling fallback.
- [x] N6: duplicate grouping, opt-in browser critical sound and bounded retention policy.

## Device and endpoint registry (D1–D7)

- [x] D1: register/update/disable with immutable identity, revision checks and preserved history.
- [x] D2: sensors, camera, access-state, relay and mixed types.
- [x] D3: typed functions, labels, units, endpoint keys and switch capabilities.
- [x] D4: MQTT_V1 / manual HTTP_JSON_V1 / CAMERA_JPEG adapters; fixed identity-scoped MQTT topics.
- [x] D5: per-device observations, firmware field, alarms/history/commands and maintenance.
- [x] D6: type-dependent capture/control/value interfaces; commands require a supported profile.
- [x] D7: manual bounded HTTP diagnostic and passive MQTT observation; missing/stale evidence stays explicit.

## Alarm management (A1–A6)

- [x] A1: server-side high/recovery thresholds and dwell; monitoring only.
- [x] A2: missing device/sensor evidence and failed/timed-out command incidents.
- [x] A3: active/acknowledged/resolved lifecycle; acknowledgement does not resolve.
- [x] A4: actor/comment/timestamp timeline and observed recovery evidence.
- [x] A5: one active condition, hysteresis and freshness-aware dwell; no duplicate flood.
- [x] A6: expiring maintenance with reason, suppression and automatic resumption; old alarms remain visible.

## Software release (R1–R5)

- [x] R1: isolated simulator database/process, explicit banner, normal/alarm/offline/command-timeout scenarios and synthetic camera preview.
- [x] R2: backend and Chromium journeys for registry → telemetry → command → alarm → inbox → acknowledge → recover, plus role/CSRF/replay/timeout cases.
- [x] R3: additive upgrade test preserves existing credentials; existing backup/restore and deployment guard tests remain included.
- [x] R4: v1 telemetry/heartbeat/command/ACK, broker identity provisioning, adapter and team integration documentation.
- [x] R5: RC version, changelog, known limits and separate hardware acceptance list.
- [ ] Record successful PR GitHub Actions run before merge (browser, installer, both real-broker smoke tests, backup and update guard).

## Physical integration — not accepted by software tests

- [ ] Identify actual purchased boards and revisions; verify wiring/pinout and power budget.
- [ ] Connect the three team nodes with unique broker credentials; verify per-identity permissions.
- [ ] Verify each node's exact payload fields, IDs, units and firmware version.
- [ ] Prove sensor readings are real and calibrated where applicable; MQ-2 remains raw until measured calibration.
- [ ] Demonstrate hardware command expiry/deduplication, matching state reports and independent physical feedback where required.
- [ ] Exercise unknown-card reader enrollment and confirm actual device policy application; central storage alone is insufficient.
- [ ] Bind RFID and PIN to the same person, including attempts, revocation and offline-policy behavior.
- [ ] Connect the actual Node 3 camera and separately validate any Vision/face-enrollment service; camera capture alone is not biometrics/liveness.
- [ ] Verify local emergency exit and electrical safety independently of server/network.
- [ ] Test unplug/replug, broker restart, server restart, delayed frames, expired ACKs and maintenance recovery with real devices.
- [ ] Run a sustained bench soak, record failures/latency/DB growth, and perform a real backup/recovery exercise.
- [ ] Record the physical demo acceptance date, firmware versions, evidence and remaining limitations before issuing a hardware-ready release.
