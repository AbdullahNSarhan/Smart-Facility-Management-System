// LCI-SFM Operations Pages: Alarms & Rules (/app/alarms), Notifications (/app/notifications), Events & Audit (/app/events)

import { api } from '../api.js';
import { isAdmin, showToast, openModal, closeModal, refreshHeaderCounters } from '../store.js';
import { el, clear, formatTimestamp, formatAge, exportRowsToCsv } from '../utils.js';

const CONDITION_TYPES = [
  { value: 'THRESHOLD_HIGH', label: 'Numeric High (>= threshold)' },
  { value: 'THRESHOLD_LOW', label: 'Numeric Low (<= threshold)' },
  { value: 'BOOLEAN_TRUE', label: 'Boolean Active (value == true)' },
  { value: 'BOOLEAN_FALSE', label: 'Boolean Inactive (value == false)' }
];

function openRuleFormModal({ devices = [], existing = null, onSaved }) {
  const isEdit = Boolean(existing);
  const errBox = el('div', { class: 'alert alert-error hidden' });

  const deviceSelect = el(
    'select',
    { class: 'input', disabled: isEdit },
    devices.map((d) =>
      el('option', {
        value: d.device_id,
        selected: existing ? existing.device_id === d.device_id : false,
        text: `${d.name} (${d.device_id})`
      })
    )
  );
  const endpointSelect = el('select', { class: 'input', disabled: isEdit });
  const conditionSelect = el(
    'select',
    { class: 'input' },
    CONDITION_TYPES.map((c) =>
      el('option', { value: c.value, selected: (existing?.condition_type || 'THRESHOLD_HIGH') === c.value, text: c.label })
    )
  );
  const severitySelect = el(
    'select',
    { class: 'input' },
    ['CRITICAL', 'WARNING', 'INFO'].map((s) =>
      el('option', { value: s, selected: (existing?.severity || 'WARNING') === s, text: s })
    )
  );
  const warnInput = el('input', {
    class: 'input mono',
    type: 'number',
    step: '0.1',
    value: existing?.warning_threshold !== undefined && existing?.warning_threshold !== null ? String(existing.warning_threshold) : '28'
  });
  const critInput = el('input', {
    class: 'input mono',
    type: 'number',
    step: '0.1',
    value: existing?.critical_threshold !== undefined && existing?.critical_threshold !== null ? String(existing.critical_threshold) : '35'
  });
  const hystInput = el('input', {
    class: 'input mono',
    type: 'number',
    step: '0.1',
    value: String(existing?.hysteresis ?? 1)
  });
  const dwellInput = el('input', {
    class: 'input mono',
    type: 'number',
    value: String(existing?.dwell_ms ?? 0)
  });

  const populateEndpoints = () => {
    clear(endpointSelect);
    const dev = devices.find((d) => d.device_id === deviceSelect.value) || devices[0];
    const eps = dev?.endpoints || [];
    for (const ep of eps) {
      endpointSelect.appendChild(
        el('option', {
          value: ep.endpoint_key,
          selected: existing?.endpoint_key === ep.endpoint_key,
          text: `${ep.label} (${ep.endpoint_key} · ${ep.data_type || ep.kind})`
        })
      );
    }
  };
  deviceSelect.addEventListener('change', populateEndpoints);
  populateEndpoints();

  const thresholdsRow = el('div', { class: 'form-grid-2' }, [
    el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Warning Threshold' }), warnInput]),
    el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Critical Threshold' }), critInput])
  ]);
  const syncCondition = () => {
    const isBool = conditionSelect.value.startsWith('BOOLEAN_');
    thresholdsRow.classList.toggle('hidden', isBool);
  };
  conditionSelect.addEventListener('change', syncCondition);
  syncCondition();

  const form = el('form', { class: 'stack-md' }, [
    errBox,
    el('div', { class: 'form-grid-2' }, [
      el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Device' }), deviceSelect]),
      el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Endpoint' }), endpointSelect])
    ]),
    el('div', { class: 'form-grid-2' }, [
      el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Condition Type' }), conditionSelect]),
      el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Severity' }), severitySelect])
    ]),
    thresholdsRow,
    el('div', { class: 'form-grid-2' }, [
      el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Hysteresis' }), hystInput]),
      el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Dwell Time (ms)' }), dwellInput])
    ])
  ]);

  const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', text: isEdit ? 'Save Rule' : 'Create Rule' });
  saveBtn.addEventListener('click', async () => {
    errBox.classList.add('hidden');
    const isBool = conditionSelect.value.startsWith('BOOLEAN_');
    const sevVal = severitySelect.value === 'INFO' ? 'WARNING' : severitySelect.value;
    const threshold = isBool ? 1 : Number(critInput.value);
    const clearThreshold = isBool ? 0 : Number(warnInput.value);
    const payload = {
      device_id: deviceSelect.value,
      endpoint_key: endpointSelect.value,
      name: `${deviceSelect.value} ${endpointSelect.value} ${conditionSelect.value}`,
      condition_type: conditionSelect.value,
      severity: sevVal,
      threshold,
      clear_threshold: clearThreshold,
      hold_s: Math.max(0, Math.round(Number(dwellInput.value || 0) / 1000)),
      clear_hold_s: Math.max(0, Math.round(Number(hystInput.value || 5))),
      enabled: true
    };
    saveBtn.disabled = true;
    try {
      if (isEdit) {
        await api.updateRule(existing.rule_id, { ...payload, version: existing.version });
        showToast('Monitoring rule updated', 'Rule saved.', 'success');
      } else {
        await api.createRule(payload);
        showToast('Monitoring rule created', 'Alarm evaluation active for endpoint.', 'success');
      }
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
      saveBtn.disabled = false;
    }
  });

  openModal({
    title: isEdit ? 'Edit Monitoring Rule' : 'Create Alarm Monitoring Rule',
    subtitle: 'Deterministic Threshold & Boolean Engine',
    body: form,
    actions: [
      el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
      saveBtn
    ]
  });
}

