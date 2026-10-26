import crypto from 'node:crypto';
import { managementError } from './facilityManagement.js';
import { frameSchema, heartbeatSchema, ackSchema } from '../validators/operationsSchemas.js';

const iso = ms => new Date(ms).toISOString();
const error = (status, code, message) => { throw managementError(status, code, message); };
const parse = value => JSON.parse(value || '{}');
const cleanTopic = id => `lci/v1/devices/${id}`;
export const RELEASE_VERSION = '1.1.0-rc.1';

export class ReleaseOperations {
  constructor({ db, management, config, mqttService, wsGateway, clock = Date.now, httpFetch = fetch }) {
    Object.assign(this,{ db, management, config, mqttService, wsGateway, clock, httpFetch });
    this.simulation = Boolean(config.simulatorMode);
    this.lastNotificationId = 0; this.lastCleanup = 0;
    this.startedAt=iso(this.clock());
    this.seed();
    // Unobserved in-flight commands cannot be replayed after a restart.
    for (const c of db.prepare("SELECT * FROM device_commands WHERE state IN ('PUBLISHED','ACKNOWLEDGED')").all()) this.failCommand(c,'FAILED','SERVER_RESTART');
    this.timer = setInterval(() => this.tick(),1000); this.timer.unref();
  }

  seed() {
    const profiles = {
      node1: { type:'ACCESS', endpoints:[['door_state','Door state','ACCESS','']] },
      node2: { type:'MIXED', endpoints:[['temperature','Temperature','SENSOR','°C'],['humidity','Humidity','SENSOR','%'],['smoke_gas_level','MQ-2 reading','SENSOR','raw'],['fan_relay','Fan','SWITCH',''],['light_state','Light','SWITCH','']] },
      node3: { type:'CAMERA', endpoints:[['snapshot','Snapshot','CAMERA','']] }
    };
    for(const slot of Object.keys(profiles)) {
      const {name,ip}=this.management.settings().nodes[slot], id=this.config[`${slot}Id`], p=profiles[slot];
      this.db.prepare(`INSERT OR IGNORE INTO device_registry(device_id,slot,name,device_type,transport,ip,path,created_at,updated_at)
        VALUES(?,?,?,?,'LEGACY_V1',?,?,?,?)`).run(id,slot,name,p.type,ip,slot==='node3'?'/capture.jpg':'/telemetry',iso(this.clock()),iso(this.clock()));
      for(const [key,label,kind,unit] of p.endpoints) this.db.prepare('INSERT OR IGNORE INTO device_endpoints(device_id,endpoint_key,label,kind,unit) VALUES(?,?,?,?,?)').run(id,key,label,kind,unit);
    }
  }

