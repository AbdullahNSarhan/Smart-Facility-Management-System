# Hardware & Embedded Systems Architecture Reference
**Project:** Light Current Infrastructure for Smart Facility Management (LCI-SFM)
**Sub-system:** Layer 1 & Layer 2 (Edge Nodes, Peripherals, and Network Backbone)

## 1. Architectural Philosophy
This document serves as the canonical hardware configuration guide for the LCI-SFM system. The architecture relies on an **"Edge-First Autonomy"** paradigm. Microcontrollers (ESP32-S3) are deployed at the edge and powered via a wired Power over Ethernet (PoE) backbone. Wireless communications (Wi-Fi/Bluetooth) are strictly prohibited. The hardware is designed to execute local logic (access control, environmental regulation) even during a total server blackout.

---

## 2. Final Bill of Materials (BOM) & Allocation

### Layer 2: Network & Power Infrastructure
*   **1x HIKVISION Ethernet Switch (DS-3E0106MP-E/M):** 10/100M Unmanaged Active PoE switch (4 PoE ports, 2 Uplink). Provides up to 30W per port (45W total budget) at 48V DC via IEEE 802.3af/at.
*   **4x CAT6 Cables:** UTP cabling for air-gapped data and PoE transmission.
*   **2x Power Adapters (12V-1A):** Independent power supplies allocated for heavy inductive loads (Node 1 Magnetic Lock and Node 2 Fan) to prevent PoE power drops.

### Layer 1: Edge Nodes (Microcontrollers & Peripherals)
**Node 1: Smart Access Control System (MFA & Egress)**
*   **Microcontroller:** 1x ESP32-ETH-POE (ESP32-S3 core).
*   **Authentication Peripherals:** 1x RFID-RC522 (SPI) with 3 cards, 1x 4x4 Matrix Keypad.
*   **Actuator & Driver:** 1x Magnetic Lock (12V-1A Fail-Safe), 1x Relay board (1-channel).
*   **Egress & Monitoring:** 1x Magnetic reed switch (Door state), 1x Push-to-Exit button (Normally Open), 1x Break-Glass Emergency button.
*   **Feedback:** 1x Active Buzzer (5~12V DC).

**Node 2: Environmental Monitoring & HVAC Actuation**
*   **Microcontroller:** 1x ESP32-ETH-POE (ESP32-S3 core).
*   **Sensors:** 1x Precision Digital temperature sensor (DHT22), 1x Smoke/Gas Sensor Module MQ2, 1x LDR module (3-pin digital/analog).
*   **Actuator & Driver:** 1x Golden Falcon DC 12V Brushless Fan Motor, 1x Relay board (2-channel).
*   **Display:** 1x 16x2 LCD display (with I2C module).

**Node 3: Biometric Face Recognition & Motion**
*   **Microcontroller:** 1x ESP32-ETH-POE-CAM (ESP32-S3 core with OV2640 Camera and PSRAM).
*   **Trigger:** 1x PIR Motion Sensor module (Hardware Interrupt).

**Custom Circuit Components & Spares**
*   **Spares:** 2x ESP32-ETH-POE-CAM, 2x ESP32-ETH-POE, 1x Spare Push Button.
*   **Custom PCB Components:** 10x Resistors ($1k\Omega, 2.2k\Omega, 10k\Omega$), 10x Capacitors ($100\mu F-25V, 0.01\mu F-50V$), 80x Connection wires.

---

## 3. Wiring Limitations, Hardware Traps & Engineering Solutions

When writing the C++ firmware (using PlatformIO/Arduino framework) or assigning GPIO pins, the following hardware constraints and engineering solutions **MUST** be strictly observed to prevent physical board damage or firmware freezing.

### Trap 1: Node 1 SPI Bus Conflict (Ethernet vs. RFID)
*   **The Problem:** The on-board W5500 Ethernet chip operates on the internal SPI bus (GPIOs 9, 10, 11, 12, 13, 14). Connecting the MFRC522 RFID reader to these default SPI pins will cause an immediate bus collision, crashing both network connectivity and RFID reads.
*   **The Solution:** The MFRC522 must be explicitly initialized on a secondary SPI bus (FSPI/SPI2) using distinct, unreserved GPIO pins. 

