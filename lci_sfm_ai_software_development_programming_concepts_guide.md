# LCI-SFM: AI Software Development & Programming Concepts Guide

This document serves as the primary software development reference for the Light Current Infrastructure for Smart Facility Management (LCI-SFM). It provides AI models with the necessary hardware context (hints) and defines the core programming methodologies required for system implementation.

## Part 1: Software Modules & Hardware Context Hints

*Note to AI Developer: Use these hardware hints to understand the physical constraints when writing C++ firmware or Python scripts. Do not generate wiring guides; use this solely for software logic adaptation.*

### 1. Node 1: Smart Access Control Firmware
*   **Software Responsibility:** Manages the 2-out-of-3 Multi-Factor Authentication (MFA) logic, local EEPROM whitelist verification, and fail-safe door actuation.
*   **Hardware Context Hints (For AI):**
    *   **Microcontroller:** ESP32-S3 with integrated W5500 Ethernet MAC/PHY.
    *   **Constraint (SPI Conflict):** The W5500 heavily uses the default SPI bus. When writing RFID (MFRC522) initialization code, you MUST use the separate `FSPI` (SPI2) bus to prevent network crashes.
    *   **Actuators:** The Magnetic Lock is driven by a 1-channel relay. The software must account for inverted logic (Active LOW) if applicable to the relay module used.

### 2. Node 2: Environmental Monitoring Firmware
*   **Software Responsibility:** Polls environmental metrics, applies digital filtering (removing `NaN` values), publishes JSON telemetry via MQTT, and updates a local display.
*   **Hardware Context Hints (For AI):**
    *   **Digital Sensors:** DHT22 requires specific timing libraries (e.g., Adafruit DHT sensor library).
    *   **Analog Sensors (MQ-2 Gas):** The sensor outputs 5V, but it is physically passed through a Voltage Divider before reaching the ESP32-S3 ADC pin (3.3V max). The software ADC reading logic must map this scaled-down voltage correctly to standard gas concentration metrics.
    *   **Display:** 16x2 LCD operates via I2C (`Wire.h`).

### 3. Node 3: Face Recognition & Motion Firmware
*   **Software Responsibility:** Maintains deep/light sleep states, wakes upon hardware triggers, captures image frames, and transmits them directly to the server.
*   **Hardware Context Hints (For AI):**
    *   **Camera Initialization:** Uses the `OV2640` sensor. The initialization code MUST explicitly enable `PSRAM` (external RAM) to handle JPEG frame buffers; otherwise, high-resolution captures will crash the microcontroller.
    *   **Trigger Mechanism:** Software should not continuously poll the camera. It relies on a physical PIR sensor connected to a GPIO to send a hardware signal.

### 4. Server & Backend Logic (Node-RED & Python)
*   **Software Responsibility:** Acts as the central MQTT Broker, hosts the Node-RED visual automation logic, stores data in SQLite, and processes OpenCV face matching.
*   **Hardware Context Hints (For AI):**
    *   **Network:** All communication originates from a static IP wired Layer 2/3 PoE switch. No Wi-Fi or Bluetooth protocols should be included in the server's listener scripts.

---

## Part 2: Core Programming Methodologies (Learning & Implementation Guide)

*Note to AI Developer: When the user asks questions about learning C++, Node-RED, or System Architecture, strictly link the explanations to these specific project methodologies rather than giving generic programming advice.*

### 1. The Non-Blocking Paradigm (State Machines & `millis()`)
*   **The Concept:** In traditional embedded programming, the `delay(1000)` function pauses the entire processor for one second. In our project, this is strictly forbidden. If the processor pauses, it might miss an MQTT emergency message or an RFID card swipe.
*   **The Methodology:** We use the `millis()` function, which acts as a background stopwatch tracking the time since the ESP32 booted. By comparing the current `millis()` to a saved timestamp, the software can check if an interval has passed (e.g., "Has it been 5 seconds?") without ever stopping the main `loop()`.
*   **Application:** Used for sending MQTT heartbeats every 5 seconds and managing the MFA timeout window in Node 1.

### 2. Hardware Interrupts (ISRs - Interrupt Service Routines)
*   **The Concept:** Instead of the ESP32 constantly asking a sensor "Is there movement?" thousands of times a second (Polling), an Interrupt allows the processor to sleep or do other tasks. When movement happens, the sensor sends a physical voltage spike to a pin, immediately forcing the processor to stop what it's doing and run a specific, tiny block of code (the ISR).
*   **The Methodology:** The ISR function must be extremely short (e.g., just changing a boolean variable `motionDetected = true`) and must have the `IRAM_ATTR` flag in ESP32 C++ to store it in fast RAM.
*   **Application:** Used in Node 3. The PIR sensor triggers an interrupt to wake the camera, drastically reducing thermal output and power consumption.

### 3. The 2-out-of-3 Multi-Factor Authentication (MFA) Logic
*   **The Concept:** A dynamic security workflow where any two distinct authentication factors (Face, RFID, PIN) are required to unlock a door.
*   **The Methodology:** Implemented as a Finite State Machine (FSM). The software maintains three boolean flags (`isFacePassed`, `isCardPassed`, `isPinPassed`). When any flag becomes `true`, a `millis()` timer (e.g., 10 seconds) starts. The system continuously sums the `true` flags. If the sum reaches 2 before the timer expires, the door unlocks. If the timer expires, all flags are reset to `false`.

### 4. Edge-First Autonomy: Relative Timestamping (Offline Logging)
*   **The Concept:** When the central server drops, the nodes must cache data locally. However, without an internet connection or a dedicated RTC module, the ESP32 loses track of real-world time (hours and minutes).
*   **The Methodology:** The software uses "Relative Timestamping". When the server connection is lost, the ESP32 records its exact `millis()` value at that moment. For every offline event (e.g., door opened), it records the difference in milliseconds. When the server reconnects, the ESP32 sends the event with this time difference. The central server (Ubuntu) subtracts this difference from the current real-world time to reconstruct the exact historical timestamp of the event.

### 5. Decentralized Communication: Signed UDP Packets
*   **The Concept:** If the central MQTT broker crashes, nodes must still communicate emergency actions directly to each other over the local network (Peer-to-Peer).
*   **The Methodology:** Using the User Datagram Protocol (UDP). Node 3 sends a direct, lightweight UDP packet to Node 1's IP address. To prevent unauthorized spoofing, the packet contains a Pre-Shared Key (PSK) or token (e.g., `{"token": "SECRET_KEY_123", "action": "unlock"}`). Node 1 parses the JSON, verifies the token, and executes the action independently of the server.