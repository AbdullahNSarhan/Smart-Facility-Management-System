// LCI-SFM Executive Overview Page (/app/overview)
// 4-col KPI strip, multi-room grid, recent active alarms, and local service readiness.

import { api } from '../api.js';
import { onLiveEvent, isAdmin } from '../store.js';
import { el, clear, formatAge } from '../utils.js';

export function renderOverviewPage({ navigate }) {
  const root = el('div', { class: 'stack-lg' });

  const kpiGrid = el('div', { class: 'kpi-grid' });
  const roomsContainer = el('div', { class: 'rooms-grid' });
  const alarmsContainer = el('div', { class: 'stack-sm' });
  const healthBar = el('div', { class: 'card service-health-strip' });
  const facilitySubtitle = el('p', { class: 'text-secondary', text: 'Loading facility summary...' });

  const headerRow = el('div', { class: 'section-toolbar' }, [
    el('div', {}, [
      el('h2', { class: 'section-title', text: 'Facility Operations Summary' }),
      facilitySubtitle
    ]),
    el('div', { class: 'toolbar-actions' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        text: 'Refresh',
        onClick: () => loadData()
      }),
      isAdmin()
        ? el('button', {
            type: 'button',
            class: 'btn btn-primary btn-sm',
            text: '+ Manage Rooms',
            onClick: () => navigate('/app/rooms')
          })
        : null
    ])
  ]);

  root.appendChild(headerRow);
  root.appendChild(kpiGrid);
  root.appendChild(healthBar);

  // Two-column operational grid: Rooms Grid (Left 2fr) + Active Alarms & Pending (Right 1fr)
  const mainGrid = el('div', { class: 'overview-split' }, [
    el('section', { class: 'stack-md' }, [
      el('div', { class: 'section-toolbar' }, [
        el('h3', { class: 'card-title', text: 'Managed Rooms' }),
        el('button', {
          type: 'button',
          class: 'btn-link',
          text: 'View all rooms →',
          onClick: () => navigate('/app/rooms')
        })
      ]),
      roomsContainer
    ]),
    el('section', { class: 'stack-md' }, [
      el('div', { class: 'section-toolbar' }, [
        el('h3', { class: 'card-title', text: 'Active Alarms' }),
        el('button', {
          type: 'button',
          class: 'btn-link',
          text: 'Open Alarms →',
          onClick: () => navigate('/app/alarms')
        })
      ]),
      alarmsContainer
    ])
  ]);
  root.appendChild(mainGrid);

  let disposed = false;

  const renderKpi = (label, value, detail, tone = '') =>
    el('div', { class: 'card kpi-card' }, [
      el('div', { class: 'kpi-label', text: label }),
      el('div', { class: `kpi-value tabular-nums${tone ? ` text-${tone}` : ''}`, text: String(value) }),
      el('div', { class: 'kpi-detail tabular-nums', text: detail })
    ]);

  const loadData = async () => {
    try {
      const [overview, health] = await Promise.all([api.getOverview(), api.getHealthReady()]);
      if (disposed) return;

      const fac = overview.facility || {};
      const devSummary = overview.device_summary || {};
      const rooms = overview.rooms || [];
      const activeAlarmsCount = Number(overview.active_alarms ?? 0);
      const pendingCount = Number(overview.pending_devices ?? 0);
      facilitySubtitle.textContent = `${fac.name || 'LCI Smart Facility'}${fac.location ? ` · ${fac.location}` : ''} · Timezone ${fac.timezone || 'UTC'}`;

      clear(kpiGrid);
      kpiGrid.appendChild(
        renderKpi('Active Rooms', rooms.length, `${rooms.length} operational spaces`)
      );
      kpiGrid.appendChild(
        renderKpi(
          'Devices Online',
          `${devSummary.online ?? 0} / ${devSummary.registered ?? 0}`,
          `${pendingCount} pending review · ${devSummary.stale ?? 0} stale`,
          (devSummary.online ?? 0) > 0 ? 'ok' : ''
        )
      );
      kpiGrid.appendChild(
        renderKpi(
          'Active Alarms',
          activeAlarmsCount,
          `${overview.unread_notifications ?? 0} unread notifications`,
          activeAlarmsCount > 0 ? 'warn' : 'ok'
        )
      );
      kpiGrid.appendChild(
        renderKpi(
          'Readiness',
          health.ok ? 'READY' : 'DEGRADED',
          health.mqtt?.enabled
            ? `SQLite ${String(health.sqlite?.journal_mode || 'WAL').toUpperCase()} · MQTT ${health.mqtt?.connected ? 'Connected' : 'Disconnected'}`
            : `SQLite ${String(health.sqlite?.journal_mode || 'WAL').toUpperCase()} · MQTT Standby`,
          health.ok ? 'ok' : 'warn'
        )
      );

      // Service Health Strip
      clear(healthBar);
      const mqttText = !health.mqtt?.enabled
        ? 'Standby (Disabled)'
        : health.mqtt?.connected && health.mqtt?.subscriptions_ready
          ? 'Connected & Subscribed'
          : 'Disconnected / Degraded';
      const mqttTone = !health.mqtt?.enabled ? 'muted' : health.mqtt?.connected ? 'ok' : 'crit';

      healthBar.appendChild(
        el('div', { class: 'health-strip-grid' }, [
          el('div', { class: 'health-strip-item' }, [
            el('span', { class: `status-dot ${health.sqlite?.ok ? 'dot-ok' : 'dot-crit'}` }),
            el('span', { class: 'text-muted', text: 'SQLite:' }),
            el('strong', { class: 'mono', text: health.sqlite?.ok ? `OK (${String(health.sqlite?.journal_mode || 'WAL').toUpperCase()})` : 'ERROR' })
          ]),
          el('div', { class: 'health-strip-item' }, [
            el('span', { class: `status-dot dot-${mqttTone}` }),
            el('span', { class: 'text-muted', text: 'MQTT Broker:' }),
            el('strong', { class: 'mono', text: mqttText })
          ]),
          el('div', { class: 'health-strip-item' }, [
            el('span', { class: 'text-muted', text: 'Pending Quarantine:' }),
            el('strong', { class: 'mono tabular-nums', text: String(pendingCount) })
          ]),
          el('button', {
            type: 'button',
            class: 'btn-link',
            text: 'Full Diagnostics →',
            onClick: () => navigate('/app/diagnostics')
          })
        ])
      );

      // Rooms Grid
      clear(roomsContainer);
      if (rooms.length === 0) {
        roomsContainer.appendChild(
          el('div', { class: 'card empty-state' }, [
            el('p', { class: 'text-secondary', text: 'No rooms configured yet.' })
          ])
        );
      } else {
        for (const room of rooms) {
          const alarmCount = Number(room.active_alarm_count || 0);
          const tone = alarmCount > 0 ? 'dot-warn' : Number(room.online_device_count || 0) > 0 ? 'dot-ok' : 'dot-muted';
          roomsContainer.appendChild(
            el('article', {
              class: 'card room-card clickable-card',
              onClick: () => navigate(`/app/rooms/${encodeURIComponent(room.room_id)}`)
            }, [
              el('div', { class: 'card-head' }, [
                el('div', {}, [
                  el('div', { class: 'mono text-muted', text: room.room_code }),
                  el('h4', { class: 'room-card-name', text: room.name })
                ]),
                el('div', { class: 'status-inline' }, [
                  el('span', { class: `status-dot ${tone}` }),
                  el('span', { class: 'status-label', text: alarmCount > 0 ? `${alarmCount} Alarm${alarmCount > 1 ? 's' : ''}` : 'Nominal' })
                ])
              ]),
              el('div', { class: 'room-card-meta' }, [
                el('span', { class: 'tabular-nums', text: `${room.device_count ?? 0} devices (${room.online_device_count ?? 0} online)` }),
                room.building || room.floor
                  ? el('span', { class: 'text-muted', text: [room.building, room.floor].filter(Boolean).join(' · ') })
                  : null
              ])
            ])
          );
        }
      }

      // Active Alarms list
      clear(alarmsContainer);
      const alarms = overview.recent_alarms || [];
      if (alarms.length === 0) {
        alarmsContainer.appendChild(
          el('div', { class: 'card empty-state' }, [
            el('p', { class: 'text-secondary', text: 'No active alarms across managed rooms.' })
          ])
        );
      } else {
        for (const alarm of alarms.slice(0, 6)) {
          const dot = alarm.severity === 'CRITICAL' ? 'dot-crit' : alarm.severity === 'WARNING' ? 'dot-warn' : 'dot-info';
          alarmsContainer.appendChild(
            el('article', {
              class: 'card alarm-mini-card clickable-card',
              onClick: () => navigate('/app/alarms')
            }, [
              el('div', { class: 'card-head' }, [
                el('div', { class: 'status-inline' }, [
                  el('span', { class: `status-dot ${dot}` }),
                  el('strong', { text: alarm.title || alarm.rule_id })
                ]),
                el('span', { class: 'mono text-muted tabular-nums', text: formatAge(alarm.opened_at) })
              ]),
              el('div', { class: 'text-secondary', text: alarm.message || `${alarm.device_id} · ${alarm.endpoint_key}` }),
              el('div', { class: 'mono text-muted', text: `${alarm.state} · ${alarm.device_id}` })
            ])
          );
        }
      }
    } catch (err) {
      if (disposed) return;
      facilitySubtitle.textContent = `Failed to load overview: ${err.message}`;
    }
  };

  loadData();
  const unsubTel = onLiveEvent('telemetry', () => {
    // Throttle live refreshes cleanly
  });
  const unsubNotif = onLiveEvent('notifications', () => loadData());
  const poll = setInterval(loadData, 15000);

  return {
    node: root,
    cleanup: () => {
      disposed = true;
      unsubTel();
      unsubNotif();
      clearInterval(poll);
    }
  };
}
