import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Thermometer,
  Droplets,
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
  CheckCircle2,
  Sliders,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
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

interface ToastNotification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

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
  // NEW FEATURE 1: LIGHT / DARK MODE TOGGLE (Persisted in localStorage)
  // ==========================================================================
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('lci_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('lci_theme', theme);
  }, [theme]);

  // ==========================================================================
  // NEW FEATURE 5: COLLAPSIBLE SIDEBAR (Persisted in localStorage)
  // ==========================================================================
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('lci_sidebar_collapsed') === 'true';
  });

  const handleToggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('lci_sidebar_collapsed', String(next));
      return next;
    });
  };

  // ==========================================================================
  // NEW FEATURE 3: VANILLA TOAST NOTIFICATION STACK (3-Second Auto-Dismiss)
  // ==========================================================================
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const showToast = useCallback((message: string, type: ToastNotification['type'] = 'info') => {
    const id = `TOAST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // ==========================================================================
  // NEW FEATURE 4: ANTI-SPAM QUICK ACTION LOADING STATES (1.5s CSS Spinner)
  // ==========================================================================
  const [loadingButtons, setLoadingButtons] = useState<{
    emergency: boolean;
    fan: boolean;
    light: boolean;
  }>({
    emergency: false,
    fan: false,
    light: false,
  });

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
      showToast(`Stage 1 (${passedFactors[0]}) passed — 10s Stage 2 countdown started`, 'info');
      if (mfaTimerRef.current) window.clearInterval(mfaTimerRef.current);

      mfaTimerRef.current = window.setInterval(() => {
        setMfaCountdown((prev) => {
          if (prev <= 1) {
            if (mfaTimerRef.current) {
              window.clearInterval(mfaTimerRef.current);
              mfaTimerRef.current = null;
            }
            setIsFacePassed(false);
            setIsCardPassed(false);
            setIsPinPassed(false);
            setMfaStatus('IDLE');
            showToast(`Stage 2 MFA 10s window expired — Solenoid remained LOCKED`, 'error');
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
      if (mfaTimerRef.current) {
        window.clearInterval(mfaTimerRef.current);
        mfaTimerRef.current = null;
      }
      setMfaStatus('UNLOCKED');
      setDoorState('OPEN');
      const factorString = passedFactors.join(' + ');
      showToast(`2-of-3 MFA Verified (${factorString}) — Door Unlocked`, 'success');
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
  }, [isFacePassed, isCardPassed, isPinPassed, effectiveNode1, pushActivity, showToast]);

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
            const nextGas =
              prevGas >= SMOKE_DANGER_THRESHOLD
                ? prevGas
                : Math.max(95, Math.min(320, Math.round(prevGas + (Math.random() - 0.5) * 6)));

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
  // 8. DIRECT SERVER COMMAND HANDLERS WITH 1.5s ANTI-SPAM LOADING + TOASTS
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
    if (loadingButtons.emergency) return;
    setLoadingButtons((prev) => ({ ...prev, emergency: true }));

    window.setTimeout(() => {
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
      setLoadingButtons((prev) => ({ ...prev, emergency: false }));
      showToast(`Emergency Door Unlock dispatched to Node 1 (${effectiveNode1})`, 'error');
    }, 1500);
  };

  const handleToggleHvacFan = () => {
    if (loadingButtons.fan) return;
    setLoadingButtons((prev) => ({ ...prev, fan: true }));

    window.setTimeout(() => {
      const nextState: FanRelayState = fan_relay === 'ON' ? 'OFF' : 'ON';
      setFanRelay(nextState);
      sendNodeRedCommand('TOGGLE_HVAC_FAN', { target_ip: effectiveNode2, fan_relay: nextState });
      pushActivity(
        'ENVIRONMENT',
        `HVAC Fan Relay switched ${nextState} on Node 2 (${effectiveNode2})`,
        'NOMINAL'
      );
      setLoadingButtons((prev) => ({ ...prev, fan: false }));
      showToast(
        `HVAC Fan Relay switched ${nextState} on Node 2 (${effectiveNode2})`,
        nextState === 'ON' ? 'success' : 'info'
      );
    }, 1500);
  };

  const handleToggleAuxLight = () => {
    if (loadingButtons.light) return;
    setLoadingButtons((prev) => ({ ...prev, light: true }));

    window.setTimeout(() => {
      const nextState: LightState = light_state === 'ON' ? 'OFF' : 'ON';
      setLightState(nextState);
      sendNodeRedCommand('TOGGLE_AUX_LIGHT', { target_ip: effectiveNode2, light_state: nextState });
      pushActivity(
        'ENVIRONMENT',
        `Auxiliary Corridor Lighting switched ${nextState} on Node 2 (${effectiveNode2})`,
        'NOMINAL'
      );
      setLoadingButtons((prev) => ({ ...prev, light: false }));
      showToast(
        `Auxiliary Light switched ${nextState} on Node 2 (${effectiveNode2})`,
        nextState === 'ON' ? 'success' : 'info'
      );
    }, 1500);
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
    showToast(`Saved Node IPs (${clean1}, ${clean2}, ${clean3}) to localStorage`, 'success');
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
    showToast(
      `Biometric Camera (${effectiveNode3}) frame updated: ${mode}`,
      mode === 'UNAUTHORIZED' ? 'error' : mode === 'FACE_VERIFIED' ? 'success' : 'info'
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
    showToast(`Operator "${createdUser.username}" provisioned via HTTP POST`, 'success');
  };

  const isEmergencyAlert =
    smoke_gas_level >= SMOKE_DANGER_THRESHOLD ||
    emergencyOverrideActive ||
    system_errors.some((err) => !err.resolved && err.severity === 'CRITICAL');

  const passedMfaCount = [isFacePassed, isCardPassed, isPinPassed].filter(Boolean).length;

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
    <div
      className="min-h-screen flex flex-col transition-colors duration-200"
      style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}
    >
      {/* ====================================================================
          NEW FEATURE 3: VANILLA TOAST NOTIFICATION STACK (Top-Right, 3s Auto-Dismiss)
          ==================================================================== */}
      <div
        className="fixed top-16 right-6 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const borderStyle =
            t.type === 'success'
              ? 'var(--soft-mint-border)'
              : t.type === 'error'
              ? 'var(--soft-coral-border)'
              : 'var(--soft-blue-border)';
          const dotColor =
            t.type === 'success'
              ? 'var(--soft-mint-strong)'
              : t.type === 'error'
              ? 'var(--soft-coral-strong)'
              : 'var(--soft-blue-strong)';

          return (
            <div
              key={t.id}
              className="pointer-events-auto lci-surface rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs transition-all duration-200"
              style={{ borderColor: borderStyle }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: dotColor }}
                />
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {t.message}
                </span>
              </div>
              <span className="font-mono tabular-nums text-[11px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                3.0s
              </span>
            </div>
          );
        })}
      </div>

      {/* ====================================================================
          TOP BAR CONTRACT: 3 Zones separated by gap-8
          Zone 1: Single text element wordmark
          Zone 2: 5 concise single-line text nav links
          Zone 3: Primary Theme Toggle & Vanilla Code Action
          ==================================================================== */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 backdrop-blur-md"
        style={{
          backgroundColor: 'var(--bg-header)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <a
          href="#command-center"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('view1');
          }}
          className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0"
          style={{ color: 'var(--text-primary)' }}
        >
          LCI-SFM Facility Control
        </a>

        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {[
            { id: 'view1' as ViewId, label: 'Command Center' },
            { id: 'view2' as ViewId, label: 'Smart Access' },
            { id: 'view3' as ViewId, label: 'Environment' },
            { id: 'view4' as ViewId, label: 'Audit Explorer' },
            { id: 'view5' as ViewId, label: 'System Health' },
          ].map((nav) => (
            <a
              key={nav.id}
              href={`#${nav.id}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveView(nav.id);
              }}
              className="hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
              style={
                activeView === nav.id
                  ? { color: 'var(--soft-blue)', textDecoration: 'underline' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              {nav.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Feature 1: Light / Dark Mode Toggle */}
          <button
            onClick={() => {
              const next = theme === 'dark' ? 'light' : 'dark';
              setTheme(next);
              showToast(`Switched to ${next === 'dark' ? 'Dark' : 'Light'} Mode (saved to localStorage)`, 'info');
            }}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg lci-surface hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Toggle Light or Dark Mode"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5" style={{ color: 'var(--soft-amber)' }} />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5" style={{ color: 'var(--soft-blue)' }} />
                <span>Dark Mode</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* ====================================================================
          MAIN WORKSPACE SHELL: Collapsible Sidebar + Expanding 6-Section Viewport
          ==================================================================== */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Feature 5: Collapsible Sidebar Navigation */}
        <aside
          className={`shrink-0 flex flex-col justify-between select-none transition-all duration-200 overflow-hidden ${
            sidebarCollapsed ? 'w-0 p-0 border-r-0 opacity-0' : 'w-64 p-4 opacity-100'
          }`}
          style={{
            backgroundColor: 'var(--bg-sidebar)',
            borderRight: sidebarCollapsed ? 'none' : '1px solid var(--border-subtle)',
          }}
        >
          <div className="space-y-6 w-56">
            <div>
              <div
                className="px-3 pb-2 text-xs font-medium flex items-center justify-between"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span>Facility Subsystems</span>
                <button
                  onClick={handleToggleSidebar}
                  className="p-1 rounded hover:opacity-80"
                  title="Collapse Sidebar"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
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
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                      style={
                        isActive
                          ? {
                              backgroundColor: 'var(--soft-blue-bg)',
                              color: 'var(--soft-blue)',
                              border: '1px solid var(--soft-blue-border)',
                            }
                          : {
                              color: 'var(--text-secondary)',
                              border: '1px solid transparent',
                            }
                      }
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Node IP Summary Box (localStorage state) */}
            <div className="p-3.5 rounded-xl lci-surface space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Active Node Registry
                </span>
                <button
                  onClick={() => setShowStartupModal(true)}
                  className="hover:underline text-[11px] whitespace-nowrap shrink-0"
                  style={{ color: 'var(--soft-blue)' }}
                >
                  Edit IPs
                </button>
              </div>
              <div className="space-y-1.5 text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex justify-between">
                  <span>ip_node1 (Access)</span>
                  <span style={{ color: 'var(--text-primary)' }}>{effectiveNode1}</span>
                </div>
                <div className="flex justify-between">
                  <span>ip_node2 (Environ)</span>
                  <span style={{ color: 'var(--text-primary)' }}>{effectiveNode2}</span>
                </div>
                <div className="flex justify-between">
                  <span>ip_node3 (Biometric)</span>
                  <span style={{ color: 'var(--text-primary)' }}>{effectiveNode3}</span>
                </div>
              </div>
              <div
                className="pt-2 text-[11px] flex items-center justify-between"
                style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                <span>Bus Mode</span>
                <span className="font-mono tabular-nums" style={{ color: 'var(--soft-mint)' }}>
                  {wsConnectionState === 'CONNECTED_LAN' ? 'WS LIVE LAN' : 'AIR-GAP SIM'}
                </span>
              </div>
            </div>
          </div>

          <div
            className="pt-4 space-y-2 w-56"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <button
              onClick={() => setShowSimDrawer((prev) => !prev)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
              style={{
                backgroundColor: 'var(--soft-blue-bg)',
                color: 'var(--soft-blue)',
                border: '1px solid var(--soft-blue-border)',
              }}
            >
              <Sliders className="w-3.5 h-3.5" />
              {showSimDrawer ? 'Hide Telemetry Testbench' : 'Open Telemetry Testbench'}
            </button>
            <button
              onClick={() => setShowVanillaModal(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg lci-elevated transition-colors whitespace-nowrap shrink-0"
              style={{ color: 'var(--text-primary)' }}
            >
              Inspect Vanilla ES6 Files
            </button>
          </div>
        </aside>

        {/* Main Expanding Content Viewport */}
        <main className="flex-1 min-w-0 p-6 lg:p-8 space-y-6 max-w-[1440px] mx-auto w-full transition-all duration-200">
          {/* Workspace Sub-Toolbar: Collapsible Sidebar Toggle + Context Trail */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={handleToggleSidebar}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg lci-surface hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                style={{ color: 'var(--text-primary)' }}
              >
                {sidebarCollapsed ? (
                  <>
                    <PanelLeftOpen className="w-4 h-4" style={{ color: 'var(--soft-blue)' }} />
                    <span>Expand Sidebar</span>
                  </>
                ) : (
                  <>
                    <PanelLeftClose className="w-4 h-4" style={{ color: 'var(--soft-blue)' }} />
                    <span>Collapse Sidebar</span>
                  </>
                )}
              </button>
              <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                LCI-SFM · Soft UI Theme: {theme.toUpperCase()} · Node-RED: {CENTRAL_NODE_RED_HOST}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSimDrawer((v) => !v)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg lci-surface whitespace-nowrap shrink-0"
                style={{ color: 'var(--text-secondary)' }}
              >
                {showSimDrawer ? 'Close Simulator' : 'Telemetry Simulator'}
              </button>
              <button
                onClick={() => setShowVanillaModal(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
                style={{
                  backgroundColor: 'var(--soft-blue-bg)',
                  color: 'var(--soft-blue)',
                  border: '1px solid var(--soft-blue-border)',
                }}
              >
                View Updated HTML / CSS / JS
              </button>
            </div>
          </div>

          {/* ================================================================
              DYNAMIC IP INITIAL SETUP PROMPT (If localStorage not yet saved)
              ================================================================ */}
          {!isNodesConfigured && (
            <div
              className="lci-surface rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              style={{ borderColor: 'var(--soft-blue-border)' }}
            >
              <div className="space-y-1">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--soft-blue)' }}>
                  Initial Air-Gapped Node IP Setup Required (localStorage Check)
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Node IPs (<code className="font-mono">ip_node1</code>,{' '}
                  <code className="font-mono">ip_node2</code>,{' '}
                  <code className="font-mono">ip_node3</code>) were not found in{' '}
                  <code className="font-mono">localStorage</code>. Confirm the default subnet addresses or open the Startup Modal.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setShowStartupModal(true)}
                  className="px-3.5 py-2 text-xs font-medium rounded-lg lci-elevated whitespace-nowrap shrink-0"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Open Startup IP Modal
                </button>
                <button
                  onClick={handleSaveDynamicIps}
                  className="px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0"
                  style={{
                    backgroundColor: 'var(--soft-mint-bg)',
                    color: 'var(--soft-mint)',
                    border: '1px solid var(--soft-mint-border)',
                  }}
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
            <div className="lci-surface rounded-xl p-5 space-y-4" style={{ borderColor: 'var(--soft-blue-border)' }}>
              <div
                className="flex flex-wrap items-center justify-between gap-4 pb-3"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--soft-blue)' }}>
                    Node-RED WebSocket Payload Injector &amp; Hardware Testbench
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Simulate live JSON frames on <code className="font-mono">ws://192.168.10.2:1880/ws/telemetry</code> and{' '}
                    <code className="font-mono">ws://192.168.10.2:1880/ws/mfa</code>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setLiveSimEnabled((v) => !v)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                    style={
                      liveSimEnabled
                        ? {
                            backgroundColor: 'var(--soft-mint-bg)',
                            color: 'var(--soft-mint)',
                            border: '1px solid var(--soft-mint-border)',
                          }
                        : {
                            backgroundColor: 'var(--bg-elevated)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-subtle)',
                          }
                    }
                  >
                    Auto Telemetry Stream: {liveSimEnabled ? 'ON' : 'PAUSED'}
                  </button>
                  <button
                    onClick={() => {
                      const nextGas = smoke_gas_level >= SMOKE_DANGER_THRESHOLD ? 118 : 540;
                      setSmokeGasLevel(nextGas);
                      showToast(
                        nextGas >= SMOKE_DANGER_THRESHOLD
                          ? 'Simulated Smoke/Gas Danger Spike (540 PPM)'
                          : 'Smoke/Gas cleared to nominal (118 PPM)',
                        nextGas >= SMOKE_DANGER_THRESHOLD ? 'error' : 'success'
                      );
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                    style={{
                      backgroundColor: 'var(--soft-coral-bg)',
                      color: 'var(--soft-coral)',
                      border: '1px solid var(--soft-coral-border)',
                    }}
                  >
                    {smoke_gas_level >= SMOKE_DANGER_THRESHOLD
                      ? 'Clear Smoke Alarm (118 PPM)'
                      : 'Simulate Smoke Danger (540 PPM)'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                <div className="space-y-1.5">
                  <label className="flex justify-between font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    <span>temperature</span>
                    <span style={{ color: 'var(--soft-blue)' }}>{temperature.toFixed(1)}°C</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="0.5"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex justify-between font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    <span>humidity</span>
                    <span style={{ color: 'var(--soft-blue)' }}>{humidity.toFixed(1)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={humidity}
                    onChange={(e) => setHumidity(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex justify-between font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    <span>smoke_gas_level</span>
                    <span
                      style={{
                        color:
                          smoke_gas_level >= SMOKE_DANGER_THRESHOLD
                            ? 'var(--soft-coral)'
                            : 'var(--soft-mint)',
                      }}
                    >
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
                    className="w-full"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button
                    onClick={() => setIsFacePassed((v) => !v)}
                    className="flex-1 py-2 px-2.5 rounded-lg font-mono text-[11px] transition-colors whitespace-nowrap shrink-0"
                    style={
                      isFacePassed
                        ? {
                            backgroundColor: 'var(--soft-mint-bg)',
                            color: 'var(--soft-mint)',
                            border: '1px solid var(--soft-mint-border)',
                          }
                        : {
                            backgroundColor: 'var(--bg-elevated)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-subtle)',
                          }
                    }
                  >
                    Face: {String(isFacePassed)}
                  </button>
                  <button
                    onClick={() => setIsCardPassed((v) => !v)}
                    className="flex-1 py-2 px-2.5 rounded-lg font-mono text-[11px] transition-colors whitespace-nowrap shrink-0"
                    style={
                      isCardPassed
                        ? {
                            backgroundColor: 'var(--soft-mint-bg)',
                            color: 'var(--soft-mint)',
                            border: '1px solid var(--soft-mint-border)',
                          }
                        : {
                            backgroundColor: 'var(--bg-elevated)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-subtle)',
                          }
                    }
                  >
                    Card: {String(isCardPassed)}
                  </button>
                  <button
                    onClick={() => setIsPinPassed((v) => !v)}
                    className="flex-1 py-2 px-2.5 rounded-lg font-mono text-[11px] transition-colors whitespace-nowrap shrink-0"
                    style={
                      isPinPassed
                        ? {
                            backgroundColor: 'var(--soft-mint-bg)',
                            color: 'var(--soft-mint)',
                            border: '1px solid var(--soft-mint-border)',
                          }
                        : {
                            backgroundColor: 'var(--bg-elevated)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-subtle)',
                          }
                    }
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
              {/* Global Status Banner: Soft Mint Green (Normal) or Soft Coral/Rose (Emergency) */}
              <div
                className="rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors"
                style={
                  isEmergencyAlert
                    ? {
                        backgroundColor: 'var(--soft-coral-bg)',
                        border: '1px solid var(--soft-coral-border)',
                        color: 'var(--soft-coral)',
                      }
                    : {
                        backgroundColor: 'var(--soft-mint-bg)',
                        border: '1px solid var(--soft-mint-border)',
                        color: 'var(--soft-mint)',
                      }
                }
              >
                <div className="flex items-center gap-3.5">
                  {isEmergencyAlert ? (
                    <ShieldAlert className="w-7 h-7 shrink-0" style={{ color: 'var(--soft-coral)' }} />
                  ) : (
                    <ShieldCheck className="w-7 h-7 shrink-0" style={{ color: 'var(--soft-mint)' }} />
                  )}
                  <div>
                    <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                      {isEmergencyAlert
                        ? 'GLOBAL FACILITY STATUS: EMERGENCY ALERT ACTIVE'
                        : 'GLOBAL FACILITY STATUS: NORMAL OPERATION'}
                    </h1>
                    <p className="text-xs font-mono tabular-nums mt-0.5" style={{ color: 'var(--text-secondary)' }}>
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
                        showToast('Facility status restored to NORMAL OPERATION', 'success');
                      }}
                      className="px-4 py-2 text-xs font-semibold rounded-lg transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
                      style={{
                        backgroundColor: 'var(--soft-mint-strong)',
                        color: '#0f172a',
                      }}
                    >
                      Acknowledge &amp; Reset Normal
                    </button>
                  )}
                  <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    Nodes Online: 4/4
                  </span>
                </div>
              </div>

              {/* Quick Telemetry Snapshot: 5 Soft UI Mini-Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* 1. door_state */}
                <div className="lci-surface rounded-xl p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>Door Reed State</span>
                    {door_state === 'OPEN' ? (
                      <DoorOpen className="w-4 h-4" style={{ color: 'var(--soft-coral)' }} />
                    ) : (
                      <DoorClosed className="w-4 h-4" style={{ color: 'var(--soft-mint)' }} />
                    )}
                  </div>
                  <div className="my-3">
                    <div
                      className="text-2xl font-bold font-mono tabular-nums"
                      style={{
                        color: door_state === 'OPEN' ? 'var(--soft-coral)' : 'var(--soft-mint)',
                      }}
                    >
                      {door_state}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums mt-1" style={{ color: 'var(--text-secondary)' }}>
                      var: door_state · {effectiveNode1}
                    </div>
                  </div>
                </div>

                {/* 2. light_state (LDR Sensor) */}
                <div className="lci-surface rounded-xl p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>Aux Light (LDR)</span>
                    <Lightbulb
                      className="w-4 h-4"
                      style={{ color: light_state === 'ON' ? 'var(--soft-mint)' : 'var(--soft-coral)' }}
                    />
                  </div>
                  <div className="my-3">
                    <div
                      className="text-2xl font-bold font-mono tabular-nums"
                      style={{
                        color: light_state === 'ON' ? 'var(--soft-mint)' : 'var(--soft-coral)',
                      }}
                    >
                      {light_state}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums mt-1" style={{ color: 'var(--text-secondary)' }}>
                      var: light_state · Mode: {lightControlMode}
                    </div>
                  </div>
                </div>

                {/* 3. fan_relay */}
                <div className="lci-surface rounded-xl p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>HVAC Fan Relay</span>
                    <Fan
                      className="w-4 h-4"
                      style={{ color: fan_relay === 'ON' ? 'var(--soft-mint)' : 'var(--soft-coral)' }}
                    />
                  </div>
                  <div className="my-3">
                    <div
                      className="text-2xl font-bold font-mono tabular-nums"
                      style={{
                        color: fan_relay === 'ON' ? 'var(--soft-mint)' : 'var(--soft-coral)',
                      }}
                    >
                      {fan_relay}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums mt-1" style={{ color: 'var(--text-secondary)' }}>
                      var: fan_relay · Mode: {fanControlMode}
                    </div>
                  </div>
                </div>

                {/* 4. temperature */}
                <div className="lci-surface rounded-xl p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>Temperature</span>
                    <Thermometer className="w-4 h-4" style={{ color: 'var(--soft-blue)' }} />
                  </div>
                  <div className="my-3">
                    <div className="text-2xl font-bold font-mono tabular-nums" style={{ color: 'var(--soft-blue)' }}>
                      {temperature.toFixed(1)}°C
                    </div>
                    <div className="text-[11px] font-mono tabular-nums mt-1" style={{ color: 'var(--text-secondary)' }}>
                      var: temperature · {effectiveNode2}
                    </div>
                  </div>
                </div>

                {/* 5. humidity */}
                <div className="lci-surface rounded-xl p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>Relative Humidity</span>
                    <Droplets className="w-4 h-4" style={{ color: 'var(--soft-blue)' }} />
                  </div>
                  <div className="my-3">
                    <div className="text-2xl font-bold font-mono tabular-nums" style={{ color: 'var(--soft-blue)' }}>
                      {humidity.toFixed(1)}%
                    </div>
                    <div className="text-[11px] font-mono tabular-nums mt-1" style={{ color: 'var(--text-secondary)' }}>
                      var: humidity · {effectiveNode2}
                    </div>
                  </div>
                </div>
              </div>

              {/* Split Row: Quick Action Panel (1.5s Anti-Spam Spinners) + Live Activity Feed */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* Quick Action Panel with Feature 4 (1.5s Anti-Spam Loading Spinners) */}
                <div className="lg:col-span-5 lci-surface rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div>
                    <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Quick Action Panel (1.5s Anti-Spam Lock)
                    </h2>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Dispatches HTTP POST commands to <code className="font-mono">http://192.168.10.2:1880/api/command</code> with 1.5s anti-spam lockout
                    </p>
                  </div>

                  <div className="space-y-3">
                    {/* 1. Emergency Door Unlock */}
                    <button
                      onClick={handleEmergencyDoorUnlock}
                      disabled={loadingButtons.emergency}
                      className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-between transition-all whitespace-nowrap shrink-0"
                      style={
                        loadingButtons.emergency
                          ? {
                              backgroundColor: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-muted)',
                              cursor: 'not-allowed',
                              opacity: 0.75,
                            }
                          : {
                              backgroundColor: 'var(--soft-coral-bg)',
                              border: '1px solid var(--soft-coral-border)',
                              color: 'var(--soft-coral)',
                            }
                      }
                    >
                      <span className="flex items-center gap-2.5">
                        {loadingButtons.emergency ? (
                          <span className="css-spinner" aria-hidden="true" />
                        ) : (
                          <DoorOpen className="w-4 h-4" />
                        )}
                        {loadingButtons.emergency
                          ? 'Dispatching Unlock Command...'
                          : 'Emergency Door Unlock'}
                      </span>
                      <span className="font-mono tabular-nums text-xs">
                        {loadingButtons.emergency ? '1.5s LOCK' : `POST → ${effectiveNode1}`}
                      </span>
                    </button>

                    {/* 2. Toggle HVAC Fan */}
                    <button
                      onClick={handleToggleHvacFan}
                      disabled={loadingButtons.fan}
                      className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-between transition-all whitespace-nowrap shrink-0"
                      style={
                        loadingButtons.fan
                          ? {
                              backgroundColor: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-muted)',
                              cursor: 'not-allowed',
                              opacity: 0.75,
                            }
                          : {
                              backgroundColor: 'var(--soft-blue-bg)',
                              border: '1px solid var(--soft-blue-border)',
                              color: 'var(--soft-blue)',
                            }
                      }
                    >
                      <span className="flex items-center gap-2.5">
                        {loadingButtons.fan ? (
                          <span className="css-spinner" aria-hidden="true" />
                        ) : (
                          <Fan className="w-4 h-4" />
                        )}
                        {loadingButtons.fan
                          ? 'Updating HVAC Relay...'
                          : `Toggle HVAC Fan (${fan_relay === 'ON' ? 'Switch OFF' : 'Switch ON'})`}
                      </span>
                      <span className="font-mono tabular-nums text-xs">
                        {loadingButtons.fan ? '1.5s LOCK' : `CURRENT: ${fan_relay}`}
                      </span>
                    </button>

                    {/* 3. Toggle Aux Light */}
                    <button
                      onClick={handleToggleAuxLight}
                      disabled={loadingButtons.light}
                      className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-between transition-all whitespace-nowrap shrink-0"
                      style={
                        loadingButtons.light
                          ? {
                              backgroundColor: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-muted)',
                              cursor: 'not-allowed',
                              opacity: 0.75,
                            }
                          : {
                              backgroundColor: 'var(--soft-mint-bg)',
                              border: '1px solid var(--soft-mint-border)',
                              color: 'var(--soft-mint)',
                            }
                      }
                    >
                      <span className="flex items-center gap-2.5">
                        {loadingButtons.light ? (
                          <span className="css-spinner" aria-hidden="true" />
                        ) : (
                          <Lightbulb className="w-4 h-4" />
                        )}
                        {loadingButtons.light
                          ? 'Switching Aux Light...'
                          : `Toggle Aux Light (${light_state === 'ON' ? 'Switch OFF' : 'Switch ON'})`}
                      </span>
                      <span className="font-mono tabular-nums text-xs">
                        {loadingButtons.light ? '1.5s LOCK' : `CURRENT: ${light_state}`}
                      </span>
                    </button>
                  </div>

                  <div
                    className="pt-3 flex items-center justify-between text-xs font-mono tabular-nums"
                    style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    <span>Solenoid: {mfa_status === 'UNLOCKED' ? 'ENERGIZED (OPEN)' : 'ENGAGED (LOCKED)'}</span>
                    <span>Smoke/Gas: {smoke_gas_level} PPM</span>
                  </div>
                </div>

                {/* Live Activity Feed (Last 5 System Events) */}
                <div className="lg:col-span-7 lci-surface rounded-xl p-6 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Live Activity Feed (Rolling 5-Event Ticker)
                      </h2>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        Real-time stream of access transitions, relay actuations, and camera triggers
                      </p>
                    </div>
                    <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--soft-blue)' }}>
                      MAX 5 EVENTS
                    </span>
                  </div>

                  <div className="flex-1 flex flex-col justify-center">
                    {activityFeed.slice(0, 5).map((item, idx) => (
                      <div
                        key={item.id}
                        className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-4 text-xs"
                        style={
                          idx > 0 ? { borderTop: '1px solid var(--border-subtle)' } : undefined
                        }
                      >
                        <div className="space-y-0.5">
                          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {item.message}
                          </div>
                          <div className="font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                            {item.category} · {item.status} · {item.timestamp}
                          </div>
                        </div>
                        <span
                          className="font-mono tabular-nums font-semibold shrink-0"
                          style={{
                            color:
                              item.status === 'ALERT'
                                ? 'var(--soft-coral)'
                                : item.status === 'WARNING'
                                ? 'var(--soft-amber)'
                                : 'var(--soft-mint)',
                          }}
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
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* Door & Lock Visualizer */}
                <div className="lg:col-span-5 lci-surface rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div>
                    <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Door &amp; Lock Hardware Visualizer
                    </h2>
                    <p className="text-xs font-mono tabular-nums mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      Access Node 1 ({effectiveNode1}) · Reed Switch &amp; 12V Fail-Secure Solenoid
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl lci-elevated space-y-2">
                      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span>Magnetic Reed</span>
                        {door_state === 'CLOSED' ? (
                          <DoorClosed className="w-4 h-4" style={{ color: 'var(--soft-mint)' }} />
                        ) : (
                          <DoorOpen className="w-4 h-4" style={{ color: 'var(--soft-coral)' }} />
                        )}
                      </div>
                      <div
                        className="text-xl font-bold font-mono tabular-nums"
                        style={{
                          color: door_state === 'CLOSED' ? 'var(--soft-mint)' : 'var(--soft-coral)',
                        }}
                      >
                        {door_state}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        Contact: {door_state === 'CLOSED' ? 'CLOSED LOOP' : 'OPEN CIRCUIT'}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl lci-elevated space-y-2">
                      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span>Solenoid Lock</span>
                        <KeyRound
                          className="w-4 h-4"
                          style={{
                            color: mfa_status === 'UNLOCKED' ? 'var(--soft-mint)' : 'var(--soft-blue)',
                          }}
                        />
                      </div>
                      <div
                        className="text-xl font-bold font-mono tabular-nums"
                        style={{
                          color: mfa_status === 'UNLOCKED' ? 'var(--soft-mint)' : 'var(--soft-blue)',
                        }}
                      >
                        {mfa_status === 'UNLOCKED' ? 'UNLOCKED' : 'LOCKED'}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
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
                        showToast(`Magnetic Reed Switch state: ${nextDoor}`, nextDoor === 'CLOSED' ? 'success' : 'error');
                      }}
                      className="flex-1 py-2.5 px-3 text-xs font-medium rounded-lg lci-elevated transition-colors whitespace-nowrap shrink-0"
                      style={{ color: 'var(--text-primary)' }}
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
                        showToast('Airlock re-locked and MFA reset to IDLE', 'info');
                      }}
                      className="py-2.5 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                      style={{
                        backgroundColor: 'var(--soft-blue-bg)',
                        color: 'var(--soft-blue)',
                        border: '1px solid var(--soft-blue-border)',
                      }}
                    >
                      Re-Lock Airlock
                    </button>
                  </div>
                </div>

                {/* 2-out-of-3 MFA Live Tracker */}
                <div className="lg:col-span-7 lci-surface rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                        2-out-of-3 Multi-Factor Authentication (MFA) Live Tracker
                      </h2>
                      <p className="text-xs font-mono tabular-nums mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        mfa_status: <strong style={{ color: 'var(--soft-blue)' }}>{mfa_status}</strong> · Checkpoints Passed:{' '}
                        {passedMfaCount}/3 (Requires ≥ 2 within 10s)
                      </p>
                    </div>

                    <div
                      className="px-4 py-2 rounded-lg font-mono tabular-nums text-xs font-semibold"
                      style={
                        mfa_status === 'AWAITING_STAGE2'
                          ? {
                              backgroundColor: 'var(--soft-amber-bg)',
                              border: '1px solid var(--soft-amber-border)',
                              color: 'var(--soft-amber)',
                            }
                          : mfa_status === 'UNLOCKED'
                          ? {
                              backgroundColor: 'var(--soft-mint-bg)',
                              border: '1px solid var(--soft-mint-border)',
                              color: 'var(--soft-mint)',
                            }
                          : {
                              backgroundColor: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-secondary)',
                            }
                      }
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
                    <div className="w-full h-2.5 lci-input rounded-full overflow-hidden">
                      <div
                        className="h-full transition-transform duration-150 origin-left"
                        style={{
                          width: '100%',
                          transform: `scaleX(${Math.min(1, passedMfaCount / 2)})`,
                          backgroundColor:
                            mfa_status === 'UNLOCKED'
                              ? 'var(--soft-mint-strong)'
                              : mfa_status === 'AWAITING_STAGE2'
                              ? 'var(--soft-blue-strong)'
                              : 'var(--text-muted)',
                        }}
                      />
                    </div>
                    <div
                      className="flex justify-between text-[11px] font-mono tabular-nums"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <span>0 Factors (IDLE)</span>
                      <span>1 Factor (AWAITING_STAGE2 · 10s Timer)</span>
                      <span>≥ 2 Factors (UNLOCKED)</span>
                    </div>
                  </div>

                  {/* 3 Checkpoints: isFacePassed, isCardPassed, isPinPassed */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <button
                      onClick={() => {
                        const next = !isFacePassed;
                        setIsFacePassed(next);
                        if (next) handleTriggerCameraCapture('FACE_VERIFIED');
                      }}
                      className="p-4 rounded-xl text-left transition-colors"
                      style={
                        isFacePassed
                          ? {
                              backgroundColor: 'var(--soft-mint-bg)',
                              border: '1px solid var(--soft-mint-border)',
                              color: 'var(--soft-mint)',
                            }
                          : {
                              backgroundColor: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                            }
                      }
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Fingerprint className="w-5 h-5" />
                        <span className="font-mono tabular-nums text-xs font-semibold">
                          {isFacePassed ? 'PASSED' : 'PENDING'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold">Biometric Face ID</div>
                      <div className="text-[11px] font-mono tabular-nums mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        isFacePassed: {String(isFacePassed)}
                      </div>
                    </button>

                    <button
                      onClick={() => setIsCardPassed((v) => !v)}
                      className="p-4 rounded-xl text-left transition-colors"
                      style={
                        isCardPassed
                          ? {
                              backgroundColor: 'var(--soft-mint-bg)',
                              border: '1px solid var(--soft-mint-border)',
                              color: 'var(--soft-mint)',
                            }
                          : {
                              backgroundColor: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                            }
                      }
                    >
                      <div className="flex items-center justify-between mb-2">
                        <CreditCard className="w-5 h-5" />
                        <span className="font-mono tabular-nums text-xs font-semibold">
                          {isCardPassed ? 'PASSED' : 'PENDING'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold">MIFARE RFID Card</div>
                      <div className="text-[11px] font-mono tabular-nums mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        isCardPassed: {String(isCardPassed)}
                      </div>
                    </button>

                    <button
                      onClick={() => setIsPinPassed((v) => !v)}
                      className="p-4 rounded-xl text-left transition-colors"
                      style={
                        isPinPassed
                          ? {
                              backgroundColor: 'var(--soft-mint-bg)',
                              border: '1px solid var(--soft-mint-border)',
                              color: 'var(--soft-mint)',
                            }
                          : {
                              backgroundColor: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                            }
                      }
                    >
                      <div className="flex items-center justify-between mb-2">
                        <KeyRound className="w-5 h-5" />
                        <span className="font-mono tabular-nums text-xs font-semibold">
                          {isPinPassed ? 'PASSED' : 'PENDING'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold">Matrix Keypad PIN</div>
                      <div className="text-[11px] font-mono tabular-nums mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        isPinPassed: {String(isPinPassed)}
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              {/* Biometric Camera Feed Box (<img> displaying latest JPEG frame from ip_node3) */}
              <div className="lci-surface rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <Camera className="w-5 h-5" style={{ color: 'var(--soft-blue)' }} />
                    <div>
                      <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Biometric Camera Feed (Node 3 Optical Capture)
                      </h2>
                      <p className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        Source Endpoint: http://{effectiveNode3}/capture · Triggered on PIR Motion / Face Verification
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTriggerCameraCapture('MOTION')}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg lci-elevated whitespace-nowrap shrink-0"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      Simulate Motion Frame
                    </button>
                    <button
                      onClick={() => handleTriggerCameraCapture('FACE_VERIFIED')}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
                      style={{
                        backgroundColor: 'var(--soft-mint-bg)',
                        color: 'var(--soft-mint)',
                        border: '1px solid var(--soft-mint-border)',
                      }}
                    >
                      Capture Verified Face
                    </button>
                    <button
                      onClick={() => handleTriggerCameraCapture('UNAUTHORIZED')}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
                      style={{
                        backgroundColor: 'var(--soft-coral-bg)',
                        color: 'var(--soft-coral)',
                        border: '1px solid var(--soft-coral-border)',
                      }}
                    >
                      Simulate Unknown Face
                    </button>
                  </div>
                </div>

                <div className="rounded-xl overflow-hidden bg-slate-950 relative" style={{ border: '1px solid var(--border-subtle)' }}>
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
              {/* 3 Circular Gauges with Soft UI Accents */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <CircularGauge
                  label="Ambient Temperature (temperature)"
                  value={temperature}
                  min={0}
                  max={50}
                  unit="°C"
                  warningThreshold={32}
                  dangerThreshold={40}
                  accentColor="var(--soft-blue-strong)"
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
                  accentColor="var(--soft-mint-strong)"
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
                  accentColor="var(--soft-mint-strong)"
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
                  color={theme === 'light' ? '#3b82f6' : '#60a5fa'}
                  dangerThreshold={38}
                  theme={theme}
                />
                <FifoLineChart
                  title="MQ-2 Smoke & Combustible Gas Stream"
                  variableName="smoke_gas_level"
                  labels={fifoHistory.labels}
                  data={fifoHistory.gases}
                  unit=" PPM"
                  minY={0}
                  maxY={700}
                  color={theme === 'light' ? '#10b981' : '#34d399'}
                  dangerThreshold={SMOKE_DANGER_THRESHOLD}
                  theme={theme}
                />
              </div>

              {/* Relay Panel: Auto/Manual toggle switches for Fan and Lighting */}
              <div className="lci-surface rounded-xl p-6">
                <div className="mb-4">
                  <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Environmental Relay Control Panel (Node 2 · {effectiveNode2})
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Configure Auto/Manual control loops and manual actuator states for <code className="font-mono">fan_relay</code> and{' '}
                    <code className="font-mono">light_state</code>
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* HVAC Fan Relay Control Card */}
                  <div className="p-4 rounded-xl lci-elevated flex flex-col justify-between gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Fan
                          className="w-5 h-5"
                          style={{ color: fan_relay === 'ON' ? 'var(--soft-mint)' : 'var(--soft-coral)' }}
                        />
                        <div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            HVAC Exhaust Fan Relay
                          </div>
                          <div className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                            Variable: fan_relay = "{fan_relay}"
                          </div>
                        </div>
                      </div>
                      <span
                        className="font-mono tabular-nums text-xs font-bold"
                        style={{ color: fan_relay === 'ON' ? 'var(--soft-mint)' : 'var(--soft-coral)' }}
                      >
                        {fan_relay}
                      </span>
                    </div>

                    <div
                      className="flex items-center justify-between pt-3 gap-3"
                      style={{ borderTop: '1px solid var(--border-subtle)' }}
                    >
                      <div className="flex items-center gap-1 p-1 rounded-lg lci-input">
                        <button
                          onClick={() => {
                            setFanControlMode('AUTO');
                            showToast('HVAC Fan set to AUTO (Thermal Setpoint)', 'info');
                          }}
                          className="px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
                          style={
                            fanControlMode === 'AUTO'
                              ? {
                                  backgroundColor: 'var(--soft-blue-bg)',
                                  color: 'var(--soft-blue)',
                                  border: '1px solid var(--soft-blue-border)',
                                }
                              : { color: 'var(--text-secondary)' }
                          }
                        >
                          Auto (Thermal)
                        </button>
                        <button
                          onClick={() => {
                            setFanControlMode('MANUAL');
                            showToast('HVAC Fan set to MANUAL Override', 'info');
                          }}
                          className="px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
                          style={
                            fanControlMode === 'MANUAL'
                              ? {
                                  backgroundColor: 'var(--soft-blue-bg)',
                                  color: 'var(--soft-blue)',
                                  border: '1px solid var(--soft-blue-border)',
                                }
                              : { color: 'var(--text-secondary)' }
                          }
                        >
                          Manual Override
                        </button>
                      </div>

                      <button
                        onClick={handleToggleHvacFan}
                        disabled={loadingButtons.fan}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg lci-surface flex items-center gap-2 transition-opacity whitespace-nowrap shrink-0"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {loadingButtons.fan && <span className="css-spinner" />}
                        {loadingButtons.fan ? '1.5s...' : `Switch ${fan_relay === 'ON' ? 'OFF' : 'ON'}`}
                      </button>
                    </div>
                  </div>

                  {/* Auxiliary Lighting Relay Control Card */}
                  <div className="p-4 rounded-xl lci-elevated flex flex-col justify-between gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Lightbulb
                          className="w-5 h-5"
                          style={{ color: light_state === 'ON' ? 'var(--soft-mint)' : 'var(--soft-coral)' }}
                        />
                        <div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            Corridor Auxiliary Lighting
                          </div>
                          <div className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                            Variable: light_state = "{light_state}"
                          </div>
                        </div>
                      </div>
                      <span
                        className="font-mono tabular-nums text-xs font-bold"
                        style={{ color: light_state === 'ON' ? 'var(--soft-mint)' : 'var(--soft-coral)' }}
                      >
                        {light_state}
                      </span>
                    </div>

                    <div
                      className="flex items-center justify-between pt-3 gap-3"
                      style={{ borderTop: '1px solid var(--border-subtle)' }}
                    >
                      <div className="flex items-center gap-1 p-1 rounded-lg lci-input">
                        <button
                          onClick={() => {
                            setLightControlMode('AUTO');
                            showToast('Aux Light set to AUTO (LDR Photocell)', 'info');
                          }}
                          className="px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
                          style={
                            lightControlMode === 'AUTO'
                              ? {
                                  backgroundColor: 'var(--soft-blue-bg)',
                                  color: 'var(--soft-blue)',
                                  border: '1px solid var(--soft-blue-border)',
                                }
                              : { color: 'var(--text-secondary)' }
                          }
                        >
                          Auto (LDR Photocell)
                        </button>
                        <button
                          onClick={() => {
                            setLightControlMode('MANUAL');
                            showToast('Aux Light set to MANUAL Override', 'info');
                          }}
                          className="px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
                          style={
                            lightControlMode === 'MANUAL'
                              ? {
                                  backgroundColor: 'var(--soft-blue-bg)',
                                  color: 'var(--soft-blue)',
                                  border: '1px solid var(--soft-blue-border)',
                                }
                              : { color: 'var(--text-secondary)' }
                          }
                        >
                          Manual Override
                        </button>
                      </div>

                      <button
                        onClick={handleToggleAuxLight}
                        disabled={loadingButtons.light}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg lci-surface flex items-center gap-2 transition-opacity whitespace-nowrap shrink-0"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {loadingButtons.light && <span className="css-spinner" />}
                        {loadingButtons.light ? '1.5s...' : `Switch ${light_state === 'ON' ? 'OFF' : 'ON'}`}
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
              <div className="lci-surface rounded-xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                      SQLite Audit Logs &amp; Historical Database Explorer
                    </h2>
                    <p className="text-xs font-mono tabular-nums mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      REST Endpoint: GET http://{CENTRAL_NODE_RED_HOST}/api/logs/{activeAuditTab}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        fetchHistoricalLogsFromNodeRed();
                        showToast(`Synced SQLite table "${activeAuditTab}" via REST GET`, 'info');
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                      style={{
                        backgroundColor: 'var(--soft-blue-bg)',
                        color: 'var(--soft-blue)',
                        border: '1px solid var(--soft-blue-border)',
                      }}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Sync SQLite via REST
                    </button>
                  </div>
                </div>

                {/* SQLite Table Tabs + Search Input */}
                <div
                  className="flex flex-wrap items-center justify-between gap-4 pt-3"
                  style={{ borderTop: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-1.5 p-1 rounded-lg lci-input">
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
                        className="px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
                        style={
                          activeAuditTab === tab.id
                            ? {
                                backgroundColor: 'var(--soft-blue-bg)',
                                color: 'var(--soft-blue)',
                                border: '1px solid var(--soft-blue-border)',
                              }
                            : { color: 'var(--text-secondary)' }
                        }
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-72">
                    <Search
                      className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
                      style={{ color: 'var(--text-secondary)' }}
                    />
                    <input
                      type="text"
                      value={auditSearchQuery}
                      onChange={(e) => {
                        setAuditSearchQuery(e.target.value);
                        setAuditPage(1);
                      }}
                      placeholder={`Filter ${activeAuditTab}...`}
                      className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg lci-input focus:outline-none"
                    />
                  </div>
                </div>

                {/* High-Density Data Table */}
                <div
                  className="overflow-x-auto rounded-xl lci-input"
                  style={{ border: '1px solid var(--border-subtle)' }}
                >
                  {activeAuditTab === 'access_logs' && (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr
                          className="lci-elevated"
                          style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                        >
                          <th className="py-3 px-4 font-semibold">ID</th>
                          <th className="py-3 px-4 font-semibold">Timestamp</th>
                          <th className="py-3 px-4 font-semibold">Personnel</th>
                          <th className="py-3 px-4 font-semibold">RFID UID</th>
                          <th className="py-3 px-4 font-semibold">MFA Checkpoints</th>
                          <th className="py-3 px-4 font-semibold">mfa_status</th>
                          <th className="py-3 px-4 font-semibold text-right">Node IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(paginatedAuditRows as AccessLogRecord[]).map((row) => (
                          <tr
                            key={row.id}
                            style={{ borderBottom: '1px solid var(--border-subtle)' }}
                          >
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              #{row.id}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {row.timestamp}
                            </td>
                            <td className="py-2.5 px-4 font-medium" style={{ color: 'var(--text-primary)' }}>
                              {row.user_name}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--soft-blue)' }}>
                              {row.card_uid}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {row.factors_used}
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono tabular-nums font-semibold"
                              style={{
                                color:
                                  row.mfa_status === 'UNLOCKED'
                                    ? 'var(--soft-mint)'
                                    : row.mfa_status === 'DENIED_TIMEOUT'
                                    ? 'var(--soft-coral)'
                                    : 'var(--soft-amber)',
                              }}
                            >
                              {row.mfa_status}
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono tabular-nums text-right"
                              style={{ color: 'var(--text-secondary)' }}
                            >
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
                        <tr
                          className="lci-elevated"
                          style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                        >
                          <th className="py-3 px-4 font-semibold">ID</th>
                          <th className="py-3 px-4 font-semibold">Timestamp</th>
                          <th className="py-3 px-4 font-semibold">Event Type</th>
                          <th className="py-3 px-4 font-semibold">Subject / Vector</th>
                          <th className="py-3 px-4 font-semibold text-right">Confidence</th>
                          <th className="py-3 px-4 font-semibold">Frame Archive Path</th>
                          <th className="py-3 px-4 font-semibold text-right">Node IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(paginatedAuditRows as CameraEventRecord[]).map((row) => (
                          <tr
                            key={row.id}
                            style={{ borderBottom: '1px solid var(--border-subtle)' }}
                          >
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              #{row.id}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {row.timestamp}
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono tabular-nums font-semibold"
                              style={{
                                color:
                                  row.event_type === 'FACE_MATCH'
                                    ? 'var(--soft-mint)'
                                    : row.event_type === 'UNKNOWN_FACE'
                                    ? 'var(--soft-coral)'
                                    : 'var(--soft-blue)',
                              }}
                            >
                              {row.event_type}
                            </td>
                            <td className="py-2.5 px-4 font-medium" style={{ color: 'var(--text-primary)' }}>
                              {row.subject_name}
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono tabular-nums text-right"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {row.confidence.toFixed(1)}%
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {row.frame_ref}
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono tabular-nums text-right"
                              style={{ color: 'var(--text-secondary)' }}
                            >
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
                        <tr
                          className="lci-elevated"
                          style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                        >
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
                      <tbody>
                        {(paginatedAuditRows as EnvironmentalTelemetryRecord[]).map((row) => (
                          <tr
                            key={row.id}
                            style={{ borderBottom: '1px solid var(--border-subtle)' }}
                          >
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              #{row.id}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {row.timestamp}
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono tabular-nums text-right"
                              style={{ color: 'var(--soft-blue)' }}
                            >
                              {row.temperature.toFixed(1)}°C
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono tabular-nums text-right"
                              style={{ color: 'var(--soft-blue)' }}
                            >
                              {row.humidity.toFixed(1)}%
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono tabular-nums text-right"
                              style={{ color: 'var(--soft-mint)' }}
                            >
                              {row.smoke_gas_level} PPM
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
                              {row.light_state}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
                              {row.fan_relay}
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono tabular-nums text-right"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              {row.node_ip}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Pagination Controls */}
                <div className="flex items-center justify-between text-xs pt-1" style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-mono tabular-nums">
                    Showing {paginatedAuditRows.length} of {filteredAuditRows.length} records in SQLite table{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{activeAuditTab}</strong>
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                      disabled={currentAuditPage <= 1}
                      className="p-1.5 rounded-lg lci-elevated disabled:opacity-40 transition-colors"
                      style={{ color: 'var(--text-primary)' }}
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
                      className="p-1.5 rounded-lg lci-elevated disabled:opacity-40 transition-colors"
                      style={{ color: 'var(--text-primary)' }}
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
              <div className="lci-surface rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Network Heartbeat Monitor (5-Second WebSocket Ping Interval)
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
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
                      showToast('Heartbeat ping completed across all 4 facility nodes', 'success');
                    }}
                    className="px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                    style={{
                      backgroundColor: 'var(--soft-blue-bg)',
                      color: 'var(--soft-blue)',
                      border: '1px solid var(--soft-blue-border)',
                    }}
                  >
                    Trigger Immediate Ping
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {heartbeats.map((node) => (
                    <div
                      key={node.id}
                      className="p-4 rounded-xl lci-elevated flex flex-col justify-between space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {node.name}
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                            {node.role}
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            setHeartbeats((prev) =>
                              prev.map((item) =>
                                item.id === node.id ? { ...item, online: !item.online } : item
                              )
                            )
                          }
                          className="font-mono tabular-nums text-xs font-semibold whitespace-nowrap shrink-0"
                          style={{
                            color: node.online ? 'var(--soft-mint)' : 'var(--soft-coral)',
                          }}
                        >
                          {node.online ? 'ONLINE' : 'OFFLINE'}
                        </button>
                      </div>

                      <div
                        className="pt-2 space-y-1 text-xs font-mono tabular-nums"
                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                      >
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Endpoint IP</span>
                          <span style={{ color: 'var(--soft-blue)' }}>{node.ip}</span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>WS RTT Latency</span>
                          <span style={{ color: 'var(--text-primary)' }}>
                            {node.online ? `${node.latencyMs} ms` : 'TIMEOUT'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Last Ping</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{node.lastPing}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* System Errors Table (system_errors) */}
              <div className="lci-surface rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                      System Diagnostic &amp; Fault Log (SQLite Table: system_errors)
                    </h2>
                    <p className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
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
                      showToast(`Logged diagnostic warning ERR_DHT22_BUS_CRC on ${effectiveNode2}`, 'error');
                    }}
                    className="px-3.5 py-1.5 text-xs font-medium rounded-lg lci-elevated whitespace-nowrap shrink-0"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Simulate Sensor Fault Entry
                  </button>
                </div>

                <div
                  className="overflow-x-auto rounded-xl lci-input"
                  style={{ border: '1px solid var(--border-subtle)' }}
                >
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr
                        className="lci-elevated"
                        style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        <th className="py-3 px-4 font-semibold">ID</th>
                        <th className="py-3 px-4 font-semibold">Timestamp</th>
                        <th className="py-3 px-4 font-semibold">Error Code</th>
                        <th className="py-3 px-4 font-semibold">Subsystem</th>
                        <th className="py-3 px-4 font-semibold">Diagnostic Message</th>
                        <th className="py-3 px-4 font-semibold text-right">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {system_errors.map((err) => (
                        <tr key={err.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                            #{err.id}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                            {err.timestamp}
                          </td>
                          <td
                            className="py-2.5 px-4 font-mono tabular-nums font-semibold"
                            style={{ color: 'var(--soft-coral)' }}
                          >
                            {err.error_code}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--soft-blue)' }}>
                            {err.subsystem}
                          </td>
                          <td className="py-2.5 px-4" style={{ color: 'var(--text-primary)' }}>
                            {err.message}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                            {err.resolved ? (
                              <span style={{ color: 'var(--soft-mint)' }}>RESOLVED</span>
                            ) : (
                              <button
                                onClick={() => {
                                  setSystemErrors((prev) =>
                                    prev.map((item) =>
                                      item.id === err.id ? { ...item, resolved: true } : item
                                    )
                                  );
                                  showToast(`Diagnostic #${err.id} marked as RESOLVED`, 'success');
                                }}
                                className="hover:underline whitespace-nowrap shrink-0"
                                style={{ color: 'var(--soft-amber)' }}
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
                <div className="lg:col-span-6 lci-surface rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <UserPlus className="w-5 h-5" style={{ color: 'var(--soft-blue)' }} />
                      <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                        User Biometric &amp; RFID Provisioning
                      </h2>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Registers operator credentials and dispatches JSON via HTTP POST to{' '}
                      <code className="font-mono">http://{CENTRAL_NODE_RED_HOST}/api/users</code>
                    </p>
                  </div>

                  <form onSubmit={handleProvisionUser} className="space-y-4 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="font-medium block" style={{ color: 'var(--text-secondary)' }}>
                          Full Name / Username
                        </label>
                        <input
                          type="text"
                          required
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="e.g. Eng. S. Mansour"
                          className="w-full px-3 py-2 rounded-lg lci-input focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="font-medium block" style={{ color: 'var(--text-secondary)' }}>
                          Facility Department
                        </label>
                        <input
                          type="text"
                          required
                          value={newDepartment}
                          onChange={(e) => setNewDepartment(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg lci-input focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="font-medium flex justify-between" style={{ color: 'var(--text-secondary)' }}>
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
                            className="hover:underline text-[11px]"
                            style={{ color: 'var(--soft-blue)' }}
                          >
                            Generate
                          </button>
                        </label>
                        <input
                          type="text"
                          required
                          value={newRfidUid}
                          onChange={(e) => setNewRfidUid(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                          style={{ color: 'var(--soft-blue)' }}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="font-medium flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                          <span>Face Template ID</span>
                          <button
                            type="button"
                            onClick={() =>
                              setNewFaceTemplate(`BIO_VEC_${Math.floor(1000 + Math.random() * 8999)}`)
                            }
                            className="hover:underline text-[11px]"
                            style={{ color: 'var(--soft-blue)' }}
                          >
                            Enroll Cam
                          </button>
                        </label>
                        <input
                          type="text"
                          required
                          value={newFaceTemplate}
                          onChange={(e) => setNewFaceTemplate(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                          style={{ color: 'var(--soft-mint)' }}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="font-medium block" style={{ color: 'var(--text-secondary)' }}>
                          Keypad Stage 2 PIN
                        </label>
                        <input
                          type="password"
                          maxLength={6}
                          required
                          value={newPinCode}
                          onChange={(e) => setNewPinCode(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 px-4 rounded-lg font-semibold text-xs transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
                      style={{
                        backgroundColor: 'var(--soft-blue-bg)',
                        color: 'var(--soft-blue)',
                        border: '1px solid var(--soft-blue-border)',
                      }}
                    >
                      Provision User &amp; Sync to Access Node ({effectiveNode1})
                    </button>
                  </form>
                </div>

                {/* Node Management Form (ip_node1, ip_node2, ip_node3 in localStorage) */}
                <div className="lg:col-span-6 lci-surface rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <Network className="w-5 h-5" style={{ color: 'var(--soft-mint)' }} />
                      <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Dynamic Node IP Configuration (localStorage)
                      </h2>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Updates <code className="font-mono">ip_node1</code>, <code className="font-mono">ip_node2</code>, and{' '}
                      <code className="font-mono">ip_node3</code> in browser <code className="font-mono">localStorage</code> and notifies Node-RED
                    </p>
                  </div>

                  <form onSubmit={handleSaveDynamicIps} className="space-y-4 text-xs">
                    <div className="space-y-1.5">
                      <label className="font-medium flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                        <span>Access &amp; Lock Node (ip_node1)</span>
                        <span className="font-mono">RFID, Keypad, Reed, Solenoid</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={modalIp1}
                        onChange={(e) => setModalIp1(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                        style={{ color: 'var(--soft-blue)' }}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-medium flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                        <span>Environmental Node (ip_node2)</span>
                        <span className="font-mono">DHT22, MQ-2, LDR, HVAC Relays</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={modalIp2}
                        onChange={(e) => setModalIp2(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                        style={{ color: 'var(--soft-blue)' }}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-medium flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                        <span>Face Recognition Node (ip_node3)</span>
                        <span className="font-mono">Optical JPEG Stream &amp; Biometrics</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={modalIp3}
                        onChange={(e) => setModalIp3(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                        style={{ color: 'var(--soft-blue)' }}
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 px-4 rounded-lg font-semibold text-xs transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
                      style={{
                        backgroundColor: 'var(--soft-mint-bg)',
                        color: 'var(--soft-mint)',
                        border: '1px solid var(--soft-mint-border)',
                      }}
                    >
                      Save Node IPs to localStorage &amp; Notify Node-RED
                    </button>
                  </form>
                </div>
              </div>

              {/* Provisioned Operators Directory */}
              <div className="lci-surface rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Provisioned Facility Personnel Registry ({provisionedUsers.length} Active)
                  </h3>
                  <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    Synced with {effectiveNode1} &amp; {effectiveNode3}
                  </span>
                </div>

                <div
                  className="overflow-x-auto rounded-xl lci-input"
                  style={{ border: '1px solid var(--border-subtle)' }}
                >
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr
                        className="lci-elevated"
                        style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        <th className="py-3 px-4 font-semibold">User ID</th>
                        <th className="py-3 px-4 font-semibold">Username</th>
                        <th className="py-3 px-4 font-semibold">Department</th>
                        <th className="py-3 px-4 font-semibold">RFID Card UID</th>
                        <th className="py-3 px-4 font-semibold">Face Template ID</th>
                        <th className="py-3 px-4 font-semibold text-right">Provisioned Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {provisionedUsers.map((u) => (
                        <tr key={u.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                            {u.id}
                          </td>
                          <td className="py-2.5 px-4 font-medium" style={{ color: 'var(--text-primary)' }}>
                            {u.username}
                          </td>
                          <td className="py-2.5 px-4" style={{ color: 'var(--text-secondary)' }}>
                            {u.department}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--soft-blue)' }}>
                            {u.rfid_uid}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--soft-mint)' }}>
                            {u.face_template_id}
                          </td>
                          <td
                            className="py-2.5 px-4 font-mono tabular-nums text-right"
                            style={{ color: 'var(--text-secondary)' }}
                          >
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
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md lci-surface rounded-xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                  LCI-SFM Dynamic Node IP Setup
                </h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Configure the 3 air-gapped subsystem IP addresses in <code className="font-mono">localStorage</code>:
                </p>
              </div>
              <button
                onClick={() => setShowStartupModal(false)}
                className="text-xs hover:underline"
                style={{ color: 'var(--text-secondary)' }}
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSaveDynamicIps} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-medium block" style={{ color: 'var(--text-secondary)' }}>
                  Access Node IP (<code className="font-mono">ip_node1</code>)
                </label>
                <input
                  type="text"
                  required
                  value={modalIp1}
                  onChange={(e) => setModalIp1(e.target.value)}
                  placeholder="192.168.10.11"
                  className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                  style={{ color: 'var(--soft-blue)' }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-medium block" style={{ color: 'var(--text-secondary)' }}>
                  Environment Node IP (<code className="font-mono">ip_node2</code>)
                </label>
                <input
                  type="text"
                  required
                  value={modalIp2}
                  onChange={(e) => setModalIp2(e.target.value)}
                  placeholder="192.168.10.12"
                  className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                  style={{ color: 'var(--soft-blue)' }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-medium block" style={{ color: 'var(--text-secondary)' }}>
                  Face Recognition Node IP (<code className="font-mono">ip_node3</code>)
                </label>
                <input
                  type="text"
                  required
                  value={modalIp3}
                  onChange={(e) => setModalIp3(e.target.value)}
                  placeholder="192.168.10.13"
                  className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                  style={{ color: 'var(--soft-blue)' }}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStartupModal(false)}
                  className="px-3.5 py-2 rounded-lg lci-elevated font-medium transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg font-semibold transition-opacity hover:opacity-90"
                  style={{
                    backgroundColor: 'var(--soft-blue-bg)',
                    color: 'var(--soft-blue)',
                    border: '1px solid var(--soft-blue-border)',
                  }}
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
