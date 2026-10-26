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

After adding all four identities, make the password file readable by the Mosquitto container's broker user (UID/GID 1883 in the standard image) while keeping it private:

```bash
sudo chown 1883:1883 mosquitto/passwd
sudo chmod 0600 mosquitto/passwd
```

Because the file is owned by UID 1883, use `sudo` or the provisioning container as root when updating it later. Never commit this file.

Then set `MQTT_USERNAME=lci_backend` and `MQTT_PASSWORD=<the exact password entered for lci_backend>` in `.env`. The password in `.env` must match the password hashed into this file.

## 3. Network binding and firewall

The Compose file supports `MQTT_BIND_IP`. Keep it at `127.0.0.1` while testing locally. If ESP32 devices must connect to Mosquitto over the LAN, set it to the server's **static private LAN IPv4 address** (for example, `192.168.43.225` only if that is actually the server address), then allow TCP 1883 only from the required device IPs using the host/upstream firewall. Do not bind the broker to every public interface or expose plain MQTT to the public internet.

Docker-published ports can bypass ordinary UFW filtering depending on the host's networking setup. Review Docker's official firewall guidance and enforce restrictions in the appropriate `DOCKER-USER`/upstream firewall path: https://docs.docker.com/engine/install/ubuntu/#firewall-limitations

Before starting Compose, verify that `mosquitto/passwd` exists. The Compose bind mount expects this file; do not create a directory named `passwd` in its place.

## Additional v1 devices

Register an immutable device ID in the console and provision a matching broker username on the host. The ACL now scopes `lci/v1/devices/%u/{telemetry,heartbeat,ack}` writes and `%u/command` reads to that authenticated username. Backend reads use its own scoped wildcard entries. Do not reuse backend credentials in devices. See the [v1 protocol and provisioning guide](../docs/RELEASE_CANDIDATE_GUIDE.md#broker-provisioning-for-an-additional-mqtt-device). Legacy service identities and `lecf/...` contracts remain supported.
