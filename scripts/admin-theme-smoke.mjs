import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');
const base='http://localhost:5119';
const browser=await chromium.launch({headless:true});
try {
 const ctx=await browser.newContext();const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const login=await ctx.request.post(base+'/api/auth/login',{data:{username:process.env.SMARTLAWS_LAWYER,password:process.env.SMARTLAWS_LAWYER_PASSWORD}});assert.ok(login.ok());
 const user=await(await ctx.request.get(base+'/api/auth/me')).json();
 await page.goto(base+'/');await page.waitForSelector('.sl-hero');
 // Exercise the admin presentation with the existing test login; no account permissions are changed.
 await page.evaluate(()=>{App.state.currentUser.role='Admin';document.body.dataset.role='Admin';Workspace.open('settings');});
 assert.equal(await page.locator('.sl-theme').count(),21);
 const themes=await page.evaluate(()=>Workspace.availableThemes().map(x=>x[0]));
 const palettes=[];
 for(const id of themes){
  await page.evaluate(id=>Workspace.setTheme(id),id);
  const colors=await page.evaluate(()=>{const style=getComputedStyle(document.body);return {accent:style.getPropertyValue('--accent').trim(),canvas:style.getPropertyValue('--canvas').trim(),surface:getComputedStyle(document.querySelector('.sl-card')).backgroundColor,ink:getComputedStyle(document.querySelector('.sl-theme')).color,input:getComputedStyle(document.querySelector('#passwordForm input')).backgroundColor};});
  palettes.push(colors.accent);assert.equal(await page.locator('.sl-theme[aria-pressed=true]').count(),1);
  assert.equal(await page.evaluate(id=>localStorage.getItem(`sl-theme-${App.state.currentUser.id}`)===id,id),true);
  if(id==='admin-dark')assert.equal(colors.input,'rgb(28, 35, 45)');
  else assert.equal(colors.surface,colors.input,'card and input must follow same theme: '+id);
 }
 assert.ok(new Set(palettes).size>=20,'Themes must actually change colors');
 await page.evaluate(()=>Workspace.setTheme('rose'));
 await page.reload();await page.waitForSelector('.sl-hero');assert.equal(await page.evaluate(()=>document.body.dataset.theme),'rose');
 await page.evaluate(()=>{App.state.currentUser.role='Admin';document.body.dataset.role='Admin';Workspace.setTheme('admin-dark');});
 const dark=await page.evaluate(()=>getComputedStyle(document.querySelector('.sl-card')).backgroundColor);assert.equal(dark,'rgb(36, 43, 53)');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 // The separate consultation page restores the saved admin palette from the same account key.
 await page.route('**/api/auth/me',r=>r.fulfill({json:{...user,role:'Admin'}}));
 await page.route('**/api/consultations',r=>r.fulfill({json:[]}));
 for(const theme of ['rose','admin-dark']){
  await page.evaluate(({id,theme})=>localStorage.setItem(`sl-theme-${id}`,theme),{id:user.id,theme});
  await page.goto(base+'/consultation.html');await page.waitForSelector('#staffPanel:not([hidden])');
  assert.equal(await page.evaluate(()=>document.body.dataset.theme),theme);
  const bg=await page.locator('.pane').first().evaluate(e=>getComputedStyle(e).backgroundColor);
  assert.equal(bg,theme==='rose'?'rgb(255, 255, 255)':'rgb(36, 43, 53)');
 }
 await page.evaluate(id=>localStorage.removeItem(`sl-theme-${id}`),user.id);
 assert.deepEqual(errors,[]);console.log('PASS 21 admin themes, actual palette changes, selection, storage, reload, mobile and consultation persistence');
} finally {await browser.close();}
