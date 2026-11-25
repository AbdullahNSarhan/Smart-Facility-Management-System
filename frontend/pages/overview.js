// LCI-SFM Facility Overview (/app/overview)
// Operational landing screen: KPI summary, Central Service Readiness Strip, Managed Rooms grid,
// Priority Attention Queue, and Compact Activity Feed with Slide-Over detail inspection.

import { api } from '../api.js';
import { store, subscribe, isAdmin, onLiveEvent, notify, openDrawer } from '../store.js';
import { el, clear, svgIcon, formatAge, formatTimestamp } from '../utils.js';
import {
  pageHeader,
  kpiCard,
  statusIndicator,
  loadingSkeleton,
  emptyState,
  errorPanel,
  disclaimerBanner,
  keyValueList
} from '../components/ui.js';
import {
  DASHBOARD_ILLUSTRATIONS,
  EMPTY_ILLUSTRATIONS,
  resolveDeviceVisual,
  renderCategoryChip,
  renderCategoryIconBadge
} from '../visuals.js';

function severityRank(sev) {
  const s = String(sev || '').toUpperCase();
  if (s === 'CRITICAL') return 0;
  if (s === 'WARNING') return 1;
  return 2;
}

function getMqttReadinessDisplay(mqtt) {
  if (!mqtt) return { state: 'UNKNOWN', label: 'Unknown' };
  if (mqtt.state === 'standby' || mqtt.enabled === false) {
    return { state: 'STANDBY', label: 'Standby (Disabled)' };
  }
  if (mqtt.connected && mqtt.subscriptions_ready !== false) {
    return { state: 'CONNECTED', label: 'Connected' };
  }
  if (mqtt.connected && mqtt.subscriptions_ready === false) {
    return { state: 'DEGRADED', label: 'Subs Degraded' };
  }
  return { state: 'DISCONNECTED', label: 'Disconnected' };
}

function getBrowserStreamReadiness(s) {
  if (s.wsTelemetry === 'CONNECTED' && s.wsNotifications === 'CONNECTED') {
    return { state: 'CONNECTED', label: 'Telemetry + Alerts' };
  }
  if (s.wsTelemetry === 'CONNECTED' || s.wsNotifications === 'CONNECTED') {
    return { state: 'DEGRADED', label: 'Partial WS' };
  }
  if (s.wsTelemetry === 'CONNECTING' || s.wsNotifications === 'CONNECTING') {
    return { state: 'CONNECTING', label: 'Connecting' };
  }
  return { state: 'OFFLINE', label: 'Disconnected' };
}

