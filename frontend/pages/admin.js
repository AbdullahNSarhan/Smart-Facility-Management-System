// LCI-SFM Administration & Operator Pages (/app/diagnostics, /app/users, /app/settings, /app/profile)
// Fixes WebSocket channel counts, separates Dashboard Operators from Facility People/Credentials (/api/v1/people),
// and adds truthful server-side LAN destination configuration.

import { api } from '../api.js';
import {
  store,
  isAdmin,
  showToast,
  openModal,
  closeModal,
  confirmDialog,
  toggleTheme,
  signOut,
  checkSession
} from '../store.js';
import { el, clear, svgIcon, formatAge, formatTimestamp, formatUptime } from '../utils.js';
import {
  pageHeader,
  statusIndicator,
  loadingSkeleton,
  emptyState,
  errorPanel,
  disclaimerBanner,
  keyValueList,
  renderAdaptiveCollection
} from '../components/ui.js';

// ============================================================================
// SYSTEM DIAGNOSTICS (/app/diagnostics)
// ============================================================================
export function renderDiagnosticsPage({ navigate }) {
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let disposed = false;

  const contentSlot = el('div', { class: 'stack-lg' });

  container.appendChild(
    pageHeader({
      title: 'Diagnostics',
      description: 'Live backend readiness, SQLite WAL status, MQTT broker posture, WebSocket channel counts, and per-device freshness.',
      actions: [
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          onClick: () => navigate('/app/network')
        }, [svgIcon('icon-topology', 14), el('span', { text: 'Network Topology' })]),
        el('button', {
          type: 'button',
          class: 'btn-icon',
          title: 'Refresh diagnostics',
          'aria-label': 'Refresh diagnostics',
          onClick: () => load()
        }, [svgIcon('icon-refresh', 15)])
      ]
    })
  );
  container.appendChild(contentSlot);

  async function load() {
    if (disposed) return;
    clear(contentSlot);
    contentSlot.appendChild(loadingSkeleton('table', 4));

    const [readyRes, diagRes] = await Promise.allSettled([api.getHealthReady(), api.getDiagnostics()]);
    if (disposed) return;

    const ready = readyRes.status === 'fulfilled' ? readyRes.value : null;
    const diag = diagRes.status === 'fulfilled' ? diagRes.value : null;

    clear(contentSlot);
    if (!diag && !ready) {
      contentSlot.appendChild(
        errorPanel({
          title: 'Diagnostics unavailable',
          message: diagRes.reason?.message || 'Unable to query /api/v1/diagnostics.',
          onRetry: load
        })
      );
      return;
    }

    const sqlite = diag?.sqlite || ready?.sqlite || {};
    const mqtt = diag?.mqtt || ready?.mqtt || {};
    const ws = diag?.websocket || { telemetry: 0, mfa: 0, notifications: 0, total: 0 };
    const dep = diag?.deployment_summary || {};

    const mqttState =
      mqtt.state === 'standby' || mqtt.enabled === false
        ? 'STANDBY'
        : mqtt.connected && mqtt.subscriptions_ready !== false
          ? 'CONNECTED'
          : mqtt.connected
            ? 'DEGRADED'
            : 'DISCONNECTED';

    // Simulator Control Panel (STRICTLY gated on diag.simulation && isAdmin())
    if (diag?.simulation) {
      const scenarios = [
        { id: 'normal', label: 'Normal Telemetry' },
        { id: 'alarm', label: 'Trigger Alarm Condition' },
        { id: 'offline', label: 'Simulate Stale / Offline' },
        { id: 'command-failure', label: 'Simulate Command Failure' }
      ];
      contentSlot.appendChild(
        disclaimerBanner({
          icon: 'icon-activity',
          tone: 'info',
          title: 'SIMULATION MODE — Isolated Synthetic Telemetry Driver',
          message: 'Simulator controls are available only in isolated simulation mode. No physical hardware is contacted.',
          actions: admin
            ? scenarios.map((sc) =>
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: sc.label,
                  onClick: async () => {
                    try {
                      await api.triggerSimulatorScenario(sc.id);
                      showToast('Simulator scenario active', sc.label, 'info');
                      load();
                    } catch (err) {
                      showToast('Scenario failed', err.message, 'error');
                    }
                  }
                })
              )
            : []
        })
      );
    }

    // Core Service Cards Grid
    contentSlot.appendChild(
      el('div', { class: 'rooms-grid' }, [
        el('section', { class: 'card stack-sm' }, [
          el('div', { class: 'row-between' }, [
            el('h2', { class: 'card-title', text: 'Platform & Readiness' }),
            statusIndicator(ready?.status === 'ready' ? 'READY' : 'DEGRADED')
          ]),
          keyValueList([
            { label: 'Release Version', value: diag?.version || '2.0.0-rc.1', mono: true },
            { label: 'Readiness HTTP', value: `${ready?.httpStatus || 200} (${ready?.status || 'unknown'})`, mono: true },
            { label: 'Uptime', value: formatUptime(diag?.uptime_seconds), mono: true },
            { label: 'Started At', value: formatTimestamp(diag?.started_at), mono: true },
            { label: 'Monitor Tick', value: diag?.monitoring_error ? `Error: ${diag.monitoring_error}` : 'Nominal' }
          ])
        ]),
        el('section', { class: 'card stack-sm' }, [
          el('div', { class: 'row-between' }, [
            el('h2', { class: 'card-title', text: 'SQLite Database' }),
            statusIndicator(sqlite.ok ? 'HEALTHY' : 'ERROR')
          ]),
          keyValueList([
            { label: 'Health Check', value: sqlite.ok ? 'Passing' : 'Failed' },
            { label: 'Journal Mode', value: String(sqlite.journal_mode || 'wal').toUpperCase(), mono: true },
            { label: 'Foreign Keys', value: sqlite.foreign_keys ? 'Enabled' : 'Disabled' },
            { label: 'Retention Window', value: `${diag?.retention_days ?? 30} days`, mono: true }
          ])
        ]),
        el('section', { class: 'card stack-sm' }, [
          el('div', { class: 'row-between' }, [
            el('h2', { class: 'card-title', text: 'MQTT Broker & WebSockets' }),
            statusIndicator(mqttState)
          ]),
          keyValueList([
            { label: 'MQTT Enabled', value: mqtt.enabled === false ? 'No (Standby)' : 'Yes' },
            { label: 'Subscriptions', value: mqtt.subscriptions_ready ? 'Verified' : mqtt.enabled === false ? 'N/A' : 'Degraded' },
            { label: 'WS Telemetry Clients', value: String(ws.telemetry ?? 0), mono: true },
            { label: 'WS Notification Clients', value: String(ws.notifications ?? 0), mono: true },
            { label: 'WS MFA Clients', value: String(ws.mfa ?? 0), mono: true }
          ])
        ]),
        el('section', { class: 'card stack-sm' }, [
          el('div', { class: 'row-between' }, [
            el('h2', { class: 'card-title', text: 'Deployment Posture' }),
            statusIndicator('INFO', dep.node_env || 'production')
          ]),
          keyValueList([
            { label: 'Session Secure Cookie', value: dep.session_secure_cookie ? 'HTTPS Required' : 'LAN HTTP Allowed' },
            { label: 'Bearer Compat', value: dep.allow_bearer_compat ? 'Enabled' : 'Disabled (Strict Cookie)' },
            { label: 'Idle Session TTL', value: `${dep.session_idle_minutes ?? 30} min`, mono: true },
            { label: 'Absolute Session TTL', value: `${dep.session_absolute_hours ?? 12} hr`, mono: true },
            { label: 'Pending Quarantine', value: String(diag?.pending_devices_count ?? 0), mono: true }
          ])
        ])
      ])
    );

    // Per-device freshness table
    const devices = diag?.devices || [];
    contentSlot.appendChild(
      el('section', { class: 'stack-md' }, [
        el('h2', { class: 'section-title', text: `Device & Endpoint Evidence (${devices.length})` }),
        renderAdaptiveCollection({
          ariaLabel: 'Device diagnostics freshness matrix',
          rows: devices,
          onRowClick: (d) => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`),
          emptyNode: emptyState({ title: 'No registered devices', message: 'Devices will appear here once registered.' }),
          columns: [
            {
              label: 'Device',
              render: (d) =>
                el('div', { class: 'stack-xs' }, [
                  el('span', { class: 'font-semibold', text: d.name }),
                  el('span', { class: 'mono text-xs text-muted', text: d.device_id })
                ])
            },
            { label: 'Transport', render: (d) => el('span', { class: 'meta-tag mono', text: d.transport }) },
            { label: 'Status', render: (d) => statusIndicator(d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true }) },
            { label: 'MQTT Identity', render: (d) => statusIndicator(d.mqtt_identity_status || 'NOT_APPLICABLE', null, { compact: true }) },
            {
              label: 'Endpoints',
              className: 'mono text-xs tabular-nums',
              render: (d) => `${(d.endpoints || []).filter((e) => e.fresh).length}/${(d.endpoints || []).length} fresh`
            },
            { label: 'Last Seen', className: 'mono text-xs text-secondary', render: (d) => formatAge(d.last_seen_at) }
          ],
          renderMobileCard: (d) =>
            el('article', { class: 'card record-card', onClick: () => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`) }, [
              el('div', { class: 'record-card-head' }, [
                el('div', { class: 'font-semibold', text: d.name }),
                statusIndicator(d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true })
              ]),
              el('div', { class: 'mono text-xs text-muted', text: `${d.device_id} · ${d.transport} · ${formatAge(d.last_seen_at)}` })
            ])
        })
      ])
    );
  }

  load();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
    }
  };
}

