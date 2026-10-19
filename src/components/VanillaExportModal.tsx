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
  <title>LCI-SFM Air-Gapped Command & Control Dashboard</title>
  <!-- 100% Local Air-Gapped Stylesheet -->
  <link rel="stylesheet" href="/standalone/styles.css" />
</head>
<body>
  <!-- Feature 3: Stacked Vanilla Toast Notification Container (Auto-dismisses after 3s) -->
  <div id="toast-container" class="toast-container" aria-live="polite"></div>

  <!-- Feature 5: Collapsible Sidebar Navigation -->
  <aside id="app-sidebar" class="sidebar">
    <div class="sidebar-brand">
      <span>LCI-SFM Facility Control</span>
    </div>
    <nav class="sidebar-nav">
      <button class="nav-btn active" data-view="view-1">01. Main Command Center</button>
      <button class="nav-btn" data-view="view-2">02. Smart Access & Biometrics</button>
      <button class="nav-btn" data-view="view-3">03. Environmental Monitoring</button>
      <button class="nav-btn" data-view="view-4">04. Audit Logs & DB Explorer</button>
      <button class="nav-btn" data-view="view-5">05. System Health & Diagnostics</button>
      <button class="nav-btn" data-view="view-6">06. System Management</button>
    </nav>
    <div class="sidebar-footer tabular-nums">
      Node-RED Bus: 192.168.10.2:1880
    </div>
  </aside>

  <!-- Main Expanding Content Shell -->
  <div id="main-shell" class="main-shell">
    <header class="top-bar">
      <div class="top-bar-left">
        <!-- Feature 5: Collapsible Sidebar Toggle Button -->
        <button id="sidebar-toggle-btn" class="icon-btn" type="button" aria-label="Toggle Sidebar">
          <span>☰</span>
          <span id="sidebar-toggle-label">Collapse Menu</span>
        </button>
        <span class="tabular-nums">LCI-SFM · Air-Gapped Facility Telemetry</span>
      </div>

      <div class="top-bar-right">
        <!-- Feature 1: Light / Dark Mode Toggle (Persisted in localStorage) -->
        <button id="theme-toggle-btn" class="icon-btn" type="button" aria-label="Toggle Theme">
          <span id="theme-toggle-icon">☀</span>
          <span id="theme-toggle-text">Light Mode</span>
        </button>
        <button class="icon-btn" id="open-ip-modal-btn" type="button">
          Configure Node IPs
        </button>
      </div>
    </header>

    <!-- View 1: Main Command Center -->
    <section id="view-1" class="view-container active">
      <div id="global-status-banner" class="status-banner">
        <strong>GLOBAL FACILITY STATUS: NORMAL OPERATION</strong>
        <span class="tabular-nums" id="banner-smoke-readout">SMOKE/GAS: 118 PPM</span>
      </div>

      <!-- Quick Action Panel (With 1.5s Anti-Spam Loading Spinners) -->
      <div class="glass-card" style="display: flex; flex-direction: column; gap: 12px;">
        <h3>Quick Action Panel (HTTP POST with 1.5s Anti-Spam Lock)</h3>
        <button id="btn-emergency-unlock" class="btn-action btn-coral" type="button">
          <span class="btn-label">Emergency Door Unlock</span>
          <span class="tabular-nums">POST → ${ipNode1}</span>
        </button>
        <button id="btn-toggle-fan" class="btn-action btn-blue" type="button">
          <span class="btn-label">Toggle HVAC Fan</span>
          <span class="tabular-nums" id="btn-fan-state">ON</span>
        </button>
        <button id="btn-toggle-light" class="btn-action btn-mint" type="button">
          <span class="btn-label">Toggle Aux Light</span>
          <span class="tabular-nums" id="btn-light-state">ON</span>
        </button>
      </div>
    </section>
  </div>

  <script type="module" src="/standalone/app.js"></script>
</body>
</html>`;

  const cssCode = `/* /public/standalone/styles.css — Soft UI Palette, Light/Dark Variables, Spinner & Toasts */
