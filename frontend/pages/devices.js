// LCI-SFM Devices Registry, Guided 4-Step Wizard, Device Detail & Endpoint History
// Preserves truthful protocol boundaries (MQTT_V1 broker-mediated, manifest drift detection, per-endpoint freshness).

import { api } from '../api.js';
import { isAdmin, showToast, openModal, closeModal, confirmDialog, onLiveEvent } from '../store.js';
import {
  el,
  clear,
  svgIcon,
  formatAge,
  formatTimestamp,
  formatEndpointValue,
  buildHistoryChartSvg,
  exportRowsToCsv
} from '../utils.js';
import { renderEndpointWidget } from '../widgets.js';
import {
  pageHeader,
  statusIndicator,
  loadingSkeleton,
  emptyState,
  errorPanel,
  disclaimerBanner,
  copyableValue,
  keyValueList,
  renderAdaptiveCollection,
  segmentedFilter
} from '../components/ui.js';

const KIND_TO_DATA_TYPES = {
  SENSOR: ['NUMBER', 'BOOLEAN'],
  SWITCH: ['ENUM', 'BOOLEAN'],
  ACCESS: ['ENUM'],
  CAMERA: ['MEDIA']
};

function isPrivateNodeIPv4(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    return octet <= 255 ? octet : null;
  });
  if (octets.some((octet) => octet === null)) return false;
  const [a, b, , d] = octets;
  return (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) && d !== 0 && d !== 255;
}

const TRANSPORT_HELP = {
  MQTT_V1:
    'Broker-mediated telemetry and confirmed switching via lci/v1/devices/<id>/*. No direct device IP is required; provision broker credentials on the host with provision-mqtt-device.sh.',
  HTTP_JSON_V1:
    'Manual bounded JSON telemetry probe against a registered private LAN IPv4 address. Registering an IP sets the server destination only and does not configure the physical device NIC.',
  CAMERA_JPEG:
    'Authenticated backend JPEG snapshot proxy against a registered private LAN camera IPv4 address. Registering an IP does not modify camera hardware settings.',
  LEGACY_V1:
    'Built-in baseline node protocol profile. Endpoint schema and transport remain locked for compatibility.'
};

