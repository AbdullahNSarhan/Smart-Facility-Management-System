// LCI-SFM Monitoring & Operations Pages (/app/alarms, /app/notifications, /app/events)
// Fixes ruleSchema 1:1 contract, notification through_id read-all, and adds Slide-Over Drawers for Alarm & Event details.

import { api } from '../api.js';
import {
  isAdmin,
  showToast,
  openModal,
  closeModal,
  openDrawer,
  closeDrawer,
  onLiveEvent,
  refreshHeaderCounters,
  unlockNotificationAudio,
  store
} from '../store.js';
import { el, clear, svgIcon, formatAge, formatTimestamp, exportRowsToCsv } from '../utils.js';
import {
  pageHeader,
  statusIndicator,
  loadingSkeleton,
  emptyState,
  errorPanel,
  disclaimerBanner,
  keyValueList,
  timelineList,
  renderAdaptiveCollection,
  segmentedFilter
} from '../components/ui.js';

function severityWeight(sev) {
  const s = String(sev || '').toUpperCase();
  if (s === 'CRITICAL') return 0;
  if (s === 'WARNING') return 1;
  return 2;
}

// ============================================================================
// ALARMS & MONITORING RULES (/app/alarms)
// ============================================================================
function openAlarmActionModal({ alarm, action, onDone }) {
  const isResolve = action === 'resolve';
  const commentInput = el('textarea', {
    class: 'textarea',
    placeholder: isResolve
      ? 'Enter verified resolution reason (minimum 3 characters)...'
      : 'Enter acknowledgement note for the audit trail (minimum 3 characters)...',
    required: true
  });
  const errBox = el('div', { class: 'form-error', hidden: true });

  const body = el('div', { class: 'stack-md' }, [
    errBox,
    el('p', {
      class: 'text-sm text-secondary',
      text: isResolve
        ? `Resolve "${alarm.title}". Note: Active rule/stale alarms require fresh recovery evidence unless the rule is disabled.`
        : `Acknowledge "${alarm.title}" to record operator ownership in the audit timeline.`
    }),
    el('div', { class: 'form-field' }, [
      el('label', { class: 'form-label', text: 'Audited Operator Comment *' }),
      commentInput
    ])
  ]);

  const submitBtn = el('button', {
    type: 'button',
    class: isResolve ? 'btn btn-primary' : 'btn btn-secondary',
    text: isResolve ? 'Resolve Alarm' : 'Acknowledge Alarm',
    onClick: async () => {
      errBox.hidden = true;
      const comment = commentInput.value.trim();
      if (comment.length < 3) {
        errBox.textContent = 'Please provide an audited comment of at least 3 characters.';
        errBox.hidden = false;
        return;
      }
      submitBtn.disabled = true;
      try {
        if (isResolve) {
          await api.resolveAlarm(alarm.alarm_id, comment);
          showToast('Alarm resolved', alarm.title, 'success');
        } else {
          await api.acknowledgeAlarm(alarm.alarm_id, comment);
          showToast('Alarm acknowledged', alarm.title, 'info');
        }
        closeModal();
        closeDrawer();
        if (onDone) onDone();
      } catch (err) {
        errBox.textContent = err.message || 'Action could not be completed.';
        errBox.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    }
  });

  openModal({
    title: isResolve ? 'Resolve Alarm' : 'Acknowledge Alarm',
    subtitle: `${alarm.severity || 'WARNING'} · ${alarm.device_name || alarm.device_id}`,
    body,
    actions: [
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel', onClick: closeModal }),
      submitBtn
    ]
  });
}

function openRuleModal({ rule = null, devices = [], onSaved }) {
  const isEdit = Boolean(rule);
  // Only devices with SENSOR endpoints are valid alarm rule targets
  const sensorDevices = devices.filter(
    (d) => !d.archived && (d.endpoints || []).some((e) => e.kind === 'SENSOR')
  );

  if (!isEdit && sensorDevices.length === 0) {
    showToast('No sensor endpoints available', 'Register a device with a SENSOR endpoint first.', 'warning');
    return;
  }

  let selectedDeviceId = rule?.device_id || sensorDevices[0]?.device_id || '';
  const getSensorEndpoints = (devId) => {
    const dev = devices.find((d) => d.device_id === devId);
    return (dev?.endpoints || []).filter((e) => e.kind === 'SENSOR');
  };

  let selectedEndpointKey = rule?.endpoint_key || getSensorEndpoints(selectedDeviceId)[0]?.endpoint_key || '';
  const getSelectedEndpoint = () =>
    getSensorEndpoints(selectedDeviceId).find((e) => e.endpoint_key === selectedEndpointKey) || null;

  const isBoolEp = () => getSelectedEndpoint()?.data_type === 'BOOLEAN';

  let conditionType = rule?.condition_type || (isBoolEp() ? 'BOOLEAN_TRUE' : 'THRESHOLD_HIGH');

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    value: rule?.name || '',
    placeholder: 'e.g. High Rack Temperature',
    maxlength: 80
  });
  const devSelect = el('select', { class: 'select', disabled: isEdit });
  const epSelect = el('select', { class: 'select', disabled: isEdit });
  const sevSelect = el(
    'select',
    { class: 'select' },
    ['WARNING', 'CRITICAL'].map((s) => el('option', { value: s, text: s, selected: (rule?.severity || 'WARNING') === s }))
  );
  const condSelect = el('select', { class: 'select' });
  const thresholdInput = el('input', {
    class: 'input mono',
    type: 'number',
    step: 'any',
    value: String(rule?.threshold ?? 30)
  });
  const clearThresholdInput = el('input', {
    class: 'input mono',
    type: 'number',
    step: 'any',
    value: String(rule?.clear_threshold ?? 28)
  });
  const holdInput = el('input', {
    class: 'input mono',
    type: 'number',
    min: 0,
    max: 3600,
    value: String(rule?.hold_s ?? 10)
  });
  const clearHoldInput = el('input', {
    class: 'input mono',
    type: 'number',
    min: 0,
    max: 3600,
    value: String(rule?.clear_hold_s ?? 10)
  });
  const enabledCb = el('input', { type: 'checkbox', checked: rule ? Boolean(rule.enabled) : true });
  const thresholdWrap = el('div', { class: 'form-grid form-field-full' });
  const errBox = el('div', { class: 'form-error', hidden: true });

  function populateDevices() {
    clear(devSelect);
    for (const d of sensorDevices) {
      devSelect.appendChild(
        el('option', {
          value: d.device_id,
          text: `${d.name} (${d.device_id})`,
          selected: d.device_id === selectedDeviceId
        })
      );
    }
  }

  function populateEndpoints() {
    clear(epSelect);
    const eps = getSensorEndpoints(selectedDeviceId);
    if (!eps.some((e) => e.endpoint_key === selectedEndpointKey)) {
      selectedEndpointKey = eps[0]?.endpoint_key || '';
    }
    for (const ep of eps) {
      epSelect.appendChild(
        el('option', {
          value: ep.endpoint_key,
          text: `${ep.label} (${ep.endpoint_key} · ${ep.data_type}${ep.unit ? ` ${ep.unit}` : ''})`,
          selected: ep.endpoint_key === selectedEndpointKey
        })
      );
    }
    populateConditions();
  }

  function populateConditions() {
    const boolMode = isBoolEp();
    const validConds = boolMode
      ? [
          { v: 'BOOLEAN_TRUE', l: 'Trigger when TRUE (recover on FALSE)' },
          { v: 'BOOLEAN_FALSE', l: 'Trigger when FALSE (recover on TRUE)' }
        ]
      : [
          { v: 'THRESHOLD_HIGH', l: 'Threshold High (>= trigger, <= recovery)' },
          { v: 'THRESHOLD_LOW', l: 'Threshold Low (<= trigger, >= recovery)' }
        ];
    if (!validConds.some((c) => c.v === conditionType)) {
      conditionType = validConds[0].v;
    }
    clear(condSelect);
    for (const c of validConds) {
      condSelect.appendChild(el('option', { value: c.v, text: c.l, selected: c.v === conditionType }));
    }
    renderThresholdFields();
  }

  function renderThresholdFields() {
    clear(thresholdWrap);
    if (isBoolEp()) {
      thresholdWrap.appendChild(
        el('div', { class: 'form-field form-field-full text-xs text-muted' }, [
          'Boolean sensor rules evaluate TRUE/FALSE transitions directly using hold timers; numeric thresholds are not used.'
        ])
      );
      return;
    }
    const isLow = conditionType === 'THRESHOLD_LOW';
    thresholdWrap.append(
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: isLow ? 'Trigger Threshold (<=) *' : 'Trigger Threshold (>=) *' }),
        thresholdInput
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: isLow ? 'Recovery Hysteresis (>=) *' : 'Recovery Hysteresis (<=) *' }),
        clearThresholdInput,
        el('span', {
          class: 'form-hint',
          text: isLow ? 'Must be >= trigger threshold to prevent flapping.' : 'Must be <= trigger threshold to prevent flapping.'
        })
      ])
    );
  }

  devSelect.addEventListener('change', () => {
    selectedDeviceId = devSelect.value;
    populateEndpoints();
  });
  epSelect.addEventListener('change', () => {
    selectedEndpointKey = epSelect.value;
    populateConditions();
  });
  condSelect.addEventListener('change', () => {
    conditionType = condSelect.value;
    renderThresholdFields();
  });

  populateDevices();
  populateEndpoints();

  const form = el('form', { class: 'stack-md' }, [
    errBox,
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'form-field form-field-full' }, [
        el('label', { class: 'form-label', text: 'Rule Name *' }),
        nameInput
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: 'Target Device (Sensors only) *' }),
        devSelect
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: 'Sensor Endpoint *' }),
        epSelect
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: 'Severity *' }),
        sevSelect
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: 'Condition *' }),
        condSelect
      ]),
      thresholdWrap,
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: 'Trigger Hold / Dwell (seconds)' }),
        holdInput,
        el('span', { class: 'form-hint', text: 'Reading must remain breached for this duration before raising.' })
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: 'Recovery Hold (seconds)' }),
        clearHoldInput,
        el('span', { class: 'form-hint', text: 'Reading must remain recovered before auto-resolving.' })
      ]),
      el('div', { class: 'form-field form-field-full' }, [
        el('label', { class: 'checkbox-row' }, [enabledCb, el('span', { text: 'Enable rule evaluation' })])
      ])
    ])
  ]);

  const submitBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: isEdit ? 'Save Rule' : 'Create Rule',
    onClick: async () => {
      errBox.hidden = true;
      const name = nameInput.value.trim();
      if (!name) {
        errBox.textContent = 'Rule Name is required.';
        errBox.hidden = false;
        return;
      }
      const boolMode = isBoolEp();
      const threshold = boolMode ? 1 : Number(thresholdInput.value);
      const clearThreshold = boolMode ? 0 : Number(clearThresholdInput.value);
      if (!boolMode && (!Number.isFinite(threshold) || !Number.isFinite(clearThreshold))) {
        errBox.textContent = 'Provide valid numeric threshold and recovery values.';
        errBox.hidden = false;
        return;
      }
      if (!boolMode && conditionType === 'THRESHOLD_HIGH' && clearThreshold > threshold) {
        errBox.textContent = 'For THRESHOLD_HIGH, Recovery Hysteresis must be less than or equal to Trigger Threshold.';
        errBox.hidden = false;
        return;
      }
      if (!boolMode && conditionType === 'THRESHOLD_LOW' && clearThreshold < threshold) {
        errBox.textContent = 'For THRESHOLD_LOW, Recovery Hysteresis must be greater than or equal to Trigger Threshold.';
        errBox.hidden = false;
        return;
      }

      submitBtn.disabled = true;
      try {
        const payload = {
          name,
          device_id: selectedDeviceId,
          endpoint_key: selectedEndpointKey,
          severity: sevSelect.value,
          condition_type: conditionType,
          threshold,
          clear_threshold: clearThreshold,
          hold_s: Math.max(0, Number(holdInput.value || 0)),
          clear_hold_s: Math.max(0, Number(clearHoldInput.value || 0)),
          enabled: enabledCb.checked
        };
        if (isEdit) {
          payload.version = rule.version;
          await api.updateRule(rule.rule_id, payload);
          showToast('Rule updated', name, 'success');
        } else {
          await api.createRule(payload);
          showToast('Rule created', name, 'success');
        }
        closeModal();
        if (onSaved) onSaved();
      } catch (err) {
        if (err.status === 409 && err.code === 'VERSION_CONFLICT') {
          errBox.textContent = 'Rule changed in another session. Close, refresh, and retry.';
        } else {
          errBox.textContent = err.message || 'Could not save rule.';
        }
        errBox.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    }
  });

  openModal({
    title: isEdit ? `Edit Rule · ${rule.name}` : 'Create Monitoring Rule',
    subtitle: 'Deterministic Sensor Alarm Engine',
    wide: true,
    body: form,
    actions: [
      el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
      submitBtn
    ]
  });
}