// ============================================================================
// USERS & ACCESS (/app/users) — Separated Operators vs Facility People/Credentials
// ============================================================================
export function renderUsersPage() {
  const container = el('div', { class: 'stack-lg' });
  let disposed = false;

  if (!isAdmin()) {
    container.appendChild(
      el('div', { class: 'card' }, [
        emptyState({
          icon: 'icon-shield',
          title: 'Administrator Role Required',
          message: 'Managing dashboard operators and physical access credentials requires a server-verified Admin account.'
        })
      ])
    );
    return { node: container };
  }

  let activeTab = 'operators'; // operators | people
  let peopleSearch = '';

  const tabSlot = el('div');
  const bodySlot = el('div', { class: 'stack-md' });

  function openCreateOperatorModal(onDone) {
    const userIn = el('input', { class: 'input', type: 'text', placeholder: 'e.g. ops_engineer', required: true });
    const passIn = el('input', { class: 'input', type: 'password', placeholder: 'Minimum 12 characters', required: true });
    const roleSel = el('select', { class: 'select' }, [
      el('option', { value: 'Viewer', text: 'Viewer (Read-only operations)' }),
      el('option', { value: 'Admin', text: 'Admin (Full management & control)' })
    ]);
    const errBox = el('div', { class: 'form-error', hidden: true });

    const body = el('div', { class: 'stack-md' }, [
      errBox,
      el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Username *' }), userIn]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: 'Password * (min 12 characters)' }),
        passIn
      ]),
      el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Console Role *' }), roleSel]),
      el('p', {
        class: 'text-xs text-muted',
        text: 'Dashboard operator accounts authenticate to the web console only. Physical RFID cards and door PINs are managed separately under Facility People.'
      })
    ]);

    const saveBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Create Operator',
      onClick: async () => {
        errBox.hidden = true;
        const username = userIn.value.trim();
        const password = passIn.value;
        if (!username || password.length < 12) {
          errBox.textContent = 'Username is required and password must be at least 12 characters.';
          errBox.hidden = false;
          return;
        }
        saveBtn.disabled = true;
        try {
          await api.createOperator({ username, password, role: roleSel.value });
          showToast('Operator created', `${username} (${roleSel.value})`, 'success');
          closeModal();
          onDone();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        } finally {
          saveBtn.disabled = false;
        }
      }
    });

    openModal({
      title: 'Create Dashboard Operator',
      subtitle: 'Console Account Provisioning',
      body,
      actions: [
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
        saveBtn
      ]
    });
  }

  function openCreatePersonModal(onDone) {
    const nameIn = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Dr. Nadia Mansour', required: true });
    const refIn = el('input', { class: 'input', type: 'text', placeholder: 'Employee ID / Badge Reference (optional)' });
    const errBox = el('div', { class: 'form-error', hidden: true });

    const body = el('div', { class: 'stack-md' }, [
      errBox,
      el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Display Name *' }), nameIn]),
      el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Reference / Department' }), refIn])
    ]);

    const saveBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Add Person',
      onClick: async () => {
        errBox.hidden = true;
        const display_name = nameIn.value.trim();
        if (!display_name) {
          errBox.textContent = 'Display Name is required.';
          errBox.hidden = false;
          return;
        }
        saveBtn.disabled = true;
        try {
          await api.createPerson({ display_name, reference: refIn.value.trim() });
          showToast('Person added', display_name, 'success');
          closeModal();
          onDone();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        } finally {
          saveBtn.disabled = false;
        }
      }
    });

    openModal({
      title: 'Add Facility Person',
      subtitle: 'Physical Access Directory',
      body,
      actions: [
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
        saveBtn
      ]
    });
  }

  function openAddCredentialModal(person, onDone) {
    let modality = 'RFID';
    const modSel = el('select', { class: 'select' }, [
      el('option', { value: 'RFID', text: 'RFID Card UID (4, 7, or 10 hex bytes)' }),
      el('option', { value: 'PIN', text: 'Keypad PIN (6 digits — stored as scrypt hash)' })
    ]);
    const valIn = el('input', { class: 'input mono', type: 'text', placeholder: 'e.g. A1:B2:C3:D4' });
    const valLbl = el('label', { class: 'form-label', text: 'Card UID *' });
    const errBox = el('div', { class: 'form-error', hidden: true });

    modSel.addEventListener('change', () => {
      modality = modSel.value;
      valIn.value = '';
      if (modality === 'PIN') {
        valIn.type = 'password';
        valIn.placeholder = '6 numeric digits';
        valLbl.textContent = 'Keypad PIN *';
      } else {
        valIn.type = 'text';
        valIn.placeholder = 'e.g. A1:B2:C3:D4';
        valLbl.textContent = 'Card UID *';
      }
    });

    const body = el('div', { class: 'stack-md' }, [
      errBox,
      disclaimerBanner({
        icon: 'icon-clock',
        tone: 'pending',
        message: 'New credentials are saved centrally and marked Pending Device Sync until edge controller policy sync is completed.'
      }),
      el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Credential Modality' }), modSel]),
      el('div', { class: 'form-field' }, [valLbl, valIn])
    ]);

    const saveBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Save Credential',
      onClick: async () => {
        errBox.hidden = true;
        saveBtn.disabled = true;
        try {
          const payload =
            modality === 'PIN'
              ? { modality: 'PIN', pin: valIn.value.trim() }
              : { modality: 'RFID', card_uid: valIn.value.trim().toUpperCase() };
          await api.addCredential(person.person_id || person.id, payload);
          showToast('Credential saved', 'Marked Pending Device Sync.', 'success');
          closeModal();
          onDone();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        } finally {
          saveBtn.disabled = false;
        }
      }
    });

    openModal({
      title: `Add Credential · ${person.display_name}`,
      subtitle: 'Physical Credential Registry',
      body,
      actions: [
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
        saveBtn
      ]
    });
  }

  function openReaderEnrollmentModal(person, onDone) {
    const activeStates = new Set(['ARMING', 'READY', 'CANDIDATE']);
    let sessionId = null;
    let enrollmentStatus = null;
    let pollTimer = null;
    let closeCleanupStarted = false;

    const statusText = el('p', { class: 'text-secondary', text: 'Starting secure reader enrollment…' });
    const maskedUid = el('code', { class: 'mono', text: 'No card captured' });
    const errorBox = el('div', { class: 'form-error', hidden: true });
    const confirmBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Confirm Card Assignment', disabled: true });
    const closeBtn = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Close' });

    const modal = openModal({
      title: 'Enroll RFID Card',
      subtitle: 'Facility Person · ' + person.display_name,
      body: el('div', { class: 'stack-md' }, [
        disclaimerBanner({
          icon: 'icon-shield',
          tone: 'pending',
          title: 'Secure 45-second enrollment window',
          message: 'Requires an online door reader that freshly advertises RFID_ENROLL_V1. Present one card only after the reader reports READY. The full card UID is never shown in the console.'
        }),
        el('section', { class: 'card card-compact stack-sm' }, [
          el('span', { class: 'form-label', text: 'Reader Status' }),
          statusText,
          el('div', { class: 'row-gap-sm' }, [
            el('span', { class: 'text-xs text-muted', text: 'Detected card (masked)' }),
            maskedUid
          ])
        ]),
        errorBox
      ]),
      actions: [closeBtn, confirmBtn]
    });

    const renderEnrollment = (enrollment) => {
      enrollmentStatus = enrollment.status || enrollmentStatus;
      const messages = {
        ARMING: 'The reader is preparing. Wait for READY before presenting the card.',
        READY: 'Reader is ready. Present the RFID card now.',
        CANDIDATE: 'A card was detected. Verify the masked UID, then confirm the assignment.',
        FAILED: 'The reader reported a failure. No credential was saved.',
        EXPIRED: 'The enrollment window expired. Start a new scan if required.',
        CANCELLED: 'Enrollment was cancelled. No credential was saved.',
        CONFIRMED: 'Card assigned centrally. It remains Pending Device Sync until firmware policy synchronization is implemented.'
      };
      statusText.textContent = messages[enrollmentStatus] || ('Enrollment state: ' + (enrollmentStatus || 'UNKNOWN'));
      maskedUid.textContent = enrollment.masked_uid || 'No card captured';
      confirmBtn.disabled = enrollmentStatus !== 'CANDIDATE';
    };

    const stopPolling = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    };

    const cancelIfModalClosed = async () => {
      stopPolling();
      if (closeCleanupStarted || !sessionId || !activeStates.has(enrollmentStatus)) return;
      closeCleanupStarted = true;
      try {
        await api.finishEnrollment(sessionId, 'cancel');
      } catch {
        // The edge device's original deadline remains authoritative if release cannot be sent.
      }
    };

    const pollEnrollment = async () => {
      if (!modal.panel.isConnected) {
        await cancelIfModalClosed();
        return;
      }
      if (!sessionId || !activeStates.has(enrollmentStatus)) return;
      try {
        const response = await api.getEnrollment(sessionId);
        if (!modal.panel.isConnected) {
          await cancelIfModalClosed();
          return;
        }
        renderEnrollment(response.enrollment || response);
      } catch (err) {
        if (!modal.panel.isConnected) {
          await cancelIfModalClosed();
          return;
        }
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
      if (activeStates.has(enrollmentStatus) && modal.panel.isConnected) {
        pollTimer = setTimeout(pollEnrollment, 1000);
      }
    };

    closeBtn.addEventListener('click', async () => {
      closeBtn.disabled = true;
      stopPolling();
      if (sessionId && activeStates.has(enrollmentStatus)) {
        try {
          const response = await api.finishEnrollment(sessionId, 'cancel');
          const enrollment = response.enrollment || response;
          renderEnrollment(enrollment);
          showToast(
            'Enrollment cancelled',
            enrollment.reader_release === 'WAIT_FOR_EXPIRY'
              ? 'The reader will release itself at the original deadline.'
              : 'The reader release was requested.',
            'info'
          );
          onDone();
        } catch (err) {
          errorBox.textContent = err.message;
          errorBox.hidden = false;
          closeBtn.disabled = false;
          if (activeStates.has(enrollmentStatus)) pollTimer = setTimeout(pollEnrollment, 1000);
          return;
        }
      }
      closeModal();
    });

    confirmBtn.addEventListener('click', async () => {
      if (!sessionId || enrollmentStatus !== 'CANDIDATE') return;
      confirmBtn.disabled = true;
      stopPolling();
      try {
        const response = await api.finishEnrollment(sessionId, 'confirm');
        const enrollment = response.enrollment || response;
        renderEnrollment(enrollment);
        showToast('RFID card assigned', 'Stored centrally and marked Pending Device Sync.', 'success');
        closeModal();
        onDone();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
        confirmBtn.disabled = enrollmentStatus !== 'CANDIDATE';
        if (activeStates.has(enrollmentStatus)) pollTimer = setTimeout(pollEnrollment, 1000);
      }
    });

    const start = async () => {
      try {
        const response = await api.startEnrollment(person.person_id || person.id);
        const enrollment = response.enrollment || response;
        sessionId = enrollment.session_id;
        enrollmentStatus = enrollment.status || enrollmentStatus;
        if (!modal.panel.isConnected) {
          await cancelIfModalClosed();
          return;
        }
        renderEnrollment(enrollment);
        if (activeStates.has(enrollmentStatus)) pollTimer = setTimeout(pollEnrollment, 1000);
      } catch (err) {
        if (!modal.panel.isConnected) return;
        statusText.textContent = 'Reader enrollment could not be started.';
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
    };

    start();
  }
  container.appendChild(
    pageHeader({
      title: 'Users & Access',
      description: 'Manage console operator accounts separately from physical facility personnel and access credentials.',
      actions: [
        el('button', {
          type: 'button',
          class: 'btn btn-primary btn-sm',
          onClick: () =>
            activeTab === 'operators'
              ? openCreateOperatorModal(loadTab)
              : openCreatePersonModal(loadTab)
        }, [svgIcon('icon-plus', 14), el('span', { text: 'Add Account / Person' })])
      ]
    })
  );
  container.append(tabSlot, bodySlot);

  function renderTabs() {
    clear(tabSlot);
    tabSlot.appendChild(
      el('div', { class: 'tab-bar', role: 'tablist' }, [
        el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': activeTab === 'operators' ? 'true' : 'false',
          class: `tab-btn${activeTab === 'operators' ? ' active' : ''}`,
          text: 'Dashboard Operators',
          onClick: () => {
            activeTab = 'operators';
            renderTabs();
            loadTab();
          }
        }),
        el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': activeTab === 'people' ? 'true' : 'false',
          class: `tab-btn${activeTab === 'people' ? ' active' : ''}`,
          text: 'Facility People & Credentials',
          onClick: () => {
            activeTab = 'people';
            renderTabs();
            loadTab();
          }
        })
      ])
    );
  }

  async function loadTab() {
    if (disposed) return;
    clear(bodySlot);
    bodySlot.appendChild(loadingSkeleton('table', 4));

    try {
      if (activeTab === 'operators') {
        const res = await api.listSystemUsers();
        if (disposed) return;
        const users = res.rows || res.users || (Array.isArray(res) ? res : []);
        clear(bodySlot);

        bodySlot.appendChild(
          disclaimerBanner({
            icon: 'icon-shield',
            tone: 'info',
            message: 'Operators sign into this web console using HttpOnly session cookies. Passwords are hashed with scrypt and never returned by the API.'
          })
        );

        bodySlot.appendChild(
          renderAdaptiveCollection({
            ariaLabel: 'Dashboard operators directory',
            rows: users,
            emptyNode: emptyState({ title: 'No operators found', message: 'Create an operator account to grant console access.' }),
            columns: [
              { label: 'Username', className: 'font-semibold', key: 'username' },
              {
                label: 'Role',
                render: (u) => statusIndicator(u.role === 'Admin' ? 'ADMIN' : 'VIEWER', u.role, { compact: true })
              },
              {
                label: 'Created',
                className: 'mono text-xs text-muted',
                render: (u) => formatTimestamp(u.created_at)
              },
              {
                label: 'Actions',
                align: 'right',
                render: (u) => {
                  const isSelf = store.user?.username === u.username;
                  return el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, [
                    el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-sm',
                      disabled: isSelf,
                      title: isSelf ? 'Cannot change your own active role' : undefined,
                      text: u.role === 'Admin' ? 'Demote to Viewer' : 'Promote to Admin',
                      onClick: async () => {
                        const nextRole = u.role === 'Admin' ? 'Viewer' : 'Admin';
                        try {
                          await api.updateOperatorRole({ id: u.id, role: nextRole });
                          showToast('Role updated', `${u.username} is now ${nextRole}`, 'success');
                          loadTab();
                        } catch (err) {
                          showToast('Role update failed', err.message, 'error');
                        }
                      }
                    }),
                    el('button', {
                      type: 'button',
                      class: 'btn btn-danger btn-sm',
                      disabled: isSelf,
                      title: isSelf ? 'Cannot delete your own session account' : undefined,
                      text: 'Delete',
                      onClick: async () => {
                        const ok = await confirmDialog({
                          title: `Delete operator "${u.username}"?`,
                          message: 'Revokes all active sessions for this user. The server prevents deleting the last remaining Admin.',
                          confirmLabel: 'Delete Operator',
                          danger: true
                        });
                        if (!ok) return;
                        try {
                          await api.deleteOperator(u.id);
                          showToast('Operator deleted', u.username, 'info');
                          loadTab();
                        } catch (err) {
                          showToast('Delete rejected', err.message, 'error');
                        }
                      }
                    })
                  ]);
                }
              }
            ],
            renderMobileCard: (u) =>
              el('article', { class: 'card record-card' }, [
                el('div', { class: 'record-card-head' }, [
                  el('div', { class: 'font-semibold', text: u.username }),
                  statusIndicator(u.role === 'Admin' ? 'ADMIN' : 'VIEWER', u.role, { compact: true })
                ]),
                el('div', { class: 'text-xs text-muted mono', text: `Created: ${formatTimestamp(u.created_at)}` })
              ])
          })
        );
      } else {
        const res = await api.listPeople({ search: peopleSearch, limit: 50 });
        if (disposed) return;
        const people = res.people || [];

        clear(bodySlot);

        const searchIn = el('input', {
          class: 'input',
          type: 'search',
          value: peopleSearch,
          placeholder: 'Search facility people by name or reference...',
          'aria-label': 'Search facility people'
        });
        let st = null;
        searchIn.addEventListener('input', () => {
          peopleSearch = searchIn.value.trim();
          clearTimeout(st);
          st = setTimeout(loadTab, 250);
        });

        bodySlot.appendChild(
          disclaimerBanner({
            icon: 'icon-clock',
            tone: 'pending',
            title: 'Physical Credential Policy Boundary',
            message: 'Credentials managed here are stored centrally with status Pending Device Sync. Raw PINs and secret hashes are never returned to the browser.'
          })
        );

        bodySlot.appendChild(
          el('div', { class: 'card card-compact row-between' }, [
            searchIn,
            el('button', {
              type: 'button',
              class: 'btn btn-primary btn-sm',
              onClick: () => openCreatePersonModal(loadTab)
            }, [svgIcon('icon-plus', 14), el('span', { text: 'Add Person' })])
          ])
        );

        bodySlot.appendChild(
          renderAdaptiveCollection({
            ariaLabel: 'Facility people and physical credentials',
            rows: people,
            emptyNode: emptyState({
              icon: 'icon-users',
              title: 'No facility personnel registered',
              message: 'Add people here to issue RFID card or keypad PIN credentials separately from dashboard operator logins.',
              actionLabel: 'Add Person',
              onAction: () => openCreatePersonModal(loadTab)
            }),
            columns: [
              {
                label: 'Person',
                render: (p) =>
                  el('div', { class: 'stack-xs' }, [
                    el('span', { class: 'font-semibold', text: p.display_name }),
                    p.reference ? el('span', { class: 'text-xs text-muted mono', text: p.reference }) : null
                  ])
              },
              {
                label: 'Status',
                render: (p) => statusIndicator(p.status || 'ACTIVE', null, { compact: true })
              },
              {
                label: 'Credentials',
                render: (p) => {
                  const creds = p.credentials || [];
                  if (!creds.length) return el('span', { class: 'text-xs text-muted', text: 'None issued' });
                  return el(
                    'div',
                    { class: 'stack-xs' },
                    creds.map((c) =>
                      el('div', { class: 'row-gap-sm' }, [
                        el('span', { class: 'meta-tag mono', text: `${c.modality}${c.masked_label ? ` · ${c.masked_label}` : ''}` }),
                        statusIndicator(c.status || 'ACTIVE', null, { compact: true }),
                        statusIndicator('PENDING_DEVICE_SYNC', 'Pending Sync', { compact: true }),
                        c.status === 'ACTIVE'
                          ? el('button', {
                              type: 'button',
                              class: 'btn btn-ghost btn-sm',
                              text: 'Revoke',
                              onClick: async () => {
                                try {
                                  await api.setCredentialState(c.credential_id || c.id, 'REVOKED');
                                  showToast('Credential revoked', `${c.modality} credential revoked.`, 'info');
                                  loadTab();
                                } catch (err) {
                                  showToast('Revoke failed', err.message, 'error');
                                }
                              }
                            })
                          : null
                      ])
                    )
                  );
                }
              },
              {
                label: 'Actions',
                align: 'right',
                render: (p) =>
                  el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, [
                    el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-sm',
                      text: '+ Credential',
                      onClick: () => openAddCredentialModal(p, loadTab)
                    }),
                    el('button', {
                      type: 'button',
                      class: 'btn btn-ghost btn-sm',
                      disabled: p.status !== 'ACTIVE',
                      title: p.status !== 'ACTIVE' ? 'Activate this person before reader enrollment' : undefined,
                      text: 'Scan on Reader',
                      onClick: () => openReaderEnrollmentModal(p, loadTab)
                    }),
                    el('button', {
                      type: 'button',
                      class: 'btn btn-ghost btn-sm',
                      text: p.status === 'ACTIVE' ? 'Suspend' : 'Activate',
                      onClick: async () => {
                        try {
                          await api.updatePerson(p.person_id || p.id, {
                            display_name: p.display_name,
                            reference: p.reference || '',
                            status: p.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                            version: p.version
                          });
                          showToast('Person updated', p.display_name, 'success');
                          loadTab();
                        } catch (err) {
                          showToast('Update failed', err.message, 'error');
                        }
                      }
                    })
                  ])
              }
            ],
            renderMobileCard: (p) =>
              el('article', { class: 'card record-card' }, [
                el('div', { class: 'record-card-head' }, [
                  el('div', { class: 'font-semibold', text: p.display_name }),
                  statusIndicator(p.status || 'ACTIVE', null, { compact: true })
                ]),
                el('div', { class: 'text-xs text-muted', text: `${(p.credentials || []).length} credential(s)` }),
                el('div', { class: 'record-card-actions' }, [
                  el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: '+ Credential',
                    onClick: () => openAddCredentialModal(p, loadTab)
                  }),
                  el('button', {
                    type: 'button',
                    class: 'btn btn-ghost btn-sm',
                    disabled: p.status !== 'ACTIVE',
                    text: 'Scan RFID',
                    onClick: () => openReaderEnrollmentModal(p, loadTab)
                  })
                ])
              ])
          })
        );
      }
    } catch (err) {
      if (disposed) return;
      clear(bodySlot);
      bodySlot.appendChild(
        errorPanel({
          title: 'Failed to load directory',
          message: err.message,
          onRetry: loadTab
        })
      );
    }
  }

  renderTabs();
  loadTab();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
    }
  };
}

