// LCI-SFM Generic Endpoint Widget Engine
// Renders any registered endpoint purely from Capability + DataType metadata with zero sensor-specific page code.

import { api } from './api.js';
import { store, isAdmin, showToast, confirmDialog } from './store.js';
import { el, formatAge, formatEndpointValue, buildSparklineSvg } from './utils.js';

export function resolveWidgetType(endpoint) {
  const kind = String(endpoint.kind || '').toUpperCase();
  const dataType = String(endpoint.data_type || '').toUpperCase();
  if (kind === 'CAMERA' || dataType === 'MEDIA') return 'CAMERA_SNAPSHOT';
  if (kind === 'ACCESS') return 'ACCESS_STATE';
  if (kind === 'SWITCH' || (endpoint.writable && dataType === 'ENUM')) return 'SWITCH_CONTROL';
  if (dataType === 'BOOLEAN') return 'BOOLEAN_STATE';
  if (dataType === 'NUMBER' || kind === 'SENSOR') return 'METRIC_TREND';
  return 'UNSUPPORTED';
}

export function renderEndpointWidget(device, endpoint, options = {}) {
  const widgetType = resolveWidgetType(endpoint);
  const navigate = options.navigate || (() => {});
  const onRefresh = options.onRefresh || (() => {});

  // Combine latest server-persisted endpoint state with live WS telemetry overlay
  const liveMap = store.latestTelemetryByDevice.get(device.device_id);
  const liveVal = liveMap?.endpoints?.[endpoint.endpoint_key];
  const hasLive = liveVal !== undefined;
  const value = hasLive ? liveVal : endpoint.last_value;
  const lastSeenAt = hasLive ? liveMap.ts : endpoint.last_seen_at;
  const freshness = hasLive
    ? 'LIVE'
    : endpoint.freshness || (lastSeenAt ? 'STALE' : 'UNSEEN');

  const card = el('article', {
    class: `card endpoint-widget widget-${widgetType.toLowerCase()}`,
    dataset: { endpointKey: endpoint.endpoint_key, widgetType }
  });

  // Top Header: Label + Freshness Indicator (Zero static pill badges)
  const freshnessDotClass =
    freshness === 'LIVE' || freshness === 'FRESH'
      ? 'dot-ok'
      : freshness === 'STALE'
        ? 'dot-warn'
        : 'dot-muted';

  const header = el('div', { class: 'endpoint-widget-head' }, [
    el('div', { class: 'endpoint-widget-title-wrap' }, [
      el('button', {
        type: 'button',
        class: 'link-title',
        text: endpoint.label || endpoint.endpoint_key,
        onClick: () =>
          navigate(
            `/app/devices/${encodeURIComponent(device.device_id)}/endpoints/${encodeURIComponent(endpoint.endpoint_key)}`
          )
      }),
      el('div', {
        class: 'endpoint-meta-line mono',
        text: `${endpoint.endpoint_key} · ${endpoint.kind} · ${endpoint.data_type || 'NUMBER'}`
      })
    ]),
    el('div', { class: 'status-inline' }, [
      el('span', { class: `status-dot ${freshnessDotClass}`, 'aria-hidden': 'true' }),
      el('span', { class: 'status-label tabular-nums', text: freshness === 'LIVE' || freshness === 'FRESH' ? formatAge(lastSeenAt) : freshness })
    ])
  ]);
  card.appendChild(header);

  // Body by resolved widget type
  if (widgetType === 'METRIC_TREND') {
    const series = store.telemetrySeries.get(`${device.device_id}:${endpoint.endpoint_key}`) || [];
    const displayVal = formatEndpointValue(value, endpoint);
    card.appendChild(
      el('div', { class: 'metric-widget-body' }, [
        el('div', { class: 'metric-value tabular-nums', text: displayVal }),
        buildSparklineSvg(series, { width: 120, height: 32, className: 'sparkline-svg text-accent' })
      ])
    );
    if (endpoint.min_value !== null && endpoint.min_value !== undefined || endpoint.max_value !== null && endpoint.max_value !== undefined) {
      card.appendChild(
        el('div', {
          class: 'endpoint-footnote tabular-nums',
          text: `Range: ${endpoint.min_value ?? '—'} to ${endpoint.max_value ?? '—'} ${endpoint.unit || ''}`.trim()
        })
      );
    }
  } else if (widgetType === 'BOOLEAN_STATE') {
    const isTrue = value === true || value === 1 || String(value).toUpperCase() === 'TRUE';
    const isKnown = value !== null && value !== undefined;
    const stateLabel = !isKnown ? 'NO DATA' : isTrue ? 'ACTIVE / TRUE' : 'NORMAL / FALSE';
    card.appendChild(
      el('div', { class: 'boolean-widget-body' }, [
        el('span', {
          class: `state-readout ${!isKnown ? 'text-muted' : isTrue ? 'text-warn' : 'text-ok'}`,
          text: stateLabel
        })
      ])
    );
  } else if (widgetType === 'SWITCH_CONTROL') {
    const stateStr = value !== null && value !== undefined ? String(value).toUpperCase() : 'UNKNOWN';
    const allowed = Array.isArray(endpoint.allowed_values) && endpoint.allowed_values.length >= 2
      ? endpoint.allowed_values
      : ['ON', 'OFF'];
    const canWrite = isAdmin() && endpoint.writable && device.enabled && !device.archived_at;
    const statusNote = el('div', { class: 'endpoint-footnote tabular-nums', text: `Observed state: ${stateStr}` });

    const dispatchSwitch = async (targetVal, btn) => {
      if (!canWrite) return;
      btn.disabled = true;
      statusNote.textContent = `Dispatching ${targetVal}...`;
      try {
        const res = await api.sendDeviceCommand(device.device_id, {
          endpoint_key: endpoint.endpoint_key,
          value: targetVal
        });
        const st = res?.command?.lifecycle_state || res?.status || 'PUBLISHED';
        statusNote.textContent = `Command ${String(st).toUpperCase()}`;
        showToast('Command dispatched', `${device.name} · ${endpoint.label} -> ${targetVal} (${st})`, 'success');
        onRefresh();
      } catch (err) {
        statusNote.textContent = `Failed: ${err.message}`;
        showToast('Command failed', err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    };

    const controls = el(
      'div',
      { class: 'switch-controls' },
      allowed.slice(0, 4).map((opt) => {
        const valStr = String(opt);
        const isActive = stateStr === valStr.toUpperCase();
        const btn = el('button', {
          type: 'button',
          class: isActive ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
          text: valStr,
          disabled: !canWrite,
          title: canWrite ? `Set ${endpoint.label} to ${valStr}` : 'Admin access & enabled device required'
        });
        btn.addEventListener('click', () => dispatchSwitch(valStr, btn));
        return btn;
      })
    );

    card.appendChild(
      el('div', { class: 'switch-widget-body' }, [
        el('div', { class: 'metric-value-sm tabular-nums', text: stateStr }),
        controls,
        statusNote
      ])
    );
  } else if (widgetType === 'ACCESS_STATE') {
    const stateStr = value !== null && value !== undefined ? String(value).toUpperCase() : 'UNKNOWN';
    const canUnlock = isAdmin() && device.enabled && !device.archived_at;
    const unlockBtn = el('button', {
      type: 'button',
      class: 'btn btn-danger btn-sm',
      text: 'Emergency Unlock',
      disabled: !canUnlock,
      title: canUnlock ? 'Dispatch audited emergency door unlock' : 'Admin privilege required'
    });
    unlockBtn.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Confirm Emergency Door Unlock',
        subtitle: 'Audited Physical Access Override',
        message: 'This dispatches an immediate door unlock command over the local network and records an operator audit entry. Edge safety interlocks remain autonomous.',
        confirmLabel: 'Confirm & Unlock',
        danger: true,
        specs: [
          ['Device', `${device.name} (${device.device_id})`],
          ['Endpoint', endpoint.endpoint_key],
          ['Action', 'EMERGENCY_DOOR_UNLOCK -> OPEN']
        ]
      });
      if (!confirmed) return;
      unlockBtn.disabled = true;
      try {
        await api.sendLegacyCommand({ command: 'EMERGENCY_DOOR_UNLOCK', state: 'OPEN' });
        showToast('Emergency unlock dispatched', 'Command logged to SQLite audit trail.', 'warning');
        onRefresh();
      } catch (err) {
        showToast('Unlock failed', err.message, 'error');
      } finally {
        unlockBtn.disabled = false;
      }
    });

    card.appendChild(
      el('div', { class: 'access-widget-body' }, [
        el('div', { class: 'metric-value-sm tabular-nums', text: stateStr }),
        unlockBtn
      ])
    );
  } else if (widgetType === 'CAMERA_SNAPSHOT') {
    const previewWrap = el('div', { class: 'camera-snapshot-frame' });
    const statusText = el('span', { class: 'text-muted', text: 'Click Refresh Snapshot to fetch authenticated frame' });
    previewWrap.appendChild(statusText);

    const loadSnap = async () => {
      statusText.textContent = 'Requesting frame from local camera proxy...';
      try {
        const res = await fetch(
          `/api/v1/registry/${encodeURIComponent(device.device_id)}/snapshot?t=${Date.now()}`,
          { credentials: 'same-origin' }
        );
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.message || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        previewWrap.replaceChildren(
          el('img', {
            src: url,
            alt: `${device.name} live snapshot`,
            class: 'camera-snapshot-img',
            onLoad: () => setTimeout(() => URL.revokeObjectURL(url), 5000)
          })
        );
      } catch (err) {
        previewWrap.replaceChildren(
          el('div', { class: 'camera-snapshot-error', text: `Snapshot unavailable: ${err.message}` })
        );
      }
    };

    const refreshBtn = el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-sm',
      text: 'Refresh Snapshot',
      onClick: loadSnap
    });

    card.appendChild(
      el('div', { class: 'camera-widget-body' }, [previewWrap, refreshBtn])
    );
  } else {
    card.appendChild(
      el('div', { class: 'unsupported-widget-body' }, [
        el('div', { class: 'metric-value-sm tabular-nums', text: formatEndpointValue(value, endpoint) }),
        el('div', { class: 'endpoint-footnote', text: `Generic renderer (${endpoint.kind}/${endpoint.data_type || 'UNKNOWN'})` })
      ])
    );
  }

  // Footer link to endpoint history
  const footer = el('div', { class: 'endpoint-widget-foot' }, [
    el('span', { class: 'text-muted tabular-nums', text: lastSeenAt ? `Updated ${formatAge(lastSeenAt)}` : 'Awaiting first frame' }),
    el('button', {
      type: 'button',
      class: 'btn-link',
      text: 'History →',
      onClick: () =>
        navigate(
          `/app/devices/${encodeURIComponent(device.device_id)}/endpoints/${encodeURIComponent(endpoint.endpoint_key)}`
        )
    })
  ]);
  card.appendChild(footer);

  return card;
}
