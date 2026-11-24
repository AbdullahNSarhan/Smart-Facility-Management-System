// LCI-SFM System & Administration Pages:
// Diagnostics (/app/diagnostics), Users & Access (/app/users), Settings (/app/settings), Profile (/app/profile).

import { api } from '../api.js';
import { store, isAdmin, showToast, toggleTheme, signOut, openModal, closeModal, confirmDialog } from '../store.js';
import { el, clear, formatAge, formatUptime } from '../utils.js';

// ============================================================================
// DIAGNOSTICS (/app/diagnostics)
// ============================================================================
export function renderDiagnosticsPage({ navigate }) {
  const root = el('div', { class: 'stack-lg' });
  const kpiHost = el('div', { class: 'kpi-grid' });
  const servicesHost = el('div', { class: 'overview-split' });
  const freshnessCard = el('div', { class: 'card table-card' });
  const simHost = el('div');

  root.appendChild(
    el('div', { class: 'section-toolbar' }, [
      el('div', {}, [
        el('h2', { class: 'section-title', text: 'System Health & Diagnostics' }),
        el('p', { class: 'text-secondary', text: 'Local SQLite storage, MQTT broker connectivity, WebSocket streams, and endpoint freshness.' })
      ]),
      el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Refresh', onClick: () => loadDiag() })
    ])
  );
  root.appendChild(kpiHost);
  root.appendChild(servicesHost);
  root.appendChild(el('section', { class: 'stack-sm' }, [el('h3', { class: 'card-title', text: 'Per-Device & Endpoint Freshness' }), freshnessCard]));
  root.appendChild(simHost);

  const loadDiag = async () => {
    try {
      const [ready, diag, devRes] = await Promise.all([
        api.getHealthReady(),
        api.getDiagnostics(),
        api.listDevices({ include_archived: false })
      ]);

      clear(kpiHost);
      const kpis = [
        ['Release Version', diag.version || '2.0.0-rc.1', `Node ${diag.node_version || ''}`],
        ['Server Uptime', formatUptime(diag.uptime_seconds), ready.ok ? 'Readiness OK' : 'Readiness Degraded'],
        ['SQLite Engine', ready.sqlite?.ok ? 'HEALTHY' : 'ERROR', `Mode: ${String(ready.sqlite?.journal_mode || 'WAL').toUpperCase()} · FK: ${ready.sqlite?.foreign_keys ? 'ON' : 'OFF'}`],
        ['MQTT Broker', !ready.mqtt?.enabled ? 'STANDBY' : ready.mqtt?.connected ? 'CONNECTED' : 'DISCONNECTED', ready.mqtt?.enabled ? `Subs ready: ${ready.mqtt?.subscriptions_ready ? 'Yes' : 'No'}` : 'Disabled by config']
      ];
      for (const [lbl, val, sub] of kpis) {
        kpiHost.appendChild(
          el('div', { class: 'card kpi-card' }, [
            el('div', { class: 'kpi-label', text: lbl }),
            el('div', { class: 'kpi-value tabular-nums', text: String(val) }),
            el('div', { class: 'kpi-detail', text: String(sub) })
          ])
        );
      }

      clear(servicesHost);
      servicesHost.appendChild(
        el('div', { class: 'card stack-sm' }, [
          el('h3', { class: 'card-title', text: 'WebSocket & Storage Telemetry' }),
          el('div', { class: 'spec-list' }, [
            el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Telemetry WS Clients' }), el('code', { class: 'mono tabular-nums', text: String(ready.websocket?.telemetry_clients ?? 0) })]),
            el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'MFA WS Clients' }), el('code', { class: 'mono tabular-nums', text: String(ready.websocket?.mfa_clients ?? 0) })]),
            el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Notification WS Clients' }), el('code', { class: 'mono tabular-nums', text: String(ready.websocket?.notification_clients ?? 0) })]),
            el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Pending Quarantine Count' }), el('code', { class: 'mono tabular-nums', text: String(diag.pending_devices_count ?? 0) })])
          ])
        ])
      );

      const obsNodes = ready.mqtt?.observed_nodes || {};
      const obsEntries = Object.entries(obsNodes);
      servicesHost.appendChild(
        el('div', { class: 'card stack-sm' }, [
          el('h3', { class: 'card-title', text: 'MQTT Observed Legacy Nodes' }),
          obsEntries.length === 0
            ? el('p', { class: 'text-secondary', text: 'No legacy heartbeat frames observed since server start.' })
            : el(
                'div',
                { class: 'spec-list' },
                obsEntries.map(([nodeId, st]) =>
                  el('div', { class: 'spec-row' }, [
                    el('span', { class: 'mono', text: nodeId }),
                    el('span', { class: 'mono tabular-nums', text: `${st.status} · ${formatAge(st.last_seen_at)}` })
                  ])
                )
              )
        ])
      );

      // Freshness table
      clear(freshnessCard);
      const devices = devRes.devices || devRes.items || [];
      const rows = [];
      for (const dev of devices) {
        for (const ep of dev.endpoints || []) {
          rows.push({ dev, ep });
        }
      }
      if (rows.length === 0) {
        freshnessCard.appendChild(el('div', { class: 'empty-state', text: 'No active endpoints registered.' }));
      } else {
        const tbody = el(
          'tbody',
          {},
          rows.map(({ dev, ep }) =>
            el('tr', {}, [
              el('td', {}, [
                el('button', {
                  type: 'button',
                  class: 'link-title',
                  text: dev.name,
                  onClick: () => navigate(`/app/devices/${encodeURIComponent(dev.device_id)}`)
                })
              ]),
              el('td', { class: 'mono', text: ep.endpoint_key }),
              el('td', { class: 'mono', text: `${ep.kind}/${ep.data_type || 'NUMBER'}` }),
              el('td', { class: 'mono', text: ep.freshness || 'UNSEEN' }),
              el('td', { class: 'mono tabular-nums', text: formatAge(ep.last_seen_at) })
            ])
          )
        );
        freshnessCard.appendChild(
          el('div', { class: 'table-scroll' }, [
            el('table', { class: 'data-table' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { text: 'Device' }),
                  el('th', { text: 'Endpoint' }),
                  el('th', { text: 'Type' }),
                  el('th', { text: 'Freshness' }),
                  el('th', { text: 'Last Observed' })
                ])
              ]),
              tbody
            ])
          ])
        );
      }

      // Isolated Simulator Panel (strictly hidden unless backend simulator is enabled)
      clear(simHost);
      if (diag.simulation && isAdmin()) {
        const scenarios = [
          { id: 'normal', label: 'Normal Operations' },
          { id: 'alarm', label: 'Trigger Alarm Scenario' },
          { id: 'offline', label: 'Simulate Node Offline' },
          { id: 'command-failure', label: 'Simulate Command Failure' }
        ];
        simHost.appendChild(
          el('section', { class: 'card stack-sm' }, [
            el('h3', { class: 'card-title', text: 'Isolated Simulator Controls (Non-Production)' }),
            el('p', { class: 'text-secondary', text: 'Backend is running in isolated simulator mode. No external broker or physical hardware is contacted.' }),
            el(
              'div',
              { class: 'toolbar-actions' },
              scenarios.map((sc) =>
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: sc.label,
                  onClick: async () => {
                    try {
                      await api.triggerSimulatorScenario(sc.id);
                      showToast('Simulator scenario executed', sc.label, 'info');
                      loadDiag();
                    } catch (err) {
                      showToast('Simulator error', err.message, 'error');
                    }
                  }
                })
              )
            )
          ])
        );
      }
    } catch (err) {
      clear(freshnessCard);
      freshnessCard.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  loadDiag();
  return { node: root };
}

