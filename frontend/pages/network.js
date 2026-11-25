// LCI-SFM Network & Connectivity View (/app/network)
// Interactive SVG topology with clickable & keyboard-selectable node inspection panel
// plus adaptive Device Connectivity Matrix. Strictly evidence-led; zero fake network scanning.

import { api } from '../api.js';
import { store, onLiveEvent } from '../store.js';
import { el, clear, svgIcon, formatAge, formatTimestamp } from '../utils.js';
import {
  pageHeader,
  statusIndicator,
  loadingSkeleton,
  errorPanel,
  disclaimerBanner,
  keyValueList,
  copyableValue,
  renderAdaptiveCollection,
  emptyState
} from '../components/ui.js';

function statusToTone(state) {
  const s = String(state || 'UNKNOWN').toUpperCase();
  if (['ONLINE', 'CONNECTED', 'READY', 'HEALTHY', 'FRESH'].includes(s)) return 'ok';
  if (['STALE', 'DEGRADED', 'WARNING'].includes(s)) return 'warn';
  if (['OFFLINE', 'DISCONNECTED', 'ERROR', 'CRITICAL'].includes(s)) return 'crit';
  if (['MAINTENANCE', 'PENDING', 'CONNECTING'].includes(s)) return 'pending';
  return 'muted';
}

function buildTopologySvg({ nodes, links, selectedId, onSelect }) {
  const ns = 'http://www.w3.org/2000/svg';
  const maxDeviceRows = Math.max(1, nodes.filter((n) => n.column === 3).length);
  const height = Math.max(330, 76 + maxDeviceRows * 68);
  const width = 760;

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'topology-svg');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Interactive LCI-SFM network connectivity topology');

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Draw links first
  for (const link of links) {
    const a = nodeById.get(link.from);
    const b = nodeById.get(link.to);
    if (!a || !b) continue;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const midX = (x1 + x2) / 2;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
    path.setAttribute('class', `topo-link topo-link-${link.tone || 'muted'}`);
    svg.appendChild(path);
  }

  // Draw interactive nodes
  for (const node of nodes) {
    const g = document.createElementNS(ns, 'g');
    const isSelected = node.id === selectedId;
    g.setAttribute('class', `topo-node${isSelected ? ' is-selected' : ''}`);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    g.setAttribute('aria-label', `${node.title}: ${node.statusLabel}`);
    g.dataset.topoNodeId = node.id;

    const activate = () => onSelect(node.id);
    g.addEventListener('click', activate);
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });

    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', String(node.x));
    rect.setAttribute('y', String(node.y));
    rect.setAttribute('width', String(node.w));
    rect.setAttribute('height', String(node.h));
    rect.setAttribute('class', 'topo-node-box');
    g.appendChild(rect);

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', String(node.x + 14));
    dot.setAttribute('cy', String(node.y + 19));
    dot.setAttribute('r', '4.5');
    dot.setAttribute('class', `topo-status-dot-${node.tone}`);
    g.appendChild(dot);

    const titleText = document.createElementNS(ns, 'text');
    titleText.setAttribute('x', String(node.x + 25));
    titleText.setAttribute('y', String(node.y + 23));
    titleText.setAttribute('class', 'topo-node-title');
    titleText.textContent = node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title;
    g.appendChild(titleText);

    const subText = document.createElementNS(ns, 'text');
    subText.setAttribute('x', String(node.x + 14));
    subText.setAttribute('y', String(node.y + 40));
    subText.setAttribute('class', 'topo-node-sub');
    subText.textContent = node.subtitle.length > 26 ? `${node.subtitle.slice(0, 25)}…` : node.subtitle;
    g.appendChild(subText);

    svg.appendChild(g);
  }

  return svg;
}

