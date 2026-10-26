import { describe,it,beforeEach,afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createBackendContext } from '../src/app.js';
import { SqliteDatabase } from '../src/db/database.js';
import { loadConfig } from '../src/config/env.js';

describe('Release candidate operations: registry, notifications and alarms',()=>{
  let ctx,tmp,now,cookie,csrf,viewerCookie,viewerCsrf,admin,viewer,published;
  const password='Isolated-Test-Password-2026!';
  const opts=()=>({NODE_ENV:'test',MQTT_ENABLED:'false',PORT:0,HOST:'127.0.0.1',TRUST_PROXY:'false',SQLITE_DB_PATH:path.join(tmp,'operations.db'),
    LCI_BOOTSTRAP_ADMIN_USERNAME:'test_admin',LCI_BOOTSTRAP_ADMIN_PASSWORD:password,NODE1_ID:'node1',NODE2_ID:'env_02',NODE3_ID:'node3',IP_NODE1:'192.168.43.11',IP_NODE2:'192.168.43.12',IP_NODE3:'192.168.43.13',clock:()=>now});
  const mutate=(method,url,body,asViewer=false)=>request(ctx.app)[method]('/api/v1'+url).set('Cookie',asViewer?viewerCookie:cookie).set('X-CSRF-Token',asViewer?viewerCsrf:csrf).send(body);
  const get=(url,asViewer=false)=>request(ctx.app).get('/api/v1'+url).set('Cookie',asViewer?viewerCookie:cookie);
  const node=(extra={})=>({device_id:'lab_sensor',name:'Lab Sensor',description:'Test node',location:'room-001',device_type:'MIXED',transport:'MQTT_V1',ip:'10.20.0.44',port:80,path:'/telemetry',stale_after_s:10,enabled:true,
    endpoints:[{endpoint_key:'temperature',label:'Temperature',kind:'SENSOR',unit:'°C',writable:false},{endpoint_key:'relay',label:'Relay',kind:'SWITCH',unit:'',writable:true}],...extra});
  const create=async extra=>{const r=await mutate('post','/registry',node(extra));assert.equal(r.status,201,JSON.stringify(r.body));return r.body.device;};
  const online=()=>{ctx.mqttService.config.mqttEnabled=true;ctx.mqttService.connected=true;ctx.mqttService.client={connected:true};ctx.mqttService.publishCommand=async(topic,payload)=>{published.push({topic,payload});return true;};};
  const frame=(seq,value=25,extra={})=>({schema_version:1,device_id:'lab_sensor',boot_id:'test-boot',seq,values:{temperature:value,relay:'OFF'},...extra});
  const send=p=>ctx.mqttService.handleIncomingMessage(`lci/v1/devices/${p.device_id}/telemetry`,JSON.stringify(p));
  const makeRule=async(extra={})=>{
    const r=await mutate('post','/rules',{device_id:'lab_sensor',endpoint_key:'temperature',name:'High temperature',severity:'CRITICAL',threshold:30,clear_threshold:27,hold_s:2,clear_hold_s:2,enabled:true,...extra});
    assert.equal(r.status,201,JSON.stringify(r.body));return r.body.rule;
  };
  const tick=()=>{ctx.operations.tick();assert.equal(ctx.operations.lastTickError,null);};
  const bodyFor=d=>({device_id:d.device_id,name:d.name,description:d.description,location:d.location,device_type:d.device_type,transport:d.transport,ip:d.ip,port:d.port,path:d.path,stale_after_s:d.stale_after_s,enabled:d.enabled,endpoints:d.endpoints.map(({endpoint_key,label,kind,unit,writable})=>({endpoint_key,label,kind,unit,writable})),version:d.version});
  beforeEach(async()=>{
    tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lci-rc-'));now=Date.now();ctx=createBackendContext(opts());published=[];
    const login=await request(ctx.app).post('/api/auth/login').send({username:'test_admin',password});assert.equal(login.status,200);
    cookie=login.headers['set-cookie'][0].split(';')[0];csrf=login.body.csrfToken;admin=ctx.repo.findUserByUsername('test_admin');
    const op=await mutate('post','/operators',{username:'test_viewer',password,role:'Viewer'});assert.equal(op.status,201);
    const v=await request(ctx.app).post('/api/auth/login').send({username:'test_viewer',password});viewerCookie=v.headers['set-cookie'][0].split(';')[0];viewerCsrf=v.body.csrfToken;viewer=ctx.repo.findUserByUsername('test_viewer');
  });
  afterEach(async()=>{ctx.mqttService.client=null;ctx.mqttService.connected=false;await ctx.stop();fs.rmSync(tmp,{recursive:true,force:true});});

  it('seeds the existing three nodes and admits additional typed nodes with immutable identities and version checks',async()=>{
    assert.equal((await get('/registry')).body.devices.length,3);
    const d=await create();assert.equal(d.status,'UNKNOWN');assert.equal(d.mqtt_base,'lci/v1/devices/lab_sensor');
    assert.equal((await get('/registry')).body.devices.length,4);
    assert.equal((await mutate('post','/registry',node())).status,409);
    assert.equal((await mutate('post','/registry',node({device_id:'other_sensor'}))).status,409);
    const edit=bodyFor(d);edit.name='Renamed Sensor';assert.equal((await mutate('put','/registry/lab_sensor',edit)).status,200);
    assert.equal((await mutate('put','/registry/lab_sensor',edit)).status,409);
    assert.equal((await mutate('put','/registry/lab_sensor',{...edit,device_id:'renamed_identity',version:2})).status,409);
  });

  it('enforces Admin/Viewer and CSRF while rejecting public destinations, traversal paths and incompatible endpoint types',async()=>{
    assert.equal((await request(ctx.app).get('/api/v1/registry')).status,401);
    assert.equal((await mutate('post','/registry',node(),true)).status,403);
    assert.equal((await request(ctx.app).post('/api/v1/registry').set('Cookie',cookie).send(node())).status,403);
    for(const extra of [{ip:'127.0.0.1'},{ip:'8.8.8.8'},{path:'/../admin'},{path:'/telemetry?url=x'},{transport:'HTTP_JSON_V1'},{device_type:'CAMERA'},{transport:'LEGACY_V1'},{endpoints:[node().endpoints[0],node().endpoints[0]]}])assert.ok((await mutate('post','/registry',node(extra))).status>=400,JSON.stringify(extra));
    assert.equal((await get('/registry',true)).status,200);
  });

  it('keeps built-in address edits compatible with the legacy shared settings and rejects address collisions',async()=>{
    const d=(await get('/registry/env_02')).body.device,edit=bodyFor(d);edit.ip='10.20.0.12';edit.name='Environment lab';
    assert.equal((await mutate('put','/registry/env_02',edit)).status,200);
    assert.equal((await get('/settings')).body.settings.nodes.node2.ip,'10.20.0.12');assert.equal(ctx.config.node2Ip,'10.20.0.12');
    await create();const {updated_at,updated_by,...settings}=(await get('/settings')).body.settings;settings.nodes.node1.ip='10.20.0.44';
    assert.equal((await mutate('put','/settings',settings)).status,409);
  });

  it('accepts only device-bound fresh schemas, deduplicates/rejects old frames and does not refresh data on heartbeat alone',async()=>{
    await create();online();assert.equal(send(frame(1)).ok,true);
    const observed=ctx.operations.device('lab_sensor').last_seen_at;
    now+=1000;assert.equal(send(frame(1)).ok,false);assert.equal(send(frame(0)).ok,false);
    assert.equal(ctx.operations.device('lab_sensor').last_seen_at,observed);
    assert.equal(send(frame(2,25,{values:{unknown:1}})).ok,false);
    assert.equal(ctx.mqttService.handleIncomingMessage('lci/v1/devices/lab_sensor/telemetry',JSON.stringify(frame(2,25,{device_id:'node1'}))).ok,false);
    assert.equal(ctx.mqttService.handleIncomingMessage('lci/v1/devices/lab_sensor/telemetry',JSON.stringify(frame(2)),{retained:true}).ok,false);
    assert.equal(send(frame(1,26,{boot_id:'new-boot'})).ok,true);assert.equal(send(frame(4)).ok,false);
    now+=11000;ctx.operations.heartbeat('lab_sensor',{schema_version:1,device_id:'lab_sensor',firmware_version:'test-v1'});
    const d=ctx.operations.device('lab_sensor');assert.equal(d.fresh,true);assert.equal(d.telemetry_fresh,false);tick();
    assert.equal((await get('/alarms?device_id=lab_sensor')).body.active,1);
  });

  it('holds alarm thresholds, deduplicates repeats, preserves acknowledgement and resolves only after fresh hysteresis recovery',async()=>{
    await create();online();await makeRule();assert.equal(send(frame(1,35)).ok,true);tick();assert.equal((await get('/alarms')).body.active,0);
    now+=2000;send(frame(2,36));tick();let alarms=(await get('/alarms')).body.alarms;assert.equal(alarms.length,1);assert.equal(alarms[0].severity,'CRITICAL');
    send(frame(3,38));tick();assert.equal((await get('/alarms')).body.alarms.length,1);
    const id=alarms[0].alarm_id;assert.equal((await mutate('post',`/alarms/${id}/acknowledge`,{comment:'Investigating sensor'})).status,200);
    assert.equal((await mutate('post',`/alarms/${id}/resolve`,{comment:'Cannot claim recovery'})).status,409);
    send(frame(4,29));now+=3000;tick();assert.equal((await get(`/alarms/${id}`)).body.alarm.state,'ACKNOWLEDGED');
    send(frame(5,26));now+=2000;send(frame(6,26));tick();const resolved=(await get(`/alarms/${id}`)).body.alarm;
    assert.equal(resolved.state,'RESOLVED');assert.ok(resolved.events.some(e=>e.action==='ACKNOWLEDGED'));assert.equal(resolved.resolved_by,'system');
    assert.equal((await get('/notifications?category=ALARM')).body.notifications.filter(n=>n.title==='High temperature').length,1);
  });

  it('uses freshness for alarm dwell, suppresses new maintenance alarms and resumes monitoring after its deadline',async()=>{
    await create();online();await makeRule({hold_s:20});send(frame(1,40));now+=11000;tick();
    assert.equal((await get('/alarms')).body.alarms.filter(a=>a.rule_id).length,0);
    assert.equal((await mutate('post','/registry/lab_sensor/maintenance',{minutes:1,reason:'Bench maintenance'})).status,200);
    send(frame(2,40));now+=25000;tick();assert.equal((await get('/alarms')).body.alarms.filter(a=>a.rule_id).length,0);
    // Previously active stale alarm remains visible during maintenance.
    assert.equal((await get('/alarms?device_id=lab_sensor')).body.active,1);
    now+=40000;tick();assert.equal(ctx.operations.device('lab_sensor').in_maintenance,false);
    send(frame(3,25));tick();assert.equal((await get('/alarms?device_id=lab_sensor')).body.active,0);
  });

  it('binds switch commands to their topic/device, rejects mismatched reports and reports timeout without fake success',async()=>{
    await create();online();send(frame(1));
    const sent=await mutate('post','/registry/lab_sensor/commands',{endpoint_key:'relay',value:'ON'});assert.equal(sent.status,202);assert.equal(sent.body.command.state,'PUBLISHED');
    assert.equal(published[0].topic,'lci/v1/devices/lab_sensor/command');
    const id=sent.body.command.command_id;
    assert.equal(ctx.operations.acknowledgeCommand('node1',{schema_version:1,device_id:'node1',command_id:id,status:'EXECUTED',observed_value:'ON'}).ok,false);
    assert.equal(ctx.operations.acknowledgeCommand('lab_sensor',{schema_version:1,device_id:'lab_sensor',command_id:id,status:'EXECUTED',observed_value:'OFF'}).ok,false);
    assert.equal((await get('/registry/lab_sensor/commands')).body.commands[0].state,'FAILED');
    const c=(await mutate('post','/registry/lab_sensor/commands',{endpoint_key:'relay',value:'ON'})).body.command;
    ctx.operations.acknowledgeCommand('lab_sensor',{schema_version:1,device_id:'lab_sensor',command_id:c.command_id,status:'ACKNOWLEDGED'});
    now+=6000;tick();assert.equal(ctx.db.prepare('SELECT state FROM device_commands WHERE command_id=?').get(c.command_id).state,'TIMED_OUT');
    assert.equal(ctx.operations.acknowledgeCommand('lab_sensor',{schema_version:1,device_id:'lab_sensor',command_id:c.command_id,status:'EXECUTED',observed_value:'ON'}).ok,false);
    const notes=(await get('/notifications?category=COMMAND')).body.notifications;assert.ok(notes.some(n=>n.message.includes('TIMEOUT')));
    assert.ok((await get('/alarms')).body.alarms.some(a=>a.evidence.command_id===c.command_id));
  });

  it('blocks all controls and ingestion for disabled nodes while keeping registry and audit history',async()=>{
    const d=await create();online();send(frame(1));
    assert.equal((await mutate('put','/registry/lab_sensor',{...bodyFor(d),enabled:false})).status,200);
    assert.equal((await get('/registry/lab_sensor')).body.device.status,'DISABLED');assert.equal(send(frame(2)).ok,false);
    assert.equal((await mutate('post','/registry/lab_sensor/commands',{endpoint_key:'relay',value:'ON'})).status,409);
    const builtin=(await get('/registry/node1')).body.device;await mutate('put','/registry/node1',{...bodyFor(builtin),enabled:false});
    const command=await request(ctx.app).post('/api/command').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({command:'EMERGENCY_DOOR_UNLOCK',state:'OPEN'});
    assert.equal(command.status,409);assert.equal(published.length,0);
    assert.ok((await get('/management-audit')).body.events.some(e=>e.action==='DEVICE_UPDATED'));
  });

  it('keeps notification visibility and read state per account, including private auth and admin-only failures',async()=>{
    await request(ctx.app).post('/api/auth/login').send({username:'test_admin',password:'incorrect'});
    ctx.operations.notify({title:'General event',category:'DEVICE'});
    const av=(await get('/notifications')).body,vv=(await get('/notifications',true)).body;
    assert.ok(av.notifications.some(n=>n.title==='Dashboard sign-in rejected'));assert.ok(!vv.notifications.some(n=>n.title==='Dashboard sign-in rejected'));
    const privateAdmin=av.notifications.find(n=>n.audience==='USER'&&n.owner_id===admin.id);assert.ok(privateAdmin);
    assert.equal((await mutate('put',`/notifications/${privateAdmin.id}/read`,{read:true},true)).status,404);
    const common=av.notifications.find(n=>n.title==='General event');await mutate('put',`/notifications/${common.id}/read`,{read:true});
    assert.ok((await get('/notifications')).body.notifications.find(n=>n.id===common.id).read_at);
    assert.equal((await get('/notifications',true)).body.notifications.find(n=>n.id===common.id).read_at,null);
    await mutate('put','/notifications/read-all',{through_id:vv.latest_id},true);
    assert.equal((await get('/notifications',true)).body.unread,0);
    ctx.operations.notify({title:'Arrived later'});assert.equal((await get('/notifications',true)).body.unread,1);
  });

  it('persists registry, alarm/read history and preferences through process restart and deduplicates repeated sign-in failures',async()=>{
    await create();online();await makeRule({hold_s:0});send(frame(1,40));
    await mutate('put','/notification-preferences',{critical_sound:true});
    for(let i=0;i<3;i++)await request(ctx.app).post('/api/auth/login').send({username:'someone',password:'wrong'});
    assert.equal((await get('/notifications?category=AUTH')).body.notifications.filter(n=>n.title==='Dashboard sign-in rejected').length,1);
    const all=(await get('/notifications')).body;await mutate('put','/notifications/read-all',{through_id:all.latest_id});
    ctx.mqttService.client=null;await ctx.stop();ctx=createBackendContext(opts());
    assert.equal((await get('/registry')).body.devices.length,4);assert.equal((await get('/notification-preferences')).body.critical_sound,true);
    assert.equal((await get('/alarms')).body.alarms.length,1);assert.equal((await get('/notifications')).body.unread,0);
  });

  it('bounds and validates HTTP probes without redirecting and uses fresh frame evidence',async()=>{
    const d=node({device_id:'http_sensor',device_type:'SENSORS',transport:'HTTP_JSON_V1',endpoints:[node().endpoints[0]]});assert.equal((await mutate('post','/registry',d)).status,201);
    let requested;
    ctx.operations.httpFetch=async(url,options)=>{requested={url,options};return new Response(JSON.stringify({schema_version:1,device_id:'http_sensor',boot_id:'http-boot',seq:1,values:{temperature:23}}),{headers:{'content-type':'application/json'}});};
    const r=await mutate('post','/registry/http_sensor/probe',{});assert.equal(r.status,200);assert.equal(r.body.probe.ingest.ok,true);assert.equal(requested.options.redirect,'manual');assert.equal(requested.url,'http://10.20.0.44:80/telemetry');
    ctx.operations.httpFetch=async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1'}});assert.equal((await mutate('post','/registry/http_sensor/probe',{})).status,502);
    ctx.operations.httpFetch=async()=>new Response('x'.repeat(40000),{headers:{'content-type':'application/json'}});assert.equal((await mutate('post','/registry/http_sensor/probe',{})).status,502);
  });

  it('cleans expired notifications without deleting alarm evidence or receipt integrity',async()=>{
    await create();online();await makeRule({hold_s:0});send(frame(1,40));
    ctx.operations.notify({title:'Old event'});const id=ctx.db.prepare("SELECT id FROM notifications WHERE title='Old event'").get().id;
    await mutate('put',`/notifications/${id}/read`,{read:true});ctx.db.prepare("UPDATE notifications SET timestamp='2000-01-01T00:00:00.000Z' WHERE id=?").run(id);
    assert.equal((await mutate('put','/retention',{days:7},true)).status,403);await mutate('put','/retention',{days:7});tick();
    assert.equal(ctx.db.prepare('SELECT 1 FROM notifications WHERE id=?').get(id),undefined);assert.equal(ctx.db.prepare('SELECT 1 FROM notification_reads WHERE notification_id=?').get(id),undefined);
    assert.equal((await get('/alarms')).body.alarms.length,1);
  });

  it('streams invalidation without privileged contents and rejects unauthenticated notification sockets',async()=>{
    const address=await ctx.start();const url=`ws://127.0.0.1:${address.port}/ws/notifications`;
    await new Promise(resolve=>{const client=new WebSocket(url);client.on('unexpected-response',(_req,res)=>{assert.equal(res.statusCode,401);client.terminate();resolve();});client.on('error',()=>{});});
    const client=new WebSocket(url,{headers:{Cookie:viewerCookie}});await new Promise((resolve,reject)=>{client.once('open',resolve);client.once('error',reject);});
    const received=new Promise(resolve=>client.once('message',d=>resolve(JSON.parse(d))));ctx.operations.notify({title:'Private administrator event',audience:'ADMIN'});tick();
    assert.deepEqual(await received,{type:'notifications_changed'});client.terminate();
  });
});

