# LCI-SFM Mosquitto Broker Provisioning & ACL Guide

The LCI-SFM MQTT broker (`eclipse-mosquitto:2.0`) enforces authenticated connections (`allow_anonymous false`) and per-device topic authorization (`mosquitto/acl`).

## 1. Required Broker Identities

| Identity (`username`) | Role | Permitted Subscriptions (`read`) | Permitted Publications (`write`) |
| :--- | :--- | :--- | :--- |
| `lci_backend` | Node.js Central Backend | `lecf/env/telemetry`, `lecf/access/mfa_face`, `lecf/access/state`, `lecf/access/command/ack`, `lecf/env/command/ack`, `lecf/+/heartbeat` | `lecf/access/command`, `lecf/env/command` |
| `node1_access` | Node 1 (ESP32-S3 Access/MFA) | `lecf/access/command`, `lecf/access/mfa_face` | `lecf/access/state`, `lecf/access/command/ack`, `lecf/node1/heartbeat` |
| `node2_env` | Node 2 (ESP32-S3 Env/HVAC) | `lecf/env/command` | `lecf/env/telemetry`, `lecf/env/command/ack`, `lecf/env/heartbeat` |
| `vision_service` | Python OpenCV Vision Container | *(none)* | `lecf/access/mfa_face`, `lecf/vision/heartbeat` |

## 2. Generating `/mosquitto/config/passwd` Before First Start

Never commit plaintext passwords or production password hashes to Git. On the air-gapped Raspberry Pi 4 host, generate the Mosquitto password file using the official container image:

```bash
mkdir -p mosquitto
touch mosquitto/passwd
chmod 0600 mosquitto/passwd

# Create/update each service identity interactively:
docker run --rm -it -v "$(pwd)/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0 \
  mosquitto_passwd -c /mosquitto/config/passwd lci_backend

docker run --rm -it -v "$(pwd)/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0 \
  mosquitto_passwd /mosquitto/config/passwd node1_access

docker run --rm -it -v "$(pwd)/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0 \
  mosquitto_passwd /mosquitto/config/passwd node2_env

docker run --rm -it -v "$(pwd)/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0 \
  mosquitto_passwd /mosquitto/config/passwd vision_service
```

Then set `MQTT_USERNAME=lci_backend` and `MQTT_PASSWORD=<your_lci_backend_password>` in `.env`.