export function renderAlarmsPage() {
  const root = el('div', { class: 'stack-lg' });
  let stateFilter = '';
  let roomFilter = '';
  let roomsCache = [];
  let devicesCache = [];

  const stateSelect = el(
    'select',
    {
      class: 'input input-sm',
      onChange: (e) => {
        stateFilter = e.target.value;
        loadAll();
      }
    },
    [
      el('option', { value: '', text: 'All Alarm States' }),
      el('option', { value: 'ACTIVE', text: 'Active' }),
      el('option', { value: 'ACKNOWLEDGED', text: 'Acknowledged' }),
      el('option', { value: 'RESOLVED', text: 'Resolved' })
    ]
  );
  const roomSelect = el('select', {
    class: 'input input-sm',
    onChange: (e) => {
      roomFilter = e.target.value;
      loadAll();
    }
  });

  root.appendChild(
    el('div', { class: 'section-toolbar' }, [
      el('div', { class: 'filter-row' }, [stateSelect, roomSelect]),
      el('div', { class: 'toolbar-actions' }, [
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Refresh', onClick: () => loadAll() }),
        isAdmin()
          ? el('button', {
              type: 'button',
              class: 'btn btn-primary btn-sm',
              text: '+ Create Rule',
              onClick: () => openRuleFormModal({ devices: devicesCache, onSaved: loadAll })
            })
          : null
      ])
    ])
  );

  const alarmsCard = el('div', { class: 'card table-card' });
  const rulesCard = el('div', { class: 'card table-card' });
  root.appendChild(el('section', { class: 'stack-sm' }, [el('h3', { class: 'card-title', text: 'Facility Alarms' }), alarmsCard]));
  root.appendChild(el('section', { class: 'stack-sm' }, [el('h3', { class: 'card-title', text: 'Monitoring Rules' }), rulesCard]));

  const promptAction = (alarm, mode) => {
    const commentInput = el('input', { class: 'input', placeholder: 'Optional operator comment...' });
    const goBtn = el('button', {
      type: 'button',
      class: mode === 'resolve' ? 'btn btn-primary' : 'btn btn-secondary',
      text: mode === 'resolve' ? 'Resolve Alarm' : 'Acknowledge Alarm'
    });
    goBtn.addEventListener('click', async () => {
      goBtn.disabled = true;
      try {
        if (mode === 'resolve') {
          await api.resolveAlarm(alarm.alarm_id, commentInput.value.trim());
        } else {
          await api.acknowledgeAlarm(alarm.alarm_id, commentInput.value.trim());
        }
        showToast('Alarm updated', `Alarm ${mode}d successfully.`, 'success');
        closeModal();
        loadAll();
      } catch (err) {
        showToast('Action failed', err.message, 'error');
        goBtn.disabled = false;
      }
    });
    openModal({
      title: `${mode === 'resolve' ? 'Resolve' : 'Acknowledge'} Alarm`,
      subtitle: `${alarm.device_id} · ${alarm.endpoint_key}`,
      body: el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Operator Note' }),
        commentInput
      ]),
      actions: [
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
        goBtn
      ]
    });
  };

  const loadAll = async () => {
    try {
      const [roomsRes, devRes, alarmsRes, rulesRes] = await Promise.all([
        api.listRooms({ include_archived: true }),
        api.listDevices({ include_archived: false }),
        api.listAlarms({ state: stateFilter || undefined, room_id: roomFilter || undefined, limit: 100 }),
        api.listRules({ room_id: roomFilter || undefined })
      ]);
      roomsCache = roomsRes.rooms || roomsRes.items || [];
      devicesCache = devRes.devices || devRes.items || [];

      clear(roomSelect);
      roomSelect.appendChild(el('option', { value: '', text: 'All Rooms', selected: !roomFilter }));
      for (const r of roomsCache) {
        roomSelect.appendChild(
          el('option', { value: r.room_id, text: `${r.room_code} — ${r.name}`, selected: roomFilter === r.room_id })
        );
      }

      // Render Alarms
      clear(alarmsCard);
      const alarms = alarmsRes.alarms || alarmsRes.items || [];
      if (alarms.length === 0) {
        alarmsCard.appendChild(el('div', { class: 'empty-state', text: 'No alarms match the current filter.' }));
      } else {
        const tbody = el(
          'tbody',
          {},
          alarms.map((a) => {
            const dot = a.severity === 'CRITICAL' ? 'dot-crit' : a.severity === 'WARNING' ? 'dot-warn' : 'dot-info';
            return el('tr', {}, [
              el('td', {}, [
                el('div', { class: 'status-inline' }, [
                  el('span', { class: `status-dot ${dot}` }),
                  el('strong', { text: a.severity })
                ])
              ]),
              el('td', {}, [
                el('div', { class: 'cell-primary', text: a.title || a.endpoint_key }),
                el('div', { class: 'cell-sub', text: a.message || '' })
              ]),
              el('td', { class: 'mono', text: `${a.device_id} · ${a.endpoint_key}` }),
              el('td', { class: 'mono', text: a.state }),
              el('td', { class: 'mono tabular-nums', text: formatAge(a.opened_at) }),
              el('td', { class: 'actions-cell' }, [
                isAdmin() && a.state === 'ACTIVE'
                  ? el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-xs',
                      text: 'Acknowledge',
                      onClick: () => promptAction(a, 'acknowledge')
                    })
                  : null,
                isAdmin() && a.state !== 'RESOLVED'
                  ? el('button', {
                      type: 'button',
                      class: 'btn btn-primary btn-xs',
                      text: 'Resolve',
                      onClick: () => promptAction(a, 'resolve')
                    })
                  : null
              ])
            ]);
          })
        );
        alarmsCard.appendChild(
          el('div', { class: 'table-scroll' }, [
            el('table', { class: 'data-table' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { text: 'Severity' }),
                  el('th', { text: 'Alarm' }),
                  el('th', { text: 'Source' }),
                  el('th', { text: 'State' }),
                  el('th', { text: 'Opened' }),
                  el('th', { text: 'Actions' })
                ])
              ]),
              tbody
            ])
          ])
        );
      }

      // Render Rules
      clear(rulesCard);
      const rules = rulesRes.rules || rulesRes.items || [];
      if (rules.length === 0) {
        rulesCard.appendChild(el('div', { class: 'empty-state', text: 'No monitoring rules configured.' }));
      } else {
        const tbody = el(
          'tbody',
          {},
          rules.map((r) =>
            el('tr', {}, [
              el('td', { class: 'mono', text: `${r.device_id} · ${r.endpoint_key}` }),
              el('td', { class: 'mono', text: r.condition_type || 'THRESHOLD_HIGH' }),
              el('td', {
                class: 'mono tabular-nums',
                text: String(r.condition_type || '').startsWith('BOOLEAN_')
                  ? r.condition_type
                  : `Warn: ${r.warning_threshold ?? '—'} · Crit: ${r.critical_threshold ?? '—'}`
              }),
              el('td', { class: 'mono tabular-nums', text: `Hyst ${r.hysteresis ?? 0} · Dwell ${r.dwell_ms ?? 0}ms` }),
              el('td', { text: r.enabled ? 'ENABLED' : 'PAUSED' }),
              el('td', { class: 'actions-cell' }, [
                isAdmin()
                  ? el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-xs',
                      text: 'Edit',
                      onClick: () => openRuleFormModal({ devices: devicesCache, existing: r, onSaved: loadAll })
                    })
                  : null
              ])
            ])
          )
        );
        rulesCard.appendChild(
          el('div', { class: 'table-scroll' }, [
            el('table', { class: 'data-table' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { text: 'Target' }),
                  el('th', { text: 'Condition' }),
                  el('th', { text: 'Thresholds' }),
                  el('th', { text: 'Stability' }),
                  el('th', { text: 'Status' }),
                  el('th', { text: 'Actions' })
                ])
              ]),
              tbody
            ])
          ])
        );
      }
    } catch (err) {
      clear(alarmsCard);
      alarmsCard.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  loadAll();
  return { node: root };
}

