// LCI-SFM Generic Endpoint Widget Engine
// Renders SENSOR (NUMBER/BOOLEAN), SWITCH, ACCESS, CAMERA, and UNSUPPORTED widgets strictly from metadata.

import { api } from './api.js';
import { store, isAdmin, showToast, confirmDialog } from './store.js';
import { el, clear, formatAge, formatEndpointValue, buildSparklineSvg, svgIcon } from './utils.js';
import { statusIndicator } from './components/ui.js';
import { resolveEndpointVisual, renderCategoryIconBadge, NODE_ILLUSTRATIONS } from './visuals.js';

const activeWidgetBlobUrls = new Set();

export function cleanupWidgetBlobs() {
  for (const url of activeWidgetBlobUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
  activeWidgetBlobUrls.clear();
}

function getLiveValue(device, ep) {
  const live = store.latestTelemetryByDevice.get(device.device_id);
  if (live && live.endpoints && Object.prototype.hasOwnProperty.call(live.endpoints, ep.endpoint_key)) {
    return { value: live.endpoints[ep.endpoint_key], observedAt: live.ts };
  }
  return { value: ep.last_value, observedAt: ep.last_seen_at };
}

function getEndpointFreshnessState(device, ep) {
  if (!device.enabled || device.archived) return 'DISABLED';
  if (device.in_maintenance) return 'MAINTENANCE';
  if (ep.status === 'ONLINE' || ep.fresh) return 'FRESH';
  if (ep.status === 'STALE') return 'STALE';
  return 'UNKNOWN';
}

export function renderEndpointWidget(device, ep, { navigate, onMutated }) {
  const widgetType = ep.widget_type || 'UNSUPPORTED';
  const admin = isAdmin();
  const { value, observedAt } = getLiveValue(device, ep);
  const freshness = getEndpointFreshnessState(device, ep);
  const epVis = resolveEndpointVisual(ep);

  const card = el('article', { class: `card widget-card cat-${epVis.category}` });

  // Header: category identity (left) + independent operational status (right)
  card.appendChild(
    el('div', { class: 'row-between' }, [
      el('div', { class: 'widget-head-identity' }, [
        renderCategoryIconBadge(epVis.category, epVis.icon, 'sm'),
        el('div', { class: 'stack-xs' }, [
          el('div', { class: 'font-semibold', text: ep.label || ep.endpoint_key }),
          el('div', { class: 'mono text-xs text-muted', text: `${ep.endpoint_key} · ${ep.kind}/${ep.data_type}` })
        ])
      ]),
      statusIndicator(freshness, freshness === 'UNKNOWN' ? 'Unseen' : undefined, { compact: true })
    ])
  );

  // Body by resolved widget type
  if (widgetType === 'METRIC_TREND') {
    const series = store.telemetrySeries.get(`${device.device_id}:${ep.endpoint_key}`) || [];
    card.appendChild(
      el('div', { class: 'widget-reading tabular-nums', text: formatEndpointValue(value, ep) })
    );
    card.appendChild(buildSparklineSvg(series));
  } else if (widgetType === 'BOOLEAN_STATE') {
    const hasVal = typeof value === 'boolean';
    const label = !hasVal ? 'Awaiting state' : value ? 'ACTIVE (TRUE)' : 'NORMAL (FALSE)';
    card.appendChild(
      el('div', { class: 'stack-xs' }, [
        hasVal
          ? statusIndicator(value ? 'WARNING' : 'OK', label)
          : statusIndicator('UNKNOWN', label),
        el('div', { class: 'text-xs text-muted', text: 'Binary detector reading (no synthetic numeric unit).' })
      ])
    );
  } else if (widgetType === 'SWITCH_CONTROL') {
    const strVal = value === null || value === undefined ? 'Unknown' : String(value);
    const isOn = strVal === 'ON' || value === true;
    card.appendChild(
      el('div', { class: 'row-between' }, [
        el('div', { class: 'widget-reading mono', text: strVal }),
        ep.writable ? el('span', { class: 'meta-tag', text: 'Writable' }) : el('span', { class: 'meta-tag', text: 'Read-only' })
      ])
    );

    if (admin && ep.writable && device.transport === 'MQTT_V1' && device.enabled && !device.archived) {
      const dispatchSwitch = async (targetVal) => {
        const ok = await confirmDialog({
          title: `Set ${ep.label || ep.endpoint_key} to ${targetVal}?`,
          subtitle: 'MQTT_V1 Switch Command',
          message:
            'This publishes a non-retained MQTT command and tracks PUBLISHED -> ACKNOWLEDGED -> STATE_REPORTED. Publishing alone does not prove physical relay actuation.',
          confirmLabel: `Send ${targetVal}`,
          specs: [
            ['Device', `${device.name} (${device.device_id})`],
            ['Endpoint', ep.endpoint_key],
            ['Requested State', targetVal]
          ]
        });
        if (!ok) return;
        try {
          const res = await api.sendDeviceCommand(device.device_id, {
            endpoint_key: ep.endpoint_key,
            value: targetVal
          });
          showToast(
            'Command published',
            `Command ${res.command?.command_id?.slice(0, 8) || ''} state: ${res.command?.state || 'PUBLISHED'}`,
            'info'
          );
          if (onMutated) onMutated();
        } catch (err) {
          showToast('Command rejected', err.message, 'error');
        }
      };

      card.appendChild(
        el('div', { class: 'btn-row' }, [
          el('button', {
            type: 'button',
            class: `btn btn-sm ${isOn ? 'btn-primary' : 'btn-secondary'}`,
            disabled: device.in_maintenance || !device.fresh,
            title: !device.fresh ? 'Fresh device observation required before switching' : undefined,
            text: 'Set ON',
            onClick: () => dispatchSwitch('ON')
          }),
          el('button', {
            type: 'button',
            class: `btn btn-sm ${!isOn && strVal !== 'Unknown' ? 'btn-primary' : 'btn-secondary'}`,
            disabled: device.in_maintenance || !device.fresh,
            title: !device.fresh ? 'Fresh device observation required before switching' : undefined,
            text: 'Set OFF',
            onClick: () => dispatchSwitch('OFF')
          })
        ])
      );
      if (!device.fresh) {
        card.appendChild(
          el('div', { class: 'text-xs text-muted', text: 'Control disabled until fresh device telemetry/heartbeat arrives.' })
        );
      }
    } else if (admin && device.slot === 'node2' && (ep.endpoint_key === 'fan_relay' || ep.endpoint_key === 'light_state')) {
      const legacyCmd = ep.endpoint_key === 'fan_relay' ? 'TOGGLE_HVAC_FAN' : 'TOGGLE_AUX_LIGHT';
      const sendLegacy = async (state) => {
        const ok = await confirmDialog({
          title: `Dispatch ${legacyCmd} (${state})?`,
          subtitle: 'Audited Legacy Node Command',
          message: 'Publishes an audited command to the built-in environmental controller via the central backend.',
          confirmLabel: `Send ${state}`,
          specs: [
            ['Target Node', device.device_id],
            ['Command', legacyCmd],
            ['State', state]
          ]
        });
        if (!ok) return;
        try {
          const res = await api.sendLegacyCommand({ command: legacyCmd, state });
          showToast('Command dispatched', `Lifecycle: ${res.lifecycle_state || 'published'}`, 'info');
          if (onMutated) onMutated();
        } catch (err) {
          showToast('Command failed', err.message, 'error');
        }
      };
      card.appendChild(
        el('div', { class: 'btn-row' }, [
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'ON', onClick: () => sendLegacy('ON') }),
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'OFF', onClick: () => sendLegacy('OFF') })
        ])
      );
    }
  } else if (widgetType === 'ACCESS_STATE') {
    const strVal = value === null || value === undefined ? 'Unknown' : String(value);
    card.appendChild(
      el('div', { class: 'stack-xs' }, [
        el('div', { class: 'widget-reading mono', text: strVal }),
        el('div', {
          class: 'text-xs text-muted',
          text: 'Edge access controller retains local safety & break-glass egress independence.'
        })
      ])
    );

    if (admin && device.slot === 'node1') {
      card.appendChild(
        el('div', { class: 'btn-row' }, [
          el('button', {
            type: 'button',
            class: 'btn btn-danger btn-sm',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Dispatch Emergency Door Unlock?',
                subtitle: 'Safety-Audited Remote Override',
                danger: true,
                message:
                  'This sends an audited EMERGENCY_DOOR_UNLOCK command to the access controller. Physical emergency egress must remain independently operable.',
                confirmLabel: 'Dispatch Emergency Unlock',
                specs: [
                  ['Target Controller', `${device.name} (${device.device_id})`],
                  ['Command', 'EMERGENCY_DOOR_UNLOCK'],
                  ['Requested State', 'OPEN']
                ]
              });
              if (!ok) return;
              try {
                const res = await api.sendLegacyCommand({ command: 'EMERGENCY_DOOR_UNLOCK', state: 'OPEN' });
                showToast('Override dispatched', `Lifecycle: ${res.lifecycle_state || 'published'}`, 'warning');
                if (onMutated) onMutated();
              } catch (err) {
                showToast('Override failed', err.message, 'error');
              }
            }
          }, [svgIcon('icon-lock', 14), el('span', { text: 'Emergency Unlock' })])
        ])
      );
    }
  } else if (widgetType === 'CAMERA_SNAPSHOT') {
    const camIllus = () =>
      el('img', {
        src: NODE_ILLUSTRATIONS.SECURITY_CAMERA,
        alt: '',
        class: 'camera-placeholder-illus',
        loading: 'eager',
        decoding: 'async'
      });
    const frameBox = el(
      'div',
      { class: 'camera-preview-frame', 'data-simulation': device.simulation ? 'true' : 'false' },
      device.simulation
        ? [
            el('div', { class: 'camera-placeholder-stack' }, [
              camIllus(),
              statusIndicator('SIMULATION', 'SIMULATION · Synthetic Preview Placeholder', { compact: true }),
              el('span', {
                class: 'text-xs text-muted',
                text: 'Isolated simulator mode: no upstream camera IP is contacted; physical JPEG proxy capture is disabled.'
              })
            ])
          ]
        : [
            el('div', { class: 'camera-placeholder-stack' }, [
              camIllus(),
              el('span', {
                class: 'text-xs text-muted',
                text: 'No snapshot loaded yet — click Capture Snapshot'
              })
            ])
          ]
    );
    let activeBlobUrl = null;
    const revokeCurrentBlob = () => {
      if (activeBlobUrl) {
        activeWidgetBlobUrls.delete(activeBlobUrl);
        try {
          URL.revokeObjectURL(activeBlobUrl);
        } catch {
          // ignore
        }
        activeBlobUrl = null;
      }
    };
    card._cleanup = revokeCurrentBlob;

    const captureBtn = el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-sm',
      disabled: device.simulation || !device.enabled || device.archived,
      text: 'Capture Snapshot',
      onClick: async () => {
        captureBtn.disabled = true;
        captureBtn.textContent = 'Capturing...';
        try {
          const blob = await api.getCameraSnapshotBlob(device.device_id);
          revokeCurrentBlob();
          activeBlobUrl = URL.createObjectURL(blob);
          activeWidgetBlobUrls.add(activeBlobUrl);
          clear(frameBox);
          frameBox.appendChild(
            el('img', {
              src: activeBlobUrl,
              alt: `${device.name} authenticated backend JPEG snapshot`
            })
          );
          showToast('Snapshot captured', 'Fetched via authenticated backend proxy (ephemeral preview).', 'success');
        } catch (err) {
          clear(frameBox);
          frameBox.appendChild(
            el('span', {
              class: 'text-xs text-warn',
              text: err.message || 'Camera in standby or unreachable.'
            })
          );
          showToast('Snapshot unavailable', err.message, 'warning');
        } finally {
          captureBtn.disabled = device.simulation || !device.enabled || device.archived;
          captureBtn.textContent = 'Capture Snapshot';
        }
      }
    });

    card.appendChild(frameBox);
    card.appendChild(
      el('div', { class: 'row-between' }, [
        captureBtn,
        el('span', { class: 'text-xs text-muted', text: 'Via /api/v1/registry/:id/snapshot' })
      ])
    );
  } else {
    card.appendChild(
      el('div', {
        class: 'text-xs text-muted',
        text: `Unsupported widget profile (${ep.kind}/${ep.data_type}). Raw value: ${formatEndpointValue(value, ep)}`
      })
    );
  }

  // Footer: observed age + history drilldown
  card.appendChild(
    el('div', { class: 'row-between' }, [
      el('span', {
        class: 'text-xs text-muted mono tabular-nums',
        text: observedAt ? `Observed ${formatAge(observedAt)}` : 'Never observed'
      }),
      ep.kind !== 'CAMERA'
        ? el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-sm',
            text: 'History →',
            onClick: () =>
              navigate(
                `/app/devices/${encodeURIComponent(device.device_id)}/endpoints/${encodeURIComponent(ep.endpoint_key)}`
              )
          })
        : null
    ])
  );

  return card;
}