// ============================================================================
// USERS & PHYSICAL ACCESS CREDENTIALS (/app/users) — ADMIN ONLY
// ============================================================================
export function renderUsersPage() {
  const root = el('div', { class: 'stack-lg' });

  if (!isAdmin()) {
    root.appendChild(
      el('div', { class: 'card empty-state' }, [
        el('h3', { class: 'card-title', text: 'Administrator Permission Required' }),
        el('p', { class: 'text-secondary', text: 'Your Viewer role has read-only operational access. Operator accounts and physical credentials are restricted to Admin accounts.' })
      ])
    );
    return { node: root };
  }

  let activeTab = 'operators';
  const tabBar = el('div', { class: 'tab-bar' });
  const contentHost = el('div', { class: 'stack-md' });

  const renderTabs = () => {
    clear(tabBar);
    for (const [id, label] of [
      ['operators', 'Dashboard Operators (RBAC)'],
      ['people', 'People & RFID/PIN Credentials']
    ]) {
      tabBar.appendChild(
        el('button', {
          type: 'button',
          class: `tab-btn${activeTab === id ? ' active' : ''}`,
          text: label,
          onClick: () => {
            activeTab = id;
            renderTabs();
            loadTab();
          }
        })
      );
    }
  };

  root.appendChild(tabBar);
  root.appendChild(contentHost);

  const openOperatorModal = () => {
    const userIn = el('input', { class: 'input', placeholder: 'operator_name' });
    const passIn = el('input', { class: 'input', type: 'password', placeholder: 'Strong password (min 6 chars)' });
    const roleSel = el('select', { class: 'input' }, [
      el('option', { value: 'Viewer', text: 'Viewer (Read-Only)' }),
      el('option', { value: 'Admin', text: 'Admin (Full Operations)' })
    ]);
    const errBox = el('div', { class: 'alert alert-error hidden' });
    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Create Operator' });
    saveBtn.addEventListener('click', async () => {
      errBox.classList.add('hidden');
      saveBtn.disabled = true;
      try {
        await api.provisionOperator({
          username: userIn.value.trim(),
          password: passIn.value,
          role: roleSel.value,
          rfid: '00:00:00:00',
          pin: '000000'
        });
        showToast('Operator provisioned', `${userIn.value.trim()} (${roleSel.value}) created.`, 'success');
        closeModal();
        loadTab();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        saveBtn.disabled = false;
      }
    });
    openModal({
      title: 'Add Dashboard Operator',
      subtitle: 'Server-Verified RBAC Account',
      body: el('div', { class: 'stack-md' }, [
        errBox,
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Username' }), userIn]),
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Password' }), passIn]),
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Role' }), roleSel])
      ]),
      actions: [
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
        saveBtn
      ]
    });
  };

  const openPersonModal = () => {
    const nameIn = el('input', { class: 'input', placeholder: 'Full Name' });
    const deptIn = el('input', { class: 'input', placeholder: 'Department / Role' });
    const errBox = el('div', { class: 'alert alert-error hidden' });
    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Add Person' });
    saveBtn.addEventListener('click', async () => {
      errBox.classList.add('hidden');
      saveBtn.disabled = true;
      try {
        await api.createPerson({ full_name: nameIn.value.trim(), department: deptIn.value.trim() });
        showToast('Person added', `${nameIn.value.trim()} created.`, 'success');
        closeModal();
        loadTab();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        saveBtn.disabled = false;
      }
    });
    openModal({
      title: 'Add Facility Person',
      subtitle: 'Physical Access Identity (Separated from Dashboard Login)',
      body: el('div', { class: 'stack-md' }, [
        errBox,
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Full Name' }), nameIn]),
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Department' }), deptIn])
      ]),
      actions: [
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
        saveBtn
      ]
    });
  };

  const loadTab = async () => {
    clear(contentHost);
    try {
      if (activeTab === 'operators') {
        const users = await api.listOperators();
        const list = Array.isArray(users) ? users : [];
        contentHost.appendChild(
          el('div', { class: 'section-toolbar' }, [
            el('p', { class: 'text-secondary', text: `${list.length} dashboard operator accounts` }),
            el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '+ Add Operator', onClick: openOperatorModal })
          ])
        );
        const tbody = el(
          'tbody',
          {},
          list.map((u) =>
            el('tr', {}, [
              el('td', { class: 'mono', text: u.username }),
              el('td', { text: u.role }),
              el('td', { text: u.pin_configured ? 'Configured' : 'None' }),
              el('td', { class: 'actions-cell' }, [
                u.username !== store.user?.username
                  ? el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-xs',
                      text: 'Delete',
                      onClick: async () => {
                        const ok = await confirmDialog({
                          title: `Delete operator ${u.username}?`,
                          message: 'This revokes dashboard access immediately. Deleting the last Admin is blocked by the server.',
                          confirmLabel: 'Delete Account',
                          danger: true
                        });
                        if (!ok) return;
                        try {
                          await api.deleteOperator(u.id);
                          showToast('Operator deleted', `${u.username} removed.`, 'info');
                          loadTab();
                        } catch (err) {
                          showToast('Delete failed', err.message, 'error');
                        }
                      }
                    })
                  : el('span', { class: 'text-muted', text: 'Current Session' })
              ])
            ])
          )
        );
        contentHost.appendChild(
          el('div', { class: 'card table-card' }, [
            el('div', { class: 'table-scroll' }, [
              el('table', { class: 'data-table' }, [
                el('thead', {}, [el('tr', {}, [el('th', { text: 'Username' }), el('th', { text: 'Role' }), el('th', { text: 'PIN State' }), el('th', { text: 'Actions' })])]),
                tbody
              ])
            ])
          ])
        );
      } else {
        const res = await api.listPeople({ limit: 100 });
        const people = res.items || [];
        contentHost.appendChild(
          el('div', { class: 'section-toolbar' }, [
            el('p', { class: 'text-secondary', text: `${people.length} physical access profiles (separated from operator logins)` }),
            el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '+ Add Person', onClick: openPersonModal })
          ])
        );
        const tbody = el(
          'tbody',
          {},
          people.map((p) =>
            el('tr', {}, [
              el('td', { text: p.full_name }),
              el('td', { text: p.department || '—' }),
              el('td', { class: 'mono', text: p.status || 'ACTIVE' }),
              el('td', { class: 'mono tabular-nums', text: String((p.credentials || []).length) })
            ])
          )
        );
        contentHost.appendChild(
          el('div', { class: 'card table-card' }, [
            people.length === 0
              ? el('div', { class: 'empty-state', text: 'No facility people enrolled yet.' })
              : el('div', { class: 'table-scroll' }, [
                  el('table', { class: 'data-table' }, [
                    el('thead', {}, [el('tr', {}, [el('th', { text: 'Full Name' }), el('th', { text: 'Department' }), el('th', { text: 'Status' }), el('th', { text: 'Credentials' })])]),
                    tbody
                  ])
                ])
          ])
        );
      }
    } catch (err) {
      contentHost.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  renderTabs();
  loadTab();
  return { node: root };
}