export function renderNetworkPage({ navigate }) {
  const container = el('div', { class: 'stack-lg' });
  let disposed = false;
  let selectedNodeId = 'backend';
  let latestData = null;

  const headerSlot = el('div');
  const noticeSlot = el('div');
  const topoSectionSlot = el('div');
  const matrixSlot = el('div');

  container.append(headerSlot, noticeSlot, topoSectionSlot, matrixSlot);

  headerSlot.appendChild(
    pageHeader({
      title: 'Network & Connectivity',
      description: 'Evidence-based view of local appliance connectivity, central messaging channels, and registered device transport paths.',
      actions: [
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          onClick: () => navigate('/app/diagnostics')
        }, [svgIcon('icon-activity', 14), el('span', { text: 'Diagnostics' })]),
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          onClick: () => load()
        }, [svgIcon('icon-refresh', 14), el('span', { text: 'Refresh' })])
      ]
    })
  );

  noticeSlot.appendChild(
    disclaimerBanner({
      icon: 'icon-info',
      tone: 'info',
      title: 'Evidence-Based Local Topology Boundaries',
      message:
        'This view reflects validated server-side telemetry, heartbeat timestamps, and registered LAN destinations. It performs no active subnet scanning, does not configure physical device NICs, and distinguishes broker connectivity from per-device liveness.'
    })
  );

  topoSectionSlot.appendChild(loadingSkeleton('table', 4));

  function buildGraphModel(ready, diag, devices) {
    const sqliteOk = Boolean(ready?.sqlite?.ok ?? diag?.sqlite?.ok);
    const mqtt = ready?.mqtt || diag?.mqtt || {};
    const mqttState =
      mqtt.state === 'standby' || mqtt.enabled === false
        ? 'STANDBY'
        : mqtt.connected && mqtt.subscriptions_ready !== false
          ? 'CONNECTED'
          : mqtt.connected
            ? 'DEGRADED'
            : 'DISCONNECTED';

    const wsState =
      store.wsTelemetry === 'CONNECTED' && store.wsNotifications === 'CONNECTED'
        ? 'CONNECTED'
        : store.wsTelemetry === 'CONNECTED' || store.wsNotifications === 'CONNECTED'
          ? 'DEGRADED'
          : 'OFFLINE';

    const backendState = ready?.status === 'ready' ? 'READY' : 'DEGRADED';

    const nodes = [
      {
        id: 'browser',
        column: 0,
        x: 16,
        y: 120,
        w: 158,
        h: 54,
        title: 'Operator Browser',
        subtitle: `WS: ${wsState}`,
        state: wsState,
        statusLabel: wsState,
        tone: statusToTone(wsState),
        kind: 'CORE',
        details: [
          { label: 'Origin Host', value: window.location.host, mono: true },
          { label: 'Protocol', value: window.location.protocol.replace(':', '').toUpperCase() },
          { label: 'Telemetry Socket', value: store.wsTelemetry },
          { label: 'Notification Socket', value: store.wsNotifications },
          { label: 'MFA Socket', value: store.wsMfa },
          { label: 'Auth Boundary', value: 'Same-origin HttpOnly cookie + CSRF' }
        ]
      },
      {
        id: 'backend',
        column: 1,
        x: 214,
        y: 120,
        w: 168,
        h: 54,
        title: 'LCI-SFM Backend',
        subtitle: `HTTP ${ready?.httpStatus || 200} · v${diag?.version || '2.0.0-rc.1'}`,
        state: backendState,
        statusLabel: backendState === 'READY' ? 'Ready' : 'Degraded',
        tone: statusToTone(backendState),
        kind: 'CORE',
        details: [
          { label: 'Readiness', value: ready?.status || 'unknown' },
          { label: 'Release Version', value: diag?.version || '2.0.0-rc.1', mono: true },
          { label: 'Operating Mode', value: diag?.simulation ? 'Isolated Simulator' : 'On-Premises LAN' },
          { label: 'Active WS Clients', value: `Tel ${diag?.websocket?.telemetry ?? 0} · Notif ${diag?.websocket?.notifications ?? 0} · MFA ${diag?.websocket?.mfa ?? 0}`, mono: true },
          { label: 'Started At', value: formatTimestamp(diag?.started_at), mono: true }
        ]
      },
      {
        id: 'sqlite',
        column: 2,
        x: 422,
        y: 52,
        w: 156,
        h: 54,
        title: 'SQLite WAL Store',
        subtitle: sqliteOk ? 'Journal: WAL' : 'Check Error',
        state: sqliteOk ? 'HEALTHY' : 'ERROR',
        statusLabel: sqliteOk ? 'Healthy' : 'Error',
        tone: statusToTone(sqliteOk ? 'HEALTHY' : 'ERROR'),
        kind: 'CORE',
        details: [
          { label: 'Health Check', value: sqliteOk ? 'OK' : 'Failed' },
          { label: 'Journal Mode', value: String(ready?.sqlite?.journal_mode || diag?.sqlite?.journal_mode || 'wal').toUpperCase(), mono: true },
          { label: 'Foreign Keys', value: (ready?.sqlite?.foreign_keys ?? diag?.sqlite?.foreign_keys) ? 'Enabled' : 'Disabled' },
          { label: 'Retention Window', value: `${diag?.retention_days ?? 30} days` }
        ]
      },
      {
        id: 'mqtt',
        column: 2,
        x: 422,
        y: 186,
        w: 156,
        h: 54,
        title: 'MQTT Broker',
        subtitle: mqttState,
        state: mqttState,
        statusLabel: mqttState,
        tone: statusToTone(mqttState),
        kind: 'CORE',
        details: [
          { label: 'Broker State', value: mqttState },
          { label: 'MQTT Enabled', value: mqtt.enabled === false ? 'No (Standby)' : 'Yes' },
          { label: 'Subscriptions Verified', value: mqtt.subscriptions_ready ? 'Yes' : 'No / Pending' },
          { label: 'Note', value: 'Broker connectivity does not prove individual edge controllers are powered or publishing.' }
        ]
      }
    ];

    const links = [
      { from: 'browser', to: 'backend', tone: statusToTone(wsState) },
      { from: 'backend', to: 'sqlite', tone: statusToTone(sqliteOk ? 'HEALTHY' : 'ERROR') },
      { from: 'backend', to: 'mqtt', tone: statusToTone(mqttState) }
    ];

    const visibleDevices = devices.slice(0, 8);
    visibleDevices.forEach((d, idx) => {
      const y = 26 + idx * 66;
      const devState = d.in_maintenance ? 'MAINTENANCE' : d.status || 'UNKNOWN';
      const tone = statusToTone(devState);
      const isMqtt = d.transport === 'MQTT_V1' || d.transport === 'LEGACY_V1';
      nodes.push({
        id: `dev:${d.device_id}`,
        column: 3,
        x: 606,
        y,
        w: 142,
        h: 52,
        title: d.name,
        subtitle: `${d.transport} · ${devState}`,
        state: devState,
        statusLabel: devState,
        tone,
        kind: 'DEVICE',
        device: d
      });
      links.push({
        from: isMqtt ? 'mqtt' : 'backend',
        to: `dev:${d.device_id}`,
        tone
      });
    });

    if (devices.length > visibleDevices.length) {
      nodes.push({
        id: 'dev:overflow',
        column: 3,
        x: 606,
        y: 26 + visibleDevices.length * 66,
        w: 142,
        h: 52,
        title: `+${devices.length - visibleDevices.length} more devices`,
        subtitle: 'Inspect matrix below',
        state: 'INFO',
        statusLabel: 'Additional devices',
        tone: 'info',
        kind: 'OVERFLOW'
      });
      links.push({ from: 'mqtt', to: 'dev:overflow', tone: 'muted' });
    }

    return { nodes, links };
  }

  function renderInspector(graph) {
    const selected = graph.nodes.find((n) => n.id === selectedNodeId) || graph.nodes[1] || graph.nodes[0];
    if (!selected) return el('div');

    if (selected.kind === 'DEVICE' && selected.device) {
      const d = selected.device;
      const freshEndpoints = (d.endpoints || []).filter((e) => e.fresh).length;
      const totalEndpoints = (d.endpoints || []).length;

      return el('aside', { class: 'card stack-md network-inspector', id: 'network-node-inspector', 'aria-label': 'Selected node details' }, [
        el('div', { class: 'row-between' }, [
          el('div', { class: 'stack-xs' }, [
            el('div', { class: 'kicker', text: 'REGISTERED DEVICE NODE' }),
            el('h2', { class: 'card-title', text: d.name })
          ]),
          statusIndicator(d.in_maintenance ? 'MAINTENANCE' : d.status)
        ]),
        d.manifest_drift?.has_drift
          ? disclaimerBanner({
              icon: 'icon-warning',
              tone: 'warn',
              title: 'Manifest Drift Detected',
              message: 'Announced endpoints differ from approved registry metadata.'
            })
          : null,
        keyValueList([
          { label: 'Device ID', node: copyableValue(d.device_id, { label: 'Copy device ID' }) },
          { label: 'Assigned Room', value: d.room_name ? `${d.room_code} · ${d.room_name}` : d.room_id },
          { label: 'Transport', value: d.transport, mono: true },
          {
            label: 'Address / Path',
            value: d.transport === 'MQTT_V1' ? 'Broker-mediated (no direct IP)' : d.ip ? `${d.ip}:${d.port || 80}${d.path || ''}` : 'Not configured',
            mono: d.transport !== 'MQTT_V1'
          },
          { label: 'MQTT Identity', value: d.mqtt_identity_status || 'NOT_APPLICABLE' },
          { label: 'Last Seen', value: d.last_seen_at ? `${formatAge(d.last_seen_at)} (${formatTimestamp(d.last_seen_at)})` : 'Never observed' },
          { label: 'Endpoint Freshness', value: `${freshEndpoints} / ${totalEndpoints} fresh`, mono: true },
          { label: 'Stale Window', value: `${d.stale_after_s ?? 90} s`, mono: true }
        ]),
        el('div', { class: 'btn-row' }, [
          el('button', {
            type: 'button',
            class: 'btn btn-primary btn-sm',
            text: 'Inspect Device',
            onClick: () => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`)
          }),
          d.room_id
            ? el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                text: 'Open Room',
                onClick: () => navigate(`/app/rooms/${encodeURIComponent(d.room_id)}`)
              })
            : null
        ])
      ]);
    }

    if (selected.kind === 'OVERFLOW') {
      return el('aside', { class: 'card stack-md network-inspector', id: 'network-node-inspector' }, [
        el('div', { class: 'kicker', text: 'DEVICE INVENTORY' }),
        el('h2', { class: 'card-title', text: selected.title }),
        el('p', { class: 'text-sm text-secondary', text: 'The topology diagram displays the first 8 devices for clarity. Use the Connectivity Matrix below or the full Devices directory to inspect all registered nodes.' }),
        el('button', {
          type: 'button',
          class: 'btn btn-primary btn-sm',
          text: 'Open Devices Directory',
          onClick: () => navigate('/app/devices')
        })
      ]);
    }

    return el('aside', { class: 'card stack-md network-inspector', id: 'network-node-inspector', 'aria-label': 'Selected service details' }, [
      el('div', { class: 'row-between' }, [
        el('div', { class: 'stack-xs' }, [
          el('div', { class: 'kicker', text: 'CORE INFRASTRUCTURE NODE' }),
          el('h2', { class: 'card-title', text: selected.title })
        ]),
        statusIndicator(selected.state, selected.statusLabel)
      ]),
      keyValueList(selected.details || []),
      el('div', { class: 'btn-row' }, [
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          text: 'Open Diagnostics',
          onClick: () => navigate('/app/diagnostics')
        })
      ])
    ]);
  }

  function renderView() {
    if (!latestData) return;
    const { ready, diag, devices, errors } = latestData;

    clear(topoSectionSlot);
    if (!ready && !diag && devices.length === 0 && errors.length > 0) {
      topoSectionSlot.appendChild(
        errorPanel({
          title: 'Unable to load network telemetry',
          message: errors[0],
          onRetry: () => load()
        })
      );
      return;
    }

    const graph = buildGraphModel(ready, diag, devices);
    if (!graph.nodes.some((n) => n.id === selectedNodeId)) {
      selectedNodeId = 'backend';
    }

    const svgNode = buildTopologySvg({
      nodes: graph.nodes,
      links: graph.links,
      selectedId: selectedNodeId,
      onSelect: (id) => {
        selectedNodeId = id;
        renderView();
      }
    });

    const diagramCard = el('section', { class: 'card stack-sm', 'aria-label': 'Interactive Network Topology' }, [
      el('div', { class: 'card-head' }, [
        el('div', { class: 'stack-xs' }, [
          el('h2', { class: 'card-title', text: 'Interactive Connectivity Topology' }),
          el('span', { class: 'text-xs text-muted', text: 'Select any infrastructure or device node to inspect verified server evidence.' })
        ]),
        el('span', { class: 'text-xs text-muted tabular-nums', text: `${devices.length} active device${devices.length === 1 ? '' : 's'}` })
      ]),
      el('div', { class: 'topology-canvas-wrap' }, [svgNode]),
      el('div', { class: 'topology-legend' }, [
        statusIndicator('ONLINE', 'Fresh / Connected', { compact: true }),
        statusIndicator('STALE', 'Stale / Degraded', { compact: true }),
        statusIndicator('OFFLINE', 'Offline / Disconnected', { compact: true }),
        statusIndicator('MAINTENANCE', 'Maintenance', { compact: true }),
        statusIndicator('UNKNOWN', 'Unseen / Standby', { compact: true })
      ])
    ]);

    topoSectionSlot.appendChild(
      el('div', { class: 'network-layout' }, [diagramCard, renderInspector(graph)])
    );

    // Adaptive Device Connectivity Matrix
    clear(matrixSlot);
    matrixSlot.appendChild(
      el('section', { class: 'stack-md', 'aria-label': 'Device Connectivity Matrix' }, [
        el('div', { class: 'row-between' }, [
          el('h2', { class: 'section-title', text: 'Device Connectivity Matrix' }),
          el('span', { class: 'text-xs text-muted', text: 'Heartbeat liveness and per-endpoint freshness' })
        ]),
        renderAdaptiveCollection({
          ariaLabel: 'Device connectivity matrix',
          rows: devices,
          onRowClick: (d) => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`),
          emptyNode: emptyState({
            icon: 'icon-cpu',
            title: 'No registered devices',
            message: 'Register a controller under Devices to observe transport connectivity.'
          }),
          columns: [
            {
              label: 'Device',
              render: (d) =>
                el('div', { class: 'stack-xs' }, [
                  el('span', { class: 'font-semibold', text: d.name }),
                  el('span', { class: 'mono text-xs text-muted', text: d.device_id })
                ])
            },
            { label: 'Room', render: (d) => d.room_name || d.room_code || '—' },
            { label: 'Transport', render: (d) => el('span', { class: 'meta-tag mono', text: d.transport }) },
            {
              label: 'Address / Broker',
              render: (d) =>
                el('span', {
                  class: 'mono text-xs text-secondary',
                  text: d.transport === 'MQTT_V1' ? 'Broker-mediated' : d.ip ? `${d.ip}:${d.port || 80}` : '—'
                })
            },
            {
              label: 'Status',
              render: (d) => statusIndicator(d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true })
            },
            {
              label: 'MQTT Identity',
              render: (d) => statusIndicator(d.mqtt_identity_status || 'NOT_APPLICABLE', null, { compact: true })
            },
            {
              label: 'Last Seen',
              className: 'mono text-xs tabular-nums text-secondary',
              render: (d) => formatAge(d.last_seen_at)
            }
          ],
          renderMobileCard: (d) =>
            el(
              'article',
              {
                class: 'card record-card',
                onClick: () => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`)
              },
              [
                el('div', { class: 'record-card-head' }, [
                  el('div', { class: 'stack-xs' }, [
                    el('div', { class: 'font-semibold', text: d.name }),
                    el('div', { class: 'mono text-xs text-muted', text: d.device_id })
                  ]),
                  statusIndicator(d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true })
                ]),
                el('div', { class: 'record-card-grid' }, [
                  el('div', { class: 'record-card-field' }, [
                    el('span', { class: 'record-card-label', text: 'Transport' }),
                    el('span', { class: 'mono text-xs', text: d.transport })
                  ]),
                  el('div', { class: 'record-card-field' }, [
                    el('span', { class: 'record-card-label', text: 'Address' }),
                    el('span', {
                      class: 'mono text-xs',
                      text: d.transport === 'MQTT_V1' ? 'Broker-mediated' : d.ip ? `${d.ip}:${d.port || 80}` : '—'
                    })
                  ]),
                  el('div', { class: 'record-card-field' }, [
                    el('span', { class: 'record-card-label', text: 'MQTT Identity' }),
                    statusIndicator(d.mqtt_identity_status || 'NOT_APPLICABLE', null, { compact: true })
                  ]),
                  el('div', { class: 'record-card-field' }, [
                    el('span', { class: 'record-card-label', text: 'Last Seen' }),
                    el('span', { class: 'mono text-xs', text: formatAge(d.last_seen_at) })
                  ])
                ])
              ]
            )
        })
      ])
    );
  }

  async function load() {
    if (disposed) return;
    const [readyRes, diagRes, devRes] = await Promise.allSettled([
      api.getHealthReady(),
      api.getDiagnostics(),
      api.listDevices({ include_archived: false })
    ]);
    if (disposed) return;

    const errors = [readyRes, diagRes, devRes]
      .filter((r) => r.status === 'rejected')
      .map((r) => r.reason?.message || 'Request failed');

    latestData = {
      ready: readyRes.status === 'fulfilled' ? readyRes.value : null,
      diag: diagRes.status === 'fulfilled' ? diagRes.value : null,
      devices: devRes.status === 'fulfilled' ? devRes.value?.devices || [] : [],
      errors
    };
    renderView();
  }

  let debounce = null;
  const unsub = onLiveEvent('telemetry', () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 2000);
  });

  load();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
      clearTimeout(debounce);
      unsub();
    }
  };
}