export function renderOverviewPage({ navigate }) {
  const container = el('div', { class: 'stack-lg' });
  let disposed = false;
  let refreshTimer = null;
  let wsReadinessMount = null;
  let lastWsKey = '';

  const headerSlot = el('div');
  const bannerSlot = el('div');
  const kpiSlot = el('div');
  const readinessSlot = el('div');
  const bodySlot = el('div');

  function syncWsReadiness() {
    if (disposed || !wsReadinessMount) return;
    const nextKey = `${store.wsTelemetry}|${store.wsNotifications}`;
    if (nextKey === lastWsKey && wsReadinessMount.childElementCount > 0) return;
    lastWsKey = nextKey;
    const wsInfo = getBrowserStreamReadiness(store);
    wsReadinessMount.replaceChildren(statusIndicator(wsInfo.state, wsInfo.label));
  }

  container.append(headerSlot, bannerSlot, kpiSlot, readinessSlot, bodySlot);

  kpiSlot.appendChild(loadingSkeleton('kpi', 4));
  bodySlot.appendChild(loadingSkeleton('cards', 3));

  function openActivityDrawer(item) {
    const body = el('div', { class: 'stack-md' }, [
      statusIndicator(item.severity || 'INFO'),
      keyValueList([
        { label: 'Title', value: item.title || '—' },
        { label: 'Category', value: item.category || 'SYSTEM' },
        { label: 'Timestamp', value: formatTimestamp(item.timestamp), mono: true },
        { label: 'Device', value: item.device_id || 'Facility-wide', mono: Boolean(item.device_id) },
        { label: 'Room', value: item.room_name ? `${item.room_code || ''} · ${item.room_name}` : '—' },
        { label: 'Read Status', value: item.read_at ? `Read (${formatAge(item.read_at)})` : 'Unread' }
      ]),
      item.message
        ? el('div', { class: 'card card-compact stack-xs' }, [
            el('div', { class: 'text-xs text-muted', text: 'MESSAGE' }),
            el('p', { class: 'text-sm text-secondary', text: item.message })
          ])
        : null
    ]);

    const actions = [];
    if (item.alarm_id) {
      actions.push(
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          text: 'Inspect Alarm',
          onClick: () => navigate(`/app/alarms?alarm_id=${encodeURIComponent(item.alarm_id)}`)
        })
      );
    }
    if (item.device_id) {
      actions.push(
        el('button', {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          text: 'Inspect Device',
          onClick: () => navigate(`/app/devices/${encodeURIComponent(item.device_id)}`)
        })
      );
    }
    actions.push(
      el('button', {
        type: 'button',
        class: 'btn btn-primary btn-sm',
        text: 'Open Notifications',
        onClick: () => navigate('/app/notifications')
      })
    );

    openDrawer({
      title: item.title || 'Activity Event',
      subtitle: `${item.category || 'SYSTEM'} NOTIFICATION`,
      body,
      actions
    });
  }

  async function load(silent = false) {
    if (disposed) return;
    if (!silent) {
      clear(kpiSlot);
      kpiSlot.appendChild(loadingSkeleton('kpi', 4));
    }

    const admin = isAdmin();
    const [overviewRes, readyRes, pendingRes, devicesRes] = await Promise.allSettled([
      api.getOverview(),
      api.getHealthReady(),
      admin ? api.listPendingDevices('PENDING') : Promise.resolve({ pending_devices: [] }),
      api.listDevices({ include_archived: false })
    ]);

    if (disposed) return;

    const overview = overviewRes.status === 'fulfilled' ? overviewRes.value : null;
    const ready = readyRes.status === 'fulfilled' ? readyRes.value : null;
    const pendingList = pendingRes.status === 'fulfilled' ? pendingRes.value?.pending_devices || [] : [];
    const devices = devicesRes.status === 'fulfilled' ? devicesRes.value?.devices || [] : [];

    // Update global header counters
    if (overview) {
      store.activeAlarmCount = Number(overview.active_alarms || 0);
      store.unreadCount = Number(overview.unread_notifications ?? store.unreadCount);
      notify();
    }

    // 1. Page Header
    clear(headerSlot);
    const fac = overview?.facility;
    const subtitleParts = [];
    if (fac?.location) subtitleParts.push(fac.location);
    if (fac?.timezone) subtitleParts.push(`TZ: ${fac.timezone}`);
    subtitleParts.push(`Updated ${formatAge(new Date().toISOString())}`);

    headerSlot.appendChild(
      pageHeader({
        title: fac?.name || 'Facility Overview',
        description: fac?.description || 'Real-time operational overview across facility rooms, wired controllers, and central services.',
        meta: overview?.simulation ? statusIndicator('SIMULATION', 'Isolated Simulator') : null,
        actions: [
          el('button', {
            type: 'button',
            class: 'btn btn-secondary btn-sm',
            onClick: () => navigate('/app/network')
          }, [svgIcon('icon-topology', 14), el('span', { text: 'Network Map' })]),
          admin
            ? el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                onClick: () => navigate('/app/rooms?action=create')
              }, [svgIcon('icon-plus', 14), el('span', { text: 'Add Room' })])
            : null,
          admin
            ? el('button', {
                type: 'button',
                class: 'btn btn-primary btn-sm',
                onClick: () => navigate('/app/devices?action=register')
              }, [svgIcon('icon-plus', 14), el('span', { text: 'Register Device' })])
            : null,
          el('button', {
            type: 'button',
            class: 'btn-icon',
            title: 'Refresh overview',
            'aria-label': 'Refresh overview',
            onClick: () => load(false)
          }, [svgIcon('icon-refresh', 15)])
        ]
      })
    );

    // Optional Simulation Banner
    clear(bannerSlot);
    if (overview?.simulation) {
      bannerSlot.appendChild(
        disclaimerBanner({
          icon: 'icon-activity',
          tone: 'info',
          title: 'Isolated Simulator Mode Active',
          message: 'Telemetry and actuator responses are generated locally for software validation. No physical controllers or hardware relays are contacted.'
        })
      );
    }

    // 2. KPI Row (preserve section error state without fabricating zeroes)
    clear(kpiSlot);
    if (!overview) {
      kpiSlot.appendChild(
        errorPanel({
          title: 'Overview summary unavailable',
          message: overviewRes.reason?.message || 'Could not load facility summary from /api/v1/overview.',
          onRetry: () => load(false)
        })
      );
    } else {
      const ds = overview.device_summary || { registered: 0, online: 0, stale: 0, unknown: 0, disabled: 0, maintenance: 0 };
      const rooms = overview.rooms || [];
      const activeAlarms = Number(overview.active_alarms || 0);
      const pendingCount = Number(overview.pending_devices || 0);
      const critAlarms = (overview.recent_alarms || []).filter(
        (a) => a.state !== 'RESOLVED' && a.severity === 'CRITICAL'
      ).length;

      kpiSlot.appendChild(
        el('div', { class: 'kpi-grid' }, [
          kpiCard({
            label: 'Active Rooms',
            value: rooms.length,
            sub: `${fac?.archived_rooms || 0} archived · ${subtitleParts[0] || 'On-premises'}`,
            category: 'network',
            icon: 'icon-rooms',
            onClick: () => navigate('/app/rooms')
          }),
          kpiCard({
            label: 'Devices Online',
            value: `${ds.online} / ${ds.registered}`,
            sub: `${ds.stale} stale · ${ds.unknown} unseen · ${ds.maintenance} maint.`,
            tone: ds.registered > 0 && ds.online === ds.registered ? 'ok' : ds.stale > 0 ? 'warn' : 'default',
            category: 'env',
            icon: 'icon-cpu',
            onClick: () => navigate('/app/devices')
          }),
          kpiCard({
            label: 'Active Alarms',
            value: activeAlarms,
            sub: activeAlarms === 0 ? 'No active alarm conditions' : `${critAlarms} critical in recent window`,
            tone: critAlarms > 0 ? 'crit' : activeAlarms > 0 ? 'warn' : 'ok',
            category: 'relay',
            icon: 'icon-warning',
            onClick: () => navigate('/app/alarms')
          }),
          kpiCard({
            label: 'Pending Reviews',
            value: pendingCount,
            sub: pendingCount > 0 ? 'Quarantined devices awaiting Admin approval' : 'No unapproved device announcements',
            tone: pendingCount > 0 ? 'pending' : 'default',
            category: 'infra',
            icon: 'icon-shield',
            onClick: () => navigate('/app/devices?focus=quarantine')
          })
        ])
      );
    }

    // 3. Central Service Readiness Strip
    clear(readinessSlot);
    wsReadinessMount = null;
    if (!ready && !overview?.health) {
      readinessSlot.appendChild(
        errorPanel({
          title: 'Service readiness probe unavailable',
          message: 'Could not read /api/health/ready.',
          onRetry: () => load(false)
        })
      );
    } else {
      const h = ready || { status: overview?.health?.sqlite?.ok ? 'ready' : 'degraded', ...overview?.health };
      const sqliteOk = Boolean(h.sqlite?.ok);
      const mqttInfo = getMqttReadinessDisplay(h.mqtt);
      wsReadinessMount = el('div', { id: 'overview-ws-readiness-value' });
      lastWsKey = '';
      syncWsReadiness();

      readinessSlot.appendChild(
        el('section', { class: 'readiness-strip', 'aria-label': 'Central Service Readiness' }, [
          el('div', { class: 'readiness-cell' }, [
            el('span', { class: 'readiness-label', text: 'HTTP Readiness' }),
            statusIndicator(h.status === 'ready' ? 'READY' : 'DEGRADED', h.status === 'ready' ? 'Ready (200)' : 'Degraded (503)')
          ]),
          el('div', { class: 'readiness-cell' }, [
            el('span', { class: 'readiness-label', text: 'SQLite WAL Store' }),
            statusIndicator(
              sqliteOk ? 'HEALTHY' : 'ERROR',
              sqliteOk ? `WAL · FK ${h.sqlite?.foreign_keys ? 'On' : 'Off'}` : 'Error'
            )
          ]),
          el('div', { class: 'readiness-cell' }, [
            el('span', { class: 'readiness-label', text: 'MQTT Broker' }),
            statusIndicator(mqttInfo.state, mqttInfo.label)
          ]),
          el('div', { class: 'readiness-cell' }, [
            el('span', { class: 'readiness-label', text: 'Browser Live Streams' }),
            wsReadinessMount
          ])
        ])
      );
    }

    // 4. Main Operational Grid: Left (Managed Rooms) | Right (Attention Queue + Compact Activity Feed)
    clear(bodySlot);
    if (!overview) return;

    // Left: Managed Rooms Grid
    const rooms = overview.rooms || [];
    const roomsSection = el('section', { class: 'stack-md', 'aria-label': 'Managed Rooms' }, [
      el('div', { class: 'row-between' }, [
        el('div', { class: 'stack-xs' }, [
          el('h2', { class: 'section-title', text: 'Managed Rooms' }),
          el('span', { class: 'text-xs text-muted', text: `${rooms.length} active room${rooms.length === 1 ? '' : 's'} registered in this facility` })
        ]),
        el('button', {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          text: 'View all rooms →',
          onClick: () => navigate('/app/rooms')
        })
      ]),
      rooms.length === 0
        ? el('div', { class: 'card' }, [
            emptyState({
              illustration: DASHBOARD_ILLUSTRATIONS.ROOM_ZONE,
              title: 'No active rooms configured',
              message: 'Create your first facility room to assign wired controllers and endpoints.',
              actionLabel: admin ? 'Add Room' : '',
              onAction: admin ? () => navigate('/app/rooms?action=create') : null
            })
          ])
        : el(
            'div',
            { class: 'rooms-grid' },
            rooms.map((room) => {
              const dc = room.device_counts || { total: 0, online: 0, stale: 0, unknown: 0 };
              const alarms = Number(room.active_alarms || 0);
              const roomState =
                alarms > 0
                  ? 'ATTENTION'
                  : dc.total === 0
                    ? 'UNKNOWN'
                    : dc.online === dc.total
                      ? 'ONLINE'
                      : dc.stale > 0
                        ? 'STALE'
                        : 'UNKNOWN';
              const env = room.environmental_summary || {};
              const envLine = [
                env.temperature ? `${Number(env.temperature.value).toFixed(1)} ${env.temperature.unit}` : null,
                env.humidity ? `${Number(env.humidity.value).toFixed(0)} ${env.humidity.unit}` : null
              ]
                .filter(Boolean)
                .join(' · ');

              const roomDevices = devices.filter((d) => d.room_id === room.room_id);
              const uniqueCategories = Array.from(new Set(roomDevices.map((d) => resolveDeviceVisual(d).category)));

              return el(
                'a',
                {
                  href: `/app/rooms/${encodeURIComponent(room.room_id)}`,
                  class: 'card interactive-card room-card',
                  'aria-label': `Open room ${room.name}`,
                  onClick: (e) => {
                    e.preventDefault();
                    navigate(`/app/rooms/${encodeURIComponent(room.room_id)}`);
                  }
                },
                [
                  el('div', { class: 'row-between' }, [
                    el('div', { class: 'row-gap-sm' }, [
                      renderCategoryIconBadge('network', 'icon-rooms', 'sm'),
                      el('span', { class: 'meta-tag mono', text: room.room_code })
                    ]),
                    statusIndicator(
                      roomState,
                      alarms > 0 ? `${alarms} Active Alarm${alarms > 1 ? 's' : ''}` : undefined,
                      { compact: true }
                    )
                  ]),
                  el('div', { class: 'stack-xs' }, [
                    el('div', { class: 'font-semibold', text: room.name }),
                    el('div', {
                      class: 'text-xs text-muted',
                      text: [room.building, room.floor].filter(Boolean).join(' · ') || 'No building/floor tag'
                    })
                  ]),
                  uniqueCategories.length > 0
                    ? el(
                        'div',
                        { class: 'row-gap-sm' },
                        uniqueCategories.slice(0, 4).map((cat) => renderCategoryChip(cat))
                      )
                    : null,
                  el('div', { class: 'room-metrics-row' }, [
                    el('div', {}, [
                      el('div', { class: 'room-metric-label', text: 'Online' }),
                      el('div', { class: 'room-metric-val tabular-nums', text: `${dc.online}/${dc.total}` })
                    ]),
                    el('div', {}, [
                      el('div', { class: 'room-metric-label', text: 'Alarms' }),
                      el('div', {
                        class: `room-metric-val tabular-nums${alarms > 0 ? ' text-warn' : ''}`,
                        text: String(alarms)
                      })
                    ]),
                    el('div', {}, [
                      el('div', { class: 'room-metric-label', text: 'Env' }),
                      el('div', { class: 'room-metric-val mono text-xs tabular-nums', text: envLine || '—' })
                    ])
                  ]),
                  el('div', { class: 'room-card-cta' }, [
                    el('span', { text: 'Open room details' }),
                    svgIcon('icon-chevron-right', 14)
                  ])
                ]
              );
            })
          )
    ]);

    // Right Column: Priority Attention Queue + Compact Recent Activity Feed
    const attentionItems = [];

    const activeAlarmsList = (overview.recent_alarms || [])
      .filter((a) => a.state !== 'RESOLVED')
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

    for (const alarm of activeAlarmsList.slice(0, 4)) {
      attentionItems.push({
        state: alarm.severity || 'WARNING',
        label: alarm.state === 'ACKNOWLEDGED' ? `${alarm.severity} · Ack` : alarm.severity,
        title: alarm.title,
        meta: `${alarm.device_name || alarm.device_id} · ${formatAge(alarm.raised_at)}`,
        actionLabel: 'Inspect',
        onAction: () => navigate(`/app/alarms?alarm_id=${encodeURIComponent(alarm.alarm_id)}`)
      });
    }

    for (const p of pendingList.slice(0, 3)) {
      attentionItems.push({
        state: 'PENDING_REVIEW',
        label: 'Quarantined',
        title: `Unapproved device: ${p.device_id}`,
        meta: `Last announced ${formatAge(p.last_seen_at)} · Requires Admin review`,
        actionLabel: 'Review',
        onAction: () => navigate('/app/devices')
      });
    }

    const driftDevices = devices.filter((d) => d.manifest_drift?.has_drift);
    for (const d of driftDevices.slice(0, 3)) {
      attentionItems.push({
        state: 'DRIFT',
        label: 'Manifest Drift',
        title: `${d.name} (${d.device_id})`,
        meta: `Announced schema differs from registered endpoints`,
        actionLabel: 'Inspect',
        onAction: () => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`)
      });
    }

    const attentionCard = el('section', { class: 'card stack-sm', 'aria-label': 'Priority Attention Queue' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { class: 'card-title', text: 'Attention Queue' }),
        el('span', { class: 'text-xs text-muted tabular-nums', text: `${attentionItems.length} item${attentionItems.length === 1 ? '' : 's'}` })
      ]),
      attentionItems.length === 0
        ? el('div', { class: 'row-gap-sm text-sm text-secondary' }, [
            statusIndicator('HEALTHY', 'No active alarms, quarantined devices, or manifest drift.')
          ])
        : el(
            'div',
            { class: 'queue-list' },
            attentionItems.map((item) =>
              el('div', { class: 'queue-item' }, [
                el('div', { class: 'queue-item-main' }, [
                  statusIndicator(item.state, item.label, { compact: true }),
                  el('div', { class: 'queue-item-title', text: item.title }),
                  el('div', { class: 'queue-item-meta', text: item.meta })
                ]),
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: item.actionLabel,
                  onClick: item.onAction
                })
              ])
            )
          )
    ]);

    const recentNotifs = overview.recent_notifications || [];
    const activityCard = el('section', { class: 'card stack-sm', 'aria-label': 'Recent Activity Feed' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { class: 'card-title', text: 'Recent Activity' }),
        el('button', {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          text: 'All notifications →',
          onClick: () => navigate('/app/notifications')
        })
      ]),
      recentNotifs.length === 0
        ? el('div', { class: 'text-sm text-muted', text: 'No recent facility notifications recorded.' })
        : el(
            'div',
            { class: 'queue-list' },
            recentNotifs.slice(0, 6).map((n) =>
              el('div', { class: 'queue-item' }, [
                el('div', { class: 'queue-item-main' }, [
                  el('div', { class: 'row-between' }, [
                    statusIndicator(n.severity || 'INFO', n.category || 'SYSTEM', { compact: true }),
                    el('span', { class: 'text-xs text-muted mono tabular-nums', text: formatAge(n.timestamp) })
                  ]),
                  el('div', { class: 'queue-item-title', text: n.title }),
                  n.message ? el('div', { class: 'queue-item-meta truncate', text: n.message }) : null
                ]),
                el('button', {
                  type: 'button',
                  class: 'btn btn-ghost btn-sm',
                  text: 'Details',
                  onClick: () => openActivityDrawer(n)
                })
              ])
            )
          )
    ]);

    bodySlot.appendChild(
      el('div', { class: 'overview-grid' }, [
        roomsSection,
        el('div', { class: 'stack-md' }, [attentionCard, activityCard])
      ])
    );
  }

  const scheduleRefresh = () => {
    if (disposed) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => load(true), 1500);
  };

  const unsubStore = subscribe(syncWsReadiness);
  const unsubTel = onLiveEvent('telemetry', scheduleRefresh);
  const unsubNotif = onLiveEvent('notifications', scheduleRefresh);

  load(false);

  return {
    node: container,
    cleanup: () => {
      disposed = true;
      clearTimeout(refreshTimer);
      unsubStore();
      unsubTel();
      unsubNotif();
    }
  };
}
