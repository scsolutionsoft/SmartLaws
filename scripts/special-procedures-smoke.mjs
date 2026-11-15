import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/procedure-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="th"><body><section id="view-procedure"><div><h2>แผนผังวิธีพิจารณาคดี</h2><div><div id="criminalProcedureGrid"></div></div><div><div id="civilProcedureGrid"></div></div></div></section></body></html>'}));
 await page.goto('http://localhost:5088/procedure-fixture');
 await page.addStyleTag({url:'http://localhost:5088/css/workspace.css'});await page.addStyleTag({url:'http://localhost:5088/css/special-procedures.css'});
 await page.evaluate(()=>{window.calls=[];window.App={escapeHtml:v=>String(v??'').replaceAll('<','&lt;'),state:{templates:[{id:99,formCode:'(๔)'}]},getAccessibleCases:()=>[{id:7,caseCode:'TEST',plaintiffName:'ผู้ทดสอบ',defendantName:'ผู้ทดสอบ'}],renderProcedureWorkflowView:()=>{},showToast:t=>calls.push(['toast',t]),createNewDocFromTemplate:id=>calls.push(['draft',id]),openCaseFilesDirectory:id=>calls.push(['files',id])};window.CaseCalendar={open:()=>calls.push(['calendar',CaseCalendar.caseId])};});
 await page.addScriptTag({url:'http://localhost:5088/js/special-procedures.js'});await page.evaluate(()=>App.renderProcedureWorkflowView());
 assert.equal(await page.locator('.procedure-flow li').count(),12);
 await page.locator('[data-procedure-filter=administrative]').click();assert.equal(await page.locator('[data-procedure-track]:visible').count(),1);
 assert.equal(await page.locator('.administrative [onclick*="draft"]').count(),0);
 assert.ok(await page.locator('.administrative a[href="https://www.admincourt.go.th/service/service-form"]').count());
 await page.locator('[data-procedure-filter=corruption]').click();await page.getByRole('button',{name:'＋ ร่างคำฟ้อง',exact:true}).click();assert.equal(await page.evaluate(()=>calls.filter(x=>x[0]==='draft').length),0);
 await page.locator('#procedureCaseSelect').selectOption('7');await page.getByRole('button',{name:'＋ ร่างคำฟ้อง',exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls.find(x=>x[0]==='draft')),['draft',99]);
 await page.evaluate(()=>App.renderProcedureWorkflowView());assert.equal(await page.locator('#specialProcedureTracks').count(),1);assert.equal(await page.locator('#procedureCaseSelect').inputValue(),'7');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS: 12 steps, filters, official administrative forms, template lookup by code, case selection, rerender and mobile layout.');
} finally {await browser.close();}
