import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Thermometer,
  Droplets,
  Flame,
  DoorOpen,
  DoorClosed,
  Fan,
  Lightbulb,
  Fingerprint,
  CreditCard,
  KeyRound,
  Camera,
  Database,
  Activity,
  Server,
  Settings,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  UserPlus,
  Network,
  AlertTriangle,
  CheckCircle2,
  Sliders,
} from 'lucide-react';
import {
  LightState,
  DoorState,
  FanRelayState,
  MfaStatus,
  ControlMode,
  AccessLogRecord,
  EnvironmentalTelemetryRecord,
  CameraEventRecord,
  SystemErrorRecord,
  ProvisionedUser,
  ActivityFeedItem,
  NodeHeartbeatStatus,
} from './types/lci';
import {
  INITIAL_ACCESS_LOGS,
  INITIAL_ENVIRONMENTAL_TELEMETRY,
  INITIAL_CAMERA_EVENTS,
  INITIAL_SYSTEM_ERRORS,
  INITIAL_PROVISIONED_USERS,
  INITIAL_ACTIVITY_FEED,
  generateInitialHistoryWindow,
} from './data/initialFacilityData';
import { generateBiometricCameraJpeg } from './utils/cameraFrameGenerator';
import { CircularGauge, FifoLineChart } from './components/EnvironmentalWidgets';
import { VanillaExportModal } from './components/VanillaExportModal';

type ViewId = 'view1' | 'view2' | 'view3' | 'view4' | 'view5' | 'view6';
type AuditTableTab = 'access_logs' | 'camera_events' | 'environmental_telemetry';

const CENTRAL_NODE_RED_HOST = '192.168.10.2:1880';
const SMOKE_DANGER_THRESHOLD = 400; // PPM

function formatNowTime(): string {
  const d = new Date();
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':');
}

function formatNowTimestamp(): string {
  const d = new Date();
  const datePart = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  return `${datePart} ${formatNowTime()}`;
}