export function renderAlarmsPage({ navigate }) {
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let disposed = false;

  let activeTab = 'alarms'; // alarms | rules
  let alarmStateFilter = '';
  let alarmSevFilter = '';
  let roomFilter = '';
  let searchFilter = '';
  let cachedRooms = [];
  let cachedDevices = [];

  const tabSlot = el('div');
  const filterSlot = el('div');
  const bodySlot = el('div');

  async function openAlarmDrawer(alarmRow) {
    const loadingNode = loadingSkeleton('table', 3);
    const drawer = openDrawer({
      title: alarmRow.title,
      subtitle: `${alarmRow.severity || 'WARNING'} · ${alarmRow.state}`,
      body: loadingNode
    });

    try {
      const res = await api.getAlarmDetail(alarmRow.alarm_id);
      const a = res.alarm;
      const evidenceEntries = Object.entries(a.evidence || {}).map(([k, v]) => ({
        label: k.replace(/_/g, ' '),
        value: typeof v === 'object' ? JSON.stringify(v) : String(v),
        mono: true
      }));

      const content = el('div', { class: 'stack-md' }, [
        el('div', { class: 'row-gap-sm' }, [
          statusIndicator(a.severity || 'WARNING'),
          statusIndicator(a.state || 'ACTIVE')
        ]),
        keyValueList([
          { label: 'Alarm ID', value: a.alarm_id, mono: true },
          { label: 'Device', value: a.device_name ? `${a.device_name} (${a.device_id})` : a.device_id },
          { label: 'Room', value: a.room_name ? `${a.room_code || ''} · ${a.room_name}` : '—' },
          { label: 'Raised At', value: formatTimestamp(a.raised_at), mono: true },
          a.acknowledged_at
            ? { label: 'Acknowledged', value: `${a.acknowledged_by || 'operator'} · ${formatTimestamp(a.acknowledged_at)}` }
            : null,
          a.resolved_at
            ? { label: 'Resolved', value: `${a.resolved_by || 'system'} · ${formatTimestamp(a.resolved_at)}` }
            : null,
          a.resolution ? { label: 'Resolution Note', value: a.resolution } : null
        ]),
        evidenceEntries.length > 0
          ? el('div', { class: 'card card-compact stack-xs' }, [
              el('div', { class: 'kicker', text: 'OBSERVED EVIDENCE' }),
              keyValueList(evidenceEntries)
            ])
          : null,
        el('div', { class: 'stack-xs' }, [
          el('div', { class: 'kicker', text: 'LIFECYCLE TIMELINE' }),
          timelineList(
            (a.events || []).map((ev) => ({
              status: ev.action,
              title: ev.action,
              actor: ev.actor,
              timestamp: formatTimestamp(ev.timestamp),
              detail: ev.comment || ''
            }))
          )
        ])
      ]);

      const drawerActions = [];
      if (a.device_id) {
        drawerActions.push(
          el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-sm',
            text: 'Inspect Device',
            onClick: () => navigate(`/app/devices/${encodeURIComponent(a.device_id)}`)
          })
        );
      }
      if (admin && a.state === 'ACTIVE') {
        drawerActions.push(
          el('button', {
            type: 'button',
            class: 'btn btn-secondary btn-sm',
            text: 'Acknowledge',
            onClick: () => openAlarmActionModal({ alarm: a, action: 'acknowledge', onDone: loadTab })
          })
        );
      }
      if (admin && a.state !== 'RESOLVED') {
        drawerActions.push(
          el('button', {
            type: 'button',
            class: 'btn btn-primary btn-sm',
            text: 'Resolve',
            onClick: () => openAlarmActionModal({ alarm: a, action: 'resolve', onDone: loadTab })
          })
        );
      }

      drawer.close();
      openDrawer({
        title: a.title,
        subtitle: `${a.severity || 'WARNING'} · ${a.state}`,
        body: content,
        actions: drawerActions
      });
    } catch (err) {
      drawer.close();
      showToast('Failed to load alarm detail', err.message, 'error');
    }
  }

  container.appendChild(
    pageHeader({
      title: 'Alarms & Monitoring Rules',
      description: 'Review active and historical facility alarms with audited lifecycle timelines, and configure deterministic sensor rules.',
      actions: [
        admin
          ? el('button', {
              id: 'create-rule-btn',
              type: 'button',
              class: 'btn btn-primary btn-sm',
              onClick: () => openRuleModal({ devices: cachedDevices, onSaved: loadTab })
            }, [svgIcon('icon-plus', 14), el('span', { text: 'New Rule' })])
          : null,
        el('button', {
          type: 'button',
          class: 'btn-icon',
          title: 'Refresh',
          'aria-label': 'Refresh alarms and rules',
          onClick: () => loadTab()
        }, [svgIcon('icon-refresh', 15)])
      ]
    })
  );
  container.append(tabSlot, filterSlot, bodySlot);

  function renderTabs() {
    clear(tabSlot);
    tabSlot.appendChild(
      el('div', { class: 'tab-bar', role: 'tablist' }, [
        el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': activeTab === 'alarms' ? 'true' : 'false',
          class: `tab-btn${activeTab === 'alarms' ? ' active' : ''}`,
          text: 'Active & Historical Alarms',
          onClick: () => {
            activeTab = 'alarms';
            renderTabs();
            renderFilterBar();
            loadTab();
          }
        }),
        el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': activeTab === 'rules' ? 'true' : 'false',
          class: `tab-btn${activeTab === 'rules' ? ' active' : ''}`,
          text: 'Monitoring Rules',
          onClick: () => {
            activeTab = 'rules';
            renderTabs();
            renderFilterBar();
            loadTab();
          }
        })
      ])
    );
  }

  function renderFilterBar() {
    clear(filterSlot);
    const roomSel = el(
      'select',
      { class: 'select', 'aria-label': 'Filter by room' },
      [
        el('option', { value: '', text: 'All rooms' }),
        ...cachedRooms.map((r) =>
          el('option', { value: r.room_id, text: `${r.room_code} · ${r.name}`, selected: r.room_id === roomFilter })
        )
      ]
    );
    roomSel.addEventListener('change', () => {
      roomFilter = roomSel.value;
      loadTab();
    });

    if (activeTab === 'rules') {
      filterSlot.appendChild(el('div', { class: 'card card-compact filter-bar' }, [roomSel]));
      return;
    }

    const searchIn = el('input', {
      class: 'input',
      type: 'search',
      value: searchFilter,
      placeholder: 'Search alarm title or device...',
      'aria-label': 'Search alarms'
    });
    let t = null;
    searchIn.addEventListener('input', () => {
      searchFilter = searchIn.value.trim();
      clearTimeout(t);
      t = setTimeout(loadTab, 220);
    });

    const stateSel = el(
      'select',
      { class: 'select', 'aria-label': 'Filter by alarm state' },
      [
        { v: '', l: 'All states' },
        { v: 'ACTIVE', l: 'Active' },
        { v: 'ACKNOWLEDGED', l: 'Acknowledged' },
        { v: 'RESOLVED', l: 'Resolved' }
      ].map((o) => el('option', { value: o.v, text: o.l, selected: o.v === alarmStateFilter }))
    );
    stateSel.addEventListener('change', () => {
      alarmStateFilter = stateSel.value;
      loadTab();
    });

    const sevSel = el(
      'select',
      { class: 'select', 'aria-label': 'Filter by severity' },
      [
        { v: '', l: 'All severities' },
        { v: 'CRITICAL', l: 'Critical' },
        { v: 'WARNING', l: 'Warning' },
        { v: 'INFO', l: 'Info' }
      ].map((o) => el('option', { value: o.v, text: o.l, selected: o.v === alarmSevFilter }))
    );
    sevSel.addEventListener('change', () => {
      alarmSevFilter = sevSel.value;
      loadTab();
    });

    filterSlot.appendChild(
      el('div', { class: 'card card-compact filter-bar' }, [searchIn, stateSel, sevSel, roomSel])
    );
  }

  async function loadTab() {
    if (disposed) return;
    clear(bodySlot);
    bodySlot.appendChild(loadingSkeleton('table', 4));

    try {
      if (activeTab === 'alarms') {
        const res = await api.listAlarms({
          state: alarmStateFilter,
          severity: alarmSevFilter,
          room_id: roomFilter,
          search: searchFilter,
          limit: 100
        });
        if (disposed) return;
        const rows = (res.alarms || []).sort((a, b) => {
          const activeA = a.state === 'RESOLVED' ? 1 : 0;
          const activeB = b.state === 'RESOLVED' ? 1 : 0;
          if (activeA !== activeB) return activeA - activeB;
          return severityWeight(a.severity) - severityWeight(b.severity);
        });

        clear(bodySlot);
        bodySlot.appendChild(
          renderAdaptiveCollection({
            ariaLabel: 'Facility alarms list',
            rows,
            onRowClick: (a) => openAlarmDrawer(a),
            emptyNode: emptyState({
              icon: 'icon-check-circle',
              title: 'No alarms match the current filter',
              message: 'Active and historical threshold or stale-device alarms appear here.'
            }),
            columns: [
              {
                label: 'Severity',
                render: (a) => statusIndicator(a.severity || 'WARNING', null, { compact: true })
              },
              {
                label: 'State',
                render: (a) => statusIndicator(a.state || 'ACTIVE', null, { compact: true })
              },
              {
                label: 'Alarm & Target',
                render: (a) =>
                  el('div', { class: 'stack-xs' }, [
                    el('span', { class: 'font-semibold', text: a.title }),
                    el('span', {
                      class: 'text-xs text-muted',
                      text: `${a.device_name || a.device_id}${a.room_code ? ` · ${a.room_code}` : ''}`
                    })
                  ])
              },
              {
                label: 'Raised',
                className: 'mono text-xs text-secondary tabular-nums',
                render: (a) => formatAge(a.raised_at)
              },
              {
                label: 'Actions',
                align: 'right',
                render: (a) =>
                  el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, [
                    el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-sm',
                      text: 'Timeline',
                      onClick: (e) => {
                        e.stopPropagation();
                        openAlarmDrawer(a);
                      }
                    }),
                    admin && a.state === 'ACTIVE'
                      ? el('button', {
                          type: 'button',
                          class: 'btn btn-ghost btn-sm',
                          text: 'Ack',
                          onClick: (e) => {
                            e.stopPropagation();
                            openAlarmActionModal({ alarm: a, action: 'acknowledge', onDone: loadTab });
                          }
                        })
                      : null
                  ])
              }
            ],
            renderMobileCard: (a) =>
              el('article', { class: 'card record-card' }, [
                el('div', { class: 'record-card-head' }, [
                  statusIndicator(a.severity || 'WARNING', null, { compact: true }),
                  statusIndicator(a.state || 'ACTIVE', null, { compact: true })
                ]),
                el('div', { class: 'font-semibold', text: a.title }),
                el('div', {
                  class: 'text-xs text-secondary',
                  text: `${a.device_name || a.device_id} · Raised ${formatAge(a.raised_at)}`
                }),
                el('div', { class: 'record-card-actions' }, [
                  el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: 'View Timeline',
                    onClick: () => openAlarmDrawer(a)
                  }),
                  admin && a.state === 'ACTIVE'
                    ? el('button', {
                        type: 'button',
                        class: 'btn btn-primary btn-sm',
                        text: 'Acknowledge',
                        onClick: () => openAlarmActionModal({ alarm: a, action: 'acknowledge', onDone: loadTab })
                      })
                    : null
                ])
              ])
          })
        );
      } else {
        const res = await api.listRules({ room_id: roomFilter });
        if (disposed) return;
        const rules = res.rules || [];

        clear(bodySlot);
        bodySlot.appendChild(
          renderAdaptiveCollection({
            ariaLabel: 'Monitoring rules directory',
            rows: rules,
            emptyNode: emptyState({
              icon: 'icon-sliders',
              title: 'No monitoring rules defined',
              message: 'Create a deterministic threshold or boolean sensor rule to automate facility alarming.',
              actionLabel: admin ? 'Create Rule' : '',
              onAction: admin ? () => openRuleModal({ devices: cachedDevices, onSaved: loadTab }) : null
            }),
            columns: [
              {
                label: 'Rule Name',
                render: (r) =>
                  el('div', { class: 'stack-xs' }, [
                    el('span', { class: 'font-semibold', text: r.name }),
                    el('span', { class: 'mono text-xs text-muted', text: `${r.device_name || r.device_id} · ${r.endpoint_key}` })
                  ])
              },
              {
                label: 'Severity',
                render: (r) => statusIndicator(r.severity || 'WARNING', null, { compact: true })
              },
              {
                label: 'Condition & Hysteresis',
                className: 'mono text-xs tabular-nums',
                render: (r) => {
                  const cond = r.condition_type || 'THRESHOLD_HIGH';
                  if (cond === 'BOOLEAN_TRUE' || cond === 'BOOLEAN_FALSE') {
                    return `${cond} (hold ${r.hold_s}s / clear ${r.clear_hold_s}s)`;
                  }
                  const sym = cond === 'THRESHOLD_LOW' ? '<=' : '>=';
                  const clrSym = cond === 'THRESHOLD_LOW' ? '>=' : '<=';
                  return `${sym} ${r.threshold} (clear ${clrSym} ${r.clear_threshold}, hold ${r.hold_s}s)`;
                }
              },
              {
                label: 'Status',
                render: (r) => statusIndicator(r.enabled ? 'ACTIVE' : 'DISABLED', r.enabled ? 'Enabled' : 'Disabled', { compact: true })
              },
              {
                label: 'Actions',
                align: 'right',
                render: (r) =>
                  admin
                    ? el('button', {
                        type: 'button',
                        class: 'btn btn-secondary btn-sm',
                        text: 'Edit',
                        onClick: () => openRuleModal({ rule: r, devices: cachedDevices, onSaved: loadTab })
                      })
                    : el('span', { class: 'text-xs text-muted', text: 'Read-only' })
              }
            ],
            renderMobileCard: (r) =>
              el('article', { class: 'card record-card' }, [
                el('div', { class: 'record-card-head' }, [
                  el('div', { class: 'font-semibold', text: r.name }),
                  statusIndicator(r.enabled ? 'ACTIVE' : 'DISABLED', r.enabled ? 'Enabled' : 'Disabled', { compact: true })
                ]),
                el('div', { class: 'mono text-xs text-secondary', text: `${r.device_id}/${r.endpoint_key} · ${r.condition_type}` }),
                admin
                  ? el('div', { class: 'record-card-actions' }, [
                      el('button', {
                        type: 'button',
                        class: 'btn btn-secondary btn-sm',
                        text: 'Edit Rule',
                        onClick: () => openRuleModal({ rule: r, devices: cachedDevices, onSaved: loadTab })
                      })
                    ])
                  : null
              ])
          })
        );
      }
    } catch (err) {
      if (disposed) return;
      clear(bodySlot);
      bodySlot.appendChild(
        errorPanel({
          title: 'Failed to load monitoring data',
          message: err.message,
          onRetry: loadTab
        })
      );
    }
  }

  async function init() {
    const [roomsRes, devRes] = await Promise.allSettled([
      api.listRooms({ status: '' }),
      api.listDevices({ include_archived: false })
    ]);
    if (disposed) return;
    if (roomsRes.status === 'fulfilled') cachedRooms = roomsRes.value.rooms || [];
    if (devRes.status === 'fulfilled') cachedDevices = devRes.value.devices || [];
    renderTabs();
    renderFilterBar();
    await loadTab();
  }

  init();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
    }
  };
}

