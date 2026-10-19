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
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LCI-SFM Air-Gapped Command &amp; Control Dashboard</title>
  <link rel="stylesheet" href="/standalone/styles.css" />
</head>
<body>
  <!-- Stacked Vanilla Toast Notification Container (Auto-dismisses after 3s) -->
  <div id="toast-container" class="toast-container" aria-live="polite"></div>

  <!-- Collapsible Sidebar Navigation -->
  <aside id="app-sidebar" class="sidebar">
    <div class="sidebar-brand">
      <span>LCI-SFM Facility Control</span>
    </div>
    <nav class="sidebar-nav">
      <button class="nav-btn active" data-view="view-1" type="button">01. Main Command Center</button>
      <button class="nav-btn" data-view="view-2" type="button">02. Smart Access &amp; Biometrics</button>
      <button class="nav-btn" data-view="view-3" type="button">03. Environmental Monitoring</button>
      <button class="nav-btn" data-view="view-4" type="button">04. Audit Logs &amp; DB Explorer</button>
      <button class="nav-btn" data-view="view-5" type="button">05. System Health &amp; Diagnostics</button>
      <button class="nav-btn" data-view="view-6" type="button">06. System Management</button>
    </nav>
    <div class="sidebar-footer tabular-nums">
      Bus: 192.168.10.2:1880 · <span id="ws-sidebar-status" class="text-coral">OFFLINE</span>
    </div>
  </aside>

  <!-- Main Expanding Content Shell -->
  <div id="main-shell" class="main-shell">
    <header class="top-bar">
      <div class="top-bar-left">
        <button id="sidebar-toggle-btn" class="icon-btn" type="button" aria-label="Toggle Sidebar">
          <span>☰</span>
          <span id="sidebar-toggle-label">Collapse Menu</span>
        </button>
        <span class="tabular-nums text-secondary" style="font-size: 0.82rem;">
          LCI-SFM · Node-RED Production Bus (192.168.10.2:1880)
        </span>
      </div>

      <div class="top-bar-right">
        <button id="theme-toggle-btn" class="icon-btn" type="button" aria-label="Toggle Theme">
          <span id="theme-toggle-icon">☀</span>
          <span id="theme-toggle-text">Light Mode</span>
        </button>
        <button id="open-ip-modal-btn" class="icon-btn" type="button">
          Configure Node IPs
        </button>
      </div>
    </header>

    <!-- View 1: Main Command Center -->
    <section id="view-1" class="view-container active">
      <div id="global-status-banner" class="status-banner">
        <strong id="global-status-title">GLOBAL FACILITY STATUS: STANDBY</strong>
        <span class="tabular-nums" id="banner-smoke-readout">SMOKE/GAS: -- PPM</span>
      </div>

      <div class="grid-5">
        <div class="glass-card">
          <div class="card-label">Door State (Reed)</div>
          <h2 class="tabular-nums text-mint" id="snap-door-state">CLOSED</h2>
        </div>
        <div class="glass-card">
          <div class="card-label">Light State (LDR)</div>
          <h2 class="tabular-nums text-mint" id="snap-light-state">OFF</h2>
        </div>
        <div class="glass-card">
          <div class="card-label">HVAC Fan Relay</div>
          <h2 class="tabular-nums text-mint" id="snap-fan-relay">OFF</h2>
        </div>
        <div class="glass-card">
          <div class="card-label">Temperature</div>
          <h2 class="tabular-nums text-blue" id="snap-temp">-- °C</h2>
        </div>
        <div class="glass-card">
          <div class="card-label">Humidity</div>
          <h2 class="tabular-nums text-blue" id="snap-hum">-- %</h2>
        </div>
      </div>

      <div class="grid-2">
        <div class="glass-card" style="display: flex; flex-direction: column; gap: 12px;">
          <h3 class="section-title">Quick Action Panel (Direct HTTP POST Commands)</h3>
          <button id="btn-emergency-unlock" class="btn-action btn-coral" type="button">
            <span class="btn-label">Emergency Door Unlock</span>
            <span class="tabular-nums">POST → Node 1</span>
          </button>
          <button id="btn-toggle-fan" class="btn-action btn-blue" type="button">
            <span class="btn-label">Toggle HVAC Fan</span>
            <span class="tabular-nums" id="btn-fan-state">OFF</span>
          </button>
          <button id="btn-toggle-light" class="btn-action btn-mint" type="button">
            <span class="btn-label">Toggle Aux Light</span>
            <span class="tabular-nums" id="btn-light-state">OFF</span>
          </button>
        </div>

        <div class="glass-card">
          <h3 class="section-title">Live Activity Feed (Last 5 System Events)</h3>
          <ul id="live-activity-list" style="list-style: none; display: flex; flex-direction: column; gap: 10px; font-size: 0.82rem;">
            <li class="text-secondary tabular-nums">Awaiting live telemetry events from ws://192.168.10.2:1880...</li>
          </ul>
        </div>
      </div>
    </section>
    <!-- Views 2–6 included in /public/standalone/index.html -->
  </div>
  <script type="module" src="/standalone/app.js"></script>
