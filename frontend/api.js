// LCI-SFM Frontend API Client — Same-Origin Cookie Session + X-CSRF-Token Support
// Aligned 1:1 with backend/src/routes/apiRoutes.js, operationsRoutes.js, and managementRoutes.js.

let csrfTokenGetter = () => null;
let unauthorizedHandler = () => {};

export function configureApiClient({ getCsrfToken, onUnauthorized }) {
  if (typeof getCsrfToken === 'function') csrfTokenGetter = getCsrfToken;
  if (typeof onUnauthorized === 'function') unauthorizedHandler = onUnauthorized;
}

export class ApiError extends Error {
  constructor(message, status = 0, code = 'REQUEST_FAILED', payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
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

  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = csrfTokenGetter();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal
    });
  } catch (err) {
    throw new ApiError('Unable to reach the local LCI-SFM server', 0, 'NETWORK_ERROR', { cause: err?.message });
  }

  const contentType = res.headers.get('content-type') || '';
  if (options.responseType === 'blob') {
    if (!res.ok) {
      let errPayload = null;
      if (contentType.includes('application/json')) {
        errPayload = await res.json().catch(() => null);
      }
      throw new ApiError(
        errPayload?.error || errPayload?.message || `Request failed (${res.status})`,
        res.status,
        errPayload?.code || 'HTTP_ERROR',
        errPayload
      );
    }
    return res.blob();
  }

  let payload = null;
  if (contentType.includes('application/json')) {
    payload = await res.json().catch(() => null);
  } else {
    const text = await res.text().catch(() => '');
    payload = text ? { message: text } : null;
  }

  if (!res.ok) {
    if (res.status === 401 && !options.skipAuthRedirect) {
      unauthorizedHandler();
    }
    const message = payload?.error || payload?.message || `Request failed (HTTP ${res.status})`;
    throw new ApiError(message, res.status, payload?.code || 'HTTP_ERROR', payload);
  }

  return payload;
}

function buildQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      q.set(k, String(v));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // Public & Health
  getPublicInfo: () => apiRequest('/api/public/info', { skipAuthRedirect: true }),
  getHealthLive: () => apiRequest('/api/health/live', { skipAuthRedirect: true }),
  getHealthReady: async () => {
    const res = await fetch('/api/health/ready', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({ ok: false, status: 'degraded' }));
    return { ...data, httpStatus: res.status };
  },

  // Authentication
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

  // Overview, Facility & Diagnostics
  getOverview: () => apiRequest('/api/v1/overview'),
  getReleaseInfo: () => apiRequest('/api/v1/release'),
  getCapabilities: () => apiRequest('/api/v1/capabilities'),
  getDiagnostics: () => apiRequest('/api/v1/diagnostics'),
  getFacility: () => apiRequest('/api/v1/facility'),
  updateFacility: (payload) => apiRequest('/api/v1/facility', { method: 'PUT', body: payload }),

  // Management Settings & Audit (mounted at /api/v1 via managementRoutes)
  getManagementSettings: () => apiRequest('/api/v1/settings'),
  updateManagementSettings: (payload) => apiRequest('/api/v1/settings', { method: 'PUT', body: payload }),
  getManagementAudit: () => apiRequest('/api/v1/management-audit'),
  getRecentCommands: () => apiRequest('/api/v1/commands'),

  // Rooms
  listRooms: (params = {}) => apiRequest(`/api/v1/rooms${buildQuery(params)}`),
  getRoom: (roomId) => apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}`),
  createRoom: (payload) => apiRequest('/api/v1/rooms', { method: 'POST', body: payload }),
  updateRoom: (roomId, payload) =>
    apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}`, { method: 'PUT', body: payload }),
  archiveRoom: (roomId) =>
    apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}/archive`, { method: 'POST', body: {} }),
  restoreRoom: (roomId) =>
    apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}/restore`, { method: 'POST', body: {} }),

  // Devices & Endpoints
  listDevices: (params = {}) => apiRequest(`/api/v1/registry${buildQuery(params)}`),
  getDevice: (deviceId) => apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}`),
  createDevice: (payload) => apiRequest('/api/v1/registry', { method: 'POST', body: payload }),
  updateDevice: (deviceId, payload) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}`, { method: 'PUT', body: payload }),
  moveDevice: (deviceId, payload) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/move`, { method: 'POST', body: payload }),
  archiveDevice: (deviceId) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/archive`, { method: 'POST', body: {} }),
  restoreDevice: (deviceId) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/restore`, { method: 'POST', body: {} }),
  setMqttIdentityStatus: (deviceId, payload) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/mqtt-identity`, { method: 'PUT', body: payload }),
  setMaintenance: (deviceId, payload) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/maintenance`, { method: 'POST', body: payload }),
  probeDevice: (deviceId) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/probe`, { method: 'POST', body: {} }),
  sendDeviceCommand: (deviceId, payload) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/commands`, { method: 'POST', body: payload }),
  getDeviceCommands: (deviceId) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/commands`),
  sendLegacyCommand: (payload) =>
    apiRequest('/api/command', { method: 'POST', body: payload }),
  getEndpointHistory: (deviceId, endpointKey, params = {}) =>
    apiRequest(
      `/api/v1/registry/${encodeURIComponent(deviceId)}/endpoints/${encodeURIComponent(endpointKey)}/history${buildQuery(params)}`
    ),
  getCameraSnapshotBlob: (deviceId) =>
    apiRequest(`/api/v1/registry/${encodeURIComponent(deviceId)}/snapshot`, { responseType: 'blob' }),

  // Pending / Quarantined Devices
  listPendingDevices: (status = 'PENDING') =>
    apiRequest(`/api/v1/pending-devices${buildQuery({ status })}`),
  dismissPendingDevice: (deviceId) =>
    apiRequest(`/api/v1/pending-devices/${encodeURIComponent(deviceId)}/dismiss`, { method: 'POST', body: {} }),

  // Alarms & Rules
  listAlarms: (params = {}) => apiRequest(`/api/v1/alarms${buildQuery(params)}`),
  getAlarmDetail: (alarmId) => apiRequest(`/api/v1/alarms/${encodeURIComponent(alarmId)}`),
  acknowledgeAlarm: (alarmId, comment) =>
    apiRequest(`/api/v1/alarms/${encodeURIComponent(alarmId)}/acknowledge`, { method: 'POST', body: { comment } }),
  resolveAlarm: (alarmId, comment) =>
    apiRequest(`/api/v1/alarms/${encodeURIComponent(alarmId)}/resolve`, { method: 'POST', body: { comment } }),
  listRules: (params = {}) => apiRequest(`/api/v1/rules${buildQuery(params)}`),
  createRule: (payload) => apiRequest('/api/v1/rules', { method: 'POST', body: payload }),
  updateRule: (ruleId, payload) =>
    apiRequest(`/api/v1/rules/${encodeURIComponent(ruleId)}`, { method: 'PUT', body: payload }),

  // Notifications
  listNotifications: (params = {}) => apiRequest(`/api/v1/notifications${buildQuery(params)}`),
  markNotificationRead: (id, read = true) =>
    apiRequest(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'PUT', body: { read } }),
  markAllNotificationsRead: (through_id = 0) =>
    apiRequest('/api/v1/notifications/read-all', { method: 'PUT', body: { through_id } }),
  getNotificationPrefs: () => apiRequest('/api/v1/notification-preferences'),
  updateNotificationPrefs: (payload) =>
    apiRequest('/api/v1/notification-preferences', { method: 'PUT', body: payload }),

  // Logs & Audit
  getLogs: (table, limit = 100) =>
    apiRequest(`/api/logs/${encodeURIComponent(table)}${buildQuery({ limit })}`),
  listSystemUsers: () => apiRequest('/api/logs/system_users'),

  // Dashboard Operators
  createOperator: (payload) => apiRequest('/api/v1/operators', { method: 'POST', body: payload }),
  provisionOperator: (payload) => apiRequest('/api/provision/user', { method: 'POST', body: payload }),
  updateOperatorRole: (payload) => apiRequest('/api/users/role', { method: 'POST', body: payload }),
  deleteOperator: (id) => apiRequest(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} }),

  // Facility People & Physical Credentials (/api/v1/people)
  listPeople: (params = {}) => apiRequest(`/api/v1/people${buildQuery(params)}`),
  createPerson: (payload) => apiRequest('/api/v1/people', { method: 'POST', body: payload }),
  updatePerson: (personId, payload) =>
    apiRequest(`/api/v1/people/${encodeURIComponent(personId)}`, { method: 'PUT', body: payload }),
  addCredential: (personId, payload) =>
    apiRequest(`/api/v1/people/${encodeURIComponent(personId)}/credentials`, { method: 'POST', body: payload }),
  setCredentialState: (credentialId, status) =>
    apiRequest(`/api/v1/credentials/${encodeURIComponent(credentialId)}`, { method: 'PUT', body: { status } }),
  startEnrollment: (personId) =>
    apiRequest(`/api/v1/people/${encodeURIComponent(personId)}/cards/enrollment-sessions`, { method: 'POST', body: {} }),
  getEnrollment: (sessionId) =>
    apiRequest(`/api/v1/enrollment-sessions/${encodeURIComponent(sessionId)}`),
  finishEnrollment: (sessionId, action) =>
    apiRequest(`/api/v1/enrollment-sessions/${encodeURIComponent(sessionId)}/${encodeURIComponent(action)}`, {
      method: 'POST',
      body: {}
    }),

  // Simulator (only available when backend runs in simulator mode)
  triggerSimulatorScenario: (scenario) =>
    apiRequest('/api/v1/simulator', { method: 'POST', body: { scenario } })
};
