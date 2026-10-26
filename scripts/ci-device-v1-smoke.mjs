// Real-broker verification inside disposable GitHub Actions only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import mqtt from 'mqtt';
import dotenv from 'dotenv';
dotenv.config({quiet:true});
if(process.env.CI!=='true'||process.env.LCI_SIMULATOR_CI_ONLY!=='1')throw new Error('This simulator requires isolated GitHub Actions; never target a real facility');
const password=fs.readFileSync(process.env.CI_MQTT_NODE2_SECRET_FILE,'utf8').trim();
const id='ci_sensor',base=`lci/v1/devices/${id}`,boot=crypto.randomUUID();
let cookie,csrf;
async function api(url,method='GET',body) {
  const r=await fetch(`http://127.0.0.1${url}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
  const data=await r.json();assert.ok(r.ok,`${method} ${url}: ${r.status} ${data.code||''}`);return {data,response:r};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(label,fn){for(let i=0;i<40;i++){if(await fn())return;await sleep(250);}throw new Error(`Timed out: ${label}`);}
async function connect(username){return new Promise((resolve,reject)=>{const c=mqtt.connect('mqtt://127.0.0.1:1883',{username,password,clientId:`ci-v1-${crypto.randomUUID()}`,reconnectPeriod:0,connectTimeout:5000,clean:true,protocolVersion:4});c.once('connect',()=>resolve(c));c.once('error',reject);});}
const publish=(c,topic,payload)=>new Promise((resolve,reject)=>c.publish(topic,JSON.stringify(payload),{qos:1,retain:false},e=>e?reject(e):resolve()));
const subscribe=(c,topic)=>new Promise((resolve,reject)=>c.subscribe(topic,{qos:1},(e,g)=>e||g?.[0]?.qos===128?reject(e||new Error('ACL refused subscription')):resolve()));
const clients=[];
try {
  const login=await api('/api/auth/login','POST',{username:process.env.LCI_BOOTSTRAP_ADMIN_USERNAME,password:process.env.LCI_BOOTSTRAP_ADMIN_PASSWORD});cookie=login.response.headers.get('set-cookie')?.split(';')[0];csrf=login.data.csrfToken;assert.ok(cookie&&csrf);
  await api('/api/v1/registry','POST',{device_id:id,name:'CI v1 Sensor',device_type:'MIXED',transport:'MQTT_V1',ip:'10.252.0.44',stale_after_s:30,endpoints:[{endpoint_key:'temperature',label:'Temperature',kind:'SENSOR',unit:'°C'},{endpoint_key:'relay',label:'Demo relay',kind:'SWITCH',writable:true}]});
  const sensor=await connect(id),other=await connect('ci_other');clients.push(sensor,other);
  await subscribe(sensor,`${base}/command`);
  sensor.on('message',(topic,buffer)=>{
    if(topic!==`${base}/command`)return;const c=JSON.parse(buffer.toString());
    publish(sensor,`${base}/ack`,{schema_version:1,device_id:id,command_id:c.command_id,status:'EXECUTED',observed_value:c.value}).catch(()=>{});
  });
  const frame=(seq,temperature)=>({schema_version:1,device_id:id,boot_id:boot,seq,values:{temperature,relay:'OFF'}});
  await publish(sensor,`${base}/telemetry`,frame(1,25));
  await until('validated v1 telemetry',async()=>((await api(`/api/v1/registry/${id}`)).data.device.values.temperature===25));
  // Broker must refuse a different credential publishing as this node.
  await publish(other,`${base}/telemetry`,frame(2,99));await sleep(500);
  assert.equal((await api(`/api/v1/registry/${id}`)).data.device.values.temperature,25,'Cross-identity publish reached the backend');
  const sent=(await api(`/api/v1/registry/${id}/commands`,'POST',{endpoint_key:'relay',value:'ON'})).data.command;
  await until('correlated device ACK',async()=>(await api(`/api/v1/registry/${id}/commands`)).data.commands.some(c=>c.command_id===sent.command_id&&c.state==='STATE_REPORTED'));
  const rule=(await api('/api/v1/rules','POST',{device_id:id,endpoint_key:'temperature',name:'CI v1 High Temperature',severity:'CRITICAL',threshold:30,clear_threshold:27,hold_s:0,clear_hold_s:0})).data.rule;
  await publish(sensor,`${base}/telemetry`,frame(2,40));
  await until('persistent alarm',async()=>(await api(`/api/v1/alarms?device_id=${id}`)).data.alarms.some(a=>a.rule_id===rule.rule_id&&a.state==='ACTIVE'));
  await until('notification event',async()=>(await api(`/api/v1/notifications?category=ALARM&device_id=${id}`)).data.notifications.some(n=>n.severity==='CRITICAL'));
  await publish(sensor,`${base}/telemetry`,frame(3,26));
  await until('automatic alarm recovery',async()=>(await api(`/api/v1/alarms?device_id=${id}`)).data.alarms.some(a=>a.rule_id===rule.rule_id&&a.state==='RESOLVED'));
  console.log('PASS: real MQTT v1 telemetry, per-identity ACL denial, correlated switch ACK, persistent alarm/notification and recovery');
}finally{for(const c of clients)c.end(true);}
