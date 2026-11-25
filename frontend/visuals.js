// LCI-SFM Centralized Visual Identity, Category Palette & Local Offline SVG Illustration Resolver
// Maps structured device_type, endpoint kind/unit, and infrastructure roles to category accents,
// crisp 24x24 outline icons, and locally bundled custom SVG illustrations.
// Category identity is strictly independent from operational health/liveness status.

import { el, svgIcon } from './utils.js';

export const NODE_ILLUSTRATIONS = Object.freeze({
  ENV_SENSOR: new URL('./assets/illustrations/nodes/env-sensor.svg', import.meta.url).href,
  TEMP_HUMIDITY: new URL('./assets/illustrations/nodes/temp-humidity-sensor.svg', import.meta.url).href,
  GAS_SMOKE: new URL('./assets/illustrations/nodes/gas-smoke-sensor.svg', import.meta.url).href,
  SMART_DOOR: new URL('./assets/illustrations/nodes/smart-door-controller.svg', import.meta.url).href,
  RFID_READER: new URL('./assets/illustrations/nodes/rfid-keypad-reader.svg', import.meta.url).href,
  SECURITY_CAMERA: new URL('./assets/illustrations/nodes/security-camera.svg', import.meta.url).href,
  RELAY_SWITCH: new URL('./assets/illustrations/nodes/relay-switch.svg', import.meta.url).href,
  NETWORK_GATEWAY: new URL('./assets/illustrations/nodes/network-gateway.svg', import.meta.url).href,
  MQTT_BROKER: new URL('./assets/illustrations/nodes/mqtt-broker.svg', import.meta.url).href,
  SERVER_CONTROLLER: new URL('./assets/illustrations/nodes/server-controller.svg', import.meta.url).href,
  GENERIC_NODE: new URL('./assets/illustrations/nodes/generic-node.svg', import.meta.url).href
});

export const EMPTY_ILLUSTRATIONS = Object.freeze({
  DEVICES: new URL('./assets/illustrations/empty-states/empty-devices.svg', import.meta.url).href,
  TELEMETRY: new URL('./assets/illustrations/empty-states/empty-telemetry.svg', import.meta.url).href,
  ALARMS_OK: new URL('./assets/illustrations/empty-states/empty-alarms-ok.svg', import.meta.url).href,
  AUDIT: new URL('./assets/illustrations/empty-states/empty-audit.svg', import.meta.url).href
});

export const DASHBOARD_ILLUSTRATIONS = Object.freeze({
  FACILITY_HUB: new URL('./assets/illustrations/dashboard/facility-hub.svg', import.meta.url).href,
  ROOM_ZONE: new URL('./assets/illustrations/dashboard/room-zone.svg', import.meta.url).href
});

/**
 * Six semantic device/infrastructure visual categories (distinct from operational status).
 * CSS custom property hooks: --cat-<key>, --cat-<key>-fg, --cat-<key>-bg, --cat-<key>-surface, --cat-<key>-border
 */
export const CATEGORY_META = Object.freeze({
  env: {
    key: 'env',
    label: 'Environmental',
    icon: 'icon-thermometer',
    illustration: NODE_ILLUSTRATIONS.ENV_SENSOR
  },
  access: {
    key: 'access',
    label: 'Access & Doors',
    icon: 'icon-door',
    illustration: NODE_ILLUSTRATIONS.SMART_DOOR
  },
  camera: {
    key: 'camera',
    label: 'Camera & Vision',
    icon: 'icon-camera',
    illustration: NODE_ILLUSTRATIONS.SECURITY_CAMERA
  },
  relay: {
    key: 'relay',
    label: 'Relays & Switches',
    icon: 'icon-toggle',
    illustration: NODE_ILLUSTRATIONS.RELAY_SWITCH
  },
  network: {
    key: 'network',
    label: 'Network & MQTT',
    icon: 'icon-broadcast',
    illustration: NODE_ILLUSTRATIONS.NETWORK_GATEWAY
  },
  infra: {
    key: 'infra',
    label: 'Server & Storage',
    icon: 'icon-server',
    illustration: NODE_ILLUSTRATIONS.SERVER_CONTROLLER
  }
});

