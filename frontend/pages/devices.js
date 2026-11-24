// LCI-SFM Devices Inventory (/app/devices), Device Detail (/app/devices/:deviceId),
// and Endpoint Detail & History (/app/devices/:deviceId/endpoints/:endpointKey).

import { api } from '../api.js';
import { isAdmin, showToast, openModal, closeModal, confirmDialog, onLiveEvent } from '../store.js';
import {
  el,
  clear,
  formatAge,
  formatTimestamp,
  formatEndpointValue,
  buildHistoryChartSvg,
  exportRowsToCsv
} from '../utils.js';
import { renderEndpointWidget } from '../widgets.js';

const TRANSPORTS = ['MQTT_V1', 'HTTP_JSON_V1', 'CAMERA_JPEG', 'LEGACY_V1'];
const KINDS = ['SENSOR', 'SWITCH', 'ACCESS', 'CAMERA'];
const DATA_TYPES = ['NUMBER', 'BOOLEAN', 'ENUM', 'MEDIA', 'STRING'];

function openDeviceFormModal({ existing = null, prefill = null, rooms = [], defaultRoomId = '', onSaved }) {
  const isEdit = Boolean(existing);
  const src = existing || prefill || {};
  const errBox = el('div', { class: 'alert alert-error hidden' });

  const idInput = el('input', {
    class: 'input mono',
    type: 'text',
    value: src.device_id || '',
    placeholder: 'e.g. env-lab-201',
    disabled: isEdit,
    required: true
  });
  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    value: src.name || '',
    placeholder: 'e.g. Lab 201 Environmental Sensor',
    required: true
  });
  const roomSelect = el(
    'select',
    { class: 'input' },
    rooms
      .filter((r) => r.status === 'ACTIVE' || r.room_id === src.room_id)
      .map((r) =>
        el('option', {
          value: r.room_id,
          selected: r.room_id === (src.room_id || defaultRoomId || rooms[0]?.room_id),
          text: `${r.room_code} — ${r.name}`
        })
      )
  );
  const transportSelect = el(
    'select',
    { class: 'input', disabled: isEdit },
    TRANSPORTS.map((t) =>
      el('option', { value: t, selected: (src.transport || 'MQTT_V1') === t, text: t })
    )
  );
  const ipInput = el('input', {
    class: 'input mono',
    type: 'text',
    value: src.ip || '',
    placeholder: 'Optional for MQTT_V1 (e.g. 192.168.10.25)'
  });
  const portInput = el('input', {
    class: 'input mono',
    type: 'number',
    value: src.port !== undefined && src.port !== null ? String(src.port) : '80',
    min: '0',
    max: '65535'
  });
  const pathInput = el('input', {
    class: 'input mono',
    type: 'text',
    value: src.http_path || '/status',
    placeholder: '/status or /capture.jpg'
  });
  const staleInput = el('input', {
    class: 'input mono',
    type: 'number',
    value: String(src.stale_after_ms || 30000),
    min: '1000',
    max: '3600000'
  });

  const networkRow = el('div', { class: 'form-grid-3' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: 'Private LAN IP' }),
      ipInput
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: 'Port' }),
      portInput
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: 'HTTP Path' }),
      pathInput
    ])
  ]);

  const syncTransportFields = () => {
    const t = transportSelect.value;
    const needsHttp = t === 'HTTP_JSON_V1' || t === 'CAMERA_JPEG';
    ipInput.placeholder = needsHttp ? 'Required private LAN IP (e.g. 192.168.10.25)' : 'Optional for MQTT_V1';
    pathInput.disabled = !needsHttp;
    if (t === 'MQTT_V1' && !isEdit && !ipInput.value) {
      portInput.value = '0';
    } else if (needsHttp && portInput.value === '0') {
      portInput.value = '80';
    }
  };
  transportSelect.addEventListener('change', syncTransportFields);
  syncTransportFields();

  // Dynamic Endpoint Builder
  const endpointsState = Array.isArray(src.endpoints) && src.endpoints.length > 0
    ? src.endpoints.map((ep) => ({
        endpoint_key: ep.endpoint_key || '',
        label: ep.label || '',
        kind: ep.kind || 'SENSOR',
        data_type: ep.data_type || (ep.kind === 'SWITCH' ? 'ENUM' : ep.kind === 'CAMERA' ? 'MEDIA' : 'NUMBER'),
        unit: ep.unit || '',
        writable: Boolean(ep.writable),
        min_value: ep.min_value ?? '',
        max_value: ep.max_value ?? ''
      }))
    : [
        {
          endpoint_key: 'temperature',
          label: 'Temperature',
          kind: 'SENSOR',
          data_type: 'NUMBER',
          unit: '°C',
          writable: false,
          min_value: '',
          max_value: ''
        }
      ];

  const endpointsHost = el('div', { class: 'stack-sm' });
  const renderEndpointsEditor = () => {
    clear(endpointsHost);
    endpointsState.forEach((ep, idx) => {
      const row = el('div', { class: 'endpoint-editor-row' }, [
        el('input', {
          class: 'input input-sm mono',
          placeholder: 'key (e.g. temperature)',
          value: ep.endpoint_key,
          onInput: (e) => {
            ep.endpoint_key = e.target.value;
          }
        }),
        el('input', {
          class: 'input input-sm',
          placeholder: 'Label',
          value: ep.label,
          onInput: (e) => {
            ep.label = e.target.value;
          }
        }),
        el(
          'select',
          {
            class: 'input input-sm',
            onChange: (e) => {
              ep.kind = e.target.value;
              if (ep.kind === 'SWITCH') {
                ep.data_type = 'ENUM';
                ep.writable = true;
              } else if (ep.kind === 'CAMERA') {
                ep.data_type = 'MEDIA';
                ep.writable = false;
              }
              renderEndpointsEditor();
            }
          },
          KINDS.map((k) => el('option', { value: k, selected: ep.kind === k, text: k }))
        ),
        el(
          'select',
          {
            class: 'input input-sm',
            onChange: (e) => {
              ep.data_type = e.target.value;
            }
          },
          DATA_TYPES.map((dt) => el('option', { value: dt, selected: ep.data_type === dt, text: dt }))
        ),
        el('input', {
          class: 'input input-sm',
          placeholder: 'Unit',
          value: ep.unit,
          onInput: (e) => {
            ep.unit = e.target.value;
          }
        }),
        el('label', { class: 'checkbox-inline' }, [
          el('input', {
            type: 'checkbox',
            checked: ep.writable,
            onChange: (e) => {
              ep.writable = e.target.checked;
            }
          }),
          el('span', { text: 'Writable' })
        ]),
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-xs',
          text: '×',
          title: 'Remove endpoint',
          disabled: endpointsState.length <= 1,
          onClick: () => {
            endpointsState.splice(idx, 1);
            renderEndpointsEditor();
          }
        })
      ]);
      endpointsHost.appendChild(row);
    });
  };
  renderEndpointsEditor();

  const body = el('form', { class: 'stack-md' }, [
    errBox,
    el('div', { class: 'form-grid-2' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Device ID * (lowercase slug)' }),
        idInput
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Display Name *' }),
        nameInput
      ])
    ]),
    el('div', { class: 'form-grid-3' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Assigned Room *' }),
        roomSelect
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Transport Protocol *' }),
        transportSelect
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Stale Threshold (ms)' }),
        staleInput
      ])
    ]),
    networkRow,
    el('div', { class: 'stack-sm' }, [
      el('div', { class: 'section-toolbar' }, [
        el('strong', { text: 'Generic Endpoints (Capability + Data Type)' }),
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-xs',
          text: '+ Add Endpoint',
          onClick: () => {
            endpointsState.push({
              endpoint_key: '',
              label: '',
              kind: 'SENSOR',
              data_type: 'NUMBER',
              unit: '',
              writable: false
            });
            renderEndpointsEditor();
          }
        })
      ]),
      endpointsHost
    ])
  ]);

  const submitBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: isEdit ? 'Save Device' : 'Register Device'
  });

  const handleSave = async () => {
    errBox.classList.add('hidden');
    const cleanEndpoints = endpointsState
      .filter((ep) => ep.endpoint_key.trim())
      .map((ep) => ({
        endpoint_key: ep.endpoint_key.trim(),
        label: ep.label.trim() || ep.endpoint_key.trim(),
        kind: ep.kind,
        data_type: ep.data_type,
        unit: ep.unit.trim(),
        writable: Boolean(ep.writable),
        ...(ep.kind === 'SWITCH' ? { allowed_values: ['ON', 'OFF'], command_profile: 'MQTT_SWITCH_V1' } : {})
      }));

    if (cleanEndpoints.length === 0) {
      errBox.textContent = 'At least one endpoint is required.';
      errBox.classList.remove('hidden');
      return;
    }

    const transport = transportSelect.value;
    const kinds = new Set(cleanEndpoints.map((e) => e.kind));
    const device_type =
      kinds.size === 1
        ? kinds.has('SENSOR')
          ? 'SENSORS'
          : kinds.has('SWITCH')
            ? 'RELAY'
            : kinds.has('CAMERA')
              ? 'CAMERA'
              : 'ACCESS'
        : 'MIXED';
    const rawPort = Number(portInput.value || 80);
    const port = rawPort >= 1 && rawPort <= 65535 ? rawPort : 80;
    const rawPath = pathInput.value.trim();
    const safePath = /^\/[a-zA-Z0-9_/-]+(?:\.(?:json|jpg))?$/.test(rawPath) ? rawPath : '/telemetry';
    const staleS = Math.max(5, Math.min(3600, Math.round(Number(staleInput.value || 90000) / 1000)));
    const selectedRoom = rooms.find((r) => r.room_id === roomSelect.value);

    const payload = {
      device_id: idInput.value.trim().toLowerCase(),
      name: nameInput.value.trim(),
      room_id: roomSelect.value,
      location: selectedRoom?.room_code || roomSelect.value || 'room-001',
      device_type,
      transport,
      ip: ipInput.value.trim(),
      port,
      path: safePath,
      stale_after_s: staleS,
      enabled: true,
      endpoints: cleanEndpoints
    };

    submitBtn.disabled = true;
    try {
      if (isEdit) {
        await api.updateDevice(existing.device_id, {
          ...payload,
          version: existing.version
        });
        showToast('Device updated', `${payload.name} saved.`, 'success');
      } else {
        await api.createDevice(payload);
        showToast('Device registered', `${payload.name} (${payload.device_id}) added.`, 'success');
      }
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
      submitBtn.disabled = false;
    }
  };

  submitBtn.addEventListener('click', handleSave);
  body.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSave();
  });

  openModal({
    title: isEdit ? `Edit Device · ${existing.name}` : prefill ? `Approve Pending Device · ${prefill.device_id}` : 'Register Facility Device',
    subtitle: 'Dynamic Multi-Room Device Registry',
    body,
    wide: true,
    actions: [
      el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
      submitBtn
    ]
  });
}

