// LCI-SFM Centralized Same-Origin API Client
// Aligned 1:1 with backend /api/* and /api/v1/* strict Zod contracts.

export class ApiError extends Error {
  constructor(message, status, code, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'REQUEST_FAILED';
    this.details = details;
  }
}

let csrfTokenGetter = () => null;
let onUnauthorizedHandler = () => {};

export function configureApiClient({ getCsrfToken, onUnauthorized }) {
  if (typeof getCsrfToken === 'function') csrfTokenGetter = getCsrfToken;
  if (typeof onUnauthorized === 'function') onUnauthorizedHandler = onUnauthorized;
}

export async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {})
  };

  let body = options.body;
  if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = csrfTokenGetter();
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal || controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new ApiError('Request timed out waiting for the local server', 504, 'REQUEST_TIMEOUT');
    }
    throw new ApiError('Unable to reach the local LCI-SFM server', 0, 'NETWORK_UNREACHABLE');
  }
  clearTimeout(timer);

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else if (options.responseType === 'blob') {
    data = await response.blob();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuthRedirect) {
      onUnauthorizedHandler();
    }
    const msg =
      (data && typeof data === 'object' && (data.error || data.message)) ||
      `Server returned HTTP ${response.status}`;
    const code = (data && typeof data === 'object' && data.code) || `HTTP_${response.status}`;
    const details = (data && typeof data === 'object' && data.details) || null;
    throw new ApiError(msg, response.status, code, details);
  }

  return data;
}

