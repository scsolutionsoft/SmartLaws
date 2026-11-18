import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');
const base=process.env.SMARTLAWS_URL||'http://localhost:5119';
const browser=await chromium.launch({headless:true});
let original,admin;
try {
 const guest=await browser.newContext();assert.equal((await guest.request.get(base+'/api/court-tracking/settings')).status(),401);
 const lawyer=await browser.newContext();admin=await browser.newContext();
 for(const [ctx,username,password] of [[lawyer,process.env.SMARTLAWS_LAWYER,process.env.SMARTLAWS_LAWYER_PASSWORD],[admin,process.env.SMARTLAWS_ADMIN,process.env.SMARTLAWS_ADMIN_PASSWORD]]){assert.ok(username&&password);assert.ok((await ctx.request.post(base+'/api/auth/login',{data:{username,password}})).ok());}
 original=await(await admin.request.get(base+'/api/court-tracking/settings')).json();
 assert.equal((await lawyer.request.put(base+'/api/admin/court-tracking',{data:{url:original.url}})).status(),403);
 for(const url of ['http://example.com','javascript:alert(1)','https://user:password@example.com/','not-a-url','', 'https://example.com/'+ 'x'.repeat(2100)])assert.equal((await admin.request.put(base+'/api/admin/court-tracking',{data:{url}})).status(),400,url);
 const page=await admin.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/');await page.waitForSelector('[data-court-tracking]');
 await page.evaluate(()=>Workspace.open('settings'));await page.waitForSelector('#ctSettingsForm input:not([disabled])');
 const testUrl='https://cios.coj.go.th/tracking/?smartlaws_test=1';
 await page.locator('#ctSettingsForm input').fill(testUrl);await page.locator('#ctSettingsForm button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('ctSettingsStatus').textContent.startsWith('บันทึกแล้ว'));
 assert.equal((await(await lawyer.request.get(base+'/api/court-tracking/settings')).json()).url,testUrl);
 await page.reload();await page.waitForSelector('[data-court-tracking]');await page.evaluate(()=>Workspace.open('settings'));await page.waitForSelector('#ctSettingsForm input:not([disabled])');assert.equal(await page.locator('#ctSettingsForm input').inputValue(),testUrl);
 await page.locator('#ctDefault').click();assert.equal(await page.locator('#ctSettingsForm input').inputValue(),original.defaultUrl);assert.equal((await(await admin.request.get(base+'/api/court-tracking/settings')).json()).url,testUrl,'Reset only edits draft until saved');
 await admin.request.put(base+'/api/admin/court-tracking',{data:{url:original.url}});
 const staffPage=await lawyer.newPage();staffPage.on('pageerror',e=>errors.push(e.message));
 await lawyer.route('https://cios.coj.go.th/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Court tracking test</h1>'}));
 await staffPage.goto(base+'/');await staffPage.waitForSelector('[data-court-tracking]');await staffPage.locator('[data-court-tracking]').click();await staffPage.waitForSelector('.ct-actions');
 assert.equal(await staffPage.locator('.ct-dialog iframe').count(),0,'Official service forbids embedding');assert.equal(await staffPage.locator('.ct-settings-link').count(),0);
 const popupPromise=staffPage.waitForEvent('popup');await staffPage.locator('.ct-actions button').click();const popup=await popupPromise;await popup.waitForLoadState();assert.equal(await popup.evaluate(()=>opener===null),true);assert.ok(popup.url().startsWith(original.url));await popup.close();
 await staffPage.evaluate(()=>{window.open=()=>null;});await staffPage.locator('.ct-actions button').click();assert.ok((await staffPage.locator('#ctStatus').textContent()).includes('ปิดกั้น'));
 for(const width of [1440,768,390]){await staffPage.setViewportSize({width,height:850});assert.ok(await staffPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.equal(await staffPage.locator('.ct-actions a').getAttribute('target'),'_blank');}
 await page.locator('[data-court-tracking]').click();await page.waitForSelector('.ct-settings-link');
 assert.deepEqual(errors,[]);console.log('PASS staff/guest/admin API permissions, HTTPS validation, admin save/reload, draft reset, popup destination/opener, blocked fallback, mobile/tablet/desktop');
} finally {
 if(admin&&original)assert.ok((await admin.request.put(base+'/api/admin/court-tracking',{data:{url:original.url}})).ok(),'Restore original link');
 await browser.close();
}
