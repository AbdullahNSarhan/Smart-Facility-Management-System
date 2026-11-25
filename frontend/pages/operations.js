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
import { el, clear, svgIcon, formatAge, formatTimestamp, formatNumber, exportRowsToCsv, buildRollupChartSvg } from '../utils.js';
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
import { EMPTY_ILLUSTRATIONS } from '../visuals.js';

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
    id: 'rule-name-input',
    class: 'input',
    type: 'text',
    value: rule?.name || '',
    placeholder: 'e.g. High Rack Temperature',
    maxlength: 80
  });
  const devSelect = el('select', { id: 'rule-device-select', class: 'select', disabled: isEdit });
  const epSelect = el('select', { id: 'rule-endpoint-select', class: 'select', disabled: isEdit });
  const sevSelect = el(
    'select',
    { id: 'rule-severity-select', class: 'select' },
    ['WARNING', 'CRITICAL'].map((s) => el('option', { value: s, text: s, selected: (rule?.severity || 'WARNING') === s }))
  );
  const condSelect = el('select', { id: 'rule-condition-select', class: 'select' });
  const thresholdInput = el('input', {
    id: 'rule-threshold-input',
    class: 'input mono',
    type: 'number',
    step: 'any',
    value: String(rule?.threshold ?? 30)
  });
  const clearThresholdInput = el('input', {
    id: 'rule-clear-threshold-input',
    class: 'input mono',
    type: 'number',
    step: 'any',
    value: String(rule?.clear_threshold ?? 28)
  });
  const holdInput = el('input', {
    id: 'rule-hold-input',
    class: 'input mono',
    type: 'number',
    min: 0,
    max: 3600,
    value: String(rule?.hold_s ?? 10)
  });
  const clearHoldInput = el('input', {
    id: 'rule-clear-hold-input',
    class: 'input mono',
    type: 'number',
    min: 0,
    max: 3600,
    value: String(rule?.clear_hold_s ?? 10)
  });
  const enabledCb = el('input', { id: 'rule-enabled-cb', type: 'checkbox', checked: rule ? Boolean(rule.enabled) : true });
  const thresholdWrap = el('div', { class: 'form-grid form-field-full' });
  const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });

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
          { v: 'THRESHOLD_HIGH', l: 'Threshold High (>= trigger, < recovery)' },
          { v: 'THRESHOLD_LOW', l: 'Threshold Low (<= trigger, > recovery)' }
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
        el('label', { class: 'form-label', for: 'rule-threshold-input', text: isLow ? 'Trigger Threshold (<=) *' : 'Trigger Threshold (>=) *' }),
        thresholdInput
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'rule-clear-threshold-input', text: isLow ? 'Recovery Hysteresis (>) *' : 'Recovery Hysteresis (<) *' }),
        clearThresholdInput,
        el('span', {
          class: 'form-hint',
          text: isLow
            ? 'Must be strictly above (>) trigger threshold to prevent flapping.'
            : 'Must be strictly below (<) trigger threshold to prevent flapping.'
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
        el('label', { class: 'form-label', for: 'rule-name-input', text: 'Rule Name *' }),
        nameInput
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'rule-device-select', text: 'Target Device (Sensors only) *' }),
        devSelect
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'rule-endpoint-select', text: 'Sensor Endpoint *' }),
        epSelect
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'rule-severity-select', text: 'Severity *' }),
        sevSelect
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'rule-condition-select', text: 'Condition *' }),
        condSelect
      ]),
      thresholdWrap,
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'rule-hold-input', text: 'Trigger Hold / Dwell (seconds)' }),
        holdInput,
        el('span', { class: 'form-hint', text: 'Reading must remain breached for this duration before raising (0–3600s).' })
      ]),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'rule-clear-hold-input', text: 'Recovery Hold (seconds)' }),
        clearHoldInput,
        el('span', { class: 'form-hint', text: 'Reading must remain recovered before auto-resolving (0–3600s).' })
      ]),
      el('div', { class: 'form-field form-field-full' }, [
        el('label', { class: 'checkbox-row', for: 'rule-enabled-cb' }, [enabledCb, el('span', { text: 'Enable rule evaluation' })])
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
      if (!boolMode && conditionType === 'THRESHOLD_HIGH' && clearThreshold >= threshold) {
        errBox.textContent = 'For THRESHOLD_HIGH, Recovery Hysteresis must be strictly below (<) Trigger Threshold.';
        errBox.hidden = false;
        return;
      }
      if (!boolMode && conditionType === 'THRESHOLD_LOW' && clearThreshold <= threshold) {
        errBox.textContent = 'For THRESHOLD_LOW, Recovery Hysteresis must be strictly above (>) Trigger Threshold.';
        errBox.hidden = false;
        return;
      }
      const holdS = Number(holdInput.value);
      const clearHoldS = Number(clearHoldInput.value);
      if (!Number.isInteger(holdS) || holdS < 0 || holdS > 3600 || !Number.isInteger(clearHoldS) || clearHoldS < 0 || clearHoldS > 3600) {
        errBox.textContent = 'Hold and Recovery Hold timers must be whole integers between 0 and 3600 seconds.';
        errBox.hidden = false;
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      try {
        const payload = {
          name,
          device_id: selectedDeviceId,
          endpoint_key: selectedEndpointKey,
          severity: sevSelect.value,
          condition_type: conditionType,
          threshold,
          clear_threshold: clearThreshold,
          hold_s: holdS,
          clear_hold_s: clearHoldS,
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
        submitBtn.textContent = isEdit ? 'Save Rule' : 'Create Rule';
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

function toIsoOrEmpty(localVal) {
  if (!localVal) return '';
  const parsed = new Date(localVal);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

export function renderAlarmsPage({ query, navigate }) {
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let disposed = false;

  let activeTab = 'alarms'; // alarms | rules
  let alarmStateFilter = '';
  let alarmSevFilter = '';
  let roomFilter = '';
  let deviceFilter = query?.get('device_id') || '';
  let fromFilter = '';
  let toFilter = '';
  let searchFilter = '';
  let page = 1;
  const pageSize = 25;
  let liveRefreshTimer = null;
  let searchTimer = null;
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
      page = 1;
      renderFilterBar();
      loadTab();
    });

    const devSel = el(
      'select',
      { class: 'select', 'aria-label': 'Filter by device' },
      [
        el('option', { value: '', text: 'All devices' }),
        ...cachedDevices.map((d) =>
          el('option', { value: d.device_id, text: `${d.name} (${d.device_id})`, selected: d.device_id === deviceFilter })
        )
      ]
    );
    devSel.addEventListener('change', () => {
      deviceFilter = devSel.value;
      page = 1;
      renderFilterBar();
      loadTab();
    });

    if (activeTab === 'rules') {
      const clearRulesBtn = el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        text: 'Clear Filters',
        hidden: !(roomFilter || deviceFilter),
        onClick: () => {
          roomFilter = '';
          deviceFilter = '';
          renderFilterBar();
          loadTab();
        }
      });
      filterSlot.appendChild(el('div', { class: 'card card-compact filter-bar' }, [roomSel, devSel, clearRulesBtn]));
      return;
    }

    const hasAlarmFilters = () =>
      Boolean(searchFilter || alarmStateFilter || alarmSevFilter || roomFilter || deviceFilter || fromFilter || toFilter);

    const searchIn = el('input', {
      class: 'input',
      type: 'search',
      value: searchFilter,
      placeholder: 'Search alarm title or device...',
      'aria-label': 'Search alarms'
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

    const fromIn = el('input', {
      id: 'alarm-from-input',
      class: 'input mono text-xs',
      type: 'datetime-local',
      value: fromFilter,
      'aria-label': 'Filter alarms raised from date/time'
    });
    const toIn = el('input', {
      id: 'alarm-to-input',
      class: 'input mono text-xs',
      type: 'datetime-local',
      value: toFilter,
      'aria-label': 'Filter alarms raised to date/time'
    });

    const clearAlarmsBtn = el('button', {
      id: 'alarms-clear-filters-btn',
      type: 'button',
      class: 'btn btn-ghost btn-sm',
      text: 'Clear Filters',
      hidden: !hasAlarmFilters(),
      onClick: () => {
        searchFilter = '';
        alarmStateFilter = '';
        alarmSevFilter = '';
        roomFilter = '';
        deviceFilter = '';
        fromFilter = '';
        toFilter = '';
        page = 1;
        renderFilterBar();
        loadTab();
      }
    });

    searchIn.addEventListener('input', () => {
      searchFilter = searchIn.value.trim();
      page = 1;
      clearAlarmsBtn.hidden = !hasAlarmFilters();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadTab, 220);
    });
    stateSel.addEventListener('change', () => {
      alarmStateFilter = stateSel.value;
      page = 1;
      clearAlarmsBtn.hidden = !hasAlarmFilters();
      loadTab();
    });
    sevSel.addEventListener('change', () => {
      alarmSevFilter = sevSel.value;
      page = 1;
      clearAlarmsBtn.hidden = !hasAlarmFilters();
      loadTab();
    });
    fromIn.addEventListener('change', () => {
      fromFilter = fromIn.value;
      page = 1;
      clearAlarmsBtn.hidden = !hasAlarmFilters();
      loadTab();
    });
    toIn.addEventListener('change', () => {
      toFilter = toIn.value;
      page = 1;
      clearAlarmsBtn.hidden = !hasAlarmFilters();
      loadTab();
    });

    filterSlot.appendChild(
      el('div', { class: 'card card-compact stack-xs' }, [
        el('div', { class: 'filter-bar' }, [searchIn, stateSel, sevSel, roomSel, devSel]),
        el('div', { class: 'filter-bar' }, [
          el('div', { class: 'filter-date-field' }, [
            el('label', { class: 'text-xs text-muted', for: 'alarm-from-input', text: 'From:' }),
            fromIn
          ]),
          el('div', { class: 'filter-date-field' }, [
            el('label', { class: 'text-xs text-muted', for: 'alarm-to-input', text: 'To:' }),
            toIn
          ]),
          clearAlarmsBtn
        ])
      ])
    );
  }

  async function loadTab(silent = false) {
    if (disposed) return;
    if (!silent) {
      clear(bodySlot);
      bodySlot.appendChild(loadingSkeleton('table', 4));
    }

    try {
      if (activeTab === 'alarms') {
        const alarmQuery = {
          state: alarmStateFilter,
          severity: alarmSevFilter,
          room_id: roomFilter,
          device_id: deviceFilter,
          search: searchFilter,
          page,
          limit: pageSize
        };
        const fromIso = toIsoOrEmpty(fromFilter);
        const toIso = toIsoOrEmpty(toFilter);
        if (fromIso) alarmQuery.from = fromIso;
        if (toIso) alarmQuery.to = toIso;

        const res = await api.listAlarms(alarmQuery);
        if (disposed) return;
        const total = Number(res.total ?? (res.alarms || []).length);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const rows = (res.alarms || []).sort((a, b) => {
          const activeA = a.state === 'RESOLVED' ? 1 : 0;
          const activeB = b.state === 'RESOLVED' ? 1 : 0;
          if (activeA !== activeB) return activeA - activeB;
          return severityWeight(a.severity) - severityWeight(b.severity);
        });

        clear(bodySlot);
        if (total > 0) {
          bodySlot.appendChild(
            el('div', { class: 'row-between' }, [
              el('span', {
                class: 'text-xs text-muted mono tabular-nums',
                text: `${res.active ?? 0} active · Showing ${rows.length} of ${total} matching alarms`
              }),
              totalPages > 1
                ? el('div', { class: 'btn-row' }, [
                    el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-sm',
                      disabled: page <= 1,
                      text: 'Prev',
                      onClick: () => {
                        page = Math.max(1, page - 1);
                        loadTab();
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
                        loadTab();
                      }
                    })
                  ])
                : null
            ])
          );
        }
        bodySlot.appendChild(
          renderAdaptiveCollection({
            ariaLabel: 'Facility alarms list',
            rows,
            onRowClick: (a) => openAlarmDrawer(a),
            emptyNode: emptyState({
              illustration: EMPTY_ILLUSTRATIONS.ALARMS_OK,
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
        const res = await api.listRules({ room_id: roomFilter, device_id: deviceFilter });
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
                  const clrSym = cond === 'THRESHOLD_LOW' ? '>' : '<';
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

  const unsubLiveAlarms = onLiveEvent('notifications', () => {
    if (!disposed && activeTab === 'alarms') {
      clearTimeout(liveRefreshTimer);
      liveRefreshTimer = setTimeout(() => loadTab(true), 1000);
    }
  });

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

    const deepAlarmId = query?.get('alarm_id');
    if (deepAlarmId && !disposed) {
      window.history.replaceState({}, '', '/app/alarms');
      openAlarmDrawer({
        alarm_id: deepAlarmId,
        title: 'Loading alarm timeline…',
        severity: 'INFO',
        state: 'ACTIVE'
      });
    }
  }

  init();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
      clearTimeout(liveRefreshTimer);
      clearTimeout(searchTimer);
      unsubLiveAlarms();
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
  let roomFilter = '';
  let deviceFilter = '';
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

  const roomSel = el('select', { class: 'select', 'aria-label': 'Filter notifications by room' }, [
    el('option', { value: '', text: 'All rooms' })
  ]);
  const devSel = el('select', { class: 'select', 'aria-label': 'Filter notifications by device' }, [
    el('option', { value: '', text: 'All devices' })
  ]);

  const clearFiltersBtn = el('button', {
    id: 'notifications-clear-filters-btn',
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    text: 'Clear Filters',
    hidden: true,
    onClick: () => {
      unreadOnly = false;
      severityFilter = '';
      categoryFilter = '';
      roomFilter = '';
      deviceFilter = '';
      searchFilter = '';
      searchIn.value = '';
      sevSel.value = '';
      catSel.value = '';
      roomSel.value = '';
      devSel.value = '';
      page = 1;
      clearFiltersBtn.hidden = true;
      renderUnreadToggle();
      load();
    }
  });

  const syncClearFiltersBtn = () => {
    clearFiltersBtn.hidden = !(unreadOnly || severityFilter || categoryFilter || roomFilter || deviceFilter || searchFilter);
  };

  searchIn.addEventListener('input', () => {
    searchFilter = searchIn.value.trim();
    page = 1;
    syncClearFiltersBtn();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 220);
  });
  sevSel.addEventListener('change', () => {
    severityFilter = sevSel.value;
    page = 1;
    syncClearFiltersBtn();
    load();
  });
  catSel.addEventListener('change', () => {
    categoryFilter = catSel.value;
    page = 1;
    syncClearFiltersBtn();
    load();
  });
  roomSel.addEventListener('change', () => {
    roomFilter = roomSel.value;
    page = 1;
    syncClearFiltersBtn();
    load();
  });
  devSel.addEventListener('change', () => {
    deviceFilter = devSel.value;
    page = 1;
    syncClearFiltersBtn();
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
          syncClearFiltersBtn();
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
    el('div', { class: 'card card-compact filter-bar' }, [
      unreadSegSlot,
      searchIn,
      sevSel,
      catSel,
      roomSel,
      devSel,
      clearFiltersBtn
    ])
  );
  container.appendChild(listSlot);
  renderUnreadToggle();

  async function loadFilterOptions() {
    const [roomsRes, devRes] = await Promise.allSettled([
      api.listRooms({ status: '' }),
      api.listDevices({ include_archived: false })
    ]);
    if (disposed) return;
    if (roomsRes.status === 'fulfilled') {
      for (const r of roomsRes.value.rooms || []) {
        roomSel.appendChild(el('option', { value: r.room_id, text: `${r.room_code} · ${r.name}` }));
      }
    }
    if (devRes.status === 'fulfilled') {
      for (const d of devRes.value.devices || []) {
        devSel.appendChild(el('option', { value: d.device_id, text: `${d.name} (${d.device_id})` }));
      }
    }
  }

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
        room_id: roomFilter,
        device_id: deviceFilter,
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
                  n.alarm_id
                    ? el('button', {
                        type: 'button',
                        class: 'btn btn-secondary btn-sm',
                        text: 'Inspect Alarm',
                        onClick: () => navigate(`/app/alarms?alarm_id=${encodeURIComponent(n.alarm_id)}`)
                      })
                    : null,
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

  loadFilterOptions();
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
  let mfaRefreshTimer = null;
  let rowLimit = 100; // 100 | 250 | 500

  const sources = [
    { id: 'access_logs', label: 'Access Logs', bounded: false, fetch: (lim) => api.getLogs('access_logs', lim).then((r) => r.rows || r.logs || r) },
    { id: 'camera_events', label: 'Camera Events', bounded: false, fetch: (lim) => api.getLogs('camera_events', lim).then((r) => r.rows || r.logs || r) },
    {
      id: 'environmental_telemetry',
      label: 'Env Telemetry',
      bounded: false,
      fetch: (lim) => api.getLogs('environmental_telemetry', lim).then((r) => r.rows || r.logs || r)
    },
    { id: 'system_errors', label: 'System Errors', bounded: false, fetch: (lim) => api.getLogs('system_errors', lim).then((r) => r.rows || r.logs || r) },
    { id: 'commands', label: 'Command Audit', bounded: true, fetch: (lim) => api.getRecentCommands().then((r) => (r.commands || []).slice(0, lim)) }
  ];
  if (admin) {
    sources.push({
      id: 'management_audit',
      label: 'Management Audit',
      bounded: true,
      fetch: (lim) => api.getManagementAudit().then((r) => (r.events || []).slice(0, lim))
    });
  }

  let currentSource = sources[0].id;
  let searchFilter = '';
  let loadedRows = [];
  let rollupRange = '24h'; // 1h | 24h | 7d
  let rollupBucket = '15m'; // 5m | 15m | 1h
  let rollupMetric = 'temperature'; // temperature | humidity

  const tabSlot = el('div');
  const contextBannerSlot = el('div');
  const rollupSlot = el('div');
  const limitSegSlot = el('div');
  const countSpan = el('span', { class: 'text-xs text-muted mono tabular-nums', text: 'Loading records…' });
  const tableSlot = el('div');

  function renderLimitControl() {
    clear(limitSegSlot);
    limitSegSlot.appendChild(
      segmentedFilter({
        ariaLabel: 'Event log row limit',
        value: String(rowLimit),
        options: [
          { value: '100', label: '100' },
          { value: '250', label: '250' },
          { value: '500', label: '500' }
        ],
        onChange: (val) => {
          rowLimit = Number(val) || 100;
          renderLimitControl();
          loadSource();
        }
      })
    );
  }
  renderLimitControl();

  function renderContextBanner() {
    clear(contextBannerSlot);
    if (currentSource === 'camera_events') {
      contextBannerSlot.appendChild(
        el('div', { id: 'camera-events-boundary-banner' }, [
          disclaimerBanner({
            icon: 'icon-camera',
            tone: 'info',
            title: 'Persisted Access-Camera & MFA Verification Log',
            message:
              'Displays persisted SQLite camera_events recorded from MQTT lecf/access/mfa_face verification events (with live updates via /ws/mfa). On-demand live JPEG snapshots from CAMERA_JPEG endpoints are proxied in memory on Device Detail pages and are not stored here.'
          })
        ])
      );
    }
  }

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
  container.appendChild(contextBannerSlot);
  container.appendChild(rollupSlot);
  container.appendChild(
    el('div', { class: 'card card-compact row-between' }, [
      el('div', { class: 'filter-bar', style: 'flex:1 1 280px' }, [
        searchIn,
        el('div', { class: 'row-gap-sm' }, [
          el('span', { class: 'text-xs text-muted', text: 'Rows:' }),
          limitSegSlot
        ])
      ]),
      countSpan
    ])
  );
  container.appendChild(tableSlot);

  async function loadEnvRollup() {
    if (disposed) return;
    clear(rollupSlot);
    if (currentSource !== 'environmental_telemetry') return;

    const panel = el('section', { class: 'card stack-md', id: 'env-telemetry-rollup-panel', 'aria-label': 'Environmental telemetry rollup' });
    const bodyMount = el('div', { class: 'stack-md' }, [loadingSkeleton('kpi', 4)]);

    panel.append(
      el('div', { class: 'card-head' }, [
        el('div', { class: 'stack-xs' }, [
          el('h2', { class: 'card-title', text: 'Time-Bucketed Environmental Rollups' }),
          el('span', {
            class: 'text-xs text-muted',
            text: 'Aggregated strictly from persisted legacy environmental_telemetry SQLite records (generic MQTT_V1 devices use per-device Endpoint History).'
          })
        ]),
        el('div', { class: 'rollup-controls-bar' }, [
          el('div', { class: 'rollup-control-group' }, [
            el('span', { class: 'text-xs text-muted', text: 'Range:' }),
            segmentedFilter({
              ariaLabel: 'Rollup time range',
              value: rollupRange,
              options: [
                { value: '1h', label: '1h' },
                { value: '24h', label: '24h' },
                { value: '7d', label: '7d' }
              ],
              onChange: (val) => {
                rollupRange = val;
                loadEnvRollup();
              }
            })
          ]),
          el('div', { class: 'rollup-control-group' }, [
            el('span', { class: 'text-xs text-muted', text: 'Bucket:' }),
            segmentedFilter({
              ariaLabel: 'Rollup bucket interval',
              value: rollupBucket,
              options: [
                { value: '5m', label: '5m' },
                { value: '15m', label: '15m' },
                { value: '1h', label: '1h' }
              ],
              onChange: (val) => {
                rollupBucket = val;
                loadEnvRollup();
              }
            })
          ]),
          el('div', { class: 'rollup-control-group' }, [
            segmentedFilter({
              ariaLabel: 'Rollup chart metric',
              value: rollupMetric,
              options: [
                { value: 'temperature', label: 'Temp (°C)' },
                { value: 'humidity', label: 'Humidity (%)' }
              ],
              onChange: (val) => {
                rollupMetric = val;
                loadEnvRollup();
              }
            })
          ])
        ])
      ]),
      bodyMount
    );
    rollupSlot.appendChild(panel);

    try {
      const res = await api.getTelemetryAggregate({ range: rollupRange, bucket: rollupBucket });
      if (disposed || currentSource !== 'environmental_telemetry') return;
      const series = Array.isArray(res?.series) ? res.series : [];
      clear(bodyMount);

      if (series.length === 0) {
        bodyMount.appendChild(
          emptyState({
            illustration: EMPTY_ILLUSTRATIONS.TELEMETRY,
            title: `No environmental rollup samples in ${rollupRange.toUpperCase()} window`,
            message:
              'No rows exist in environmental_telemetry for the selected range. Generic MQTT_V1 and simulator telemetry frames are stored in device_frames and inspected per endpoint.'
          })
        );
        return;
      }

      const totalSamples = series.reduce((sum, b) => sum + Number(b.sample_count || 0), 0);
      const weightedTempSum = series.reduce((sum, b) => sum + Number(b.temperature_avg || 0) * Number(b.sample_count || 1), 0);
      const weightedHumSum = series.reduce((sum, b) => sum + Number(b.humidity_avg || 0) * Number(b.sample_count || 1), 0);
      const denom = Math.max(1, totalSamples);
      const tempMin = Math.min(...series.map((b) => Number(b.temperature_min)));
      const tempMax = Math.max(...series.map((b) => Number(b.temperature_max)));
      const tempAvg = weightedTempSum / denom;
      const humMin = Math.min(...series.map((b) => Number(b.humidity_min)));
      const humMax = Math.max(...series.map((b) => Number(b.humidity_max)));
      const humAvg = weightedHumSum / denom;
      const smokeMax = Math.max(...series.map((b) => Number(b.smoke_gas_max || 0)));

      bodyMount.append(
        el('div', { class: 'kpi-grid' }, [
          el('div', { class: 'card card-compact kpi-card' }, [
            el('div', { class: 'kpi-label', text: 'Temperature (Avg)' }),
            el('div', { class: 'kpi-value tabular-nums', text: `${formatNumber(tempAvg, 2)} °C` }),
            el('div', { class: 'kpi-sub mono tabular-nums', text: `Min ${formatNumber(tempMin, 2)} · Max ${formatNumber(tempMax, 2)} °C` })
          ]),
          el('div', { class: 'card card-compact kpi-card' }, [
            el('div', { class: 'kpi-label', text: 'Humidity (Avg)' }),
            el('div', { class: 'kpi-value tabular-nums', text: `${formatNumber(humAvg, 2)} %` }),
            el('div', { class: 'kpi-sub mono tabular-nums', text: `Min ${formatNumber(humMin, 2)} · Max ${formatNumber(humMax, 2)} %` })
          ]),
          el('div', { class: 'card card-compact kpi-card' }, [
            el('div', { class: 'kpi-label', text: 'Peak Smoke / Gas' }),
            el('div', { class: 'kpi-value tabular-nums', text: `${smokeMax} raw` }),
            el('div', { class: 'kpi-sub', text: `Maximum across ${rollupRange.toUpperCase()}` })
          ]),
          el('div', { class: 'card card-compact kpi-card' }, [
            el('div', { class: 'kpi-label', text: 'Aggregated Samples' }),
            el('div', { class: 'kpi-value tabular-nums', text: String(totalSamples) }),
            el('div', { class: 'kpi-sub mono tabular-nums', text: `${series.length} bucket${series.length === 1 ? '' : 's'} (${rollupBucket})` })
          ])
        ]),
        buildRollupChartSvg(series, {
          metric: rollupMetric,
          rangePreset: rollupRange,
          label: `Environmental ${rollupMetric} rollup chart (${rollupRange}, ${rollupBucket} buckets)`
        }),
        el('div', { class: 'table-wrap' }, [
          el('table', { class: 'data-table', 'aria-label': 'Environmental telemetry rollup buckets' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Bucket Start' }),
                el('th', { text: 'Samples' }),
                el('th', { text: 'Temp (Min / Avg / Max)' }),
                el('th', { text: 'Humidity (Min / Avg / Max)' }),
                el('th', { text: 'Smoke Peak' })
              ])
            ]),
            el(
              'tbody',
              {},
              [...series].reverse().slice(0, 24).map((b) =>
                el('tr', {}, [
                  el('td', { class: 'mono text-xs tabular-nums', text: formatTimestamp(b.timestamp) }),
                  el('td', { class: 'mono text-xs tabular-nums', text: String(b.sample_count) }),
                  el('td', {
                    class: 'mono text-xs tabular-nums',
                    text: `${formatNumber(b.temperature_min, 2)} / ${formatNumber(b.temperature_avg, 2)} / ${formatNumber(b.temperature_max, 2)} °C`
                  }),
                  el('td', {
                    class: 'mono text-xs tabular-nums',
                    text: `${formatNumber(b.humidity_min, 2)} / ${formatNumber(b.humidity_avg, 2)} / ${formatNumber(b.humidity_max, 2)} %`
                  }),
                  el('td', { class: 'mono text-xs tabular-nums', text: `${b.smoke_gas_max} raw` })
                ])
              )
            )
          ])
        ])
      );
    } catch (err) {
      if (disposed) return;
      clear(bodyMount);
      bodyMount.appendChild(
        errorPanel({
          title: 'Failed to load environmental rollup',
          message: err.message,
          onRetry: loadEnvRollup
        })
      );
    }
  }

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

  function getCuratedColumns(sourceId) {
    if (sourceId === 'access_logs') {
      return [
        { label: 'Timestamp', className: 'mono text-xs tabular-nums', render: (r) => formatTimestamp(r.timestamp) },
        {
          label: 'Node & Modality',
          render: (r) =>
            el('div', { class: 'stack-xs' }, [
              el('span', { class: 'mono text-xs font-semibold', text: r.node_id || '—' }),
              el('span', { class: 'text-xs text-muted', text: r.modality || '—' })
            ])
        },
        { label: 'Person / Subject', render: (r) => r.username || '—' },
        {
          label: 'Outcome',
          render: (r) => statusIndicator(r.status || r.event || 'INFO', r.event ? `${r.status || ''} · ${r.event}`.replace(/^ · /, '') : null, { compact: true })
        },
        {
          label: 'MFA / Details',
          className: 'text-xs text-secondary',
          render: (r) => [r.mfa_status && r.mfa_status !== 'N/A' ? `MFA: ${r.mfa_status}` : null, r.details].filter(Boolean).join(' · ') || '—'
        }
      ];
    }
    if (sourceId === 'camera_events') {
      return [
        { label: 'Timestamp', className: 'mono text-xs tabular-nums', render: (r) => formatTimestamp(r.timestamp) },
        { label: 'Camera Node', className: 'mono text-xs', render: (r) => r.node_id || '—' },
        { label: 'Subject', render: (r) => r.user_id || 'Unknown' },
        {
          label: 'Verification',
          render: (r) =>
            statusIndicator(r.status || r.event || 'INFO', r.event ? `${r.status || ''} · ${r.event}`.replace(/^ · /, '') : null, { compact: true })
        },
        {
          label: 'Confidence & Details',
          className: 'mono text-xs text-secondary tabular-nums',
          render: (r) => {
            const conf = r.confidence !== null && r.confidence !== undefined ? `${formatNumber(r.confidence, 1)}%` : null;
            return [conf, r.details].filter(Boolean).join(' · ') || '—';
          }
        }
      ];
    }
    if (sourceId === 'environmental_telemetry') {
      return [
        { label: 'Timestamp', className: 'mono text-xs tabular-nums', render: (r) => formatTimestamp(r.timestamp) },
        { label: 'Node / Seq', className: 'mono text-xs tabular-nums', render: (r) => `${r.node_id || '—'}${r.seq !== undefined ? ` #${r.seq}` : ''}` },
        {
          label: 'Temp / Humidity',
          className: 'mono text-xs tabular-nums',
          render: (r) => `${formatNumber(r.temperature, 1)} °C · ${formatNumber(r.humidity, 1)} %`
        },
        { label: 'Smoke / Gas', className: 'mono text-xs tabular-nums', render: (r) => `${r.smoke_gas_level ?? '—'} raw` },
        {
          label: 'Actuators & Door',
          className: 'mono text-xs text-secondary',
          render: (r) => `Fan ${r.fan_relay || '—'} · Light ${r.light_state || '—'} · Door ${r.door_state || '—'}`
        }
      ];
    }
    if (sourceId === 'system_errors') {
      return [
        { label: 'Timestamp', className: 'mono text-xs tabular-nums', render: (r) => formatTimestamp(r.timestamp) },
        { label: 'Severity', render: (r) => statusIndicator(r.severity || 'ERROR', null, { compact: true }) },
        { label: 'Source / Code', className: 'mono text-xs', render: (r) => `${r.source_node || 'system'} · ${r.error_code || 'ERR'}` },
        { label: 'Description', className: 'text-sm', render: (r) => r.error_description || '—' }
      ];
    }
    if (sourceId === 'commands') {
      return [
        { label: 'Issued At', className: 'mono text-xs tabular-nums', render: (r) => formatTimestamp(r.issued_at) },
        { label: 'Target / Command', className: 'mono text-xs', render: (r) => `${r.target_node || '—'} · ${r.command || '—'}` },
        { label: 'Requested', className: 'mono text-xs', render: (r) => String(r.requested_state ?? '—') },
        { label: 'Operator', render: (r) => r.actor_username || '—' },
        { label: 'Lifecycle', render: (r) => statusIndicator(r.lifecycle_state || 'PUBLISHED', null, { compact: true }) }
      ];
    }
    if (sourceId === 'management_audit') {
      return [
        { label: 'Timestamp', className: 'mono text-xs tabular-nums', render: (r) => formatTimestamp(r.timestamp) },
        { label: 'Actor', className: 'font-semibold', render: (r) => r.actor || 'system' },
        { label: 'Action', render: (r) => statusIndicator('INFO', r.action || 'AUDIT', { compact: true }) },
        { label: 'Entity', className: 'mono text-xs', render: (r) => r.entity_id || '—' },
        {
          label: 'Details',
          className: 'text-xs text-secondary',
          render: (r) => {
            const str = typeof r.details === 'object' ? JSON.stringify(r.details) : String(r.details ?? '—');
            return str.length > 64 ? `${str.slice(0, 64)}…` : str;
          }
        }
      ];
    }
    return null;
  }

  function renderRows() {
    clear(tableSlot);
    const srcMeta = sources.find((s) => s.id === currentSource);
    const filtered = getFilteredRows();
    const visibleRows = filtered.slice(0, rowLimit);
    const boundedSuffix = srcMeta?.bounded && rowLimit > 100 ? ' (audit API returns latest 100)' : '';
    countSpan.textContent = searchFilter
      ? `Showing ${visibleRows.length} matching of ${loadedRows.length} fetched${boundedSuffix}`
      : `Showing ${visibleRows.length} of ${loadedRows.length} fetched${boundedSuffix}`;

    if (!visibleRows.length) {
      tableSlot.appendChild(
        el('div', { class: 'card' }, [
          emptyState({
            illustration: EMPTY_ILLUSTRATIONS.AUDIT,
            title: currentSource === 'camera_events' && !searchFilter ? 'No camera verification events recorded' : 'No audit records found',
            message: searchFilter
              ? 'Try clearing the search query.'
              : currentSource === 'camera_events'
                ? 'Persisted lecf/access/mfa_face camera verification events will appear here automatically.'
                : 'No rows have been persisted in this table yet.'
          })
        ])
      );
      return;
    }

    const curated = getCuratedColumns(currentSource);
    const fallbackKeys = Object.keys(visibleRows[0]).slice(0, 5);
    const columns =
      curated ||
      fallbackKeys.map((k) => ({
        label: k.replace(/_/g, ' '),
        className: /time|at|id|ip|temp|hum|smoke/i.test(k) ? 'mono text-xs tabular-nums' : 'text-sm',
        render: (row) => {
          const v = row[k];
          if (v === null || v === undefined || v === '') return '—';
          if (/timestamp|issued_at|created_at|recorded_at/i.test(k)) return formatTimestamp(v);
          const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return str.length > 54 ? `${str.slice(0, 54)}…` : str;
        }
      }));

    tableSlot.appendChild(
      renderAdaptiveCollection({
        ariaLabel: `${currentSource} records`,
        rows: visibleRows,
        onRowClick: (row) => openRecordDrawer(row),
        columns: [
          ...columns,
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
        renderMobileCard: (row) => {
          const badgeState = row.status || row.lifecycle_state || row.severity || row.action || null;
          const timeVal = row.timestamp || row.issued_at || null;
          const titleVal =
            row.event || row.command || row.error_code || row.action || (row.temperature !== undefined ? `${row.temperature} °C` : currentSource);
          const subVal =
            row.username || row.user_id || row.actor_username || row.actor || row.node_id || row.source_node || row.entity_id || '—';
          return el(
            'article',
            { class: 'card record-card' },
            [
              el('div', { class: 'record-card-head' }, [
                el('div', { class: 'stack-xs' }, [
                  el('div', { class: 'font-semibold', text: String(titleVal) }),
                  el('div', { class: 'mono text-xs text-muted', text: String(subVal) })
                ]),
                badgeState ? statusIndicator(badgeState, currentSource === 'management_audit' ? String(badgeState) : null, { compact: true }) : null
              ]),
              timeVal ? el('div', { class: 'mono text-xs text-secondary tabular-nums', text: formatTimestamp(timeVal) }) : null,
              el('div', { class: 'record-card-actions' }, [
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: 'Inspect Record',
                  onClick: () => openRecordDrawer(row)
                })
              ])
            ]
          );
        }
      })
    );
  }

  async function loadSource(silent = false) {
    if (disposed) return;
    renderContextBanner();
    loadEnvRollup();
    if (!silent) {
      clear(tableSlot);
      tableSlot.appendChild(loadingSkeleton('table', 5));
    }
    const src = sources.find((s) => s.id === currentSource);
    try {
      const data = await src.fetch(rowLimit);
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
          onRetry: () => loadSource(false)
        })
      );
    }
  }

  const unsubMfa = onLiveEvent('mfa', () => {
    if (!disposed && (currentSource === 'camera_events' || currentSource === 'access_logs')) {
      clearTimeout(mfaRefreshTimer);
      mfaRefreshTimer = setTimeout(() => loadSource(true), 800);
    }
  });

  renderTabs();
  loadSource();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
      clearTimeout(mfaRefreshTimer);
      unsubMfa();
    }
  };
}