:root,
[data-theme="dark"] {
  --bg-canvas: #0f172a;
  --bg-surface: #1e293b;
  --bg-elevated: #263349;
  --bg-sidebar: #131c31;
  --border-subtle: rgba(148, 163, 184, 0.16);
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;

  /* Soft Mint Green (Normal / ON / Success) */
  --soft-mint: #5eead4;
  --soft-mint-bg: rgba(52, 211, 153, 0.12);
  --soft-mint-border: rgba(52, 211, 153, 0.32);

  /* Soft Coral / Rose (Emergency / OFF / Errors) */
  --soft-coral: #fda4af;
  --soft-coral-bg: rgba(251, 113, 133, 0.12);
  --soft-coral-border: rgba(251, 113, 133, 0.32);

  /* Slate Blue-Gray Accents */
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
}

/* Collapsible Sidebar & Smooth Main Content Expansion */
.sidebar {
  width: var(--sidebar-width);
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
.sidebar.collapsed {
  transform: translateX(-100%);
}
.main-shell {
  margin-left: var(--sidebar-width);
  width: calc(100% - var(--sidebar-width));
  transition: margin-left 200ms cubic-bezier(0.16, 1, 0.3, 1), width 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
.main-shell.expanded {
  margin-left: 0;
  width: 100%;
}

/* Pure CSS Anti-Spam Spinner (1.5s Button Lock) */
.css-spinner {
  width: 15px;
  height: 15px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--soft-blue);
  border-radius: 50%;
  display: inline-block;
  animation: lci-spin 0.65s linear infinite;
}
@keyframes lci-spin {
  to { transform: rotate(360deg); }
}

/* Stacked Toast Notifications (Auto-dismiss after 3s) */
.toast-container {
  position: fixed;
  top: 72px;
  right: 24px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 10px;
}`;

  const jsCode = `/**
 * /public/standalone/app.js — Modular ES6 Logic with 5 New UI/UX Features
 * Strict Node-RED Variable & SQLite Table Naming Preserved
 */
import { LocalFIFOChart } from './chart.local.js';

export let temperature = 22.4;
export let humidity = 46.0;
export let smoke_gas_level = 118;
export let light_state = "ON";
export let door_state = "CLOSED";
export let fan_relay = "ON";

export let isFacePassed = false;
export let isCardPassed = false;
export let isPinPassed = false;
export let mfa_status = "IDLE";

export let access_logs = [];
export let environmental_telemetry = [];
export let camera_events = [];
export let system_errors = [];

export let ip_node1 = localStorage.getItem('ip_node1') || '${ipNode1}';
export let ip_node2 = localStorage.getItem('ip_node2') || '${ipNode2}';
export let ip_node3 = localStorage.getItem('ip_node3') || '${ipNode3}';

// 1. LIGHT / DARK MODE TOGGLE (localStorage persistence)
export function initThemeToggle() {
  const savedTheme = localStorage.getItem('lci_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('lci_theme', next);
    showToast(\`Switched to \${next} theme\`, 'info');
  });
}

// 3. VANILLA TOAST NOTIFICATIONS (Stacked, 3-second auto-dismiss)
export function showToast(message, type = 'info', durationMs = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = \`toast-item toast-\${type}\`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 220);
  }, durationMs);
}

// 4. ANTI-SPAM BUTTON LOADING STATE (1.5s disabled + CSS spinner)
export function withButtonLoading(buttonEl, actionCallback, durationMs = 1500) {
  if (!buttonEl || buttonEl.disabled) return;
  const originalHtml = buttonEl.innerHTML;
  buttonEl.disabled = true;
  buttonEl.classList.add('is-loading');
  buttonEl.innerHTML = '<span class="css-spinner"></span> <span>Executing (1.5s)...</span>';
  setTimeout(async () => {
    await actionCallback();
    buttonEl.disabled = false;
    buttonEl.classList.remove('is-loading');
    buttonEl.innerHTML = originalHtml;
  }, durationMs);
}

// 5. COLLAPSIBLE SIDEBAR
export function initCollapsibleSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const mainShell = document.getElementById('main-shell');
  document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    mainShell.classList.toggle('expanded', isCollapsed);
    localStorage.setItem('lci_sidebar_collapsed', String(isCollapsed));
  });
}`;

  const chartCode = `// /public/standalone/chart.local.js — Local 30-Point FIFO Queue Chart Engine (Soft UI Colors)
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
              Air-Gapped Vanilla HTML5 / CSS3 / ES6 Source Files (/public/standalone/)
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
