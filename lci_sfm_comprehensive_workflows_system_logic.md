# LCI-SFM: Comprehensive System Workflows, Logic & Vulnerability Closure Reference

**[AI INSTRUCTION MANDATE]**
*Any AI model reading this document MUST adhere strictly to the logic, workflows, and error-handling mechanisms defined here when generating C++ firmware, Python scripts, or Node-RED flows for the LCI-SFM project. Do not hallucinate external cloud dependencies, delays (`delay()`), or centralized workarounds.*

---

## 1. Internal Edge Workflows (Intra-Node Logic)
This section defines the isolated, hardware-level logic loops running independently on each ESP32-S3 microcontroller to guarantee **Edge-First Autonomy**.

### A. Node 1 (Smart Access) - The MFA State Machine
*   **Execution:** Continuous non-blocking loop using `millis()`.
*   **The 2-out-of-3 MFA FSM:**
    1.  **STATE_IDLE:** The system actively monitors the RFID SPI bus, the Keypad matrix, and incoming MQTT/UDP triggers.
    2.  **Factor 1 Registered:** User presents a valid RFID card (checked against local EEPROM whitelist) OR Face is verified (via network).
        *   Node sets specific Boolean flag (e.g., `isCardPassed = true`).
        *   Node shifts to `STATE_AWAITING_STAGE2`.
        *   Internal `MFA_Timer` starts (Timeout Window = 10,000 ms).
        *   Local buzzer emits a short beep.
    3.  **Factor 2 Registered:** User enters a valid PIN (checked locally) OR Face is verified.
        *   Node sets specific Boolean flag (e.g., `isPinPassed = true`).
    4.  **Actuation & Score Check:** If `(isCardPassed + isPinPassed + isFacePassed) >= 2`, Node triggers the fail-safe relay to unlock the door for 5 seconds, publishes a success log, and resets all flags to `IDLE`.

### B. Node 2 (Environmental) - Edge Filtering & Actuation
*   **Polling:** Reads DHT22 (Temp/Hum) and MQ-2 (Gas/Smoke) every 2000 ms using `millis()`.
*   **Edge Data Validation:** The ESP32 does NOT blindly transmit data. It checks for `NaN` or mathematically impossible values (e.g., Humidity > 100%).
*   **Autonomous Actuation:** If Temp > 30°C or Smoke is detected, Node 2 immediately triggers the local 12V Brushless Fan relay *without* asking the server, then updates the local 16x2 I2C LCD and publishes the new state to the network.

### C. Node 3 (Biometric Cam) - Thermal & Interrupt Management
*   **Standby Mode:** To prevent thermal throttling and save power, the OV2640 camera and PSRAM remain in a low-power/sleep state.
*   **Hardware Trigger:** The PIR sensor detects motion within 1.5 meters -> triggers a Hardware Interrupt (ISR).
*   **Capture Pipeline:** Wake up -> Flash LED -> Initialize Frame Buffer -> Capture JPEG -> Store in PSRAM -> Transmit -> Return to sleep.

---

## 2. Standard Transport Workflows (Node-to-Server)
How data moves through the air-gapped CAT6 PoE network under normal conditions.

### A. Telemetry & State Routing (MQTT)
*   **Publisher:** Node 2 packages data into JSON: `{"node":"env_02", "temp":26.5, "smoke":false, "seq":104}`.
*   **Broker:** Transmitted to the Ubuntu Server via MQTT (Topic: `lecf/env/telemetry`).
*   **QoS Level:** Uses QoS 1 (At least once) to ensure delivery.

### B. Biometric Transmission (HTTP POST)
*   **Bandwidth Optimization:** Sending images over MQTT causes broker bottlenecks. Node 3 transmits the JPEG frame directly to the Ubuntu Server's Python Service via an `HTTP POST` request.
*   **Server Processing:** Python (OpenCV/YuNet/SFace) analyzes the binary payload. If matched, the *Server* publishes `{"status":"verified", "user_id":"admin_1"}` to the MQTT topic `lecf/access/mfa_face`.

---

## 3. Server & Backend Workflows (Logic Engine & DB)
The data lifecycle inside the centralized management stack.

### A. Data Ingestion & Storage (Node-RED to SQLite)
*   **Parsing:** Node-RED subscribes to MQTT topics, receives JSON, and parses the payload.
*   **De-duplication (Loophole Closure):** Node-RED checks the `seq` (Sequence Number) and `node_id`. If a payload with this exact sequence was already stored, it drops the message to prevent database bloat from network replays.
*   **Storage:** Executes SQL `INSERT` commands into `access_logs`, `environmental_telemetry`, or `system_errors`.

### B. Real-Time UI Workflow (Node-RED to Dashboard)
*   **WebSockets:** Node-RED pushes live sensor states via WebSocket nodes.
*   **Custom GUI:** The frontend (HTML/JS) instantly updates Gauges, Charts, and Door Color Indicators (Green/Red) asynchronously without refreshing the page.

---

## 4. Cascading Failures & Advanced Vulnerability Closures
This section maps out complex, multi-layered error scenarios (where one failure triggers another) and defines the exact architectural workflows designed to close these loopholes.

