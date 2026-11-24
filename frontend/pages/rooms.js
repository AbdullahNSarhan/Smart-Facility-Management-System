// LCI-SFM Rooms Management (/app/rooms) and Room Detail (/app/rooms/:roomId)

import { api } from '../api.js';
import { isAdmin, showToast, openModal, closeModal, confirmDialog } from '../store.js';
import { el, clear, formatAge } from '../utils.js';
import { renderEndpointWidget } from '../widgets.js';

function openRoomFormModal({ existing = null, onSaved }) {
  const isEdit = Boolean(existing);
  const codeInput = el('input', {
    class: 'input mono',
    type: 'text',
    value: existing?.room_code || '',
    placeholder: 'e.g. LAB-201',
    required: true
  });
  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    value: existing?.name || '',
    placeholder: 'e.g. Server Room West',
    required: true
  });
  const buildingInput = el('input', {
    class: 'input',
    type: 'text',
    value: existing?.building || '',
    placeholder: 'Building A'
  });
  const floorInput = el('input', {
    class: 'input',
    type: 'text',
    value: existing?.floor || '',
    placeholder: 'Floor 2'
  });
  const descInput = el('textarea', {
    class: 'input textarea',
    rows: '3',
    placeholder: 'Optional operational notes'
  }, [existing?.description || '']);
  const errBox = el('div', { class: 'alert alert-error hidden' });

  const form = el('form', { class: 'stack-md' }, [
    errBox,
    el('div', { class: 'form-grid-2' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Room Code *' }),
        codeInput
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Room Name *' }),
        nameInput
      ])
    ]),
    el('div', { class: 'form-grid-2' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Building' }),
        buildingInput
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Floor' }),
        floorInput
      ])
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: 'Description' }),
      descInput
    ])
  ]);

  const submitBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: isEdit ? 'Save Changes' : 'Create Room'
  });

  const handleSave = async () => {
    errBox.classList.add('hidden');
    const payload = {
      room_code: codeInput.value.trim().toUpperCase(),
      name: nameInput.value.trim(),
      building: buildingInput.value.trim(),
      floor: floorInput.value.trim(),
      description: descInput.value.trim()
    };
    if (!payload.room_code || !payload.name) {
      errBox.textContent = 'Room Code and Room Name are required.';
      errBox.classList.remove('hidden');
      return;
    }
    submitBtn.disabled = true;
    try {
      if (isEdit) {
        await api.updateRoom(existing.room_id, { ...payload, version: existing.version });
        showToast('Room updated', `${payload.name} (${payload.room_code}) saved.`, 'success');
      } else {
        await api.createRoom(payload);
        showToast('Room created', `${payload.name} (${payload.room_code}) added.`, 'success');
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
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSave();
  });

  openModal({
    title: isEdit ? `Edit Room · ${existing.name}` : 'Create Facility Room',
    subtitle: 'Dynamic Multi-Room Topology',
    body: form,
    actions: [
      el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
      submitBtn
    ]
  });
}

