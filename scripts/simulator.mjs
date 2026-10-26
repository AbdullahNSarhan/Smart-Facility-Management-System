import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { createBackendContext } from '../backend/src/app.js';
import { nodeSchema } from '../backend/src/validators/operationsSchemas.js';

if(process.env.NODE_ENV==='production')throw new Error('Run the simulator from a development checkout, never a production process');
const ctx=createBackendContext({NODE_ENV:'development',LCI_SIMULATOR_MODE:'true',MQTT_ENABLED:'false',
  HOST:'127.0.0.1',PORT:3101,SQLITE_DB_PATH:path.resolve('data/simulator/lci_sfm.sqlite'),
  LCI_BOOTSTRAP_ADMIN_USERNAME:'sim_admin',LCI_BOOTSTRAP_ADMIN_PASSWORD:'LCI-Simulator-Only-2026!',
  NODE1_ID:'node1',NODE2_ID:'env_02',NODE3_ID:'node3',IP_NODE1:'192.168.43.11',IP_NODE2:'192.168.43.12',IP_NODE3:'192.168.43.13'});
const {operations:o,db}=ctx,actor=ctx.repo.findUserByUsername('sim_admin');
const simulated=nodeSchema.parse({device_id:'sim_lab',name:'Simulated Sensor & Relay',device_type:'MIXED',transport:'MQTT_V1',ip:'10.250.0.44',stale_after_s:5,
  endpoints:[{endpoint_key:'temperature',label:'Temperature',kind:'SENSOR',unit:'°C'},{endpoint_key:'relay',label:'Demo relay',kind:'SWITCH',writable:true}]});
if(!db.prepare('SELECT 1 FROM device_registry WHERE device_id=?').get('sim_lab'))o.saveDevice(simulated,actor,'simulator-seed');
if(!db.prepare('SELECT 1 FROM alarm_rules WHERE device_id=?').get('sim_lab'))o.saveRule({device_id:'sim_lab',endpoint_key:'temperature',name:'Simulated high temperature',severity:'CRITICAL',threshold:30,clear_threshold:28,hold_s:2,clear_hold_s:2,enabled:true},actor,'simulator-seed');
let scenario='normal',stopped=false,relay='OFF';
const boot=crypto.randomUUID(),seq=new Map();
const next=id=>{const n=(seq.get(id)||0)+1;seq.set(id,n);return n;};
o.setScenario=value=>{scenario=value;return scenario;};
o.getScenario=()=>scenario;
o.simulationDriver=async c=>{
  if(scenario==='command-failure')return;
  const timer=setTimeout(()=>{
    if(stopped)return;relay=c.requested_value;
    o.acknowledgeCommand(c.device_id,{schema_version:1,device_id:c.device_id,command_id:c.command_id,status:'EXECUTED',observed_value:relay});
  },300);timer.unref();
};
function frame(id,values){o.ingest(id,{schema_version:1,device_id:id,boot_id:boot,seq:next(id),values});}
function emit(){
  o.heartbeat('node1',{schema_version:1,device_id:'node1',firmware_version:'SIMULATED'});
  o.heartbeat('node3',{schema_version:1,device_id:'node3',firmware_version:'SIMULATED'});
  frame('env_02',{temperature:25,humidity:48,smoke_gas_level:120});
  if(scenario!=='offline')frame('sim_lab',{temperature:scenario==='alarm'?38:25,relay});
}
emit();const timer=setInterval(emit,1500);timer.unref();
try {
  const {createServer}=await import('vite');
  const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'spa'});ctx.app.use(vite.middlewares);
  ctx.vite=vite;
}catch{ctx.app.use(express.static(path.resolve('dist')));}
await ctx.start();
console.log('\nSIMULATION ONLY · isolated database · no MQTT / upstream HTTP / physical commands');
console.log('Open http://127.0.0.1:3101 · initial user: sim_admin · initial password: LCI-Simulator-Only-2026!');
console.log('Use the scenario selector in the simulation banner. Existing simulator account changes are preserved.');
export async function stopSimulator(){if(stopped)return;stopped=true;clearInterval(timer);await ctx.vite?.close();await ctx.stop();}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await stopSimulator();process.exit(0);});
