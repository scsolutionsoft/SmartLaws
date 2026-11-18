import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');
const base=process.env.SMARTLAWS_URL||'http://localhost:5119';
const browser=await chromium.launch({headless:true});
const results=[];
try {
 const context=await browser.newContext();
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await fs.mkdir('artifacts/ui-review',{recursive:true});
 async function check(name){
   await page.waitForTimeout(250);
   const result=await page.evaluate(()=>({styled:document.body.classList.contains('sl-ui'),overflow:document.documentElement.scrollWidth>innerWidth+2,width:innerWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.left>=0&&r.right>innerWidth+2&&getComputedStyle(e).position!=='fixed'&&!e.closest('.overflow-x-auto,.sl-table-wrap,.court-paper-wrapper,.cal-grid-wrap');}).slice(0,8).map(e=>({tag:e.tagName,id:e.id,classes:e.className,right:Math.round(e.getBoundingClientRect().right)}))}));
   results.push({name,...result});
   assert.ok(result.styled,name+' missing shared UI');
   console.log(name,JSON.stringify(result));
   if(result.overflow)await page.screenshot({path:`artifacts/ui-review/overflow-${name}.png`,fullPage:true});
 }
 for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   for(const path of ['login.html','client.html','consultation.html']){
     await page.goto(base+'/'+path);await page.waitForLoadState('networkidle');
     await check(path+'-'+width);
   }
 }
 assert.ok(process.env.SMARTLAWS_LAWYER && process.env.SMARTLAWS_LAWYER_PASSWORD,'Set test account environment variables');
 const login=await context.request.post(base+'/api/auth/login',{data:{username:process.env.SMARTLAWS_LAWYER,password:process.env.SMARTLAWS_LAWYER_PASSWORD}});
 assert.ok(login.ok(),'login failed');
 await page.goto(base+'/');await page.waitForSelector('.sl-hero');
 for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:950});
   for(const tab of ['home','settings','litigation']){
     await page.evaluate(tab=>Workspace.open(tab),tab);await check(tab+'-'+width);
   }
   await page.evaluate(()=>WorkGuide.open());await check('guide-'+width);
   await page.evaluate(()=>OfficeTeam.open('cases'));await page.waitForSelector('.ot-picker');
   await check('office-'+width);await page.evaluate(()=>OfficeTeam.dialog.close());
   for(const tab of ['cases','files','reports','subscription','esign','batchprint']){
     await page.evaluate(tab=>App.switchTab(tab),tab);await check(tab+'-'+width);
   }
   await page.evaluate(()=>Workspace.open('home'));
   await page.waitForTimeout(750);
   await page.screenshot({path:`artifacts/ui-review/home-${width}.png`,fullPage:true});
 }
 await page.evaluate(()=>Workspace.startWizard());
 await page.waitForSelector('#workspaceDialog[open]');await check('wizard-mobile');
 await page.screenshot({path:'artifacts/ui-review/wizard-mobile.png'});
 await page.evaluate(()=>document.getElementById('workspaceDialog').close());
 await page.evaluate(()=>App.createNewDocFromTemplate(App.state.templates.find(t=>t.formCode==='(๗)').id));
 await page.evaluate(()=>document.getElementById('view-studio').dataset.mobilePanel='preview');
 await page.waitForSelector('#studioPaperPreview .court-page');
 await check('studio-mobile');
 const typography=await page.evaluate(()=>{
   const sheet=[...document.styleSheets].find(s=>s.href?.includes('/css/app-ui.css'));
   const snapshot=()=>[...document.querySelectorAll('#studioPaperPreview .court-page,#studioPaperPreview .court-page *')].map(e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.lineHeight,s.width,s.height].join('|');});
   const styled=snapshot();sheet.disabled=true;const original=snapshot();sheet.disabled=false;
   return {same:JSON.stringify(styled)===JSON.stringify(original),elements:styled.length};
 });
 assert.ok(typography.same,'Shared UI must not alter court paper typography or geometry');
 console.log('COURT_PAPER',JSON.stringify(typography));
 for(const width of [1440,390]){
   await page.setViewportSize({width,height:950});
   const actions=[['calendar',()=>CaseCalendar.open()],['documents',()=>DocumentVault.open('personal')],['client-documents',()=>DocumentVault.open('client')],['clients',()=>ClientDesk.open()],['case-management',()=>CaseManagement.open()],['case-overview',()=>CaseOverview.open()],['news',()=>Community.open()],['messages',()=>Community.messages()],['procedures',()=>App.switchTab('procedure')]];
   for(const [name,action] of actions){await page.evaluate(action);await check(name+'-'+width);}
   if(width===390){await page.evaluate(()=>App.switchTab('files'));await page.screenshot({path:'artifacts/ui-review/files-mobile.png',fullPage:true});}
 }
 assert.ok(results.every(x=>!x.overflow),'page overflow detected');
 assert.deepEqual(errors,[],'browser errors');
 console.log(JSON.stringify({checks:results,errors},null,2));
}finally{await browser.close();}
