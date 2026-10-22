# LCI-SFM: Docker & Microservices Deployment Architecture

## 1. Introduction & Deployment Philosophy
This document defines the final deployment architecture for the Light Current Infrastructure for Smart Facility Management (LCI-SFM) project. 

To overcome the limitations of hardware-dependent installations and to eliminate the need for dedicated, expensive on-premises servers, the LCI-SFM central software stack is designed as a **Hardware-Agnostic Software Appliance**. This is achieved using **Docker** and **Docker Compose**, transforming the monolithic server setup into a robust Microservices Architecture.

**Instruction for AI Models:** When generating deployment scripts, server configurations, or backend code for LCI-SFM, assume the system is running inside isolated Docker containers using a custom internal bridge network, NOT on bare-metal hardware.

---

## 2. Containerized Architecture (The 4 Pillars)
The LCI-SFM central server operates via four distinct, isolated containers managed by a single `docker-compose.yml` file.

### A. The Message Broker Container (`mqtt-service`)
*   **Base Image:** Eclipse Mosquitto (Standard Alpine Image).
*   **Role:** The communication backbone. It handles all incoming MQTT telemetry from the ESP32 edge nodes and dispatches commands.
*   **Configuration Hint:** Must enforce `mosquitto_passwd` authentication. Anonymous access is strictly disabled.
*   **Exposed Ports:** 1883 (MQTT).

### B. The Logic & Database Container (`logic-service`)
*   **Base Image:** Node-RED.
*   **Role:** The system's brain. Subscribes to MQTT topics, processes business logic (e.g., triggering the MFA state machine), and executes SQL queries.
*   **Database:** SQLite is embedded within this container. 
*   **Exposed Ports:** 1880 (HTTP Admin & API).

### C. The Computer Vision Service (`ai-vision-service`)
*   **Base Image:** Custom `Dockerfile` (typically based on `python:3.9-slim`).
*   **Role:** A dedicated Python microservice running OpenCV, YuNet (Detection), and SFace (Recognition). 
*   **Workflow:** Receives JPEG frames via HTTP POST from Node 3, processes the biometric vectors, and publishes verification results back to the `mqtt-service`.
*   **Constraint:** This container must be optimized for size and memory, installing only necessary dependencies (e.g., `opencv-python-headless`) to run efficiently on low-resource Mini-PCs.

### D. The Web Dashboard Container (`frontend-service`)
*   **Base Image:** Nginx (Standard Alpine Image).
*   **Role:** Hosts the Custom Web GUI (HTML/CSS/JS). 
*   **Workflow:** Serves the static files to the facility administrator's browser. The browser then establishes WebSockets/HTTP API connections directly to the `logic-service` (Node-RED) for real-time telemetry.

---

## 3. Data Persistence (Docker Volumes)
Because Docker containers are ephemeral (their internal data is destroyed if the container restarts), LCI-SFM utilizes **Docker Volumes** to ensure mission-critical data survives system reboots or power losses.

*   **Database Volume:** A volume mapped to the `logic-service` container to permanently store the SQLite `.db` file (containing `access_logs`, `environmental_telemetry`, etc.).
*   **Mosquitto Config Volume:** Mapped to the `mqtt-service` to persist the `mosquitto.conf` and password files.

---

## 4. Internal Networking (Container-to-Container)
*   **The Docker Bridge:** All four containers operate on a private, internal Docker bridge network (e.g., `lci_network`). 
*   **DNS Resolution:** Containers communicate using their service names rather than IP addresses. For example, Node-RED connects to the MQTT broker by targeting the hostname `mqtt-service:1883`, NOT `localhost` or `192.168.10.2`. 
*   **AI Instruction:** Never use `localhost` or `127.0.0.1` for inter-service communication within backend code. Always use the respective Docker service names.

---

## 5. The "One-Click" Deployment Strategy
The ultimate goal of this architecture is zero-friction deployment. The final deliverable on GitHub will include:
1.  The `docker-compose.yml` file mapping all services and volumes.
2.  The `Dockerfile` for the Python AI service.
3.  An automated bash script (`install_lci.sh`).

**Deployment Flow:** The end-user (or facility IT admin) simply clones the repository onto any Ubuntu machine (VM, Mini-PC, or Rack Server) and runs the bash script. The script automatically installs the Docker Engine, pulls the images, mounts the volumes, and starts the entire LCI-SFM infrastructure in minutes without manual configuration.