export function renderDevicesListPage({ navigate, query }) {
  const root = el('div', { class: 'stack-lg' });
  let roomFilter = query.get('room_id') || '';
  let transportFilter = '';
  let showArchived = false;
  let searchQuery = '';
  let roomsCache = [];

  const searchInput = el('input', {
    type: 'search',
    class: 'input input-sm',
    placeholder: 'Search devices by ID, name, IP...',
    onInput: (e) => {
      searchQuery = e.target.value.trim();
      loadAll();
    }
  });
  const roomSelect = el('select', {
    class: 'input input-sm',
    onChange: (e) => {
      roomFilter = e.target.value;
      loadAll();
    }
  });
  const transportSelect = el(
    'select',
    {
      class: 'input input-sm',
      onChange: (e) => {
        transportFilter = e.target.value;
        loadAll();
      }
    },
    [el('option', { value: '', text: 'All Transports' }), ...TRANSPORTS.map((t) => el('option', { value: t, text: t }))]
  );
  const archivedCheck = el('label', { class: 'checkbox-inline' }, [
    el('input', {
      type: 'checkbox',
      onChange: (e) => {
        showArchived = e.target.checked;
        loadAll();
      }
    }),
    el('span', { text: 'Show archived' })
  ]);

  const registerBtn = isAdmin()
    ? el('button', {
        type: 'button',
        id: 'register-device-btn',
        class: 'btn btn-primary btn-sm',
        text: '+ Register Device',
        onClick: () => openDeviceFormModal({ rooms: roomsCache, defaultRoomId: roomFilter, onSaved: loadAll })
      })
    : null;

  root.appendChild(
    el('div', { class: 'section-toolbar' }, [
      el('div', { class: 'filter-row' }, [searchInput, roomSelect, transportSelect, archivedCheck]),
      el('div', { class: 'toolbar-actions' }, [
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Refresh', onClick: () => loadAll() }),
        registerBtn
      ])
    ])
  );

  const pendingHost = el('div');
  const tableHost = el('div', { class: 'card table-card' });
  root.appendChild(pendingHost);
  root.appendChild(tableHost);

  let openedInitialAction = false;

  const loadAll = async () => {
    try {
      const [roomsRes, devRes, pendingRes] = await Promise.all([
        api.listRooms({ include_archived: true }),
        api.listDevices({ room_id: roomFilter || undefined, include_archived: showArchived, search: searchQuery }),
        isAdmin() ? api.listPendingDevices().catch(() => ({ items: [] })) : Promise.resolve({ items: [] })
      ]);

      roomsCache = roomsRes.rooms || roomsRes.items || [];
      const roomNameMap = new Map(roomsCache.map((r) => [r.room_id, `${r.room_code} · ${r.name}`]));

      // Populate room filter dropdown
      clear(roomSelect);
      roomSelect.appendChild(el('option', { value: '', text: 'All Rooms', selected: !roomFilter }));
      for (const r of roomsCache) {
        roomSelect.appendChild(
          el('option', { value: r.room_id, text: `${r.room_code} — ${r.name}`, selected: roomFilter === r.room_id })
        );
      }

      if (!openedInitialAction && query.get('action') === 'new' && isAdmin()) {
        openedInitialAction = true;
        openDeviceFormModal({ rooms: roomsCache, defaultRoomId: roomFilter, onSaved: loadAll });
      }

      // Render Pending Quarantine Banner (Admin only)
      clear(pendingHost);
      const pendingItems = (pendingRes.pending_devices || pendingRes.items || []).filter((p) => p.status === 'PENDING');
      if (isAdmin() && pendingItems.length > 0) {
        pendingHost.appendChild(
          el('section', { class: 'card stack-sm' }, [
            el('div', { class: 'card-head' }, [
              el('div', {}, [
                el('h3', { class: 'card-title', text: `Pending MQTT Devices (${pendingItems.length})` }),
                el('p', {
                  class: 'text-secondary',
                  text: 'Unregistered devices announcing heartbeats are quarantined until an Admin reviews and approves them.'
                })
              ])
            ]),
            el(
              'div',
              { class: 'stack-sm' },
              pendingItems.map((p) => {
                const manifestEps = Array.isArray(p.manifest?.endpoints) ? p.manifest.endpoints : [];
                return el('div', { class: 'pending-row' }, [
                  el('div', {}, [
                    el('div', { class: 'mono cell-primary', text: p.device_id }),
                    el('div', {
                      class: 'cell-sub tabular-nums',
                      text: `FW ${p.firmware_version || 'unknown'} · ${manifestEps.length} proposed endpoints · Last seen ${formatAge(p.last_seen_at)}`
                    })
                  ]),
                  el('div', { class: 'toolbar-actions' }, [
                    el('button', {
                      type: 'button',
                      class: 'btn btn-primary btn-xs',
                      text: 'Review & Approve',
                      onClick: () =>
                        openDeviceFormModal({
                          rooms: roomsCache,
                          prefill: {
                            device_id: p.device_id,
                            name: p.manifest?.name || p.device_id,
                            transport: 'MQTT_V1',
                            endpoints: manifestEps
                          },
                          onSaved: loadAll
                        })
                    }),
                    el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-xs',
                      text: 'Dismiss',
                      onClick: async () => {
                        try {
                          await api.dismissPendingDevice(p.device_id);
                          showToast('Pending device dismissed', `${p.device_id} dismissed.`, 'info');
                          loadAll();
                        } catch (err) {
                          showToast('Action failed', err.message, 'error');
                        }
                      }
                    })
                  ])
                ]);
              })
            )
          ])
        );
      }

      // Render Devices Table
      clear(tableHost);
      let items = devRes.devices || devRes.items || [];
      if (transportFilter) {
        items = items.filter((d) => d.transport === transportFilter);
      }

      if (items.length === 0) {
        tableHost.appendChild(
          el('div', { class: 'empty-state' }, [
            el('p', { class: 'text-secondary', text: 'No registered devices match the current filters.' })
          ])
        );
        return;
      }

      const tbody = el('tbody');
      for (const dev of items) {
        const isOnline = dev.connectivity === 'ONLINE' || dev.fresh;
        const isArchived = Boolean(dev.archived_at);
        const dotClass = isArchived
          ? 'dot-muted'
          : !dev.enabled
            ? 'dot-muted'
            : isOnline
              ? 'dot-ok'
              : 'dot-warn';

        tbody.appendChild(
          el('tr', {}, [
            el('td', {}, [
              el('button', {
                type: 'button',
                class: 'link-title',
                text: dev.name,
                onClick: () => navigate(`/app/devices/${encodeURIComponent(dev.device_id)}`)
              }),
              el('div', { class: 'mono cell-sub', text: dev.device_id })
            ]),
            el('td', { text: roomNameMap.get(dev.room_id) || dev.room_id || '—' }),
            el('td', { class: 'mono', text: dev.transport }),
            el('td', { class: 'mono tabular-nums', text: dev.ip ? `${dev.ip}:${dev.port}` : 'MQTT Broker' }),
            el('td', { class: 'tabular-nums', text: `${(dev.endpoints || []).length} endpoints` }),
            el('td', {}, [
              el('div', { class: 'status-inline' }, [
                el('span', { class: `status-dot ${dotClass}` }),
                el('span', {
                  text: isArchived
                    ? 'ARCHIVED'
                    : !dev.enabled
                      ? 'DISABLED'
                      : dev.connectivity || (isOnline ? 'ONLINE' : 'OFFLINE')
                })
              ]),
              dev.manifest_drift?.has_drift
                ? el('div', { class: 'text-warn cell-sub', text: 'Manifest drift detected' })
                : null
            ]),
            el('td', { class: 'actions-cell' }, [
              el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-xs',
                text: 'Inspect',
                onClick: () => navigate(`/app/devices/${encodeURIComponent(dev.device_id)}`)
              }),
              isAdmin() && !isArchived
                ? el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-xs',
                    text: 'Edit',
                    onClick: () => openDeviceFormModal({ existing: dev, rooms: roomsCache, onSaved: loadAll })
                  })
                : null
            ])
          ])
        );
      }

      tableHost.appendChild(
        el('div', { class: 'table-scroll' }, [
          el('table', { class: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Device' }),
                el('th', { text: 'Room' }),
                el('th', { text: 'Transport' }),
                el('th', { text: 'Address' }),
                el('th', { text: 'Endpoints' }),
                el('th', { text: 'Status' }),
                el('th', { text: 'Actions' })
              ])
            ]),
            tbody
          ])
        ])
      );
    } catch (err) {
      clear(tableHost);
      tableHost.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  loadAll();
  return { node: root };
}

