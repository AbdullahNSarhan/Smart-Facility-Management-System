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
  // 1. LIGHT / DARK MODE TOGGLE (Persisted in localStorage)
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
  // 2. COLLAPSIBLE SIDEBAR (Persisted in localStorage)
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
  // 3. VANILLA TOAST NOTIFICATION STACK (3-Second Auto-Dismiss)
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
  // 4. ANTI-SPAM QUICK ACTION LOADING STATES (1.5s CSS Spinner)
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
  // 5. DYNAMIC IP CONFIGURATION STATE (localStorage: ip_node1, ip_node2, ip_node3)
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
  // 6. STRICT GLOBAL VARIABLES (Environment Telemetry, MFA Tracker & SQLite)
  // ==========================================================================
  const [temperature, setTemperature] = useState<number>(0);
  const [humidity, setHumidity] = useState<number>(0);
  const [smoke_gas_level, setSmokeGasLevel] = useState<number>(0);
  const [light_state, setLightState] = useState<LightState>('OFF');
  const [door_state, setDoorState] = useState<DoorState>('CLOSED');
  const [fan_relay, setFanRelay] = useState<FanRelayState>('OFF');

  const [isFacePassed, setIsFacePassed] = useState<boolean>(false);
  const [isCardPassed, setIsCardPassed] = useState<boolean>(false);
  const [isPinPassed, setIsPinPassed] = useState<boolean>(false);
  const [mfa_status, setMfaStatus] = useState<MfaStatus>('IDLE');
  const [mfaCountdown, setMfaCountdown] = useState<number>(10);

  const [fanControlMode, setFanControlMode] = useState<ControlMode>('AUTO');
  const [lightControlMode, setLightControlMode] = useState<ControlMode>('AUTO');

  const [access_logs, setAccessLogs] = useState<AccessLogRecord[]>([]);
  const [environmental_telemetry, setEnvironmentalTelemetry] = useState<EnvironmentalTelemetryRecord[]>([]);
  const [camera_events, setCameraEvents] = useState<CameraEventRecord[]>([]);
  const [system_errors, setSystemErrors] = useState<SystemErrorRecord[]>([]);

  // ==========================================================================
  // 7. UI NAVIGATION, CHARTS (30-PT FIFO) & PRODUCTION CONNECTION STATE
  // ==========================================================================
  const [activeView, setActiveView] = useState<ViewId>('view1');
  const [activityFeed, setActivityFeed] = useState<ActivityFeedItem[]>([]);
  const [fifoHistory, setFifoHistory] = useState<{
    labels: string[];
    temps: number[];
    hums: number[];
    gases: number[];
  }>({
    labels: [],
    temps: [],
    hums: [],
    gases: [],
  });
  const [wsOnline, setWsOnline] = useState<boolean>(false);
  const [cameraStreamFailed, setCameraStreamFailed] = useState<boolean>(false);
  const [cameraFrameKey, setCameraFrameKey] = useState<number>(() => Date.now());
  const [showVanillaModal, setShowVanillaModal] = useState<boolean>(false);

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
      online: false,
      latencyMs: 0,
      lastPing: '--:--:--',
      packetLoss: 100,
    },
    {
      id: 'node1',
      name: 'Node 1 · Access & Lock Controller',
      role: 'RFID Reader, Keypad, Reed & Solenoid',
      ip: effectiveNode1,
      online: false,
      latencyMs: 0,
      lastPing: '--:--:--',
      packetLoss: 100,
    },
    {
      id: 'node2',
      name: 'Node 2 · Environmental Telemetry',
      role: 'DHT22, MQ-2 Smoke/Gas, LDR & HVAC Relays',
      ip: effectiveNode2,
      online: false,
      latencyMs: 0,
      lastPing: '--:--:--',
      packetLoss: 100,
    },
    {
      id: 'node3',
      name: 'Node 3 · Biometric Vision Unit',
      role: 'Optical Camera Stream & Face Embedding Node',
      ip: effectiveNode3,
      online: false,
      latencyMs: 0,
      lastPing: '--:--:--',
      packetLoss: 100,
    },
  ]);

  // View 6 User Provisioning & Node Management Forms
  const [provisionedUsers, setProvisionedUsers] = useState<ProvisionedUser[]>([]);
  const [newUsername, setNewUsername] = useState<string>('');
  const [newDepartment, setNewDepartment] = useState<string>('Facility Engineering');
  const [newRfidUid, setNewRfidUid] = useState<string>('');
  const [newFaceTemplate, setNewFaceTemplate] = useState<string>('');
  const [newPinCode, setNewPinCode] = useState<string>('');

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

  // Sync strict global variables onto `window` for Node-RED contract compliance
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

  // ==========================================================================
  // 8. PRODUCTION WEBSOCKET & REST API CONNECTION (NO MOCK FALLBACKS)
  // ==========================================================================
  const fetchHistoricalLogsFromNodeRed = useCallback(async () => {
    const endpoints: { key: AuditTableTab | 'system_errors'; url: string }[] = [
      { key: 'access_logs', url: `http://${CENTRAL_NODE_RED_HOST}/api/logs/access_logs` },
      { key: 'environmental_telemetry', url: `http://${CENTRAL_NODE_RED_HOST}/api/logs/environmental_telemetry` },
      { key: 'camera_events', url: `http://${CENTRAL_NODE_RED_HOST}/api/logs/camera_events` },
      { key: 'system_errors', url: `http://${CENTRAL_NODE_RED_HOST}/api/logs/system_errors` },
    ];

    let anyFailed = false;
    for (const ep of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(ep.url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          if (ep.key === 'access_logs') setAccessLogs(data);
          if (ep.key === 'environmental_telemetry') setEnvironmentalTelemetry(data);
          if (ep.key === 'camera_events') setCameraEvents(data);
          if (ep.key === 'system_errors') setSystemErrors(data);
        }
      } catch {
        anyFailed = true;
      }
    }

    if (anyFailed) {
      showToast(`Node-RED SQLite REST API (${CENTRAL_NODE_RED_HOST}) unreachable — Offline`, 'error');
    } else {
      showToast('Synchronized SQLite tables from Node-RED REST API', 'success');
    }
  }, [showToast]);

  useEffect(() => {
    fetchHistoricalLogsFromNodeRed();

    let wsTelemetry: WebSocket | null = null;
    let wsMfa: WebSocket | null = null;

    try {
      wsTelemetry = new WebSocket(`ws://${CENTRAL_NODE_RED_HOST}/ws/telemetry`);
      wsTelemetry.onopen = () => {
        setWsOnline(true);
        const pingTs = formatNowTime();
        setHeartbeats((prev) =>
          prev.map((n) => ({ ...n, online: true, lastPing: pingTs, packetLoss: 0 }))
        );
        showToast('Connected to ws://192.168.10.2:1880/ws/telemetry', 'success');
      };
      wsTelemetry.onmessage = (evt) => {
        const payload = JSON.parse(evt.data);
        const ts = formatNowTime();
        setWsOnline(true);

        if (typeof payload.temperature === 'number') setTemperature(payload.temperature);
        if (typeof payload.humidity === 'number') setHumidity(payload.humidity);
        if (typeof payload.smoke_gas_level === 'number') setSmokeGasLevel(payload.smoke_gas_level);
        if (payload.light_state === 'ON' || payload.light_state === 'OFF') setLightState(payload.light_state);
        if (payload.door_state === 'OPEN' || payload.door_state === 'CLOSED') setDoorState(payload.door_state);
        if (payload.fan_relay === 'ON' || payload.fan_relay === 'OFF') setFanRelay(payload.fan_relay);

        setFifoHistory((prev) => ({
          labels: [...prev.labels.slice(-29), ts],
          temps: [...prev.temps.slice(-29), Number(payload.temperature ?? 0)],
          hums: [...prev.hums.slice(-29), Number(payload.humidity ?? 0)],
          gases: [...prev.gases.slice(-29), Number(payload.smoke_gas_level ?? 0)],
        }));

        pushActivity(
          'ENVIRONMENT',
          `Telemetry packet received: ${payload.temperature ?? '--'}°C, Gas ${payload.smoke_gas_level ?? '--'} PPM`,
          (payload.smoke_gas_level ?? 0) >= SMOKE_DANGER_THRESHOLD ? 'ALERT' : 'NOMINAL'
        );
      };
      wsTelemetry.onerror = () => {
        setWsOnline(false);
        setHeartbeats((prev) => prev.map((n) => ({ ...n, online: false })));
        showToast('WebSocket connection failed: ws://192.168.10.2:1880/ws/telemetry is offline', 'error');
      };
      wsTelemetry.onclose = () => {
        setWsOnline(false);
        setHeartbeats((prev) => prev.map((n) => ({ ...n, online: false })));
      };
    } catch {
      setWsOnline(false);
      showToast('WebSocket unreachable (ws://192.168.10.2:1880/ws/telemetry)', 'error');
    }

    try {
      wsMfa = new WebSocket(`ws://${CENTRAL_NODE_RED_HOST}/ws/mfa`);
      wsMfa.onmessage = (evt) => {
        const payload = JSON.parse(evt.data);
        if (typeof payload.isFacePassed === 'boolean') setIsFacePassed(payload.isFacePassed);
        if (typeof payload.isCardPassed === 'boolean') setIsCardPassed(payload.isCardPassed);
        if (typeof payload.isPinPassed === 'boolean') setIsPinPassed(payload.isPinPassed);
        if (payload.mfa_status) setMfaStatus(payload.mfa_status);
        if (payload.isFacePassed) {
          setCameraStreamFailed(false);
          setCameraFrameKey(Date.now());
        }
      };
      wsMfa.onerror = () => {
        showToast('MFA WebSocket offline (ws://192.168.10.2:1880/ws/mfa)', 'error');
      };
    } catch {
      // Handled by telemetry toast
    }

    return () => {
      if (wsTelemetry) wsTelemetry.close();
      if (wsMfa) wsMfa.close();
    };
  }, [fetchHistoricalLogsFromNodeRed, pushActivity, showToast]);

  // 5-second Heartbeat IP sync
  useEffect(() => {
    setHeartbeats((prev) =>
      prev.map((node) => ({
        ...node,
        ip:
          node.id === 'node1'
            ? effectiveNode1
            : node.id === 'node2'
            ? effectiveNode2
            : node.id === 'node3'
            ? effectiveNode3
            : CENTRAL_NODE_RED_HOST,
      }))
    );
  }, [effectiveNode1, effectiveNode2, effectiveNode3]);

  // ==========================================================================
  // 9. 2-OUT-OF-3 MFA LIVE TRACKER & 10-SECOND COUNTDOWN LOGIC
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
            setIsFacePassed(false);
            setIsCardPassed(false);
            setIsPinPassed(false);
            setMfaStatus('IDLE');
            showToast('Stage 2 MFA 10s window expired — Solenoid remained LOCKED', 'error');
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
    }

    return () => {
      if (mfaTimerRef.current && passedFactors.length !== 1) {
        window.clearInterval(mfaTimerRef.current);
        mfaTimerRef.current = null;
      }
    };
  }, [isFacePassed, isCardPassed, isPinPassed, showToast]);

  // ==========================================================================
  // 10. DIRECT SERVER COMMAND HANDLERS (1.5s Anti-Spam + Live HTTP POST)
  // ==========================================================================
  const handleEmergencyDoorUnlock = () => {
    if (loadingButtons.emergency) return;
    setLoadingButtons((prev) => ({ ...prev, emergency: true }));

    window.setTimeout(async () => {
      try {
        const res = await fetch(`http://${CENTRAL_NODE_RED_HOST}/api/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'EMERGENCY_DOOR_UNLOCK',
            target_ip: effectiveNode1,
            door_state: 'OPEN',
            timestamp: formatNowTimestamp(),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setDoorState('OPEN');
        setMfaStatus('UNLOCKED');
        pushActivity('ACCESS', `Emergency Door Unlock executed on Node 1 (${effectiveNode1})`, 'ALERT');
        showToast(`Emergency Door Unlock executed on Node 1 (${effectiveNode1})`, 'success');
      } catch {
        showToast(`Command failed: Node-RED (${CENTRAL_NODE_RED_HOST}) is offline`, 'error');
      } finally {
        setLoadingButtons((prev) => ({ ...prev, emergency: false }));
      }
    }, 1500);
  };

  const handleToggleHvacFan = () => {
    if (loadingButtons.fan) return;
    setLoadingButtons((prev) => ({ ...prev, fan: true }));

    window.setTimeout(async () => {
      const nextState: FanRelayState = fan_relay === 'ON' ? 'OFF' : 'ON';
      try {
        const res = await fetch(`http://${CENTRAL_NODE_RED_HOST}/api/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'TOGGLE_HVAC_FAN',
            target_ip: effectiveNode2,
            fan_relay: nextState,
            timestamp: formatNowTimestamp(),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setFanRelay(nextState);
        pushActivity('ENVIRONMENT', `HVAC Fan Relay switched ${nextState} on Node 2`, 'NOMINAL');
        showToast(`HVAC Fan Relay switched ${nextState}`, 'success');
      } catch {
        showToast(`HVAC Fan command failed: Node-RED (${CENTRAL_NODE_RED_HOST}) is offline`, 'error');
      } finally {
        setLoadingButtons((prev) => ({ ...prev, fan: false }));
      }
    }, 1500);
  };

  const handleToggleAuxLight = () => {
    if (loadingButtons.light) return;
    setLoadingButtons((prev) => ({ ...prev, light: true }));

    window.setTimeout(async () => {
      const nextState: LightState = light_state === 'ON' ? 'OFF' : 'ON';
      try {
        const res = await fetch(`http://${CENTRAL_NODE_RED_HOST}/api/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'TOGGLE_AUX_LIGHT',
            target_ip: effectiveNode2,
            light_state: nextState,
            timestamp: formatNowTimestamp(),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setLightState(nextState);
        pushActivity('ENVIRONMENT', `Auxiliary Light switched ${nextState} on Node 2`, 'NOMINAL');
        showToast(`Auxiliary Light switched ${nextState}`, 'success');
      } catch {
        showToast(`Aux Light command failed: Node-RED (${CENTRAL_NODE_RED_HOST}) is offline`, 'error');
      } finally {
        setLoadingButtons((prev) => ({ ...prev, light: false }));
      }
    }, 1500);
  };

  const handleSaveDynamicIps = async (e: React.FormEvent) => {
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

    try {
      const res = await fetch(`http://${CENTRAL_NODE_RED_HOST}/api/config/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip_node1: clean1, ip_node2: clean2, ip_node3: clean3 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`Saved Node IPs (${clean1}, ${clean2}, ${clean3}) & notified Node-RED`, 'success');
    } catch {
      showToast(`Saved Node IPs to localStorage (Node-RED ${CENTRAL_NODE_RED_HOST} unreachable)`, 'info');
    }
  };

  const handleProvisionUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;

    const payload = {
      username: newUsername.trim(),
      department: newDepartment.trim(),
      rfid_uid: newRfidUid.trim().toUpperCase(),
      face_template_id: newFaceTemplate.trim().toUpperCase(),
      pin_hash: newPinCode,
      target_access_node: effectiveNode1,
      target_face_node: effectiveNode3,
    };

    try {
      const res = await fetch(`http://${CENTRAL_NODE_RED_HOST}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created: ProvisionedUser = {
        id: `USR-${Date.now().toString().slice(-4)}`,
        username: payload.username,
        department: payload.department,
        rfid_uid: payload.rfid_uid,
        face_template_id: payload.face_template_id,
        pin_configured: Boolean(newPinCode),
        created_at: formatNowTimestamp().split(' ')[0],
      };
      setProvisionedUsers((prev) => [created, ...prev]);
      setNewUsername('');
      setNewRfidUid('');
      setNewFaceTemplate('');
      setNewPinCode('');
      showToast(`Operator "${created.username}" provisioned on Node-RED`, 'success');
    } catch {
      showToast(`User provisioning failed: Node-RED (${CENTRAL_NODE_RED_HOST}) is offline`, 'error');
    }
  };

  const isEmergencyAlert =
    smoke_gas_level >= SMOKE_DANGER_THRESHOLD ||
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
          VANILLA TOAST NOTIFICATION STACK (Top-Right, 3s Auto-Dismiss)
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
          <button
            onClick={() => {
              const next = theme === 'dark' ? 'light' : 'dark';
              setTheme(next);
              showToast(`Switched to ${next === 'dark' ? 'Dark' : 'Light'} Mode`, 'info');
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
                <span>Node-RED WS</span>
                <span
                  className="font-mono tabular-nums font-semibold"
                  style={{ color: wsOnline ? 'var(--soft-mint)' : 'var(--soft-coral)' }}
                >
                  {wsOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
            </div>
          </div>

          <div
            className="pt-4 space-y-2 w-56"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <button
              onClick={() => setShowVanillaModal(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg lci-elevated transition-colors whitespace-nowrap shrink-0"
              style={{ color: 'var(--text-primary)' }}
            >
              Inspect Production Files
            </button>
          </div>
        </aside>

        {/* Main Expanding Content Viewport */}
        <main className="flex-1 min-w-0 p-6 lg:p-8 space-y-6 max-w-[1440px] mx-auto w-full transition-all duration-200">
          {/* Workspace Sub-Toolbar: Collapsible Sidebar Toggle + Connection Status */}
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
                Node-RED Bus: {CENTRAL_NODE_RED_HOST} · Status:{' '}
                <strong style={{ color: wsOnline ? 'var(--soft-mint)' : 'var(--soft-coral)' }}>
                  {wsOnline ? 'ONLINE' : 'OFFLINE'}
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowVanillaModal(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
                style={{
                  backgroundColor: 'var(--soft-blue-bg)',
                  color: 'var(--soft-blue)',
                  border: '1px solid var(--soft-blue-border)',
                }}
              >
                View Production HTML / CSS / JS
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
                  <code className="font-mono">localStorage</code>. Configure or confirm the facility node addresses.
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
                  Save Node IPs
                </button>
              </div>
            </div>
          )}

          {/* ================================================================
              VIEW 1: MAIN COMMAND CENTER (EXECUTIVE OVERVIEW)
              ================================================================ */}
          {activeView === 'view1' && (
            <section className="space-y-6" aria-label="Main Command Center">
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
                      Node-RED Central Bus: {CENTRAL_NODE_RED_HOST} ({wsOnline ? 'ONLINE' : 'OFFLINE'}) · Smoke/Gas:{' '}
                      {smoke_gas_level} PPM · MFA State: {mfa_status}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    Nodes Online: {wsOnline ? '4/4' : '0/4'}
                  </span>
                </div>
              </div>

              {/* Quick Telemetry Snapshot: 5 Soft UI Mini-Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
                <div className="lg:col-span-5 lci-surface rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div>
                    <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Quick Action Panel (1.5s Anti-Spam Lock)
                    </h2>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Dispatches live HTTP POST commands to <code className="font-mono">http://192.168.10.2:1880/api/command</code>
                    </p>
                  </div>

                  <div className="space-y-3">
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
                        Real-time stream of incoming WebSocket events from Node-RED
                      </p>
                    </div>
                    <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--soft-blue)' }}>
                      MAX 5 EVENTS
                    </span>
                  </div>

                  <div className="flex-1 flex flex-col justify-center">
                    {activityFeed.length === 0 ? (
                      <div className="text-xs font-mono tabular-nums py-8 text-center" style={{ color: 'var(--text-secondary)' }}>
                        Awaiting live events from ws://{CENTRAL_NODE_RED_HOST}/ws/telemetry &amp; /ws/mfa...
                      </div>
                    ) : (
                      activityFeed.slice(0, 5).map((item, idx) => (
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
                      ))
                    )}
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
                        {passedMfaCount}/3 (ws://{CENTRAL_NODE_RED_HOST}/ws/mfa)
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

                  {/* 3 Live Readout Checkpoints: isFacePassed, isCardPassed, isPinPassed */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div
                      className="p-4 rounded-xl text-left"
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
                    </div>

                    <div
                      className="p-4 rounded-xl text-left"
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
                    </div>

                    <div
                      className="p-4 rounded-xl text-left"
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
                    </div>
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
                        Live Endpoint: http://{effectiveNode3}/capture
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setCameraStreamFailed(false);
                      setCameraFrameKey(Date.now());
                    }}
                    className="px-3.5 py-1.5 text-xs font-medium rounded-lg lci-elevated whitespace-nowrap shrink-0"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Refresh Camera Frame
                  </button>
                </div>

                <div
                  className="rounded-xl overflow-hidden lci-input min-h-[240px] flex items-center justify-center p-4"
                  style={{ border: '1px solid var(--border-subtle)' }}
                >
                  {!cameraStreamFailed ? (
                    <img
                      id="biometric-camera-feed"
                      src={`http://${effectiveNode3}/capture?ts=${cameraFrameKey}`}
                      alt={`Biometric JPEG capture from Face Recognition Node ${effectiveNode3}`}
                      referrerPolicy="no-referrer"
                      onError={() => {
                        setCameraStreamFailed(true);
                        showToast(`Biometric Node 3 (http://${effectiveNode3}/capture) offline`, 'error');
                      }}
                      className="w-full max-h-[420px] object-contain mx-auto block"
                    />
                  ) : (
                    <div className="text-center space-y-2 py-10">
                      <Camera className="w-8 h-8 mx-auto" style={{ color: 'var(--soft-coral)' }} />
                      <div className="text-sm font-semibold font-mono tabular-nums" style={{ color: 'var(--soft-coral)' }}>
                        CAMERA NODE OFFLINE (http://{effectiveNode3}/capture)
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        Awaiting live JPEG frame from Face Recognition Node 3 upon motion detection.
                      </p>
                    </div>
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

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FifoLineChart
                  title="Thermal Telemetry Stream (0–50°C)"
                  variableName="temperature"
                  labels={fifoHistory.labels}
                  data={fifoHistory.temps}
                  unit="°C"
                  minY={0}
                  maxY={50}
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
                  maxY={1000}
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

                  <button
                    onClick={fetchHistoricalLogsFromNodeRed}
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
                        <th className="py-3 px-4 font-semibold">Details / Subject</th>
                        <th className="py-3 px-4 font-semibold">Status / Metrics</th>
                        <th className="py-3 px-4 font-semibold text-right">Node IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedAuditRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 px-4 text-center font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                            No records received from http://{CENTRAL_NODE_RED_HOST}/api/logs/{activeAuditTab}
                          </td>
                        </tr>
                      ) : (
                        paginatedAuditRows.map((row: any) => (
                          <tr key={row.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              #{row.id}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {row.timestamp}
                            </td>
                            <td className="py-2.5 px-4 font-medium" style={{ color: 'var(--text-primary)' }}>
                              {row.user_name || row.subject_name || `${row.temperature}°C / ${row.humidity}%`}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums" style={{ color: 'var(--soft-blue)' }}>
                              {row.mfa_status || row.event_type || `Gas: ${row.smoke_gas_level} PPM`}
                            </td>
                            <td className="py-2.5 px-4 font-mono tabular-nums text-right" style={{ color: 'var(--text-secondary)' }}>
                              {row.node_ip}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

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
                <div>
                  <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Network Heartbeat Monitor (5-Second WebSocket Ping Interval)
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Live reachability status for Central Node-RED Server and the 3 Field Subsystem Nodes
                  </p>
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
                        <span
                          className="font-mono tabular-nums text-xs font-semibold whitespace-nowrap shrink-0"
                          style={{
                            color: node.online ? 'var(--soft-mint)' : 'var(--soft-coral)',
                          }}
                        >
                          {node.online ? 'ONLINE' : 'OFFLINE'}
                        </span>
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
                          <span style={{ color: 'var(--text-secondary)' }}>Last Ping</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{node.lastPing}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lci-surface rounded-xl p-6 space-y-4">
                <div>
                  <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    System Diagnostic &amp; Fault Log (SQLite Table: system_errors)
                  </h2>
                  <p className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    GET http://{CENTRAL_NODE_RED_HOST}/api/logs/system_errors
                  </p>
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
                      </tr>
                    </thead>
                    <tbody>
                      {system_errors.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 px-4 text-center font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                            No system errors reported from http://{CENTRAL_NODE_RED_HOST}/api/logs/system_errors
                          </td>
                        </tr>
                      ) : (
                        system_errors.map((err) => (
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
                          </tr>
                        ))
                      )}
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
                <div className="lg:col-span-6 lci-surface rounded-xl p-6 flex flex-col justify-between space-y-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <UserPlus className="w-5 h-5" style={{ color: 'var(--soft-blue)' }} />
                      <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                        User Biometric &amp; RFID Provisioning
                      </h2>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Dispatches operator credentials via HTTP POST to{' '}
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
                        <label className="font-medium block" style={{ color: 'var(--text-secondary)' }}>
                          RFID Card UID
                        </label>
                        <input
                          type="text"
                          required
                          value={newRfidUid}
                          onChange={(e) => setNewRfidUid(e.target.value)}
                          placeholder="04:A2:9F:3B"
                          className="w-full px-3 py-2 rounded-lg lci-input font-mono tabular-nums focus:outline-none"
                          style={{ color: 'var(--soft-blue)' }}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="font-medium block" style={{ color: 'var(--text-secondary)' }}>
                          Face Template ID
                        </label>
                        <input
                          type="text"
                          required
                          value={newFaceTemplate}
                          onChange={(e) => setNewFaceTemplate(e.target.value)}
                          placeholder="BIO_VEC_8821"
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
                          placeholder="••••"
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

              {provisionedUsers.length > 0 && (
                <div className="lci-surface rounded-xl p-6 space-y-4">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Provisioned Facility Personnel ({provisionedUsers.length})
                  </h3>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
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