  notify({ category='SYSTEM', severity='INFO', title, message='', device_id=null, alarm_id=null, audience='ALL', owner_id=null, dedup_key=null, cooldown_s=0 }) {
    if(dedup_key && cooldown_s>0 && this.db.prepare('SELECT 1 FROM notifications WHERE dedup_key=? AND timestamp>=?').get(dedup_key,iso(this.clock()-cooldown_s*1000))) return;
    this.db.prepare('INSERT INTO notifications(timestamp,category,severity,title,message,device_id,alarm_id,audience,owner_id,dedup_key) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(iso(this.clock()),category,severity,title.slice(0,120),message.slice(0,300),device_id,alarm_id,audience,owner_id,dedup_key);
  }

  device(id) {
    const d=this.db.prepare('SELECT * FROM device_registry WHERE device_id=?').get(id);
    if(!d)error(404,'DEVICE_NOT_FOUND','Device was not found');
    const o=this.db.prepare('SELECT * FROM device_observations WHERE device_id=?').get(id);
    const legacy=d.slot ? this.mqttService.getHealthStatus().observed_nodes?.[id] : null;
    const last=[o?.last_seen_at,d.heartbeat_at,legacy?.last_seen_at].filter(Boolean).sort().at(-1)||null;
    const age=last ? Math.max(0,this.clock()-Date.parse(last)):null;
    const telemetryAge=o ? Math.max(0,this.clock()-Date.parse(o.last_seen_at)):null;
    const transportUp=this.simulation || !['LEGACY_V1','MQTT_V1'].includes(d.transport) || this.mqttService.isConnected();
    return { ...d,enabled:Boolean(d.enabled),endpoints:this.db.prepare('SELECT * FROM device_endpoints WHERE device_id=? ORDER BY endpoint_key').all(id).map(e=>({...e,writable:Boolean(e.writable)})),
      values:parse(o?.values_json),last_seen_at:last,age_ms:age,telemetry_age_ms:telemetryAge,
      fresh:Boolean(d.enabled && transportUp && age!==null && age<=d.stale_after_s*1000),
      telemetry_fresh:Boolean(d.enabled && transportUp && telemetryAge!==null && telemetryAge<=d.stale_after_s*1000),
      status:!d.enabled?'DISABLED':!transportUp?'UNKNOWN':age===null?'UNKNOWN':age>d.stale_after_s*1000?'STALE':'ONLINE',
      in_maintenance:Boolean(d.maintenance_until && d.maintenance_until>iso(this.clock())),
      mqtt_base:d.transport==='MQTT_V1'?cleanTopic(id):null,simulation:this.simulation };
  }
  listDevices() { return this.db.prepare('SELECT device_id FROM device_registry ORDER BY slot IS NULL,slot,created_at,device_id').all().map(d=>this.device(d.device_id)); }

  validateLegacySettings(data) {
    for(const [slot,n] of Object.entries(data.nodes)) {
      const current=this.db.prepare('SELECT port FROM device_registry WHERE slot=?').get(slot);
      if(this.db.prepare('SELECT 1 FROM device_registry WHERE ip=? AND port=? AND enabled=1 AND slot IS NULL').get(n.ip,current?.port||80))
        error(409,'DEVICE_ADDRESS_CONFLICT','This address is assigned to another registered node');
    }
  }

  syncLegacy(settings) {
    // Two-step update allows atomic swaps of two built-in addresses.
    this.db.prepare('UPDATE device_registry SET enabled=0 WHERE slot IS NOT NULL AND enabled=1').run();
    for(const [slot,n] of Object.entries(settings.nodes)) this.db.prepare('UPDATE device_registry SET name=?,ip=?,version=version+1,updated_at=? WHERE slot=?').run(n.name,n.ip,iso(this.clock()),slot);
    // Called with remembered enable state to avoid re-enabling a disabled node.
    for(const id of this._legacyEnabled || []) this.db.prepare('UPDATE device_registry SET enabled=1 WHERE device_id=?').run(id);
  }
  beforeLegacySync(data) {
    this.validateLegacySettings(data);
    this._legacyEnabled=this.db.prepare('SELECT device_id FROM device_registry WHERE slot IS NOT NULL AND enabled=1').all().map(d=>d.device_id);
  }

  saveDevice(data, actor, requestId, existingId=null) {
    const result=this.db.transaction(()=>{
      const old=existingId?this.device(existingId):null;
      if(!old && this.db.prepare('SELECT COUNT(*) AS n FROM device_registry').get().n>=256)error(409,'REGISTRY_LIMIT','This release supports up to 256 registered nodes');
      if(old && (data.device_id!==existingId || data.version!==old.version))error(409,'VERSION_CONFLICT','Refresh the device before saving; identity is immutable');
      if(!old && this.db.prepare('SELECT 1 FROM device_registry WHERE device_id=?').get(data.device_id))error(409,'DEVICE_EXISTS','Device identity is already registered');
      if(!old && ['lci_backend','node1_access','node2_env','vision_service'].includes(data.device_id))error(400,'RESERVED_ID','This identity is reserved for a service');
      if(data.transport==='LEGACY_V1' && (!old?.slot || data.device_type!==old.device_type))error(400,'LEGACY_PROFILE_LOCKED','Built-in protocol profiles cannot be assigned to additional devices');
      if(old?.slot && (data.transport!=='LEGACY_V1' || JSON.stringify(data.endpoints.map(e=>[e.endpoint_key,e.kind,e.writable]).sort())!==JSON.stringify(old.endpoints.map(e=>[e.endpoint_key,e.kind,e.writable]).sort())))error(409,'LEGACY_PROFILE_LOCKED','Use the existing built-in endpoint profile');
      if(data.enabled && this.db.prepare('SELECT 1 FROM device_registry WHERE ip=? AND port=? AND enabled=1 AND device_id!=?').get(data.ip,data.port,data.device_id))error(409,'DEVICE_ADDRESS_CONFLICT','An enabled device already uses this address and port');
      // Endpoint shape changes are a new device contract; reject while rules/commands still depend on it.
      if(old && !old.slot) {
        const referenced=this.db.prepare('SELECT endpoint_key FROM alarm_rules WHERE device_id=? AND enabled=1').all(old.device_id);
        if(referenced.some(r=>!data.endpoints.some(e=>e.endpoint_key===r.endpoint_key && e.kind==='SENSOR')))error(409,'ENDPOINT_IN_USE','Disable dependent rules before removing their sensor endpoint');
        if(this.db.prepare("SELECT 1 FROM device_commands WHERE device_id=? AND state IN ('PUBLISHED','ACKNOWLEDGED')").get(old.device_id))error(409,'COMMAND_PENDING','Wait for the active command before editing this device');
      }
      const timestamp=iso(this.clock());
      if(old) this.db.prepare(`UPDATE device_registry SET name=?,description=?,location=?,device_type=?,transport=?,ip=?,port=?,path=?,enabled=?,stale_after_s=?,version=version+1,updated_at=? WHERE device_id=?`)
        .run(data.name,data.description,data.location,data.device_type,data.transport,data.ip,data.port,data.path,Number(data.enabled),data.stale_after_s,timestamp,existingId);
      else this.db.prepare(`INSERT INTO device_registry(device_id,name,description,location,device_type,transport,ip,port,path,enabled,stale_after_s,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(data.device_id,data.name,data.description,data.location,data.device_type,data.transport,data.ip,data.port,data.path,Number(data.enabled),data.stale_after_s,timestamp,timestamp);
      this.db.prepare('DELETE FROM device_endpoints WHERE device_id=?').run(data.device_id);
      for(const e of data.endpoints)this.db.prepare('INSERT INTO device_endpoints(device_id,endpoint_key,label,kind,unit,writable) VALUES(?,?,?,?,?,?)').run(data.device_id,e.endpoint_key,e.label,e.kind,e.unit,Number(e.writable));
      if(old?.slot) {
        const s=this.management.settings();s.nodes[old.slot]={name:data.name,ip:data.ip};
        const {revision,updated_at,updated_by,...document}=s;
        this.db.prepare('UPDATE facility_settings SET revision=revision+1,document=?,updated_at=?,updated_by=? WHERE id=1').run(JSON.stringify(document),timestamp,actor.username);
      }
      if(old && (old.ip!==data.ip || old.port!==data.port || old.transport!==data.transport)) {
        this.db.prepare('DELETE FROM device_observations WHERE device_id=?').run(data.device_id);
        this.db.prepare('UPDATE device_registry SET heartbeat_at=NULL WHERE device_id=?').run(data.device_id);
      }
      this.management.audit(actor,old?'DEVICE_UPDATED':'DEVICE_CREATED',data.device_id,{type:data.device_type,transport:data.transport,enabled:data.enabled},requestId);
      this.notify({category:'DEVICE',title:old?'Device configuration updated':'Device registered',message:data.name,device_id:data.device_id,dedup_key:`DEVICE_CONFIG:${data.device_id}`,cooldown_s:5});
      if(!data.enabled){this.resolveDeviceAlarms(data.device_id,actor.username,'Device disabled; monitoring suppressed');this.mqttService.nodeHeartbeats?.delete(data.device_id);}
      return this.device(data.device_id);
    })();
    this.management.applyRuntimeIps(this.management.settings());
    return result;
  }

  maintenance(id,data,actor,requestId) {
    this.device(id);
    return this.db.transaction(()=>{
      const until=data.minutes ? iso(this.clock()+data.minutes*60000):null;
      this.db.prepare('UPDATE device_registry SET maintenance_until=?,maintenance_reason=?,version=version+1,updated_at=? WHERE device_id=?').run(until,data.reason,iso(this.clock()),id);
      this.management.audit(actor,'DEVICE_MAINTENANCE',id,{until,reason:data.reason},requestId);
      this.db.prepare('UPDATE alarm_rules SET pending_since=NULL,recovery_since=NULL WHERE device_id=?').run(id);
      // Maintenance does not hide or resolve already-active problems.
      return this.device(id);
    })();
  }

  ingest(id, raw) {
    const parsed=frameSchema.safeParse(raw);
    if(!parsed.success || parsed.data.device_id!==id)return {ok:false,error:'INVALID_FRAME'};
    const d=this.device(id), p=parsed.data;
    if(!d.enabled)return {ok:false,error:'DEVICE_DISABLED'};
    if(Object.keys(p.values).length>24 || !Object.keys(p.values).length || Object.entries(p.values).some(([key,v])=>{
      const e=d.endpoints.find(e=>e.endpoint_key===key);
      return !e || (e.kind==='SENSOR' && typeof v!=='number') || (e.kind==='SWITCH' && !['ON','OFF'].includes(v)) || (e.kind==='ACCESS' && !['OPEN','CLOSED','LOCKED','UNLOCKED'].includes(v)) || (e.kind==='CAMERA' && typeof v!=='boolean');
    }))return {ok:false,error:'ENDPOINT_CONTRACT_MISMATCH'};
    const current=this.db.prepare('SELECT boot_id,seq FROM device_observations WHERE device_id=?').get(id);
    if(current && ((current.boot_id===p.boot_id && p.seq<=current.seq) || (current.boot_id!==p.boot_id && this.db.prepare('SELECT 1 FROM device_frames WHERE device_id=? AND boot_id=?').get(id,p.boot_id))))return {ok:false,error:'DUPLICATE_OR_OLD_FRAME'};
    const timestamp=iso(this.clock());
    return this.db.transaction(()=>{
      const inserted=this.db.prepare('INSERT OR IGNORE INTO device_frames(device_id,boot_id,seq,received_at,values_json) VALUES(?,?,?,?,?)').run(id,p.boot_id,p.seq,timestamp,JSON.stringify(p.values));
      if(!inserted.changes)return {ok:false,error:'DUPLICATE_OR_OLD_FRAME'};
      this.db.prepare(`INSERT INTO device_observations(device_id,boot_id,seq,last_seen_at,values_json) VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET boot_id=excluded.boot_id,seq=excluded.seq,last_seen_at=excluded.last_seen_at,values_json=excluded.values_json`).run(id,p.boot_id,p.seq,timestamp,JSON.stringify(p.values));
      this.evaluateDevice(id);
      return {ok:true};
    })();
  }
  ingestLegacy(id,values,meta={}) {
    if(!this.db.prepare('SELECT 1 FROM device_registry WHERE device_id=?').get(id))return;
    const d=this.device(id), allowed=Object.fromEntries(Object.entries(values).filter(([k,v])=>d.endpoints.some(e=>e.endpoint_key===k && e.kind==='SENSOR') && typeof v==='number'));
    if(!Object.keys(allowed).length)return;
    const current=this.db.prepare('SELECT seq FROM device_observations WHERE device_id=?').get(id);
    this.ingest(id,{schema_version:1,device_id:id,boot_id:meta.boot_id || 'legacy-server-stream',seq:meta.seq ?? (current?.seq||0)+1,values:allowed});
  }
  heartbeat(id,raw) {
    const p=heartbeatSchema.safeParse(raw);
    if(!p.success || p.data.device_id!==id)return {ok:false,error:'INVALID_HEARTBEAT'};
    const d=this.device(id); if(!d.enabled)return {ok:false,error:'DEVICE_DISABLED'};
    this.db.prepare('UPDATE device_registry SET heartbeat_at=?,firmware_version=COALESCE(?,firmware_version) WHERE device_id=?').run(iso(this.clock()),p.data.firmware_version||null,id);
    return {ok:true};
  }

  async probe(id) {
    const d=this.device(id);
    if(!d.enabled)error(409,'DEVICE_DISABLED','Device is disabled');
    if(this.simulation)return {device:d,probe:{kind:'SIMULATION',ok:d.fresh,note:'Isolated simulation evidence only; no upstream network request'}};
    if(d.transport==='MQTT_V1' || (d.slot && d.slot!=='node3'))return {device:d,probe:{kind:'PASSIVE',ok:d.fresh,note:'Status uses validated incoming device observations; no network scan was performed.'}};
    if(d.device_type==='CAMERA')return {device:d,probe:{kind:'CAMERA',ok:d.fresh,note:'Use Capture to test the configured JPEG endpoint.'}};
    let response;
    try {
      response=await this.httpFetch(`http://${d.ip}:${d.port}${d.path}`,{redirect:'manual',signal:AbortSignal.timeout(3000),headers:{Accept:'application/json'}});
      if(response.status!==200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))throw new Error('Invalid JSON response');
      const reader=response.body.getReader(), parts=[];let size=0;
      try{for(;;){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>32768)throw new Error('Response too large');parts.push(Buffer.from(c.value));}}
      finally{await reader.cancel().catch(()=>{});}
      const result=this.ingest(id,JSON.parse(Buffer.concat(parts).toString('utf8')));
      if(!result.ok && result.error!=='DUPLICATE_OR_OLD_FRAME')throw new Error('Contract mismatch');
      return {device:this.device(id),probe:{kind:'HTTP_JSON',ok:true,ingest:result,note:result.ok?'New validated sample stored':'Endpoint responded; duplicate sample did not refresh telemetry age'}};
    }catch{await response?.body?.cancel().catch(()=>{});error(502,'PROBE_FAILED','Endpoint did not return a valid bounded v1 JSON telemetry frame');}
  }

  saveRule(data,actor,requestId,id=null) {
    const d=this.device(data.device_id);
    if(!d.endpoints.some(e=>e.endpoint_key===data.endpoint_key && e.kind==='SENSOR'))error(400,'RULE_ENDPOINT_INVALID','Choose a registered numeric sensor');
    return this.db.transaction(()=>{
      const previous=id?this.db.prepare('SELECT * FROM alarm_rules WHERE rule_id=?').get(id):null;
      if(id && !previous)error(404,'RULE_NOT_FOUND','Rule was not found');
      if(previous && data.version!==previous.version)error(409,'VERSION_CONFLICT','Refresh the rule before saving');
      if(previous && (previous.device_id!==data.device_id || previous.endpoint_key!==data.endpoint_key))error(409,'RULE_TARGET_IMMUTABLE','Create a new rule for a different sensor');
      const ruleId=id||crypto.randomUUID();
      if(id)this.db.prepare(`UPDATE alarm_rules SET name=?,severity=?,threshold=?,clear_threshold=?,hold_s=?,clear_hold_s=?,enabled=?,version=version+1,pending_since=NULL,recovery_since=NULL WHERE rule_id=?`).run(data.name,data.severity,data.threshold,data.clear_threshold,data.hold_s,data.clear_hold_s,Number(data.enabled),id);
      else this.db.prepare('INSERT INTO alarm_rules(rule_id,device_id,endpoint_key,name,severity,threshold,clear_threshold,hold_s,clear_hold_s,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(ruleId,data.device_id,data.endpoint_key,data.name,data.severity,data.threshold,data.clear_threshold,data.hold_s,data.clear_hold_s,Number(data.enabled),iso(this.clock()));
      if(previous)this.resolveByKey(`RULE:${ruleId}`,actor.username,data.enabled?'Rule configuration changed; awaiting new evaluation':'Rule disabled; monitoring suppressed');
      this.management.audit(actor,id?'ALARM_RULE_UPDATED':'ALARM_RULE_CREATED',ruleId,{device_id:data.device_id,endpoint_key:data.endpoint_key,enabled:data.enabled},requestId);
      return this.db.prepare('SELECT * FROM alarm_rules WHERE rule_id=?').get(ruleId);
    })();
  }
  raise({key,device_id,rule_id=null,title,severity='WARNING',evidence={}}) {
    const existing=this.db.prepare("SELECT * FROM alarms WHERE dedup_key=? AND state!='RESOLVED'").get(key);
    if(existing)return existing.alarm_id;
    const id=crypto.randomUUID(), timestamp=iso(this.clock());
    this.db.prepare("INSERT INTO alarms(alarm_id,dedup_key,device_id,rule_id,title,severity,state,raised_at,evidence) VALUES(?,?,?,?,?,?,'ACTIVE',?,?)").run(id,key,device_id,rule_id,title,severity,timestamp,JSON.stringify(evidence));
    this.db.prepare("INSERT INTO alarm_events(alarm_id,timestamp,actor,action) VALUES(?,?,'system','RAISED')").run(id,timestamp);
    this.notify({category:'ALARM',severity,title,message:'New alarm requires operator review.',device_id,alarm_id:id});
    return id;
  }
  resolveByKey(key,actor,reason) {
    const a=this.db.prepare("SELECT * FROM alarms WHERE dedup_key=? AND state!='RESOLVED'").get(key);
    if(!a)return;
    this.db.prepare("UPDATE alarms SET state='RESOLVED',resolved_at=?,resolved_by=?,resolution=? WHERE alarm_id=?").run(iso(this.clock()),actor,reason,a.alarm_id);
    this.db.prepare("INSERT INTO alarm_events(alarm_id,timestamp,actor,action,comment) VALUES(?,?,?,'RESOLVED',?)").run(a.alarm_id,iso(this.clock()),actor,reason);
    this.notify({category:'ALARM',severity:'INFO',title:'Alarm resolved',message:`${a.title}: ${reason}`,device_id:a.device_id,alarm_id:a.alarm_id});
  }
  resolveDeviceAlarms(id,actor,reason) { for(const a of this.db.prepare("SELECT dedup_key FROM alarms WHERE device_id=? AND state!='RESOLVED'").all(id))this.resolveByKey(a.dedup_key,actor,reason); }
  alarmAction(id,action,comment,actor) {
    return this.db.transaction(()=>{
      const a=this.db.prepare('SELECT * FROM alarms WHERE alarm_id=?').get(id);if(!a)error(404,'ALARM_NOT_FOUND','Alarm was not found');
      if(a.state==='RESOLVED')error(409,'ALARM_CLOSED','Alarm is already resolved');
      if(action==='acknowledge') {
        if(a.state==='ACKNOWLEDGED')return this.alarmDetail(id);
        this.db.prepare("UPDATE alarms SET state='ACKNOWLEDGED',acknowledged_at=?,acknowledged_by=? WHERE alarm_id=?").run(iso(this.clock()),actor.username,id);
        this.db.prepare("INSERT INTO alarm_events(alarm_id,timestamp,actor,action,comment) VALUES(?,?,?,'ACKNOWLEDGED',?)").run(id,iso(this.clock()),actor.username,comment);
        this.notify({category:'ALARM',title:'Alarm acknowledged',message:a.title,device_id:a.device_id,alarm_id:id});
      } else {
        // An operator cannot claim recovery while a monitored condition is still present.
        const d=this.device(a.device_id);
        if(a.dedup_key.startsWith('RULE:')) {
          const r=this.db.prepare('SELECT * FROM alarm_rules WHERE rule_id=?').get(a.rule_id);
          if(r?.enabled && (!d.telemetry_fresh || typeof d.values[r.endpoint_key]!=='number' || d.values[r.endpoint_key]>r.clear_threshold))error(409,'CONDITION_STILL_ACTIVE','Wait for fresh recovery evidence or disable the rule with an audited reason');
        } else if(a.dedup_key.startsWith('STALE:') && !this.monitorFresh(d))error(409,'CONDITION_STILL_ACTIVE','Device data has not recovered');
        this.resolveByKey(a.dedup_key,actor.username,comment);
      }
      return this.alarmDetail(id);
    })();
  }
  alarmDetail(id) {
    const a=this.db.prepare('SELECT * FROM alarms WHERE alarm_id=?').get(id);if(!a)error(404,'ALARM_NOT_FOUND','Alarm was not found');
    return {...a,evidence:parse(a.evidence),events:this.db.prepare('SELECT * FROM alarm_events WHERE alarm_id=? ORDER BY id').all(id)};
  }
  monitorFresh(d) { return d.endpoints.some(e=>e.kind==='SENSOR')?d.telemetry_fresh:d.fresh; }
  evaluateDevice(id) {
    const d=this.device(id);if(!d.enabled || d.in_maintenance)return;
    if(this.monitorFresh(d))this.resolveByKey(`STALE:${id}`,'system','Fresh device evidence received');
    for(const r of this.db.prepare('SELECT * FROM alarm_rules WHERE device_id=? AND enabled=1').all(id)) {
      const value=d.values[r.endpoint_key];
      if(!d.telemetry_fresh || typeof value!=='number') { this.db.prepare('UPDATE alarm_rules SET pending_since=NULL,recovery_since=NULL WHERE rule_id=?').run(r.rule_id);continue; }
      const active=this.db.prepare("SELECT alarm_id FROM alarms WHERE dedup_key=? AND state!='RESOLVED'").get(`RULE:${r.rule_id}`);
      if(!active && value>=r.threshold) {
        const since=r.pending_since||iso(this.clock());this.db.prepare('UPDATE alarm_rules SET pending_since=?,recovery_since=NULL WHERE rule_id=?').run(since,r.rule_id);
        if(this.clock()-Date.parse(since)>=r.hold_s*1000)this.raise({key:`RULE:${r.rule_id}`,device_id:id,rule_id:r.rule_id,title:r.name,severity:r.severity,evidence:{endpoint_key:r.endpoint_key,value,unit:d.endpoints.find(e=>e.endpoint_key===r.endpoint_key)?.unit,threshold:r.threshold}});
      } else if(active && value<=r.clear_threshold) {
        const since=r.recovery_since||iso(this.clock());this.db.prepare('UPDATE alarm_rules SET recovery_since=?,pending_since=NULL WHERE rule_id=?').run(since,r.rule_id);
        if(this.clock()-Date.parse(since)>=r.clear_hold_s*1000){this.resolveByKey(`RULE:${r.rule_id}`,'system','Fresh readings remained below the recovery threshold');this.db.prepare('UPDATE alarm_rules SET pending_since=NULL,recovery_since=NULL WHERE rule_id=?').run(r.rule_id);}
      } else this.db.prepare('UPDATE alarm_rules SET pending_since=NULL,recovery_since=NULL WHERE rule_id=?').run(r.rule_id);
    }
  }

  async command(id,body,actor) {
    const d=this.device(id),e=d.endpoints.find(e=>e.endpoint_key===body.endpoint_key);
    if(!d.enabled || d.in_maintenance)error(409,'DEVICE_NOT_CONTROLLABLE','Device is disabled or in maintenance');
    if(d.transport!=='MQTT_V1' || !e?.writable || e.kind!=='SWITCH')error(400,'COMMAND_UNSUPPORTED','This endpoint has no supported writable MQTT switch adapter');
    if(!d.fresh)error(409,'DEVICE_NOT_FRESH','A fresh device observation is required before control');
    const commandId=crypto.randomUUID(),timestamp=iso(this.clock()),expires=iso(this.clock()+5000);
    this.db.prepare("INSERT INTO device_commands(command_id,device_id,endpoint_key,requested_value,state,actor,issued_at,expires_at,updated_at) VALUES(?,?,?,?,'PUBLISHED',?,?,?,?)").run(commandId,id,e.endpoint_key,body.value,actor.username,timestamp,expires,timestamp);
    const c=this.db.prepare('SELECT * FROM device_commands WHERE command_id=?').get(commandId);
    try {
      if(this.simulation) {
        if(!this.simulationDriver)throw new Error('No isolated simulation driver');
        await this.simulationDriver(c);
      } else await this.mqttService.publishCommand(`${cleanTopic(id)}/command`,{schema_version:1,command_id:commandId,device_id:id,endpoint_key:e.endpoint_key,value:body.value,issued_at:timestamp,expires_at:expires});
    } catch {this.failCommand(c,'UNAVAILABLE','PUBLISH_UNAVAILABLE');}
    this.management.audit(actor,'DEVICE_COMMAND',id,{command_id:commandId,endpoint_key:e.endpoint_key,value:body.value});
    return this.db.prepare('SELECT * FROM device_commands WHERE command_id=?').get(commandId);
  }
  failCommand(c,state,reason) {
    this.db.prepare('UPDATE device_commands SET state=?,error=?,updated_at=? WHERE command_id=?').run(state,reason,iso(this.clock()),c.command_id);
    this.notify({category:'COMMAND',severity:'WARNING',title:'Device command failed',message:`${c.endpoint_key}: ${reason}`,device_id:c.device_id,audience:'ADMIN'});
    this.raise({key:`COMMAND:${c.command_id}`,device_id:c.device_id,title:`Command ${c.endpoint_key}: ${reason}`,evidence:{command_id:c.command_id}});
  }
  acknowledgeCommand(id,raw) {
    const p=ackSchema.safeParse(raw);if(!p.success || p.data.device_id!==id)return {ok:false,error:'INVALID_ACK'};
    const a=p.data,c=this.db.prepare('SELECT * FROM device_commands WHERE command_id=?').get(a.command_id);
    if(!c || c.device_id!==id || !['PUBLISHED','ACKNOWLEDGED'].includes(c.state) || c.expires_at<=iso(this.clock()))return {ok:false,error:'ACK_MISMATCH_OR_EXPIRED'};
    if(a.status==='REJECTED'){this.failCommand(c,'REJECTED','DEVICE_REJECTED');return {ok:true};}
    if(a.status==='EXECUTED' && a.observed_value!==c.requested_value){this.failCommand(c,'FAILED','OBSERVED_VALUE_MISMATCH');return {ok:false,error:'OBSERVED_VALUE_MISMATCH'};}
    this.db.prepare('UPDATE device_commands SET state=?,observed_value=?,updated_at=? WHERE command_id=?').run(a.status==='EXECUTED'?'STATE_REPORTED':'ACKNOWLEDGED',a.observed_value||null,iso(this.clock()),c.command_id);
    return {ok:true};
  }

  scope(user) { return { sql:"(n.audience='ALL' OR (n.audience='ADMIN' AND ?='Admin') OR (n.audience='USER' AND n.owner_id=?))",args:[user.role,user.id] }; }
  listNotifications(user,q) {
    const s=this.scope(user),where=[s.sql],args=[...s.args];
    for(const [key,column] of [['severity','severity'],['category','category'],['device_id','device_id']])if(q[key]){where.push(`n.${column}=?`);args.push(q[key]);}
    if(q.search){where.push('(n.title LIKE ? OR n.message LIKE ?)');args.push(`%${q.search}%`,`%${q.search}%`);}
    if(q.from){where.push('n.timestamp>=?');args.push(q.from);}if(q.to){where.push('n.timestamp<=?');args.push(q.to);}
    if(q.unread==='true')where.push('r.notification_id IS NULL');
    const join='FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=?';
    const total=this.db.prepare(`SELECT COUNT(*) AS n ${join} WHERE ${where.join(' AND ')}`).get(user.id,...args).n;
    const rows=this.db.prepare(`SELECT n.*,r.read_at ${join} WHERE ${where.join(' AND ')} ORDER BY n.id DESC LIMIT ? OFFSET ?`).all(user.id,...args,q.limit,(q.page-1)*q.limit);
    const unread=this.db.prepare(`SELECT COUNT(*) AS n ${join} WHERE ${s.sql} AND r.notification_id IS NULL`).get(user.id,...s.args).n;
    const latest=this.db.prepare(`SELECT COALESCE(MAX(n.id),0) AS id FROM notifications n WHERE ${s.sql}`).get(...s.args).id;
    return {notifications:rows,total,unread,latest_id:latest,page:q.page,limit:q.limit};
  }
  readNotification(user,id,read=true) {
    const s=this.scope(user);if(!this.db.prepare(`SELECT 1 FROM notifications n WHERE n.id=? AND ${s.sql}`).get(id,...s.args))error(404,'NOTIFICATION_NOT_FOUND','Notification was not found');
    if(read)this.db.prepare('INSERT OR IGNORE INTO notification_reads(notification_id,user_id,read_at) VALUES(?,?,?)').run(id,user.id,iso(this.clock()));
    else this.db.prepare('DELETE FROM notification_reads WHERE notification_id=? AND user_id=?').run(id,user.id);
  }
  readAll(user,throughId) {
    const s=this.scope(user);this.db.prepare(`INSERT OR IGNORE INTO notification_reads(notification_id,user_id,read_at) SELECT n.id,?,? FROM notifications n WHERE ${s.sql} AND n.id<=?`).run(user.id,iso(this.clock()),...s.args,throughId);
  }
  listAlarms(q) {
    const where=['1=1'],args=[];
    for(const [key,column] of [['state','state'],['severity','severity'],['device_id','device_id']])if(q[key]){where.push(`${column}=?`);args.push(q[key]);}
    if(q.search){where.push('title LIKE ?');args.push(`%${q.search}%`);}
    if(q.from){where.push('raised_at>=?');args.push(q.from);}if(q.to){where.push('raised_at<=?');args.push(q.to);}
    const total=this.db.prepare(`SELECT COUNT(*) AS n FROM alarms WHERE ${where.join(' AND ')}`).get(...args).n;
    return {alarms:this.db.prepare(`SELECT * FROM alarms WHERE ${where.join(' AND ')} ORDER BY raised_at DESC LIMIT ? OFFSET ?`).all(...args,q.limit,(q.page-1)*q.limit).map(a=>({...a,evidence:parse(a.evidence)})),total,page:q.page,limit:q.limit,active:this.db.prepare("SELECT COUNT(*) AS n FROM alarms WHERE state!='RESOLVED'").get().n};
  }
  tick() {
    try {
      for(const d of this.listDevices()) {
        if(!d.enabled || d.in_maintenance)continue;
        if(!this.monitorFresh(d) && this.clock()-Date.parse(d.created_at)>d.stale_after_s*1000)this.raise({key:`STALE:${d.device_id}`,device_id:d.device_id,title:`${d.name}: no recent ${d.endpoints.some(e=>e.kind==='SENSOR')?'sensor data':'device evidence'}`,evidence:{last_seen_at:d.last_seen_at,telemetry_age_ms:d.telemetry_age_ms,transport:d.transport}});
        this.evaluateDevice(d.device_id);
      }
      for(const c of this.db.prepare("SELECT * FROM device_commands WHERE state IN ('PUBLISHED','ACKNOWLEDGED') AND expires_at<=?").all(iso(this.clock())))this.failCommand(c,'TIMED_OUT','DEVICE_CONFIRMATION_TIMEOUT');
      for(const c of this.db.prepare("SELECT * FROM command_audit c WHERE c.lifecycle_state IN ('failed','timed_out','unavailable','rejected') AND c.issued_at>=? AND NOT EXISTS (SELECT 1 FROM alarms a WHERE a.dedup_key='LEGACY_COMMAND:'||c.command_id) LIMIT 100").all(this.startedAt)) {
        if(this.db.prepare('SELECT 1 FROM device_registry WHERE device_id=?').get(c.target_node))this.raise({key:`LEGACY_COMMAND:${c.command_id}`,device_id:c.target_node,title:`${c.command}: ${c.lifecycle_state}`,evidence:{command_id:c.command_id}});
      }
      const latest=this.db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM notifications').get().id;
      if(latest!==this.lastNotificationId){this.lastNotificationId=latest;this.wsGateway?.broadcastNotifications({type:'notifications_changed'});}
      if(this.clock()-this.lastCleanup>3600000) {
        this.lastCleanup=this.clock();const days=this.db.prepare('SELECT retention_days FROM release_settings WHERE id=1').get().retention_days,cutoff=iso(this.clock()-days*86400000);
        this.db.prepare('DELETE FROM notifications WHERE timestamp<?').run(cutoff);
        this.db.prepare('DELETE FROM device_frames WHERE received_at<? AND id NOT IN (SELECT MAX(id) FROM device_frames GROUP BY device_id,boot_id)').run(cutoff);
      }
      this.lastTickError=null;
    } catch(err) { this.lastTickError=err.message; }
  }
  close() { clearInterval(this.timer); }
}