export default function App() {
  // ==========================================================================
  // 1. DYNAMIC IP CONFIGURATION STATE (localStorage: ip_node1, ip_node2, ip_node3)
  // ==========================================================================
  const [ip_node1, setIpNode1] = useState<string>(() => localStorage.getItem('ip_node1') || '');
  const [ip_node2, setIpNode2] = useState<string>(() => localStorage.getItem('ip_node2') || '');
  const [ip_node3, setIpNode3] = useState<string>(() => localStorage.getItem('ip_node3') || '');
  const [isNodesConfigured, setIsNodesConfigured] = useState<boolean>(() =>
    Boolean(
      localStorage.getItem('ip_node1') &&
        localStorage.getItem('ip_node2') &&
        localStorage.getItem('ip_node3')
    )
  );
  const [showStartupModal, setShowStartupModal] = useState<boolean>(false);
  const [modalIp1, setModalIp1] = useState<string>(() => localStorage.getItem('ip_node1') || '192.168.10.11');
  const [modalIp2, setModalIp2] = useState<string>(() => localStorage.getItem('ip_node2') || '192.168.10.12');
  const [modalIp3, setModalIp3] = useState<string>(() => localStorage.getItem('ip_node3') || '192.168.10.13');

  // Active Node IPs used for HTTP requests & camera fetches
  const effectiveNode1 = ip_node1 || '192.168.10.11';
  const effectiveNode2 = ip_node2 || '192.168.10.12';
  const effectiveNode3 = ip_node3 || '192.168.10.13';

  // ==========================================================================
  // 2. STRICT GLOBAL VARIABLES (Environment Telemetry & MFA Tracker)
  // ==========================================================================
  const [temperature, setTemperature] = useState<number>(22.4);
  const [humidity, setHumidity] = useState<number>(46.2);
  const [smoke_gas_level, setSmokeGasLevel] = useState<number>(118);
  const [light_state, setLightState] = useState<LightState>('ON');
  const [door_state, setDoorState] = useState<DoorState>('CLOSED');
  const [fan_relay, setFanRelay] = useState<FanRelayState>('ON');

  const [isFacePassed, setIsFacePassed] = useState<boolean>(false);
  const [isCardPassed, setIsCardPassed] = useState<boolean>(false);
  const [isPinPassed, setIsPinPassed] = useState<boolean>(false);
  const [mfa_status, setMfaStatus] = useState<MfaStatus>('IDLE');
  const [mfaCountdown, setMfaCountdown] = useState<number>(10);

  // Relay Auto/Manual control modes
  const [fanControlMode, setFanControlMode] = useState<ControlMode>('AUTO');
  const [lightControlMode, setLightControlMode] = useState<ControlMode>('AUTO');
  const [emergencyOverrideActive, setEmergencyOverrideActive] = useState<boolean>(false);

  // ==========================================================================
  // 3. STRICT SQLITE DATABASE TABLES
  // ==========================================================================
  const [access_logs, setAccessLogs] = useState<AccessLogRecord[]>(INITIAL_ACCESS_LOGS);
  const [environmental_telemetry, setEnvironmentalTelemetry] = useState<EnvironmentalTelemetryRecord[]>(
    INITIAL_ENVIRONMENTAL_TELEMETRY
  );
  const [camera_events, setCameraEvents] = useState<CameraEventRecord[]>(INITIAL_CAMERA_EVENTS);
  const [system_errors, setSystemErrors] = useState<SystemErrorRecord[]>(INITIAL_SYSTEM_ERRORS);

  // ==========================================================================
  // 4. UI NAVIGATION, CHARTS (30-PT FIFO), CAMERA JPEG & DIAGNOSTICS STATE
  // ==========================================================================
  const [activeView, setActiveView] = useState<ViewId>('view1');
  const [activityFeed, setActivityFeed] = useState<ActivityFeedItem[]>(INITIAL_ACTIVITY_FEED);
  const [fifoHistory, setFifoHistory] = useState(() => generateInitialHistoryWindow(30));
  const [cameraMode, setCameraMode] = useState<'STANDBY' | 'MOTION' | 'FACE_VERIFIED' | 'UNAUTHORIZED'>('FACE_VERIFIED');
  const [cameraFrameUrl, setCameraFrameUrl] = useState<string>('');
  const [cameraLastTimestamp, setCameraLastTimestamp] = useState<string>('2026-10-19 05:08:10');
  const [liveSimEnabled, setLiveSimEnabled] = useState<boolean>(true);
  const [wsConnectionState, setWsConnectionState] = useState<'LOCAL_AIRGAP_SIM' | 'CONNECTED_LAN'>('LOCAL_AIRGAP_SIM');
  const [showVanillaModal, setShowVanillaModal] = useState<boolean>(false);
  const [showSimDrawer, setShowSimDrawer] = useState<boolean>(false);

  // View 4 Audit Log Explorer State
  const [activeAuditTab, setActiveAuditTab] = useState<AuditTableTab>('access_logs');
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');
  const [auditPage, setAuditPage] = useState<number>(1);
  const ROWS_PER_PAGE = 5;

  // View 5 Network Heartbeat Monitor (5-second WebSocket ping cycle)
  const [heartbeats, setHeartbeats] = useState<NodeHeartbeatStatus[]>([
    {
      id: 'central',
      name: 'Central Node-RED Server',
      role: 'WebSocket Broker & SQLite Engine',
      ip: CENTRAL_NODE_RED_HOST,
      online: true,
      latencyMs: 2.1,
      lastPing: formatNowTime(),
      packetLoss: 0,
    },
    {
      id: 'node1',
      name: 'Node 1 · Access & Lock Controller',
      role: 'RFID Reader, Keypad, Reed & Solenoid',
      ip: effectiveNode1,
      online: true,
      latencyMs: 4.8,
      lastPing: formatNowTime(),
      packetLoss: 0,
    },
    {
      id: 'node2',
      name: 'Node 2 · Environmental Telemetry',
      role: 'DHT22, MQ-2 Smoke/Gas, LDR & HVAC Relays',
      ip: effectiveNode2,
      online: true,
      latencyMs: 5.3,
      lastPing: formatNowTime(),
      packetLoss: 0,
    },
    {
      id: 'node3',
      name: 'Node 3 · Biometric Vision Unit',
      role: 'Optical Camera Stream & Face Embedding Node',
      ip: effectiveNode3,
      online: true,
      latencyMs: 8.4,
      lastPing: formatNowTime(),
      packetLoss: 0,
    },
  ]);

  // View 6 User Provisioning & Node Management Forms
  const [provisionedUsers, setProvisionedUsers] = useState<ProvisionedUser[]>(INITIAL_PROVISIONED_USERS);
  const [newUsername, setNewUsername] = useState<string>('');
  const [newDepartment, setNewDepartment] = useState<string>('Facility Engineering');
  const [newRfidUid, setNewRfidUid] = useState<string>('04:E9:2C:71');
  const [newFaceTemplate, setNewFaceTemplate] = useState<string>('BIO_VEC_7741');
  const [newPinCode, setNewPinCode] = useState<string>('4829');
  const [userFormNotice, setUserFormNotice] = useState<string>('');
  const [nodeFormNotice, setNodeFormNotice] = useState<string>('');

  // Helper to push an event into the 5-item rolling Live Activity Feed
  const pushActivity = useCallback(
    (category: ActivityFeedItem['category'], message: string, status: ActivityFeedItem['status'] = 'NOMINAL') => {
      setActivityFeed((prev) => [
        {
          id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: formatNowTime(),
          category,
          message,
          status,
        },
        ...prev.slice(0, 4),
      ]);
    },
    []
  );

  // Sync strict global variables onto `window` for Node-RED / browser console inspection
  useEffect(() => {
    window.temperature = temperature;
    window.humidity = humidity;
    window.smoke_gas_level = smoke_gas_level;
    window.light_state = light_state;
    window.door_state = door_state;
    window.fan_relay = fan_relay;
    window.isFacePassed = isFacePassed;
    window.isCardPassed = isCardPassed;
    window.isPinPassed = isPinPassed;
    window.mfa_status = mfa_status;
    window.access_logs = access_logs;
    window.environmental_telemetry = environmental_telemetry;
    window.camera_events = camera_events;
    window.system_errors = system_errors;
    window.ip_node1 = effectiveNode1;
    window.ip_node2 = effectiveNode2;
    window.ip_node3 = effectiveNode3;
  }, [
    temperature,
    humidity,
    smoke_gas_level,
    light_state,
    door_state,
    fan_relay,
    isFacePassed,
    isCardPassed,
    isPinPassed,
    mfa_status,
    access_logs,
    environmental_telemetry,
    camera_events,
    system_errors,
    effectiveNode1,
    effectiveNode2,
    effectiveNode3,
  ]);

  // Render Biometric Camera JPEG whenever camera state, door_state, or ip_node3 changes
  useEffect(() => {
    const dataUri = generateBiometricCameraJpeg({
      ipNode3: effectiveNode3,
      mode: cameraMode,
      subjectName: 'ENG_SARHAN',
      confidence: 99.4,
      timestamp: cameraLastTimestamp,
      doorState: door_state,
    });
    setCameraFrameUrl(dataUri);
  }, [effectiveNode3, cameraMode, cameraLastTimestamp, door_state]);

  // ==========================================================================
  // 5. WEBSOCKET CONNECTION & REST API LOG FETCHING
  // ==========================================================================
  const fetchHistoricalLogsFromNodeRed = useCallback(async () => {
    const endpoints: { key: AuditTableTab | 'system_errors'; url: string }[] = [
      { key: 'access_logs', url: `http://${CENTRAL_NODE_RED_HOST}/api/logs/access_logs` },
      { key: 'environmental_telemetry', url: `http://${CENTRAL_NODE_RED_HOST}/api/logs/environmental_telemetry` },
      { key: 'camera_events', url: `http://${CENTRAL_NODE_RED_HOST}/api/logs/camera_events` },
      { key: 'system_errors', url: `http://${CENTRAL_NODE_RED_HOST}/api/logs/system_errors` },
    ];

    for (const ep of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(ep.url, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            if (ep.key === 'access_logs') setAccessLogs(data);
            if (ep.key === 'environmental_telemetry') setEnvironmentalTelemetry(data);
            if (ep.key === 'camera_events') setCameraEvents(data);
            if (ep.key === 'system_errors') setSystemErrors(data);
          }
        }
      } catch {
        // Air-gapped local SQLite state remains active when 192.168.10.2 is unreachable
      }
    }
  }, []);

  useEffect(() => {
    fetchHistoricalLogsFromNodeRed();

    let wsTelemetry: WebSocket | null = null;
    let wsMfa: WebSocket | null = null;

    // Attempt native WebSockets if running on HTTP LAN
    if (window.location.protocol === 'http:') {
      try {
        wsTelemetry = new WebSocket(`ws://${CENTRAL_NODE_RED_HOST}/ws/telemetry`);
        wsTelemetry.onopen = () => setWsConnectionState('CONNECTED_LAN');
        wsTelemetry.onmessage = (evt) => {
          try {
            const payload = JSON.parse(evt.data);
            if (typeof payload.temperature === 'number') setTemperature(payload.temperature);
            if (typeof payload.humidity === 'number') setHumidity(payload.humidity);
            if (typeof payload.smoke_gas_level === 'number') setSmokeGasLevel(payload.smoke_gas_level);
            if (payload.light_state === 'ON' || payload.light_state === 'OFF') setLightState(payload.light_state);
            if (payload.door_state === 'OPEN' || payload.door_state === 'CLOSED') setDoorState(payload.door_state);
            if (payload.fan_relay === 'ON' || payload.fan_relay === 'OFF') setFanRelay(payload.fan_relay);
          } catch {
            // Ignore malformed frame
          }
        };
        wsTelemetry.onerror = () => setWsConnectionState('LOCAL_AIRGAP_SIM');
      } catch {
        setWsConnectionState('LOCAL_AIRGAP_SIM');
      }

      try {
        wsMfa = new WebSocket(`ws://${CENTRAL_NODE_RED_HOST}/ws/mfa`);
        wsMfa.onmessage = (evt) => {
          try {
            const payload = JSON.parse(evt.data);
            if (typeof payload.isFacePassed === 'boolean') setIsFacePassed(payload.isFacePassed);
            if (typeof payload.isCardPassed === 'boolean') setIsCardPassed(payload.isCardPassed);
            if (typeof payload.isPinPassed === 'boolean') setIsPinPassed(payload.isPinPassed);
            if (payload.mfa_status) setMfaStatus(payload.mfa_status);
          } catch {
            // Ignore malformed frame
          }
        };
      } catch {
        // Fallback handled by simulator
      }
    }

    return () => {
      if (wsTelemetry) wsTelemetry.close();
      if (wsMfa) wsMfa.close();
    };
  }, [fetchHistoricalLogsFromNodeRed]);

  // ==========================================================================
  // 6. 2-OUT-OF-3 MFA LIVE TRACKER & 10-SECOND COUNTDOWN LOGIC
  // ==========================================================================
  const mfaTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const passedFactors: string[] = [];
    if (isFacePassed) passedFactors.push('FACE');
    if (isCardPassed) passedFactors.push('RFID_CARD');
    if (isPinPassed) passedFactors.push('PIN');

    if (passedFactors.length === 0) {
      setMfaStatus('IDLE');
      setMfaCountdown(10);
      if (mfaTimerRef.current) {
        window.clearInterval(mfaTimerRef.current);
        mfaTimerRef.current = null;
      }
    } else if (passedFactors.length === 1) {
      setMfaStatus('AWAITING_STAGE2');
      setMfaCountdown(10);
      if (mfaTimerRef.current) window.clearInterval(mfaTimerRef.current);

      mfaTimerRef.current = window.setInterval(() => {
        setMfaCountdown((prev) => {
          if (prev <= 1) {
            if (mfaTimerRef.current) {
              window.clearInterval(mfaTimerRef.current);
              mfaTimerRef.current = null;
            }
            // Reset checkpoints on 10-second Stage 2 expiration
            setIsFacePassed(false);
            setIsCardPassed(false);
            setIsPinPassed(false);
            setMfaStatus('IDLE');
            pushActivity(
              'ACCESS',
              `Stage 2 MFA 10s countdown expired after ${passedFactors[0]} — Solenoid remained LOCKED`,
              'WARNING'
            );
            setAccessLogs((logs) => [
              {
                id: (logs[0]?.id || 1048) + 1,
                timestamp: formatNowTimestamp(),
                user_name: 'Unverified Stage 2',
                card_uid: '04:A2:9F:3B',
                factors_used: `${passedFactors[0]} ONLY (TIMEOUT)`,
                mfa_status: 'DENIED_TIMEOUT',
                door_state: 'CLOSED',
                node_ip: effectiveNode1,
              },
              ...logs,
            ]);
            return 10;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (passedFactors.length >= 2) {
      // 2-out-of-3 MFA satisfied!
      if (mfaTimerRef.current) {
        window.clearInterval(mfaTimerRef.current);
        mfaTimerRef.current = null;
      }
      setMfaStatus('UNLOCKED');
      setDoorState('OPEN');
      const factorString = passedFactors.join(' + ');
      pushActivity(
        'ACCESS',
        `2-of-3 MFA Passed (${factorString}) — Solenoid Lock UNLOCKED & Door OPEN`,
        'NOMINAL'
      );
      setAccessLogs((logs) => [
        {
          id: (logs[0]?.id || 1048) + 1,
          timestamp: formatNowTimestamp(),
          user_name: 'Eng. A. Sarhan',
          card_uid: '04:A2:9F:3B',
          factors_used: factorString,
          mfa_status: 'UNLOCKED',
          door_state: 'OPEN',
          node_ip: effectiveNode1,
        },
        ...logs,
      ]);
    }

    return () => {
      if (mfaTimerRef.current && passedFactors.length !== 1) {
        window.clearInterval(mfaTimerRef.current);
        mfaTimerRef.current = null;
      }
    };
  }, [isFacePassed, isCardPassed, isPinPassed, effectiveNode1, pushActivity]);

  // ==========================================================================
  // 7. PERIODIC TELEMETRY FIFO STREAM & 5-SECOND HEARTBEAT PING
  // ==========================================================================
  useEffect(() => {
    if (!liveSimEnabled) return;

    const telemetryInterval = window.setInterval(() => {
      const ts = formatNowTime();
      setTemperature((prevTemp) => {
        const delta = (Math.random() - 0.48) * 0.4;
        const nextTemp = Number(Math.min(48, Math.max(16, prevTemp + delta)).toFixed(1));

        setHumidity((prevHum) => {
          const humDelta = (Math.random() - 0.5) * 0.7;
          const nextHum = Number(Math.min(95, Math.max(25, prevHum + humDelta)).toFixed(1));

          setSmokeGasLevel((prevGas) => {
            // Keep smoke elevated if user triggered emergency smoke test, else gentle drift
            const nextGas =
              prevGas >= SMOKE_DANGER_THRESHOLD
                ? prevGas
                : Math.max(95, Math.min(320, Math.round(prevGas + (Math.random() - 0.5) * 6)));

            // Push into 30-point FIFO sliding window queue
            setFifoHistory((prevWin) => ({
              labels: [...prevWin.labels.slice(-29), ts],
              temps: [...prevWin.temps.slice(-29), nextTemp],
              hums: [...prevWin.hums.slice(-29), nextHum],
              gases: [...prevWin.gases.slice(-29), nextGas],
            }));

            return nextGas;
          });

          return nextHum;
        });

        return nextTemp;
      });
    }, 3500);

    // 5-second WebSocket heartbeat monitor update
    const heartbeatInterval = window.setInterval(() => {
      const pingTs = formatNowTime();
      setHeartbeats((prev) =>
        prev.map((node) => {
          const updatedIp =
            node.id === 'node1'
              ? effectiveNode1
              : node.id === 'node2'
              ? effectiveNode2
              : node.id === 'node3'
              ? effectiveNode3
              : CENTRAL_NODE_RED_HOST;
          return {
            ...node,
            ip: updatedIp,
            lastPing: pingTs,
            latencyMs: Number((node.latencyMs * 0.7 + (2 + Math.random() * 6) * 0.3).toFixed(1)),
          };
        })
      );
    }, 5000);

    return () => {
      window.clearInterval(telemetryInterval);
      window.clearInterval(heartbeatInterval);
    };
  }, [liveSimEnabled, effectiveNode1, effectiveNode2, effectiveNode3]);

  // ==========================================================================
  // 8. DIRECT SERVER COMMAND HANDLERS (HTTP POST to Node-RED)
  // ==========================================================================
  const sendNodeRedCommand = async (command: string, payload: Record<string, unknown>) => {
    try {
      await fetch(`http://${CENTRAL_NODE_RED_HOST}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, ...payload, timestamp: formatNowTimestamp() }),
      });
    } catch {
      // Local air-gapped bus execution completed
    }
  };

  const handleEmergencyDoorUnlock = () => {
    setEmergencyOverrideActive(true);
    setMfaStatus('UNLOCKED');
    setDoorState('OPEN');
    sendNodeRedCommand('EMERGENCY_DOOR_UNLOCK', { target_ip: effectiveNode1, door_state: 'OPEN' });
    pushActivity(
      'ACCESS',
      `Command Center dispatched EMERGENCY DOOR UNLOCK to Node 1 (${effectiveNode1})`,
      'ALERT'
    );
    setAccessLogs((prev) => [
      {
        id: (prev[0]?.id || 1048) + 1,
        timestamp: formatNowTimestamp(),
        user_name: 'Executive Command Center',
        card_uid: 'HTTP_POST_CMD',
        factors_used: 'EMERGENCY_UNLOCK_BUTTON',
        mfa_status: 'EMERGENCY_OVERRIDE',
        door_state: 'OPEN',
        node_ip: effectiveNode1,
      },
      ...prev,
    ]);
  };

  const handleToggleHvacFan = () => {
    const nextState: FanRelayState = fan_relay === 'ON' ? 'OFF' : 'ON';
    setFanRelay(nextState);
    sendNodeRedCommand('TOGGLE_HVAC_FAN', { target_ip: effectiveNode2, fan_relay: nextState });
    pushActivity(
      'ENVIRONMENT',
      `HVAC Fan Relay switched ${nextState} on Node 2 (${effectiveNode2})`,
      'NOMINAL'
    );
  };

  const handleToggleAuxLight = () => {
    const nextState: LightState = light_state === 'ON' ? 'OFF' : 'ON';
    setLightState(nextState);
    sendNodeRedCommand('TOGGLE_AUX_LIGHT', { target_ip: effectiveNode2, light_state: nextState });
    pushActivity(
      'ENVIRONMENT',
      `Auxiliary Corridor Lighting switched ${nextState} on Node 2 (${effectiveNode2})`,
      'NOMINAL'
    );
  };

  const handleSaveDynamicIps = (e: React.FormEvent) => {
    e.preventDefault();
    const clean1 = modalIp1.trim() || '192.168.10.11';
    const clean2 = modalIp2.trim() || '192.168.10.12';
    const clean3 = modalIp3.trim() || '192.168.10.13';

    localStorage.setItem('ip_node1', clean1);
    localStorage.setItem('ip_node2', clean2);
    localStorage.setItem('ip_node3', clean3);

    setIpNode1(clean1);
    setIpNode2(clean2);
    setIpNode3(clean3);
    setIsNodesConfigured(true);
    setShowStartupModal(false);

    sendNodeRedCommand('UPDATE_NODE_IPS', {
      ip_node1: clean1,
      ip_node2: clean2,
      ip_node3: clean3,
    });

    pushActivity(
      'SYSTEM',
      `Saved Node IPs to localStorage (Node1: ${clean1}, Node2: ${clean2}, Node3: ${clean3})`,
      'NOMINAL'
    );
    setNodeFormNotice(`Saved to localStorage & notified Node-RED (${formatNowTime()})`);
    setTimeout(() => setNodeFormNotice(''), 4000);
  };

  const handleTriggerCameraCapture = (mode: 'STANDBY' | 'MOTION' | 'FACE_VERIFIED' | 'UNAUTHORIZED') => {
    const ts = formatNowTimestamp();
    setCameraMode(mode);
    setCameraLastTimestamp(ts);

    if (mode === 'FACE_VERIFIED') {
      setIsFacePassed(true);
    }

    setCameraEvents((prev) => [
      {
        id: (prev[0]?.id || 309) + 1,
        timestamp: ts,
        event_type:
          mode === 'FACE_VERIFIED'
            ? 'FACE_MATCH'
            : mode === 'UNAUTHORIZED'
            ? 'UNKNOWN_FACE'
            : mode === 'MOTION'
            ? 'MOTION_DETECTED'
            : 'MANUAL_SNAPSHOT',
        subject_name:
          mode === 'FACE_VERIFIED'
            ? 'Eng. A. Sarhan'
            : mode === 'UNAUTHORIZED'
            ? 'Unregistered Subject'
            : 'Corridor Vestibule',
        confidence: mode === 'FACE_VERIFIED' ? 99.4 : mode === 'UNAUTHORIZED' ? 38.2 : 92.0,
        frame_ref: `/captures/cam03_${Date.now()}.jpg`,
        node_ip: effectiveNode3,
      },
      ...prev,
    ]);

    pushActivity(
      'CAMERA',
      `Node 3 (${effectiveNode3}) captured JPEG frame [${mode}]`,
      mode === 'UNAUTHORIZED' ? 'ALERT' : 'NOMINAL'
    );
  };

  const handleProvisionUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;

    const createdUser: ProvisionedUser = {
      id: `USR-00${provisionedUsers.length + 1}`,
      username: newUsername.trim(),
      department: newDepartment.trim(),
      rfid_uid: newRfidUid.trim().toUpperCase(),
      face_template_id: newFaceTemplate.trim().toUpperCase(),
      pin_configured: Boolean(newPinCode.trim()),
      created_at: formatNowTimestamp().split(' ')[0],
    };

    try {
      await fetch(`http://${CENTRAL_NODE_RED_HOST}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...createdUser,
          pin_hash: newPinCode,
          target_access_node: effectiveNode1,
          target_face_node: effectiveNode3,
        }),
      });
    } catch {
      // Stored locally in air-gapped registry
    }

    setProvisionedUsers((prev) => [createdUser, ...prev]);
    pushActivity(
      'SYSTEM',
      `Provisioned new user "${createdUser.username}" (RFID: ${createdUser.rfid_uid}, Face ID: ${createdUser.face_template_id})`,
      'NOMINAL'
    );
    setNewUsername('');
    setUserFormNotice(`User "${createdUser.username}" provisioned via HTTP POST to Node-RED.`);
    setTimeout(() => setUserFormNotice(''), 4000);
  };

  const isEmergencyAlert =
    smoke_gas_level >= SMOKE_DANGER_THRESHOLD ||
    emergencyOverrideActive ||
    system_errors.some((err) => !err.resolved && err.severity === 'CRITICAL');

  const passedMfaCount = [isFacePassed, isCardPassed, isPinPassed].filter(Boolean).length;

  // Filtered & Paginated SQLite rows for View 4
  const getFilteredAuditRows = () => {
    const q = auditSearchQuery.trim().toLowerCase();
    if (activeAuditTab === 'access_logs') {
      return access_logs.filter(
        (r) =>
          !q ||
          r.user_name.toLowerCase().includes(q) ||
          r.card_uid.toLowerCase().includes(q) ||
          r.factors_used.toLowerCase().includes(q) ||
          r.mfa_status.toLowerCase().includes(q)
      );
    }
    if (activeAuditTab === 'camera_events') {
      return camera_events.filter(
        (r) =>
          !q ||
          r.subject_name.toLowerCase().includes(q) ||
          r.event_type.toLowerCase().includes(q) ||
          r.frame_ref.toLowerCase().includes(q)
      );
    }
    return environmental_telemetry.filter(
      (r) =>
        !q ||
        r.timestamp.toLowerCase().includes(q) ||
        r.light_state.toLowerCase().includes(q) ||
        r.fan_relay.toLowerCase().includes(q) ||
        String(r.temperature).includes(q)
    );
  };

  const filteredAuditRows = getFilteredAuditRows();
  const totalAuditPages = Math.max(1, Math.ceil(filteredAuditRows.length / ROWS_PER_PAGE));
  const currentAuditPage = Math.min(auditPage, totalAuditPages);
  const paginatedAuditRows = filteredAuditRows.slice(
    (currentAuditPage - 1) * ROWS_PER_PAGE,
    currentAuditPage * ROWS_PER_PAGE
  );

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col">
      {/* ====================================================================
          TOP BAR CONTRACT: 3 Zones separated by gap-8
          Zone 1: Single text element wordmark
          Zone 2: 5 concise single-line text nav links
          Zone 3: 1 primary CTA button
          ==================================================================== */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-slate-950/90 border-b border-slate-800/90 backdrop-blur-md">
        <a
          href="#command-center"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('view1');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          LCI-SFM Facility Control
        </a>

        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
          <a
            href="#view1"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('view1');
            }}
            className={`hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'view1' ? 'text-cyan-400 underline' : ''
            }`}
          >
            Command Center
          </a>
          <a
            href="#view2"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('view2');
            }}
            className={`hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'view2' ? 'text-cyan-400 underline' : ''
            }`}
          >
            Smart Access
          </a>
          <a
            href="#view3"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('view3');
            }}
            className={`hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'view3' ? 'text-cyan-400 underline' : ''
            }`}
          >
            Environment
          </a>
          <a
            href="#view4"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('view4');
            }}
            className={`hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'view4' ? 'text-cyan-400 underline' : ''
            }`}
          >
            Audit Explorer
          </a>
          <a
            href="#view5"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('view5');
            }}
            className={`hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'view5' ? 'text-cyan-400 underline' : ''
            }`}
          >
            System Health
          </a>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowVanillaModal(true)}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 rounded-lg hover:bg-cyan-300 transition-colors whitespace-nowrap shrink-0"
          >
            Vanilla ES6 Code
          </button>
        </div>
      </header>

      {/* ====================================================================
          MAIN WORKSPACE SHELL: Fixed Sidebar (260px) + 6-Section Viewport
          ==================================================================== */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar Navigation */}
        <aside className="w-64 shrink-0 bg-slate-950/80 border-r border-slate-800/90 flex flex-col justify-between p-4 select-none">
          <div className="space-y-6">
            <div>
              <div className="px-3 pb-2 text-xs font-medium text-slate-400">
                Facility Subsystems (6 Views)
              </div>
              <div className="space-y-1">
                {[
                  { id: 'view1' as ViewId, label: '01. Command Center', icon: Activity },
                  { id: 'view2' as ViewId, label: '02. Smart Access & MFA', icon: Fingerprint },
                  { id: 'view3' as ViewId, label: '03. Environment & HVAC', icon: Thermometer },
                  { id: 'view4' as ViewId, label: '04. Audit & DB Explorer', icon: Database },
                  { id: 'view5' as ViewId, label: '05. Health & Diagnostics', icon: Server },
                  { id: 'view6' as ViewId, label: '06. System Management', icon: Settings },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveView(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/35'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/80 border border-transparent'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Node IP Summary Box (localStorage state) */}
            <div className="p-3.5 rounded-xl bg-slate-900/75 border border-slate-800/90 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">Active Node Registry</span>
                <button
                  onClick={() => setShowStartupModal(true)}
                  className="text-cyan-400 hover:underline text-[11px] whitespace-nowrap shrink-0"
                >
                  Edit IPs
                </button>
              </div>
              <div className="space-y-1.5 text-xs font-mono tabular-nums text-slate-400">
                <div className="flex justify-between">
                  <span>ip_node1 (Access)</span>
                  <span className="text-slate-200">{effectiveNode1}</span>
                </div>
                <div className="flex justify-between">
                  <span>ip_node2 (Environ)</span>
                  <span className="text-slate-200">{effectiveNode2}</span>
                </div>
                <div className="flex justify-between">
                  <span>ip_node3 (Biometric)</span>
                  <span className="text-slate-200">{effectiveNode3}</span>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Bus Mode</span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {wsConnectionState === 'CONNECTED_LAN' ? 'WS LIVE LAN' : 'AIR-GAP SIM'}
                </span>
              </div>
            </div>
          </div>

          {/* Hardware Testbench Toggle in Sidebar Footer */}
          <div className="pt-4 border-t border-slate-800/80 space-y-2">
            <button
              onClick={() => setShowSimDrawer((prev) => !prev)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0"
            >
              <Sliders className="w-3.5 h-3.5" />
              {showSimDrawer ? 'Hide Telemetry Testbench' : 'Open Telemetry Testbench'}
            </button>
            <div className="text-[11px] text-slate-400 text-center font-mono tabular-nums">
              ws://192.168.10.2:1880/ws/*
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 p-6 lg:p-8 space-y-6 max-w-[1440px]">
          {/* ================================================================
              DYNAMIC IP INITIAL SETUP PROMPT (If localStorage not yet saved)
              ================================================================ */}
          {!isNodesConfigured && (
            <div className="bg-slate-900/90 border border-cyan-500/40 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-cyan-300">
                  Initial Air-Gapped Node IP Setup Required (localStorage Check)
                </h2>
                <p className="text-xs text-slate-300">
                  Node IPs (<code className="font-mono text-cyan-300">ip_node1</code>,{' '}
                  <code className="font-mono text-cyan-300">ip_node2</code>,{' '}
                  <code className="font-mono text-cyan-300">ip_node3</code>) were not found in{' '}
                  <code className="font-mono text-slate-200">localStorage</code>. Confirm the default
                  subnet addresses or open the Startup Configuration Modal.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setShowStartupModal(true)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                >
                  Open Startup IP Modal
                </button>
                <button
                  onClick={handleSaveDynamicIps}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0"
                >
                  Save Default Subnet IPs
                </button>
              </div>
            </div>
          )}

          {/* ================================================================
              INTERACTIVE TELEMETRY & WEBSOCKET PAYLOAD TESTBENCH (Collapsible)
              ================================================================ */}
          {showSimDrawer && (
            <div className="bg-slate-900/90 border border-cyan-500/35 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-cyan-300">
                    Node-RED WebSocket Payload Injector &amp; Hardware Testbench
                  </h2>
                  <p className="text-xs text-slate-400">
                    Simulate live JSON frames on <code className="font-mono">ws://192.168.10.2:1880/ws/telemetry</code> and{' '}
                    <code className="font-mono">ws://192.168.10.2:1880/ws/mfa</code>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setLiveSimEnabled((v) => !v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                      liveSimEnabled
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    Auto Telemetry Stream: {liveSimEnabled ? 'ON' : 'PAUSED'}
                  </button>
                  <button
                    onClick={() => {
                      setSmokeGasLevel((prev) => (prev >= SMOKE_DANGER_THRESHOLD ? 118 : 540));
                      pushActivity(
                        'ENVIRONMENT',
                        smoke_gas_level >= SMOKE_DANGER_THRESHOLD
                          ? 'Smoke/Gas sensor cleared to nominal (118 PPM)'
                          : 'CRITICAL: MQ-2 Smoke/Gas spike detected (540 PPM)',
                        smoke_gas_level >= SMOKE_DANGER_THRESHOLD ? 'NOMINAL' : 'ALERT'
                      );
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25 transition-colors whitespace-nowrap shrink-0"
                  >
                    {smoke_gas_level >= SMOKE_DANGER_THRESHOLD
                      ? 'Clear Smoke Alarm (118 PPM)'
                      : 'Simulate Smoke Danger (540 PPM)'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-400 flex justify-between font-mono tabular-nums">
                    <span>temperature</span>
                    <span className="text-cyan-300">{temperature.toFixed(1)}°C</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="0.5"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-slate-400 flex justify-between font-mono tabular-nums">
                    <span>humidity</span>
                    <span className="text-cyan-300">{humidity.toFixed(1)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={humidity}
                    onChange={(e) => setHumidity(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-slate-400 flex justify-between font-mono tabular-nums">
                    <span>smoke_gas_level</span>
                    <span className={smoke_gas_level >= SMOKE_DANGER_THRESHOLD ? 'text-rose-400' : 'text-emerald-400'}>
                      {smoke_gas_level} PPM
                    </span>
                  </label>
                  <input
                    type="range"
                    min="50"
                    max="900"
                    step="10"
                    value={smoke_gas_level}
                    onChange={(e) => setSmokeGasLevel(parseInt(e.target.value, 10))}
                    className="w-full accent-rose-500"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button
                    onClick={() => setIsFacePassed((v) => !v)}
                    className={`flex-1 py-2 px-2.5 rounded-lg border font-mono text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                      isFacePassed
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                  >
                    Face: {String(isFacePassed)}
                  </button>
                  <button
                    onClick={() => setIsCardPassed((v) => !v)}
                    className={`flex-1 py-2 px-2.5 rounded-lg border font-mono text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                      isCardPassed
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                  >
                    Card: {String(isCardPassed)}
                  </button>
                  <button
                    onClick={() => setIsPinPassed((v) => !v)}
                    className={`flex-1 py-2 px-2.5 rounded-lg border font-mono text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                      isPinPassed
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                  >
                    PIN: {String(isPinPassed)}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              VIEW 1: MAIN COMMAND CENTER (EXECUTIVE OVERVIEW)
              ================================================================ */}
          {activeView === 'view1' && (
            <section className="space-y-6" aria-label="Main Command Center">
              {/* Global Status Banner: Normal (Green) or Emergency (Red) */}
              <div
                className={`rounded-xl p-5 border backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                  isEmergencyAlert
                    ? 'bg-rose-950/40 border-rose-500/60 text-rose-200'
                    : 'bg-emerald-950/30 border-emerald-500/45 text-emerald-200'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  {isEmergencyAlert ? (
                    <ShieldAlert className="w-7 h-7 text-rose-400 shrink-0" />
                  ) : (
                    <ShieldCheck className="w-7 h-7 text-emerald-400 shrink-0" />
                  )}
                  <div>
                    <h1 className="text-lg font-bold tracking-tight text-slate-100">
                      {isEmergencyAlert
                        ? 'GLOBAL FACILITY STATUS: EMERGENCY ALERT ACTIVE'
                        : 'GLOBAL FACILITY STATUS: NORMAL OPERATION'}
                    </h1>
                    <p className="text-xs text-slate-300 font-mono tabular-nums mt-0.5">
                      Node-RED Central Bus: {CENTRAL_NODE_RED_HOST} · Smoke/Gas: {smoke_gas_level} PPM · MFA State:{' '}
                      {mfa_status}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {isEmergencyAlert && (
                    <button
                      onClick={() => {
                        setEmergencyOverrideActive(false);
                        setSmokeGasLevel(118);
                        setDoorState('CLOSED');
                        setMfaStatus('IDLE');
                        setIsFacePassed(false);
                        setIsCardPassed(false);
                        setIsPinPassed(false);
                        pushActivity('SYSTEM', 'Emergency state reset to NORMAL by operator', 'NOMINAL');
                      }}
                      className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0"
                    >
                      Acknowledge &amp; Reset Normal
                    </button>
                  )}
                  <span className="text-xs font-mono tabular-nums text-slate-300">
                    Nodes Online: 4/4
                  </span>
                </div>
              </div>

              {/* Quick Telemetry Snapshot: 5 Mini-Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* 1. door_state */}
                <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-4 backdrop-blur-md flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Door Reed State</span>
                    {door_state === 'OPEN' ? (
                      <DoorOpen className="w-4 h-4 text-rose-400" />
                    ) : (
                      <DoorClosed className="w-4 h-4 text-emerald-400" />
                    )}
                  </div>
                  <div className="my-3">
                    <div
                      className={`text-2xl font-bold font-mono tabular-nums ${
                        door_state === 'OPEN' ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {door_state}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1">
                      var: door_state · {effectiveNode1}
                    </div>
                  </div>
                </div>

                {/* 2. light_state (LDR Sensor) */}
                <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-4 backdrop-blur-md flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Aux Light (LDR)</span>
                    <Lightbulb
                      className={`w-4 h-4 ${light_state === 'ON' ? 'text-emerald-400' : 'text-rose-400'}`}
                    />
                  </div>
                  <div className="my-3">
                    <div
                      className={`text-2xl font-bold font-mono tabular-nums ${
                        light_state === 'ON' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {light_state}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1">
                      var: light_state · Mode: {lightControlMode}
                    </div>
                  </div>
                </div>

                {/* 3. fan_relay */}
                <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-4 backdrop-blur-md flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>HVAC Fan Relay</span>
                    <Fan className={`w-4 h-4 ${fan_relay === 'ON' ? 'text-emerald-400' : 'text-rose-400'}`} />
                  </div>
                  <div className="my-3">
                    <div
                      className={`text-2xl font-bold font-mono tabular-nums ${
                        fan_relay === 'ON' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {fan_relay}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1">
                      var: fan_relay · Mode: {fanControlMode}
                    </div>
                  </div>
                </div>

                {/* 4. temperature */}
                <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-4 backdrop-blur-md flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Temperature</span>
                    <Thermometer className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="my-3">
                    <div className="text-2xl font-bold font-mono tabular-nums text-cyan-400">
                      {temperature.toFixed(1)}°C
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1">
                      var: temperature · {effectiveNode2}
                    </div>
                  </div>
                </div>

                {/* 5. humidity */}
                <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-4 backdrop-blur-md flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Relative Humidity</span>
                    <Droplets className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="my-3">
                    <div className="text-2xl font-bold font-mono tabular-nums text-cyan-400">
                      {humidity.toFixed(1)}%
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1">
                      var: humidity · {effectiveNode2}
                    </div>
                  </div>
                </div>
              </div>

              {/* Split Row: Quick Action Panel (HTTP POST) + Live Activity Feed (Last 5 System Events) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* Quick Action Panel */}
                <div className="lg:col-span-5 bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md flex flex-col justify-between space-y-5">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      Quick Action Panel (Direct HTTP POST Commands)
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Dispatches immediate actuator overrides to <code className="font-mono">http://192.168.10.2:1880/api/command</code>
                    </p>
                  </div>

                  <div className="space-y-3">
                    <button
                      onClick={handleEmergencyDoorUnlock}
                      className="w-full py-3.5 px-4 rounded-xl bg-rose-500/15 border border-rose-500/50 hover:bg-rose-500/25 text-rose-300 font-semibold text-sm flex items-center justify-between transition-colors whitespace-nowrap shrink-0"
                    >
                      <span className="flex items-center gap-2.5">
                        <DoorOpen className="w-4 h-4 text-rose-400" />
                        Emergency Door Unlock
                      </span>
                      <span className="font-mono tabular-nums text-xs text-rose-400">
                        POST → {effectiveNode1}
                      </span>
                    </button>

                    <button
                      onClick={handleToggleHvacFan}
                      className="w-full py-3.5 px-4 rounded-xl bg-cyan-500/15 border border-cyan-500/40 hover:bg-cyan-500/25 text-cyan-300 font-semibold text-sm flex items-center justify-between transition-colors whitespace-nowrap shrink-0"
                    >
                      <span className="flex items-center gap-2.5">
                        <Fan className="w-4 h-4 text-cyan-400" />
                        Toggle HVAC Fan ({fan_relay === 'ON' ? 'Switch OFF' : 'Switch ON'})
                      </span>
                      <span className="font-mono tabular-nums text-xs text-cyan-400">
                        CURRENT: {fan_relay}
                      </span>
                    </button>

                    <button
                      onClick={handleToggleAuxLight}
                      className="w-full py-3.5 px-4 rounded-xl bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-emerald-300 font-semibold text-sm flex items-center justify-between transition-colors whitespace-nowrap shrink-0"
                    >
                      <span className="flex items-center gap-2.5">
                        <Lightbulb className="w-4 h-4 text-emerald-400" />
                        Toggle Aux Light ({light_state === 'ON' ? 'Switch OFF' : 'Switch ON'})
                      </span>
                      <span className="font-mono tabular-nums text-xs text-emerald-400">
                        CURRENT: {light_state}
                      </span>
                    </button>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
                    <span>Lock Solenoid: {mfa_status === 'UNLOCKED' ? 'ENERGIZED (OPEN)' : 'ENGAGED (LOCKED)'}</span>
                    <span>Smoke/Gas: {smoke_gas_level} PPM</span>
                  </div>
                </div>

                {/* Live Activity Feed (Last 5 System Events) */}
                <div className="lg:col-span-7 bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-100">
                        Live Activity Feed (Rolling 5-Event Ticker)
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Real-time stream of access transitions, relay actuations, and camera triggers
                      </p>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-cyan-400">
                      MAX 5 EVENTS
                    </span>
                  </div>

                  <div className="divide-y divide-slate-800/80 flex-1 flex flex-col justify-center">
                    {activityFeed.slice(0, 5).map((item) => (
                      <div
                        key={item.id}
                        className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-4 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="text-slate-100 font-medium">{item.message}</div>
                          <div className="text-slate-400 font-mono tabular-nums">
                            {item.category} · {item.status} · {item.timestamp}
                          </div>
                        </div>
                        <span
                          className={`font-mono tabular-nums font-semibold shrink-0 ${
                            item.status === 'ALERT'
                              ? 'text-rose-400'
                              : item.status === 'WARNING'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ================================================================
              VIEW 2: SMART ACCESS & BIOMETRICS
              ================================================================ */}
          {activeView === 'view2' && (
            <section className="space-y-6" aria-label="Smart Access and Biometrics">
              {/* Top Row: Door & Lock Visualizer + 2-out-of-3 MFA Live Tracker */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* Door & Lock Visualizer */}
                <div className="lg:col-span-5 bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md flex flex-col justify-between space-y-5">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      Door &amp; Lock Hardware Visualizer
                    </h2>
                    <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                      Access Node 1 ({effectiveNode1}) · Reed Switch &amp; 12V Fail-Secure Solenoid
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Magnetic Reed Switch Indicator */}
                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Magnetic Reed</span>
                        {door_state === 'CLOSED' ? (
                          <DoorClosed className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <DoorOpen className="w-4 h-4 text-rose-400" />
                        )}
                      </div>
                      <div
                        className={`text-xl font-bold font-mono tabular-nums ${
                          door_state === 'CLOSED' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {door_state}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                        Contact: {door_state === 'CLOSED' ? 'CLOSED LOOP' : 'OPEN CIRCUIT'}
                      </div>
                    </div>

                    {/* Solenoid Lock Indicator */}
                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Solenoid Lock</span>
                        <KeyRound
                          className={`w-4 h-4 ${
                            mfa_status === 'UNLOCKED' ? 'text-emerald-400' : 'text-cyan-400'
                          }`}
                        />
                      </div>
                      <div
                        className={`text-xl font-bold font-mono tabular-nums ${
                          mfa_status === 'UNLOCKED' ? 'text-emerald-400' : 'text-cyan-400'
                        }`}
                      >
                        {mfa_status === 'UNLOCKED' ? 'UNLOCKED' : 'LOCKED'}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                        Coil: {mfa_status === 'UNLOCKED' ? '12V ENERGIZED' : '0V ENGAGED'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => {
                        const nextDoor: DoorState = door_state === 'CLOSED' ? 'OPEN' : 'CLOSED';
                        setDoorState(nextDoor);
                        pushActivity('ACCESS', `Magnetic Reed Switch state changed to ${nextDoor}`, 'NOMINAL');
                      }}
                      className="flex-1 py-2.5 px-3 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors whitespace-nowrap shrink-0"
                    >
                      Toggle Reed ({door_state === 'CLOSED' ? 'Simulate Open' : 'Close Door'})
                    </button>
                    <button
                      onClick={() => {
                        setIsFacePassed(false);
                        setIsCardPassed(false);
                        setIsPinPassed(false);
                        setMfaStatus('IDLE');
                        setDoorState('CLOSED');
                        setEmergencyOverrideActive(false);
                      }}
                      className="py-2.5 px-3 text-xs font-medium rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-300 hover:bg-cyan-500/25 transition-colors whitespace-nowrap shrink-0"
                    >
                      Re-Lock Airlock
                    </button>
                  </div>
                </div>

                {/* 2-out-of-3 MFA Live Tracker */}
                <div className="lg:col-span-7 bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md flex flex-col justify-between space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-100">
                        2-out-of-3 Multi-Factor Authentication (MFA) Live Tracker
                      </h2>
                      <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                        mfa_status: <strong className="text-cyan-300">{mfa_status}</strong> · Checkpoints Passed:{' '}
                        {passedMfaCount}/3 (Requires ≥ 2 within 10s)
                      </p>
                    </div>

                    {/* 10-Second Stage 2 Countdown Timer UI */}
                    <div
                      className={`px-4 py-2 rounded-lg border font-mono tabular-nums text-xs font-semibold ${
                        mfa_status === 'AWAITING_STAGE2'
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                          : mfa_status === 'UNLOCKED'
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                          : 'bg-slate-950/70 border-slate-800 text-slate-400'
                      }`}
                    >
                      {mfa_status === 'AWAITING_STAGE2'
                        ? `STAGE 2 WINDOW: 00:${String(mfaCountdown).padStart(2, '0')}s`
                        : mfa_status === 'UNLOCKED'
                        ? 'ACCESS GRANTED (UNLOCKED)'
                        : 'TIMER STANDBY (10s WINDOW)'}
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="space-y-2">
                    <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full transition-transform duration-150 origin-left"
                        style={{
                          width: '100%',
                          transform: `scaleX(${Math.min(1, passedMfaCount / 2)})`,
                          backgroundColor:
                            mfa_status === 'UNLOCKED'
                              ? '#00F59B'
                              : mfa_status === 'AWAITING_STAGE2'
                              ? '#00D2FF'
                              : '#334155',
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-400">
                      <span>0 Factors (IDLE)</span>
                      <span>1 Factor (AWAITING_STAGE2 · 10s Timer)</span>
                      <span>≥ 2 Factors (UNLOCKED)</span>
                    </div>
                  </div>

                  {/* 3 Checkpoints: isFacePassed, isCardPassed, isPinPassed */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Checkpoint 1: isFacePassed */}
                    <button
                      onClick={() => {
                        const next = !isFacePassed;
                        setIsFacePassed(next);
                        if (next) handleTriggerCameraCapture('FACE_VERIFIED');
                      }}
                      className={`p-4 rounded-xl border text-left transition-colors ${
                        isFacePassed
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200'
                          : 'bg-slate-950/60 border-slate-800/90 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Fingerprint
                          className={`w-5 h-5 ${isFacePassed ? 'text-emerald-400' : 'text-slate-400'}`}
                        />
                        <span className="font-mono tabular-nums text-xs font-semibold">
                          {isFacePassed ? 'PASSED' : 'PENDING'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-100">Biometric Face ID</div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                        isFacePassed: {String(isFacePassed)}
                      </div>
                    </button>

                    {/* Checkpoint 2: isCardPassed */}
                    <button
                      onClick={() => setIsCardPassed((v) => !v)}
                      className={`p-4 rounded-xl border text-left transition-colors ${
                        isCardPassed
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200'
                          : 'bg-slate-950/60 border-slate-800/90 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <CreditCard
                          className={`w-5 h-5 ${isCardPassed ? 'text-emerald-400' : 'text-slate-400'}`}
                        />
                        <span className="font-mono tabular-nums text-xs font-semibold">
                          {isCardPassed ? 'PASSED' : 'PENDING'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-100">MIFARE RFID Card</div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                        isCardPassed: {String(isCardPassed)}
                      </div>
                    </button>

                    {/* Checkpoint 3: isPinPassed */}
                    <button
                      onClick={() => setIsPinPassed((v) => !v)}
                      className={`p-4 rounded-xl border text-left transition-colors ${
                        isPinPassed
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200'
                          : 'bg-slate-950/60 border-slate-800/90 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <KeyRound
                          className={`w-5 h-5 ${isPinPassed ? 'text-emerald-400' : 'text-slate-400'}`}
                        />
                        <span className="font-mono tabular-nums text-xs font-semibold">
                          {isPinPassed ? 'PASSED' : 'PENDING'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-100">Matrix Keypad PIN</div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                        isPinPassed: {String(isPinPassed)}
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              {/* Biometric Camera Feed Box (<img> displaying latest JPEG frame from ip_node3) */}
              <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <Camera className="w-5 h-5 text-cyan-400" />
                    <div>
                      <h2 className="text-base font-semibold text-slate-100">
                        Biometric Camera Feed (Node 3 Optical Capture)
                      </h2>
                      <p className="text-xs text-slate-400 font-mono tabular-nums">
                        Source Endpoint: http://{effectiveNode3}/capture · Triggered on PIR Motion / Face Verification
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTriggerCameraCapture('MOTION')}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors whitespace-nowrap shrink-0"
                    >
                      Simulate Motion Frame
                    </button>
                    <button
                      onClick={() => handleTriggerCameraCapture('FACE_VERIFIED')}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition-colors whitespace-nowrap shrink-0"
                    >
                      Capture Verified Face
                    </button>
                    <button
                      onClick={() => handleTriggerCameraCapture('UNAUTHORIZED')}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25 transition-colors whitespace-nowrap shrink-0"
                    >
                      Simulate Unknown Face
                    </button>
                  </div>
                </div>

                <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 relative">
                  {cameraFrameUrl && (
                    <img
                      id="biometric-camera-feed"
                      src={cameraFrameUrl}
                      alt={`Latest biometric JPEG frame from Face Recognition Node ${effectiveNode3}`}
                      referrerPolicy="no-referrer"
                      className="w-full max-h-[420px] object-contain mx-auto block"
                    />
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ================================================================
              VIEW 3: ENVIRONMENTAL MONITORING
              ================================================================ */}
          {activeView === 'view3' && (
            <section className="space-y-6" aria-label="Environmental Monitoring">
              {/* 3 Circular Gauges: temperature (0-50°C), humidity (0-100%), smoke_gas_level (with red danger zone) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <CircularGauge
                  label="Ambient Temperature (temperature)"
                  value={temperature}
                  min={0}
                  max={50}
                  unit="°C"
                  warningThreshold={32}
                  dangerThreshold={40}
                  accentColor="#00D2FF"
                  subtitle={`Node 2 (${effectiveNode2})`}
                />
                <CircularGauge
                  label="Relative Humidity (humidity)"
                  value={humidity}
                  min={0}
                  max={100}
                  unit="%"
                  warningThreshold={70}
                  dangerThreshold={85}
                  accentColor="#00F59B"
                  subtitle={`Node 2 (${effectiveNode2})`}
                />
                <CircularGauge
                  label="Smoke & Gas Level (smoke_gas_level)"
                  value={smoke_gas_level}
                  min={0}
                  max={1000}
                  unit="PPM"
                  warningThreshold={280}
                  dangerThreshold={SMOKE_DANGER_THRESHOLD}
                  accentColor="#00F59B"
                  subtitle={`Danger Zone ≥ ${SMOKE_DANGER_THRESHOLD} PPM`}
                />
              </div>

              {/* Interactive Line Charts with 30-Point Sliding Window (FIFO Queue) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FifoLineChart
                  title="Thermal Telemetry Stream (0–50°C)"
                  variableName="temperature"
                  labels={fifoHistory.labels}
                  data={fifoHistory.temps}
                  unit="°C"
                  minY={10}
                  maxY={45}
                  color="#00D2FF"
                  dangerThreshold={38}
                />
                <FifoLineChart
                  title="MQ-2 Smoke & Combustible Gas Stream"
                  variableName="smoke_gas_level"
                  labels={fifoHistory.labels}
                  data={fifoHistory.gases}
                  unit=" PPM"
                  minY={0}
                  maxY={700}
                  color="#00F59B"
                  dangerThreshold={SMOKE_DANGER_THRESHOLD}
                />
              </div>

              {/* Relay Panel: Auto/Manual toggle switches for Fan and Lighting */}
              <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md">
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    Environmental Relay Control Panel (Node 2 · {effectiveNode2})
                  </h2>
                  <p className="text-xs text-slate-400">
                    Configure Auto/Manual control loops and manual actuator states for <code className="font-mono">fan_relay</code> and{' '}
                    <code className="font-mono">light_state</code>
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* HVAC Fan Relay Control Card */}
                  <div className="p-4 rounded-xl bg-slate-950/65 border border-slate-800/90 flex flex-col justify-between gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Fan className={`w-5 h-5 ${fan_relay === 'ON' ? 'text-emerald-400' : 'text-rose-400'}`} />
                        <div>
                          <div className="text-sm font-semibold text-slate-100">HVAC Exhaust Fan Relay</div>
                          <div className="text-xs font-mono tabular-nums text-slate-400">
                            Variable: fan_relay = "{fan_relay}"
                          </div>
                        </div>
                      </div>
                      <span
                        className={`font-mono tabular-nums text-xs font-bold ${
                          fan_relay === 'ON' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fan_relay}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 gap-3">
                      <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                        <button
                          onClick={() => setFanControlMode('AUTO')}
                          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            fanControlMode === 'AUTO'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Auto (Thermal)
                        </button>
                        <button
                          onClick={() => setFanControlMode('MANUAL')}
                          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            fanControlMode === 'MANUAL'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Manual Override
                        </button>
                      </div>

                      <button
                        onClick={handleToggleHvacFan}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors whitespace-nowrap shrink-0"
                      >
                        Switch {fan_relay === 'ON' ? 'OFF' : 'ON'}
                      </button>
                    </div>
                  </div>

                  {/* Auxiliary Lighting Relay Control Card */}
                  <div className="p-4 rounded-xl bg-slate-950/65 border border-slate-800/90 flex flex-col justify-between gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Lightbulb
                          className={`w-5 h-5 ${light_state === 'ON' ? 'text-emerald-400' : 'text-rose-400'}`}
                        />
                        <div>
                          <div className="text-sm font-semibold text-slate-100">Corridor Auxiliary Lighting</div>
                          <div className="text-xs font-mono tabular-nums text-slate-400">
                            Variable: light_state = "{light_state}"
                          </div>
                        </div>
                      </div>
                      <span
                        className={`font-mono tabular-nums text-xs font-bold ${
                          light_state === 'ON' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {light_state}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 gap-3">
                      <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
                        <button
                          onClick={() => setLightControlMode('AUTO')}
                          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            lightControlMode === 'AUTO'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Auto (LDR Photocell)
                        </button>
                        <button
                          onClick={() => setLightControlMode('MANUAL')}
                          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            lightControlMode === 'MANUAL'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Manual Override
                        </button>
                      </div>

                      <button
                        onClick={handleToggleAuxLight}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors whitespace-nowrap shrink-0"
                      >
                        Switch {light_state === 'ON' ? 'OFF' : 'ON'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ================================================================
              VIEW 4: AUDIT LOGS & DATABASE EXPLORER (SQLite REST GET)
              ================================================================ */}
          {activeView === 'view4' && (
            <section className="space-y-6" aria-label="Audit Logs and Database Explorer">
              <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      SQLite Audit Logs &amp; Historical Database Explorer
                    </h2>
                    <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                      REST Endpoint: GET http://{CENTRAL_NODE_RED_HOST}/api/logs/{activeAuditTab}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={fetchHistoricalLogsFromNodeRed}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-cyan-300 bg-cyan-500/15 border border-cyan-500/35 rounded-lg hover:bg-cyan-500/25 transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Sync SQLite via REST
                    </button>
                  </div>
                </div>

                {/* SQLite Table Tabs + Search Input */}
                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                    {[
                      { id: 'access_logs' as AuditTableTab, label: `Access Logs (${access_logs.length})` },
                      { id: 'camera_events' as AuditTableTab, label: `Camera Events (${camera_events.length})` },
                      {
                        id: 'environmental_telemetry' as AuditTableTab,
                        label: `Environmental History (${environmental_telemetry.length})`,
                      },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveAuditTab(tab.id);
                          setAuditPage(1);
                        }}
                        className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          activeAuditTab === tab.id
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-72">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={auditSearchQuery}
                      onChange={(e) => {
                        setAuditSearchQuery(e.target.value);
                        setAuditPage(1);
                      }}
                      placeholder={`Filter ${activeAuditTab}...`}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                {/* High-Density Data Table */}
                <div className="overflow-x-auto border border-slate-800/90 rounded-xl bg-slate-950/50">
                  {activeAuditTab === 'access_logs' && (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/60">
                          <th className="py-3 px-4 font-semibold">ID</th>
                          <th className="py-3 px-4 font-semibold">Timestamp</th>
                          <th className="py-3 px-4 font-semibold">Personnel</th>
                          <th className="py-3 px-4 font-semibold">RFID UID</th>
                          <th className="py-3 px-4 font-semibold">MFA Checkpoints</th>
                          <th className="py-3 px-4 font-semibold">mfa_status</th>
                          <th className="py-3 px-4 font-semibold text-right">Node IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {(paginatedAuditRows as AccessLogRecord[]).map((row) => (
                          <tr key={row.id} className="hover:bg-slate-900/50 transition-colors">
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">#{row.id}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-300">{row.timestamp}</td>
                            <td className="py-2.5 px-4 font-medium text-slate-100">{row.user_name}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-cyan-300">{row.card_uid}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-300">{row.factors_used}</td>
                            <td
                              className={`py-2.5 px-4 font-mono tabular-nums font-semibold ${
                                row.mfa_status === 'UNLOCKED'
                                  ? 'text-emerald-400'
                                  : row.mfa_status === 'DENIED_TIMEOUT'
                                  ? 'text-rose-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {row.mfa_status}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400 text-right">
                              {row.node_ip}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {activeAuditTab === 'camera_events' && (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/60">
                          <th className="py-3 px-4 font-semibold">ID</th>
                          <th className="py-3 px-4 font-semibold">Timestamp</th>
                          <th className="py-3 px-4 font-semibold">Event Type</th>
                          <th className="py-3 px-4 font-semibold">Subject / Vector</th>
                          <th className="py-3 px-4 font-semibold text-right">Confidence</th>
                          <th className="py-3 px-4 font-semibold">Frame Archive Path</th>
                          <th className="py-3 px-4 font-semibold text-right">Node IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {(paginatedAuditRows as CameraEventRecord[]).map((row) => (
                          <tr key={row.id} className="hover:bg-slate-900/50 transition-colors">
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">#{row.id}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-300">{row.timestamp}</td>
                            <td
                              className={`py-2.5 px-4 font-mono tabular-nums font-semibold ${
                                row.event_type === 'FACE_MATCH'
                                  ? 'text-emerald-400'
                                  : row.event_type === 'UNKNOWN_FACE'
                                  ? 'text-rose-400'
                                  : 'text-cyan-400'
                              }`}
                            >
                              {row.event_type}
                            </td>
                            <td className="py-2.5 px-4 font-medium text-slate-100">{row.subject_name}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-200">
                              {row.confidence.toFixed(1)}%
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">{row.frame_ref}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400 text-right">
                              {row.node_ip}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {activeAuditTab === 'environmental_telemetry' && (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/60">
                          <th className="py-3 px-4 font-semibold">ID</th>
                          <th className="py-3 px-4 font-semibold">Timestamp</th>
                          <th className="py-3 px-4 font-semibold text-right">temperature</th>
                          <th className="py-3 px-4 font-semibold text-right">humidity</th>
                          <th className="py-3 px-4 font-semibold text-right">smoke_gas_level</th>
                          <th className="py-3 px-4 font-semibold">light_state</th>
                          <th className="py-3 px-4 font-semibold">fan_relay</th>
                          <th className="py-3 px-4 font-semibold text-right">Node IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {(paginatedAuditRows as EnvironmentalTelemetryRecord[]).map((row) => (
                          <tr key={row.id} className="hover:bg-slate-900/50 transition-colors">
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">#{row.id}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-300">{row.timestamp}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-right text-cyan-300">
                              {row.temperature.toFixed(1)}°C
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-right text-cyan-300">
                              {row.humidity.toFixed(1)}%
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-right text-emerald-400">
                              {row.smoke_gas_level} PPM
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-200">{row.light_state}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-200">{row.fan_relay}</td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400 text-right">
                              {row.node_ip}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Pagination Controls */}
                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span className="font-mono tabular-nums">
                    Showing {paginatedAuditRows.length} of {filteredAuditRows.length} records in SQLite table{' '}
                    <strong className="text-slate-200">{activeAuditTab}</strong>
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                      disabled={currentAuditPage <= 1}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition-colors"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-mono tabular-nums px-2">
                      Page {currentAuditPage} / {totalAuditPages}
                    </span>
                    <button
                      onClick={() => setAuditPage((p) => Math.min(totalAuditPages, p + 1))}
                      disabled={currentAuditPage >= totalAuditPages}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition-colors"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ================================================================
              VIEW 5: SYSTEM HEALTH & DIAGNOSTICS
              ================================================================ */}
          {activeView === 'view5' && (
            <section className="space-y-6" aria-label="System Health and Diagnostics">
              {/* Network Heartbeat Monitor (4 Nodes, 5-Second WebSocket Ping) */}
              <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      Network Heartbeat Monitor (5-Second WebSocket Ping Interval)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Real-time reachability for Central Node-RED Server and the 3 Field Subsystem Nodes
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const now = formatNowTime();
                      setHeartbeats((prev) =>
                        prev.map((n) => ({
                          ...n,
                          lastPing: now,
                          latencyMs: Number((1.8 + Math.random() * 5.5).toFixed(1)),
                        }))
                      );
                    }}
                    className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-300 hover:bg-cyan-500/25 transition-colors whitespace-nowrap shrink-0"
                  >
                    Trigger Immediate Ping
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {heartbeats.map((node) => (
                    <div
                      key={node.id}
                      className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 flex flex-col justify-between space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-100">{node.name}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{node.role}</div>
                        </div>
                        <button
                          onClick={() =>
                            setHeartbeats((prev) =>
                              prev.map((item) =>
                                item.id === node.id ? { ...item, online: !item.online } : item
                              )
                            )
                          }
                          className={`font-mono tabular-nums text-xs font-semibold whitespace-nowrap shrink-0 ${
                            node.online ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {node.online ? 'ONLINE' : 'OFFLINE'}
                        </button>
                      </div>

                      <div className="pt-2 border-t border-slate-800/80 space-y-1 text-xs font-mono tabular-nums">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Endpoint IP</span>
                          <span className="text-cyan-300">{node.ip}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">WS RTT Latency</span>
                          <span className="text-slate-200">{node.online ? `${node.latencyMs} ms` : 'TIMEOUT'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Last Ping</span>
                          <span className="text-slate-300">{node.lastPing}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* System Errors Table (system_errors) */}
              <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      System Diagnostic &amp; Fault Log (SQLite Table: system_errors)
                    </h2>
                    <p className="text-xs text-slate-400 font-mono tabular-nums">
                      Tracks disconnected sensors, frame buffer drops, and MFA timeouts across LCI-SFM nodes
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      const newErr: SystemErrorRecord = {
                        id: (system_errors[0]?.id || 84) + 1,
                        timestamp: formatNowTimestamp(),
                        error_code: 'ERR_DHT22_BUS_CRC',
                        subsystem: 'NODE_2_ENV',
                        severity: 'WARNING',
                        message: `Single-wire CRC checksum retry on Node 2 (${effectiveNode2}); recovered on next cycle.`,
                        resolved: false,
                      };
                      setSystemErrors((prev) => [newErr, ...prev]);
                    }}
                    className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors whitespace-nowrap shrink-0"
                  >
                    Simulate Sensor Fault Entry
                  </button>
                </div>

                <div className="overflow-x-auto border border-slate-800/90 rounded-xl bg-slate-950/50">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/60">
                        <th className="py-3 px-4 font-semibold">ID</th>
                        <th className="py-3 px-4 font-semibold">Timestamp</th>
                        <th className="py-3 px-4 font-semibold">Error Code</th>
                        <th className="py-3 px-4 font-semibold">Subsystem</th>
                        <th className="py-3 px-4 font-semibold">Diagnostic Message</th>
                        <th className="py-3 px-4 font-semibold text-right">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {system_errors.map((err) => (
                        <tr key={err.id} className="hover:bg-slate-900/50 transition-colors">
                          <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">#{err.id}</td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-slate-300">{err.timestamp}</td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-rose-400 font-semibold">
                            {err.error_code}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-cyan-300">{err.subsystem}</td>
                          <td className="py-2.5 px-4 text-slate-200">{err.message}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                            {err.resolved ? (
                              <span className="text-emerald-400">RESOLVED</span>
                            ) : (
                              <button
                                onClick={() =>
                                  setSystemErrors((prev) =>
                                    prev.map((item) =>
                                      item.id === err.id ? { ...item, resolved: true } : item
                                    )
                                  )
                                }
                                className="text-amber-400 hover:underline whitespace-nowrap shrink-0"
                              >
                                Acknowledge
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* ================================================================
              VIEW 6: SYSTEM MANAGEMENT & PROVISIONING
              ================================================================ */}
          {activeView === 'view6' && (
            <section className="space-y-6" aria-label="System Management and Provisioning">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* User Management Form (HTTP POST JSON) */}
                <div className="lg:col-span-6 bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md flex flex-col justify-between space-y-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <UserPlus className="w-5 h-5 text-cyan-400" />
                      <h2 className="text-base font-semibold text-slate-100">
                        User Biometric &amp; RFID Provisioning
                      </h2>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Registers operator credentials and dispatches JSON via HTTP POST to{' '}
                      <code className="font-mono">http://{CENTRAL_NODE_RED_HOST}/api/users</code>
                    </p>
                  </div>

                  <form onSubmit={handleProvisionUser} className="space-y-4 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-slate-300 font-medium block">Full Name / Username</label>
                        <input
                          type="text"
                          required
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="e.g. Eng. S. Mansour"
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-slate-300 font-medium block">Facility Department</label>
                        <input
                          type="text"
                          required
                          value={newDepartment}
                          onChange={(e) => setNewDepartment(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-slate-300 font-medium flex justify-between">
                          <span>RFID Card UID</span>
                          <button
                            type="button"
                            onClick={() => {
                              const hex = () =>
                                Math.floor(16 + Math.random() * 239)
                                  .toString(16)
                                  .toUpperCase();
                              setNewRfidUid(`04:${hex()}:${hex()}:${hex()}`);
                            }}
                            className="text-cyan-400 hover:underline text-[11px]"
                          >
                            Generate
                          </button>
                        </label>
                        <input
                          type="text"
                          required
                          value={newRfidUid}
                          onChange={(e) => setNewRfidUid(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono tabular-nums text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-slate-300 font-medium flex justify-between">
                          <span>Face Template ID</span>
                          <button
                            type="button"
                            onClick={() =>
                              setNewFaceTemplate(`BIO_VEC_${Math.floor(1000 + Math.random() * 8999)}`)
                            }
                            className="text-cyan-400 hover:underline text-[11px]"
                          >
                            Enroll Cam
                          </button>
                        </label>
                        <input
                          type="text"
                          required
                          value={newFaceTemplate}
                          onChange={(e) => setNewFaceTemplate(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono tabular-nums text-emerald-300 focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-slate-300 font-medium block">Keypad Stage 2 PIN</label>
                        <input
                          type="password"
                          maxLength={6}
                          required
                          value={newPinCode}
                          onChange={(e) => setNewPinCode(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono tabular-nums text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>

                    {userFormNotice && (
                      <div className="text-xs text-emerald-400 font-mono tabular-nums flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {userFormNotice}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full py-2.5 px-4 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs transition-colors whitespace-nowrap shrink-0"
                    >
                      Provision User &amp; Sync to Access Node ({effectiveNode1})
                    </button>
                  </form>
                </div>

                {/* Node Management Form (ip_node1, ip_node2, ip_node3 in localStorage) */}
                <div className="lg:col-span-6 bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md flex flex-col justify-between space-y-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <Network className="w-5 h-5 text-emerald-400" />
                      <h2 className="text-base font-semibold text-slate-100">
                        Dynamic Node IP Configuration (localStorage)
                      </h2>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Updates <code className="font-mono">ip_node1</code>, <code className="font-mono">ip_node2</code>, and{' '}
                      <code className="font-mono">ip_node3</code> in browser <code className="font-mono">localStorage</code> and notifies Node-RED
                    </p>
                  </div>

                  <form onSubmit={handleSaveDynamicIps} className="space-y-4 text-xs">
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-medium flex justify-between">
                        <span>Access &amp; Lock Node (ip_node1)</span>
                        <span className="font-mono text-slate-400">RFID, Keypad, Reed, Solenoid</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={modalIp1}
                        onChange={(e) => setModalIp1(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono tabular-nums text-cyan-300 focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-medium flex justify-between">
                        <span>Environmental Node (ip_node2)</span>
                        <span className="font-mono text-slate-400">DHT22, MQ-2, LDR, HVAC Relays</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={modalIp2}
                        onChange={(e) => setModalIp2(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono tabular-nums text-cyan-300 focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-medium flex justify-between">
                        <span>Face Recognition Node (ip_node3)</span>
                        <span className="font-mono text-slate-400">Optical JPEG Stream &amp; Biometrics</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={modalIp3}
                        onChange={(e) => setModalIp3(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono tabular-nums text-cyan-300 focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    {nodeFormNotice && (
                      <div className="text-xs text-emerald-400 font-mono tabular-nums flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {nodeFormNotice}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full py-2.5 px-4 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs transition-colors whitespace-nowrap shrink-0"
                    >
                      Save Node IPs to localStorage &amp; Notify Node-RED
                    </button>
                  </form>
                </div>
              </div>

              {/* Provisioned Operators Directory */}
              <div className="bg-slate-900/75 border border-slate-800/90 rounded-xl p-6 backdrop-blur-md space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-100">
                    Provisioned Facility Personnel Registry ({provisionedUsers.length} Active)
                  </h3>
                  <span className="text-xs font-mono tabular-nums text-slate-400">
                    Synced with {effectiveNode1} &amp; {effectiveNode3}
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-800/90 rounded-xl bg-slate-950/50">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/60">
                        <th className="py-3 px-4 font-semibold">User ID</th>
                        <th className="py-3 px-4 font-semibold">Username</th>
                        <th className="py-3 px-4 font-semibold">Department</th>
                        <th className="py-3 px-4 font-semibold">RFID Card UID</th>
                        <th className="py-3 px-4 font-semibold">Face Template ID</th>
                        <th className="py-3 px-4 font-semibold text-right">Provisioned Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {provisionedUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-900/50 transition-colors">
                          <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">{u.id}</td>
                          <td className="py-2.5 px-4 font-medium text-slate-100">{u.username}</td>
                          <td className="py-2.5 px-4 text-slate-300">{u.department}</td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-cyan-300">{u.rfid_uid}</td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-emerald-400">
                            {u.face_template_id}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400 text-right">
                            {u.created_at}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* ====================================================================
          STARTUP / DYNAMIC IP CONFIGURATION MODAL (ip_node1, ip_node2, ip_node3)
          ==================================================================== */}
      {showStartupModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-cyan-500/40 rounded-xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  LCI-SFM Dynamic Node IP Setup
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Configure the 3 air-gapped subsystem IP addresses in <code className="font-mono text-cyan-300">localStorage</code>:
                </p>
              </div>
              <button
                onClick={() => setShowStartupModal(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSaveDynamicIps} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-medium block">
                  Access Node IP (<code className="font-mono text-cyan-300">ip_node1</code>)
                </label>
                <input
                  type="text"
                  required
                  value={modalIp1}
                  onChange={(e) => setModalIp1(e.target.value)}
                  placeholder="192.168.10.11"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono tabular-nums text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-medium block">
                  Environment Node IP (<code className="font-mono text-cyan-300">ip_node2</code>)
                </label>
                <input
                  type="text"
                  required
                  value={modalIp2}
                  onChange={(e) => setModalIp2(e.target.value)}
                  placeholder="192.168.10.12"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono tabular-nums text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-medium block">
                  Face Recognition Node IP (<code className="font-mono text-cyan-300">ip_node3</code>)
                </label>
                <input
                  type="text"
                  required
                  value={modalIp3}
                  onChange={(e) => setModalIp3(e.target.value)}
                  placeholder="192.168.10.13"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono tabular-nums text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStartupModal(false)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold transition-colors"
                >
                  Save to localStorage
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Standalone Vanilla HTML5/CSS3/ES6 Source Export Modal */}
      <VanillaExportModal
        isOpen={showVanillaModal}
        onClose={() => setShowVanillaModal(false)}
        ipNode1={effectiveNode1}
        ipNode2={effectiveNode2}
        ipNode3={effectiveNode3}
      />
    </div>
  );
}
