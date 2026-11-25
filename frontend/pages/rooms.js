// LCI-SFM Rooms Management Pages (/app/rooms & /app/rooms/:roomId)
// Adaptive desktop table + mobile stacked cards, segmented Active/Archived filtering, and safe room lifecycle.

import { api } from '../api.js';
import { isAdmin, showToast, openModal, closeModal, confirmDialog } from '../store.js';
import { el, clear, svgIcon, formatAge, formatTimestamp } from '../utils.js';
import {
  pageHeader,
  statusIndicator,
  loadingSkeleton,
  emptyState,
  errorPanel,
  segmentedFilter,
  renderAdaptiveCollection,
  keyValueList,
  copyableValue
} from '../components/ui.js';

function openRoomModal({ room = null, onSaved }) {
  const isEdit = Boolean(room);
  const codeInput = el('input', {
    class: 'input mono',
    type: 'text',
    value: room?.room_code || '',
    placeholder: 'e.g. LAB-102',
    required: true,
    maxlength: 32
  });
  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    value: room?.name || '',
    placeholder: 'e.g. Server Rack Room',
    required: true,
    maxlength: 80
  });
  const buildingInput = el('input', {
    class: 'input',
    type: 'text',
    value: room?.building || '',
    placeholder: 'e.g. Main Building',
    maxlength: 80
  });
  const floorInput = el('input', {
    class: 'input',
    type: 'text',
    value: room?.floor || '',
    placeholder: 'e.g. Floor 2',
    maxlength: 40
  });
  const descInput = el('textarea', {
    class: 'textarea',
    value: room?.description || '',
    placeholder: 'Operational notes, physical zone boundaries, or monitoring purpose...',
    maxlength: 240
  });
  const errBox = el('div', { class: 'form-error', hidden: true });

  const form = el('form', { class: 'stack-md' }, [
    errBox,
    el('div', { class: 'stack-xs' }, [
      el('div', { class: 'kicker', text: 'IDENTITY' }),
      el('div', { class: 'form-grid' }, [
        el('div', { class: 'form-field' }, [
          el('label', { class: 'form-label', text: 'Room Code *' }),
          codeInput,
          el('span', { class: 'form-hint', text: 'Uppercase alphanumeric code (e.g. ROOM-002).' })
        ]),
        el('div', { class: 'form-field' }, [
          el('label', { class: 'form-label', text: 'Room Name *' }),
          nameInput
        ])
      ])
    ]),
    el('div', { class: 'stack-xs' }, [
      el('div', { class: 'kicker', text: 'PHYSICAL LOCATION' }),
      el('div', { class: 'form-grid' }, [
        el('div', { class: 'form-field' }, [
          el('label', { class: 'form-label', text: 'Building / Wing' }),
          buildingInput
        ]),
        el('div', { class: 'form-field' }, [
          el('label', { class: 'form-label', text: 'Floor / Level' }),
          floorInput
        ])
      ])
    ]),
    el('div', { class: 'stack-xs' }, [
      el('div', { class: 'kicker', text: 'NOTES' }),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: 'Operational Description' }),
        descInput
      ])
    ])
  ]);

  const submitBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: isEdit ? 'Save Room' : 'Create Room',
    onClick: async () => {
      errBox.hidden = true;
      const roomCode = codeInput.value.trim().toUpperCase();
      const name = nameInput.value.trim();
      if (!roomCode || !name) {
        errBox.textContent = 'Room Code and Room Name are required.';
        errBox.hidden = false;
        return;
      }
      submitBtn.disabled = true;
      try {
        const payload = {
          room_code: roomCode,
          name,
          building: buildingInput.value.trim(),
          floor: floorInput.value.trim(),
          description: descInput.value.trim()
        };
        if (isEdit) {
          payload.version = room.version;
          await api.updateRoom(room.room_id, payload);
          showToast('Room updated', `${roomCode} · ${name}`, 'success');
        } else {
          await api.createRoom(payload);
          showToast('Room created', `${roomCode} · ${name}`, 'success');
        }
        closeModal();
        if (onSaved) onSaved();
      } catch (err) {
        if (err.status === 409 && err.code === 'VERSION_CONFLICT') {
          errBox.textContent = 'This room was modified in another session. Close this dialog, refresh the list, and retry.';
        } else {
          errBox.textContent = err.message || 'Failed to save room.';
        }
        errBox.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitBtn.click();
  });

  openModal({
    title: isEdit ? `Edit Room · ${room.room_code}` : 'Add Facility Room',
    subtitle: 'Multi-Room Topology',
    body: form,
    actions: [
      el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
      submitBtn
    ]
  });
}