/**
 * Resolves a device's visual category, icon, and specific illustration strictly from structured metadata
 * (device_type, slot, transport, and endpoints[] kinds/units) without guessing from display names.
 */
export function resolveDeviceVisual(device = {}) {
  const devType = String(device?.device_type || '').toUpperCase();
  const slot = String(device?.slot || '').toLowerCase();
  const transport = String(device?.transport || '').toUpperCase();
  const endpoints = Array.isArray(device?.endpoints) ? device.endpoints : [];
  const kinds = new Set(endpoints.map((e) => String(e?.kind || '').toUpperCase()).filter(Boolean));

  if (devType === 'CAMERA' || transport === 'CAMERA_JPEG' || slot === 'node3' || (kinds.size === 1 && kinds.has('CAMERA'))) {
    return {
      category: 'camera',
      categoryLabel: 'Security Camera',
      icon: 'icon-camera',
      illustration: NODE_ILLUSTRATIONS.SECURITY_CAMERA
    };
  }

  if (devType === 'ACCESS' || slot === 'node1' || (kinds.size === 1 && kinds.has('ACCESS'))) {
    return {
      category: 'access',
      categoryLabel: 'Access Controller',
      icon: 'icon-door',
      illustration: NODE_ILLUSTRATIONS.SMART_DOOR
    };
  }

  if (devType === 'RELAY' || (kinds.size === 1 && kinds.has('SWITCH'))) {
    return {
      category: 'relay',
      categoryLabel: 'Relay / Smart Switch',
      icon: 'icon-toggle',
      illustration: NODE_ILLUSTRATIONS.RELAY_SWITCH
    };
  }

  if (devType === 'SENSORS' || slot === 'node2' || kinds.has('SENSOR')) {
    const epKeys = endpoints.map((e) => String(e?.endpoint_key || '').toLowerCase());
    const units = endpoints.map((e) => String(e?.unit || '').toLowerCase());
    const hasTemp = epKeys.some((k) => k.includes('temp')) || units.some((u) => u.includes('c') || u.includes('f'));
    const hasHum = epKeys.some((k) => k.includes('hum')) || units.some((u) => u === '%');
    const hasSmokeOrGas = epKeys.some((k) => k.includes('smoke') || k.includes('gas') || k.includes('co2'));

    if (hasSmokeOrGas && !hasTemp && !hasHum) {
      return {
        category: 'env',
        categoryLabel: 'Gas / Smoke Sensor',
        icon: 'icon-flame',
        illustration: NODE_ILLUSTRATIONS.GAS_SMOKE
      };
    }
    if ((hasTemp || hasHum) && !hasSmokeOrGas && !kinds.has('SWITCH')) {
      return {
        category: 'env',
        categoryLabel: 'Temp & Humidity Sensor',
        icon: 'icon-thermometer',
        illustration: NODE_ILLUSTRATIONS.TEMP_HUMIDITY
      };
    }
    return {
      category: 'env',
      categoryLabel: devType === 'MIXED' ? 'Mixed Environmental Node' : 'Environmental Sensor',
      icon: 'icon-thermometer',
      illustration: NODE_ILLUSTRATIONS.ENV_SENSOR
    };
  }

  if (devType === 'MIXED') {
    if (kinds.has('ACCESS')) {
      return { category: 'access', categoryLabel: 'Mixed Access Controller', icon: 'icon-door', illustration: NODE_ILLUSTRATIONS.SMART_DOOR };
    }
    if (kinds.has('CAMERA')) {
      return { category: 'camera', categoryLabel: 'Mixed Camera Node', icon: 'icon-camera', illustration: NODE_ILLUSTRATIONS.SECURITY_CAMERA };
    }
    if (kinds.has('SWITCH')) {
      return { category: 'relay', categoryLabel: 'Mixed Actuator Node', icon: 'icon-toggle', illustration: NODE_ILLUSTRATIONS.RELAY_SWITCH };
    }
  }

  return {
    category: 'infra',
    categoryLabel: 'Edge Controller',
    icon: 'icon-cpu',
    illustration: NODE_ILLUSTRATIONS.GENERIC_NODE
  };
}

/**
 * Resolves visual metadata for a single endpoint definition.
 */
