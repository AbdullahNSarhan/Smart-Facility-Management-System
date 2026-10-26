// Isolated in-memory app and simulated MQTT replies. Never points at a live server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright';
import { createBackendContext } from '../backend/src/app.js';

const ctx=createBackendContext({NODE_ENV:'test',MQTT_ENABLED:'false',HOST:'127.0.0.1',PORT:0,SQLITE_DB_PATH:':memory:',
  LCI_BOOTSTRAP_ADMIN_USERNAME:'ui_admin',LCI_BOOTSTRAP_ADMIN_PASSWORD:'UI-Test-Only-Password-2026!',NODE1_ID:'node1',NODE2_ID:'env_02',NODE3_ID:'node3',
  IP_NODE1:'192.168.43.11',IP_NODE2:'192.168.43.12',IP_NODE3:'192.168.43.13',
  snapshotFetch:async()=>new Response(jpeg,{headers:{'content-type':'image/jpeg'}})});
let jpeg=new Uint8Array([0xff,0xd8,0xff,0xd9]);
ctx.app.use(express.static(path.resolve('dist')));
const address=await ctx.start();
const launch={headless:true};
if(process.env.PLAYWRIGHT_EXECUTABLE_PATH)launch.executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH;
if(process.env.PLAYWRIGHT_SERVERLESS_ARGS==='true')launch.args=['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote'];
const browser=await chromium.launch(launch);
const pages=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});pages.push(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(15000);
  const submit=async(selector,pathname,method='POST',status=200)=>{
    const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===pathname && r.request().method()===method),page.locator(selector).click()]);
    const body=await r.json();assert.equal(r.status(),status,JSON.stringify(body));return body;
  };
  const login=async(user,password)=>{await page.fill('#login_username',user);await page.fill('#login_password',password);await page.click('#login-submit-btn');await page.waitForSelector('#login-overlay.hidden',{state:'attached'});await page.waitForSelector('#release-banner:not(.hidden)');};
  await page.goto(`http://127.0.0.1:${address.port}`);await page.waitForFunction(()=>window.LCI_STATE);
  await login('ui_admin','UI-Test-Only-Password-2026!');
  await page.click('[data-view="view-11"]');await page.click('#device-new');
  await page.fill('#device-id','ui_lab');await page.fill('#device-name','UI Lab Sensor & Relay');await page.selectOption('#device-type','MIXED');await page.fill('#device-ip','10.99.0.44');
  await submit('#device-editor-form button[type=submit]','/api/v1/registry','POST',201);
  await page.waitForFunction(()=>document.querySelector('#registry-detail h3')?.textContent==='UI Lab Sensor & Relay');
  ctx.mqttService.config.mqttEnabled=true;ctx.mqttService.connected=true;ctx.mqttService.client={connected:true};
  let seq=0;const frame=value=>{const result=ctx.operations.ingest('ui_lab',{schema_version:1,device_id:'ui_lab',boot_id:'ui-boot',seq:++seq,values:{temperature:value,relay:'OFF'}});assert.ok(result.ok);ctx.operations.tick();};
  frame(25);await page.click('#device-detail-refresh');await page.waitForFunction(()=>document.querySelector('#device-live-values').textContent.includes('25'));
  ctx.mqttService.publishCommand=async(_topic,p)=>{setTimeout(()=>ctx.operations.acknowledgeCommand(p.device_id,{schema_version:1,device_id:p.device_id,command_id:p.command_id,status:'EXECUTED',observed_value:p.value}),100);};
  await page.locator('[data-switch-value="ON"]').click();await submit('#execute-confirm-modal-btn','/api/v1/registry/ui_lab/commands','POST',202);
  await page.waitForTimeout(150);await page.click('#device-detail-refresh');await page.waitForFunction(()=>document.querySelector('#device-command-history').textContent.includes('STATE REPORTED'));
  await page.click('[data-view="view-10"]');await page.waitForFunction(()=>document.querySelector('#rule-device option[value="ui_lab"]'));
  await page.fill('#rule-name','UI high temperature');await page.selectOption('#rule-device','ui_lab');await page.fill('#rule-threshold','30');await page.fill('#rule-clear','27');await page.fill('#rule-hold','0');await page.fill('#rule-clear-hold','0');await page.selectOption('#rule-severity','CRITICAL');
  await submit('#alarm-rule-form button[type=submit]','/api/v1/rules','POST',201);frame(36);
  await page.click('#alarms-refresh');await page.waitForFunction(()=>document.querySelector('#alarm-list').textContent.includes('UI high temperature'));
  await page.locator('#alarm-list [data-alarm-open]').first().click();await page.fill('#alarm-comment','Investigating the test sensor');
  const id=ctx.db.prepare("SELECT alarm_id FROM alarms WHERE title='UI high temperature'").get().alarm_id;
  await submit('#alarm-action-form button[value=acknowledge]',`/api/v1/alarms/${id}/acknowledge`);
  await page.waitForFunction(()=>document.querySelector('#alarm-detail').textContent.includes('ACKNOWLEDGED'));
  frame(26);await page.click('#alarms-refresh');await page.locator('#alarm-list [data-alarm-open]').first().click();await page.waitForFunction(()=>document.querySelector('#alarm-detail').textContent.includes('RESOLVED'));
  await page.click('[data-view="view-9"]');await page.waitForSelector('#notifications-list [data-notification-id]');
  await page.selectOption('#notification-category','ALARM');await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/notifications'&&new URL(r.url()).searchParams.get('category')==='ALARM'),page.click('#notification-filter button[type=submit]')]);
  // GET filters use query parameters, so wait for the rendered matching event.
  await page.waitForFunction(()=>document.querySelector('#notifications-list').textContent.includes('UI high temperature'));
  await submit('#notifications-read-all','/api/v1/notifications/read-all','PUT');await page.waitForFunction(()=>document.querySelector('#notification-badge').textContent==='0');
  if(process.env.UI_SCREENSHOT_DIR){fs.mkdirSync(process.env.UI_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'notifications.png'),fullPage:true});}
  await page.click('[data-view="view-11"]');await page.click('#device-new');await page.fill('#device-id','ui_camera');await page.fill('#device-name','UI Camera');await page.selectOption('#device-type','CAMERA');await page.fill('#device-ip','10.99.0.45');await submit('#device-editor-form button[type=submit]','/api/v1/registry','POST',201);
  await page.waitForFunction(()=>document.querySelector('#registry-detail h3')?.textContent==='UI Camera');
  jpeg=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=24;const x=c.getContext('2d');x.fillStyle='navy';x.fillRect(0,0,32,24);return c.toDataURL('image/jpeg').split(',')[1];}),'base64');
  await page.click('#device-capture');await page.waitForFunction(()=>document.querySelector('#device-snapshot-image')?.naturalWidth>0);
  await page.click('[data-device-open="ui_lab"]');await page.waitForFunction(()=>document.querySelector('#registry-detail h3')?.textContent==='UI Lab Sensor & Relay');await page.fill('#maintenance-minutes','30');await page.fill('#maintenance-reason','Planned UI acceptance');await submit('#device-maintenance-form button[type=submit]','/api/v1/registry/ui_lab/maintenance');
  await page.waitForFunction(()=>document.querySelector('[data-switch-value="ON"]')?.disabled===true);
  if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'device-registry.png'),fullPage:true});
  const admin=ctx.repo.findUserByUsername('ui_admin');
  ctx.management.createOperator({username:'ui_viewer',password:'UI-Viewer-Only-2026!',role:'Viewer'},admin,'ui-test');
  await page.click('#logout-btn');await page.waitForSelector('#login-overlay:not(.hidden)');await login('ui_viewer','UI-Viewer-Only-2026!');await page.click('[data-view="view-11"]');assert.ok(await page.locator('#device-new').isHidden());
  await page.click('[data-view="view-10"]');assert.ok(await page.locator('#alarm-rule-form').isHidden());
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'mobile-alarms.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: registry/mixed endpoints, reported command, alarm raise/ack/recover, persistent inbox/read-all, camera proxy, maintenance, Viewer gating, mobile layout');
} finally {
  await browser.close();ctx.mqttService.client=null;ctx.mqttService.connected=false;await ctx.stop();
}