// ============================================================================
// GUIDED 4-STEP DEVICE REGISTRATION / EDIT WIZARD
// ============================================================================
function openDeviceWizard({ device = null, pending = null, rooms = [], defaultRoomId = '', capabilities = [], onSaved }) {
  const isEdit = Boolean(device);
  const isLegacy = Boolean(device?.slot);
  const activeRooms = rooms.filter((r) => r.status === 'ACTIVE' || r.room_id === device?.room_id);

  const capMap = new Map();
  if (Array.isArray(capabilities) && capabilities.length) {
    for (const c of capabilities) {
      if (!capMap.has(c.capability)) capMap.set(c.capability, []);
      if (!capMap.get(c.capability).includes(c.data_type)) capMap.get(c.capability).push(c.data_type);
    }
  }
  const allowedDataTypes = (kind) => capMap.get(kind) || KIND_TO_DATA_TYPES[kind] || ['NUMBER'];

  // Wizard mutable state
  const state = {
    step: 0, // 0: Identity, 1: Transport, 2: Endpoints, 3: Review
    device_id: device?.device_id || pending?.device_id || '',
    name: device?.name || (pending ? `Node ${pending.device_id}` : ''),
    description: device?.description || '',
    room_id: device?.room_id || defaultRoomId || activeRooms[0]?.room_id || 'room-001',
    device_type: device?.device_type || 'MIXED',
    enabled: device ? Boolean(device.enabled) : true,
    transport: device?.transport || 'MQTT_V1',
    ip: device?.ip || '',
    port: Number(device?.port || 80),
    path: device?.path || '/telemetry',
    stale_after_s: Number(device?.stale_after_s || 90),
    endpoints:
      device?.endpoints?.length
        ? device.endpoints.map((e) => ({
            endpoint_key: e.endpoint_key,
            label: e.label,
            kind: e.kind,
            data_type: e.data_type || allowedDataTypes(e.kind)[0],
            unit: e.unit || '',
            writable: Boolean(e.writable)
          }))
        : pending?.manifest?.endpoints?.length
          ? pending.manifest.endpoints.map((e) => ({
              endpoint_key: e.endpoint_key || 'sensor_1',
              label: e.label || e.endpoint_key || 'Sensor 1',
              kind: e.kind || 'SENSOR',
              data_type: e.data_type || allowedDataTypes(e.kind || 'SENSOR')[0],
              unit: e.unit || '',
              writable: Boolean(e.writable)
            }))
          : [{ endpoint_key: 'temperature', label: 'Temperature', kind: 'SENSOR', data_type: 'NUMBER', unit: '°C', writable: false }]
  };

  const stepLabels = ['Identity', 'Transport', 'Endpoints', 'Review'];
  const root = el('div', { class: 'stack-md' });
  const stepperEl = el('div', { class: 'wizard-steps' });
  const errBox = el('div', { class: 'form-error', hidden: true });
  const stepBody = el('div', { class: 'stack-md' });

  root.append(stepperEl, errBox, stepBody);

  const backBtn = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Back' });
  const nextBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Next' });

  function showError(msg) {
    errBox.textContent = msg;
    errBox.hidden = false;
  }
  function clearError() {
    errBox.hidden = true;
    errBox.textContent = '';
  }

  function validateStep(stepIdx) {
    clearError();
    if (stepIdx === 0) {
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(state.device_id)) {
        showError('Device ID must start with a lowercase letter and contain 1–48 lowercase letters, digits, hyphens, or underscores.');
        return false;
      }
      if (!state.name.trim()) {
        showError('Display Name is required.');
        return false;
      }
      if (!state.room_id) {
        showError('Select an active room.');
        return false;
      }
    } else if (stepIdx === 1) {
      if (state.transport !== 'MQTT_V1') {
        const ip = state.ip.trim();
        if (!ip) {
          showError('A private LAN IPv4 address is required for HTTP_JSON_V1, CAMERA_JPEG, or LEGACY_V1 transports.');
          return false;
        }
        if (!isPrivateNodeIPv4(ip)) {
          showError('Use a valid private unicast LAN IPv4 address (RFC1918); network and broadcast addresses are not allowed.');
        }
      }
      if (!Number.isInteger(state.stale_after_s) || state.stale_after_s < 5 || state.stale_after_s > 3600) {
        showError('Stale timeout must be a whole number between 5 and 3600 seconds.');
        return false;
      }
    } else if (stepIdx === 2) {
      if (!state.endpoints.length) {
        showError('Define at least one endpoint.');
        return false;
      }
      const seen = new Set();
      for (const ep of state.endpoints) {
        if (!/^[a-z][a-z0-9_-]{0,47}$/.test(ep.endpoint_key)) {
          showError(`Invalid endpoint key "${ep.endpoint_key}". Start with a lowercase letter and use 1–48 lowercase letters, digits, hyphens, or underscores.`);
          return false;
        }
        if (seen.has(ep.endpoint_key)) {
          showError(`Duplicate endpoint key "${ep.endpoint_key}".`);
          return false;
        }
        seen.add(ep.endpoint_key);
        if (!ep.label.trim()) {
          showError(`Endpoint "${ep.endpoint_key}" requires a display label.`);
          return false;
        }
        if (!allowedDataTypes(ep.kind).includes(ep.data_type)) {
          showError(`Data type ${ep.data_type} is incompatible with ${ep.kind}.`);
          return false;
        }
      }
    }
    return true;
  }

  function renderStepper() {
    clear(stepperEl);
    stepLabels.forEach((lbl, idx) => {
      const cls = idx === state.step ? 'wizard-step active' : idx < state.step ? 'wizard-step done' : 'wizard-step';
      stepperEl.appendChild(
        el('div', { class: cls }, [
          el('span', { class: 'wizard-step-num', text: String(idx + 1) }),
          el('span', { text: lbl })
        ])
      );
    });
  }

  function renderCurrentStep() {
    renderStepper();
    clear(stepBody);
    backBtn.hidden = state.step === 0;
    nextBtn.textContent = state.step === 3 ? (isEdit ? 'Save Device' : 'Register Device') : 'Continue';

    if (state.step === 0) {
      const idInput = el('input', {
        id: 'wiz-device-id',
        class: 'input mono',
        type: 'text',
        value: state.device_id,
        disabled: isEdit,
        placeholder: 'e.g. lab2-env-node'
      });
      idInput.addEventListener('input', () => {
        state.device_id = idInput.value.trim().toLowerCase();
      });

      const nameInput = el('input', {
        id: 'wiz-device-name',
        class: 'input',
        type: 'text',
        value: state.name,
        placeholder: 'e.g. Lab 2 Environmental Sensor'
      });
      nameInput.addEventListener('input', () => {
        state.name = nameInput.value;
      });

      const roomSelect = el(
        'select',
        { id: 'wiz-device-room', class: 'select' },
        activeRooms.map((r) =>
          el('option', {
            value: r.room_id,
            text: `${r.room_code} · ${r.name}`,
            selected: r.room_id === state.room_id
          })
        )
      );
      roomSelect.addEventListener('change', () => {
        state.room_id = roomSelect.value;
      });

      const typeSelect = el(
        'select',
        { id: 'wiz-device-type', class: 'select', disabled: isLegacy },
        ['SENSORS', 'CAMERA', 'ACCESS', 'RELAY', 'MIXED'].map((t) =>
          el('option', { value: t, text: t, selected: t === state.device_type })
        )
      );
      typeSelect.addEventListener('change', () => {
        state.device_type = typeSelect.value;
      });

      const descInput = el('textarea', {
        class: 'textarea',
        value: state.description,
        placeholder: 'Physical mounting location or controller purpose...'
      });
      descInput.addEventListener('input', () => {
        state.description = descInput.value;
      });

      const enabledCb = el('input', { type: 'checkbox', checked: state.enabled });
      enabledCb.addEventListener('change', () => {
        state.enabled = enabledCb.checked;
      });

      stepBody.append(
        el('div', { class: 'form-grid' }, [
          el('div', { class: 'form-field' }, [
            el('label', { class: 'form-label', for: 'wiz-device-id', text: 'Device ID * (Immutable)' }),
            idInput,
            el('span', { class: 'form-hint', text: 'Lowercase slug used in MQTT topics and audit logs.' })
          ]),
          el('div', { class: 'form-field' }, [
            el('label', { class: 'form-label', for: 'wiz-device-name', text: 'Display Name *' }),
            nameInput
          ]),
          el('div', { class: 'form-field' }, [
            el('label', { class: 'form-label', for: 'wiz-device-room', text: 'Assigned Room *' }),
            roomSelect
          ]),
          el('div', { class: 'form-field' }, [
            el('label', { class: 'form-label', for: 'wiz-device-type', text: 'Device Type' }),
            typeSelect
          ]),
          el('div', { class: 'form-field form-field-full' }, [
            el('label', { class: 'form-label', text: 'Description' }),
            descInput
          ]),
          el('div', { class: 'form-field form-field-full' }, [
            el('label', { class: 'checkbox-row' }, [
              enabledCb,
              el('span', { text: 'Enable monitoring and ingestion for this device' })
            ])
          ])
        ])
      );
    } else if (state.step === 1) {
      const transportOptions = isLegacy ? ['LEGACY_V1'] : ['MQTT_V1', 'HTTP_JSON_V1', 'CAMERA_JPEG'];
      const transportSelect = el(
        'select',
        { id: 'wiz-device-transport', class: 'select', disabled: isLegacy },
        transportOptions.map((t) => el('option', { value: t, text: t, selected: t === state.transport }))
      );
      transportSelect.addEventListener('change', () => {
        state.transport = transportSelect.value;
        if (state.transport === 'MQTT_V1') {
          state.ip = '';
        } else if (state.transport === 'CAMERA_JPEG' && (!state.path || state.path === '/telemetry')) {
          state.path = '/capture.jpg';
        }
        renderCurrentStep();
      });

      const staleInput = el('input', {
        id: 'wiz-device-stale',
        class: 'input mono',
        type: 'number',
        min: 5,
        max: 3600,
        value: String(state.stale_after_s)
      });
      staleInput.addEventListener('input', () => {
        state.stale_after_s = Number(staleInput.value || 90);
      });

      const needsIp = state.transport !== 'MQTT_V1';
      const ipInput = el('input', {
        id: 'wiz-device-ip',
        class: 'input mono',
        type: 'text',
        value: state.ip,
        placeholder: '192.168.43.25'
      });
      ipInput.addEventListener('input', () => {
        state.ip = ipInput.value.trim();
      });

      const portInput = el('input', {
        id: 'wiz-device-port',
        class: 'input mono',
        type: 'number',
        min: 1,
        max: 65535,
        value: String(state.port)
      });
      portInput.addEventListener('input', () => {
        state.port = Number(portInput.value || 80);
      });

      const pathInput = el('input', {
        id: 'wiz-device-path',
        class: 'input mono',
        type: 'text',
        value: state.path,
        placeholder: state.transport === 'CAMERA_JPEG' ? '/capture.jpg' : '/telemetry'
      });
      pathInput.addEventListener('input', () => {
        state.path = pathInput.value.trim() || '/telemetry';
      });

      stepBody.append(
        disclaimerBanner({
          icon: 'icon-info',
          tone: 'info',
          title: `Transport: ${state.transport}`,
          message: TRANSPORT_HELP[state.transport] || ''
        }),
        el('div', { class: 'form-grid' }, [
          el('div', { class: 'form-field' }, [
            el('label', { class: 'form-label', for: 'wiz-device-transport', text: 'Protocol Adapter *' }),
            transportSelect
          ]),
          el('div', { class: 'form-field' }, [
            el('label', { class: 'form-label', for: 'wiz-device-stale', text: 'Stale Timeout (seconds) *' }),
            staleInput,
            el('span', { class: 'form-hint', text: 'Allowed by the server: 5–3600 seconds. Older endpoint observations become STALE.' })
          ]),
          needsIp
            ? el('div', { class: 'form-field' }, [
                el('label', { class: 'form-label', for: 'wiz-device-ip', text: 'Private LAN IPv4 *' }),
                ipInput
              ])
            : null,
          needsIp
            ? el('div', { class: 'form-field' }, [
                el('label', { class: 'form-label', for: 'wiz-device-port', text: 'HTTP Port' }),
                portInput
              ])
            : null,
          needsIp
            ? el('div', { class: 'form-field form-field-full' }, [
                el('label', { class: 'form-label', for: 'wiz-device-path', text: 'HTTP Path' }),
                pathInput
              ])
            : null
        ])
      );
    } else if (state.step === 2) {
      stepBody.append(
        disclaimerBanner({
          icon: 'icon-info',
          tone: 'info',
          title: 'Capability & Data-Type Contract',
          message:
            'Supported built-in capabilities are SENSOR (NUMBER/BOOLEAN), SWITCH (ENUM/BOOLEAN), ACCESS (ENUM), and CAMERA (MEDIA). New custom hardware protocols require a dedicated adapter.'
        })
      );

      const listWrap = el('div', { class: 'stack-sm' });
      state.endpoints.forEach((ep, idx) => {
        const keyIn = el('input', {
          class: 'input mono',
          type: 'text',
          value: ep.endpoint_key,
          disabled: isLegacy,
          placeholder: 'endpoint_key'
        });
        keyIn.addEventListener('input', () => {
          ep.endpoint_key = keyIn.value.trim().toLowerCase();
        });

        const lblIn = el('input', {
          class: 'input',
          type: 'text',
          value: ep.label,
          placeholder: 'Display label'
        });
        lblIn.addEventListener('input', () => {
          ep.label = lblIn.value;
        });

        const kindSel = el(
          'select',
          { class: 'select', disabled: isLegacy },
          ['SENSOR', 'SWITCH', 'ACCESS', 'CAMERA'].map((k) =>
            el('option', { value: k, text: k, selected: k === ep.kind })
          )
        );
        kindSel.addEventListener('change', () => {
          ep.kind = kindSel.value;
          const validTypes = allowedDataTypes(ep.kind);
          if (!validTypes.includes(ep.data_type)) ep.data_type = validTypes[0];
          if (ep.kind !== 'SWITCH') ep.writable = false;
          renderCurrentStep();
        });

        const dtOptions = allowedDataTypes(ep.kind);
        const dtSel = el(
          'select',
          { class: 'select', disabled: isLegacy },
          dtOptions.map((dt) => el('option', { value: dt, text: dt, selected: dt === ep.data_type }))
        );
        dtSel.addEventListener('change', () => {
          ep.data_type = dtSel.value;
        });

        const unitIn = el('input', {
          class: 'input',
          type: 'text',
          value: ep.unit || '',
          disabled: ep.data_type !== 'NUMBER',
          placeholder: ep.data_type === 'NUMBER' ? 'Unit' : '—'
        });
        unitIn.addEventListener('input', () => {
          ep.unit = unitIn.value.trim();
        });

        const writableCb = el('input', {
          type: 'checkbox',
          checked: Boolean(ep.writable),
          disabled: isLegacy || ep.kind !== 'SWITCH'
        });
        writableCb.addEventListener('change', () => {
          ep.writable = writableCb.checked;
        });

        listWrap.appendChild(
          el('div', { class: 'endpoint-editor-row' }, [
            keyIn,
            lblIn,
            kindSel,
            dtSel,
            unitIn,
            el('label', { class: 'checkbox-row text-xs', title: 'Writable MQTT switch output' }, [
              writableCb,
              el('span', { text: 'Write' })
            ]),
            !isLegacy
              ? el('button', {
                  type: 'button',
                  class: 'btn-icon',
                  title: 'Remove endpoint',
                  'aria-label': 'Remove endpoint',
                  disabled: state.endpoints.length <= 1,
                  onClick: () => {
                    state.endpoints.splice(idx, 1);
                    renderCurrentStep();
                  }
                }, [svgIcon('icon-close', 14)])
              : null
          ])
        );
      });

      stepBody.appendChild(listWrap);
      if (!isLegacy) {
        stepBody.appendChild(
          el('div', {}, [
            el('button', {
              type: 'button',
              class: 'btn btn-secondary btn-sm',
              onClick: () => {
                state.endpoints.push({
                  endpoint_key: `endpoint_${state.endpoints.length + 1}`,
                  label: `Endpoint ${state.endpoints.length + 1}`,
                  kind: 'SENSOR',
                  data_type: 'NUMBER',
                  unit: '',
                  writable: false
                });
                renderCurrentStep();
              }
            }, [svgIcon('icon-plus', 14), el('span', { text: 'Add Endpoint' })])
          ])
        );
      }
    } else if (state.step === 3) {
      const chosenRoom = activeRooms.find((r) => r.room_id === state.room_id);
      stepBody.append(
        el('div', { class: 'card card-compact' }, [
          keyValueList([
            { label: 'Device ID', value: state.device_id, mono: true },
            { label: 'Display Name', value: state.name },
            { label: 'Assigned Room', value: chosenRoom ? `${chosenRoom.room_code} · ${chosenRoom.name}` : state.room_id },
            { label: 'Device Type', value: state.device_type, mono: true },
            { label: 'Transport', value: state.transport, mono: true },
            {
              label: 'Network Address',
              value: state.transport === 'MQTT_V1' ? 'Broker-mediated (no direct IP)' : `${state.ip}:${state.port}${state.path}`,
              mono: true
            },
            { label: 'Stale Timeout', value: `${state.stale_after_s} s`, mono: true },
            { label: 'Monitoring Enabled', value: state.enabled ? 'Yes' : 'No (Disabled)' }
          ])
        ]),
        el('div', { class: 'card card-compact stack-xs' }, [
          el('div', { class: 'kicker', text: `ENDPOINTS (${state.endpoints.length})` }),
          ...state.endpoints.map((ep) =>
            el('div', { class: 'row-between text-sm' }, [
              el('span', { class: 'mono', text: `${ep.endpoint_key} (${ep.label})` }),
              el('span', {
                class: 'text-xs text-secondary mono',
                text: `${ep.kind}/${ep.data_type}${ep.unit ? ` · ${ep.unit}` : ''}${ep.writable ? ' · WRITABLE' : ''}`
              })
            ])
          )
        ])
      );
    }
  }

  backBtn.addEventListener('click', () => {
    clearError();
    if (state.step > 0) {
      state.step -= 1;
      renderCurrentStep();
    }
  });

  nextBtn.addEventListener('click', async () => {
    if (state.step < 3) {
      if (!validateStep(state.step)) return;
      state.step += 1;
      renderCurrentStep();
      return;
    }

    nextBtn.disabled = true;
    clearError();
    try {
      const payload = {
        device_id: state.device_id,
        name: state.name.trim(),
        description: state.description.trim(),
        room_id: state.room_id,
        device_type: state.device_type,
        transport: state.transport,
        ip: state.transport === 'MQTT_V1' ? '' : state.ip.trim(),
        port: Number(state.port || 80),
        path: state.path || '/telemetry',
        enabled: Boolean(state.enabled),
        stale_after_s: Number(state.stale_after_s || 90),
        endpoints: state.endpoints.map((ep) => ({
          endpoint_key: ep.endpoint_key,
          label: ep.label.trim(),
          kind: ep.kind,
          data_type: ep.data_type,
          unit: ep.data_type === 'NUMBER' ? ep.unit || '' : '',
          writable: ep.kind === 'SWITCH' ? Boolean(ep.writable) : false
        }))
      };
      if (isEdit) {
        payload.version = device.version;
        await api.updateDevice(device.device_id, payload);
        showToast('Device updated', `${payload.name} (${payload.device_id})`, 'success');
      } else {
        await api.createDevice(payload);
        showToast('Device registered', `${payload.name} (${payload.device_id})`, 'success');
      }
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      if (err.status === 409 && err.code === 'VERSION_CONFLICT') {
        showError('This device was updated in another session. Close this wizard, refresh, and try again.');
      } else {
        showError(err.message || 'Failed to save device.');
      }
    } finally {
      nextBtn.disabled = false;
    }
  });

  renderCurrentStep();

  openModal({
    title: isEdit ? `Edit Device · ${device.name}` : pending ? `Approve Quarantined Device · ${pending.device_id}` : 'Register Device',
    subtitle: 'Guided 4-Step Device Registry Wizard',
    wide: true,
    body: root,
    actions: [
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel', onClick: closeModal }),
      backBtn,
      nextBtn
    ]
  });
}