export function renderDeviceDetailPage({ params, navigate }) {
  const deviceId = decodeURIComponent(params.deviceId || '');
  const root = el('div', { class: 'stack-lg' });
  const headerHost = el('div');
  const alertsHost = el('div');
  const widgetsHost = el('div', { class: 'endpoint-grid' });
  const metaHost = el('div', { class: 'overview-split' });

  root.appendChild(headerHost);
  root.appendChild(alertsHost);
  root.appendChild(
    el('section', { class: 'stack-md' }, [
      el('h3', { class: 'card-title', text: 'Endpoints (Generic Capability Engine)' }),
      widgetsHost
    ])
  );
  root.appendChild(metaHost);

  let disposed = false;

  const loadDevice = async () => {
    try {
      const [devRes, roomsRes] = await Promise.all([
        api.getDevice(deviceId),
        api.listRooms({ include_archived: true })
      ]);
      if (disposed) return;

      const dev = devRes.device || devRes;
      const rooms = roomsRes.rooms || roomsRes.items || [];
      const roomObj = rooms.find((r) => r.room_id === dev.room_id);
      const isOnline = dev.status === 'ONLINE' || dev.connectivity === 'ONLINE' || dev.fresh;
      const isArchived = Boolean(dev.archived || dev.archived_at);

      // Header Card
      clear(headerHost);
      const actions = [
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Refresh', onClick: loadDevice })
      ];
      if (isAdmin()) {
        if (!isArchived) {
          actions.push(
            el('button', {
              type: 'button',
              class: 'btn btn-secondary btn-sm',
              text: 'Edit Device',
              onClick: () => openDeviceFormModal({ existing: dev, rooms, onSaved: loadDevice })
            })
          );
          if (dev.transport === 'HTTP_JSON_V1' || dev.transport === 'CAMERA_JPEG') {
            actions.push(
              el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                text: 'Probe Now',
                onClick: async () => {
                  try {
                    const p = await api.probeDevice(dev.device_id);
                    showToast('Probe completed', `HTTP probe status: ${p.status || 'OK'}`, 'info');
                    loadDevice();
                  } catch (err) {
                    showToast('Probe failed', err.message, 'error');
                  }
                }
              })
            );
          }
          actions.push(
            el('button', {
              type: 'button',
              class: 'btn btn-secondary btn-sm',
              text: dev.in_maintenance ? 'End Maintenance' : 'Maintenance (30m)',
              onClick: async () => {
                try {
                  await api.setMaintenance(dev.device_id, {
                    minutes: dev.in_maintenance ? 0 : 30,
                    reason: dev.in_maintenance ? 'Operator ended maintenance' : 'Operator scheduled maintenance'
                  });
                  showToast('Maintenance updated', dev.in_maintenance ? 'Maintenance window cleared.' : '30-minute maintenance window active.', 'info');
                  loadDevice();
                } catch (err) {
                  showToast('Maintenance update failed', err.message, 'error');
                }
              }
            })
          );
          actions.push(
            el('button', {
              type: 'button',
              class: 'btn btn-secondary btn-sm',
              text: 'Archive',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: `Archive ${dev.name}?`,
                  message: 'Archived devices stop accepting live telemetry and commands while preserving all historical data.',
                  confirmLabel: 'Archive Device',
                  danger: true
                });
                if (!ok) return;
                try {
                  await api.archiveDevice(dev.device_id);
                  showToast('Device archived', `${dev.name} archived.`, 'info');
                  loadDevice();
                } catch (err) {
                  showToast('Archive failed', err.message, 'error');
                }
              }
            })
          );
        } else {
          actions.push(
            el('button', {
              type: 'button',
              class: 'btn btn-primary btn-sm',
              text: 'Restore Device',
              onClick: async () => {
                try {
                  await api.restoreDevice(dev.device_id);
                  showToast('Device restored', `${dev.name} restored.`, 'success');
                  loadDevice();
                } catch (err) {
                  showToast('Restore failed', err.message, 'error');
                }
              }
            })
          );
        }
      }

      headerHost.appendChild(
        el('div', { class: 'card detail-hero-card' }, [
          el('div', { class: 'section-toolbar' }, [
            el('div', {}, [
              el('div', { class: 'status-inline' }, [
                el('span', { class: `status-dot ${isArchived ? 'dot-muted' : isOnline ? 'dot-ok' : 'dot-warn'}` }),
                el('span', { class: 'mono', text: `${dev.device_id} · ${dev.transport}` })
              ]),
              el('h2', { class: 'section-title', text: dev.name }),
              el('div', { class: 'text-secondary' }, [
                'Room: ',
                roomObj
                  ? el('button', {
                      type: 'button',
                      class: 'btn-link',
                      text: `${roomObj.room_code} — ${roomObj.name}`,
                      onClick: () => navigate(`/app/rooms/${encodeURIComponent(roomObj.room_id)}`)
                    })
                  : el('span', { text: dev.room_id || 'Unassigned' }),
                ` · Last telemetry: ${formatAge(dev.last_telemetry_at)} · Last heartbeat: ${formatAge(dev.last_heartbeat_at)}`
              ])
            ]),
            el('div', { class: 'toolbar-actions' }, actions)
          ])
        ])
      );

      // Alerts: Manifest Drift or Maintenance
      clear(alertsHost);
      if (dev.manifest_drift?.has_drift) {
        alertsHost.appendChild(
          el('div', { class: 'alert alert-warning' }, [
            el('strong', { text: 'Capability Manifest Drift Detected — ' }),
            el('span', {
              text: `Device announced differences (${(dev.manifest_drift.added_endpoints || []).length} added, ${(dev.manifest_drift.removed_endpoints || []).length} missing). Schema was NOT auto-mutated. Review and edit endpoints explicitly.`
            })
          ])
        );
      }

      // Generic Endpoint Widgets
      clear(widgetsHost);
      for (const ep of dev.endpoints || []) {
        widgetsHost.appendChild(renderEndpointWidget(dev, ep, { navigate, onRefresh: loadDevice }));
      }

      // Metadata & MQTT Identity Provisioning Panel
      clear(metaHost);
      const specCard = el('div', { class: 'card stack-sm' }, [
        el('h3', { class: 'card-title', text: 'Device Specification' }),
        el('div', { class: 'spec-list' }, [
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Device ID' }), el('code', { class: 'mono', text: dev.device_id })]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Transport' }), el('code', { class: 'mono', text: dev.transport })]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Network Address' }), el('code', { class: 'mono', text: dev.ip ? `${dev.ip}:${dev.port}` : 'Broker-mediated (No IP required)' })]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Firmware' }), el('code', { class: 'mono', text: dev.firmware_version || 'Not reported' })]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Stale Threshold' }), el('code', { class: 'mono tabular-nums', text: `${dev.stale_after_ms} ms` })]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'MQTT Identity' }), el('code', { class: 'mono', text: dev.mqtt_identity_status || 'UNPROVISIONED' })])
        ])
      ]);

      const mqttCard = el('div', { class: 'card stack-sm' }, [
        el('h3', { class: 'card-title', text: 'MQTT Identity & Topic Contract' }),
        el('div', { class: 'spec-list' }, [
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Telemetry Topic' }), el('code', { class: 'mono', text: `lci/v1/devices/${dev.device_id}/telemetry` })]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Heartbeat Topic' }), el('code', { class: 'mono', text: `lci/v1/devices/${dev.device_id}/heartbeat` })]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'Command Topic' }), el('code', { class: 'mono', text: `lci/v1/devices/${dev.device_id}/cmd` })]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'spec-key', text: 'ACK Topic' }), el('code', { class: 'mono', text: `lci/v1/devices/${dev.device_id}/ack` })])
        ]),
        dev.transport === 'MQTT_V1'
          ? el('div', { class: 'stack-sm' }, [
              el('div', { class: 'text-secondary', text: 'Provision per-device Mosquitto credentials on the Ubuntu host:' }),
              el('pre', { class: 'code-block mono', text: `sudo ./scripts/provision-mqtt-device.sh add ${dev.device_id}` }),
              isAdmin()
                ? el('div', { class: 'toolbar-actions' }, [
                    el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-xs',
                      text: dev.mqtt_identity_status === 'PROVISIONED' ? 'Mark Unprovisioned' : 'Mark Provisioned',
                      onClick: async () => {
                        const next = dev.mqtt_identity_status === 'PROVISIONED' ? 'UNPROVISIONED' : 'PROVISIONED';
                        try {
                          await api.setMqttIdentityStatus(dev.device_id, next, dev.version);
                          showToast('MQTT identity updated', `Status set to ${next}.`, 'success');
                          loadDevice();
                        } catch (err) {
                          showToast('Update failed', err.message, 'error');
                        }
                      }
                    })
                  ])
                : null
            ])
          : null
      ]);

      metaHost.appendChild(specCard);
      metaHost.appendChild(mqttCard);
    } catch (err) {
      if (disposed) return;
      clear(headerHost);
      headerHost.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  loadDevice();
  const unsub = onLiveEvent('telemetry', (msg) => {
    if (msg.device_id === deviceId || msg.node_id === deviceId) {
      loadDevice();
    }
  });

  return {
    node: root,
    cleanup: () => {
      disposed = true;
      unsub();
    }
  };
}