export const api = {
  // Public & Health
  getPublicInfo: () => apiRequest('/api/public/info', { skipAuthRedirect: true }),
  getHealthLive: () => apiRequest('/api/health/live', { skipAuthRedirect: true }),
  getHealthReady: async () => {
    const res = await fetch('/api/health/ready', { credentials: 'same-origin' });
    const json = await res.json().catch(() => ({ ok: false, status: 'error' }));
    return { httpStatus: res.status, ...json };
  },

  // Auth
  getSession: () => apiRequest('/api/auth/session', { skipAuthRedirect: true }),
  login: (username, password) =>
    apiRequest('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      skipAuthRedirect: true
    }),
  logout: () => apiRequest('/api/auth/logout', { method: 'POST', body: {}, skipAuthRedirect: true }),
  updateAdminProfile: (payload) =>
    apiRequest('/api/auth/admin-profile', { method: 'POST', body: payload }),

  // Overview, Diagnostics & Capabilities
  getOverview: () => apiRequest('/api/v1/overview'),
  getDiagnostics: () => apiRequest('/api/v1/diagnostics'),
  getCapabilities: () => apiRequest('/api/v1/capabilities'),

  // Facility & Rooms
  getFacility: () => apiRequest('/api/v1/facility'),
  updateFacility: (payload) => apiRequest('/api/v1/facility', { method: 'PUT', body: payload }),
  listRooms: (params = {}) => {
    const q = new URLSearchParams();
    if (!params.include_archived) q.set('status', 'ACTIVE');
    if (params.search) q.set('search', params.search);
    const qs = q.toString();
    return apiRequest(`/api/v1/rooms${qs ? `?${qs}` : ''}`);
  },
  getRoom: (roomId) => apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}`),
  createRoom: (payload) => apiRequest('/api/v1/rooms', { method: 'POST', body: payload }),
  updateRoom: (roomId, payload) =>
    apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}`, { method: 'PUT', body: payload }),
  archiveRoom: (roomId) =>
    apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}/archive`, {
      method: 'POST',
      body: {}
    }),
  restoreRoom: (roomId) =>
    apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}/restore`, {
      method: 'POST',
      body: {}
    }),

  // Device Registry, Pending Quarantine & Endpoints
  listDevices: (params = {}) => {
    const q = new URLSearchParams();
    if (params.room_id) q.set('room_id', params.room_id);
    if (params.transport) q.set('transport', params.transport);
    if (params.include_archived) q.set('include_archived', 'true');
    if (params.search) q.set('search', params.search);
    const qs = q.toString();
    return apiRequest(`/api/v1/registry${qs ? `?${qs}` : ''}`);
  },
  getDevice: (deviceId) => apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}`),
  createDevice: (payload) => apiRequest('/api/v1/registry', { method: 'POST', body: payload }),
  updateDevice: (deviceId, payload) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}`, { method: 'PUT', body: payload }),
  moveDevice: (deviceId, room_id, version) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/move`, {
      method: 'POST',
      body: { room_id, version }
    }),
  archiveDevice: (deviceId) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/archive`, {
      method: 'POST',
      body: {}
    }),
  restoreDevice: (deviceId) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/restore`, {
      method: 'POST',
      body: {}
    }),
  setMqttIdentityStatus: (deviceId, status, version) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/mqtt-identity`, {
      method: 'PUT',
      body: { mqtt_identity_status: status, version }
    }),
  probeDevice: (deviceId) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/probe`, { method: 'POST', body: {} }),
  setMaintenance: (deviceId, payload) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/maintenance`, {
      method: 'POST',
      body: payload
    }),
  sendDeviceCommand: (deviceId, payload) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/commands`, {
      method: 'POST',
      body: payload
    }),
  getEndpointHistory: (deviceId, endpointKey, limit = 120) =>
    apiRequest(
      `/api/v1/registry/${encodeURIComponent(deviceId)}/endpoints/${encodeURIComponent(endpointKey)}/history?limit=${limit}`
    ),
  listPendingDevices: () => apiRequest('/api/v1/pending-devices'),
  dismissPendingDevice: (deviceId) =>
    apiRequest(`/api/v1/pending-devices/${encodeURIComponent(deviceId)}/dismiss`, {
      method: 'POST',
      body: {}
    }),

  // Legacy emergency/door command
  sendLegacyCommand: (payload) => apiRequest('/api/command', { method: 'POST', body: payload }),

  // Rules & Alarms
  listRules: (params = {}) => {
    const q = new URLSearchParams();
    if (params.room_id) q.set('room_id', params.room_id);
    if (params.device_id) q.set('device_id', params.device_id);
    const qs = q.toString();
    return apiRequest(`/api/v1/rules${qs ? `?${qs}` : ''}`);
  },
  createRule: (payload) => apiRequest('/api/v1/rules', { method: 'POST', body: payload }),
  updateRule: (ruleId, payload) =>
    apiRequest(`/api/v1/rules/${encodeURIComponent(ruleId)}`, { method: 'PUT', body: payload }),
  listAlarms: (params = {}) => {
    const q = new URLSearchParams();
    if (params.state) q.set('state', params.state);
    if (params.severity) q.set('severity', params.severity);
    if (params.room_id) q.set('room_id', params.room_id);
    if (params.device_id) q.set('device_id', params.device_id);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiRequest(`/api/v1/alarms${qs ? `?${qs}` : ''}`);
  },
  acknowledgeAlarm: (alarmId, comment = 'Acknowledged by operator') =>
    apiRequest(`/api/v1/alarms/${encodeURIComponent(alarmId)}/acknowledge`, {
      method: 'POST',
      body: { comment: comment.length >= 3 ? comment : 'Acknowledged by operator' }
    }),
  resolveAlarm: (alarmId, comment = 'Resolved by operator') =>
    apiRequest(`/api/v1/alarms/${encodeURIComponent(alarmId)}/resolve`, {
      method: 'POST',
      body: { comment: comment.length >= 3 ? comment : 'Resolved by operator' }
    }),

  // Notifications
  listNotifications: (params = {}) => {
    const q = new URLSearchParams();
    if (params.unread) q.set('unread', 'true');
    if (params.severity) q.set('severity', params.severity);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiRequest(`/api/v1/notifications${qs ? `?${qs}` : ''}`);
  },
  markNotificationRead: (id, read = true) =>
    apiRequest(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PUT',
      body: { read }
    }),
  markAllNotificationsRead: (through_id = 0) =>
    apiRequest('/api/v1/notifications/read-all', { method: 'PUT', body: { through_id } }),
  getNotificationPreferences: () => apiRequest('/api/v1/notification-preferences'),
  updateNotificationPreferences: (payload) =>
    apiRequest('/api/v1/notification-preferences', { method: 'PUT', body: payload }),

  // Logs & Audit
  getLogs: (table, limit = 150) =>
    apiRequest(`/api/logs/${encodeURIComponent(table)}?limit=${limit}`),
  getTelemetryAggregate: (minutes = 60) =>
    apiRequest(`/api/telemetry/aggregate?minutes=${minutes}`),

  // Operators & People
  listOperators: () => apiRequest('/api/logs/system_users?limit=200'),
  provisionOperator: (payload) => apiRequest('/api/provision/user', { method: 'POST', body: payload }),
  deleteOperator: (id) => apiRequest(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listPeople: (params = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiRequest(`/api/people${qs ? `?${qs}` : ''}`);
  },
  createPerson: (payload) => apiRequest('/api/people', { method: 'POST', body: payload }),

  // Simulator (only active when backend simulator mode is enabled)
  triggerSimulatorScenario: (scenario) =>
    apiRequest('/api/v1/simulator', { method: 'POST', body: { scenario } })
};