export function renderRoomsListPage({ navigate }) {
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let statusFilter = 'ACTIVE';
  let searchTerm = '';
  let disposed = false;

  const listSlot = el('div');

  const searchInput = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search by room code, name, or building...',
    'aria-label': 'Search rooms'
  });

  let searchDebounce = null;
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.trim();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(load, 220);
  });

  const statusSlot = el('div');
  const clearBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    text: 'Clear filters',
    hidden: true,
    onClick: () => {
      searchTerm = '';
      statusFilter = 'ACTIVE';
      searchInput.value = '';
      renderFilters();
      load();
    }
  });

  function renderFilters() {
    clear(statusSlot);
    statusSlot.appendChild(
      segmentedFilter({
        ariaLabel: 'Room status filter',
        value: statusFilter,
        options: [
          { value: 'ACTIVE', label: 'Active' },
          { value: 'ARCHIVED', label: 'Archived' },
          { value: '', label: 'All' }
        ],
        onChange: (val) => {
          statusFilter = val;
          renderFilters();
          load();
        }
      })
    );
    clearBtn.hidden = !(searchTerm || statusFilter !== 'ACTIVE');
  }

  container.appendChild(
    pageHeader({
      title: 'Rooms',
      description: 'Manage facility rooms, inspect per-room device health and alarms, and organize multi-room deployments.',
      actions: [
        admin
          ? el('button', {
              id: 'add-room-btn',
              type: 'button',
              class: 'btn btn-primary btn-sm',
              onClick: () => openRoomModal({ onSaved: load })
            }, [svgIcon('icon-plus', 14), el('span', { text: 'Add Room' })])
          : null,
        el('button', {
          type: 'button',
          class: 'btn-icon',
          title: 'Refresh rooms',
          'aria-label': 'Refresh rooms',
          onClick: () => load()
        }, [svgIcon('icon-refresh', 15)])
      ]
    })
  );

  container.appendChild(
    el('div', { class: 'card card-compact filter-bar' }, [searchInput, statusSlot, clearBtn])
  );
  container.appendChild(listSlot);

  renderFilters();

  async function load() {
    if (disposed) return;
    clear(listSlot);
    listSlot.appendChild(loadingSkeleton('table', 4));

    try {
      const res = await api.listRooms({ status: statusFilter, search: searchTerm });
      if (disposed) return;
      const rooms = res.rooms || [];

      clear(listSlot);
      listSlot.appendChild(
        renderAdaptiveCollection({
          ariaLabel: 'Facility rooms directory',
          rows: rooms,
          onRowClick: (r) => navigate(`/app/rooms/${encodeURIComponent(r.room_id)}`),
          emptyNode: emptyState({
            icon: 'icon-rooms',
            title: searchTerm ? 'No rooms match your filter' : 'No rooms found in this category',
            message: searchTerm
              ? 'Try clearing your search query or switching between Active and Archived rooms.'
              : 'Create a room to begin assigning controllers and endpoints.',
            actionLabel: admin && !searchTerm ? 'Add Room' : '',
            onAction: admin && !searchTerm ? () => openRoomModal({ onSaved: load }) : null,
            secondaryLabel: searchTerm || statusFilter !== 'ACTIVE' ? 'Clear filters' : '',
            onSecondary:
              searchTerm || statusFilter !== 'ACTIVE'
                ? () => {
                    searchTerm = '';
                    statusFilter = 'ACTIVE';
                    searchInput.value = '';
                    renderFilters();
                    load();
                  }
                : null
          }),
          columns: [
            {
              label: 'Code',
              render: (r) => el('span', { class: 'meta-tag mono', text: r.room_code })
            },
            {
              label: 'Room',
              render: (r) =>
                el('div', { class: 'stack-xs' }, [
                  el('span', { class: 'font-semibold', text: r.name }),
                  r.description ? el('span', { class: 'text-xs text-muted truncate', text: r.description }) : null
                ])
            },
            {
              label: 'Location',
              render: (r) => [r.building, r.floor].filter(Boolean).join(' · ') || '—'
            },
            {
              label: 'Devices',
              className: 'mono tabular-nums',
              render: (r) => {
                const dc = r.device_counts || { online: 0, total: 0 };
                return `${dc.online} / ${dc.total} online`;
              }
            },
            {
              label: 'Alarms',
              className: 'tabular-nums',
              render: (r) =>
                Number(r.active_alarms || 0) > 0
                  ? statusIndicator('WARNING', `${r.active_alarms} active`, { compact: true })
                  : el('span', { class: 'text-muted', text: '0' })
            },
            {
              label: 'Status',
              render: (r) => statusIndicator(r.status || 'ACTIVE', null, { compact: true })
            },
            {
              label: 'Actions',
              align: 'right',
              render: (r) =>
                el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, [
                  el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: 'Open',
                    onClick: (e) => {
                      e.stopPropagation();
                      navigate(`/app/rooms/${encodeURIComponent(r.room_id)}`);
                    }
                  }),
                  admin
                    ? el('button', {
                        type: 'button',
                        class: 'btn btn-ghost btn-sm',
                        text: 'Edit',
                        onClick: (e) => {
                          e.stopPropagation();
                          openRoomModal({ room: r, onSaved: load });
                        }
                      })
                    : null
                ])
            }
          ],
          renderMobileCard: (r) => {
            const dc = r.device_counts || { online: 0, total: 0 };
            return el('article', { class: 'card record-card' }, [
              el('div', { class: 'record-card-head' }, [
                el('div', { class: 'stack-xs' }, [
                  el('span', { class: 'meta-tag mono', text: r.room_code }),
                  el('div', { class: 'font-semibold', text: r.name })
                ]),
                statusIndicator(r.status || 'ACTIVE', null, { compact: true })
              ]),
              el('div', { class: 'record-card-grid' }, [
                el('div', { class: 'record-card-field' }, [
                  el('span', { class: 'record-card-label', text: 'Location' }),
                  el('span', { class: 'text-sm', text: [r.building, r.floor].filter(Boolean).join(' · ') || '—' })
                ]),
                el('div', { class: 'record-card-field' }, [
                  el('span', { class: 'record-card-label', text: 'Devices Online' }),
                  el('span', { class: 'mono text-sm tabular-nums', text: `${dc.online} / ${dc.total}` })
                ]),
                el('div', { class: 'record-card-field' }, [
                  el('span', { class: 'record-card-label', text: 'Active Alarms' }),
                  el('span', { class: 'mono text-sm tabular-nums', text: String(r.active_alarms || 0) })
                ])
              ]),
              el('div', { class: 'record-card-actions' }, [
                el('button', {
                  type: 'button',
                  class: 'btn btn-primary btn-sm',
                  text: 'Open Room',
                  onClick: () => navigate(`/app/rooms/${encodeURIComponent(r.room_id)}`)
                }),
                admin
                  ? el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-sm',
                      text: 'Edit',
                      onClick: () => openRoomModal({ room: r, onSaved: load })
                    })
                  : null
              ])
            ]);
          }
        })
      );
    } catch (err) {
      if (disposed) return;
      clear(listSlot);
      listSlot.appendChild(
        errorPanel({
          title: 'Failed to load rooms',
          message: err.message,
          onRetry: load
        })
      );
    }
  }

  load();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
      clearTimeout(searchDebounce);
    }
  };
}