// ============================================================================
// FACILITY SETTINGS (/app/settings)
// ============================================================================
export function renderSettingsPage() {
  const container = el('div', { class: 'stack-lg' });
  let disposed = false;

  if (!isAdmin()) {
    container.appendChild(
      el('div', { class: 'card' }, [
        emptyState({
          icon: 'icon-shield',
          title: 'Administrator Role Required',
          message: 'Facility profile and registered node destination settings require an Admin account.'
        })
      ])
    );
    return { node: container };
  }

  const contentSlot = el('div', { class: 'stack-lg' });
  container.appendChild(
    pageHeader({
      title: 'Facility Settings',
      description: 'Configure facility profile metadata and centralized server-side baseline node destinations.'
    })
  );
  container.appendChild(contentSlot);

  async function load() {
    if (disposed) return;
    clear(contentSlot);
    contentSlot.appendChild(loadingSkeleton('table', 4));

    const [facRes, mgmtRes] = await Promise.allSettled([api.getFacility(), api.getManagementSettings()]);
    if (disposed) return;

    clear(contentSlot);

    // 1. Facility Profile Card
    if (facRes.status === 'fulfilled') {
      const f = facRes.value.facility;
      const nameIn = el('input', { class: 'input', type: 'text', value: f.name || '' });
      const locIn = el('input', { class: 'input', type: 'text', value: f.location || '' });
      const tzIn = el('input', { class: 'input mono', type: 'text', value: f.timezone || 'UTC' });
      const descIn = el('textarea', { class: 'textarea', value: f.description || '' });
      const errBox = el('div', { class: 'form-error', hidden: true });
      const saveBtn = el('button', {
        type: 'button',
        class: 'btn btn-primary btn-sm',
        text: 'Save Facility Profile',
        onClick: async () => {
          errBox.hidden = true;
          saveBtn.disabled = true;
          try {
            await api.updateFacility({
              name: nameIn.value.trim(),
              location: locIn.value.trim(),
              timezone: tzIn.value.trim() || 'UTC',
              description: descIn.value.trim(),
              version: f.version
            });
            showToast('Facility profile saved', nameIn.value.trim(), 'success');
            load();
          } catch (err) {
            errBox.textContent =
              err.status === 409
                ? 'Facility settings changed in another session. Refresh before saving.'
                : err.message;
            errBox.hidden = false;
          } finally {
            saveBtn.disabled = false;
          }
        }
      });

      contentSlot.appendChild(
        el('section', { class: 'card stack-md' }, [
          el('div', { class: 'row-between' }, [
            el('h2', { class: 'card-title', text: 'Facility Profile' }),
            el('span', { class: 'mono text-xs text-muted', text: `Revision v${f.version}` })
          ]),
          errBox,
          el('div', { class: 'form-grid' }, [
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Facility Name *' }), nameIn]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Timezone' }), tzIn]),
            el('div', { class: 'form-field form-field-full' }, [el('label', { class: 'form-label', text: 'Location / Site' }), locIn]),
            el('div', { class: 'form-field form-field-full' }, [el('label', { class: 'form-label', text: 'Description' }), descIn])
          ]),
          el('div', { class: 'btn-row' }, [saveBtn])
        ])
      );
    } else {
      contentSlot.appendChild(
        errorPanel({ title: 'Facility profile unavailable', message: facRes.reason?.message, onRetry: load })
      );
    }

    // 2. Registered Server-Side Baseline Node Destinations Card
    if (mgmtRes.status === 'fulfilled') {
      const s = mgmtRes.value.settings;
      const n1Name = el('input', { class: 'input', type: 'text', value: s.nodes?.node1?.name || '' });
      const n1Ip = el('input', { class: 'input mono', type: 'text', value: s.nodes?.node1?.ip || '' });
      const n2Name = el('input', { class: 'input', type: 'text', value: s.nodes?.node2?.name || '' });
      const n2Ip = el('input', { class: 'input mono', type: 'text', value: s.nodes?.node2?.ip || '' });
      const n3Name = el('input', { class: 'input', type: 'text', value: s.nodes?.node3?.name || '' });
      const n3Ip = el('input', { class: 'input mono', type: 'text', value: s.nodes?.node3?.ip || '' });
      const errBox = el('div', { class: 'form-error', hidden: true });

      const saveNodesBtn = el('button', {
        type: 'button',
        class: 'btn btn-primary btn-sm',
        text: 'Save Registered Destinations',
        onClick: async () => {
          errBox.hidden = true;
          saveNodesBtn.disabled = true;
          try {
            const res = await api.updateManagementSettings({
              revision: s.revision,
              facility_name: s.facility_name,
              room_name: s.room_name,
              nodes: {
                node1: { name: n1Name.value.trim(), ip: n1Ip.value.trim() },
                node2: { name: n2Name.value.trim(), ip: n2Ip.value.trim() },
                node3: { name: n3Name.value.trim(), ip: n3Ip.value.trim() }
              },
              display_thresholds: s.display_thresholds
            });
            showToast('Destinations saved', res.note || 'Server-side destinations updated.', 'success');
            load();
          } catch (err) {
            errBox.textContent = err.message;
            errBox.hidden = false;
          } finally {
            saveNodesBtn.disabled = false;
          }
        }
      });

      contentSlot.appendChild(
        el('section', { class: 'card stack-md' }, [
          el('div', { class: 'row-between' }, [
            el('h2', { class: 'card-title', text: 'Registered Server-Side Node Destinations' }),
            el('span', { class: 'mono text-xs text-muted', text: `Revision ${s.revision}` })
          ]),
          disclaimerBanner({
            icon: 'icon-warning',
            tone: 'warn',
            message:
              'Changes server-side destination addresses only. Updating these values does NOT configure physical ESP32 network interfaces, static IPs, or edge controller firmware thresholds.'
          }),
          errBox,
          el('div', { class: 'form-grid' }, [
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Node 1 Name (Access)' }), n1Name]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Node 1 Private LAN IPv4' }), n1Ip]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Node 2 Name (Environment)' }), n2Name]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Node 2 Private LAN IPv4' }), n2Ip]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Node 3 Name (Camera)' }), n3Name]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Node 3 Private LAN IPv4' }), n3Ip])
          ]),
          el('div', { class: 'btn-row' }, [saveNodesBtn])
        ])
      );
    }

    // 3. Read-only Deployment Posture Guidance
    contentSlot.appendChild(
      el('section', { class: 'card stack-sm' }, [
        el('h2', { class: 'card-title', text: 'Local Deployment & Host CLI Reference' }),
        el('p', {
          class: 'text-sm text-secondary',
          text: 'Network interface binding, TLS termination, SQLite backup/restore, and per-device Mosquitto ACL provisioning are managed explicitly on the Ubuntu Server host.'
        }),
        keyValueList([
          { label: 'Guided Installer', value: 'sudo ./install.sh', mono: true },
          { label: 'MQTT Device ACL Helper', value: 'sudo ./scripts/provision-mqtt-device.sh add <device_id>', mono: true },
          { label: 'SQLite Backup', value: 'npm run db:backup', mono: true }
        ])
      ])
    );
  }

  load();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
    }
  };
}