export function renderEndpointDetailPage({ params, navigate }) {
  const deviceId = decodeURIComponent(params.deviceId || '');
  const endpointKey = decodeURIComponent(params.endpointKey || '');
  const root = el('div', { class: 'stack-lg' });

  const summaryHost = el('div', { class: 'kpi-grid' });
  const chartCard = el('div', { class: 'card stack-md' });
  const tableCard = el('div', { class: 'card table-card' });

  root.appendChild(
    el('div', { class: 'section-toolbar' }, [
      el('div', {}, [
        el('h2', { class: 'section-title', text: `${deviceId} / ${endpointKey}` }),
        el('p', { class: 'text-secondary', text: 'Per-endpoint historical observations and CSV export' })
      ]),
      el('div', { class: 'toolbar-actions' }, [
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          text: '← Back to Device',
          onClick: () => navigate(`/app/devices/${encodeURIComponent(deviceId)}`)
        }),
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Refresh', onClick: () => loadHistory() }),
        el('button', {
          type: 'button',
          class: 'btn btn-primary btn-sm',
          text: 'Export CSV',
          onClick: () => {
            exportRowsToCsv(
              `lci-sfm-${deviceId}-${endpointKey}.csv`,
              [
                { label: 'Observed At', key: 'observed_at' },
                { label: 'Value', key: 'value' },
                { label: 'Boot ID', key: 'boot_id' },
                { label: 'Seq', key: 'seq' }
              ],
              samplesCache
            );
          }
        })
      ])
    ])
  );
  root.appendChild(summaryHost);
  root.appendChild(chartCard);
  root.appendChild(tableCard);

  let samplesCache = [];

  const loadHistory = async () => {
    try {
      const res = await api.getEndpointHistory(deviceId, endpointKey, 150);
      const endpoint = res.endpoint || { endpoint_key: endpointKey };
      const samples = res.samples || [];
      samplesCache = samples;

      const numericVals = samples
        .map((s) => (typeof s.value === 'boolean' ? (s.value ? 1 : 0) : Number(s.value)))
        .filter((n) => Number.isFinite(n));
      const latest = samples[samples.length - 1];
      const min = numericVals.length ? Math.min(...numericVals).toFixed(2) : '—';
      const max = numericVals.length ? Math.max(...numericVals).toFixed(2) : '—';
      const avg = numericVals.length
        ? (numericVals.reduce((a, b) => a + b, 0) / numericVals.length).toFixed(2)
        : '—';

      clear(summaryHost);
      for (const [label, val, detail] of [
        ['Latest Value', latest ? formatEndpointValue(latest.value, endpoint) : '—', latest ? formatAge(latest.observed_at) : 'No samples'],
        ['Minimum', min, endpoint.unit || endpoint.data_type || ''],
        ['Maximum', max, endpoint.unit || endpoint.data_type || ''],
        ['Average', avg, `${samples.length} samples shown`]
      ]) {
        summaryHost.appendChild(
          el('div', { class: 'card kpi-card' }, [
            el('div', { class: 'kpi-label', text: label }),
            el('div', { class: 'kpi-value tabular-nums', text: String(val) }),
            el('div', { class: 'kpi-detail', text: String(detail) })
          ])
        );
      }

      clear(chartCard);
      chartCard.appendChild(el('h3', { class: 'card-title', text: `${endpoint.label || endpointKey} Trend` }));
      chartCard.appendChild(
        buildHistoryChartSvg(samples, {
          unit: endpoint.unit || '',
          label: `${endpoint.label || endpointKey} history`
        })
      );

      clear(tableCard);
      if (samples.length === 0) {
        tableCard.appendChild(el('div', { class: 'empty-state', text: 'No historical observations recorded yet.' }));
      } else {
        const tbody = el(
          'tbody',
          {},
          [...samples]
            .reverse()
            .slice(0, 60)
            .map((s) =>
              el('tr', {}, [
                el('td', { class: 'mono tabular-nums', text: formatTimestamp(s.observed_at) }),
                el('td', { class: 'mono tabular-nums', text: formatEndpointValue(s.value, endpoint) }),
                el('td', { class: 'mono', text: s.boot_id || '—' }),
                el('td', { class: 'mono tabular-nums', text: s.seq !== undefined && s.seq !== null ? String(s.seq) : '—' })
              ])
            )
        );
        tableCard.appendChild(
          el('div', { class: 'table-scroll' }, [
            el('table', { class: 'data-table' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { text: 'Observed At' }),
                  el('th', { text: 'Value' }),
                  el('th', { text: 'Boot ID' }),
                  el('th', { text: 'Sequence' })
                ])
              ]),
              tbody
            ])
          ])
        );
      }
    } catch (err) {
      clear(chartCard);
      chartCard.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  loadHistory();
  return { node: root };
}
