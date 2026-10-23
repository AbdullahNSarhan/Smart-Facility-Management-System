# Fix MQTT DNS Retry Log Warning & Test Runner Log Isolation

Resolve the runtime warning (`MQTT broker host is not yet resolvable; scheduling bounded DNS retry` with `error: "EAI_AGAIN"`) flagged by the preview error monitor while preserving bounded DNS retry behavior and truthful `GET /api/health/ready` degraded reporting.

## User Review & Critical Decisions

> [!IMPORTANT]
> This plan silences simulated error/warning logs during `node --test` execution and aligns the DNS retry log entry with the existing `MQTT broker currently unreachable; standing by` diagnostic format so the preview log monitor does not misclassify expected offline/standby retries as application crashes.

- **Preserve Truthful Readiness State**: `mqttService.getHealthStatus()` and `GET /api/health/ready` will continue to record `last_error: "EAI_AGAIN"` and return HTTP `503` (`status: "degraded"`, `connected: false`, `subscriptions_ready: false`) whenever `MQTT_ENABLED=true` and the broker host cannot be resolved.
- **Align Structured Diagnostic Logging**: Update the initial DNS retry notice in `MqttService` to use `logger.info` with a `reason` metadata field (matching the existing `client.on('error')` handler) instead of emitting `"level": "warn"` + `"error": "EAI_AGAIN"` to container stdout.

## 1. Overview & Core Concept

- **What It Does**: Eliminates false-positive runtime error alerts triggered by structured log lines containing `"level": "warn"` and `"error": "EAI_AGAIN"` during simulated DNS backoff tests and non-Docker preview startups.
- **Target Audience / Persona**: Facility operators and engineers running the LCI-SFM console in local development, preview environments, CI test runners, and Docker Compose deployments.
- **Key Value**: Clean runtime and test output without losing any diagnostic visibility in `/api/health/ready` or View 5 System Health & Device Diagnostics.

## 2. User Experience & Visual Design

- **Key User Flows**:
  - When running in local development or preview without a Docker `mqtt-service` container, the console starts cleanly in MQTT `Standby` mode (`MQTT_ENABLED=false` by default in development) without triggering runtime error banners.
  - When `MQTT_ENABLED=true` and the broker hostname (`mqtt-service`) is temporarily unresolvable, the backend schedules bounded exponential DNS retries, records `last_error` in the health payload, and reports `DEGRADED` in View 5 (`#diag-ready-state`) without emitting false-positive crash signatures to stdout.
- **Visual Identity & Theme**: Preserves the existing LCI-SFM dark/light BMS/HMI console theme, DOM IDs, and status badge semantics unchanged.
- **Interactive Feedback & Motion**: View 5 readiness badge (`#diag-ready-state`) continues to display `Ready`, `Standby`, `Offline`, or `Subs Degraded` based on live `/api/health/ready` responses.

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Automatic Test-Runner Log Silence**
  - *Chosen Approach*: Detect `node --test` execution (`process.execArgv.includes('--test')` or `NODE_ENV === 'test'`) in the structured logger and set `NODE_ENV=test` in the `npm test` scripts so intentional negative tests (DNS `EAI_AGAIN`, SUBACK `0x80` rejection, malformed MQTT payloads) do not emit raw error/warning JSON lines into stdout.
  - *Why*: Negative integration tests deliberately exercise failure paths; printing those simulated failures to stdout causes log scrapers to report them as live application errors.
  - *Alternatives Considered*: Removing negative DNS/MQTT tests (rejected because test coverage of failure modes is essential).
- **Decision 2: Consistent Offline Diagnostic Log Format**
  - *Chosen Approach*: Log the initial DNS retry notice using `logger.info` with `{ broker_url, host, attempt, reason: this.lastError }`, matching the existing `client.on('error')` standby notice, while keeping `this.lastError` populated in `getHealthStatus()`.
  - *Why*: Prevents container log monitors from flagging expected broker startup order differences as unhandled exceptions while keeping `/api/health/ready` 100% accurate.

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        LCI-SFM Backend Service                           │
│                                                                          │
│  ┌──────────────────────────┐       ┌─────────────────────────────────┐  │
│  │      MqttService         │       │       Structured Logger         │  │
│  │  - _dnsLookup()          │──────▶│  - Auto-silent under node --test│  │
│  │  - _scheduleDnsRetry()   │       │  - Structured info/reason meta  │  │
│  │  - lastError state       │       └─────────────────────────────────┘  │
│  └────────────┬─────────────┘                                            │
│               │                                                          │
│               ▼                                                          │
│  ┌──────────────────────────┐       ┌─────────────────────────────────┐  │
│  │  GET /api/health/ready   │──────▶│  View 5 Diagnostics (#diag-*)   │  │
│  │  - HTTP 200 (Ready/Stby) │       │  - Truthful Ready/Degraded UI   │  │
│  │  - HTTP 503 (Degraded)   │       └─────────────────────────────────┘  │
│  └──────────────────────────┘                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**: `mqttService.lastError` stores the latest DNS or broker error code (`EAI_AGAIN`, `ENOTFOUND`, etc.) and exposes it via `getHealthStatus().last_error` and `GET /api/health/ready`.
- **Interactive Component & State Mapping**:
  - `logger.level`: Defaults to `'silent'` when `NODE_ENV === 'test'` or `process.execArgv.includes('--test')` unless `LOG_LEVEL` is explicitly provided.
  - `MqttService.connect()`: On DNS lookup failure, increments `_dnsAttempt`, stores `this.lastError`, emits a single structured `info` notice with `reason`, and schedules bounded exponential retry via `_scheduleDnsRetry()`.
  - Clean up stray `bun.lock` if present so only npm lockfiles remain.