// ============================================================================
// OPERATOR PROFILE (/app/profile)
// ============================================================================
export function renderProfilePage({ navigate }) {
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();

  container.appendChild(
    pageHeader({
      title: 'Operator Profile',
      description: 'Inspect your verified local session, switch interface themes, and rotate administrator credentials.'
    })
  );

  // Session & Theme Card
  const themeStatus = el('span', { class: 'mono text-sm', text: store.theme === 'dark' ? 'Dark Industrial Graphite' : 'Light Technical Neutral' });

  container.appendChild(
    el('section', { class: 'card stack-md' }, [
      el('div', { class: 'row-between' }, [
        el('h2', { class: 'card-title', text: 'Active Local Session' }),
        statusIndicator(admin ? 'ADMIN' : 'VIEWER', store.user?.role || 'Viewer')
      ]),
      keyValueList([
        { label: 'Username', value: store.user?.username || '—', mono: true },
        { label: 'Verified Role', value: store.user?.role || 'Viewer' },
        { label: 'Server Origin', value: window.location.host, mono: true },
        { label: 'Current Theme', node: themeStatus }
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', {
          id: 'profile-theme-toggle',
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          onClick: () => {
            toggleTheme();
            themeStatus.textContent = store.theme === 'dark' ? 'Dark Industrial Graphite' : 'Light Technical Neutral';
          }
        }, [svgIcon(store.theme === 'dark' ? 'icon-sun' : 'icon-moon', 14), el('span', { text: 'Switch Dark / Light Theme' })]),
        el('button', {
          type: 'button',
          class: 'btn btn-danger btn-sm',
          onClick: async () => {
            await signOut();
            navigate('/login', { replace: true });
          }
        }, [svgIcon('icon-logout', 14), el('span', { text: 'Sign Out' })])
      ])
    ])
  );

  if (admin) {
    const curPass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const newUser = el('input', { class: 'input', type: 'text', value: store.user?.username || '' });
    const newPass = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Min 12 characters' });
    const errBox = el('div', { class: 'form-error', hidden: true });

    const saveBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary btn-sm',
      text: 'Update Admin Credentials',
      onClick: async () => {
        errBox.hidden = true;
        if (!curPass.value || newPass.value.length < 12 || !newUser.value.trim()) {
          errBox.textContent = 'Provide current password, valid username, and a new password of at least 12 characters.';
          errBox.hidden = false;
          return;
        }
        saveBtn.disabled = true;
        try {
          await api.updateAdminProfile({
            currentPassword: curPass.value,
            newUsername: newUser.value.trim(),
            newPassword: newPass.value
          });
          showToast('Credentials rotated', 'Administrator account updated.', 'success');
          curPass.value = '';
          newPass.value = '';
          await checkSession();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        } finally {
          saveBtn.disabled = false;
        }
      }
    });

    container.appendChild(
      el('section', { class: 'card stack-md' }, [
        el('h2', { class: 'card-title', text: 'Rotate Administrator Credentials' }),
        errBox,
        el('div', { class: 'form-grid' }, [
          el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'Current Password *' }), curPass]),
          el('div', { class: 'form-field' }, [el('label', { class: 'form-label', text: 'New Username *' }), newUser]),
          el('div', { class: 'form-field form-field-full' }, [el('label', { class: 'form-label', text: 'New Password *' }), newPass])
        ]),
        el('div', { class: 'btn-row' }, [saveBtn])
      ])
    );
  }

  return { node: container };
}