export function renderNotificationsPage() {
  const root = el('div', { class: 'stack-lg' });
  let unreadOnly = false;
  let severityFilter = '';

  const unreadCheck = el('label', { class: 'checkbox-inline' }, [
    el('input', {
      type: 'checkbox',
      onChange: (e) => {
        unreadOnly = e.target.checked;
        loadList();
      }
    }),
    el('span', { text: 'Unread only' })
  ]);
  const sevSelect = el(
    'select',
    {
      class: 'input input-sm',
      onChange: (e) => {
        severityFilter = e.target.value;
        loadList();
      }
    },
    [
      el('option', { value: '', text: 'All Severities' }),
      el('option', { value: 'CRITICAL', text: 'Critical' }),
      el('option', { value: 'WARNING', text: 'Warning' }),
      el('option', { value: 'INFO', text: 'Info' })
    ]
  );

  root.appendChild(
    el('div', { class: 'section-toolbar' }, [
      el('div', { class: 'filter-row' }, [sevSelect, unreadCheck]),
      el('div', { class: 'toolbar-actions' }, [
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Refresh', onClick: () => loadList() }),
        el('button', {
          type: 'button',
          class: 'btn btn-primary btn-sm',
          text: 'Mark All Read',
          onClick: async () => {
            try {
              await api.markAllNotificationsRead();
              showToast('Notifications cleared', 'All notifications marked as read.', 'info');
              refreshHeaderCounters();
              loadList();
            } catch (err) {
              showToast('Action failed', err.message, 'error');
            }
          }
        })
      ])
    ])
  );

  const listHost = el('div', { class: 'stack-sm' });
  root.appendChild(listHost);

  const loadList = async () => {
    try {
      const res = await api.listNotifications({
        unread: unreadOnly,
        severity: severityFilter || undefined,
        limit: 100
      });
      const items = res.notifications || res.items || [];
      clear(listHost);
      if (items.length === 0) {
        listHost.appendChild(el('div', { class: 'card empty-state', text: 'No notifications match your filters.' }));
        return;
      }

      for (const n of items) {
        const isRead = Boolean(n.read_at);
        const dot = n.severity === 'CRITICAL' ? 'dot-crit' : n.severity === 'WARNING' ? 'dot-warn' : 'dot-info';
        listHost.appendChild(
          el('article', { class: `card notif-card${isRead ? ' notif-read' : ''}` }, [
            el('div', { class: 'section-toolbar' }, [
              el('div', { class: 'status-inline' }, [
                el('span', { class: `status-dot ${dot}` }),
                el('strong', { text: n.title || n.category }),
                el('span', { class: 'mono text-muted', text: `· ${n.severity}` })
              ]),
              el('div', { class: 'toolbar-actions' }, [
                el('span', { class: 'mono text-muted tabular-nums', text: formatTimestamp(n.created_at) }),
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-xs',
                  text: isRead ? 'Mark Unread' : 'Mark Read',
                  onClick: async () => {
                    try {
                      await api.markNotificationRead(n.notification_id, !isRead);
                      refreshHeaderCounters();
                      loadList();
                    } catch (err) {
                      showToast('Update failed', err.message, 'error');
                    }
                  }
                })
              ])
            ]),
            el('p', { class: 'text-secondary', text: n.message || '' })
          ])
        );
      }
    } catch (err) {
      clear(listHost);
      listHost.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  loadList();
  return { node: root };
}