// ============================================================================
// DEVICES LIST PAGE (/app/devices)
// ============================================================================
export function renderDevicesListPage({ query, navigate }) {
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let disposed = false;

  let searchTerm = '';
  let roomFilter = query?.get('room_id') || '';
  let transportFilter = '';
  let includeArchived = false;
  let cachedRooms = [];
  let cachedCaps = [];

  const pendingSlot = el('div');
  const listSlot = el('div');

  const searchInput = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search by device ID, name, or description...',
    'aria-label': 'Search devices'
  });
  const roomSelect = el('select', { class: 'select', 'aria-label': 'Filter by room' });
  const transportSelect = el(
    'select',
    { class: 'select', 'aria-label': 'Filter by transport' },
    [
      el('option', { value: '', text: 'All transports' }),
      el('option', { value: 'MQTT_V1', text: 'MQTT_V1' }),
      el('option', { value: 'HTTP_JSON_V1', text: 'HTTP_JSON_V1' }),
      el('option', { value: 'CAMERA_JPEG', text: 'CAMERA_JPEG' }),
      el('option', { value: 'LEGACY_V1', text: 'LEGACY_V1' })
    ]
  );
  const archivedCb = el('input', { type: 'checkbox', checked: false });
  const clearBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    text: 'Clear filters',
    hidden: true,
    onClick: () => {
      searchTerm = '';
      roomFilter = '';
      transportFilter = '';
      includeArchived = false;
      searchInput.value = '';
      roomSelect.value = '';
      transportSelect.value = '';
      archivedCb.checked = false;
      clearBtn.hidden = true;
      loadDevices();
    }
  });

  const syncClearBtn = () => {
    clearBtn.hidden = !(searchTerm || roomFilter || transportFilter || includeArchived);
  };

  let debounce = null;
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.trim();
    syncClearBtn();
    clearTimeout(debounce);
    debounce = setTimeout(loadDevices, 220);
  });
  roomSelect.addEventListener('change', () => {
    roomFilter = roomSelect.value;
    syncClearBtn();
    loadDevices();
  });
  transportSelect.addEventListener('change', () => {
    transportFilter = transportSelect.value;
    syncClearBtn();
    loadDevices();
  });
  archivedCb.addEventListener('change', () => {
    includeArchived = archivedCb.checked;
    syncClearBtn();
    loadDevices();
  });

  container.appendChild(
    pageHeader({
      title: 'Devices',
      description: 'Register and inspect wired controllers, review quarantined MQTT announcements, and monitor per-device liveness.',
      actions: [
        admin
          ? el('button', {
              id: 'register-device-btn',
              type: 'button',
              class: 'btn btn-primary btn-sm',
              onClick: () =>
                openDeviceWizard({
                  rooms: cachedRooms,
                  defaultRoomId: roomFilter,
                  capabilities: cachedCaps,
                  onSaved: loadAll
                })
            }, [svgIcon('icon-plus', 14), el('span', { text: 'Register Device' })])
          : null,
        el('button', {
          type: 'button',
          class: 'btn-icon',
          title: 'Refresh devices',
          'aria-label': 'Refresh devices',
          onClick: () => loadAll()
        }, [svgIcon('icon-refresh', 15)])
      ]
    })
  );

  container.appendChild(pendingSlot);
  container.appendChild(
    el('div', { class: 'card card-compact filter-bar' }, [
      searchInput,
      roomSelect,
      transportSelect,
      el('label', { class: 'checkbox-row text-sm' }, [archivedCb, el('span', { text: 'Show archived' })]),
      clearBtn
    ])
  );
  container.appendChild(listSlot);

  async function loadDevices() {
    if (disposed) return;
    clear(listSlot);
    listSlot.appendChild(loadingSkeleton('table', 4));

    try {
      const res = await api.listDevices({
        room_id: roomFilter,
        transport: transportFilter,
        search: searchTerm,
        include_archived: includeArchived ? 'true' : ''
      });
      if (disposed) return;
      const devices = res.devices || [];

      clear(listSlot);
      listSlot.appendChild(
        renderAdaptiveCollection({
          ariaLabel: 'Registered devices directory',
          rows: devices,
          onRowClick: (d) => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`),
          emptyNode: emptyState({
            icon: 'icon-cpu',
            title: searchTerm || roomFilter || transportFilter ? 'No matching devices' : 'No devices registered',
            message: 'Register a controller with the 4-step wizard or clear your filters.',
            actionLabel: admin && !searchTerm ? 'Register Device' : '',
            onAction: admin
              ? () => openDeviceWizard({ rooms: cachedRooms, defaultRoomId: roomFilter, capabilities: cachedCaps, onSaved: loadAll })
              : null
          }),
          columns: [
            {
              label: 'Device',
              render: (d) =>
                el('div', { class: 'stack-xs' }, [
                  el('div', { class: 'row-gap-sm' }, [
                    el('span', { class: 'font-semibold', text: d.name }),
                    d.manifest_drift?.has_drift ? statusIndicator('DRIFT', 'Drift', { compact: true }) : null
                  ]),
                  el('span', { class: 'mono text-xs text-muted', text: d.device_id })
                ])
            },
            {
              label: 'Room',
              render: (d) => (d.room_name ? `${d.room_code || ''} · ${d.room_name}` : d.room_id || '—')
            },
            {
              label: 'Transport & Address',
              render: (d) =>
                el('div', { class: 'stack-xs' }, [
                  el('span', { class: 'meta-tag mono', text: d.transport }),
                  el('span', {
                    class: 'mono text-xs text-muted',
                    text: d.transport === 'MQTT_V1' ? 'Broker-mediated (no direct IP)' : d.ip ? `${d.ip}:${d.port || 80}` : 'No IP'
                  })
                ])
            },
            {
              label: 'Status',
              render: (d) =>
                statusIndicator(d.archived ? 'ARCHIVED' : d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true })
            },
            {
              label: 'Endpoints',
              className: 'mono text-xs tabular-nums',
              render: (d) => `${(d.endpoints || []).filter((e) => e.fresh).length}/${(d.endpoints || []).length} fresh`
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
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: 'Inspect',
                  onClick: (e) => {
                    e.stopPropagation();
                    navigate(`/app/devices/${encodeURIComponent(d.device_id)}`);
                  }
                })
            }
          ],
          renderMobileCard: (d) =>
            el('article', { class: 'card record-card' }, [
              el('div', { class: 'record-card-head' }, [
                el('div', { class: 'stack-xs' }, [
                  el('div', { class: 'font-semibold', text: d.name }),
                  el('div', { class: 'mono text-xs text-muted', text: d.device_id })
                ]),
                statusIndicator(d.archived ? 'ARCHIVED' : d.in_maintenance ? 'MAINTENANCE' : d.status, null, { compact: true })
              ]),
              d.manifest_drift?.has_drift ? statusIndicator('DRIFT', 'Manifest Drift Detected', { compact: true }) : null,
              el('div', { class: 'record-card-grid' }, [
                el('div', { class: 'record-card-field' }, [
                  el('span', { class: 'record-card-label', text: 'Room' }),
                  el('span', { class: 'text-sm', text: d.room_name || d.room_code || '—' })
                ]),
                el('div', { class: 'record-card-field' }, [
                  el('span', { class: 'record-card-label', text: 'Transport' }),
                  el('span', { class: 'mono text-xs', text: d.transport })
                ]),
                el('div', { class: 'record-card-field' }, [
                  el('span', { class: 'record-card-label', text: 'Address' }),
                  el('span', {
                    class: 'mono text-xs',
                    text: d.transport === 'MQTT_V1' ? 'Broker-mediated' : d.ip || '—'
                  })
                ]),
                el('div', { class: 'record-card-field' }, [
                  el('span', { class: 'record-card-label', text: 'Last Seen' }),
                  el('span', { class: 'mono text-xs', text: formatAge(d.last_seen_at) })
                ])
              ]),
              el('div', { class: 'record-card-actions' }, [
                el('button', {
                  type: 'button',
                  class: 'btn btn-primary btn-sm',
                  text: 'Inspect Device',
                  onClick: () => navigate(`/app/devices/${encodeURIComponent(d.device_id)}`)
                })
              ])
            ])
        })
      );
    } catch (err) {
      if (disposed) return;
      clear(listSlot);
      listSlot.appendChild(
        errorPanel({
          title: 'Failed to load devices',
          message: err.message,
          onRetry: loadDevices
        })
      );
    }
  }

  async function loadAll() {
    if (disposed) return;
    const [roomsRes, capsRes, pendingRes] = await Promise.allSettled([
      api.listRooms({ status: '' }),
      api.getCapabilities(),
      admin ? api.listPendingDevices('PENDING') : Promise.resolve({ pending_devices: [] })
    ]);
    if (disposed) return;

    if (roomsRes.status === 'fulfilled') {
      cachedRooms = roomsRes.value.rooms || [];
      clear(roomSelect);
      roomSelect.appendChild(el('option', { value: '', text: 'All rooms' }));
      for (const r of cachedRooms) {
        roomSelect.appendChild(
          el('option', { value: r.room_id, text: `${r.room_code} · ${r.name}`, selected: r.room_id === roomFilter })
        );
      }
    }
    if (capsRes.status === 'fulfilled') {
      cachedCaps = capsRes.value.capabilities || [];
    }

    clear(pendingSlot);
    const pendingList = pendingRes.status === 'fulfilled' ? pendingRes.value?.pending_devices || [] : [];
    if (admin && pendingList.length > 0) {
      pendingSlot.appendChild(
        el('section', { class: 'card stack-sm notice-pending' }, [
          el('div', { class: 'row-between' }, [
            statusIndicator('PENDING_REVIEW', `${pendingList.length} Quarantined Device${pendingList.length > 1 ? 's' : ''} Awaiting Admin Approval`),
            el('span', { class: 'text-xs text-muted', text: 'Telemetry & commands blocked until approved' })
          ]),
          el(
            'div',
            { class: 'queue-list' },
            pendingList.map((p) =>
              el('div', { class: 'queue-item' }, [
                el('div', { class: 'queue-item-main' }, [
                  el('div', { class: 'mono font-semibold text-sm', text: p.device_id }),
                  el('div', {
                    class: 'text-xs text-secondary',
                    text: `Firmware: ${p.firmware_version || 'unknown'} · Announced ${formatAge(p.last_seen_at)} · ${(p.manifest?.endpoints || []).length} endpoints`
                  })
                ]),
                el('div', { class: 'btn-row' }, [
                  el('button', {
                    type: 'button',
                    class: 'btn btn-primary btn-sm',
                    text: 'Review & Approve',
                    onClick: () =>
                      openDeviceWizard({
                        pending: p,
                        rooms: cachedRooms,
                        capabilities: cachedCaps,
                        onSaved: loadAll
                      })
                  }),
                  el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: 'Dismiss',
                    onClick: async () => {
                      try {
                        await api.dismissPendingDevice(p.device_id);
                        showToast('Quarantined device dismissed', p.device_id, 'info');
                        loadAll();
                      } catch (err) {
                        showToast('Dismiss failed', err.message, 'error');
                      }
                    }
                  })
                ])
              ])
            )
          )
        ])
      );
    }

    await loadDevices();

    if (admin && query?.get('action') === 'register') {
      // Clear query param so refresh doesn't re-open
      window.history.replaceState({}, '', '/app/devices');
      openDeviceWizard({
        rooms: cachedRooms,
        defaultRoomId: roomFilter,
        capabilities: cachedCaps,
        onSaved: loadAll
      });
    }
  }

  loadAll();

  return {
    node: container,
    cleanup: () => {
      disposed = true;
      clearTimeout(debounce);
    }
  };
}

// ============================================================================
// DEVICE DETAIL PAGE (/app/devices/:deviceId)
// ============================================================================
export function renderDeviceDetailPage({ params, navigate }) {
  const deviceId = decodeURIComponent(params.deviceId);
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let disposed = false;
  let refreshTimer = null;

  const contentSlot = el('div', { class: 'stack-lg' });
  container.appendChild(contentSlot);

  async function load(silent = false) {
    if (disposed) return;
    if (!silent) {
      clear(contentSlot);
      contentSlot.appendChild(loadingSkeleton('table', 4));
    }

    const [devRes, cmdsRes, roomsRes, capsRes] = await Promise.allSettled([
      api.getDevice(deviceId),
      api.getDeviceCommands(deviceId),
      admin ? api.listRooms({ status: '' }) : Promise.resolve({ rooms: [] }),
      admin ? api.getCapabilities() : Promise.resolve({ capabilities: [] })
    ]);
    if (disposed) return;

    if (devRes.status !== 'fulfilled') {
      clear(contentSlot);
      contentSlot.appendChild(
        errorPanel({
          title: 'Failed to load device',
          message: devRes.reason?.message || 'Device could not be retrieved.',
          onRetry: () => load(false)
        })
      );
      return;
    }

    const dev = devRes.value.device;
    const commands = cmdsRes.status === 'fulfilled' ? cmdsRes.value.commands || [] : [];
    const rooms = roomsRes.status === 'fulfilled' ? roomsRes.value.rooms || [] : [];
    const caps = capsRes.status === 'fulfilled' ? capsRes.value.capabilities || [] : [];

    clear(contentSlot);

    // Header
    contentSlot.appendChild(
      pageHeader({
        title: dev.name,
        description: dev.description || `${dev.device_type} controller assigned to ${dev.room_name || dev.room_id}.`,
        meta: statusIndicator(dev.archived ? 'ARCHIVED' : dev.in_maintenance ? 'MAINTENANCE' : dev.status),
        actions: [
          el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-sm',
            onClick: () => navigate('/app/devices')
          }, [svgIcon('icon-arrow-left', 14), el('span', { text: 'All Devices' })]),
          admin
            ? el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                text: 'Edit Device',
                onClick: () =>
                  openDeviceWizard({
                    device: dev,
                    rooms,
                    capabilities: caps,
                    onSaved: () => load(false)
                  })
              })
            : null,
          admin && !dev.archived && dev.enabled
            ? el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                text: 'Probe',
                onClick: async () => {
                  try {
                    const res = await api.probeDevice(dev.device_id);
                    showToast('Probe completed', res.probe?.note || 'Device checked.', res.probe?.ok ? 'success' : 'warning');
                    load(false);
                  } catch (err) {
                    showToast('Probe failed', err.message, 'error');
                  }
                }
              })
            : null,
          admin && !dev.archived
            ? el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                text: dev.in_maintenance ? 'End Maintenance' : 'Maintenance',
                onClick: async () => {
                  const minutes = dev.in_maintenance ? 0 : 30;
                  const ok = await confirmDialog({
                    title: dev.in_maintenance ? 'End Maintenance Mode?' : 'Enable 30-Minute Maintenance?',
                    message: dev.in_maintenance
                      ? 'Monitoring and alarm evaluation will resume immediately.'
                      : 'Suppresses stale and threshold alarm triggers for 30 minutes while hardware maintenance is performed.',
                    confirmLabel: dev.in_maintenance ? 'End Maintenance' : 'Start 30m Maintenance'
                  });
                  if (!ok) return;
                  try {
                    await api.setMaintenance(dev.device_id, {
                      minutes,
                      reason: dev.in_maintenance ? 'Maintenance completed' : 'Operator scheduled maintenance'
                    });
                    showToast('Maintenance updated', dev.name, 'success');
                    load(false);
                  } catch (err) {
                    showToast('Maintenance update failed', err.message, 'error');
                  }
                }
              })
            : null,
          admin && !dev.slot && !dev.archived
            ? el('button', {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                text: 'Archive',
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: `Archive ${dev.name}?`,
                    message: 'Disables ingestion and resolves open alarms for this device while preserving historical records.',
                    confirmLabel: 'Archive Device',
                    danger: true
                  });
                  if (!ok) return;
                  try {
                    await api.archiveDevice(dev.device_id);
                    showToast('Device archived', dev.device_id, 'info');
                    load(false);
                  } catch (err) {
                    showToast('Archive failed', err.message, 'error');
                  }
                }
              })
            : null,
          admin && dev.archived
            ? el('button', {
                type: 'button',
                class: 'btn btn-primary btn-sm',
                text: 'Restore Device',
                onClick: async () => {
                  try {
                    await api.restoreDevice(dev.device_id);
                    showToast('Device restored', dev.device_id, 'success');
                    load(false);
                  } catch (err) {
                    showToast('Restore failed', err.message, 'error');
                  }
                }
              })
            : null
        ]
      })
    );

    // Manifest Drift Banner (preserves unexpected_keys, missing_keys, changed_keys)
    if (dev.manifest_drift?.has_drift) {
      const drift = dev.manifest_drift;
      const parts = [];
      if (drift.unexpected_keys?.length) parts.push(`unexpected: ${drift.unexpected_keys.join(', ')}`);
      if (drift.missing_keys?.length) parts.push(`missing: ${drift.missing_keys.join(', ')}`);
      if (drift.changed_keys?.length) parts.push(`changed: ${drift.changed_keys.join(', ')}`);
      contentSlot.appendChild(
        disclaimerBanner({
          icon: 'icon-warning',
          tone: 'warn',
          title: 'Capability Manifest Drift Detected',
          message: `The device announced endpoints that differ from its approved registry schema (${parts.join('; ')}). Operational schema was not altered automatically.`,
          actions: admin
            ? [
                el('button', {
                  type: 'button',
                  class: 'btn btn-secondary btn-sm',
                  text: 'Review Schema',
                  onClick: () => openDeviceWizard({ device: dev, rooms, capabilities: caps, onSaved: () => load(false) })
                })
              ]
            : []
        })
      );
    }

    // Separate Liveness vs Endpoint Freshness Strip
    const eps = dev.endpoints || [];
    const freshEpCount = eps.filter((e) => e.fresh).length;
    contentSlot.appendChild(
      el('div', { class: 'readiness-strip' }, [
        el('div', { class: 'readiness-cell' }, [
          el('span', { class: 'readiness-label', text: 'Device Liveness / Heartbeat' }),
          statusIndicator(dev.fresh ? 'ONLINE' : dev.status, dev.last_seen_at ? `${dev.status} (${formatAge(dev.last_seen_at)})` : 'Never Observed')
        ]),
        el('div', { class: 'readiness-cell' }, [
          el('span', { class: 'readiness-label', text: 'Telemetry Freshness' }),
          statusIndicator(
            dev.telemetry_fresh ? 'FRESH' : dev.telemetry_age_ms !== null ? 'STALE' : 'UNKNOWN',
            dev.telemetry_fresh ? 'Fresh Telemetry' : dev.telemetry_age_ms !== null ? 'Stale Telemetry' : 'No Telemetry Yet'
          )
        ]),
        el('div', { class: 'readiness-cell' }, [
          el('span', { class: 'readiness-label', text: 'Endpoint Freshness' }),
          el('span', { class: 'mono font-semibold tabular-nums', text: `${freshEpCount} / ${eps.length} fresh` })
        ]),
        el('div', { class: 'readiness-cell' }, [
          el('span', { class: 'readiness-label', text: 'Stale Window' }),
          el('span', { class: 'mono font-semibold tabular-nums', text: `${dev.stale_after_s ?? 90} s` })
        ])
      ])
    );

    // Two-column layout: Left (Endpoints + Recent Commands) | Right (Device Spec + MQTT Provisioning)
    const leftCol = el('div', { class: 'stack-lg' }, [
      el('section', { class: 'stack-md' }, [
        el('h2', { class: 'section-title', text: `Registered Endpoints (${eps.length})` }),
        eps.length === 0
          ? el('div', { class: 'card' }, [
              emptyState({ title: 'No endpoints configured', message: 'Edit this device to add sensor, switch, access, or camera endpoints.' })
            ])
          : el(
              'div',
              { class: 'widgets-grid' },
              eps.map((ep) => renderEndpointWidget(dev, ep, { navigate, onMutated: () => load(false) }))
            )
      ]),
      el('section', { class: 'card stack-sm' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { class: 'card-title', text: 'Recent Command History' }),
          el('span', { class: 'text-xs text-muted tabular-nums', text: `${commands.length} recent` })
        ]),
        commands.length === 0
          ? el('div', { class: 'text-sm text-muted', text: 'No commands have been issued to this device.' })
          : el('div', { class: 'table-wrap' }, [
              el('table', { class: 'data-table' }, [
                el('thead', {}, [
                  el('tr', {}, [
                    el('th', { text: 'Endpoint' }),
                    el('th', { text: 'Requested' }),
                    el('th', { text: 'Observed' }),
                    el('th', { text: 'Lifecycle' }),
                    el('th', { text: 'Issued' })
                  ])
                ]),
                el(
                  'tbody',
                  {},
                  commands.slice(0, 12).map((c) =>
                    el('tr', {}, [
                      el('td', { class: 'mono text-xs', text: c.endpoint_key }),
                      el('td', { class: 'mono text-xs', text: String(c.requested_value ?? '—') }),
                      el('td', { class: 'mono text-xs', text: String(c.observed_value ?? '—') }),
                      el('td', {}, [statusIndicator(c.state, null, { compact: true })]),
                      el('td', { class: 'mono text-xs text-muted tabular-nums', text: formatAge(c.issued_at) })
                    ])
                  )
                )
              ])
            ])
      ])
    ]);

    const mqttBase = `lci/v1/devices/${dev.device_id}`;
    const provisionCmd = `sudo ./scripts/provision-mqtt-device.sh add ${dev.device_id}`;

    const rightCol = el('div', { class: 'stack-md' }, [
      el('section', { class: 'card stack-sm' }, [
        el('h2', { class: 'card-title', text: 'Device Specification' }),
        keyValueList([
          { label: 'Device ID', node: copyableValue(dev.device_id, { label: 'Copy device ID' }) },
          {
            label: 'Room',
            node: el('a', {
              href: `/app/rooms/${encodeURIComponent(dev.room_id)}`,
              text: dev.room_name ? `${dev.room_code} · ${dev.room_name}` : dev.room_id,
              onClick: (e) => {
                e.preventDefault();
                navigate(`/app/rooms/${encodeURIComponent(dev.room_id)}`);
              }
            })
          },
          { label: 'Device Type', value: dev.device_type, mono: true },
          { label: 'Transport', value: dev.transport, mono: true },
          {
            label: 'Address',
            value: dev.transport === 'MQTT_V1' ? 'Broker-mediated (no direct IP)' : dev.ip ? `${dev.ip}:${dev.port || 80}${dev.path || ''}` : 'Not configured',
            mono: dev.transport !== 'MQTT_V1'
          },
          { label: 'Stale Timeout', value: `${dev.stale_after_s ?? 90} s`, mono: true },
          { label: 'Firmware Version', value: dev.firmware_version || 'Unreported', mono: true },
          { label: 'Protocol Version', value: `v${dev.protocol_version || '1'}`, mono: true },
          { label: 'Last Seen', value: formatTimestamp(dev.last_seen_at), mono: true }
        ])
      ]),
      dev.transport === 'MQTT_V1'
        ? el('section', { class: 'card stack-sm' }, [
            el('div', { class: 'row-between' }, [
              el('h2', { class: 'card-title', text: 'MQTT_V1 Identity & Topics' }),
              statusIndicator(dev.mqtt_identity_status || 'UNPROVISIONED', null, { compact: true })
            ]),
            el('p', {
              class: 'text-xs text-secondary',
              text: 'Provision per-device Mosquitto credentials and ACL rules on the Linux host using the allowlisted helper CLI:'
            }),
            copyableValue(provisionCmd, { label: 'Copy host provisioning CLI command', block: true }),
            keyValueList([
              { label: 'Telemetry Topic', node: copyableValue(`${mqttBase}/telemetry`, { label: 'Copy telemetry topic' }) },
              { label: 'Heartbeat Topic', node: copyableValue(`${mqttBase}/heartbeat`, { label: 'Copy heartbeat topic' }) },
              { label: 'Command Topic', node: copyableValue(`${mqttBase}/command`, { label: 'Copy command topic' }) },
              { label: 'Ack Topic', node: copyableValue(`${mqttBase}/ack`, { label: 'Copy ack topic' }) }
            ]),
            admin
              ? el('div', { class: 'btn-row' }, [
                  el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: dev.mqtt_identity_status === 'PROVISIONED' ? 'Mark Unprovisioned' : 'Mark Provisioned',
                    onClick: async () => {
                      const next = dev.mqtt_identity_status === 'PROVISIONED' ? 'UNPROVISIONED' : 'PROVISIONED';
                      try {
                        await api.setMqttIdentityStatus(dev.device_id, {
                          mqtt_identity_status: next,
                          version: dev.version
                        });
                        showToast('MQTT identity status updated', next, 'success');
                        load(false);
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

    contentSlot.appendChild(el('div', { class: 'detail-two-col' }, [leftCol, rightCol]));
  }

  const unsub = onLiveEvent('telemetry', (msg) => {
    if (msg.device_id === deviceId || msg.node_id === deviceId) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => load(true), 1200);
    }
  });

  load(false);

  return {
    node: container,
    cleanup: () => {
      disposed = true;
      clearTimeout(refreshTimer);
      unsub();
    }
  };
}

// ============================================================================
// ENDPOINT HISTORY PAGE (/app/devices/:deviceId/endpoints/:endpointKey)
// ============================================================================
export function renderEndpointDetailPage({ params, navigate }) {
  const deviceId = decodeURIComponent(params.deviceId);
  const endpointKey = decodeURIComponent(params.endpointKey);
  const container = el('div', { class: 'stack-lg' });
  let disposed = false;

  let rangePreset = 'all'; // 1h | 6h | 24h | 7d | all
  let limitVal = 200;

  const rangeSlot = el('div');
  const bodySlot = el('div', { class: 'stack-lg' });

  function computeRangeQuery() {
    const q = { limit: limitVal };
    if (rangePreset === 'all') return q;
    const now = Date.now();
    const hoursMap = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 };
    const hours = hoursMap[rangePreset];
    if (hours) {
      q.from = new Date(now - hours * 3600000).toISOString();
      q.to = new Date(now).toISOString();
    }
    return q;
  }

  function renderRangeBar() {
    clear(rangeSlot);
    rangeSlot.appendChild(
      el('div', { class: 'card card-compact row-between' }, [
        segmentedFilter({
          ariaLabel: 'History time window',
          value: rangePreset,
          options: [
            { value: '1h', label: '1h' },
            { value: '6h', label: '6h' },
            { value: '24h', label: '24h' },
            { value: '7d', label: '7d' },
            { value: 'all', label: 'All Recent' }
          ],
          onChange: (val) => {
            rangePreset = val;
            renderRangeBar();
            load();
          }
        }),
        el('span', { class: 'text-xs text-muted', text: `Server-filtered window (up to ${limitVal} samples)` })
      ])
    );
  }

  container.appendChild(
    pageHeader({
      title: `Endpoint History · ${endpointKey}`,
      description: `Historical samples and summary statistics recorded for ${deviceId}/${endpointKey}.`,
      actions: [
        el('button', {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          onClick: () => navigate(`/app/devices/${encodeURIComponent(deviceId)}`)
        }, [svgIcon('icon-arrow-left', 14), el('span', { text: 'Back to Device' })]),
        el('button', {
          type: 'button',
          class: 'btn btn-secondary btn-sm',
          onClick: () => load()
        }, [svgIcon('icon-refresh', 14), el('span', { text: 'Refresh' })])
      ]
    })
  );
  container.append(rangeSlot, bodySlot);
  renderRangeBar();

  async function load() {
    if (disposed) return;
    clear(bodySlot);
    bodySlot.appendChild(loadingSkeleton('table', 4));

    try {
      const data = await api.getEndpointHistory(deviceId, endpointKey, computeRangeQuery());
      if (disposed) return;

      const ep = data.endpoint || { endpoint_key: endpointKey, label: endpointKey, unit: '' };
      const points = data.points || [];
      const s = data.summary || { count: points.length };

      clear(bodySlot);

      // Summary KPI row
      bodySlot.appendChild(
        el('div', { class: 'kpi-grid' }, [
          el('div', { class: 'card kpi-card' }, [
            el('div', { class: 'kpi-label', text: 'Latest Reading' }),
            el('div', { class: 'kpi-value tabular-nums', text: formatEndpointValue(s.latest ?? ep.last_value, ep) }),
            statusIndicator(ep.fresh ? 'FRESH' : ep.status || 'UNKNOWN', null, { compact: true })
          ]),
          el('div', { class: 'card kpi-card' }, [
            el('div', { class: 'kpi-label', text: 'Minimum' }),
            el('div', { class: 'kpi-value tabular-nums', text: s.min !== undefined ? formatEndpointValue(s.min, ep) : '—' }),
            el('div', { class: 'kpi-sub', text: `Window: ${rangePreset.toUpperCase()}` })
          ]),
          el('div', { class: 'card kpi-card' }, [
            el('div', { class: 'kpi-label', text: 'Average' }),
            el('div', { class: 'kpi-value tabular-nums', text: s.avg !== undefined ? formatEndpointValue(s.avg, ep) : '—' }),
            el('div', { class: 'kpi-sub', text: `${points.length} samples plotted` })
          ]),
          el('div', { class: 'card kpi-card' }, [
            el('div', { class: 'kpi-label', text: 'Maximum' }),
            el('div', { class: 'kpi-value tabular-nums', text: s.max !== undefined ? formatEndpointValue(s.max, ep) : '—' }),
            el('div', { class: 'kpi-sub', text: `${ep.kind} / ${ep.data_type}` })
          ])
        ])
      );

      // Trend Chart
      bodySlot.appendChild(
        el('section', { class: 'card stack-sm' }, [
          el('div', { class: 'card-head' }, [
            el('h2', { class: 'card-title', text: `${ep.label || endpointKey} Trend` }),
            el('button', {
              type: 'button',
              class: 'btn btn-secondary btn-sm',
              disabled: points.length === 0,
              onClick: () => {
                exportRowsToCsv(
                  `${deviceId}-${endpointKey}-${rangePreset}.csv`,
                  [
                    { label: 'Timestamp', key: 'timestamp' },
                    { label: 'Value', key: 'value' },
                    { label: 'Unit', get: () => ep.unit || '' }
                  ],
                  points
                );
                showToast('CSV exported', `Exported ${points.length} samples (${rangePreset} window).`, 'success');
              }
            }, [svgIcon('icon-download', 14), el('span', { text: `Export CSV (${points.length})` })])
          ]),
          buildHistoryChartSvg(points, { unit: ep.unit || '', label: `${ep.label} trend chart` })
        ])
      );

      // Recent Samples Table
      const reversed = [...points].reverse().slice(0, 60);
      bodySlot.appendChild(
        el('section', { class: 'card stack-sm' }, [
          el('div', { class: 'card-head' }, [
            el('h2', { class: 'card-title', text: 'Recent Samples' }),
            el('span', { class: 'text-xs text-muted', text: `Showing latest ${reversed.length} of ${points.length} loaded rows` })
          ]),
          reversed.length === 0
            ? emptyState({
                icon: 'icon-activity',
                title: 'No samples in selected time window',
                message: 'Switch to All Recent or wait for incoming device frames.'
              })
            : el('div', { class: 'table-wrap' }, [
                el('table', { class: 'data-table' }, [
                  el('thead', {}, [
                    el('tr', {}, [
                      el('th', { text: 'Timestamp' }),
                      el('th', { text: 'Value' }),
                      el('th', { text: 'Age' })
                    ])
                  ]),
                  el(
                    'tbody',
                    {},
                    reversed.map((pt) =>
                      el('tr', {}, [
                        el('td', { class: 'mono text-xs tabular-nums', text: formatTimestamp(pt.timestamp) }),
                        el('td', { class: 'mono font-semibold tabular-nums', text: formatEndpointValue(pt.value, ep) }),
                        el('td', { class: 'text-xs text-muted', text: formatAge(pt.timestamp) })
                      ])
                    )
                  )
                ])
              ])
        ])
      );
    } catch (err) {
      if (disposed) return;
      clear(bodySlot);
      bodySlot.appendChild(
        errorPanel({
          title: 'Failed to load endpoint history',
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