// ============================================================================
// FACILITY SETTINGS (/app/settings) — ADMIN ONLY
// ============================================================================
export function renderSettingsPage() {
  const root = el('div', { class: 'stack-lg' });

  if (!isAdmin()) {
    root.appendChild(
      el('div', { class: 'card empty-state' }, [
        el('h3', { class: 'card-title', text: 'Administrator Permission Required' }),
        el('p', { class: 'text-secondary', text: 'Only Admin operators can modify facility profile and shared node settings.' })
      ])
    );
    return { node: root };
  }

  const facilityCard = el('section', { class: 'card stack-md' });
  root.appendChild(facilityCard);

  const loadSettings = async () => {
    try {
      const res = await api.getFacility();
      const fac = res.facility || res;

      const nameIn = el('input', { class: 'input', value: fac.name || '' });
      const locIn = el('input', { class: 'input', value: fac.location || '' });
      const tzIn = el('input', { class: 'input mono', value: fac.timezone || 'UTC' });
      const descIn = el('textarea', { class: 'input textarea', rows: '3' }, [fac.description || '']);
      const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Save Facility Profile' });

      const form = el('form', { class: 'stack-md' }, [
        el('div', { class: 'form-grid-2' }, [
          el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Facility Name' }), nameIn]),
          el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Location / Site' }), locIn])
        ]),
        el('div', { class: 'form-grid-2' }, [
          el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Timezone' }), tzIn]),
          el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Revision' }), el('input', { class: 'input mono', value: String(fac.version || 1), disabled: true })])
        ]),
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Description' }), descIn]),
        el('div', {}, [saveBtn])
      ]);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        saveBtn.disabled = true;
        try {
          await api.updateFacility({
            name: nameIn.value.trim(),
            location: locIn.value.trim(),
            timezone: tzIn.value.trim() || 'UTC',
            description: descIn.value.trim(),
            version: fac.version
          });
          showToast('Facility profile updated', 'Changes persisted to SQLite.', 'success');
          loadSettings();
        } catch (err) {
          showToast('Save failed', err.message, 'error');
          saveBtn.disabled = false;
        }
      });

      clear(facilityCard);
      facilityCard.appendChild(el('h3', { class: 'card-title', text: 'Facility Profile' }));
      facilityCard.appendChild(form);
    } catch (err) {
      clear(facilityCard);
      facilityCard.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  loadSettings();
  return { node: root };
}

