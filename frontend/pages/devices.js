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
import { renderEndpointWidget, cleanupWidgetBlobs } from '../widgets.js';
import {
  EMPTY_ILLUSTRATIONS,
  resolveDeviceVisual,
  resolveEndpointVisual,
  renderNodeIllustration,
  renderCategoryChip,
  renderCategoryIconBadge
} from '../visuals.js';
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
  CAMERA: ['MEDIA', 'BOOLEAN']
};

const DEVICE_TYPE_ALLOWED_KINDS = {
  SENSORS: ['SENSOR'],
  CAMERA: ['CAMERA'],
  ACCESS: ['ACCESS'],
  RELAY: ['SWITCH'],
  MIXED: ['SENSOR', 'SWITCH', 'CAMERA', 'ACCESS']
};

const SAFE_DEVICE_PATH_REGEX = /^\/[a-zA-Z0-9_/-]+(?:\.(?:json|jpg))?$/;
const VALID_WIDGET_ENUM = new Set([
  'AUTO',
  'METRIC_TREND',
  'BOOLEAN_STATE',
  'SWITCH_CONTROL',
  'ACCESS_STATE',
  'CAMERA_SNAPSHOT'
]);

function sanitizeDisplayConfig(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const clean = {};
  if (typeof raw.widget === 'string' && VALID_WIDGET_ENUM.has(raw.widget)) {
    clean.widget = raw.widget;
  }
  if (Number.isInteger(raw.precision) && raw.precision >= 0 && raw.precision <= 4) {
    clean.precision = raw.precision;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

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
  for (const [k, dts] of Object.entries(KIND_TO_DATA_TYPES)) {
    capMap.set(k, [...dts]);
  }
  if (Array.isArray(capabilities) && capabilities.length) {
    for (const c of capabilities) {
      if (!capMap.has(c.capability)) capMap.set(c.capability, []);
      if (!capMap.get(c.capability).includes(c.data_type)) capMap.get(c.capability).push(c.data_type);
    }
  }
  const allowedDataTypes = (kind) => capMap.get(kind) || KIND_TO_DATA_TYPES[kind] || ['NUMBER'];

  // Wizard mutable state (preserves all backend endpoint metadata fields on edit)
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
    protocol_version: device?.protocol_version || '1',
    mqtt_identity_status: device?.mqtt_identity_status || undefined,
    endpoints:
      device?.endpoints?.length
        ? device.endpoints.map((e) => ({
            endpoint_key: e.endpoint_key,
            label: e.label,
            description: e.description || '',
            kind: e.kind,
            data_type: e.data_type || allowedDataTypes(e.kind)[0],
            unit: e.unit || '',
            readable: e.readable !== undefined ? Boolean(e.readable) : true,
            writable: Boolean(e.writable),
            retention_enabled: e.retention_enabled !== undefined ? Boolean(e.retention_enabled) : true,
            min_value: typeof e.min_value === 'number' && Number.isFinite(e.min_value) ? e.min_value : null,
            max_value: typeof e.max_value === 'number' && Number.isFinite(e.max_value) ? e.max_value : null,
            allowed_values: Array.isArray(e.allowed_values) ? [...e.allowed_values] : null,
            display_config: sanitizeDisplayConfig(e.display_config),
            command_profile: e.command_profile !== undefined ? e.command_profile : undefined
          }))
        : pending?.manifest?.endpoints?.length
          ? pending.manifest.endpoints.map((e) => ({
              endpoint_key: e.endpoint_key || 'sensor_1',
              label: e.label || e.endpoint_key || 'Sensor 1',
              description: '',
              kind: e.kind || 'SENSOR',
              data_type: e.data_type || allowedDataTypes(e.kind || 'SENSOR')[0],
              unit: e.unit || '',
              readable: true,
              writable: Boolean(e.writable),
              retention_enabled: true,
              min_value: null,
              max_value: null,
              allowed_values: null,
              display_config: undefined,
              command_profile: undefined
            }))
          : [
              {
                endpoint_key: 'temperature',
                label: 'Temperature',
                description: '',
                kind: 'SENSOR',
                data_type: 'NUMBER',
                unit: '°C',
                readable: true,
                writable: false,
                retention_enabled: true,
                min_value: null,
                max_value: null,
                allowed_values: null,
                display_config: undefined,
                command_profile: undefined
              }
            ]
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
      const ip = state.ip.trim();
      if (state.transport !== 'MQTT_V1') {
        if (!ip) {
          showError('A private LAN IPv4 address is required for HTTP_JSON_V1, CAMERA_JPEG, or LEGACY_V1 transports.');
          return false;
        }
        if (!isPrivateNodeIPv4(ip)) {
          showError('Use a valid private unicast LAN IPv4 address (RFC1918); network and broadcast addresses are not allowed.');
          return false;
        }
        if (!Number.isInteger(state.port) || state.port < 1 || state.port > 65535) {
          showError('HTTP Port must be a whole number between 1 and 65535.');
          return false;
        }
        if (!SAFE_DEVICE_PATH_REGEX.test(state.path || '')) {
          showError('HTTP Path must be a clean absolute path (e.g. /telemetry or /capture.jpg) without query strings or traversal.');
          return false;
        }
      } else if (ip && !isPrivateNodeIPv4(ip)) {
        showError('Use a valid private unicast LAN IPv4 address (RFC1918) or leave empty for MQTT-only nodes.');
        return false;
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
      if (state.endpoints.length > 24) {
        showError('A device may define at most 24 endpoints.');
        return false;
      }
      const allowedKindsForType = DEVICE_TYPE_ALLOWED_KINDS[state.device_type] || ['SENSOR', 'SWITCH', 'CAMERA', 'ACCESS'];
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
        if (!allowedKindsForType.includes(ep.kind)) {
          showError(
            `Endpoint "${ep.endpoint_key}" kind (${ep.kind}) does not match device type ${state.device_type} (allowed: ${allowedKindsForType.join(', ')}).`
          );
          return false;
        }
        if (state.transport === 'CAMERA_JPEG' && ep.kind !== 'CAMERA') {
          showError('CAMERA_JPEG transport accepts CAMERA endpoints only.');
          return false;
        }
        if (!allowedDataTypes(ep.kind).includes(ep.data_type)) {
          showError(`Data type ${ep.data_type} is incompatible with ${ep.kind}.`);
          return false;
        }
        if (ep.writable && ep.kind !== 'SWITCH') {
          showError(`Only SWITCH endpoints can be marked writable ("${ep.endpoint_key}").`);
          return false;
        }
        if (ep.writable && state.transport !== 'MQTT_V1') {
          showError(`Writable endpoint "${ep.endpoint_key}" requires MQTT_V1 transport.`);
          return false;
        }
        if (ep.kind === 'SENSOR' && ep.data_type === 'NUMBER') {
          const hasMin = ep.min_value !== null && ep.min_value !== undefined && ep.min_value !== '';
          const hasMax = ep.max_value !== null && ep.max_value !== undefined && ep.max_value !== '';
          const minNum = hasMin ? Number(ep.min_value) : null;
          const maxNum = hasMax ? Number(ep.max_value) : null;
          if ((hasMin && !Number.isFinite(minNum)) || (hasMax && !Number.isFinite(maxNum))) {
            showError(`Endpoint "${ep.endpoint_key}" min/max bounds must be valid finite numbers.`);
            return false;
          }
          if (minNum !== null && maxNum !== null && minNum >= maxNum) {
            showError(`Endpoint "${ep.endpoint_key}" min_value (${minNum}) must be strictly below max_value (${maxNum}).`);
            return false;
          }
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
        id: 'wiz-device-desc',
        class: 'textarea',
        value: state.description,
        placeholder: 'Physical mounting location or controller purpose...'
      });
      descInput.addEventListener('input', () => {
        state.description = descInput.value;
      });

      const enabledCb = el('input', { id: 'wiz-device-enabled', type: 'checkbox', checked: state.enabled });
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
            el('label', { class: 'form-label', for: 'wiz-device-desc', text: 'Description' }),
            descInput
          ]),
          el('div', { class: 'form-field form-field-full' }, [
            el('label', { class: 'checkbox-row', for: 'wiz-device-enabled' }, [
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
          'aria-label': `Endpoint ${idx + 1} key`,
          placeholder: 'endpoint_key'
        });
        keyIn.addEventListener('input', () => {
          ep.endpoint_key = keyIn.value.trim().toLowerCase();
        });

        const lblIn = el('input', {
          class: 'input',
          type: 'text',
          value: ep.label,
          'aria-label': `Endpoint ${idx + 1} display label`,
          placeholder: 'Display label'
        });
        lblIn.addEventListener('input', () => {
          ep.label = lblIn.value;
        });

        const kindSel = el(
          'select',
          { class: 'select', disabled: isLegacy, 'aria-label': `Endpoint ${idx + 1} capability kind` },
          ['SENSOR', 'SWITCH', 'ACCESS', 'CAMERA'].map((k) =>
            el('option', { value: k, text: k, selected: k === ep.kind })
          )
        );
        kindSel.addEventListener('change', () => {
          const prevKind = ep.kind;
          ep.kind = kindSel.value;
          const validTypes = allowedDataTypes(ep.kind);
          if (!validTypes.includes(ep.data_type)) ep.data_type = validTypes[0];
          if (ep.kind !== 'SWITCH') {
            ep.writable = false;
            ep.command_profile = null;
          }
          if (ep.kind !== prevKind) {
            ep.allowed_values = null;
            if (ep.kind !== 'SENSOR' || ep.data_type !== 'NUMBER') {
              ep.min_value = null;
              ep.max_value = null;
            }
          }
          renderCurrentStep();
        });

        const dtOptions = allowedDataTypes(ep.kind);
        const dtSel = el(
          'select',
          { class: 'select', disabled: isLegacy, 'aria-label': `Endpoint ${idx + 1} data type` },
          dtOptions.map((dt) => el('option', { value: dt, text: dt, selected: dt === ep.data_type }))
        );
        dtSel.addEventListener('change', () => {
          const prevDt = ep.data_type;
          ep.data_type = dtSel.value;
          if (ep.data_type !== prevDt && ep.data_type !== 'ENUM') {
            ep.allowed_values = null;
          }
          if (ep.data_type !== 'NUMBER') {
            ep.min_value = null;
            ep.max_value = null;
          }
          renderCurrentStep();
        });

        const unitIn = el('input', {
          class: 'input',
          type: 'text',
          value: ep.unit || '',
          disabled: ep.data_type !== 'NUMBER',
          'aria-label': `Endpoint ${idx + 1} unit`,
          placeholder: ep.data_type === 'NUMBER' ? 'Unit' : '—'
        });
        unitIn.addEventListener('input', () => {
          ep.unit = unitIn.value.trim();
        });

        const writableCb = el('input', {
          type: 'checkbox',
          checked: Boolean(ep.writable),
          disabled: isLegacy || ep.kind !== 'SWITCH' || state.transport !== 'MQTT_V1'
        });
        writableCb.addEventListener('change', () => {
          ep.writable = writableCb.checked;
        });

        let boundsRow = null;
        if (ep.kind === 'SENSOR' && ep.data_type === 'NUMBER') {
          const minId = `wiz-ep-min-${idx}`;
          const maxId = `wiz-ep-max-${idx}`;
          const minIn = el('input', {
            id: minId,
            class: 'input mono',
            type: 'number',
            step: 'any',
            value: ep.min_value !== null && ep.min_value !== undefined ? String(ep.min_value) : '',
            placeholder: 'Optional',
            'aria-label': `Minimum value for ${ep.endpoint_key || `endpoint ${idx + 1}`}`
          });
          minIn.addEventListener('input', () => {
            const raw = minIn.value.trim();
            ep.min_value = raw === '' ? null : Number(raw);
          });

          const maxIn = el('input', {
            id: maxId,
            class: 'input mono',
            type: 'number',
            step: 'any',
            value: ep.max_value !== null && ep.max_value !== undefined ? String(ep.max_value) : '',
            placeholder: 'Optional',
            'aria-label': `Maximum value for ${ep.endpoint_key || `endpoint ${idx + 1}`}`
          });
          maxIn.addEventListener('input', () => {
            const raw = maxIn.value.trim();
            ep.max_value = raw === '' ? null : Number(raw);
          });

          boundsRow = el('div', { class: 'endpoint-bounds-row' }, [
            el('span', { class: 'text-xs text-muted', text: 'Valid Sensor Range (optional):' }),
            el('div', { class: 'endpoint-bounds-field' }, [
              el('label', { class: 'text-xs text-secondary', for: minId, text: 'Min' }),
              minIn
            ]),
            el('div', { class: 'endpoint-bounds-field' }, [
              el('label', { class: 'text-xs text-secondary', for: maxId, text: 'Max' }),
              maxIn
            ])
          ]);
        }

        listWrap.appendChild(
          el('div', { class: 'endpoint-editor-card' }, [
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
            ]),
            boundsRow
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
                const defaultKind = (DEVICE_TYPE_ALLOWED_KINDS[state.device_type] || ['SENSOR'])[0];
                const defaultDt = allowedDataTypes(defaultKind)[0];
                state.endpoints.push({
                  endpoint_key: `endpoint_${state.endpoints.length + 1}`,
                  label: `Endpoint ${state.endpoints.length + 1}`,
                  description: '',
                  kind: defaultKind,
                  data_type: defaultDt,
                  unit: '',
                  readable: true,
                  writable: false,
                  retention_enabled: true,
                  min_value: null,
                  max_value: null,
                  allowed_values: null,
                  display_config: undefined,
                  command_profile: undefined
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
          ...state.endpoints.map((ep) => {
            const hasBounds =
              ep.kind === 'SENSOR' &&
              ep.data_type === 'NUMBER' &&
              (ep.min_value !== null || ep.max_value !== null);
            const boundsLabel = hasBounds
              ? ` · range [${ep.min_value ?? '−∞'}..${ep.max_value ?? '+∞'}]`
              : '';
            return el('div', { class: 'row-between text-sm' }, [
              el('span', { class: 'mono', text: `${ep.endpoint_key} (${ep.label})` }),
              el('span', {
                class: 'text-xs text-secondary mono',
                text: `${ep.kind}/${ep.data_type}${ep.unit ? ` · ${ep.unit}` : ''}${boundsLabel}${ep.writable ? ' · WRITABLE' : ''}`
              })
            ]);
          })
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

    if (!validateStep(0) || !validateStep(1) || !validateStep(2)) return;

    nextBtn.disabled = true;
    backBtn.disabled = true;
    nextBtn.textContent = 'Saving…';
    clearError();
    try {
      const payload = {
        device_id: state.device_id,
        name: state.name.trim(),
        description: state.description.trim(),
        room_id: state.room_id,
        device_type: state.device_type,
        transport: state.transport,
        ip: state.transport === 'MQTT_V1' ? state.ip.trim() : state.ip.trim(),
        port: Number(state.port || 80),
        path: state.path || '/telemetry',
        enabled: Boolean(state.enabled),
        stale_after_s: Number(state.stale_after_s || 90),
        protocol_version: state.protocol_version || '1',
        endpoints: state.endpoints.map((ep) => {
          const isNumSensor = ep.kind === 'SENSOR' && ep.data_type === 'NUMBER';
          const isWritableSwitch = ep.kind === 'SWITCH' && Boolean(ep.writable);
          const serialized = {
            endpoint_key: ep.endpoint_key,
            label: ep.label.trim(),
            description: ep.description || '',
            kind: ep.kind,
            data_type: ep.data_type,
            unit: ep.data_type === 'NUMBER' ? ep.unit || '' : '',
            readable: ep.readable !== false,
            writable: isWritableSwitch,
            retention_enabled: ep.retention_enabled !== false,
            min_value:
              isNumSensor && ep.min_value !== null && ep.min_value !== undefined && ep.min_value !== ''
                ? Number(ep.min_value)
                : null,
            max_value:
              isNumSensor && ep.max_value !== null && ep.max_value !== undefined && ep.max_value !== ''
                ? Number(ep.max_value)
                : null,
            allowed_values: Array.isArray(ep.allowed_values) ? ep.allowed_values : null,
            command_profile: isWritableSwitch ? ep.command_profile || 'MQTT_SWITCH_V1' : ep.command_profile ?? null
          };
          const cleanDisp = sanitizeDisplayConfig(ep.display_config);
          if (cleanDisp) serialized.display_config = cleanDisp;
          return serialized;
        })
      };
      if (isEdit && state.mqtt_identity_status) {
        payload.mqtt_identity_status = state.mqtt_identity_status;
      }
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
      backBtn.disabled = false;
      if (state.step === 3) {
        nextBtn.textContent = isEdit ? 'Save Device' : 'Register Device';
      }
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
  let quarantineStatus = 'PENDING'; // PENDING | APPROVED | DISMISSED
  let showQuarantinePanel = query?.get('focus') === 'quarantine';
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
          ? (() => {
              const qBtn = el('button', {
                id: 'toggle-quarantine-panel-btn',
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                'aria-expanded': showQuarantinePanel ? 'true' : 'false',
                onClick: () => {
                  showQuarantinePanel = !showQuarantinePanel;
                  qBtn.setAttribute('aria-expanded', showQuarantinePanel ? 'true' : 'false');
                  loadAll();
                }
              }, [
                svgIcon('icon-shield', 14),
                el('span', { text: 'Quarantine Queue' }),
                svgIcon('icon-chevron-down', 13, 'expand-chevron')
              ]);
              return qBtn;
            })()
          : null,
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
            illustration: EMPTY_ILLUSTRATIONS.DEVICES,
            title: searchTerm || roomFilter || transportFilter ? 'No matching devices' : 'No devices registered',
            message: 'Register a controller with the 4-step wizard or clear your filters.',
            actionLabel: admin && !searchTerm ? 'Register Device' : '',
            onAction: admin
              ? () => openDeviceWizard({ rooms: cachedRooms, defaultRoomId: roomFilter, capabilities: cachedCaps, onSaved: loadAll })
              : null
          }),
          columns: [
            {
              label: 'Device & Category',
              render: (d) => {
                const vis = resolveDeviceVisual(d);
                return el('div', { class: 'device-identity-cell' }, [
                  renderNodeIllustration(vis, { size: 'sm' }),
                  el('div', { class: 'stack-xs' }, [
                    el('div', { class: 'row-gap-sm' }, [
                      el('span', { class: 'font-semibold', text: d.name }),
                      renderCategoryChip(vis.category, vis.categoryLabel),
                      d.manifest_drift?.has_drift ? statusIndicator('DRIFT', 'Drift', { compact: true }) : null
                    ]),
                    el('span', { class: 'mono text-xs text-muted', text: d.device_id })
                  ])
                ]);
              }
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
          renderMobileCard: (d) => {
            const vis = resolveDeviceVisual(d);
            return el('article', { class: 'card record-card' }, [
              el('div', { class: 'record-card-head' }, [
                el('div', { class: 'device-identity-cell' }, [
                  renderNodeIllustration(vis, { size: 'md' }),
                  el('div', { class: 'stack-xs' }, [
                    el('div', { class: 'font-semibold', text: d.name }),
                    el('div', { class: 'mono text-xs text-muted', text: d.device_id }),
                    renderCategoryChip(vis.category, vis.categoryLabel)
                  ])
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
            ]);
          }
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
    const [roomsRes, capsRes, pendingRes, overviewRes] = await Promise.allSettled([
      api.listRooms({ status: '' }),
      api.getCapabilities(),
      admin ? api.listPendingDevices(quarantineStatus) : Promise.resolve({ pending_devices: [] }),
      !admin ? api.getOverview() : Promise.resolve(null)
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
    const viewerPendingCount = overviewRes.status === 'fulfilled' ? Number(overviewRes.value?.pending_devices || 0) : 0;

    if (!admin && (viewerPendingCount > 0 || showQuarantinePanel)) {
      pendingSlot.appendChild(
        el('div', { id: 'viewer-quarantine-banner' }, [
          disclaimerBanner({
            icon: 'icon-shield',
            tone: 'info',
            title: 'Quarantine Review Requires Administrator Role',
            message:
              viewerPendingCount > 0
                ? `${viewerPendingCount} unapproved MQTT device announcement${viewerPendingCount === 1 ? ' is' : 's are'} currently held in quarantine with telemetry and commands blocked. Sign in with an Admin account to inspect manifests, approve registration, or dismiss announcements.`
                : 'No unapproved device announcements are currently pending. Quarantined device approval and dismissal require an Administrator account.'
          })
        ])
      );
    } else if (admin && (pendingList.length > 0 || quarantineStatus !== 'PENDING' || showQuarantinePanel)) {
      const isPendingView = quarantineStatus === 'PENDING';
      pendingSlot.appendChild(
        el('section', { class: `card stack-sm${isPendingView && pendingList.length > 0 ? ' notice-pending' : ''}`, id: 'quarantine-review-panel' }, [
          el('div', { class: 'row-between' }, [
            el('div', { class: 'stack-xs' }, [
              isPendingView
                ? statusIndicator(
                    pendingList.length > 0 ? 'PENDING_REVIEW' : 'HEALTHY',
                    pendingList.length > 0
                      ? `${pendingList.length} Quarantined Device${pendingList.length > 1 ? 's' : ''} Awaiting Admin Approval`
                      : 'No Quarantined Devices Pending Review'
                  )
                : statusIndicator('INFO', `Quarantine History · ${quarantineStatus} (${pendingList.length})`),
              el('span', {
                class: 'text-xs text-muted',
                text: 'Unregistered MQTT_V1 heartbeats remain isolated until an Administrator registers or dismisses them.'
              })
            ]),
            segmentedFilter({
              ariaLabel: 'Quarantine status filter',
              value: quarantineStatus,
              options: [
                { value: 'PENDING', label: 'Pending' },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'DISMISSED', label: 'Dismissed' }
              ],
              onChange: (val) => {
                quarantineStatus = val;
                showQuarantinePanel = true;
                loadAll();
              }
            })
          ]),
          pendingList.length === 0
            ? el('div', {
                class: 'text-sm text-muted',
                text: `No ${quarantineStatus.toLowerCase()} quarantine records found.`
              })
            : el(
                'div',
                { class: 'queue-list' },
                pendingList.map((p) => {
                  const dismissBtn = el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: 'Dismiss',
                    onClick: async () => {
                      const ok = await confirmDialog({
                        title: `Dismiss quarantined device "${p.device_id}"?`,
                        subtitle: 'MQTT Quarantine Queue',
                        message:
                          'Dismissing removes this announcement from the active pending queue. Telemetry and commands remain blocked unless an Administrator explicitly registers this device.',
                        confirmLabel: 'Dismiss Announcement',
                        specs: [
                          ['Device ID', p.device_id],
                          ['Firmware', p.firmware_version || 'unknown'],
                          ['Announced Endpoints', String((p.manifest?.endpoints || []).length)]
                        ]
                      });
                      if (!ok) return;
                      dismissBtn.disabled = true;
                      dismissBtn.textContent = 'Dismissing…';
                      try {
                        await api.dismissPendingDevice(p.device_id);
                        showToast('Quarantined device dismissed', p.device_id, 'info');
                        loadAll();
                      } catch (err) {
                        showToast('Dismiss failed', err.message, 'error');
                        dismissBtn.disabled = false;
                        dismissBtn.textContent = 'Dismiss';
                      }
                    }
                  });

                  return el('div', { class: 'queue-item' }, [
                    el('div', { class: 'queue-item-main' }, [
                      el('div', { class: 'row-gap-sm' }, [
                        el('span', { class: 'mono font-semibold text-sm', text: p.device_id }),
                        !isPendingView ? statusIndicator(p.status || quarantineStatus, null, { compact: true }) : null
                      ]),
                      el('div', {
                        class: 'text-xs text-secondary',
                        text: `Firmware: ${p.firmware_version || 'unknown'} · Announced ${formatAge(p.last_seen_at)} · ${(p.manifest?.endpoints || []).length} endpoints`
                      })
                    ]),
                    isPendingView
                      ? el('div', { class: 'btn-row' }, [
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
                          dismissBtn
                        ])
                      : null
                  ]);
                })
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
// DEVICE MAINTENANCE MODAL & DETAIL PAGE (/app/devices/:deviceId)
// ============================================================================
function openMaintenanceModal({ device, onSaved }) {
  const presets = [
    { minutes: 15, label: '15m' },
    { minutes: 30, label: '30m' },
    { minutes: 60, label: '1h' },
    { minutes: 240, label: '4h' },
    { minutes: 1440, label: '24h' }
  ];

  const minutesInput = el('input', {
    id: 'maint-minutes-input',
    class: 'input mono tabular-nums',
    type: 'number',
    min: 1,
    max: 1440,
    step: 1,
    value: '30'
  });
  const reasonInput = el('textarea', {
    id: 'maint-reason-input',
    class: 'textarea',
    maxlength: 240,
    placeholder: 'Describe the maintenance activity for the audit log (3–240 characters)...'
  });
  const presetWrap = el('div', { class: 'preset-chip-row', role: 'group', 'aria-label': 'Maintenance duration presets' });
  const errBox = el('div', { class: 'form-error', role: 'alert', hidden: true });

  const syncPresets = () => {
    const val = Number(minutesInput.value);
    clear(presetWrap);
    for (const p of presets) {
      presetWrap.appendChild(
        el('button', {
          type: 'button',
          class: `btn btn-xs ${val === p.minutes ? 'btn-primary' : 'btn-secondary'}`,
          'aria-pressed': val === p.minutes ? 'true' : 'false',
          text: p.label,
          onClick: () => {
            minutesInput.value = String(p.minutes);
            errBox.hidden = true;
            syncPresets();
          }
        })
      );
    }
  };
  minutesInput.addEventListener('input', syncPresets);
  syncPresets();

  const body = el('div', { class: 'stack-md' }, [
    errBox,
    disclaimerBanner({
      icon: 'icon-clock',
      tone: 'warn',
      message:
        'Enabling maintenance suppresses stale-device and threshold alarm triggers and disables remote switch actuation until the window expires or an Administrator ends maintenance.'
    }),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'form-field' }, [
        el('label', { class: 'form-label', for: 'maint-minutes-input', text: 'Duration (1–1440 minutes) *' }),
        minutesInput,
        el('span', { class: 'form-hint', text: 'Maximum supported window: 1440 minutes (24 hours).' })
      ]),
      el('div', { class: 'form-field' }, [
        el('span', { class: 'form-label', text: 'Quick Presets' }),
        presetWrap
      ]),
      el('div', { class: 'form-field form-field-full' }, [
        el('label', { class: 'form-label', for: 'maint-reason-input', text: 'Audited Maintenance Reason *' }),
        reasonInput
      ])
    ])
  ]);

  const submitBtn = el('button', {
    id: 'maint-submit-btn',
    type: 'button',
    class: 'btn btn-primary',
    text: 'Start Maintenance Window',
    onClick: async () => {
      errBox.hidden = true;
      const minutes = Number(minutesInput.value.trim());
      const reason = reasonInput.value.trim();
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        errBox.textContent = 'Maintenance duration must be a whole integer between 1 and 1440 minutes.';
        errBox.hidden = false;
        return;
      }
      if (reason.length < 3 || reason.length > 240) {
        errBox.textContent = 'Provide a maintenance reason between 3 and 240 characters.';
        errBox.hidden = false;
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      try {
        await api.setMaintenance(device.device_id, { minutes, reason });
        showToast('Maintenance window active', `${device.name} (${minutes} min)`, 'success');
        closeModal();
        if (onSaved) onSaved();
      } catch (err) {
        errBox.textContent = err.message || 'Failed to enable maintenance mode.';
        errBox.hidden = false;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start Maintenance Window';
      }
    }
  });

  openModal({
    title: `Schedule Maintenance · ${device.name}`,
    subtitle: `${device.device_id} · Alarm & Command Suppression`,
    body,
    actions: [
      el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onClick: closeModal }),
      submitBtn
    ]
  });
}

export function renderDeviceDetailPage({ params, navigate }) {
  const deviceId = decodeURIComponent(params.deviceId);
  const container = el('div', { class: 'stack-lg' });
  const admin = isAdmin();
  let disposed = false;
  let refreshTimer = null;
  let frameHistoryLimit = 100;

  const contentSlot = el('div', { class: 'stack-lg' });
  container.appendChild(contentSlot);

  async function handleEndMaintenance(dev) {
    const ok = await confirmDialog({
      title: `End Maintenance Mode for ${dev.name}?`,
      subtitle: 'Device Maintenance',
      message: 'Monitoring rules, stale-device detection, and remote switch commands will resume immediately.',
      confirmLabel: 'End Maintenance'
    });
    if (!ok || disposed) return;
    try {
      await api.setMaintenance(dev.device_id, {
        minutes: 0,
        reason: 'Maintenance completed by operator'
      });
      showToast('Maintenance ended', dev.name, 'success');
      load(false);
    } catch (err) {
      showToast('Maintenance update failed', err.message, 'error');
    }
  }

  async function load(silent = false) {
    if (disposed) return;
    if (!silent) {
      cleanupWidgetBlobs();
      clear(contentSlot);
      contentSlot.appendChild(loadingSkeleton('table', 4));
    }

    const [devRes, cmdsRes, framesRes, roomsRes, capsRes] = await Promise.allSettled([
      api.getDevice(deviceId),
      api.getDeviceCommands(deviceId),
      api.getDeviceHistory(deviceId, { limit: frameHistoryLimit }),
      admin ? api.listRooms({ status: '' }) : Promise.resolve({ rooms: [] }),
      admin ? api.getCapabilities() : Promise.resolve({ capabilities: [] })
    ]);
    if (disposed) return;

    if (devRes.status !== 'fulfilled') {
      cleanupWidgetBlobs();
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
    const frames = framesRes.status === 'fulfilled' ? framesRes.value.frames || [] : [];
    const rooms = roomsRes.status === 'fulfilled' ? roomsRes.value.rooms || [] : [];
    const caps = capsRes.status === 'fulfilled' ? capsRes.value.capabilities || [] : [];

    cleanupWidgetBlobs();
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
                id: 'device-maintenance-btn',
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                text: dev.in_maintenance ? 'End Maintenance' : 'Maintenance',
                onClick: () =>
                  dev.in_maintenance
                    ? handleEndMaintenance(dev)
                    : openMaintenanceModal({ device: dev, onSaved: () => load(false) })
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

    // Visual Hardware Identity Hero (Category & Illustration strictly separated from Operational Status)
    const devVis = resolveDeviceVisual(dev);
    contentSlot.appendChild(
      el('section', { id: 'device-identity-hero', class: `card device-hero-card cat-${devVis.category}` }, [
        el('div', { class: 'device-hero-main' }, [
          renderNodeIllustration(devVis, { size: 'lg', alt: `${devVis.categoryLabel} illustration` }),
          el('div', { class: 'stack-xs min-w-0' }, [
            el('div', { class: 'row-gap-sm flex-wrap' }, [
              renderCategoryChip(devVis.category, devVis.categoryLabel),
              el('span', { class: 'meta-tag mono', text: dev.transport }),
              dev.slot ? el('span', { class: 'meta-tag mono', text: `Slot ${dev.slot}` }) : null
            ]),
            el('div', {
              class: 'font-semibold text-base',
              text: `${dev.room_code ? `${dev.room_code} · ` : ''}${dev.room_name || dev.room_id || 'Unassigned Room'}`
            }),
            el('div', {
              class: 'text-xs text-muted mono',
              text:
                dev.transport === 'MQTT_V1'
                  ? `ID: ${dev.device_id} · Broker-mediated MQTT_V1`
                  : `ID: ${dev.device_id} · ${dev.ip ? `${dev.ip}:${dev.port || 80}${dev.path || ''}` : 'Direct LAN Node'}`
            })
          ])
        ]),
        el('div', { class: 'stack-xs' }, [
          el('span', { class: 'text-xs text-muted', text: 'Operational Health' }),
          statusIndicator(
            dev.archived ? 'ARCHIVED' : dev.in_maintenance ? 'MAINTENANCE' : dev.status,
            dev.last_seen_at
              ? `${dev.archived ? 'ARCHIVED' : dev.in_maintenance ? 'MAINTENANCE' : dev.status} (${formatAge(dev.last_seen_at)})`
              : 'Never Observed'
          )
        ])
      ])
    );

    // Active Maintenance Window Banner
    if (dev.in_maintenance) {
      contentSlot.appendChild(
        el('div', { id: 'device-maintenance-banner' }, [
          disclaimerBanner({
            icon: 'icon-clock',
            tone: 'warn',
            title: 'Maintenance Window Active — Alarms & Actuation Suppressed',
            message: `Active until ${dev.maintenance_until ? formatTimestamp(dev.maintenance_until) : 'scheduled expiry'}${dev.maintenance_reason ? ` · Reason: ${dev.maintenance_reason}` : ''}.`,
            actions: admin
              ? [
                  el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-sm',
                    text: 'End Maintenance',
                    onClick: () => handleEndMaintenance(dev)
                  })
                ]
              : []
          })
        ])
      );
    }

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
              emptyState({
                illustration: EMPTY_ILLUSTRATIONS.DEVICES,
                title: 'No endpoints configured',
                message: 'Edit this device to add sensor, switch, access, or camera endpoints.'
              })
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
      ]),
      el('section', { class: 'card stack-sm', id: 'device-recent-frames' }, [
        el('div', { class: 'card-head' }, [
          el('div', { class: 'stack-xs' }, [
            el('h2', { class: 'card-title', text: 'Recent Telemetry Frames' }),
            el('span', {
              class: 'text-xs text-muted tabular-nums',
              text: `${frames.length} persisted frame${frames.length === 1 ? '' : 's'} loaded (limit ${frameHistoryLimit})`
            })
          ]),
          segmentedFilter({
            ariaLabel: 'Device frame history limit',
            value: String(frameHistoryLimit),
            options: [
              { value: '100', label: '100' },
              { value: '250', label: '250' },
              { value: '500', label: '500' }
            ],
            onChange: (val) => {
              frameHistoryLimit = Number(val) || 100;
              load(true);
            }
          })
        ]),
        frames.length >= frameHistoryLimit
          ? disclaimerBanner({
              icon: 'icon-clock',
              tone: 'warn',
              message: `Showing the latest ${frames.length} frames (limit ${frameHistoryLimit} reached). Increase the limit or open individual Endpoint History for bounded date-range exports.`
            })
          : null,
        frames.length === 0
          ? el('div', { class: 'text-sm text-muted', text: 'No telemetry frames recorded for this device yet.' })
          : el('div', { class: 'table-wrap' }, [
              el('table', { class: 'data-table', 'aria-label': 'Recent device telemetry frames' }, [
                el('thead', {}, [
                  el('tr', {}, [
                    el('th', { text: 'Received' }),
                    el('th', { text: 'Endpoint Values' }),
                    el('th', { text: 'Age' })
                  ])
                ]),
                el(
                  'tbody',
                  {},
                  frames.slice(0, 15).map((f) => {
                    const entries = Object.entries(f.values || {});
                    return el('tr', {}, [
                      el('td', { class: 'mono text-xs tabular-nums', text: formatTimestamp(f.received_at) }),
                      el(
                        'td',
                        {},
                        entries.length === 0
                          ? '—'
                          : el(
                              'div',
                              { class: 'frame-kv-strip' },
                              entries.map(([k, v]) => {
                                const epMeta = eps.find((item) => item.endpoint_key === k) || { unit: '' };
                                return el('span', {
                                  class: 'meta-tag mono',
                                  text: `${k}: ${formatEndpointValue(v, epMeta)}`
                                });
                              })
                            )
                      ),
                      el('td', { class: 'mono text-xs text-muted tabular-nums', text: formatAge(f.received_at) })
                    ]);
                  })
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
          { label: 'Last Seen', value: formatTimestamp(dev.last_seen_at), mono: true },
          dev.in_maintenance
            ? { label: 'Maintenance Until', value: dev.maintenance_until ? formatTimestamp(dev.maintenance_until) : 'Active', mono: true }
            : null,
          dev.in_maintenance && dev.maintenance_reason
            ? { label: 'Maintenance Reason', value: dev.maintenance_reason }
            : null
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
      cleanupWidgetBlobs();
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
  let refreshTimer = null;

  let rangePreset = 'all'; // 1h | 6h | 24h | 7d | all
  let limitVal = 100; // 100 | 250 | 500

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
        el('div', { class: 'row-gap-sm' }, [
          el('span', { class: 'text-xs text-muted', text: 'Window:' }),
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
          })
        ]),
        el('div', { class: 'row-gap-sm' }, [
          el('span', { class: 'text-xs text-muted', text: 'Sample limit:' }),
          segmentedFilter({
            ariaLabel: 'History sample limit',
            value: String(limitVal),
            options: [
              { value: '100', label: '100' },
              { value: '250', label: '250' },
              { value: '500', label: '500' }
            ],
            onChange: (val) => {
              limitVal = Number(val) || 100;
              renderRangeBar();
              load();
            }
          })
        ])
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

  async function load(silent = false) {
    if (disposed) return;
    if (!silent) {
      clear(bodySlot);
      bodySlot.appendChild(loadingSkeleton('table', 4));
    }

    try {
      const data = await api.getEndpointHistory(deviceId, endpointKey, computeRangeQuery());
      if (disposed) return;

      const ep = data.endpoint || { endpoint_key: endpointKey, label: endpointKey, unit: '' };
      const points = data.points || [];
      const s = data.summary || { count: points.length };

      clear(bodySlot);

      // Truncation warning when selected sample limit is reached
      if (points.length >= limitVal) {
        bodySlot.appendChild(
          el('div', { id: 'endpoint-history-truncation' }, [
            disclaimerBanner({
              icon: 'icon-warning',
              tone: 'warn',
              title: `Sample Limit Reached (${points.length} / ${limitVal})`,
              message:
                limitVal < 500
                  ? `Only the latest ${limitVal} samples in this range were returned. Switch Sample limit up to 500 or narrow the time window.`
                  : 'Maximum per-request window of 500 samples reached; narrow the time window to inspect older intervals.'
            })
          ])
        );
      }

      // Summary KPI row
      const epVis = resolveEndpointVisual(ep);
      bodySlot.appendChild(
        el('div', { class: 'kpi-grid' }, [
          el('div', { class: `card kpi-card cat-${epVis.category}` }, [
            el('div', { class: 'row-between' }, [
              el('div', { class: 'kpi-label', text: 'Latest Reading' }),
              renderCategoryIconBadge(epVis.category, epVis.icon, 'sm')
            ]),
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
            el('div', { class: 'kpi-sub', text: `${points.length} / ${limitVal} samples` })
          ]),
          el('div', { class: 'card kpi-card' }, [
            el('div', { class: 'kpi-label', text: 'Maximum' }),
            el('div', { class: 'kpi-value tabular-nums', text: s.max !== undefined ? formatEndpointValue(s.max, ep) : '—' }),
            el('div', { class: 'kpi-sub', text: `${ep.kind} / ${ep.data_type}` })
          ])
        ])
      );

      // Trend / State-Step Chart
      bodySlot.appendChild(
        el('section', { class: `card stack-sm cat-${epVis.category}` }, [
          el('div', { class: 'card-head' }, [
            el('div', { class: 'widget-head-identity' }, [
              renderCategoryIconBadge(epVis.category, epVis.icon, 'md'),
              el('div', { class: 'stack-xs' }, [
                el('h2', { class: 'card-title', text: `${ep.label || endpointKey} ${ep.kind === 'SWITCH' || ep.kind === 'ACCESS' || ep.data_type === 'BOOLEAN' ? 'State Timeline' : 'Trend'}` }),
                el('span', {
                  class: 'text-xs text-muted',
                  text: 'Timestamp-proportional X-axis from persisted device_frames'
                })
              ])
            ]),
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
          buildHistoryChartSvg(points, {
            unit: ep.unit || '',
            kind: ep.kind,
            dataType: ep.data_type,
            rangePreset,
            label: `${ep.label || endpointKey} trend chart`
          })
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
                illustration: EMPTY_ILLUSTRATIONS.TELEMETRY,
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
          onRetry: () => load(false)
        })
      );
    }
  }

  const unsubTel = onLiveEvent('telemetry', (msg) => {
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
      unsubTel();
    }
  };
}