// ============================================================================
// NOTIFICATIONS CENTER (/app/notifications)
// ============================================================================
export function renderNotificationsPage({ navigate }) {
  const container = el('div', { class: 'stack-lg' });
  let disposed = false;

  let unreadOnly = false;
  let severityFilter = '';
  let categoryFilter = '';
  let searchFilter = '';
  let page = 1;
  let latestId = 0;

  const prefSlot = el('div');
  const listSlot = el('div');

  const searchIn = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search notification title or message...',
    'aria-label': 'Search notifications'
  });
  let searchTimer = null;
  searchIn.addEventListener('input', () => {
    searchFilter = searchIn.value.trim();
    page = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 220);
  });

  const sevSel = el(
    'select',
    { class: 'select', 'aria-label': 'Filter by severity' },
    [
      { v: '', l: 'All severities' },
      { v: 'CRITICAL', l: 'Critical' },
      { v: 'WARNING', l: 'Warning' },
      { v: 'INFO', l: 'Info' }
    ].map((o) => el('option', { value: o.v, text: o.l }))
  );
  sevSel.addEventListener('change', () => {
    severityFilter = sevSel.value;
    page = 1;
    load();
  });

  const catSel = el(
    'select',
    { class: 'select', 'aria-label': 'Filter by category' },
    [
      { v: '', l: 'All categories' },
      { v: 'ALARM', l: 'Alarm' },
      { v: 'DEVICE', l: 'Device' },
      { v: 'COMMAND', l: 'Command' },
      { v: 'SYSTEM', l: 'System' },
      { v: 'ADMIN', l: 'Admin' },
      { v: 'AUTH', l: 'Auth' }
    ].map((o) => el('option', { value: o.v, text: o.l }))
  );
  catSel.addEventListener('change', () => {
    categoryFilter = catSel.value;
    page = 1;
    load();
  });

  const unreadSegSlot = el('div');
  function renderUnreadToggle() {
    clear(unreadSegSlot);
    unreadSegSlot.appendChild(
      segmentedFilter({
        ariaLabel: 'Notification read filter',
        value: unreadOnly ? 'unread' : 'all',
        options: [
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread' }
        ],
        onChange: (val) => {
          unreadOnly = val === 'unread';
          page = 1;
          renderUnreadToggle();
          load();
        }
      })
    );
  }

  const markAllBtn = el('button', {
    type: 'button',
    class: 'btn btn-secondary btn-sm',
    text: 'Mark All Read',
    onClick: async () => {
      if (!latestId) {
        showToast('Nothing to mark', 'No notifications available.', 'info');
        return;
      }
      try {
        await api.markAllNotificationsRead(latestId);
        showToast('Notifications updated', 'All of your notifications up to the latest record have been marked as read.', 'success');
        await refreshHeaderCounters();
        load();
      } catch (err) {
        showToast('Update failed', err.message, 'error');
      }
    }
  });

  container.appendChild(
    pageHeader({
      title: 'Notifications',
      description: 'Personal operator alert inbox scoped to your role with persistent read tracking.',
      actions: [
        markAllBtn,
        el('button', {
          type: 'button',
          class: 'btn-icon',
          title: 'Refresh notifications',
          'aria-label': 'Refresh notifications',
          onClick: () => load()
        }, [svgIcon('icon-refresh', 15)])
      ]
    })
  );

  container.appendChild(prefSlot);
  container.appendChild(
    el('div', { class: 'card card-compact filter-bar' }, [unreadSegSlot, searchIn, sevSel, catSel])
  );
  container.appendChild(listSlot);
  renderUnreadToggle();

  async function loadPrefs() {
    try {
      const p = await api.getNotificationPrefs();
      if (disposed) return;
      store.criticalSoundEnabled = Boolean(p.critical_sound);
      clear(prefSlot);
      const soundCb = el('input', { id: 'notification-critical-sound', type: 'checkbox', checked: store.criticalSoundEnabled });
      const audioState = el('span', {
        id: 'notification-audio-state',
        class: 'text-xs text-muted',
        text: store.notificationAudioUnlocked ? 'Audio is enabled for this browser session' : 'Audio permission is needed in this browser session'
      });
      const enableAudioBtn = el('button', {
        id: 'notification-audio-enable',
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        text: store.notificationAudioUnlocked ? 'Test Sound' : 'Enable Audio',
        onClick: async () => {
          enableAudioBtn.disabled = true;
          try {
            await unlockNotificationAudio();
            enableAudioBtn.textContent = 'Test Sound';
            audioState.textContent = 'Audio is enabled for this browser session';
            showToast('Audio enabled', 'A short local test cue was played. Critical notifications can now sound while this console is open.', 'success');
          } catch (err) {
            showToast('Audio unavailable', err.message, 'warning');
          } finally {
            enableAudioBtn.disabled = false;
          }
        }
      });
      soundCb.addEventListener('change', async () => {
        const nextValue = soundCb.checked;
        soundCb.disabled = true;
        try {
          if (nextValue && !store.notificationAudioUnlocked) {
            await unlockNotificationAudio();
            enableAudioBtn.textContent = 'Test Sound';
            audioState.textContent = 'Audio is enabled for this browser session';
          }
          await api.updateNotificationPrefs({ critical_sound: nextValue });
          store.criticalSoundEnabled = nextValue;
          showToast('Preference saved', `Critical alert sound ${nextValue ? 'enabled' : 'disabled'}.`, 'success');
        } catch (err) {
          soundCb.checked = !nextValue;
          showToast('Save failed', err.message, 'error');
        } finally {
          soundCb.disabled = false;
        }
      });
      prefSlot.appendChild(
        el('div', { class: 'card card-compact stack-sm' }, [
          el('div', { class: 'row-between' }, [
            el('label', { class: 'checkbox-row text-sm' }, [
              soundCb,
              el('span', { text: 'Play audio cue for incoming CRITICAL alerts (per-operator preference)' })
            ]),
            enableAudioBtn
          ]),
          audioState,
          el('span', { class: 'text-xs text-muted', text: 'Sound is local to this browser tab/session; it does not provide background or OS notifications.' })
        ])
      );
    } catch {
      // Non-fatal
    }
  }

  async function load() {
    if (disposed) return;
    clear(listSlot);
    listSlot.appendChild(loadingSkeleton('table', 4));

    try {
      const res = await api.listNotifications({
        unread: unreadOnly ? 'true' : '',
        severity: severityFilter,
        category: categoryFilter,
        search: searchFilter,
        page,
        limit: 25
      });
      if (disposed) return;

      const items = res.notifications || [];
      latestId = Number(res.latest_id || items[0]?.id || 0);
      const total = Number(res.total || items.length);
      const totalPages = Math.max(1, Math.ceil(total / 25));

      clear(listSlot);
      if (items.length === 0) {
        listSlot.appendChild(
          el('div', { class: 'card' }, [
            emptyState({
              icon: 'icon-bell',
              title: unreadOnly ? 'No unread notifications' : 'No notifications found',
              message: unreadOnly
                ? 'You are caught up on all facility alerts.'
                : 'Adjust your filters or wait for facility events.'
            })
          ])
        );
        return;
      }

      const listCard = el(
        'div',
        { class: 'card stack-sm' },
        [
          el('div', { class: 'row-between' }, [
            el('span', { class: 'text-xs text-muted tabular-nums', text: `${res.unread ?? 0} unread · ${total} matching notifications` }),
            el('div', { class: 'btn-row' }, [
              el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                disabled: page <= 1,
                text: 'Prev',
                onClick: () => {
                  page = Math.max(1, page - 1);
                  load();
                }
              }),
              el('span', { class: 'mono text-xs text-muted tabular-nums', text: `Page ${page} / ${totalPages}` }),
              el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                disabled: page >= totalPages,
                text: 'Next',
                onClick: () => {
                  page = Math.min(totalPages, page + 1);
                  load();
                }
              })
            ])
          ]),
          el(
            'div',
            { class: 'queue-list' },
            items.map((n) => {
              const isRead = Boolean(n.read_at);
              return el('div', { class: 'queue-item' }, [
                el('div', { class: 'queue-item-main' }, [
                  el('div', { class: 'row-gap-sm' }, [
                    statusIndicator(n.severity || 'INFO', n.category || 'SYSTEM', { compact: true }),
                    !isRead ? el('span', { class: 'meta-tag', text: 'UNREAD' }) : null,
                    el('span', { class: 'mono text-xs text-muted tabular-nums', text: formatTimestamp(n.timestamp) })
                  ]),
                  el('div', { class: 'queue-item-title', text: n.title }),
                  n.message ? el('div', { class: 'queue-item-meta', text: n.message }) : null,
                  n.device_id
                    ? el('div', { class: 'text-xs text-muted mono', text: `Device: ${n.device_id}${n.room_code ? ` · ${n.room_code}` : ''}` })
                    : null
                ]),
                el('div', { class: 'btn-row' }, [
                  n.device_id
                    ? el('button', {
                        type: 'button',
                        class: 'btn btn-ghost btn-sm',
                        text: 'Device',
                        onClick: () => navigate(`/app/devices/${encodeURIComponent(n.device_id)}`)
                      })
                    : null,
                  el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: isRead ? 'Mark Unread' : 'Mark Read',
                    onClick: async () => {
                      try {
                        await api.markNotificationRead(n.id, !isRead);
                        await refreshHeaderCounters();
                        load();
                      } catch (err) {
                        showToast('Update failed', err.message, 'error');
                      }
                    }
                  })
                ])
              ]);
            })
          )
        ]
      );

      listSlot.appendChild(listCard);
    } catch (err) {
      if (disposed) return;
      clear(listSlot);
      listSlot.appendChild(
        errorPanel({
          title: 'Failed to load notifications',
          message: err.message,
          onRetry: load
        })
      );
    }
  }

  const unsub = onLiveEvent('notifications', () => {
    if (!disposed) load();
  });

  loadPrefs();
  load();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
      clearTimeout(searchTimer);
      unsub();
    }
  };
}

