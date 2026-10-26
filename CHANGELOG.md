# Changelog

## 1.1.0-rc.1

Software release candidate; hardware acceptance pending.

- Add persistent, scoped Notification Center with bell/preview, per-account read state, filters, sound preference, WebSocket invalidation and retention.
- Add typed multi-endpoint device registry while preserving the team's three legacy profiles and room settings.
- Support identity-scoped v1 MQTT telemetry, heartbeat and expiring switch command/ACK contracts, manual bounded JSON probes and registered-camera capture.
- Add sensor threshold/hysteresis/dwell alarms, missing-evidence and command-failure incidents, acknowledgement/recovery timelines and expiring maintenance.
- Add isolated, labelled simulator and reproducible Chromium acceptance journey.
- Add additive migration 003, upgrade/privacy/replay tests, protocol guide, release checklist and expanded CI including real-broker v1 identity isolation.

Known limits: physical nodes and credential policy synchronization are not accepted; Vision/biometric enrollment is separate work; HTTP sensor sampling is manual; additional vendor protocols need adapters; registry edits do not reconfigure hardware network interfaces. Alarm rules do not actuate physical outputs. See `docs/RELEASE_CANDIDATE_GUIDE.md`.