### Vulnerability A: The Post-Outage Server Flood (Self-DDoS)
*   **The Cascading Scenario:** The Ubuntu server goes offline for 3 hours. Nodes 1 and 2 continue working and cache hundreds of logs locally. When the server boots back up, all nodes simultaneously dump their entire flash memory payloads to the MQTT broker in the same millisecond. The Mosquitto broker or Node-RED crashes due to RAM exhaustion (Self-DDoS).
*   **Closure Workflow (Sequential Syncing):**
    1.  When a node detects the server is back online (successful Ping/MQTT reconnect), it waits for a *Randomized Jitter Delay* (e.g., `random(500, 3000)` ms).
    2.  The node enters `SYNC_MODE`.
    3.  It reads logs from the Flash Memory/SD one by one, publishing them with a strict **100ms non-blocking delay** between each message.
    4.  Node-RED processes them smoothly without bottlenecking the SQLite write speed.

### Vulnerability B: Network Switch Total Failure (Physical Blackout)
*   **The Cascading Scenario:** A fire breaks out. Node 2 detects it. Node 2 attempts to send a "Fire Alarm - Unlock Door" message to Node 1 via Signed UDP (P2P). However, the fire has melted the PoE Network Switch. Node 1 and Node 2 can no longer communicate over the network. The door remains locked during a fire.
*   **Closure Workflow (Hardwired Fail-Safe Bypass):**
    1.  The project relies on "Fail-Safe" magnetic locks (requires power to stay locked).
    2.  The "Break Glass" emergency button is physically hardwired in series with the 12V power supply of the magnetic lock.
    3.  Even if the entire network, switch, server, and microcontrollers melt, pressing the physical break-glass button physically cuts the circuit, instantly dropping the magnetic lock and allowing safe egress.

### Vulnerability C: Sensor Hardware Glitch (The False Positive Cascade)
*   **The Cascading Scenario:** A wire on Node 2's MQ-2 gas sensor becomes loose, causing an erratic voltage spike on the ESP32's ADC pin. The ESP32 reads this as "Massive Smoke". It sends an emergency UDP packet to Node 1 to unlock the door. The door unlocks, exposing the server room to intruders due to a loose wire.
*   **Closure Workflow (Debounce & Multi-Sampling):**
    1.  Node 2's firmware must implement a *Confidence Threshold*.
    2.  A single high reading does NOT trigger an alarm. The ESP32 must register **3 consecutive abnormal readings** over a span of **6 seconds** (checking every 2 seconds).
    3.  Only if `smoke_detected_count >= 3` will Node 2 execute the Emergency Fire Workflow.

### Vulnerability D: The MFA Logic Manipulation (The Replay Loophole)
*   **The Cascading Scenario:** A user knows the system requires 2 factors. They scan their RFID card. The system gives them 1 point and starts the 10-second timer. They simply scan the *same* RFID card again. The system sees a second valid input, gives another point (Score = 2), and unlocks the door, entirely bypassing the PIN or Face requirement.
*   **Closure Workflow (Strict Boolean Factor Isolation):**
    1.  The FSM uses isolated boolean flags: `isCardPassed`, `isPinPassed`, `isFacePassed`.
    2.  If the user scans the card, `isCardPassed` is set to `true` (1).
    3.  If they scan it again, `isCardPassed` is reassigned `true` (still 1).
    4.  The mathematical condition `(isCardPassed + isPinPassed + isFacePassed) >= 2` can *never* be met using the same hardware factor. The user is forced to switch modalities.

### Vulnerability E: Malicious Insider Network Spoofing (UDP Injection)
*   **The Cascading Scenario:** An insider unplugs Node 2, connects their laptop to the PoE switch (giving them access to the Air-Gapped LAN), and runs a Python script to flood Node 1's IP address with UDP packets saying `{"action":"unlock"}`.
*   **Closure Workflow (Cryptographic Token Validation):**
    1.  Node 1 ignores all UDP packets unless they contain the exact, hardcoded Pre-Shared Key (PSK).
    2.  The payload must look like: `{"token": "SFM_SECURE_99X_LCI", "action": "emergency_unlock"}`.
    3.  If the `token` is missing or mismatched, Node 1 silently drops the packet and increments a local `security_breach_count` flag.

### Vulnerability F: Relative Time Drift (The Offline Time Paradox)
*   **The Cascading Scenario:** The server dies. The nodes fall back to recording offline logs using `millis()`. The server stays dead for 3 days. When logs are finally synced, the server doesn't know *when* the events actually happened because `millis()` only counts time since the ESP32 booted.
*   **Closure Workflow (Offset Subtraction):**
    1.  When a node records an offline event, it saves: `{"event":"rfid_scan", "uptime_ms": 1500000}`.
    2.  When the server comes back online, the Node sends a sync packet: `{"current_uptime_ms": 2500000}`.
    3.  Node-RED receives the logs and does the math: `Server_Real_Time - (2500000 - 1500000)`.
    4.  Node-RED accurately calculates the exact real-world timestamp of the offline event and inserts it cleanly into the SQLite database.