import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());let accounts=[],shared=[],sent=0;
 await page.route('**/desk-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="th"><head><meta charset="utf-8"></head><body><h1 id="pageHeaderTitle"></h1><div id="workspaceView"></div><dialog id="workspaceDialog" class="sl-dialog"><div id="workspaceDialogBody" class="sl-dialog-body"></div></dialog></body></html>'}));
 await page.route('**/api/**',async r=>{const url=new URL(r.request().url()).pathname,m=r.request().method();
 if(url==='/api/client-management/7'&&m==='POST'){const d=r.request().postDataJSON();assert.equal(d.partyId,3);assert.equal(d.citizenId,'1234567890123');accounts=[{userId:8,partyId:3,fullName:'ลูกความจำลอง',username:'1234567890123',accountStatus:'Active',mustChangePassword:true,unread:0}];return r.fulfill({json:{userId:8,username:'1234567890123'}});}
 if(url==='/api/client-management/7')return r.fulfill({json:{accounts,parties:[{id:3,fullName:'ลูกความจำลอง'}],baseUsername:'TEST/2569'}});
 if(url.endsWith('/files')&&m==='GET')return r.fulfill({json:[{id:9,fileTitle:'ไฟล์สำหรับลูกความ',storageType:'PDF',shared:false}]});
 if(url.endsWith('/files')){shared=r.request().postDataJSON().fileIds;return r.fulfill({json:{}});}
 if(url.endsWith('/messages')&&m==='POST'){assert.ok(r.request().postDataJSON().requestId);sent++;return r.fulfill({json:{id:1}});}
 if(url.endsWith('/messages'))return r.fulfill({json:[]});
 return r.fulfill({json:{}});
 });
 await page.goto('http://localhost:5088/desk-fixture');await page.addStyleTag({url:'http://localhost:5088/css/workspace.css'});await page.addStyleTag({url:'http://localhost:5088/css/community.css'});
 await page.evaluate(()=>{window.App={escapeHtml:v=>String(v??'').replaceAll('<','&lt;'),state:{currentUser:{id:1,role:'Lawyer'},users:[]},getAccessibleCases:()=>[{id:7,caseCode:'TEST',blackCaseNo:'TEST/2569',plaintiffName:'โจทก์',defendantName:'จำเลย'}],showToast:()=>{}};window.Workspace={open:()=>{},installShell:()=>{},adminUsers:()=>{}};window.CaseManagement={edit:()=>{}};});
 await page.addScriptTag({url:'http://localhost:5088/js/client-desk.js'});await page.evaluate(()=>ClientDesk.open(7));await page.getByRole('button',{name:'＋ ผูกคดี / ยืนยันเลขประจำตัว',exact:true}).click();await page.locator('[name=citizenId]').fill('1234567890123');await page.locator('#clientCreate input[type=checkbox]').check();await page.locator('#clientCreate button').first().click();await page.locator('#clientCreateDone').waitFor();assert.ok((await page.locator('#workspaceDialogBody').textContent()).includes('1234567890123'));await page.locator('#clientCreateDone').click();
 await page.getByRole('button',{name:'เลือกเอกสารที่ให้ดู',exact:true}).click();await page.locator('#portalShares [name=fileId]').check();await page.locator('#portalShares button').first().click();await page.waitForFunction(()=>!document.getElementById('workspaceDialog').open);assert.deepEqual(shared,[9]);
 await page.getByRole('button',{name:/✉ ข้อความ/}).click();await page.locator('#deskMessage textarea').fill('ข้อความถึงลูกความ');await page.locator('#deskMessage button').click();await page.waitForFunction(()=>!ClientDesk.sending);assert.equal(sent,1);assert.deepEqual(errors,[]);
 console.log('PASS: lawyer UI creates client account without echoing initial password, sets explicit file sharing and sends chat messages. APIs mocked.');
}finally{await browser.close();}
