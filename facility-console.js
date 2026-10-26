// Shared management UI. All mutations pass through the authenticated backend.
export function mountFacilityConsole({ api, isAdmin, applySettings, notify, confirm, signal }) {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const readable = value => String(value || 'UNKNOWN').replaceAll('_', ' ');
  let settings = null, people = [], selected = null, page = 1, total = 0, search = '', enrollment = null;
  let peopleSequence = 0, detailSequence = 0, stopped = false, refreshBusy = false, pollBusy = false;
  let settingsDirty = false;
  const on = (id, type, fn) => $(id)?.addEventListener(type, fn, { signal });
  const message = (id, text) => { if (!stopped && $(id)) $(id).textContent = text; };
  const run = async (button, fn) => {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try { await fn(); } catch (error) { if (!stopped) notify('Could not complete action', error.message, 'error'); }
    finally { if (!stopped && button) button.disabled = !isAdmin() && button.classList.contains('rbac-protected'); }
  };
  const readSettingsBody = value => ({
    revision: value.revision, facility_name: value.facility_name, room_name: value.room_name,
    nodes: value.nodes, display_thresholds: value.display_thresholds
  });
  const field = (id, label, value, type = 'text', extra = '') => `<div class="field-group"><label for="${id}">${label}</label><input id="${id}" class="rbac-protected-input" type="${type}" value="${esc(value)}" required ${extra} ${isAdmin() ? '' : 'disabled'} /></div>`;

  function renderSettings() {
    if (!settings || stopped) return;
    const threshold = settings.display_thresholds;
    $('facility-settings-fields').innerHTML = `<div class="management-fields">${field('facility-name','Facility name',settings.facility_name,'text','maxlength="80"')}${field('room-name','Room name',settings.room_name,'text','maxlength="80"')}</div>` +
      `<div class="management-fields">${Object.entries(settings.nodes).map(([key, n]) => `<fieldset class="node-settings"><legend>${key.toUpperCase()}</legend>${field(`registry-${key}-name`,'Device label',n.name,'text','maxlength="80"')}${field(`registry-${key}-ip`,'Registered LAN IPv4',n.ip,'text','maxlength="15" inputmode="decimal"')}</fieldset>`).join('')}</div>` +
      `<div class="management-fields">${field('threshold-temp','Temperature warning (°C)',threshold.temperature_warning,'number','min="0" max="80" step="0.1"')}${field('threshold-gas-warning','Gas warning (raw)',threshold.gas_warning_raw,'number','min="1" max="9999"')}${field('threshold-gas-critical','Gas critical (raw)',threshold.gas_critical_raw,'number','min="2" max="10000"')}</div>`;
    message('settings-feedback', `Revision ${settings.revision} · Saved by ${settings.updated_by} · ${new Date(settings.updated_at).toLocaleString()}`);
    $('facility-save-btn').disabled = !isAdmin();
    settingsDirty = false;
  }

  async function loadSettings() {
    const data = await api('/settings');
    if (stopped) return;
    if (settingsDirty) {
      if (settings && data.settings.revision !== settings.revision) message('settings-feedback','Shared settings changed elsewhere. Save will check the revision; refresh the page to discard local edits.');
      return;
    }
    settings = data.settings;
    applySettings(settings);
    message('facility-room-label', `${settings.facility_name} / ${settings.room_name}`);
    renderSettings();
  }

  async function loadDevices() {
    try {
      const { devices } = await api('/registry');
      if (stopped) return;
      $('device-registry').innerHTML = devices.map(d => `<article class="glass-card device-tile"><div class="flex-between"><span class="eyebrow">${esc((d.slot || d.device_type).toUpperCase())}</span><span class="status-tag ${d.fresh && d.status === 'ONLINE' ? 'status-nominal' : 'status-warning'}">${esc(readable(d.status))}</span></div><h3>${esc(d.name)}</h3><p class="device-address">${esc(d.ip)}</p><dl><dt>Identity</dt><dd>${esc(d.device_id)}</dd><dt>Last observed</dt><dd>${d.last_seen_at ? esc(new Date(d.last_seen_at).toLocaleString()) : 'No device evidence'}</dd><dt>Observation age</dt><dd>${d.age_ms === null ? 'Unknown' : `${Math.floor(d.age_ms / 1000)} seconds`}</dd><dt>Firmware</dt><dd>${esc(d.firmware_version || 'Not reported')}</dd><dt>Capabilities</dt><dd>${esc((d.capabilities || d.endpoints.map(e=>e.label)).join(', ') || 'Not reported')}</dd></dl><p class="helper-note">Registered address only. Policy synchronization requires firmware integration.</p></article>`).join('');
      message('devices-feedback', `Status refreshed ${new Date().toLocaleTimeString()} · An IP address alone does not establish connectivity.`);
    } catch (err) { message('devices-feedback', `Device status unavailable: ${err.message}. Previous results may be stale.`); throw err; }
  }

  async function loadPeople() {
    const seq = ++peopleSequence;
    message('people-feedback','Loading directory…');
    try {
      const data = await api(`/people?page=${page}&limit=20&search=${encodeURIComponent(search)}`);
      if (stopped || seq !== peopleSequence) return;
      people = data.people; total = data.total;
      $('people-list').innerHTML = people.length ? people.map(p => `<button type="button" class="person-row ${selected?.subject_id === p.subject_id ? 'selected' : ''}" data-person="${esc(p.subject_id)}"><span><strong>${esc(p.display_name)}</strong><small>${esc(p.reference || 'No reference')} · ${p.credentials.filter(c => c.status !== 'REVOKED').length} credentials</small></span><span class="status-tag ${p.status === 'ACTIVE' ? 'status-nominal' : 'status-warning'}">${esc(p.status)}</span></button>`).join('') : '<div class="management-empty">No people found. Create a person to start assigning credentials.</div>';
      message('people-feedback',`${total} people · Source: central database`);
      message('people-page',`Page ${page} of ${Math.max(1,Math.ceil(total / 20))}`);
      $('people-prev').disabled = page === 1; $('people-next').disabled = page * 20 >= total;
      if (selected) {
        const updated = people.find(p => p.subject_id === selected.subject_id);
        if (updated) selected = updated;
      }
    } catch (err) { if (seq === peopleSequence) message('people-feedback',`Directory unavailable: ${err.message}. Previous records may be stale.`); throw err; }
  }

  function renderDetail() {
    if (!selected || stopped) return;
    const p = selected;
    $('person-detail').classList.remove('hidden');
    $('person-detail').innerHTML = `<div class="flex-between"><div><span class="eyebrow">PERSON DETAILS</span><h3>${esc(p.display_name)}</h3><p class="helper-note">${esc(p.subject_id)}</p></div><button id="person-close" type="button" class="btn-outline btn-sm">Close</button></div>
      <form id="person-edit-form"><div class="management-fields">${field('edit-person-name','Full name',p.display_name,'text','maxlength="80"')}${field('edit-person-reference','Reference',p.reference,'text','maxlength="80"')}<div class="field-group"><label for="edit-person-status">Access authorization</label><select id="edit-person-status"><option ${p.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option><option ${p.status === 'SUSPENDED' ? 'selected' : ''}>SUSPENDED</option></select></div></div><button class="btn-outline" type="submit">Save Person</button></form>
      <h4 class="management-subheading">Credentials</h4><div class="table-container"><table class="data-table"><thead><tr><th>Type</th><th>Identifier</th><th>Central status</th><th>Device status</th><th>Actions</th></tr></thead><tbody>${p.credentials.length ? p.credentials.map(c => `<tr><td>${esc(c.modality)}</td><td>${esc(c.masked_uid || 'PIN configured')}</td><td>${esc(c.status)}</td><td>${esc(readable(c.sync_status))}</td><td>${c.status !== 'REVOKED' ? `<button type="button" class="btn-outline btn-sm" data-credential="${esc(c.credential_id)}" data-state="REVOKED">Revoke</button> ${c.status === 'ASSIGNED' ? `<button type="button" class="btn-outline btn-sm" data-credential="${esc(c.credential_id)}" data-state="BLOCKED">Block</button>` : ''}` : '—'}</td></tr>`).join('') : '<tr><td colspan="5">No credentials assigned.</td></tr>'}</tbody></table></div>
      <div class="management-fields mt-20"><div><h4>RFID Card</h4><p class="helper-note">Use the door reader when supported. Manual entry is available for bench preparation.</p><button id="reader-start" type="button" class="btn-cyber" ${p.status !== 'ACTIVE' ? 'disabled' : ''}>Scan with Door Reader</button><form id="card-add-form" class="mt-16"><label for="card-uid">Manual card UID (4, 7 or 10 hex bytes)</label><input id="card-uid" placeholder="A4:9F:21:0B" maxlength="29" required /><button type="submit" class="btn-outline mt-16">Assign Card</button></form></div><div><h4>Door PIN</h4><p class="helper-note">Six digits. Reset replaces the previous central PIN. Device update remains pending.</p><form id="pin-set-form"><div class="field-group"><label for="physical-pin">New PIN</label><input type="password" id="physical-pin" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password" required /></div><div class="field-group"><label for="physical-pin-confirm">Confirm PIN</label><input type="password" id="physical-pin-confirm" inputmode="numeric" minlength="6" maxlength="6" autocomplete="new-password" required /></div><button type="submit" class="btn-outline">Set / Reset PIN</button></form></div></div><div id="reader-session" class="management-notice hidden" role="status" aria-live="polite"></div>`;
    // A reference is optional; field() defaults to required for other settings.
    $('edit-person-reference').required = false;
    $('person-close').addEventListener('click', () => { selected = null; ++detailSequence; $('person-detail').classList.add('hidden'); }, { signal });
    $('person-edit-form').addEventListener('submit', e => {
      e.preventDefault();
      const data = { display_name: $('edit-person-name').value, reference: $('edit-person-reference').value, status: $('edit-person-status').value, version: p.version };
      confirm({ title: 'Save person changes?', description: 'Changes are saved centrally. Physical reader policy remains pending synchronization.', confirmLabel: 'Save Person', onConfirm: () => run(e.submitter, async () => {
        await api(`/people/${p.subject_id}`, { method: 'PUT', body: data }); await refreshPerson(p.subject_id); await loadAudit();
      }) });
    }, { signal });
    $('card-add-form').addEventListener('submit', e => { e.preventDefault(); run(e.submitter, () => addCredential(p.subject_id, { modality: 'RFID', card_uid: $('card-uid').value })); }, { signal });
    $('pin-set-form').addEventListener('submit', e => {
      e.preventDefault();
      const pin = $('physical-pin').value;
      if (pin !== $('physical-pin-confirm').value) { notify('PIN mismatch','Both PIN fields must match.','error'); return; }
      // Clear both fields before network I/O; no PIN goes into an audit detail or browser storage.
      $('physical-pin').value = ''; $('physical-pin-confirm').value = '';
      run(e.submitter, () => addCredential(p.subject_id, { modality: 'PIN', pin }));
    }, { signal });
    $('reader-start').addEventListener('click', e => run(e.currentTarget, async () => {
      const data = await api(`/people/${p.subject_id}/cards/enrollment-sessions`, { method: 'POST', body: {} });
      enrollment = data.enrollment; renderEnrollment();
    }), { signal });
    if (enrollment?.subject_id === p.subject_id) renderEnrollment();
  }

  async function refreshPerson(id) {
    const seq = ++detailSequence;
    await loadPeople();
    if (stopped || seq !== detailSequence || selected?.subject_id !== id) return;
    const match = people.find(p => p.subject_id === id);
    if (match) { selected = match; renderDetail(); }
    else { selected = null; $('person-detail').classList.add('hidden'); }
  }

  async function addCredential(id, body) {
    await api(`/people/${id}/credentials`, { method: 'POST', body });
    notify('Credential saved','Saved centrally — pending device policy synchronization.','success');
    await refreshPerson(id); await loadAudit();
  }

  function renderEnrollment() {
    if (!enrollment || !selected || enrollment.subject_id !== selected.subject_id || stopped) return;
    const remaining = Math.max(0, Math.ceil((Date.parse(enrollment.expires_at) - Date.now()) / 1000));
    const active = ['ARMING','READY','CANDIDATE'].includes(enrollment.status);
    const labels = { ARMING: 'Request sent — waiting for reader READY acknowledgement', READY: 'Reader armed — scan one card', CANDIDATE: `Card detected: ${enrollment.masked_uid}. Review before confirming.`, CONFIRMED: 'Card saved — device policy synchronization pending', CANCELLED: 'Enrollment cancelled', EXPIRED: 'Reader session expired', FAILED: 'Reader enrollment failed' };
    const box = $('reader-session');
    if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = `<strong>${esc(labels[enrollment.status] || enrollment.status)}</strong>${active ? `<p>${remaining}s remaining · Enrollment does not unlock the door.</p><button type="button" class="btn-outline btn-sm" data-enrollment-action="cancel">Cancel</button> ${enrollment.status === 'CANDIDATE' ? '<button type="button" class="btn-primary btn-sm" data-enrollment-action="confirm">Confirm Assignment</button>' : ''}` : ''}`;
  }

  async function loadAudit() {
    const { events } = await api('/management-audit');
    if (stopped) return;
    $('management-audit').innerHTML = `<table class="data-table"><thead><tr><th>Time</th><th>Operator</th><th>Action</th><th>Entity</th></tr></thead><tbody>${events.length ? events.map(r => `<tr><td>${esc(new Date(r.timestamp).toLocaleString())}</td><td>${esc(r.actor)}</td><td>${esc(readable(r.action))}</td><td>${esc(r.entity_id)}</td></tr>`).join('') : '<tr><td colspan="4">No administration changes yet.</td></tr>'}</tbody></table>`;
  }

  async function loadCommands() {
    const { commands } = await api('/commands');
    if (stopped) return;
    $('command-history').innerHTML = `<table class="data-table"><thead><tr><th>Time</th><th>Operator</th><th>Target</th><th>Command</th><th>Requested</th><th>Outcome</th></tr></thead><tbody>${commands.length ? commands.map(c => `<tr><td>${esc(new Date(c.issued_at).toLocaleString())}</td><td>${esc(c.actor_username)}</td><td>${esc(c.target_node)}</td><td>${esc(readable(c.command))}</td><td>${esc(c.requested_state)}</td><td>${esc(readable(c.lifecycle_state))}${c.error_code ? ` · ${esc(c.error_code)}` : ''}</td></tr>`).join('') : '<tr><td colspan="6">No control commands recorded.</td></tr>'}</tbody></table>`;
  }

  on('people-list','click', e => {
    const btn = e.target.closest('[data-person]');
    if (!btn) return;
    ++detailSequence; selected = people.find(p => p.subject_id === btn.dataset.person); renderDetail();
  });
  on('person-detail','click', e => {
    const credential = e.target.closest('[data-credential]');
    if (credential) {
      const id = selected.subject_id;
      confirm({ title: `${readable(credential.dataset.state)} credential?`, description: 'This updates the central record. Reader revocation is pending until its policy is updated.', confirmLabel: 'Confirm', onConfirm: () => run(credential, async () => {
        await api(`/credentials/${credential.dataset.credential}`, { method: 'PUT', body: { status: credential.dataset.state } }); await refreshPerson(id); await loadAudit();
      }) });
    }
    const btn = e.target.closest('[data-enrollment-action]');
    if (btn && enrollment) run(btn, async () => {
      const id = enrollment.subject_id, sessionId = enrollment.session_id;
      const d = await api(`/enrollment-sessions/${sessionId}/${btn.dataset.enrollmentAction}`, { method: 'POST', body: {} });
      if (enrollment?.session_id === sessionId) enrollment = d.enrollment;
      await refreshPerson(id); await loadAudit(); renderEnrollment();
    });
  });
  on('person-create-form','submit', e => {
    e.preventDefault();
    run(e.submitter, async () => {
      const { person } = await api('/people', { method: 'POST', body: { display_name: $('person-name').value, reference: $('person-reference').value } });
      e.target.reset(); page = 1; search = ''; $('people-search').value = ''; selected = person;
      await loadPeople(); renderDetail(); await loadAudit();
    });
  });
  on('operator-account-form','submit', e => {
    e.preventDefault();
    run(e.submitter, async () => {
      const body = { username: $('operator-username').value, password: $('operator-password').value, role: $('operator-role').value };
      $('operator-password').value = '';
      await api('/operators', { method: 'POST', body });
      e.target.reset(); notify('Account created','Dashboard login created independently from physical credentials.','success');
      document.dispatchEvent(new Event('lci-operators-updated')); await loadAudit();
    });
  });
  on('people-search-form','submit', e => { e.preventDefault(); page = 1; search = $('people-search').value; run(e.submitter, loadPeople); });
  on('people-prev','click', () => { if (page > 1) { page--; run(null, loadPeople); } });
  on('people-next','click', () => { if (page * 20 < total) { page++; run(null, loadPeople); } });
  on('people-refresh','click', e => run(e.currentTarget, async () => { await loadPeople(); if (selected) renderDetail(); }));
  on('devices-refresh','click', e => run(e.currentTarget, async () => { await loadDevices(); await loadSettings(); }));
  on('management-audit-refresh','click', e => run(e.currentTarget, loadAudit));
  on('commands-refresh','click', e => run(e.currentTarget, loadCommands));
  document.addEventListener('lci-settings-updated', event => {
    if (!settingsDirty) { settings = event.detail; renderSettings(); }
  }, { signal });
  on('facility-settings-form','input', () => { settingsDirty = true; message('settings-feedback','Unsaved changes'); });
  on('facility-settings-form','submit', e => {
    e.preventDefault();
    if (!isAdmin() || !settings) return;
    const data = readSettingsBody(settings);
    data.facility_name = $('facility-name').value; data.room_name = $('room-name').value;
    data.nodes = Object.fromEntries(['node1','node2','node3'].map(key => [key, { name: $(`registry-${key}-name`).value, ip: $(`registry-${key}-ip`).value }]));
    data.display_thresholds = { temperature_warning: Number($('threshold-temp').value), gas_warning_raw: Number($('threshold-gas-warning').value), gas_critical_raw: Number($('threshold-gas-critical').value) };
    run(e.submitter, async () => {
      try {
        const saved = await api('/settings', { method: 'PUT', body: data });
        settings = saved.settings; settingsDirty = false; applySettings(settings); renderSettings();
        message('facility-room-label',`${settings.facility_name} / ${settings.room_name}`);
        notify('Settings saved','Shared addresses and display limits saved. Device network interfaces and automation are unchanged.','success');
        await loadDevices();
      } catch (error) { message('settings-feedback',error.message); throw error; }
    });
  });

  const timer = setInterval(async () => {
    if (stopped || document.hidden) return;
    if (enrollment && ['ARMING','READY','CANDIDATE'].includes(enrollment.status) && !pollBusy) {
      pollBusy = true;
      const id = enrollment.session_id;
      try { const d = await api(`/enrollment-sessions/${id}`); if (!stopped && enrollment?.session_id === id) { enrollment = d.enrollment; renderEnrollment(); } }
      catch (err) { if ($('reader-session')) message('reader-session',`Reader status unavailable: ${err.message}`); }
      finally { pollBusy = false; }
    }
  }, 1500);
  const refresh = setInterval(async () => {
    if (stopped || document.hidden || refreshBusy || !$('view-8').classList.contains('active')) return;
    refreshBusy = true;
    try { await loadDevices(); await loadSettings(); await loadCommands(); }
    catch {} finally { refreshBusy = false; }
  }, 10000);
  signal.addEventListener('abort', () => { stopped = true; clearInterval(timer); clearInterval(refresh); $('person-detail').innerHTML = ''; $('people-list').innerHTML = ''; $('management-audit').innerHTML = ''; }, { once: true });
  if (isAdmin()) { run(null, loadPeople); run(null, loadAudit); }
  run(null, loadSettings); run(null, loadDevices); run(null, loadCommands);
}
