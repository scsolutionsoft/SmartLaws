import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1200,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let deletes=0;
 await page.route('**/api/**',async route=>{
  const url=route.request().url();
  if(url.endsWith('/backup'))return route.fulfill({status:200,contentType:'application/zip',headers:{'X-Case-Backup-Token':'test-receipt','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('คดีดำ-อ123-2569_15-11-2569_14-30-05.zip')},body:Buffer.from('PK fixture for browser download event')});
  if(route.request().method()==='DELETE'){deletes++;return route.fulfill({json:{deleted:true}});}
  if(url.endsWith('/hearings'))return route.fulfill({json:[{id:4,caseId:1,title:'นัดอ่านคำพิพากษา',courtLevel:'ศาลชั้นต้น',startsAt:'2026-11-20T09:00:00+07:00',location:'ศาลทดสอบ',status:'scheduled'}]});
  return route.fulfill({json:[]});
 });
 await page.route('**/ui-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'}));
 await page.goto('http://localhost:5088/ui-fixture');
 await page.evaluate(()=>{
  document.body.innerHTML='<div id="workspaceView"></div><h1 id="pageHeaderTitle"></h1><dialog id="workspaceDialog"><div id="workspaceDialogBody"></div></dialog>';
  const c={id:1,caseCode:'TEST',courtName:'ศาลทดสอบ',plaintiffName:'ผู้ทดสอบ',defendantName:'ผู้ทดสอบ',blackCaseNo:'TEST/2569'};
  window.App={state:{currentUser:{id:1,role:'Lawyer'},currentCaseId:1},getAccessibleCases:()=>[c],getAccessibleCaseFiles:()=>[{id:2,caseId:1,fileTitle:'คำพิพากษาทดสอบ',courtLevel:'ศาลชั้นต้น',formCode:'(๓๑)',fileStatus:'ร่าง'}],escapeHtml:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),loadDashboardData:async()=>{},renderAllViews:()=>{},showToast:()=>{}};
  window.Workspace={open:()=>{},installShell:()=>{},events:[]};window.CaseCalendar={edit:()=>{},rows:[],upcoming:[]};window.AppointmentFiles={links:[{appointmentId:4,fileId:2}]};
 });
 await page.addScriptTag({url:'http://localhost:5088/js/case-management.js'});
 await page.addScriptTag({url:'http://localhost:5088/js/case-hearings.js'});
 await page.evaluate(()=>CaseManagement.edit(1));
 await page.locator('#caseHearingPanel h4').first().waitFor();
 for(const level of ['ศาลชั้นต้น','ศาลอุทธรณ์','ศาลฎีกา'])assert.ok(await page.locator('#caseHearingPanel').getByRole('heading',{name:level,exact:true}).count());
 assert.ok(await page.locator('#caseHearingPanel').getByText('คำพิพากษาทดสอบ',{exact:false}).count());
 await page.evaluate(()=>document.getElementById('workspaceDialog').close());
 await page.evaluate(()=>CaseManagement.remove(1));
 assert.equal(deletes,0);
 const downloadPromise=page.waitForEvent('download');
 await page.locator('#prepareDelete').click();
 const download=await downloadPromise;assert.equal(download.suggestedFilename(),'คดีดำ-อ123-2569_15-11-2569_14-30-05.zip');
 await page.locator('#confirmDeleteForm').waitFor();assert.equal(deletes,0);
 await page.locator('#confirmDeleteForm button').first().click();assert.equal(deletes,0);
 await page.locator('[name=saved]').check();await page.locator('[name=confirmation]').fill('ลบคดี');
 await page.locator('#confirmDeleteForm button').first().click();
 await page.waitForFunction(()=>!document.getElementById('workspaceDialog').open);
 assert.equal(deletes,1);assert.deepEqual(errors,[]);
 console.log('PASS: browser renders three court levels and related files; download precedes second confirmation; unchecked confirmation prevents deletion. API mocked, no real cases touched.');
} finally {await browser.close();}