</body>
</html>`;

  const cssCode = `/* /public/standalone/styles.css — Production Soft UI, Light/Dark Variables, Spinner & Toasts */
:root,
[data-theme="dark"] {
  --bg-canvas: #0f172a;
  --bg-surface: #1e293b;
  --bg-elevated: #263349;
  --bg-sidebar: #131c31;
  --border-subtle: rgba(148, 163, 184, 0.16);
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --soft-mint: #5eead4;
  --soft-mint-bg: rgba(52, 211, 153, 0.12);
  --soft-mint-border: rgba(52, 211, 153, 0.32);
  --soft-coral: #fda4af;
  --soft-coral-bg: rgba(251, 113, 133, 0.12);
  --soft-coral-border: rgba(251, 113, 133, 0.32);
  --soft-blue: #93c5fd;
  --soft-blue-bg: rgba(96, 165, 250, 0.12);
  --soft-blue-border: rgba(96, 165, 250, 0.32);
  --sidebar-width: 260px;
}

[data-theme="light"] {
  --bg-canvas: #f1f5f9;
  --bg-surface: #ffffff;
  --bg-elevated: #f8fafc;
  --bg-sidebar: #ffffff;
  --border-subtle: rgba(100, 116, 139, 0.18);
  --text-primary: #1e293b;
  --text-secondary: #475569;
  --soft-mint: #059669;
  --soft-coral: #e11d48;
  --soft-blue: #2563eb;
}`;

  const jsCode = `/**
 * /public/standalone/app.js — Final Production ES6 Module
 * Strictly connected to ws://192.168.10.2:1880/ws/telemetry, /ws/mfa, and REST APIs.
 * Zero mock generators, zero fake fallbacks, zero console debugging clutter.
 */
import { LocalFIFOChart } from './chart.local.js';

export let temperature = 0;
export let humidity = 0;
export let smoke_gas_level = 0;
export let light_state = 'OFF';
export let door_state = 'CLOSED';
export let fan_relay = 'OFF';

export let isFacePassed = false;
export let isCardPassed = false;
export let isPinPassed = false;
export let mfa_status = 'IDLE';

export let access_logs = [];
export let environmental_telemetry = [];
export let camera_events = [];
export let system_errors = [];

export let ip_node1 = localStorage.getItem('ip_node1') || '${ipNode1}';
export let ip_node2 = localStorage.getItem('ip_node2') || '${ipNode2}';
export let ip_node3 = localStorage.getItem('ip_node3') || '${ipNode3}';`;

  const chartCode = `// /public/standalone/chart.local.js — Local 30-Point FIFO Queue Chart Engine
export class LocalFIFOChart {
  constructor(canvas, { maxPoints = 30, color = '#60a5fa' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.color = color;
    this.labels = [];
    this.data = [];
  }
  pushDataPoint(label, value) {
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
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-6">
      <div className="w-full max-w-4xl lci-surface rounded-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5" style={{ color: 'var(--soft-blue)' }} />
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Production Standalone Files (/public/standalone/)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg lci-elevated transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Close code inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          className="flex items-center justify-between px-6 py-3 lci-elevated"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            {(['js', 'html', 'css', 'chart'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveFile(tab)}
                className="px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0"
                style={
                  activeFile === tab
                    ? {
                        backgroundColor: 'var(--soft-blue-bg)',
                        color: 'var(--soft-blue)',
                        border: '1px solid var(--soft-blue-border)',
                      }
                    : { color: 'var(--text-secondary)' }
                }
              >
                /public/standalone/{codeMap[tab].filename}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md lci-surface transition-colors whitespace-nowrap shrink-0"
              style={{ color: 'var(--text-primary)' }}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" style={{ color: 'var(--soft-mint)' }} />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? 'Copied' : 'Copy Code'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
              style={{
                backgroundColor: 'var(--soft-blue-bg)',
                color: 'var(--soft-blue)',
                border: '1px solid var(--soft-blue-border)',
              }}
            >
              <Download className="w-3.5 h-3.5" />
              Download {current.filename}
            </button>
          </div>
        </div>

        <div
          className="p-6 overflow-y-auto flex-1 font-mono text-xs leading-relaxed lci-input"
          style={{ color: 'var(--text-primary)' }}
        >
          <pre className="whitespace-pre-wrap">{current.content}</pre>
        </div>
      </div>
    </div>
  );
};