export function renderEventsPage() {
  const root = el('div', { class: 'stack-lg' });
  const tabs = [
    { id: 'access_logs', label: 'Access Logs' },
    { id: 'environmental_telemetry', label: 'Env Telemetry' },
    { id: 'system_errors', label: 'System Errors' },
    { id: 'command_audit', label: 'Command Audit' },
    ...(isAdmin() ? [{ id: 'admin_audit', label: 'Admin Audit' }] : [])
  ];
  let activeTab = 'access_logs';
  let searchText = '';
  let currentRows = [];

  const tabBar = el('div', { class: 'tab-bar' });
  const searchInput = el('input', {
    type: 'search',
    class: 'input input-sm',
    placeholder: 'Filter loaded records...',
    onInput: (e) => {
      searchText = e.target.value.trim().toLowerCase();
      renderTable();
    }
  });
  const tableHost = el('div', { class: 'card table-card' });

  const renderTabs = () => {
    clear(tabBar);
    for (const t of tabs) {
      tabBar.appendChild(
        el('button', {
          type: 'button',
          class: `tab-btn${activeTab === t.id ? ' active' : ''}`,
          text: t.label,
          onClick: () => {
            activeTab = t.id;
            renderTabs();
            loadLogs();
          }
        })
      );
    }
  };

  root.appendChild(
    el('div', { class: 'section-toolbar' }, [
      tabBar,
      el('div', { class: 'toolbar-actions' }, [
        searchInput,
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Refresh', onClick: () => loadLogs() }),
        el('button', {
          type: 'button',
          class: 'btn btn-primary btn-sm',
          text: 'Export CSV',
          onClick: () => {
            if (!currentRows.length) return;
            const keys = Object.keys(currentRows[0]);
            exportRowsToCsv(
              `lci-sfm-${activeTab}.csv`,
              keys.map((k) => ({ label: k, key: k })),
              currentRows
            );
          }
        })
      ])
    ])
  );
  root.appendChild(tableHost);

  const inspectRecord = (row) => {
    openModal({
      title: `Audit Record · ${activeTab}`,
      subtitle: 'Persisted SQLite Record',
      wide: true,
      body: el('pre', { class: 'code-block mono', text: JSON.stringify(row, null, 2) }),
      actions: [el('button', { type: 'button', class: 'btn btn-secondary', text: 'Close', onClick: closeModal })]
    });
  };

  const renderTable = () => {
    clear(tableHost);
    const filtered = searchText
      ? currentRows.filter((r) => JSON.stringify(r).toLowerCase().includes(searchText))
      : currentRows;

    if (filtered.length === 0) {
      tableHost.appendChild(el('div', { class: 'empty-state', text: 'No records found in this log table.' }));
      return;
    }

    const keys = Object.keys(filtered[0]).slice(0, 6);
    const tbody = el(
      'tbody',
      {},
      filtered.slice(0, 100).map((row) =>
        el(
          'tr',
          { class: 'clickable-row', onClick: () => inspectRecord(row) },
          keys.map((k) =>
            el('td', {
              class: /time|at|seq|temp|hum|smoke|id/i.test(k) ? 'mono tabular-nums' : '',
              text: row[k] === null || row[k] === undefined ? '—' : String(row[k]).slice(0, 80)
            })
          )
        )
      )
    );

    tableHost.appendChild(
      el('div', { class: 'table-scroll' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, keys.map((k) => el('th', { text: k })))]),
          tbody
        ])
      ])
    );
  };

  const loadLogs = async () => {
    try {
      const res = await api.getLogs(activeTab, 120);
      currentRows = Array.isArray(res) ? res : res.items || [];
      renderTable();
    } catch (err) {
      clear(tableHost);
      tableHost.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  renderTabs();
  loadLogs();
  return { node: root };
}