### Trap 2: Node 2 ADC Overvoltage (MQ-2 Sensor)
*   **The Problem:** The MQ-2 Smoke/Gas sensor outputs an analog signal that scales up to $5V$. The ESP32-S3 ADC pins have a strict maximum input tolerance of $3.3V$. Direct connection will instantly burn out the microcontroller's ADC channel.
*   **The Solution:** Implement a hardware Voltage Divider circuit using the procured resistors. For example, use a $1k\Omega$ resistor ($R_1$) and a $2.2k\Omega$ resistor ($R_2$) to safely drop the $5V$ output to approximately $3.4V$ maximum before routing it to the ESP32 ADC pin.
    *   Formula: $V_{out} = V_{in} \times \frac{R_2}{R_1 + R_2}$

### Trap 3: Relay Inductive Kickback & Isolation
*   **The Problem:** Switching the 12V Magnetic Lock (Node 1) and the 12V Brushless Fan (Node 2) generates severe back-EMF (voltage spikes) that can reset or destroy the ESP32.
*   **The Solution:** 
    1.  The `JD-VCC` jumper on both relay boards **MUST** be removed to achieve true optical isolation.
    2.  The Relay Coils will be powered via a custom-designed isolation circuit built with the lab professor, completely separating the ESP32 $3.3V$ logic ground from the heavy load grounds.
    3.  Independent 12V-1A power adapters are assigned to power the lock and fan to avoid draining the PoE step-down converter.

### Trap 4: GPIO Exhaustion & Strapping Pins
*   **The Problem:** The ESP32-S3-POE board has internally reserved pins:
    *   **PSRAM:** GPIO 33 to 37.
    *   **Internal Flash / SD Card:** GPIO 26 to 32, and GPIO 4, 5, 6, 7.
    *   **Strapping Pins:** GPIO 0, 3, 45, 46 (Pulling these high/low during boot will freeze the board).
*   **The Solution:** Do not assign mechanical switches, relays, or pull-up/pull-down sensors to strapping pins. If Node 1 faces a pin shortage due to the 4x4 Keypad (which requires 8 pins), the software must either utilize an I2C Expander (PCF8574) or strictly map the matrix to the remaining safe GPIOs (e.g., GPIO 1, 2, 8, 15, 16, 17, 18).

---

## 4. Software Logic Directives (For AI Developer Context)

Future software implementations must adhere to these established logical workflows:

### A. Non-Blocking Execution Mandate
The `delay()` function is strictly forbidden across all firmware. All sensor polling, RFID reading, and network keep-alives must be executed asynchronously using non-blocking state machines reliant on the `millis()` function.

### B. "2-out-of-3" Multi-Factor Authentication (MFA)
Node 1 will act as the master aggregator for access control. To grant access, the system requires any **two** successful authentication factors out of three (Face, RFID Card, PIN).
*   **Workflow:** When one factor succeeds (e.g., Node 3 publishes a successful face match via MQTT to `lecf/access/mfa_face`), Node 1 sets a boolean flag (`isFacePassed = true`) and initiates a 10-second `millis()` timeout window. 
*   If a second factor (Card or PIN) is successfully validated locally within that window, the Solenoid Lock relay is triggered. If the timeout expires, all flags reset to `false`.

### C. Relative Timestamping (Offline Data Logging)
Since physical RTC modules (DS3231) were excluded, offline timestamping will utilize a "Relative Timestamping" workaround:
1.  While the server is online, the ESP32 syncs its internal clock.
2.  Upon server disconnection, the ESP32 records the exact `millis()` value of the dropout.
3.  Any offline event (e.g., a door open event) is logged to the local SD card/Flash with a timestamp calculated as: `Event Time = Last Known Server Time + (Current millis() - Dropout millis())`.
4.  Upon server reconnection, the ESP32 transmits these sequenced logs to the Node-RED/SQLite backend for historical database insertion.

### D. Emergency Egress (Break Glass)
The Break-Glass unit is physically hardwired in series with the 12V Magnetic Lock's power supply line. Breaking the glass immediately drops power to the fail-safe lock, ensuring physical escape regardless of software state. A secondary wire from the unit is connected to an ESP32 GPIO to instantly publish an emergency alarm payload via MQTT.