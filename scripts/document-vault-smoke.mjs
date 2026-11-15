import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];let uploads=0;
 page.on('pageerror',e=>errors.push(e.message));
 const cases=[{id:7,caseCode:'TEST-7',courtName:'ศาลทดสอบ',plaintiffName:'โจทก์',defendantName:'จำเลย',status:'ดำเนินการ'}];
 await page.route('**/vault-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="th"><head><meta charset="utf-8"></head><body><h1 id="pageHeaderTitle"></h1><div id="workspaceView"></div><dialog id="workspaceDialog"><div id="workspaceDialogBody"></div></dialog></body></html>'}));
 await page.route('**/api/**',async r=>{const url=r.request().url();if(r.request().method()==='POST'){uploads++;return r.fulfill({json:{id:9}});}if(url.includes('client-records/'))return r.fulfill({json:{parties:[{id:3,caseId:7,fullName:'ลูกความทดสอบ'}],files:[]}});if(url.includes('work-summary'))return r.fulfill({json:{cases,files:[],documents:[],appointments:[],clients:[{id:3,caseId:7,fullName:'ลูกความทดสอบ'}],clientDocuments:[]}});return r.fulfill({json:[]});});
 await page.goto('http://localhost:5088/vault-fixture');await page.addStyleTag({url:'http://localhost:5088/css/workspace.css'});await page.addStyleTag({url:'http://localhost:5088/css/document-vault.css'});
 await page.evaluate(cases=>{window.App={state:{currentUser:{id:1,role:'Lawyer',fullName:'ทนายทดสอบ'}},escapeHtml:v=>String(v??'').replaceAll('<','&lt;'),getAccessibleCases:()=>cases,loadDashboardData:async()=>{},showToast:()=>{}};window.Workspace={open:()=>{},installShell:()=>{},home:()=>{}};window.CaseManagement={edit:()=>{}};},cases);
 await page.addScriptTag({url:'http://localhost:5088/js/document-vault.js'});
 await page.evaluate(()=>DocumentVault.start('client',7));await page.locator('#vaultParty option[value="3"]').waitFor({state:'attached'});await page.locator('#vaultParty').selectOption('3');await page.locator('#vaultForm button[type=submit]').click();
 await page.locator('#vaultFile').setInputFiles({name:'identity.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture\n%%EOF')});await page.locator('#vaultForm button[type=submit]').click();
 await page.locator('#vaultBack').click();assert.equal(await page.locator('#vaultFile').getAttribute('required'),null);await page.locator('#vaultForm button[type=submit]').click();assert.equal(uploads,0);
 await page.getByRole('button',{name:'บันทึกเอกสาร',exact:true}).click();assert.equal(uploads,0);await page.locator('#vaultForm input[type=checkbox]').check();await page.getByRole('button',{name:'บันทึกเอกสาร',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('workspaceDialog').open);assert.equal(uploads,1);
 await page.evaluate(()=>DocumentVault.open('client',0));assert.ok((await page.locator('#vaultRows').textContent()).includes('เลือกคดีก่อน'));
 await page.evaluate(()=>CaseOverview.open(7));await page.locator('#caseOverviewReport details').waitFor();assert.ok(await page.locator('#caseOverviewReport details').getAttribute('open')!==null);assert.ok((await page.locator('#caseOverviewReport').textContent()).includes('ยังไม่มี ลูกความทดสอบ — สำเนาบัตรประชาชน'));
 await page.evaluate(()=>WorkGuide.open());assert.equal(await page.locator('.guide-task').count(),9);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('PASS: client selection, three-step upload, retained file on back, mandatory review, empty-case selection, report missing-document checklist, nine guided tasks and mobile layout. APIs mocked.');
}finally{await browser.close();}
