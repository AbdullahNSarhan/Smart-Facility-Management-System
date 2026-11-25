// LCI-SFM Administration & Operator Pages (/app/diagnostics, /app/users, /app/settings, /app/profile)
// Fixes WebSocket channel counts, separates Dashboard Operators from Facility People/Credentials (/api/v1/people),
// and adds truthful server-side LAN destination configuration.

import { api } from '../api.js';
import {
  store,
  subscribe,
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
  segmentedFilter,
  renderAdaptiveCollection
} from '../components/ui.js';
import {
  EMPTY_ILLUSTRATIONS,
  NODE_ILLUSTRATIONS,
  resolveDeviceVisual,
  renderNodeIllustration,
  renderCategoryChip,
  renderCategoryIconBadge
} from '../visuals.js';

// ============================================================================
// SYSTEM DIAGNOSTICS (/app/diagnostics)
// ============================================================================
export function renderDiagnosticsPage({ navigate }) {
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let disposed = false;
  let inFlight = false;
  let pendingWsRefresh = false;
  let prevWsAllReady =
    store.wsTelemetry === 'CONNECTED' &&
    store.wsNotifications === 'CONNECTED' &&
    store.wsMfa === 'CONNECTED';

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
          onClick: () => load(false)
        }, [svgIcon('icon-refresh', 15)])
      ]
    })
  );
  container.appendChild(contentSlot);

  async function load(silent = false) {
    if (disposed) return;
    inFlight = true;
    if (!silent) {
      clear(contentSlot);
      contentSlot.appendChild(loadingSkeleton('table', 4));
    }

    const [readyRes, diagRes, relRes] = await Promise.allSettled([
      api.getHealthReady(),
      api.getDiagnostics(),
      api.getReleaseInfo()
    ]);
    inFlight = false;
    if (disposed) return;

    const ready = readyRes.status === 'fulfilled' ? readyRes.value : null;
    const diag = diagRes.status === 'fulfilled' ? diagRes.value : null;
    const rel = relRes.status === 'fulfilled' ? relRes.value : null;

    clear(contentSlot);
    if (!diag && !ready) {
      contentSlot.appendChild(
        errorPanel({
          title: 'Diagnostics unavailable',
          message: diagRes.reason?.message || 'Unable to query /api/v1/diagnostics.',
          onRetry: () => load(false)
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
    const subscribedTopics = Array.isArray(mqtt.subscribed_topics) ? mqtt.subscribed_topics : [];
    const failedSubs = Array.isArray(mqtt.failed_subscriptions)
      ? mqtt.failed_subscriptions
      : mqtt.failed_subscriptions && typeof mqtt.failed_subscriptions === 'object'
        ? Object.entries(mqtt.failed_subscriptions).map(([topic, err]) => (err ? `${topic} (${err})` : topic))
        : [];
    const extensibleAdapters =
      Array.isArray(rel?.adapters) && rel.adapters.length > 0
        ? rel.adapters.map((a) => a.id).join(', ')
        : 'MQTT_V1, HTTP_JSON_V1, CAMERA_JPEG';
    const hasLegacyDevices = (diag?.devices || []).some((d) => d.transport === 'LEGACY_V1');

    contentSlot.appendChild(
      el('div', { class: 'rooms-grid' }, [
        el('section', { class: 'card stack-sm cat-infra', id: 'diag-platform-card', style: 'border-top:2px solid var(--cat-border)' }, [
          el('div', { class: 'row-between' }, [
            el('div', { class: 'row-gap-sm' }, [
              renderCategoryIconBadge('infra', 'icon-server', 'sm'),
              el('h2', { class: 'card-title', text: 'Platform & Release Posture' })
            ]),
            statusIndicator(ready?.status === 'ready' ? 'READY' : 'DEGRADED')
          ]),
          keyValueList([
            { label: 'Release Version', value: rel?.version || diag?.version || '2.0.0-rc.1', mono: true },
            rel?.stage ? { label: 'Release Stage', value: `Stage ${rel.stage}`, mono: true } : null,
            rel?.physical_acceptance ? { label: 'Physical Acceptance', value: String(rel.physical_acceptance) } : null,
            { label: 'Extensible Adapters', value: extensibleAdapters, mono: true },
            hasLegacyDevices ? { label: 'Built-in Transport', value: 'LEGACY_V1 (Built-in)', mono: true } : null,
            { label: 'Readiness HTTP', value: `${ready?.httpStatus || 200} (${ready?.status || 'unknown'})`, mono: true },
            { label: 'Uptime', value: formatUptime(diag?.uptime_seconds), mono: true },
            { label: 'Started At', value: formatTimestamp(diag?.started_at), mono: true },
            { label: 'Monitor Tick', value: diag?.monitoring_error ? `Error: ${diag.monitoring_error}` : 'Nominal' }
          ])
        ]),
        el('section', { class: 'card stack-sm cat-infra', id: 'diag-sqlite-card', style: 'border-top:2px solid var(--cat-border)' }, [
          el('div', { class: 'row-between' }, [
            el('div', { class: 'row-gap-sm' }, [
              renderCategoryIconBadge('infra', 'icon-database', 'sm'),
              el('h2', { class: 'card-title', text: 'SQLite Database' })
            ]),
            statusIndicator(sqlite.ok ? 'HEALTHY' : 'ERROR')
          ]),
          keyValueList([
            { label: 'Health Check', value: sqlite.ok ? 'Passing' : 'Failed' },
            { label: 'Journal Mode', value: String(sqlite.journal_mode || 'wal').toUpperCase(), mono: true },
            { label: 'Foreign Keys', value: sqlite.foreign_keys ? 'Enabled' : 'Disabled' },
            { label: 'Retention Window', value: `${diag?.retention_days ?? rel?.retention_days ?? 90} days`, mono: true }
          ])
        ]),
        el('section', { class: 'card stack-sm cat-network', id: 'diag-mqtt-ws-card', style: 'border-top:2px solid var(--cat-border)' }, [
          el('div', { class: 'row-between' }, [
            el('div', { class: 'row-gap-sm' }, [
              renderCategoryIconBadge('network', 'icon-broadcast', 'sm'),
              el('h2', { class: 'card-title', text: 'MQTT Broker & WebSockets' })
            ]),
            statusIndicator(mqttState)
          ]),
          keyValueList([
            { label: 'MQTT Enabled', value: mqtt.enabled === false ? 'No (Standby)' : 'Yes' },
            { label: 'Subscriptions', value: mqtt.subscriptions_ready ? 'Verified' : mqtt.enabled === false ? 'N/A' : 'Degraded' },
            {
              label: 'Subscribed Topics',
              value: subscribedTopics.length > 0 ? `${subscribedTopics.length} active (${subscribedTopics.join(', ')})` : mqtt.subscriptions_ready ? 'Active' : 'None',
              mono: subscribedTopics.length > 0
            },
            {
              label: 'Failed Subscriptions',
              value: failedSubs.length > 0 ? failedSubs.join(', ') : 'None',
              mono: failedSubs.length > 0
            },
            mqtt.last_error ? { label: 'Last Broker Error', value: String(mqtt.last_error) } : null,
            { label: 'WS Telemetry Clients', value: String(ws.telemetryClients ?? 0), mono: true },
            { label: 'WS Notification Clients', value: String(ws.notificationClients ?? 0), mono: true },
            { label: 'WS MFA Clients', value: String(ws.mfaClients ?? 0), mono: true }
          ])
        ]),
        el('section', { class: 'card stack-sm cat-access', id: 'diag-posture-card', style: 'border-top:2px solid var(--cat-border)' }, [
          el('div', { class: 'row-between' }, [
            el('div', { class: 'row-gap-sm' }, [
              renderCategoryIconBadge('access', 'icon-shield', 'sm'),
              el('h2', { class: 'card-title', text: 'Deployment Posture' })
            ]),
            statusIndicator('INFO', dep.node_env || 'production')
          ]),
          keyValueList([
            { label: 'Session Secure Cookie', value: dep.session_secure_cookie ? 'HTTPS Required' : 'LAN HTTP Allowed' },
            { label: 'Bearer Compat', value: dep.allow_bearer_compat ? 'Enabled' : 'Disabled (Strict Cookie)' },
            { label: 'Idle Session TTL', value: `${dep.session_idle_minutes ?? 30} min`, mono: true },
            { label: 'Absolute Session TTL', value: `${dep.session_absolute_hours ?? 8} hr`, mono: true },
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
          emptyNode: emptyState({
            illustration: EMPTY_ILLUSTRATIONS.DEVICES,
            title: 'No registered devices',
            message: 'Devices will appear here once registered.'
          }),
          columns: [
            {
              label: 'Device & Category',
              render: (d) => {
                const vis = resolveDeviceVisual(d);
                return el('div', { class: 'device-identity-cell' }, [
                  renderNodeIllustration(vis, { size: 'sm' }),
                  el('div', { class: 'stack-xs' }, [
                    el('div', { class: 'row-gap-sm' }, [
                      el('span', { class: 'font-semibold', text: d.name }),
                      renderCategoryChip(vis.category, vis.categoryLabel)
                    ]),
                    el('span', { class: 'mono text-xs text-muted', text: d.device_id })
                  ])
                ]);
              }
            },
            { label: 'Transport', render: (d) => el('span', { class: 'meta-tag mono', text: d.transport }) },
            { label: 'Status', render: (d) => statusIndicator(d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true }) },
            { label: 'MQTT Identity', render: (d) => statusIndicator(d.mqtt_identity_status || 'NOT_APPLICABLE', null, { compact: true }) },
            {
              label: 'Endpoints',
              className: 'mono text-xs tabular-nums',
              render: (d) => `${(d.endpoints || []).filter((e) => e.fresh).length}/${(d.endpoints || []).length} fresh`
            },
            { label: 'Last Seen', className: 'mono text-xs text-secondary', render: (d) => formatAge(d.last_seen_at) },
            {
              label: 'Actions',
              align: 'right',
              render: (d) =>
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: 'Inspect',
                  onClick: (e) => {
                    e.stopPropagation();
                    navigate(`/app/devices/${encodeURIComponent(d.device_id)}`);
                  }
                })
            }
          ],
          renderMobileCard: (d) => {
            const vis = resolveDeviceVisual(d);
            return el('article', { class: 'card record-card' }, [
              el('div', { class: 'record-card-head' }, [
                el('div', { class: 'device-identity-cell' }, [
                  renderNodeIllustration(vis, { size: 'sm' }),
                  el('div', { class: 'stack-xs' }, [
                    el('div', { class: 'font-semibold', text: d.name }),
                    el('div', { class: 'mono text-xs text-muted', text: `${d.device_id} · ${d.transport} · ${formatAge(d.last_seen_at)}` })
                  ])
                ]),
                statusIndicator(d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true })
              ]),
              el('div', { class: 'record-card-actions' }, [
                el('button', {
                  type: 'button',
                  class: 'btn btn-primary btn-sm',
                  text: 'Inspect Device',
                  onClick: () => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`)
                })
              ])
            ]);
          }
        })
      ])
    );
    if (pendingWsRefresh) {
      pendingWsRefresh = false;
      const wsReady =
        store.wsTelemetry === 'CONNECTED' &&
        store.wsNotifications === 'CONNECTED' &&
        store.wsMfa === 'CONNECTED';
      if (wsReady && (Number(ws.telemetryClients ?? 0) < 1 || Number(ws.notificationClients ?? 0) < 1 || Number(ws.mfaClients ?? 0) < 1)) {
        load(true);
      }
    }
  }

  const unsubStore = subscribe(() => {
    if (disposed) return;
    const allReady =
      store.wsTelemetry === 'CONNECTED' &&
      store.wsNotifications === 'CONNECTED' &&
      store.wsMfa === 'CONNECTED';
    if (allReady && !prevWsAllReady) {
      prevWsAllReady = true;
      if (inFlight) {
        pendingWsRefresh = true;
      } else {
        load(true);
      }
    } else if (!allReady) {
      prevWsAllReady = false;
    }
  });

  load(false);

  return {
    node: container,
    cleanup: () => {
      disposed = true;
      unsubStore();
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
  let peopleStatusFilter = 'ALL'; // ALL | ACTIVE | SUSPENDED
  let peoplePage = 1;
  const peopleLimit = 25;
  let loadedPeople = [];
  let peopleTotal = 0;
  let searchDebounceTimer = null;
  const pendingCredentialIds = new Set();
  const pendingPersonIds = new Set();

  const tabSlot = el('div');
  const bodySlot = el('div', { class: 'stack-md' });
  const peopleResultsSlot = el('div', { class: 'stack-md' });

  function formatCredentialIdentifier(cred) {
    const mod = String(cred?.modality || 'CREDENTIAL').toUpperCase();
    if (mod === 'RFID') {
      const masked = cred?.masked_uid || cred?.masked_label || '••:••:•••••';
      return `RFID · ${masked}`;
    }
    if (mod === 'PIN') {
      return 'PIN · ••••••';
    }
    return mod;
  }

  function openCreateOperatorModal(onDone) {
    const userIn = el('input', { id: 'op-create-username', class: 'input', type: 'text', placeholder: 'e.g. ops_engineer', required: true });
    const passIn = el('input', { id: 'op-create-password', class: 'input', type: 'password', placeholder: 'Minimum 12 characters', required: true });
    const roleSel = el('select', { id: 'op-create-role', class: 'select' }, [
      el('option', { value: 'Viewer', text: 'Viewer (Read-only operations)' }),
      el('option', { value: 'Admin', text: 'Admin (Full management & control)' })
    ]);
    const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });

    const body = el('div', { class: 'stack-md' }, [
      errBox,
      el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'op-create-username', text: 'Username *' }), userIn]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'op-create-password', text: 'Password * (min 12 characters)' }),
        passIn
      ]),
      el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'op-create-role', text: 'Console Role *' }), roleSel]),
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
        saveBtn.textContent = 'Saving…';
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
          saveBtn.textContent = 'Create Operator';
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
    const nameIn = el('input', { id: 'person-create-name', class: 'input', type: 'text', placeholder: 'e.g. Dr. Nadia Mansour', required: true });
    const refIn = el('input', { id: 'person-create-ref', class: 'input', type: 'text', maxlength: 80, placeholder: 'Employee ID / Badge Reference (optional)' });
    const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });

    const body = el('div', { class: 'stack-md' }, [
      errBox,
      el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'person-create-name', text: 'Display Name *' }), nameIn]),
      el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'person-create-ref', text: 'Reference / Department' }), refIn])
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
        saveBtn.textContent = 'Saving…';
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
          saveBtn.textContent = 'Add Person';
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

  function openEditPersonModal(person, onDone) {
    const nameIn = el('input', {
      id: 'person-edit-name',
      class: 'input',
      type: 'text',
      value: person.display_name || '',
      required: true
    });
    const refIn = el('input', {
      id: 'person-edit-ref',
      class: 'input',
      type: 'text',
      maxlength: 80,
      value: person.reference || '',
      placeholder: 'Employee ID / Department'
    });
    const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });

    const body = el('div', { class: 'stack-md' }, [
      errBox,
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'person-edit-name', text: 'Display Name *' }),
        nameIn
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'person-edit-ref', text: 'Reference / Department' }),
        refIn
      ])
    ]);

    const saveBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Save Person',
      onClick: async () => {
        errBox.hidden = true;
        const display_name = nameIn.value.trim();
        const reference = refIn.value.trim();
        if (!display_name) {
          errBox.textContent = 'Display Name is required.';
          errBox.hidden = false;
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          await api.updatePerson(person.subject_id, {
            display_name,
            reference,
            status: person.status || 'ACTIVE',
            version: person.version
          });
          showToast('Person updated', display_name, 'success');
          closeModal();
          onDone();
        } catch (err) {
          errBox.textContent =
            err.status === 409
              ? 'This person record changed in another session. Close, refresh, and try again.'
              : err.message;
          errBox.hidden = false;
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Person';
        }
      }
    });

    openModal({
      title: `Edit Facility Person · ${person.display_name}`,
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
    const modSelectId = `cred-modality-${Date.now()}`;
    const valInputId = `cred-value-${Date.now()}`;
    const modSel = el('select', { id: modSelectId, class: 'select' }, [
      el('option', { value: 'RFID', text: 'RFID Card UID (4, 7, or 10 hex bytes)' }),
      el('option', { value: 'PIN', text: 'Keypad PIN (6 digits — stored as scrypt hash)' })
    ]);
    const valIn = el('input', {
      id: valInputId,
      class: 'input mono',
      type: 'text',
      autocomplete: 'off',
      placeholder: 'e.g. A1:B2:C3:D4'
    });
    const valLbl = el('label', { class: 'form-label', for: valInputId, text: 'Card UID *' });
    const valHint = el('span', {
      class: 'form-hint',
      text: 'Colon-separated hex bytes (4, 7, or 10 bytes, e.g. A1:B2:C3:D4).'
    });
    const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });

    modSel.addEventListener('change', () => {
      modality = modSel.value;
      valIn.value = '';
      errBox.hidden = true;
      if (modality === 'PIN') {
        valIn.type = 'password';
        valIn.inputMode = 'numeric';
        valIn.maxLength = 6;
        valIn.placeholder = '6 numeric digits';
        valLbl.textContent = 'Keypad PIN *';
        valHint.textContent = 'Exactly 6 digits (0–9). Stored as a salted scrypt hash; assigning a new PIN revokes any prior active PIN.';
      } else {
        valIn.type = 'text';
        valIn.removeAttribute('inputmode');
        valIn.removeAttribute('maxlength');
        valIn.placeholder = 'e.g. A1:B2:C3:D4';
        valLbl.textContent = 'Card UID *';
        valHint.textContent = 'Colon-separated hex bytes (4, 7, or 10 bytes, e.g. A1:B2:C3:D4).';
      }
    });

    const body = el('div', { class: 'stack-md' }, [
      errBox,
      disclaimerBanner({
        icon: 'icon-clock',
        tone: 'pending',
        message: 'New credentials are saved centrally and marked Pending Device Sync until edge controller policy sync is completed.'
      }),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: modSelectId, text: 'Credential Modality' }),
        modSel
      ]),
      el('div', { class: 'form-field' }, [valLbl, valIn, valHint])
    ]);

    const rfidPattern = /^(?:[0-9A-F]{2}:){3}[0-9A-F]{2}$|^(?:[0-9A-F]{2}:){6}[0-9A-F]{2}$|^(?:[0-9A-F]{2}:){9}[0-9A-F]{2}$/;
    const pinPattern = /^\d{6}$/;

    const saveBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Save Credential',
      onClick: async () => {
        errBox.hidden = true;
        const rawVal = valIn.value.trim();
        if (modality === 'PIN' && !pinPattern.test(rawVal)) {
          errBox.textContent = 'PIN must be exactly six numeric digits (e.g. 042819).';
          errBox.hidden = false;
          return;
        }
        const normalizedUid = rawVal.toUpperCase();
        if (modality === 'RFID' && !rfidPattern.test(normalizedUid)) {
          errBox.textContent = 'RFID UID must contain 4, 7, or 10 colon-separated hex bytes (e.g. A1:B2:C3:D4).';
          errBox.hidden = false;
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          const payload =
            modality === 'PIN'
              ? { modality: 'PIN', pin: rawVal }
              : { modality: 'RFID', card_uid: normalizedUid };
          const res = await api.addCredential(person.subject_id, payload);
          showToast(
            'Credential assigned',
            `${formatCredentialIdentifier(res?.credential || payload)} saved as Assigned (Pending Device Sync).`,
            'success'
          );
          closeModal();
          onDone();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Credential';
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
        el('div', { class: 'device-identity-cell' }, [
          renderNodeIllustration({ category: 'access', illustration: NODE_ILLUSTRATIONS.RFID_READER }, { size: 'md' }),
          el('div', { class: 'stack-xs' }, [
            renderCategoryChip('access', 'RFID_ENROLL_V1 Reader Session'),
            el('span', { class: 'text-xs text-secondary', text: 'Present one RFID credential only when the reader reports READY.' })
          ])
        ]),
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
        const response = await api.startEnrollment(person.subject_id);
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

        const renderOperatorActionButtons = (u) => {
          const isSelf = store.user?.username === u.username;
          const nextRole = u.role === 'Admin' ? 'Viewer' : 'Admin';
          return [
            el('button', {
              type: 'button',
              class: 'btn btn-secondary btn-sm',
              disabled: isSelf,
              title: isSelf ? 'Cannot change your own active role' : undefined,
              text: u.role === 'Admin' ? 'Demote to Viewer' : 'Promote to Admin',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: `Change "${u.username}" role to ${nextRole}?`,
                  subtitle: 'Operator Access & Session Revocation',
                  message: `Changing "${u.username}" from ${u.role} to ${nextRole} takes effect immediately and revokes all active console sessions for this operator.`,
                  confirmLabel: `Set Role to ${nextRole}`,
                  specs: [
                    ['Operator', u.username],
                    ['Current Role', u.role],
                    ['Target Role', nextRole]
                  ]
                });
                if (!ok) return;
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
          ];
        };

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
                render: (u) => el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, renderOperatorActionButtons(u))
              }
            ],
            renderMobileCard: (u) =>
              el('article', { class: 'card record-card' }, [
                el('div', { class: 'record-card-head' }, [
                  el('div', { class: 'font-semibold', text: u.username }),
                  statusIndicator(u.role === 'Admin' ? 'ADMIN' : 'VIEWER', u.role, { compact: true })
                ]),
                el('div', { class: 'text-xs text-muted mono', text: `Created: ${formatTimestamp(u.created_at)}` }),
                el('div', { class: 'record-card-actions' }, renderOperatorActionButtons(u))
              ])
          })
        );
      } else {
        clear(bodySlot);

        const searchIn = el('input', {
          id: 'people-search-input',
          class: 'input',
          type: 'search',
          value: peopleSearch,
          placeholder: 'Search facility people by name or reference...',
          'aria-label': 'Search facility people'
        });

        const clearSearchBtn = el('button', {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          text: 'Clear',
          hidden: !peopleSearch && peopleStatusFilter === 'ALL',
          onClick: () => {
            peopleSearch = '';
            peopleStatusFilter = 'ALL';
            peoplePage = 1;
            searchIn.value = '';
            clearSearchBtn.hidden = true;
            renderStatusFilter();
            fetchPeopleList();
          }
        });

        const filterMount = el('div');
        function renderStatusFilter() {
          clear(filterMount);
          filterMount.appendChild(
            segmentedFilter({
              ariaLabel: 'Filter people by status',
              value: peopleStatusFilter,
              options: [
                { value: 'ALL', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'SUSPENDED', label: 'Suspended' }
              ],
              onChange: (nextVal) => {
                peopleStatusFilter = nextVal;
                clearSearchBtn.hidden = !peopleSearch && peopleStatusFilter === 'ALL';
                renderPeopleResults();
              }
            })
          );
        }
        renderStatusFilter();

        searchIn.addEventListener('input', () => {
          peopleSearch = searchIn.value.trim();
          peoplePage = 1;
          clearSearchBtn.hidden = !peopleSearch && peopleStatusFilter === 'ALL';
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = setTimeout(() => fetchPeopleList(), 220);
        });

        bodySlot.appendChild(
          disclaimerBanner({
            icon: 'icon-clock',
            tone: 'pending',
            title: 'Physical Credential Policy Boundary',
            message:
              'Credentials managed here are stored centrally with status Pending Device Sync. Assigned credentials may be Blocked or permanently Revoked; raw PINs and secret hashes are never returned to the browser.'
          })
        );

        bodySlot.appendChild(
          el('div', { class: 'card card-compact row-between' }, [
            el('div', { class: 'filter-bar', style: 'flex:1 1 320px' }, [searchIn, filterMount, clearSearchBtn]),
            el('button', {
              type: 'button',
              class: 'btn btn-primary btn-sm',
              onClick: () => openCreatePersonModal(() => fetchPeopleList())
            }, [svgIcon('icon-plus', 14), el('span', { text: 'Add Person' })])
          ])
        );

        bodySlot.appendChild(peopleResultsSlot);
        await fetchPeopleList();
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

  async function handleCredentialStateChange(person, cred, nextStatus) {
    const credId = cred.credential_id || cred.id;
    if (!credId || pendingCredentialIds.has(credId)) return;

    const credDisplay = formatCredentialIdentifier(cred);
    const isRevoke = nextStatus === 'REVOKED';

    const confirmed = await confirmDialog({
      title: isRevoke ? `Permanently revoke ${credDisplay}?` : `Block ${credDisplay}?`,
      subtitle: `Physical Credential · ${person.display_name}`,
      message: isRevoke
        ? `Revoking permanently deactivates this ${cred.modality} credential in the central directory (Pending Device Sync). A revoked credential cannot be re-enabled; issue a new credential if access is required later.`
        : `Blocking marks this ${cred.modality} credential as BLOCKED in the central directory (Pending Device Sync). For RFID cards, the card UID remains reserved until permanently revoked.`,
      confirmLabel: isRevoke ? 'Revoke Credential' : 'Block Credential',
      danger: isRevoke,
      specs: [
        ['Person', person.display_name],
        ['Credential', credDisplay],
        ['Current Status', String(cred.status || 'ASSIGNED')],
        ['Target Status', nextStatus]
      ]
    });
    if (!confirmed || disposed) return;

    pendingCredentialIds.add(credId);
    renderPeopleResults();

    try {
      const res = await api.setCredentialState(credId, nextStatus);
      if (disposed) return;
      const updatedCred = res?.credential || { ...cred, status: nextStatus, updated_at: new Date().toISOString() };
      loadedPeople = loadedPeople.map((p) => {
        if (p.subject_id !== person.subject_id) return p;
        return {
          ...p,
          credentials: (p.credentials || []).map((c) => ((c.credential_id || c.id) === credId ? updatedCred : c))
        };
      });
      showToast(
        isRevoke ? 'Credential revoked' : 'Credential blocked',
        `${formatCredentialIdentifier(updatedCred)} for ${person.display_name} is now ${updatedCred.status}.`,
        isRevoke ? 'info' : 'warning'
      );
    } catch (err) {
      if (!disposed) {
        showToast(`${isRevoke ? 'Revoke' : 'Block'} failed`, err.message, 'error');
      }
    } finally {
      pendingCredentialIds.delete(credId);
      if (!disposed) renderPeopleResults();
    }
  }

  async function handleTogglePersonStatus(person) {
    if (!person?.subject_id || pendingPersonIds.has(person.subject_id)) return;
    const nextStatus = person.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    pendingPersonIds.add(person.subject_id);
    renderPeopleResults();
    try {
      const res = await api.updatePerson(person.subject_id, {
        display_name: person.display_name,
        reference: person.reference || '',
        status: nextStatus,
        version: person.version
      });
      if (disposed) return;
      const updatedPerson = res?.person || { ...person, status: nextStatus, version: Number(person.version || 1) + 1 };
      loadedPeople = loadedPeople.map((p) => (p.subject_id === person.subject_id ? updatedPerson : p));
      showToast('Person updated', `${person.display_name} is now ${updatedPerson.status}.`, 'success');
    } catch (err) {
      if (!disposed) {
        showToast('Update failed', err.message, 'error');
      }
    } finally {
      pendingPersonIds.delete(person.subject_id);
      if (!disposed) renderPeopleResults();
    }
  }

  function renderPersonCredentialsList(person) {
    const creds = person.credentials || [];
    if (!creds.length) {
      return el('span', { class: 'text-xs text-muted', text: 'None issued' });
    }

    return el(
      'div',
      { class: 'credential-list' },
      creds.map((c) => {
        const credId = c.credential_id || c.id;
        const status = String(c.status || 'ASSIGNED').toUpperCase();
        const syncStatus = String(c.sync_status || 'PENDING_DEVICE_SYNC').toUpperCase();
        const isPending = pendingCredentialIds.has(credId);
        const canBlock = status === 'ASSIGNED';
        const canRevoke = status === 'ASSIGNED' || status === 'BLOCKED';
        const identText = formatCredentialIdentifier(c);

        return el(
          'div',
          {
            class: `credential-row${status === 'REVOKED' ? ' credential-row-revoked' : ''}`,
            'data-credential-id': credId,
            'data-credential-status': status
          },
          [
            el('div', { class: 'credential-meta' }, [
              el('span', { class: 'meta-tag mono', text: identText }),
              statusIndicator(status, null, { compact: true }),
              statusIndicator(
                syncStatus,
                syncStatus === 'PENDING_DEVICE_SYNC' ? 'Pending Sync' : null,
                { compact: true }
              )
            ]),
            canBlock || canRevoke
              ? el('div', { class: 'credential-actions' }, [
                  canBlock
                    ? el('button', {
                        type: 'button',
                        class: 'btn btn-secondary btn-xs',
                        disabled: isPending,
                        'aria-busy': isPending ? 'true' : undefined,
                        'aria-label': `Block ${c.modality} credential for ${person.display_name}`,
                        text: isPending ? 'Updating…' : 'Block',
                        onClick: () => handleCredentialStateChange(person, c, 'BLOCKED')
                      })
                    : null,
                  canRevoke
                    ? el('button', {
                        type: 'button',
                        class: 'btn btn-danger-ghost btn-xs',
                        disabled: isPending,
                        'aria-busy': isPending ? 'true' : undefined,
                        'aria-label': `Revoke ${c.modality} credential for ${person.display_name}`,
                        text: isPending ? 'Updating…' : 'Revoke',
                        onClick: () => handleCredentialStateChange(person, c, 'REVOKED')
                      })
                    : null
                ])
              : null
          ]
        );
      })
    );
  }

  function renderPersonActionButtons(person, { compactScanLabel = false } = {}) {
    const isPersonPending = pendingPersonIds.has(person.subject_id);
    const isSuspended = person.status !== 'ACTIVE';
    return [
      el('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        disabled: isSuspended || isPersonPending,
        title: isSuspended ? 'Activate this person before adding credentials' : undefined,
        text: '+ Credential',
        onClick: () => openAddCredentialModal(person, () => fetchPeopleList())
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        disabled: isSuspended || isPersonPending,
        title: isSuspended ? 'Activate this person before reader enrollment' : undefined,
        text: compactScanLabel ? 'Scan RFID' : 'Scan on Reader',
        onClick: () => openReaderEnrollmentModal(person, () => fetchPeopleList())
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        disabled: isPersonPending,
        text: 'Edit',
        'aria-label': `Edit ${person.display_name}`,
        onClick: () => openEditPersonModal(person, () => fetchPeopleList())
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        disabled: isPersonPending,
        text: isPersonPending ? 'Saving…' : person.status === 'ACTIVE' ? 'Suspend' : 'Activate',
        onClick: () => handleTogglePersonStatus(person)
      })
    ];
  }

  function renderPeopleResults() {
    if (disposed) return;
    clear(peopleResultsSlot);

    const visiblePeople =
      peopleStatusFilter === 'ALL'
        ? loadedPeople
        : loadedPeople.filter((p) => String(p.status || 'ACTIVE').toUpperCase() === peopleStatusFilter);

    const hasActiveFilter = Boolean(peopleSearch) || peopleStatusFilter !== 'ALL';
    const totalPages = Math.max(1, Math.ceil((peopleTotal || loadedPeople.length) / peopleLimit));

    if (loadedPeople.length > 0 || peopleTotal > 0) {
      peopleResultsSlot.appendChild(
        el('div', { class: 'row-between' }, [
          el('span', {
            class: 'text-xs text-muted mono tabular-nums',
            text: `Showing ${visiblePeople.length} of ${peopleTotal || loadedPeople.length} registered personnel`
          }),
          totalPages > 1
            ? el('div', { class: 'btn-row' }, [
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  disabled: peoplePage <= 1,
                  text: 'Prev',
                  onClick: () => {
                    peoplePage = Math.max(1, peoplePage - 1);
                    fetchPeopleList();
                  }
                }),
                el('span', { class: 'mono text-xs text-muted tabular-nums', text: `Page ${peoplePage} / ${totalPages}` }),
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  disabled: peoplePage >= totalPages,
                  text: 'Next',
                  onClick: () => {
                    peoplePage = Math.min(totalPages, peoplePage + 1);
                    fetchPeopleList();
                  }
                })
              ])
            : null
        ])
      );
    }

    peopleResultsSlot.appendChild(
      renderAdaptiveCollection({
        ariaLabel: 'Facility people and physical credentials',
        rows: visiblePeople,
        emptyNode: hasActiveFilter
          ? emptyState({
              icon: 'icon-filter',
              title: 'No matching personnel found',
              message: 'No facility personnel matched your active search query or status filter.',
              actionLabel: 'Reset Search & Filter',
              onAction: () => {
                peopleSearch = '';
                peopleStatusFilter = 'ALL';
                loadTab();
              }
            })
          : emptyState({
              illustration: NODE_ILLUSTRATIONS.RFID_READER,
              title: 'No facility personnel registered',
              message:
                'Add people here to issue RFID card or keypad PIN credentials separately from dashboard operator logins.',
              actionLabel: 'Add Person',
              onAction: () => openCreatePersonModal(() => fetchPeopleList())
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
            render: (p) => renderPersonCredentialsList(p)
          },
          {
            label: 'Actions',
            align: 'right',
            render: (p) =>
              el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, renderPersonActionButtons(p))
          }
        ],
        renderMobileCard: (p) =>
          el('article', { class: 'card record-card' }, [
            el('div', { class: 'record-card-head' }, [
              el('div', { class: 'stack-xs' }, [
                el('div', { class: 'font-semibold', text: p.display_name }),
                p.reference ? el('div', { class: 'text-xs text-muted mono', text: p.reference }) : null
              ]),
              statusIndicator(p.status || 'ACTIVE', null, { compact: true })
            ]),
            renderPersonCredentialsList(p),
            el('div', { class: 'record-card-actions' }, renderPersonActionButtons(p, { compactScanLabel: true }))
          ])
      })
    );
  }

  async function fetchPeopleList() {
    if (disposed) return;
    clear(peopleResultsSlot);
    peopleResultsSlot.appendChild(loadingSkeleton('table', 3));
    try {
      const res = await api.listPeople({ search: peopleSearch, page: peoplePage, limit: peopleLimit });
      if (disposed) return;
      loadedPeople = Array.isArray(res?.people) ? res.people : [];
      peopleTotal = Number(res?.total ?? loadedPeople.length);
      renderPeopleResults();
    } catch (err) {
      if (disposed) return;
      clear(peopleResultsSlot);
      peopleResultsSlot.appendChild(
        errorPanel({
          title: 'Failed to load facility personnel',
          message: err.message,
          onRetry: fetchPeopleList
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
      clearTimeout(searchDebounceTimer);
    }
  };
}

// ============================================================================
// FACILITY SETTINGS (/app/settings)
// ============================================================================
function isPrivateLanUnicastIp(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => (/^(0|[1-9]\d{0,2})$/.test(p) ? Number(p) : -1));
  if (octets.some((n) => n < 0 || n > 255)) return false;
  const [a, b, , d] = octets;
  return (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) && d !== 0 && d !== 255;
}

export function renderSettingsPage() {
  const container = el('div', { class: 'stack-lg' });
  let disposed = false;

  if (!isAdmin()) {
    container.appendChild(
      el('div', { class: 'card' }, [
        emptyState({
          icon: 'icon-shield',
          title: 'Administrator Role Required',
          message: 'Facility profile, data retention policy, and registered node destination settings require an Admin account.'
        })
      ])
    );
    return { node: container };
  }

  const contentSlot = el('div', { class: 'stack-lg' });
  container.appendChild(
    pageHeader({
      title: 'Facility Settings',
      description: 'Configure facility profile metadata, SQLite data retention policy, and centralized baseline node destinations.'
    })
  );
  container.appendChild(contentSlot);

  async function load() {
    if (disposed) return;
    clear(contentSlot);
    contentSlot.appendChild(loadingSkeleton('table', 4));

    const [facRes, mgmtRes, relRes] = await Promise.allSettled([
      api.getFacility(),
      api.getManagementSettings(),
      api.getReleaseInfo()
    ]);
    if (disposed) return;

    clear(contentSlot);

    // 1. Facility Profile Card
    if (facRes.status === 'fulfilled') {
      const f = facRes.value.facility;
      const nameIn = el('input', { id: 'settings-facility-name', class: 'input', type: 'text', value: f.name || '', required: true });
      const locIn = el('input', { id: 'settings-facility-location', class: 'input', type: 'text', value: f.location || '' });
      const tzIn = el('input', { id: 'settings-facility-tz', class: 'input mono', type: 'text', value: f.timezone || 'UTC' });
      const descIn = el('textarea', { id: 'settings-facility-desc', class: 'textarea', value: f.description || '' });
      const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });
      const saveBtn = el('button', {
        type: 'button',
        class: 'btn btn-primary btn-sm',
        text: 'Save Facility Profile',
        onClick: async () => {
          errBox.hidden = true;
          const cleanName = nameIn.value.trim();
          if (!cleanName) {
            errBox.textContent = 'Facility Name is required.';
            errBox.hidden = false;
            return;
          }
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';
          try {
            await api.updateFacility({
              name: cleanName,
              location: locIn.value.trim(),
              timezone: tzIn.value.trim() || 'UTC',
              description: descIn.value.trim(),
              version: f.version
            });
            showToast('Facility profile saved', cleanName, 'success');
            load();
          } catch (err) {
            errBox.textContent =
              err.status === 409
                ? 'Facility settings changed in another session. Refresh before saving.'
                : err.message;
            errBox.hidden = false;
          } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Facility Profile';
          }
        }
      });

      contentSlot.appendChild(
        el('section', { class: 'card stack-md', id: 'settings-facility-card' }, [
          el('div', { class: 'row-between' }, [
            el('h2', { class: 'card-title', text: 'Facility Profile' }),
            el('span', { class: 'mono text-xs text-muted', text: `Revision v${f.version}` })
          ]),
          errBox,
          el('div', { class: 'form-grid' }, [
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'settings-facility-name', text: 'Facility Name *' }), nameIn]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'settings-facility-tz', text: 'Timezone' }), tzIn]),
            el('div', { class: 'form-field form-field-full' }, [el('label', { class: 'form-label', for: 'settings-facility-location', text: 'Location / Site' }), locIn]),
            el('div', { class: 'form-field form-field-full' }, [el('label', { class: 'form-label', for: 'settings-facility-desc', text: 'Description' }), descIn])
          ]),
          el('div', { class: 'btn-row' }, [saveBtn])
        ])
      );
    } else {
      contentSlot.appendChild(
        errorPanel({ title: 'Facility profile unavailable', message: facRes.reason?.message, onRetry: load })
      );
    }

    // 2. Data Retention Policy Card (PUT /api/v1/retention — days: integer 7..365)
    if (relRes.status === 'fulfilled') {
      const currentDays = Number(relRes.value?.retention_days ?? 90);
      const retentionPresets = [14, 30, 90, 180, 365];
      const daysInput = el('input', {
        id: 'settings-retention-days',
        class: 'input mono tabular-nums',
        type: 'number',
        min: 7,
        max: 365,
        step: 1,
        value: String(currentDays)
      });
      const presetWrap = el('div', { class: 'preset-chip-row', role: 'group', 'aria-label': 'Retention day presets' });
      const retentionErrBox = el('div', { class: 'form-error', role: 'alert', hidden: true });

      const syncPresetHighlight = () => {
        const val = Number(daysInput.value);
        clear(presetWrap);
        for (const p of retentionPresets) {
          presetWrap.appendChild(
            el('button', {
              type: 'button',
              class: `btn btn-xs ${val === p ? 'btn-primary' : 'btn-secondary'}`,
              'aria-pressed': val === p ? 'true' : 'false',
              text: `${p} days`,
              onClick: () => {
                daysInput.value = String(p);
                retentionErrBox.hidden = true;
                syncPresetHighlight();
              }
            })
          );
        }
      };
      daysInput.addEventListener('input', syncPresetHighlight);
      syncPresetHighlight();

      const saveRetentionBtn = el('button', {
        id: 'save-retention-btn',
        type: 'button',
        class: 'btn btn-primary btn-sm',
        text: 'Save Retention Policy',
        onClick: async () => {
          retentionErrBox.hidden = true;
          const rawStr = daysInput.value.trim();
          const nextDays = Number(rawStr);
          if (!rawStr || !Number.isInteger(nextDays) || nextDays < 7 || nextDays > 365) {
            retentionErrBox.textContent = 'Retention window must be a whole integer between 7 and 365 days.';
            retentionErrBox.hidden = false;
            return;
          }

          if (nextDays < currentDays) {
            const confirmed = await confirmDialog({
              title: `Reduce retention window from ${currentDays} to ${nextDays} days?`,
              subtitle: 'Data Retention Policy',
              danger: true,
              message:
                'Scheduled hourly cleanup removes notifications and historical device_frames older than the configured retention period (preserving the latest frame per device boot session). Alarm history and audit trails remain preserved.',
              confirmLabel: `Apply ${nextDays}-Day Retention`,
              specs: [
                ['Current Retention', `${currentDays} days`],
                ['New Retention', `${nextDays} days`],
                ['Pruned Tables', 'notifications, device_frames'],
                ['Preserved Forever', 'alarms, alarm_events, access_logs, command_audit, management_audit']
              ]
            });
            if (!confirmed || disposed) return;
          }

          saveRetentionBtn.disabled = true;
          saveRetentionBtn.textContent = 'Saving…';
          try {
            const res = await api.updateRetention(nextDays);
            showToast('Retention policy saved', res?.note || `Retention window set to ${res?.days ?? nextDays} days.`, 'success');
            load();
          } catch (err) {
            retentionErrBox.textContent = err.message || 'Failed to update retention policy.';
            retentionErrBox.hidden = false;
          } finally {
            saveRetentionBtn.disabled = false;
            saveRetentionBtn.textContent = 'Save Retention Policy';
          }
        }
      });

      contentSlot.appendChild(
        el('section', { class: 'card stack-md', id: 'settings-retention-card' }, [
          el('div', { class: 'row-between' }, [
            el('div', { class: 'stack-xs' }, [
              el('h2', { class: 'card-title', text: 'Data Retention Policy' }),
              el('span', {
                class: 'text-xs text-muted',
                text: 'Controls hourly background pruning for operator notifications and telemetry frame history.'
              })
            ]),
            statusIndicator('INFO', `Active: ${currentDays} days`, { compact: true })
          ]),
          disclaimerBanner({
            icon: 'icon-info',
            tone: 'info',
            message:
              'Scheduled cleanup removes old notifications and device_frames older than the configured retention period (retaining the latest frame per device boot session). Alarm records (alarms, alarm_events) and audit logs (access_logs, command_audit, management_audit, camera_events) are preserved.'
          }),
          retentionErrBox,
          el('div', { class: 'form-grid' }, [
            el('div', { class: 'form-field' }, [
              el('label', { class: 'form-label', for: 'settings-retention-days', text: 'Retention Window (7–365 days) *' }),
              daysInput,
              el('span', { class: 'form-hint', text: 'Supported server range: whole integer between 7 and 365 days inclusive.' })
            ]),
            el('div', { class: 'form-field' }, [
              el('span', { class: 'form-label', text: 'Quick Presets' }),
              presetWrap
            ])
          ]),
          el('div', { class: 'btn-row' }, [saveRetentionBtn])
        ])
      );
    } else {
      contentSlot.appendChild(
        errorPanel({ title: 'Retention settings unavailable', message: relRes.reason?.message, onRetry: load })
      );
    }

    // 3. Registered Server-Side Baseline Node Destinations & Display Thresholds Card
    if (mgmtRes.status === 'fulfilled') {
      const s = mgmtRes.value.settings;
      const roomNameIn = el('input', {
        id: 'settings-baseline-room-name',
        class: 'input',
        type: 'text',
        value: s.room_name || 'Smart Room 001'
      });
      const n1Name = el('input', { id: 'settings-node1-name', class: 'input', type: 'text', value: s.nodes?.node1?.name || '' });
      const n1Ip = el('input', { id: 'settings-node1-ip', class: 'input mono', type: 'text', value: s.nodes?.node1?.ip || '' });
      const n2Name = el('input', { id: 'settings-node2-name', class: 'input', type: 'text', value: s.nodes?.node2?.name || '' });
      const n2Ip = el('input', { id: 'settings-node2-ip', class: 'input mono', type: 'text', value: s.nodes?.node2?.ip || '' });
      const n3Name = el('input', { id: 'settings-node3-name', class: 'input', type: 'text', value: s.nodes?.node3?.name || '' });
      const n3Ip = el('input', { id: 'settings-node3-ip', class: 'input mono', type: 'text', value: s.nodes?.node3?.ip || '' });

      const dt = s.display_thresholds || { temperature_warning: 30, gas_warning_raw: 250, gas_critical_raw: 400 };
      const tempWarnIn = el('input', {
        id: 'settings-temp-warning',
        class: 'input mono tabular-nums',
        type: 'number',
        min: 0,
        max: 80,
        step: 'any',
        value: String(dt.temperature_warning ?? 30)
      });
      const gasWarnIn = el('input', {
        id: 'settings-gas-warning',
        class: 'input mono tabular-nums',
        type: 'number',
        min: 1,
        max: 9999,
        step: 1,
        value: String(dt.gas_warning_raw ?? 250)
      });
      const gasCritIn = el('input', {
        id: 'settings-gas-critical',
        class: 'input mono tabular-nums',
        type: 'number',
        min: 2,
        max: 10000,
        step: 1,
        value: String(dt.gas_critical_raw ?? 400)
      });
      const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });

      const saveNodesBtn = el('button', {
        type: 'button',
        class: 'btn btn-primary btn-sm',
        text: 'Save Baseline Settings',
        onClick: async () => {
          errBox.hidden = true;
          const roomName = roomNameIn.value.trim();
          const nodesPayload = {
            node1: { name: n1Name.value.trim(), ip: n1Ip.value.trim() },
            node2: { name: n2Name.value.trim(), ip: n2Ip.value.trim() },
            node3: { name: n3Name.value.trim(), ip: n3Ip.value.trim() }
          };
          if (!roomName || !nodesPayload.node1.name || !nodesPayload.node2.name || !nodesPayload.node3.name) {
            errBox.textContent = 'Baseline Room Name and all three Node Names are required.';
            errBox.hidden = false;
            return;
          }
          const ips = [nodesPayload.node1.ip, nodesPayload.node2.ip, nodesPayload.node3.ip];
          if (ips.some((ip) => !isPrivateLanUnicastIp(ip))) {
            errBox.textContent = 'Each baseline node requires a valid private unicast LAN IPv4 address (RFC1918).';
            errBox.hidden = false;
            return;
          }
          if (new Set(ips).size !== 3) {
            errBox.textContent = 'Each baseline node must have a unique private LAN IPv4 address.';
            errBox.hidden = false;
            return;
          }

          const tempWarn = Number(tempWarnIn.value);
          const gasWarn = Number(gasWarnIn.value);
          const gasCrit = Number(gasCritIn.value);
          if (!Number.isFinite(tempWarn) || tempWarn < 0 || tempWarn > 80) {
            errBox.textContent = 'Temperature warning display threshold must be between 0 and 80 °C.';
            errBox.hidden = false;
            return;
          }
          if (!Number.isInteger(gasWarn) || gasWarn < 1 || gasWarn > 9999 || !Number.isInteger(gasCrit) || gasCrit < 2 || gasCrit > 10000) {
            errBox.textContent = 'Gas warning (1–9999) and critical (2–10000) display thresholds must be whole integers.';
            errBox.hidden = false;
            return;
          }
          if (gasWarn >= gasCrit) {
            errBox.textContent = 'Gas warning threshold must be strictly below (<) gas critical threshold.';
            errBox.hidden = false;
            return;
          }

          saveNodesBtn.disabled = true;
          saveNodesBtn.textContent = 'Saving…';
          try {
            const res = await api.updateManagementSettings({
              revision: s.revision,
              facility_name: s.facility_name,
              room_name: roomName,
              nodes: nodesPayload,
              display_thresholds: {
                temperature_warning: tempWarn,
                gas_warning_raw: gasWarn,
                gas_critical_raw: gasCrit
              }
            });
            showToast('Baseline settings saved', res.note || 'Server-side destinations and display thresholds updated.', 'success');
            load();
          } catch (err) {
            errBox.textContent =
              err.status === 409
                ? 'Baseline settings changed in another session. Refresh before saving.'
                : err.message;
            errBox.hidden = false;
          } finally {
            saveNodesBtn.disabled = false;
            saveNodesBtn.textContent = 'Save Baseline Settings';
          }
        }
      });

      contentSlot.appendChild(
        el('section', { class: 'card stack-md', id: 'settings-baseline-nodes-card' }, [
          el('div', { class: 'row-between' }, [
            el('h2', { class: 'card-title', text: 'Baseline Node Destinations & Display Thresholds' }),
            el('span', { class: 'mono text-xs text-muted', text: `Revision ${s.revision}` })
          ]),
          disclaimerBanner({
            icon: 'icon-warning',
            tone: 'warn',
            message:
              'Changes server-side destination addresses and console display thresholds only. Updating these values does NOT configure physical ESP32 network interfaces, static IPs, or autonomous edge firmware thresholds.'
          }),
          errBox,
          el('div', { class: 'form-grid' }, [
            el('div', { class: 'form-field form-field-full' }, [
              el('label', { class: 'form-label', for: 'settings-baseline-room-name', text: 'Primary Baseline Room Name (ROOM-001) *' }),
              roomNameIn
            ]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'settings-node1-name', text: 'Node 1 Name (Access) *' }), n1Name]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'settings-node1-ip', text: 'Node 1 Private LAN IPv4 *' }), n1Ip]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'settings-node2-name', text: 'Node 2 Name (Environment) *' }), n2Name]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'settings-node2-ip', text: 'Node 2 Private LAN IPv4 *' }), n2Ip]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'settings-node3-name', text: 'Node 3 Name (Camera) *' }), n3Name]),
            el('div', { class: 'form-field' }, [el('label', { class: 'form-label', for: 'settings-node3-ip', text: 'Node 3 Private LAN IPv4 *' }), n3Ip]),
            el('div', { class: 'form-field' }, [
              el('label', { class: 'form-label', for: 'settings-temp-warning', text: 'Temperature Warning Display (°C) *' }),
              tempWarnIn
            ]),
            el('div', { class: 'form-field' }, [
              el('label', { class: 'form-label', for: 'settings-gas-warning', text: 'Gas Warning Display (raw < critical) *' }),
              gasWarnIn
            ]),
            el('div', { class: 'form-field' }, [
              el('label', { class: 'form-label', for: 'settings-gas-critical', text: 'Gas Critical Display (raw > warning) *' }),
              gasCritIn
            ])
          ]),
          el('div', { class: 'btn-row' }, [saveNodesBtn])
        ])
      );
    } else {
      contentSlot.appendChild(
        errorPanel({ title: 'Baseline node settings unavailable', message: mgmtRes.reason?.message, onRetry: load })
      );
    }

    // 4. Read-only Deployment Posture Guidance
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
    const curPass = el('input', {
      id: 'profile-current-password',
      class: 'input',
      type: 'password',
      autocomplete: 'current-password',
      placeholder: 'Enter current administrator password'
    });
    const newUser = el('input', {
      id: 'profile-new-username',
      class: 'input',
      type: 'text',
      autocomplete: 'username',
      value: store.user?.username || ''
    });
    const newPass = el('input', {
      id: 'profile-new-password',
      class: 'input',
      type: 'password',
      autocomplete: 'new-password',
      placeholder: 'Minimum 12 characters'
    });

    const buildPasswordToggle = (inputEl, showLabel, hideLabel) => {
      let visible = false;
      const btn = el(
        'button',
        {
          type: 'button',
          class: 'input-action-btn',
          'aria-label': showLabel,
          'aria-pressed': 'false',
          onClick: () => {
            visible = !visible;
            inputEl.type = visible ? 'text' : 'password';
            btn.setAttribute('aria-label', visible ? hideLabel : showLabel);
            btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
            btn.replaceChildren(svgIcon(visible ? 'icon-eye-off' : 'icon-eye', 16));
          }
        },
        [svgIcon('icon-eye', 16)]
      );
      return el('div', { class: 'input-with-action' }, [inputEl, btn]);
    };

    const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });

    const saveBtn = el('button', {
      id: 'profile-rotate-submit-btn',
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
        saveBtn.textContent = 'Updating…';
        try {
          await api.updateAdminProfile({
            currentPassword: curPass.value,
            newUsername: newUser.value.trim(),
            newPassword: newPass.value
          });
          showToast('Credentials rotated', 'Administrator account updated and other active sessions revoked.', 'success');
          curPass.value = '';
          newPass.value = '';
          await checkSession();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Update Admin Credentials';
        }
      }
    });

    container.appendChild(
      el('section', { class: 'card stack-md', id: 'profile-admin-rotation-card' }, [
        el('div', { class: 'stack-xs' }, [
          el('h2', { class: 'card-title', text: 'Rotate Administrator Credentials' }),
          el('span', {
            class: 'text-xs text-muted',
            text: 'Verifies your current password before updating credentials and revoking any other open sessions.'
          })
        ]),
        errBox,
        el('div', { class: 'form-grid' }, [
          el('div', { class: 'form-field' }, [
            el('label', { class: 'form-label', for: 'profile-current-password', text: 'Current Password *' }),
            buildPasswordToggle(curPass, 'Show current password', 'Hide current password')
          ]),
          el('div', { class: 'form-field' }, [
            el('label', { class: 'form-label', for: 'profile-new-username', text: 'New Username *' }),
            newUser
          ]),
          el('div', { class: 'form-field form-field-full' }, [
            el('label', { class: 'form-label', for: 'profile-new-password', text: 'New Password *' }),
            buildPasswordToggle(newPass, 'Show new password', 'Hide new password')
          ])
        ]),
        el('div', { class: 'btn-row' }, [saveBtn])
      ])
    );
  } else {
    container.appendChild(
      el('div', { id: 'viewer-profile-credential-notice' }, [
        disclaimerBanner({
          icon: 'icon-shield',
          tone: 'info',
          title: 'Credential Rotation Managed by Administrator',
          message:
            'Viewer accounts operate in read-only mode. Contact a facility Administrator to rotate your operator password or update your console role.'
        })
      ])
    );
  }

  return { node: container };
}
