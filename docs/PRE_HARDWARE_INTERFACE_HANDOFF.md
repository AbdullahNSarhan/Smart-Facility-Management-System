# LCI-SFM: pre-hardware interface handoff (server acceptance)

**Status:** Server-side contract baseline, **not** proof of physical hardware reliability. Maintainers must freeze these choices with each firmware/vision-service owner before production actuation.

## 1. Scope and evidence

- `install.sh` validates the application and starts `mqtt-service`, `backend`, `frontend_dashboard` with persistent named volumes. `/api/health/ready` returns 200 only after SQLite is ready and the MQTT backend client is connected with its subscriptions ready.
- **Broker healthy != node online.** An attached node appears in `mqtt.observed_nodes` only after a validated message. An empty collection is normal when no edge node is connected and MUST NOT trigger a server readiness failure. A previously observed node becomes `STALE` after `MQTT_NODE_STALE_MS` (default 90 seconds) without traffic, or `UNKNOWN` when the broker connection is unavailable. `reported_status` is what the device last claimed; `fresh`/ `age_ms` indicate whether its latest observation is current.
- GitHub CI now exercises a disposable simulated Node 2 against a **real** Mosquitto broker and deployed Node.js backend, including authenticated MQTT, telemetry validation, SQLite insertion, QoS duplicate handling, browser-session + CSRF command dispatch, and correlated device ACK.
- Passing CI proves those **server-side paths** work in the tested environment. It does not establish ESP32 timing, wiring, sensor calibration, radio reliability, fail-safe egress, or the security of an eventual device network.

## 2. Current topic contract: DO NOT assume all firmware implements it

The central registry is `backend/src/mqtt/topics.js`. Keep it authoritative; proposed extensions are not verified firmware until accepted in device tests.

| MQTT topic | Sender -> receiver | State | QoS |
|---|---|---|---|
| `lecf/env/telemetry` | Node 2 -> backend | Documented; payload still requires device confirmation | 0 (backend subscription) |
| `lecf/access/mfa_face` | Vision -> backend and Node 1 | Documented; verify payload against actual vision service | 1 |
| `lecf/access/state` | Node 1 -> backend | Proposed | 1 |
| `lecf/access/command` | Backend -> Node 1 | Proposed | 1, **retain=false** |
| `lecf/access/command/ack` | Node 1 -> backend | Proposed | 1 |
| `lecf/env/command` | Backend -> Node 2 | Proposed | 1, **retain=false** |
| `lecf/env/command/ack` | Node 2 -> backend | Proposed | 1 |
| `lecf/node1/heartbeat`, `lecf/env/heartbeat`, `lecf/vision/heartbeat` | Edge -> backend via `lecf/+/heartbeat` | Proposed | 0 |

**Identity caution:** the backend's `NODE1_ID=node1`, `NODE2_ID=env_02`, `NODE3_ID=node3` defaults must be agreed with each device developer. The topic `lecf/+/heartbeat` matches exactly one level between `lecf` and `heartbeat`. No MQTT password or biometric template is ever published to a frontend browser.

## 3. Proposed application-level JSON contracts

Node 2 telemetry (example; all units must be verified against calibrated firmware):

```json
{"schema_version":1,"node_id":"env_02","boot_id":"unique-boot-id","seq":104,"temperature_c":26.5,"humidity_pct":48.2,"smoke_gas_level":120,"light_state":"OFF","fan_relay":"OFF"}
```

Commands sent by backend to the target MQTT topic:

```json
{"schema_version":1,"command_id":"uuid","request_id":"request-id","command":"TOGGLE_AUX_LIGHT","state":"ON","target_node":"env_02","issued_by":"operator-name","issued_at":"UTC timestamp","expires_at":"UTC timestamp"}
```

Device reply on the **matching** command ACK topic:

```json
{"command_id":"same-uuid","node_id":"env_02","status":"executed","observed_state":"ON"}
```

- Firmware must validate `target_node`, `expires_at`, command/state allowlist, and deduplicate `command_id` before any actuation. The physical access/egress decision remains local and hardwired safety interlocks must not depend on MQTT.
- A broker publish confirms transmission only. `acknowledged` means a matching node ACKed without trusted matching observed state; `state_confirmed` requires a reported matching state, **not independent proof of physical motion**. Late, cross-topic or mismatched-state ACKs are rejected or marked failed.
- To avoid QoS duplicate insertion, Node 2 should include stable `node_id`, unique per-boot `boot_id`, and monotonic `seq`. HTTP/API/UI must not treat the latest row or an old retained state as live.
- The current normalization layer accepts some legacy aliases/omissions for compatibility. In particular, a boolean smoke flag is not a calibrated gas concentration; the physical units and safe mapping remain **UNVERIFIED** until hardware acceptance. Do not make automated gas alarms from uncalibrated values.
- Client-supplied IPs, arbitrary topics, and free-form commands are not trusted. Device provisioning of RFID/PIN material needs its own threat review before enabling remote synchronization.

## 4. Acceptance checklist for the hardware phase

1. Agree firmware/vision payload fixtures, field units, node identities, topics, and `schema_version`. Commit fixtures to source control (never secret samples).
2. Provision separate device credentials with Mosquitto topic ACLs. Do not copy the `lci_backend` credential into ESP32 firmware. Check wrong-username/wrong-topic denials.
3. Change `MQTT_BIND_IP=127.0.0.1` to the server's **static private LAN IPv4** only when connecting devices; restrict firewall ingress to approved devices. Prefer MQTT/TLS (or an encrypted trusted transport) where feasible; TCP/1883 alone is not encrypted. Never forward MQTT to the Internet.
4. Validate Wi-Fi interruptions, broker restart, device reboot, duplicate/out-of-order sequences, lost ACK, delayed ACK, and expiry. Confirm no stale QoS1 queued command replays after reconnect.
5. Verify measured sensor units, relay feedback, exact pin wiring and command semantics independently from the UI. Check emergency door release and fail-safe operation without server availability.
6. Observe `/api/health/ready` and `mqtt.observed_nodes` separately; prove a disconnected device goes stale and the MQTT broker may remain healthy.
7. Test 24h+ soak with actual devices, record message loss, end-to-end latency, reset counts, DB growth, backup/restore, and ACL denial behavior. Define quantitative acceptance thresholds with the hardware team.

## 5. Safe server checks (no MQTT device required)

```bash
cd /opt/lci-sfm
docker compose ps
curl -fsS http://127.0.0.1/api/health/ready   # if frontend binds only to loopback
# Or use the actual private LAN address configured in FRONTEND_BIND_IP
docker compose logs --tail=80 backend mqtt-service frontend_dashboard
```

For a production or live test server, **do not** run `scripts/ci-mqtt-contract-smoke.mjs`: that integration test generates commands and is gated to isolated CI. Never use `docker compose down -v` to diagnose readiness; it destroys persistent volumes.

**Go/no-go:** When installation, HTTP readiness, auth, WebSocket tests, backups and simulated-node MQTT CI pass, the **server implementation phase** can be considered ready for device integration. System/hardware reliability remains **not tested** until actual devices demonstrate the contract.