export function renderRoomDetailPage({ params, navigate }) {
  const roomId = decodeURIComponent(params.roomId);
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let disposed = false;

  const contentSlot = el('div', { class: 'stack-lg' });
  container.appendChild(contentSlot);

  function openMoveDeviceModal(device, allRooms) {
    const activeRooms = allRooms.filter((r) => r.status === 'ACTIVE' && r.room_id !== device.room_id);
    if (!activeRooms.length) {
      showToast('No other active rooms', 'Create another active room before reassigning this device.', 'warning');
      return;
    }
    const select = el(
      'select',
      { class: 'select' },
      activeRooms.map((r) => el('option', { value: r.room_id, text: `${r.room_code} · ${r.name}` }))
    );
    const body = el('div', { class: 'stack-md' }, [
      el('p', {
        class: 'text-sm text-secondary',
        text: `Reassign "${device.name}" (${device.device_id}) to a different room. Historical telemetry, endpoint definitions, and audit records remain preserved.`
      }),
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', text: 'Target Active Room' }),
        select
      ])
    ]);
    const saveBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Move Device',
      onClick: async () => {
        saveBtn.disabled = true;
        try {
          await api.moveDevice(device.device_id, { room_id: select.value, version: device.version });
          showToast('Device moved', `${device.name} reassigned with telemetry history preserved.`, 'success');
          closeModal();
          load();
        } catch (err) {
          showToast('Move failed', err.message, 'error');
          saveBtn.disabled = false;
        }
      }
    });
    openModal({
      title: `Move Device · ${device.name}`,
      subtitle: 'Room Reassignment',
      body,
      actions: [
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
        saveBtn
      ]
    });
  }

  async function load() {
    if (disposed) return;
    clear(contentSlot);
    contentSlot.appendChild(loadingSkeleton('table', 4));

    try {
      const [roomRes, allRoomsRes] = await Promise.all([
        api.getRoom(roomId),
        admin ? api.listRooms({ status: 'ACTIVE' }) : Promise.resolve({ rooms: [] })
      ]);
      if (disposed) return;
      const room = roomRes.room;
      const allRooms = allRoomsRes.rooms || [];
      const devices = room.devices || [];
      const alarms = room.alarms || [];
      const dc = room.device_counts || { online: 0, total: 0, stale: 0, unknown: 0 };

      clear(contentSlot);
      contentSlot.appendChild(
        pageHeader({
          title: room.name,
          description: room.description || 'Managed facility room and assigned controllers.',
          meta: statusIndicator(room.status || 'ACTIVE'),
          actions: [
            el('button', {
              type: 'button',
              class: 'btn btn-ghost btn-sm',
              onClick: () => navigate('/app/rooms')
            }, [svgIcon('icon-arrow-left', 14), el('span', { text: 'All Rooms' })]),
            admin
              ? el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: 'Edit Room',
                  onClick: () => openRoomModal({ room, onSaved: load })
                })
              : null,
            admin && room.status === 'ACTIVE' && room.room_id !== 'room-001'
              ? el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: 'Archive',
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: `Archive ${room.name}?`,
                      message: 'Archiving hides this room from active views. All active devices must be moved or archived first.',
                      confirmLabel: 'Archive Room',
                      danger: true
                    });
                    if (!ok) return;
                    try {
                      await api.archiveRoom(room.room_id);
                      showToast('Room archived', room.room_code, 'success');
                      load();
                    } catch (err) {
                      showToast('Cannot archive room', err.message, 'error');
                    }
                  }
                })
              : null,
            admin && room.status === 'ARCHIVED'
              ? el('button', {
                  type: 'button',
                  class: 'btn btn-primary btn-sm',
                  text: 'Restore Room',
                  onClick: async () => {
                    try {
                      await api.restoreRoom(room.room_id);
                      showToast('Room restored', room.room_code, 'success');
                      load();
                    } catch (err) {
                      showToast('Restore failed', err.message, 'error');
                    }
                  }
                })
              : null
          ]
        })
      );

      // Summary spec card
      contentSlot.appendChild(
        el('div', { class: 'card' }, [
          keyValueList([
            { label: 'Room ID', node: copyableValue(room.room_id, { label: 'Copy room ID' }) },
            { label: 'Room Code', value: room.room_code, mono: true },
            { label: 'Location', value: [room.building, room.floor].filter(Boolean).join(' · ') || 'Not specified' },
            { label: 'Active Devices', value: `${dc.online} online / ${dc.total} total (${dc.stale} stale, ${dc.unknown} unseen)`, mono: true },
            { label: 'Active Alarms', value: String(room.active_alarms || 0), mono: true },
            { label: 'Last Updated', value: formatTimestamp(room.updated_at), mono: true }
          ])
        ])
      );

      // Assigned Devices
      contentSlot.appendChild(
        el('section', { class: 'stack-md' }, [
          el('div', { class: 'row-between' }, [
            el('h2', { class: 'section-title', text: `Assigned Devices (${devices.length})` }),
            admin && room.status === 'ACTIVE'
              ? el('button', {
                  type: 'button',
                  class: 'btn btn-primary btn-sm',
                  onClick: () => navigate(`/app/devices?action=register&room_id=${encodeURIComponent(room.room_id)}`)
                }, [svgIcon('icon-plus', 14), el('span', { text: 'Register Device Here' })])
              : null
          ]),
          renderAdaptiveCollection({
            ariaLabel: 'Assigned room devices',
            rows: devices,
            onRowClick: (d) => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`),
            emptyNode: emptyState({
              icon: 'icon-cpu',
              title: 'No devices assigned to this room',
              message: 'Register a new controller or move an existing device into this room.'
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
              { label: 'Transport', render: (d) => el('span', { class: 'meta-tag mono', text: d.transport }) },
              {
                label: 'Liveness',
                render: (d) => statusIndicator(d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true })
              },
              {
                label: 'Endpoints Fresh',
                className: 'mono text-xs tabular-nums',
                render: (d) => {
                  const eps = d.endpoints || [];
                  return `${eps.filter((e) => e.fresh).length} / ${eps.length}`;
                }
              },
              {
                label: 'Last Seen',
                className: 'mono text-xs text-secondary',
                render: (d) => formatAge(d.last_seen_at)
              },
              {
                label: 'Actions',
                align: 'right',
                render: (d) =>
                  el('div', { class: 'btn-row', style: 'justify-content:flex-end' }, [
                    el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-sm',
                      text: 'Inspect',
                      onClick: (e) => {
                        e.stopPropagation();
                        navigate(`/app/devices/${encodeURIComponent(d.device_id)}`);
                      }
                    }),
                    admin && !d.archived
                      ? el('button', {
                          type: 'button',
                          class: 'btn btn-ghost btn-sm',
                          text: 'Move',
                          onClick: (e) => {
                            e.stopPropagation();
                            openMoveDeviceModal(d, allRooms);
                          }
                        })
                      : null
                  ])
              }
            ],
            renderMobileCard: (d) =>
              el('article', { class: 'card record-card' }, [
                el('div', { class: 'record-card-head' }, [
                  el('div', { class: 'stack-xs' }, [
                    el('div', { class: 'font-semibold', text: d.name }),
                    el('div', { class: 'mono text-xs text-muted', text: d.device_id })
                  ]),
                  statusIndicator(d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true })
                ]),
                el('div', { class: 'record-card-actions' }, [
                  el('button', {
                    type: 'button',
                    class: 'btn btn-primary btn-sm',
                    text: 'Inspect Device',
                    onClick: () => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`)
                  }),
                  admin && !d.archived
                    ? el('button', {
                        type: 'button',
                        class: 'btn btn-secondary btn-sm',
                        text: 'Move Room',
                        onClick: () => openMoveDeviceModal(d, allRooms)
                      })
                    : null
                ])
              ])
          })
        ])
      );

      // Room Alarms section
      if (alarms.length > 0) {
        contentSlot.appendChild(
          el('section', { class: 'card stack-sm' }, [
            el('div', { class: 'card-head' }, [
              el('h2', { class: 'card-title', text: 'Recent Room Alarms' }),
              el('button', {
                type: 'button',
                class: 'btn btn-ghost btn-sm',
                text: 'Manage alarms →',
                onClick: () => navigate('/app/alarms')
              })
            ]),
            el(
              'div',
              { class: 'queue-list' },
              alarms.slice(0, 6).map((a) =>
                el('div', { class: 'queue-item' }, [
                  el('div', { class: 'queue-item-main' }, [
                    el('div', { class: 'row-gap-sm' }, [
                      statusIndicator(a.severity || 'WARNING', null, { compact: true }),
                      statusIndicator(a.state || 'ACTIVE', null, { compact: true })
                    ]),
                    el('div', { class: 'queue-item-title', text: a.title }),
                    el('div', { class: 'queue-item-meta', text: `${a.device_name || a.device_id} · Raised ${formatAge(a.raised_at)}` })
                  ])
                ])
              )
            )
          ])
        );
      }
    } catch (err) {
      if (disposed) return;
      clear(contentSlot);
      contentSlot.appendChild(
        errorPanel({
          title: 'Failed to load room details',
          message: err.message,
          onRetry: load
        })
      );
    }
  }

  load();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
    }
  };
}
