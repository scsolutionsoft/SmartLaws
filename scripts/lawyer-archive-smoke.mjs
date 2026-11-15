import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let deletes=0,restores=0;
 const summary={name:'ทนายทดสอบ',username:'fixture-lawyer',licenseNo:'TEST',cases:2,files:3,documents:4,appointments:2,clients:1,personalDocuments:1,usedCredits:7};
 await page.route('**/archive-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="th"><head><meta charset="utf-8"></head><body><div id="adminUsersTableContainer"></div><dialog id="workspaceDialog" class="sl-dialog"><div id="workspaceDialogBody" class="sl-dialog-body"></div></dialog></body></html>'}));
 await page.route('**/api/admin/lawyer-archives/**',async r=>{const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/backup'))return r.fulfill({contentType:'application/zip',headers:{'X-Lawyer-Backup-Receipt':'fixture','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('ทนาย-ทดสอบ.zip')},body:Buffer.from('PK fixture')});
  if(path.endsWith('/preview'))return r.fulfill({json:{archiveId:'fixture',createdAt:'2026-11-15T00:00:00Z',summary}});
  if(path.endsWith('/restore')){assert.equal(r.request().headers()['x-restore-confirmation'],'RESTORE');restores++;return r.fulfill({json:{restored:true,cases:2}});}
  if(r.request().method()==='DELETE'){const d=r.request().postDataJSON();assert.equal(d.receipt,'fixture');assert.ok(d.saved);assert.equal(d.confirmation,'ลบทนายและคดีทั้งหมด');deletes++;return r.fulfill({json:{deleted:true}});}
  return r.fulfill({json:summary});
 });
 await page.goto('http://localhost:5088/archive-fixture');await page.addStyleTag({url:'http://localhost:5088/css/workspace.css'});
 await page.evaluate(()=>{window.App={escapeHtml:v=>String(v??'').replaceAll('<','&lt;'),state:{currentUser:{id:1,role:'Admin'},users:[{id:7,role:'Lawyer',fullName:'ทนายทดสอบ',username:'fixture-lawyer'}]},loadDashboardData:async()=>{},renderBackofficeView:()=>Workspace.adminUsers(),showToast:()=>{}};window.Workspace={adminUsers:()=>{document.getElementById('adminUsersTableContainer').innerHTML='<table><tbody><tr><td>ทนายทดสอบ</td><td></td></tr></tbody></table>';}};});
 await page.addScriptTag({url:'http://localhost:5088/js/lawyer-archive.js'});await page.evaluate(()=>Workspace.adminUsers());
 await page.getByRole('button',{name:'▣ สำรอง / ลบข้อมูล',exact:true}).click();await page.locator('#lawyerDownload').waitFor();assert.equal(await page.locator('#archiveDeleteForm').count(),0);
 const pending=page.waitForEvent('download');await page.locator('#lawyerDownload').click();assert.equal((await pending).suggestedFilename(),'ทนาย-ทดสอบ.zip');
 await page.locator('#archiveDeleteForm button').click();assert.equal(deletes,0);await page.locator('#archiveDeleteForm [name=saved]').check();await page.locator('#archiveDeleteForm [name=confirmation]').fill('ลบทนายและคดีทั้งหมด');
 await fs.mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/lawyer-archive-delete.png',fullPage:true});
 await page.locator('#archiveDeleteForm button').click();await page.waitForFunction(()=>!document.getElementById('workspaceDialog').open);assert.equal(deletes,1);
 await page.getByRole('button',{name:'↥ กู้คืนทนายจาก ZIP',exact:true}).click();await page.locator('#archivePreview input').setInputFiles({name:'fixture.zip',mimeType:'application/zip',buffer:Buffer.from('PK fixture')});await page.locator('#archivePreview button').click();await page.locator('#archiveRestore').waitFor();await page.locator('#archiveRestore button').click();assert.equal(restores,0);await page.locator('#archiveRestore select').selectOption('7');await page.locator('#archiveRestore input[type=checkbox]').check();await page.screenshot({path:'artifacts/lawyer-archive-restore.png',fullPage:true});await page.locator('#archiveRestore button').click();await page.waitForFunction(()=>!document.getElementById('workspaceDialog').open);assert.equal(restores,1);
 await page.evaluate(()=>{App.state.currentUser.role='Lawyer';Workspace.adminUsers();LawyerArchive.restore();});assert.equal(await page.locator('button[onclick="LawyerArchive.restore()"]').count(),0);assert.equal(await page.locator('dialog[open]').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: admin-only archive UI, mandatory download and saved-file confirmation, typed deletion, restore preview, target selection and explicit confirmation. Mocked APIs.');
}finally{await browser.close();}