// ============================================================================
// OPERATOR PROFILE (/app/profile)
// ============================================================================
export function renderProfilePage({ navigate }) {
  const root = el('div', { class: 'stack-lg' });

  const infoCard = el('section', { class: 'card stack-md' }, [
    el('h3', { class: 'card-title', text: 'Active Operator Session' }),
    el('div', { class: 'spec-list' }, [
      el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Username' }), el('code', { class: 'mono', text: store.user?.username || '—' })]),
      el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Role' }), el('code', { class: 'mono', text: store.user?.role || 'Viewer' })]),
      el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Theme Posture' }), el('code', { class: 'mono', text: store.theme === 'dark' ? 'Dark Industrial Graphite' : 'Light Neutral' })])
    ]),
    el('div', { class: 'toolbar-actions' }, [
      el('button', { type: 'button', class: 'btn btn-secondary', text: 'Switch Light / Dark Theme', onClick: toggleTheme }),
      el('button', {
        type: 'button',
        class: 'btn btn-danger',
        text: 'Sign Out',
        onClick: async () => {
          await signOut();
          navigate('/login', { replace: true });
        }
      })
    ])
  ]);
  root.appendChild(infoCard);

  if (isAdmin()) {
    const curPass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
    const newUser = el('input', { class: 'input', value: store.user?.username || '', placeholder: 'Username' });
    const newPass = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'New strong password (min 12 chars)' });
    const statusBox = el('div', { class: 'alert hidden' });
    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Update Credentials' });

    const form = el('form', { class: 'stack-md' }, [
      statusBox,
      el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Current Password' }), curPass]),
      el('div', { class: 'form-grid-2' }, [
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'New Username' }), newUser]),
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'New Password' }), newPass])
      ]),
      el('div', {}, [submitBtn])
    ]);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      statusBox.classList.add('hidden');
      submitBtn.disabled = true;
      try {
        await api.updateAdminProfile({
          current_password: curPass.value,
          new_username: newUser.value.trim(),
          new_password: newPass.value
        });
        showToast('Credentials rotated', 'Please sign in with your updated credentials.', 'success');
        await signOut();
        navigate('/login', { replace: true });
      } catch (err) {
        statusBox.className = 'alert alert-error';
        statusBox.textContent = err.message;
        submitBtn.disabled = false;
      }
    });

    root.appendChild(
      el('section', { class: 'card stack-md' }, [
        el('h3', { class: 'card-title', text: 'Rotate Administrator Credentials' }),
        form
      ])
    );
  }

  return { node: root };
}
