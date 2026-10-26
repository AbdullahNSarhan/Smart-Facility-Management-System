import express from 'express';
import { z } from 'zod';
import { createRateLimiter } from '../middleware/security.js';
import { nodeSchema,ruleSchema,maintenanceSchema,alarmActionSchema,listSchema,switchSchema } from '../validators/operationsSchemas.js';
import { readCameraSnapshot } from '../services/cameraSnapshot.js';
import { RELEASE_VERSION } from '../services/releaseOperations.js';

export function createOperationsRouter({ operations:o,authMiddleware,db,snapshotFetch }) {
  const r=express.Router(),{requireAuth,requireAdmin}=authMiddleware;
  const mutation=createRateLimiter({maxRequests:90,keyPrefix:'operations'});
  const probes=createRateLimiter({maxRequests:20,keyPrefix:'device_probe'});
  const validate=s=>(req,res,next)=>{const p=s.safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,code:'VALIDATION_ERROR',error:p.error.issues.map(i=>i.message).join('; ')});req.validated=p.data;next();};
  const query=(req,res,next)=>{const p=listSchema.safeParse(req.query);if(!p.success)return res.status(400).json({ok:false,code:'INVALID_QUERY',error:'Invalid filter or pagination'});req.filters=p.data;next();};
  const ok=(res,value,status=200)=>res.status(status).json({ok:true,...value});
  const asyncRoute=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
  r.get('/release',requireAuth,(req,res)=>ok(res,{
    version:RELEASE_VERSION,stage:'SOFTWARE_RELEASE_CANDIDATE',simulation:o.simulation,physical_acceptance:'PENDING',
    adapters:[{id:'MQTT_V1',description:'Versioned sensor / switch protocol; requires per-device broker provisioning'},{id:'HTTP_JSON_V1',description:'Manual bounded JSON sensor probe'},{id:'CAMERA_JPEG',description:'Authenticated JPEG capture proxy'}],
    retention_days:db.prepare('SELECT retention_days FROM release_settings WHERE id=1').get().retention_days,
    monitoring_error:o.lastTickError||null
  }));
  r.get('/registry',requireAuth,(req,res)=>ok(res,{devices:o.listDevices()}));
  r.get('/registry/:id',requireAuth,(req,res)=>ok(res,{device:o.device(req.params.id)}));
  r.post('/registry',requireAdmin,mutation,validate(nodeSchema),(req,res)=>ok(res,{device:o.saveDevice(req.validated,req.user,req.requestId)},201));
  r.put('/registry/:id',requireAdmin,mutation,validate(nodeSchema),(req,res)=>ok(res,{device:o.saveDevice(req.validated,req.user,req.requestId,req.params.id)}));
  r.post('/registry/:id/maintenance',requireAdmin,mutation,validate(maintenanceSchema),(req,res)=>ok(res,{device:o.maintenance(req.params.id,req.validated,req.user,req.requestId)}));
  r.post('/registry/:id/probe',requireAdmin,probes,validate(z.object({}).strict()),asyncRoute(async(req,res)=>ok(res,await o.probe(req.params.id))));
  r.get('/registry/:id/snapshot',requireAuth,probes,asyncRoute(async(req,res)=>{
    if(o.simulation)return res.status(409).json({ok:false,code:'SIMULATOR_ISOLATED',error:'Simulator uses a clearly labelled synthetic preview in the browser; no upstream camera is contacted'});
    const d=o.device(req.params.id);
    if(!d.enabled || !d.endpoints.some(e=>e.kind==='CAMERA'))return res.status(409).json({ok:false,error:'No enabled camera endpoint',code:'CAMERA_UNAVAILABLE'});
    const jpeg=await readCameraSnapshot(d.ip,snapshotFetch,{port:d.port,path:d.path});
    db.prepare('UPDATE device_registry SET heartbeat_at=? WHERE device_id=?').run(new Date(o.clock()).toISOString(),d.device_id);
    res.type('image/jpeg').send(jpeg);
  }));
  r.get('/registry/:id/history',requireAuth,(req,res)=>{
    o.device(req.params.id);ok(res,{frames:db.prepare('SELECT id,received_at,values_json FROM device_frames WHERE device_id=? ORDER BY id DESC LIMIT 100').all(req.params.id).map(f=>({...f,values:JSON.parse(f.values_json),values_json:undefined}))});
  });
  r.get('/registry/:id/commands',requireAuth,(req,res)=>{o.device(req.params.id);ok(res,{commands:db.prepare('SELECT * FROM device_commands WHERE device_id=? ORDER BY issued_at DESC LIMIT 100').all(req.params.id)});});
  r.post('/registry/:id/commands',requireAdmin,mutation,validate(switchSchema),asyncRoute(async(req,res)=>ok(res,{command:await o.command(req.params.id,req.validated,req.user)},202)));
  r.get('/rules',requireAuth,(req,res)=>ok(res,{rules:db.prepare('SELECT * FROM alarm_rules ORDER BY created_at,rule_id').all()}));
  r.post('/rules',requireAdmin,mutation,validate(ruleSchema),(req,res)=>ok(res,{rule:o.saveRule(req.validated,req.user,req.requestId)},201));
  r.put('/rules/:id',requireAdmin,mutation,validate(ruleSchema),(req,res)=>ok(res,{rule:o.saveRule(req.validated,req.user,req.requestId,req.params.id)}));
  r.get('/alarms',requireAuth,query,(req,res)=>ok(res,o.listAlarms(req.filters)));
  r.get('/alarms/:id',requireAuth,(req,res)=>ok(res,{alarm:o.alarmDetail(req.params.id)}));
  for(const action of ['acknowledge','resolve'])r.post(`/alarms/:id/${action}`,requireAdmin,mutation,validate(alarmActionSchema),(req,res)=>ok(res,{alarm:o.alarmAction(req.params.id,action,req.validated.comment,req.user)}));
  r.get('/notifications',requireAuth,query,(req,res)=>ok(res,o.listNotifications(req.user,req.filters)));
  r.put('/notifications/read-all',requireAuth,mutation,validate(z.object({through_id:z.number().int().nonnegative()}).strict()),(req,res)=>{o.readAll(req.user,req.validated.through_id);ok(res,{});});
  r.put('/notifications/:id/read',requireAuth,mutation,validate(z.object({read:z.boolean()}).strict()),(req,res)=>{
    const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({ok:false,error:'Invalid notification ID'});
    o.readNotification(req.user,id,req.validated.read);ok(res,{});
  });
  r.get('/notification-preferences',requireAuth,(req,res)=>ok(res,{critical_sound:Boolean(db.prepare('SELECT critical_sound FROM notification_preferences WHERE user_id=?').get(req.user.id)?.critical_sound)}));
  r.put('/notification-preferences',requireAuth,mutation,validate(z.object({critical_sound:z.boolean()}).strict()),(req,res)=>{
    db.prepare('INSERT INTO notification_preferences(user_id,critical_sound) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET critical_sound=excluded.critical_sound').run(req.user.id,Number(req.validated.critical_sound));ok(res,{});
  });
  r.put('/retention',requireAdmin,mutation,validate(z.object({days:z.number().int().min(7).max(365)}).strict()),(req,res)=>{
    db.transaction(()=>{db.prepare('UPDATE release_settings SET retention_days=? WHERE id=1').run(req.validated.days);o.management.audit(req.user,'NOTIFICATION_RETENTION','release',{days:req.validated.days},req.requestId);})();
    ok(res,{days:req.validated.days,note:'Retention applies to notifications and telemetry history. Alarm/audit evidence is preserved.'});
  });
  r.post('/simulator',requireAdmin,mutation,validate(z.object({scenario:z.enum(['normal','alarm','offline','command-failure'])}).strict()),(req,res)=>{
    if(!o.simulation||!o.setScenario)return res.status(404).json({ok:false,error:'Simulator is unavailable in this deployment'});
    ok(res,{simulation:true,scenario:o.setScenario(req.validated.scenario)});
  });
  r.use((err,req,res,next)=>{if(!err.status||!err.code)return next(err);res.status(err.status).json({ok:false,error:err.message,code:err.code,request_id:req.requestId});});
  return r;
}