describe('Isolated simulator and additive upgrade',()=>{
  it('never contacts an upstream camera/broker in simulator mode and rejects simulation activation in production',async()=>{
    assert.throws(()=>loadConfig({NODE_ENV:'production',LCI_SIMULATOR_MODE:'true'}),/forbidden in production/);
    let upstream=0;const ctx=createBackendContext({NODE_ENV:'test',MQTT_ENABLED:'false',LCI_SIMULATOR_MODE:'true',SQLITE_DB_PATH:':memory:',LCI_BOOTSTRAP_ADMIN_USERNAME:'simulation_admin',LCI_BOOTSTRAP_ADMIN_PASSWORD:'Simulation-Test-Password!',httpFetch:async()=>{upstream++;throw new Error();},snapshotFetch:async()=>{upstream++;throw new Error();}});
    try{const login=await request(ctx.app).post('/api/auth/login').send({username:'simulation_admin',password:'Simulation-Test-Password!'}),cookie=login.headers['set-cookie'][0].split(';')[0];
      const r=await request(ctx.app).get('/api/v1/registry/node3/snapshot').set('Cookie',cookie);assert.equal(r.status,409);
      const old=await request(ctx.app).get('/api/v1/devices/node3/snapshot').set('Cookie',cookie);assert.equal(old.status,409);await ctx.operations.probe('env_02');assert.equal(upstream,0);
      assert.equal((await request(ctx.app).get('/api/v1/release').set('Cookie',cookie)).body.simulation,true);
    }finally{await ctx.stop();}
  });

  it('upgrades a populated previous schema without modifying existing account credentials or audit rows',async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lci-upgrade-')),migrations=path.join(dir,'previous');fs.mkdirSync(migrations);
    for(const name of ['001_initial_schema.sql','002_facility_management.sql'])fs.copyFileSync(new URL(`../src/db/migrations/${name}`,import.meta.url),path.join(migrations,name));
    const file=path.join(dir,'upgrade.db'),db=new SqliteDatabase(file);db.runMigrations(migrations);db.bootstrapAdminIfNeeded({username:'existing_admin',password:'Preserve-Existing-Secret!',isProd:false});const hash=db.prepare('SELECT password_hash FROM system_users').get().password_hash;db.close();
    const ctx=createBackendContext({NODE_ENV:'test',MQTT_ENABLED:'false',SQLITE_DB_PATH:file,LCI_BOOTSTRAP_ADMIN_USERNAME:'different_bootstrap',LCI_BOOTSTRAP_ADMIN_PASSWORD:'Another-Secret-Must-Not-Override!'});
    try{assert.equal(ctx.repo.findUserByUsername('existing_admin').password_hash,hash);assert.equal(ctx.repo.countActiveAdmins(),1);assert.equal(ctx.operations.listDevices().length,3);assert.equal(ctx.db.healthCheck().latestMigration,'003_release_operations.sql');}finally{await ctx.stop();fs.rmSync(dir,{recursive:true,force:true});}
  });
});