// ============================================================================
// EVENTS & AUDIT LOGS (/app/events) — With Slide-Over Record Detail Drawer
// ============================================================================
export function renderEventsPage() {
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let disposed = false;

  const sources = [
    { id: 'access_logs', label: 'Access Logs', fetch: () => api.getLogs('access_logs', 200).then((r) => r.rows || r.logs || r) },
    { id: 'environmental_telemetry', label: 'Env Telemetry', fetch: () => api.getLogs('environmental_telemetry', 200).then((r) => r.rows || r.logs || r) },
    { id: 'system_errors', label: 'System Errors', fetch: () => api.getLogs('system_errors', 200).then((r) => r.rows || r.logs || r) },
    { id: 'commands', label: 'Command Audit', fetch: () => api.getRecentCommands().then((r) => r.commands || []) }
  ];
  if (admin) {
    sources.push(
      { id: 'management_audit', label: 'Management Audit', fetch: () => api.getManagementAudit().then((r) => r.events || []) }
    );
  }

  let currentSource = sources[0].id;
  let searchFilter = '';
  let loadedRows = [];

  const tabSlot = el('div');
  const tableSlot = el('div');

  const searchIn = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Filter loaded rows by keyword, actor, device, or status...',
    'aria-label': 'Filter audit rows'
  });
  searchIn.addEventListener('input', () => {
    searchFilter = searchIn.value.trim().toLowerCase();
    renderRows();
  });

  const exportBtn = el('button', {
    type: 'button',
    class: 'btn btn-secondary btn-sm',
    onClick: () => {
      const filtered = getFilteredRows();
      if (!filtered.length) {
        showToast('Nothing to export', 'No rows match the current filter.', 'info');
        return;
      }
      const keys = Object.keys(filtered[0]);
      exportRowsToCsv(
        `lci-sfm-${currentSource}-${new Date().toISOString().slice(0, 10)}.csv`,
        keys.map((k) => ({ label: k, key: k })),
        filtered
      );
      showToast('CSV exported', `Exported ${filtered.length} filtered rows from ${currentSource}.`, 'success');
    }
  }, [svgIcon('icon-download', 14), el('span', { text: 'Export Filtered CSV' })]);

  container.appendChild(
    pageHeader({
      title: 'Events & Audit Logs',
      description: 'Inspect persisted SQLite access, telemetry, error, command, and administrative audit trails. Click any row to open the detail drawer.',
      actions: [
        exportBtn,
        el('button', {
          type: 'button',
          class: 'btn-icon',
          title: 'Refresh log table',
          'aria-label': 'Refresh log table',
          onClick: () => loadSource()
        }, [svgIcon('icon-refresh', 15)])
      ]
    })
  );

  container.appendChild(tabSlot);
  container.appendChild(
    el('div', { class: 'card card-compact row-between' }, [
      searchIn,
      el('span', { class: 'text-xs text-muted', text: 'Shows latest 200 persisted rows; CSV exports current filtered view.' })
    ])
  );
  container.appendChild(tableSlot);

  function getFilteredRows() {
    if (!searchFilter) return loadedRows;
    return loadedRows.filter((row) => JSON.stringify(row).toLowerCase().includes(searchFilter));
  }

  function openRecordDrawer(row) {
    const entries = Object.entries(row).map(([k, v]) => ({
      label: k.replace(/_/g, ' '),
      value: v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v),
      mono: /id|at|time|ip|state|status|code|temp|hum|smoke|seq/i.test(k)
    }));

    openDrawer({
      title: `Audit Record · ${currentSource.replace(/_/g, ' ')}`,
      subtitle: 'Persisted SQLite Entry',
      body: el('div', { class: 'stack-md' }, [
        keyValueList(entries),
        disclaimerBanner({
          icon: 'icon-shield',
          tone: 'info',
          message: 'Sensitive credentials (password hashes, PIN hashes, and session verifiers) are excluded at the SQLite query layer.'
        })
      ]),
      actions: [
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Close', onClick: closeDrawer })
      ]
    });
  }

  function renderTabs() {
    clear(tabSlot);
    tabSlot.appendChild(
      el(
        'div',
        { class: 'tab-bar', role: 'tablist' },
        sources.map((s) =>
          el('button', {
            type: 'button',
            role: 'tab',
            'aria-selected': currentSource === s.id ? 'true' : 'false',
            class: `tab-btn${currentSource === s.id ? ' active' : ''}`,
            text: s.label,
            onClick: () => {
              currentSource = s.id;
              renderTabs();
              loadSource();
            }
          })
        )
      )
    );
  }

  function renderRows() {
    clear(tableSlot);
    const rows = getFilteredRows();
    if (!rows.length) {
      tableSlot.appendChild(
        el('div', { class: 'card' }, [
          emptyState({
            icon: 'icon-list',
            title: 'No audit records found',
            message: searchFilter ? 'Try clearing the search query.' : 'No rows have been persisted in this table yet.'
          })
        ])
      );
      return;
    }

    const preferredKeys = Object.keys(rows[0]).slice(0, 5);
    tableSlot.appendChild(
      renderAdaptiveCollection({
        ariaLabel: `${currentSource} records`,
        rows: rows.slice(0, 100),
        onRowClick: (row) => openRecordDrawer(row),
        columns: [
          ...preferredKeys.map((k) => ({
            label: k.replace(/_/g, ' '),
            className: /time|at|id|ip|temp|hum|smoke/i.test(k) ? 'mono text-xs tabular-nums' : 'text-sm',
            render: (row) => {
              const v = row[k];
              if (v === null || v === undefined || v === '') return '—';
              if (/timestamp|issued_at|created_at|recorded_at/i.test(k)) return formatTimestamp(v);
              const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
              return str.length > 54 ? `${str.slice(0, 54)}…` : str;
            }
          })),
          {
            label: 'Details',
            align: 'right',
            render: (row) =>
              el('button', {
                type: 'button',
                class: 'btn btn-ghost btn-sm',
                text: 'Inspect',
                onClick: (e) => {
                  e.stopPropagation();
                  openRecordDrawer(row);
                }
              })
          }
        ],
        renderMobileCard: (row) =>
          el(
            'article',
            { class: 'card record-card', onClick: () => openRecordDrawer(row) },
            [
              el('div', { class: 'record-card-grid' },
                preferredKeys.slice(0, 4).map((k) =>
                  el('div', { class: 'record-card-field' }, [
                    el('span', { class: 'record-card-label', text: k.replace(/_/g, ' ') }),
                    el('span', { class: 'mono text-xs truncate', text: String(row[k] ?? '—') })
                  ])
                )
              ),
              el('div', { class: 'record-card-actions' }, [
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: 'Inspect Record',
                  onClick: (e) => {
                    e.stopPropagation();
                    openRecordDrawer(row);
                  }
                })
              ])
            ]
          )
      })
    );
  }

  async function loadSource() {
    if (disposed) return;
    clear(tableSlot);
    tableSlot.appendChild(loadingSkeleton('table', 5));
    const src = sources.find((s) => s.id === currentSource);
    try {
      const data = await src.fetch();
      if (disposed) return;
      loadedRows = Array.isArray(data) ? data : [];
      renderRows();
    } catch (err) {
      if (disposed) return;
      clear(tableSlot);
      tableSlot.appendChild(
        errorPanel({
          title: `Failed to load ${src?.label || 'events'}`,
          message: err.message,
          onRetry: loadSource
        })
      );
    }
  }

  renderTabs();
  loadSource();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
    }
  };
}