export function renderRoomsListPage({ navigate }) {
  const root = el('div', { class: 'stack-lg' });
  let showArchived = false;
  let searchQuery = '';

  const searchInput = el('input', {
    type: 'search',
    class: 'input input-sm',
    placeholder: 'Search rooms by code, name, building...',
    onInput: (e) => {
      searchQuery = e.target.value.trim();
      loadRooms();
    }
  });

  const archivedToggle = el('label', { class: 'checkbox-inline' }, [
    el('input', {
      type: 'checkbox',
      onChange: (e) => {
        showArchived = e.target.checked;
        loadRooms();
      }
    }),
    el('span', { text: 'Show archived' })
  ]);

  const toolbar = el('div', { class: 'section-toolbar' }, [
    el('div', { class: 'filter-row' }, [searchInput, archivedToggle]),
    el('div', { class: 'toolbar-actions' }, [
      el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Refresh', onClick: () => loadRooms() }),
      isAdmin()
        ? el('button', {
            type: 'button',
            id: 'create-room-btn',
            class: 'btn btn-primary btn-sm',
            text: '+ Create Room',
            onClick: () => openRoomFormModal({ onSaved: loadRooms })
          })
        : null
    ])
  ]);
  root.appendChild(toolbar);

  const tableHost = el('div', { class: 'card table-card' });
  root.appendChild(tableHost);

  const loadRooms = async () => {
    try {
      const res = await api.listRooms({ include_archived: showArchived, search: searchQuery });
      const items = res.rooms || res.items || [];
      clear(tableHost);

      if (items.length === 0) {
        tableHost.appendChild(
          el('div', { class: 'empty-state' }, [
            el('p', { class: 'text-secondary', text: 'No rooms match the current filter.' })
          ])
        );
        return;
      }

      const tbody = el('tbody');
      for (const room of items) {
        const isArchived = room.status === 'ARCHIVED';
        const actionsCell = el('td', { class: 'actions-cell' }, [
          el('button', {
            type: 'button',
            class: 'btn btn-secondary btn-xs',
            text: 'Open',
            onClick: () => navigate(`/app/rooms/${encodeURIComponent(room.room_id)}`)
          })
        ]);

        if (isAdmin()) {
          actionsCell.appendChild(
            el('button', {
              type: 'button',
              class: 'btn btn-secondary btn-xs',
              text: 'Edit',
              onClick: () => openRoomFormModal({ existing: room, onSaved: loadRooms })
            })
          );
          if (!isArchived) {
            actionsCell.appendChild(
              el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-xs',
                text: 'Archive',
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: `Archive Room ${room.room_code}?`,
                    message: 'Archiving is blocked while active devices remain assigned to this room. Historical telemetry and alarms are preserved.',
                    confirmLabel: 'Archive Room',
                    danger: true
                  });
                  if (!ok) return;
                  try {
                    await api.archiveRoom(room.room_id);
                    showToast('Room archived', `${room.name} archived.`, 'info');
                    loadRooms();
                  } catch (err) {
                    showToast('Archive blocked', err.message, 'error');
                  }
                }
              })
            );
          } else {
            actionsCell.appendChild(
              el('button', {
                type: 'button',
                class: 'btn btn-primary btn-xs',
                text: 'Restore',
                onClick: async () => {
                  try {
                    await api.restoreRoom(room.room_id);
                    showToast('Room restored', `${room.name} is active again.`, 'success');
                    loadRooms();
                  } catch (err) {
                    showToast('Restore failed', err.message, 'error');
                  }
                }
              })
            );
          }
        }

        tbody.appendChild(
          el('tr', {}, [
            el('td', { class: 'mono' }, [
              el('button', {
                type: 'button',
                class: 'link-title mono',
                text: room.room_code,
                onClick: () => navigate(`/app/rooms/${encodeURIComponent(room.room_id)}`)
              })
            ]),
            el('td', {}, [
              el('div', { class: 'cell-primary', text: room.name }),
              room.description ? el('div', { class: 'cell-sub', text: room.description }) : null
            ]),
            el('td', { text: [room.building, room.floor].filter(Boolean).join(' / ') || '—' }),
            el('td', { class: 'tabular-nums', text: `${room.online_device_count ?? 0} / ${room.device_count ?? 0}` }),
            el('td', { class: 'tabular-nums', text: String(room.active_alarm_count ?? 0) }),
            el('td', {}, [
              el('div', { class: 'status-inline' }, [
                el('span', { class: `status-dot ${isArchived ? 'dot-muted' : 'dot-ok'}` }),
                el('span', { text: room.status })
              ])
            ]),
            actionsCell
          ])
        );
      }

      tableHost.appendChild(
        el('div', { class: 'table-scroll' }, [
          el('table', { class: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Code' }),
                el('th', { text: 'Room' }),
                el('th', { text: 'Location' }),
                el('th', { text: 'Devices (Online/Total)' }),
                el('th', { text: 'Active Alarms' }),
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

  loadRooms();
  return { node: root };
}

export function renderRoomDetailPage({ params, navigate }) {
  const roomId = decodeURIComponent(params.roomId || '');
  const root = el('div', { class: 'stack-lg' });
  const headerHost = el('div');
  const devicesHost = el('div', { class: 'stack-md' });
  const alarmsHost = el('div', { class: 'stack-sm' });

  root.appendChild(headerHost);
  root.appendChild(
    el('div', { class: 'overview-split' }, [
      el('section', { class: 'stack-md' }, [
        el('div', { class: 'section-toolbar' }, [
          el('h3', { class: 'card-title', text: 'Assigned Devices & Live Endpoints' }),
          isAdmin()
            ? el('button', {
                type: 'button',
                class: 'btn btn-primary btn-sm',
                text: '+ Register Device',
                onClick: () => navigate(`/app/devices?room_id=${encodeURIComponent(roomId)}&action=new`)
              })
            : null
        ]),
        devicesHost
      ]),
      el('section', { class: 'stack-md' }, [
        el('h3', { class: 'card-title', text: 'Room Alarms' }),
        alarmsHost
      ])
    ])
  );

  const openMoveModal = async (device, currentRooms) => {
    const select = el(
      'select',
      { class: 'input' },
      currentRooms
        .filter((r) => r.status === 'ACTIVE')
        .map((r) =>
          el('option', {
            value: r.room_id,
            selected: r.room_id === device.room_id,
            text: `${r.room_code} — ${r.name}`
          })
        )
    );
    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Move Device' });
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        await api.moveDevice(device.device_id, select.value, device.version);
        showToast('Device moved', `${device.name} reassigned without losing historical telemetry.`, 'success');
        closeModal();
        loadRoom();
      } catch (err) {
        showToast('Move failed', err.message, 'error');
        saveBtn.disabled = false;
      }
    });

    openModal({
      title: `Move Device · ${device.name}`,
      subtitle: 'Reassign Room (Preserves All History)',
      body: el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Destination Room' }),
        select
      ]),
      actions: [
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
        saveBtn
      ]
    });
  };

  const loadRoom = async () => {
    try {
      const [roomRes, devRes, alarmRes, allRoomsRes] = await Promise.all([
        api.getRoom(roomId),
        api.listDevices({ room_id: roomId, include_archived: false }),
        api.listAlarms({ room_id: roomId, limit: 25 }),
        api.listRooms({ include_archived: false })
      ]);
      const room = roomRes.room || roomRes;
      const devices = devRes.devices || roomRes.devices || [];
      const alarms = alarmRes.alarms || roomRes.alarms || [];
      const allRooms = allRoomsRes.rooms || allRoomsRes.items || [];

      clear(headerHost);
      headerHost.appendChild(
        el('div', { class: 'card detail-hero-card' }, [
          el('div', { class: 'section-toolbar' }, [
            el('div', {}, [
              el('div', { class: 'mono text-muted', text: `${room.room_code} · ${room.status}` }),
              el('h2', { class: 'section-title', text: room.name }),
              el('p', {
                class: 'text-secondary',
                text: [room.building, room.floor, room.description].filter(Boolean).join(' · ') || 'Managed facility room'
              })
            ]),
            el('div', { class: 'toolbar-actions' }, [
              el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Refresh', onClick: loadRoom }),
              isAdmin()
                ? el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: 'Edit Room',
                    onClick: () => openRoomFormModal({ existing: room, onSaved: loadRoom })
                  })
                : null
            ])
          ])
        ])
      );

      clear(devicesHost);
      if (devices.length === 0) {
        devicesHost.appendChild(
          el('div', { class: 'card empty-state' }, [
            el('p', { class: 'text-secondary', text: 'No devices assigned to this room yet.' })
          ])
        );
      } else {
        for (const dev of devices) {
          const isOnline = dev.connectivity === 'ONLINE' || dev.fresh;
          const devCard = el('article', { class: 'card stack-md' }, [
            el('div', { class: 'section-toolbar' }, [
              el('div', {}, [
                el('button', {
                  type: 'button',
                  class: 'link-title',
                  text: dev.name,
                  onClick: () => navigate(`/app/devices/${encodeURIComponent(dev.device_id)}`)
                }),
                el('div', {
                  class: 'mono text-muted',
                  text: `${dev.device_id} · ${dev.transport}${dev.ip ? ` · ${dev.ip}:${dev.port}` : ' · MQTT broker'}`
                })
              ]),
              el('div', { class: 'toolbar-actions' }, [
                el('div', { class: 'status-inline' }, [
                  el('span', { class: `status-dot ${isOnline ? 'dot-ok' : 'dot-muted'}` }),
                  el('span', { text: dev.connectivity || (isOnline ? 'ONLINE' : 'OFFLINE') })
                ]),
                isAdmin()
                  ? el('button', {
                      type: 'button',
                      class: 'btn btn-secondary btn-xs',
                      text: 'Move',
                      onClick: () => openMoveModal(dev, allRooms)
                    })
                  : null,
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-xs',
                  text: 'Inspect',
                  onClick: () => navigate(`/app/devices/${encodeURIComponent(dev.device_id)}`)
                })
              ])
            ]),
            el(
              'div',
              { class: 'endpoint-grid' },
              (dev.endpoints || []).map((ep) => renderEndpointWidget(dev, ep, { navigate, onRefresh: loadRoom }))
            )
          ]);
          devicesHost.appendChild(devCard);
        }
      }

      clear(alarmsHost);
      if (alarms.length === 0) {
        alarmsHost.appendChild(
          el('div', { class: 'card empty-state' }, [
            el('p', { class: 'text-secondary', text: 'No active alarms in this room.' })
          ])
        );
      } else {
        for (const alarm of alarms) {
          const dot = alarm.severity === 'CRITICAL' ? 'dot-crit' : 'dot-warn';
          alarmsHost.appendChild(
            el('div', { class: 'card alarm-mini-card' }, [
              el('div', { class: 'card-head' }, [
                el('div', { class: 'status-inline' }, [
                  el('span', { class: `status-dot ${dot}` }),
                  el('strong', { text: alarm.title || alarm.rule_id })
                ]),
                el('span', { class: 'mono text-muted tabular-nums', text: formatAge(alarm.opened_at) })
              ]),
              el('div', { class: 'text-secondary', text: alarm.message || `${alarm.device_id} · ${alarm.endpoint_key}` }),
              el('div', { class: 'mono text-muted', text: `${alarm.state} · ${alarm.severity}` })
            ])
          );
        }
      }
    } catch (err) {
      clear(headerHost);
      headerHost.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
    }
  };

  loadRoom();
  return { node: root };
}
