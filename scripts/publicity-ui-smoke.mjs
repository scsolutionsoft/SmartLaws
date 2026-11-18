import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');
const base=process.env.SMARTLAWS_URL||'http://localhost:5119';
const browser=await chromium.launch({headless:true});
const errors=[];
try {
 const context=await browser.newContext();const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await fs.mkdir('artifacts/publicity',{recursive:true});
 const fixture=[{Id:99,Title:'บริการปรึกษาคดีและข่าวสารสำนักงาน',Body:'ข้อมูลประชาสัมพันธ์จากสำนักงานทนายความ '.repeat(25)+'<script>test</script>',Image:'',Youtube:'dQw4w9WgXcQ',StartsAt:'2026-11-17T00:00:00Z',EndsAt:'2026-12-01T00:00:00Z'}];
 await page.route('https://www.youtube-nocookie.com/**',r=>r.fulfill({contentType:'text/html',body:'<p>Video preview fixture</p>'}));
 await page.route('**/api/public/news',r=>r.fulfill({json:fixture}));
 let role=null;
 await page.route('**/api/auth/me',r=>role?r.fulfill({json:{id:3,fullName:'ทนายทดสอบ',role}}):r.fulfill({status:401,json:{}}));
 await page.route('**/api/consultations',r=>r.fulfill({json:[]}));
 await page.route('**/api/consultations/mine',r=>r.fulfill({json:[]}));
 for(const testRole of [null,'Lawyer','Admin','Prospect','Client']){
  role=testRole;
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:950});await page.goto(base+'/consultation.html');
   await page.waitForSelector('.community-news');
   if(role)await page.waitForSelector(role==='Lawyer'||role==='Admin'?'#staffPanel:not([hidden])':'#portalPanel:not([hidden])');
   else await page.waitForSelector('#authPanel:not([hidden])');
   assert.equal(await page.locator('.back-work').count(),['Lawyer','Admin'].includes(role)?1:0);
   assert.equal(await page.locator('#consultationManageNews').isVisible(),role==='Admin');
   assert.equal(await page.locator('.community-news .community-details').count(),1);
   assert.equal(await page.locator('.community-news script').count(),0);
   assert.equal(await page.locator('.community-news iframe').count(),1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),`${role}-${width} overflow`);
   await page.locator('.community-details summary').click();
   assert.ok(await page.locator('.community-details').getAttribute('open')!==null);
   if(role==='Lawyer'||!role)await page.screenshot({path:`artifacts/publicity/consultation-${role||'guest'}-${width}.png`,fullPage:true});
   console.log('PASS',role||'guest',width);
  }
 }
 await page.unroute('**/api/auth/me');
 assert.ok(process.env.SMARTLAWS_LAWYER&&process.env.SMARTLAWS_LAWYER_PASSWORD);
 const login=await context.request.post(base+'/api/auth/login',{data:{username:process.env.SMARTLAWS_LAWYER,password:process.env.SMARTLAWS_LAWYER_PASSWORD}});assert.ok(login.ok());
 await page.setViewportSize({width:1440,height:950});await page.goto(base+'/');await page.waitForSelector('.sl-hero');await page.waitForSelector('.community-news');
 assert.ok((await page.locator('.sl-hero img').getAttribute('src')).includes('law-office.svg'));
 await page.screenshot({path:'artifacts/publicity/home.png',fullPage:true});
 await page.goto(base+'/?page=news');await page.waitForSelector('#communityFeed .community-news');
 assert.equal(await page.evaluate(()=>Workspace.tab),'news');
 await page.route('**/api/admin/news',r=>r.fulfill({json:fixture}));
 await page.evaluate(()=>{App.state.currentUser.role='Admin';Community.open();});
 await page.waitForSelector('#communityFeed button');
 await page.evaluate(()=>Community.editor(99));
 await page.waitForSelector('#newsForm');
 assert.equal(await page.locator('#newsForm input[name=title]').inputValue(),fixture[0].Title);
 await page.evaluate(()=>document.getElementById('workspaceDialog').close());
 await context.request.post(base+'/api/auth/logout');
 await page.goto(base+'/login.html');await page.waitForSelector('#publicNews .community-news');
 assert.deepEqual(errors,[]);
 console.log('PASS home image, news navigation, login publicity; no browser errors');
}finally{await browser.close();}
