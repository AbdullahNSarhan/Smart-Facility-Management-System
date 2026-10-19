import React, { useState } from 'react';
import { Copy, Check, Download, X, Code2 } from 'lucide-react';

interface VanillaExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  ipNode1: string;
  ipNode2: string;
  ipNode3: string;
}

export const VanillaExportModal: React.FC<VanillaExportModalProps> = ({
  isOpen,
  onClose,
  ipNode1,
  ipNode2,
  ipNode3,
}) => {
  const [activeFile, setActiveFile] = useState<'html' | 'css' | 'js' | 'chart'>('js');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LCI-SFM Air-Gapped Command & Control Dashboard</title>
  <!-- 100% Local Air-Gapped Assets inside /public -->
  <link rel="stylesheet" href="/public/styles.css" />
</head>
<body>
  <aside class="sidebar">
    <div class="sidebar-brand">LCI-SFM Facility Control</div>
    <nav class="sidebar-nav">
      <button class="nav-btn active" data-view="view-1">01. Main Command Center</button>
      <button class="nav-btn" data-view="view-2">02. Smart Access & Biometrics</button>
      <button class="nav-btn" data-view="view-3">03. Environmental Monitoring</button>
      <button class="nav-btn" data-view="view-4">04. Audit Logs & DB Explorer</button>
      <button class="nav-btn" data-view="view-5">05. System Health & Diagnostics</button>
      <button class="nav-btn" data-view="view-6">06. System Management</button>
    </nav>
  </aside>

  <main class="main-shell">
    <!-- 6-Section Views populated by /public/app.js -->
    <div id="app-viewport"></div>
  </main>

  <script type="module" src="/public/chart.local.js"></script>
  <script type="module" src="/public/app.js"></script>
</body>
</html>`;

  const cssCode = `/* /public/styles.css — Air-Gapped LCI-SFM Dark Mode & Neon Glassmorphism */
:root {
  --bg-canvas: #070b14;
  --bg-surface: rgba(15, 23, 42, 0.78);
  --border-subtle: rgba(148, 163, 184, 0.14);
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --neon-green: #00f59b;
  --neon-red: #ff2e54;
  --cyber-blue: #00d2ff;
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

body {
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-family: var(--font-sans);
  margin: 0;
  display: flex;
}

.glass-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 20px;
  backdrop-filter: blur(16px);
}

.tabular-nums {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}`;

  const jsCode = `/**
 * /public/app.js — Modular ES6 Logic for Air-Gapped LCI-SFM Dashboard
 * Strict Node-RED Variable & SQLite Table Naming
 */
import { LocalFIFOChart } from './chart.local.js';

// 1. STRICT GLOBAL VARIABLES
export let temperature = 22.4;
export let humidity = 46.0;
export let smoke_gas_level = 118;
export let light_state = "ON";   // "ON" | "OFF"
export let door_state = "CLOSED"; // "OPEN" | "CLOSED"
export let fan_relay = "ON";     // "ON" | "OFF"

export let isFacePassed = false;
export let isCardPassed = false;
export let isPinPassed = false;
export let mfa_status = "IDLE";  // "IDLE" | "AWAITING_STAGE2" | "UNLOCKED"

export let access_logs = [];
export let environmental_telemetry = [];
export let camera_events = [];
export let system_errors = [];

// 2. DYNAMIC NODE IP CONFIGURATION (localStorage)
export let ip_node1 = localStorage.getItem('ip_node1') || '${ipNode1}';
export let ip_node2 = localStorage.getItem('ip_node2') || '${ipNode2}';
export let ip_node3 = localStorage.getItem('ip_node3') || '${ipNode3}';

// 3. WEBSOCKET CLIENTS (ws://192.168.10.2:1880/ws/telemetry & /ws/mfa)
export function initNodeRedWebSockets() {
  const wsTelemetry = new WebSocket('ws://192.168.10.2:1880/ws/telemetry');
  wsTelemetry.onmessage = (event) => {
    const data = JSON.parse(event.data);
    temperature = data.temperature ?? temperature;
    humidity = data.humidity ?? humidity;
    smoke_gas_level = data.smoke_gas_level ?? smoke_gas_level;
    light_state = data.light_state ?? light_state;
    door_state = data.door_state ?? door_state;
    fan_relay = data.fan_relay ?? fan_relay;
  };

  const wsMfa = new WebSocket('ws://192.168.10.2:1880/ws/mfa');
  wsMfa.onmessage = (event) => {
    const data = JSON.parse(event.data);
    isFacePassed = Boolean(data.isFacePassed);
    isCardPassed = Boolean(data.isCardPassed);
    isPinPassed = Boolean(data.isPinPassed);
    mfa_status = data.mfa_status || mfa_status;
  };
}

// 4. SQLITE HISTORICAL FETCH (http://192.168.10.2:1880/api/logs/...)
export async function syncSqliteTables() {
  const [acc, env, cam, err] = await Promise.all([
    fetch('http://192.168.10.2:1880/api/logs/access_logs').then(r => r.json()),
    fetch('http://192.168.10.2:1880/api/logs/environmental_telemetry').then(r => r.json()),
    fetch('http://192.168.10.2:1880/api/logs/camera_events').then(r => r.json()),
    fetch('http://192.168.10.2:1880/api/logs/system_errors').then(r => r.json())
  ]);
  access_logs = acc;
  environmental_telemetry = env;
  camera_events = cam;
  system_errors = err;
}`;

  const chartCode = `// /public/chart.local.js — Local 30-Point FIFO Queue Chart Engine
export class LocalFIFOChart {
  constructor(canvas, { maxPoints = 30, color = '#00D2FF' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.color = color;
    this.labels = [];
    this.data = [];
  }
  push(label, value) {
    if (this.data.length >= this.maxPoints) {
      this.labels.shift();
      this.data.shift();
    }
    this.labels.push(label);
    this.data.push(value);
  }
}`;

  const codeMap = {
    html: { filename: 'index.html', content: htmlCode },
    css: { filename: 'styles.css', content: cssCode },
    js: { filename: 'app.js', content: jsCode },
    chart: { filename: 'chart.local.js', content: chartCode },
  };

  const current = codeMap[activeFile];

  const handleCopy = () => {
    navigator.clipboard.writeText(current.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    const blob = new Blob([current.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = current.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">
              Air-Gapped Vanilla HTML5 / CSS3 / ES6 Source Files (/public/standalone/)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Close code inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between px-6 py-3 bg-slate-950/60 border-b border-slate-800">
          <div className="flex items-center gap-2">
            {(['js', 'html', 'css', 'chart'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveFile(tab)}
                className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeFile === tab
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                /public/standalone/{codeMap[tab].filename}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Code'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 hover:bg-cyan-500/25 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Download {current.filename}
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-slate-950 font-mono text-xs text-slate-300 leading-relaxed">
          <pre className="whitespace-pre-wrap">{current.content}</pre>
        </div>
      </div>
    </div>
  );
};