export function resolveEndpointVisual(ep = {}) {
  const kind = String(ep?.kind || '').toUpperCase();
  const key = String(ep?.endpoint_key || '').toLowerCase();
  const unit = String(ep?.unit || '').toLowerCase();

  if (kind === 'CAMERA') {
    return { category: 'camera', icon: 'icon-camera', illustration: NODE_ILLUSTRATIONS.SECURITY_CAMERA };
  }
  if (kind === 'ACCESS') {
    return { category: 'access', icon: 'icon-door', illustration: NODE_ILLUSTRATIONS.SMART_DOOR };
  }
  if (kind === 'SWITCH') {
    return { category: 'relay', icon: 'icon-toggle', illustration: NODE_ILLUSTRATIONS.RELAY_SWITCH };
  }
  if (kind === 'SENSOR') {
    if (key.includes('smoke') || key.includes('gas')) {
      return { category: 'env', icon: 'icon-flame', illustration: NODE_ILLUSTRATIONS.GAS_SMOKE };
    }
    if (key.includes('hum') || unit === '%') {
      return { category: 'env', icon: 'icon-droplet', illustration: NODE_ILLUSTRATIONS.TEMP_HUMIDITY };
    }
    return { category: 'env', icon: 'icon-thermometer', illustration: NODE_ILLUSTRATIONS.ENV_SENSOR };
  }
  return { category: 'infra', icon: 'icon-cpu', illustration: NODE_ILLUSTRATIONS.GENERIC_NODE };
}

/**
 * Resolves visual metadata for core infrastructure nodes (Network topology & Diagnostics).
 */
export function resolveInfrastructureVisual(nodeId) {
  const id = String(nodeId || '').toLowerCase();
  if (id === 'mqtt') {
    return { category: 'network', categoryLabel: 'MQTT Broker', icon: 'icon-broadcast', illustration: NODE_ILLUSTRATIONS.MQTT_BROKER };
  }
  if (id === 'browser' || id === 'gateway' || id === 'lan') {
    return { category: 'network', categoryLabel: 'Network Client / LAN', icon: 'icon-router', illustration: NODE_ILLUSTRATIONS.NETWORK_GATEWAY };
  }
  if (id === 'sqlite') {
    return { category: 'infra', categoryLabel: 'SQLite WAL Store', icon: 'icon-database', illustration: NODE_ILLUSTRATIONS.SERVER_CONTROLLER };
  }
  return { category: 'infra', categoryLabel: 'Central Server', icon: 'icon-server', illustration: NODE_ILLUSTRATIONS.SERVER_CONTROLLER };
}

/**
 * Renders a category-tinted icon badge (28px, 34px, or 40px) for dense tables, headers, and endpoint cards.
 */
export function renderCategoryIconBadge(category = 'infra', iconName = 'icon-cpu', size = 'md') {
  const iconPx = size === 'sm' ? 15 : size === 'lg' ? 20 : 17;
  return el('span', { class: `cat-icon-badge cat-${category} cat-icon-${size}`, 'aria-hidden': 'true' }, [
    svgIcon(iconName, iconPx)
  ]);
}

/**
 * Renders a category-styled local SVG illustration frame (`sm` = 52x42, `md` = 76x60, `lg` = 112x88).
 */
export function renderNodeIllustration(visual, { size = 'md', alt = '' } = {}) {
  const cat = visual?.category || 'infra';
  const src = visual?.illustration || NODE_ILLUSTRATIONS.GENERIC_NODE;
  return el('div', { class: `node-illus-frame node-illus-${size} cat-${cat}`, 'aria-hidden': alt ? undefined : 'true' }, [
    el('img', {
      class: 'node-illus-img',
      src,
      alt,
      loading: 'eager',
      decoding: 'async'
    })
  ]);
}

/**
 * Renders a static, non-interactive category label chip (distinct from buttons).
 */
export function renderCategoryChip(category = 'infra', label = '') {
  const meta = CATEGORY_META[category] || CATEGORY_META.infra;
  return el('span', { class: `cat-chip cat-${category}` }, [
    svgIcon(meta.icon, 12),
    el('span', { text: label || meta.label })
  ]);
}
