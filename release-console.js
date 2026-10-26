export function mountReleaseConsole({api,isAdmin,notify,confirm,navigate,wsUrl,signal}) {
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=v=>v?new Date(v).toLocaleString():'Not observed';
  const words=v=>String(v||'UNKNOWN').replaceAll('_',' ');
  const tag=v=>`<span class="status-tag ${['CRITICAL','ACTIVE','TIMED_OUT','FAILED'].includes(v)?'status-critical':['INFO','ONLINE','RESOLVED','STATE_REPORTED'].includes(v)?'status-nominal':'status-warning'}">${esc(words(v))}</span>`;
  const on=(id,type,fn)=>$(id)?.addEventListener(type,fn,{signal});
  let stopped=false,devices=[],rules=[],editingDevice=null,editingRule=null,selectedDevice=null,selectedAlarm=null;
  let notificationPage=1,notificationTotal=0,latestId=0,alarmPage=1,alarmTotal=0,sound=false,lastSoundId=null;
  let ws,reconnect,debounce,pollBusy=false,registrySequence=0,inboxSequence=0,detailSequence=0,audio;
  const run=async(button,fn)=>{
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{await fn();}catch(e){if(!stopped)notify('Action unavailable',e.message,'error');}
    finally{if(!stopped && button)button.disabled=!isAdmin()&&button.classList.contains('ops-admin');}
  };
  const text=(id,value)=>{if(!stopped&&$(id))$(id).textContent=value;};
  const gates=()=>document.querySelectorAll('.ops-admin').forEach(e=>{e.classList.toggle('ops-hidden',!isAdmin());});
  const active=id=>$(id)?.classList.contains('active');
  const params=values=>new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([,v])=>v!==''&&v!==undefined))).toString();
  const filters=prefix=>({search:$(`${prefix}-search`)?.value||'',severity:$(`${prefix}-severity`)?.value||'',device_id:$(`${prefix}-device`)?.value||''});
  const formatValue=(d,e)=>e.kind==='CAMERA'?'Capture on demand':!(e.endpoint_key in d.values)?'No reading':`${d.values[e.endpoint_key]} ${e.unit}`;

  async function loadRegistry() {
    const seq=++registrySequence;
    try{
      const data=await api('/registry');if(stopped||seq!==registrySequence)return;
      devices=data.devices;
      $('registry-list').innerHTML=devices.map(d=>`<article class="glass-card device-tile"><div class="flex-between"><span class="eyebrow">${esc(d.device_type)}</span>${tag(d.status)}</div><h3>${esc(d.name)}</h3><p class="device-address">${esc(d.ip)}${d.port!==80?`:${d.port}`:''}</p><p class="helper-note">${esc(d.device_id)} · ${esc(d.location)}</p><dl><dt>Last seen</dt><dd>${esc(time(d.last_seen_at))}</dd><dt>Functions</dt><dd>${d.endpoints.map(e=>esc(e.label)).join(' · ')}</dd><dt>Maintenance</dt><dd>${d.in_maintenance?esc(time(d.maintenance_until)):'Off'}</dd></dl><button type="button" class="btn-outline btn-sm mt-16" data-device-open="${esc(d.device_id)}">Open Device</button></article>`).join('');
      text('registry-feedback',`${devices.length} registered devices · Last refreshed ${new Date().toLocaleTimeString()} · No physical connection is inferred from registration.`);
      for(const id of ['notification-device','alarm-device','rule-device']){
        const input=$(id),previous=input.value;
        input.innerHTML=(id==='rule-device'?'':'<option value="">All devices</option>')+devices.filter(d=>id!=='rule-device'||d.endpoints.some(e=>e.kind==='SENSOR')).map(d=>`<option value="${esc(d.device_id)}">${esc(d.name)}</option>`).join('');
        if([...input.options].some(o=>o.value===previous))input.value=previous;
      }
      if(!editingRule)populateRuleSensors();
    }catch(e){text('registry-feedback',`Registry unavailable: ${e.message}. Previously displayed observations may be stale.`);throw e;}
  }

  function notificationCard(n,preview=false) {
    return `<article class="notification-item ${n.read_at?'':'unread'}"><div class="flex-between"><strong>${esc(n.title)}</strong>${tag(n.severity)}</div><p>${esc(n.message)}</p><small>${esc(time(n.timestamp))} · ${esc(n.category)}${n.device_id?` · ${esc(n.device_id)}`:''}</small><div class="ops-inline mt-12"><button type="button" class="btn-outline btn-sm" data-notification-id="${n.id}" data-read="${n.read_at?'false':'true'}">${n.read_at?'Mark Unread':'Mark Read'}</button>${n.alarm_id?`<button type="button" class="btn-outline btn-sm" data-alarm-open="${esc(n.alarm_id)}">View Alarm</button>`:''}</div></article>`;
  }
  function chime(){
    if(!sound||!audio||audio.state!=='running')return;
    const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.connect(gain);gain.connect(audio.destination);
    oscillator.frequency.value=660;gain.gain.setValueAtTime(.07,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.25);oscillator.start();oscillator.stop(audio.currentTime+.25);
  }
  async function loadInbox() {
    const seq=++inboxSequence;
    const q={...filters('notification'),page:notificationPage,limit:25,category:$('notification-category').value,unread:$('notification-unread').checked?'true':''};
    for(const field of ['from','to'])if($(`notification-${field}`).value)q[field]=new Date($(`notification-${field}`).value).toISOString();
    try{
      const [data,summary]=await Promise.all([api(`/notifications?${params(q)}`),api('/notifications?limit=5')]);
      if(stopped||seq!==inboxSequence)return;
      latestId=summary.latest_id;notificationTotal=data.total;
      text('notification-badge',summary.unread>99?'99+':summary.unread);
      $('notification-bell').setAttribute('aria-label',`${summary.unread} unread notifications`);
      $('notification-preview-list').innerHTML=summary.notifications.length?summary.notifications.map(n=>notificationCard(n,true)).join(''):'<p class="helper-note">No notifications yet.</p>';
      $('notifications-list').innerHTML=data.notifications.length?data.notifications.map(n=>notificationCard(n)).join(''):'<div class="glass-card management-empty">No notifications match your filters.</div>';
      text('notifications-feedback',`${data.total} matching events · ${summary.unread} unread · Saved on the server`);
      text('notifications-page',`Page ${notificationPage} of ${Math.max(1,Math.ceil(notificationTotal/25))}`);
      $('notifications-prev').disabled=notificationPage===1;$('notifications-next').disabled=notificationPage*25>=notificationTotal;
      if(lastSoundId!==null&&summary.notifications.some(n=>n.id>lastSoundId&&n.severity==='CRITICAL'&&!n.read_at))chime();
      lastSoundId=Math.max(lastSoundId||0,latestId);
    }catch(e){text('notifications-feedback',`Notification history unavailable: ${e.message}`);throw e;}
  }

  async function loadAlarms() {
    const data=await api(`/alarms?${params({...filters('alarm'),state:$('alarm-state').value,page:alarmPage,limit:25})}`);
    if(stopped)return;alarmTotal=data.total;
    text('alarm-active-count',`${data.active} active`);text('alarms-feedback',`${data.total} matching alarms`);
    $('alarm-list').innerHTML=data.alarms.length?data.alarms.map(a=>`<button class="alarm-row glass-card" type="button" data-alarm-open="${esc(a.alarm_id)}"><span><strong>${esc(a.title)}</strong><small>${esc(a.device_id)} · ${esc(time(a.raised_at))}</small></span><span class="ops-inline">${tag(a.severity)}${tag(a.state)}</span></button>`).join(''):'<div class="glass-card management-empty">No alarms match your filters.</div>';
    text('alarms-page',`Page ${alarmPage} of ${Math.max(1,Math.ceil(alarmTotal/25))}`);$('alarms-prev').disabled=alarmPage===1;$('alarms-next').disabled=alarmPage*25>=alarmTotal;
  }
  async function openAlarm(id) {
    const {alarm:a}=await api(`/alarms/${id}`);if(stopped)return;selectedAlarm=a;
    navigate('view-10');$('alarm-detail').classList.remove('hidden');
    $('alarm-detail').innerHTML=`<div class="flex-between"><h3>${esc(a.title)}</h3>${tag(a.state)}</div><p class="helper-note">Raised ${esc(time(a.raised_at))} · ${esc(a.device_id)}</p><ol class="alarm-timeline">${a.events.map(e=>`<li><strong>${esc(words(e.action))}</strong> · ${esc(e.actor)} · ${esc(time(e.timestamp))}<p>${esc(e.comment)}</p></li>`).join('')}</ol><details><summary>Observed evidence</summary><pre class="ops-code">${esc(JSON.stringify(a.evidence,null,2))}</pre></details>${a.state!=='RESOLVED'&&isAdmin()?'<form id="alarm-action-form" class="mt-16"><label for="alarm-comment">Response / recovery comment</label><input id="alarm-comment" minlength="3" maxlength="240" required /><div class="ops-inline mt-16"><button type="submit" class="btn-cyber" value="acknowledge">Acknowledge</button><button type="submit" class="btn-outline" value="resolve">Resolve with Recovery Evidence</button></div></form>':''}`;
    on('alarm-action-form','submit',e=>{e.preventDefault();const comment=$('alarm-comment').value,action=e.submitter.value;run(e.submitter,async()=>{await api(`/alarms/${id}/${action}`,{method:'POST',body:{comment}});await openAlarm(id);await loadAlarms();await loadInbox();});});
  }

  function endpointRow(e={},locked=false) {
    const kinds=['SENSOR','SWITCH','CAMERA','ACCESS'];
    return `<div class="endpoint-row"><div><label>Key<input data-ep="endpoint_key" value="${esc(e.endpoint_key||'')}" pattern="[a-z][a-z0-9_-]{0,47}" required ${locked?'disabled':''} /></label></div><div><label>Label<input data-ep="label" value="${esc(e.label||'')}" maxlength="80" required ${locked?'disabled':''} /></label></div><div><label>Kind<select data-ep="kind" ${locked?'disabled':''}>${kinds.map(k=>`<option ${k===e.kind?'selected':''}>${k}</option>`).join('')}</select></label></div><div><label>Unit<input data-ep="unit" value="${esc(e.unit||'')}" maxlength="24" ${locked?'disabled':''} /></label></div><label class="ops-check"><input data-ep="writable" type="checkbox" ${e.writable?'checked':''} ${locked?'disabled':''} /> Writable</label><button type="button" class="btn-outline btn-sm" data-endpoint-remove ${locked?'disabled':''}>Remove</button></div>`;
  }
  const templates={SENSORS:[{endpoint_key:'temperature',label:'Temperature',kind:'SENSOR',unit:'°C'}],CAMERA:[{endpoint_key:'snapshot',label:'Snapshot',kind:'CAMERA'}],ACCESS:[{endpoint_key:'door_state',label:'Access state',kind:'ACCESS'}],RELAY:[{endpoint_key:'relay',label:'Relay',kind:'SWITCH',writable:true}],MIXED:[{endpoint_key:'temperature',label:'Temperature',kind:'SENSOR',unit:'°C'},{endpoint_key:'relay',label:'Relay',kind:'SWITCH',writable:true}]};
  function openEditor(d=null) {
    if(!isAdmin())return;editingDevice=d;$('device-editor-form').reset();$('device-editor').classList.remove('hidden');
    const values={id:d?.device_id||'',name:d?.name||'',type:d?.device_type||'SENSORS',ip:d?.ip||'',location:d?.location||'room-001',stale:d?.stale_after_s||90,description:d?.description||'',transport:d?.transport||'MQTT_V1',port:d?.port||80,path:d?.path||'/telemetry'};
    for(const [key,value] of Object.entries(values))$(`device-${key}`).value=value;
    $('device-id').disabled=Boolean(d);$('device-type').disabled=Boolean(d?.slot);$('device-transport').disabled=Boolean(d?.slot);$('device-enabled').checked=d?d.enabled:true;
    $('endpoint-add').disabled=Boolean(d?.slot);$('endpoint-editor').innerHTML=(d?.endpoints||templates.SENSORS).map(e=>endpointRow(e,Boolean(d?.slot))).join('');
    text('device-editor-title',d?`Edit ${d.name}`:'Add Node');$('device-editor').scrollIntoView({behavior:'smooth',block:'start'});
  }
  const deviceBody=()=>({device_id:$('device-id').value,name:$('device-name').value,device_type:$('device-type').value,description:$('device-description').value,location:$('device-location').value,ip:$('device-ip').value,port:Number($('device-port').value),path:$('device-path').value,transport:$('device-transport').value,enabled:$('device-enabled').checked,stale_after_s:Number($('device-stale').value),
    endpoints:[...$('endpoint-editor').querySelectorAll('.endpoint-row')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-ep]')].map(input=>[input.dataset.ep,input.type==='checkbox'?input.checked:input.value]))),...(editingDevice?{version:editingDevice.version}:{})});

  async function detailLive(id) {
    const [current,history,commands]=await Promise.all([api(`/registry/${id}`),api(`/registry/${id}/history`),api(`/registry/${id}/commands`)]);
    if(stopped||selectedDevice!==id)return;
    const d=current.device;
    $('registry-detail').querySelectorAll('[data-switch-endpoint]').forEach(b=>{b.disabled=!isAdmin()||!d.enabled||d.in_maintenance||!d.fresh;});
    if($('device-capture'))$('device-capture').disabled=!d.enabled;
    $('device-live-values').innerHTML=d.endpoints.map(e=>`<div class="ops-value"><span>${esc(e.label)}</span><strong>${esc(formatValue(d,e))}</strong><small>${esc(e.kind)}${e.kind==='SENSOR'?` · ${d.telemetry_fresh?'Fresh':'Unverified / stale'}`:''}</small></div>`).join('');
    text('device-live-status',`${d.status} · Last observed: ${time(d.last_seen_at)} · Firmware: ${d.firmware_version||'Not reported'}`);
    $('device-history').innerHTML=`<table class="data-table"><thead><tr><th>Received</th><th>Reported values</th></tr></thead><tbody>${history.frames.length?history.frames.slice(0,15).map(f=>`<tr><td>${esc(time(f.received_at))}</td><td>${esc(Object.entries(f.values).map(([k,v])=>`${k}: ${v}`).join(' · '))}</td></tr>`).join(''):'<tr><td colspan="2">No validated samples recorded.</td></tr>'}</tbody></table>`;
    $('device-command-history').innerHTML=commands.commands.length?commands.commands.slice(0,10).map(c=>`<div class="ops-command"><span>${esc(c.endpoint_key)} → ${esc(c.requested_value)}</span>${tag(c.state)}<small>${esc(c.error||'Device report is not independent physical feedback')}</small></div>`).join(''):'<p class="helper-note">No generic device commands recorded.</p>';
  }
  async function openDevice(id) {
    const seq=++detailSequence,{device:d}=await api(`/registry/${id}`);if(stopped||seq!==detailSequence)return;selectedDevice=id;
    $('registry-detail').classList.remove('hidden');
    $('registry-detail').innerHTML=`<div class="flex-between"><div><span class="eyebrow">${esc(d.device_id)}</span><h3>${esc(d.name)}</h3></div><div class="ops-inline"><button type="button" id="device-detail-refresh" class="btn-outline btn-sm">Refresh</button>${isAdmin()?'<button type="button" id="device-detail-edit" class="btn-outline btn-sm">Edit Node</button>':''}</div></div><p>${esc(d.description)}</p><p id="device-live-status" class="helper-note"></p><div id="device-live-values" class="ops-values"></div><div class="ops-inline mt-16">${d.endpoints.some(e=>e.kind==='CAMERA')?'<button type="button" id="device-capture" class="btn-cyber">Capture Snapshot</button>':''}${isAdmin()?'<button type="button" id="device-probe" class="btn-outline">Test Connection</button>':''}${isAdmin()?d.endpoints.filter(e=>e.writable).map(e=>['ON','OFF'].map(value=>`<button type="button" class="btn-outline" data-switch-endpoint="${esc(e.endpoint_key)}" data-switch-value="${value}">${esc(e.label)} ${value}</button>`).join('')).join(''):''}</div><p id="device-probe-result" class="helper-note" role="status"></p><figure id="device-snapshot" class="hidden"><img id="device-snapshot-image" alt="Requested camera frame" /><figcaption id="device-snapshot-caption" class="helper-note"></figcaption></figure><details class="mt-16"><summary>Connection contract</summary><p class="helper-note">${esc(d.transport)} · ${esc(d.ip)}:${d.port}${esc(d.path)}</p>${d.mqtt_base?`<pre class="ops-code">${esc(d.mqtt_base)}/{telemetry,heartbeat,command,ack}\nBroker username: ${esc(d.device_id)}\nProvision credentials and per-device ACLs on the server.</pre>`:'<p class="helper-note">Use the supported profile documented in the release guide.</p>'}</details>${isAdmin()?`<form id="device-maintenance-form" class="ops-inline mt-20"><div><label for="maintenance-minutes">Maintenance minutes (0 = end)</label><input id="maintenance-minutes" type="number" min="0" max="1440" value="30" required /></div><div><label for="maintenance-reason">Reason</label><input id="maintenance-reason" minlength="3" maxlength="240" required /></div><button type="submit" class="btn-outline">Set Maintenance</button></form><p class="helper-note">Suppresses new alarms and generic commands; existing alarms remain visible. ${d.in_maintenance?`Active until ${esc(time(d.maintenance_until))}`:''}</p>`:''}<h4 class="management-subheading">Recent Samples</h4><div id="device-history" class="table-container"></div><h4 class="management-subheading">Command History</h4><div id="device-command-history"></div>`;
    on('device-detail-refresh','click',e=>run(e.currentTarget,()=>detailLive(id)));
    on('device-detail-edit','click',()=>openEditor(devices.find(n=>n.device_id===id)||d));
    on('device-probe','click',e=>run(e.currentTarget,async()=>{const result=await api(`/registry/${id}/probe`,{method:'POST',body:{}});text('device-probe-result',`${result.probe.ok?'Responded':'No fresh evidence'}: ${result.probe.note}`);await detailLive(id);}));
    on('device-maintenance-form','submit',e=>{e.preventDefault();const body={minutes:Number($('maintenance-minutes').value),reason:$('maintenance-reason').value};run(e.submitter,async()=>{await api(`/registry/${id}/maintenance`,{method:'POST',body});await loadRegistry();await openDevice(id);});});
    on('device-capture','click',e=>run(e.currentTarget,async()=>{
      const img=$('device-snapshot-image');let objectUrl;
      if(d.simulation){const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');ctx.fillStyle='#0f172a';ctx.fillRect(0,0,640,360);ctx.fillStyle='#38bdf8';ctx.font='24px sans-serif';ctx.fillText('SIMULATED CAMERA · NO HARDWARE',40,180);img.src=c.toDataURL('image/jpeg');}
      else{const blob=await api(`/registry/${id}/snapshot`,{responseType:'blob'});objectUrl=URL.createObjectURL(blob);img.onload=()=>URL.revokeObjectURL(objectUrl);img.onerror=()=>{URL.revokeObjectURL(objectUrl);text('device-probe-result','Camera frame could not be decoded');};img.src=objectUrl;}
      $('device-snapshot').classList.remove('hidden');text('device-snapshot-caption',d.simulation?'Synthetic simulator preview; no physical camera was queried.':`Requested frame · ${time(new Date().toISOString())} · No face identity or liveness is established.`);
    }));
    await detailLive(id);$('registry-detail').scrollIntoView({behavior:'smooth',block:'start'});
  }

  function populateRuleSensors(key='') {
    const d=devices.find(d=>d.device_id===$('rule-device').value);
    $('rule-endpoint').innerHTML=(d?.endpoints||[]).filter(e=>e.kind==='SENSOR').map(e=>`<option value="${esc(e.endpoint_key)}">${esc(e.label)} (${esc(e.unit||'numeric')})</option>`).join('');
    if(key)$('rule-endpoint').value=key;
  }
  function editRule(r=null) {
    editingRule=r;$('alarm-rule-form').reset();text('rule-editor-title',r?'Edit Rule':'New Rule');
    $('rule-device').disabled=Boolean(r);$('rule-endpoint').disabled=Boolean(r);
    if(r){$('rule-device').value=r.device_id;populateRuleSensors(r.endpoint_key);for(const [key,value] of Object.entries({name:r.name,severity:r.severity,threshold:r.threshold,clear:r.clear_threshold,hold:r.hold_s,'clear-hold':r.clear_hold_s}))$(`rule-${key}`).value=value;$('rule-enabled').checked=Boolean(r.enabled);}
    else populateRuleSensors();
  }
  async function loadRules() {
    const data=await api('/rules');if(stopped)return;rules=data.rules;
    $('alarm-rule-list').innerHTML=`<table class="data-table"><thead><tr><th>Rule</th><th>Sensor</th><th>Raise / recover</th><th>Delays</th><th>State</th><th>Actions</th></tr></thead><tbody>${rules.length?rules.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.device_id)} / ${esc(r.endpoint_key)}</td><td>≥ ${r.threshold} / ≤ ${r.clear_threshold}</td><td>${r.hold_s}s / ${r.clear_hold_s}s</td><td>${r.enabled?'Enabled':'Disabled'}</td><td>${isAdmin()?`<button type="button" class="btn-outline btn-sm" data-rule-edit="${esc(r.rule_id)}">Edit</button>`:'Read only'}</td></tr>`).join(''):'<tr><td colspan="6">No sensor rules configured. Device evidence and command failures are monitored separately.</td></tr>'}</tbody></table>`;
  }

  on('notification-bell','click',()=>{const closed=$('notification-preview').classList.toggle('hidden');$('notification-bell').setAttribute('aria-expanded',String(!closed));if(!closed)run(null,loadInbox);});
  on('notification-preview-close','click',()=>{$('notification-preview').classList.add('hidden');$('notification-bell').setAttribute('aria-expanded','false');});
  on('notification-open-center','click',()=>{$('notification-preview').classList.add('hidden');$('notification-bell').setAttribute('aria-expanded','false');navigate('view-9');});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('notification-preview').classList.add('hidden');$('notification-bell').setAttribute('aria-expanded','false');}},{signal});
  for(const container of ['notifications-list','notification-preview-list'])on(container,'click',e=>{
    const button=e.target.closest('[data-notification-id]');if(button)run(button,async()=>{await api(`/notifications/${button.dataset.notificationId}/read`,{method:'PUT',body:{read:button.dataset.read==='true'}});await loadInbox();});
    const alarm=e.target.closest('[data-alarm-open]');if(alarm){$('notification-preview').classList.add('hidden');run(alarm,()=>openAlarm(alarm.dataset.alarmOpen));}
  });
  on('notification-filter','submit',e=>{e.preventDefault();notificationPage=1;run(e.submitter,loadInbox);});
  on('notifications-read-all','click',e=>run(e.currentTarget,async()=>{await api('/notifications/read-all',{method:'PUT',body:{through_id:latestId}});await loadInbox();}));
  on('notifications-prev','click',()=>{if(notificationPage>1){notificationPage--;run(null,loadInbox);}});on('notifications-next','click',()=>{if(notificationPage*25<notificationTotal){notificationPage++;run(null,loadInbox);}});
  on('critical-sound','change',e=>run(null,async()=>{sound=e.target.checked;if(sound){audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();}await api('/notification-preferences',{method:'PUT',body:{critical_sound:sound}});}));
  on('retention-form','submit',e=>{e.preventDefault();const days=Number($('notification-retention').value);confirm({title:'Change history retention?',description:`Notifications and telemetry older than ${days} days will be cleaned automatically. Alarm and audit evidence is preserved.`,confirmLabel:'Save Retention',onConfirm:()=>run(e.submitter,async()=>{await api('/retention',{method:'PUT',body:{days}});notify('Retention saved',`${days} days`,'success');})});});
  on('alarm-filter','submit',e=>{e.preventDefault();alarmPage=1;run(e.submitter,loadAlarms);});on('alarms-refresh','click',e=>run(e.currentTarget,async()=>{await loadAlarms();await loadRules();}));
  on('alarms-prev','click',()=>{if(alarmPage>1){alarmPage--;run(null,loadAlarms);}});on('alarms-next','click',()=>{if(alarmPage*25<alarmTotal){alarmPage++;run(null,loadAlarms);}});
  on('alarm-list','click',e=>{const b=e.target.closest('[data-alarm-open]');if(b)run(b,()=>openAlarm(b.dataset.alarmOpen));});
  on('registry-refresh','click',e=>run(e.currentTarget,loadRegistry));on('device-new','click',()=>openEditor());on('device-editor-close','click',()=>{$('device-editor').classList.add('hidden');editingDevice=null;});
  on('registry-list','click',e=>{const b=e.target.closest('[data-device-open]');if(b)run(b,()=>openDevice(b.dataset.deviceOpen));});
  on('endpoint-add','click',()=>$('endpoint-editor').insertAdjacentHTML('beforeend',endpointRow()));on('endpoint-editor','click',e=>{if(e.target.closest('[data-endpoint-remove]'))e.target.closest('.endpoint-row').remove();});
  on('device-type','change',()=>{const type=$('device-type').value;$('endpoint-editor').innerHTML=templates[type].map(e=>endpointRow(e)).join('');$('device-transport').value=type==='CAMERA'?'CAMERA_JPEG':'MQTT_V1';$('device-path').value=type==='CAMERA'?'/capture.jpg':'/telemetry';});
  on('device-editor-form','submit',e=>{e.preventDefault();const body=deviceBody(),old=editingDevice;run(e.submitter,async()=>{const {device}=await api(old?`/registry/${old.device_id}`:'/registry',{method:old?'PUT':'POST',body});$('device-editor').classList.add('hidden');editingDevice=null;await loadRegistry();await openDevice(device.device_id);notify('Registry saved','Saved centrally. Device firmware and broker provisioning remain separate.','success');document.dispatchEvent(new Event('lci-registry-updated'));});});
  on('registry-detail','click',e=>{const b=e.target.closest('[data-switch-endpoint]');if(!b||!isAdmin())return;const id=selectedDevice,body={endpoint_key:b.dataset.switchEndpoint,value:b.dataset.switchValue};confirm({title:`Set ${body.endpoint_key} ${body.value}?`,description:'Send an expiring command to this registered device. A device report does not establish physical movement.',targetNode:id,confirmLabel:'Send Command',onConfirm:()=>run(b,async()=>{const {command}=await api(`/registry/${id}/commands`,{method:'POST',body});notify('Command status',words(command.state),command.state==='UNAVAILABLE'?'error':'info');await detailLive(id);})});});
  on('rule-device','change',()=>populateRuleSensors());on('rule-new','click',()=>editRule());on('rule-cancel','click',()=>editRule());on('alarm-rule-list','click',e=>{const b=e.target.closest('[data-rule-edit]');if(b)editRule(rules.find(r=>r.rule_id===b.dataset.ruleEdit));});
  on('alarm-rule-form','submit',e=>{e.preventDefault();const old=editingRule,body={device_id:$('rule-device').value,endpoint_key:$('rule-endpoint').value,name:$('rule-name').value,severity:$('rule-severity').value,threshold:Number($('rule-threshold').value),clear_threshold:Number($('rule-clear').value),hold_s:Number($('rule-hold').value),clear_hold_s:Number($('rule-clear-hold').value),enabled:$('rule-enabled').checked,...(old?{version:old.version}:{})};run(e.submitter,async()=>{await api(old?`/rules/${old.rule_id}`:'/rules',{method:old?'PUT':'POST',body});editRule();await loadRules();notify('Rule saved','Monitoring rule saved; physical automation is unchanged.','success');});});

  document.addEventListener('lci-view-changed',e=>{if(e.detail==='view-9')run(null,loadInbox);if(e.detail==='view-10')run(null,async()=>{await loadAlarms();await loadRules();});if(e.detail==='view-11')run(null,loadRegistry);},{signal});
  document.addEventListener('lci-settings-updated',()=>run(null,loadRegistry),{signal});
  function connect(){if(stopped)return;ws=new WebSocket(wsUrl());ws.onmessage=()=>{clearTimeout(debounce);debounce=setTimeout(()=>run(null,async()=>{await loadInbox();if(active('view-10'))await loadAlarms();}),350);};ws.onclose=()=>{if(!stopped)reconnect=setTimeout(connect,5000);};}
  const poll=setInterval(async()=>{if(stopped||document.hidden||pollBusy)return;pollBusy=true;try{await loadInbox();if(active('view-11')){await loadRegistry();if(selectedDevice)await detailLive(selectedDevice);}if(active('view-10'))await loadAlarms();}catch{}finally{pollBusy=false;}},10000);
  signal.addEventListener('abort',()=>{stopped=true;clearInterval(poll);clearTimeout(reconnect);clearTimeout(debounce);ws?.close();audio?.close();for(const id of ['notifications-list','notification-preview-list','alarm-list','alarm-detail','registry-detail'])$(id).innerHTML='';$('notification-preview').classList.add('hidden');$('notification-badge').textContent='0';$('registry-detail').classList.add('hidden');$('device-editor').classList.add('hidden');$('device-editor-form').reset();},{once:true});
  gates();connect();run(null,async()=>{await loadRegistry();await loadInbox();await loadRules();await loadAlarms();const [release,prefs]=await Promise.all([api('/release'),api('/notification-preferences')]);if(stopped)return;sound=prefs.critical_sound;$('critical-sound').checked=sound;$('notification-retention').value=release.retention_days;const b=$('release-banner');b.classList.remove('hidden');b.classList.toggle('simulation',release.simulation);b.innerHTML=release.simulation?'SIMULATION · Isolated database · No physical actuation':'SOFTWARE RELEASE CANDIDATE · Hardware acceptance pending';if(release.simulation){b.insertAdjacentHTML('beforeend','<div class="ops-inline mt-12"><label for="simulator-scenario">Scenario</label><select id="simulator-scenario"><option value="normal">Normal</option><option value="alarm">High sensor alarm</option><option value="offline">Device disconnected</option><option value="command-failure">Command timeout</option></select><button id="simulator-apply" type="button" class="btn-outline ops-admin">Run Scenario</button></div>');on('simulator-apply','click',e=>run(e.currentTarget,async()=>{await api('/simulator',{method:'POST',body:{scenario:$('simulator-scenario').value}});}));gates();}});
}
