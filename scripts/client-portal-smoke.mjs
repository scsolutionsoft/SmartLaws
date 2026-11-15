import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'C:/Users/Oh-z600-A/.nuget/packages/microsoft.playwright/1.55.0/.playwright/package');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mustChange=true,signedIn=true,homeCalls=0,sends=0;const messages=[{id:1,senderId:2,senderName:'ทนายทดสอบ',body:'ยินดีต้อนรับ <img src=x onerror=alert(1)>',createdAt:'2026-11-15T05:00:00',readAt:null}];
 const data={summary:{id:7,caseCode:'TEST',blackCaseNo:'อ123',blackCaseYear:'2569',courtName:'ศาลทดสอบ',status:'อยู่ระหว่างพิจารณา',clientName:'ลูกความทดสอบ',lawyerName:'ทนายทดสอบ'},appointments:[{id:1,title:'นัดฟังคำพิพากษา',startsAt:'2026-12-01T09:00:00+07:00',endsAt:'2026-12-01T10:00:00+07:00',status:'scheduled',location:'ห้องพิจารณา 1',courtLevel:'ศาลชั้นต้น'}],files:[{id:3,fileTitle:'เอกสารที่ทนายแชร์',storageType:'PDF',mimeType:'application/pdf'}],unread:1};
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname,method=route.request().method();
  if(path==='/api/auth/me')return route.fulfill({status:signedIn?200:401,json:signedIn?{id:1,fullName:'ลูกความทดสอบ',role:'Client',mustChangePassword:mustChange}:{}});
  if(path==='/api/auth/login'){signedIn=true;return route.fulfill({json:{role:'Client'}});}
  if(path==='/api/client/password'){const d=route.request().postDataJSON();if(d.newPassword!==d.confirmPassword)return route.fulfill({status:400,json:{message:'รหัสผ่านยืนยันไม่ตรงกัน'}});mustChange=false;signedIn=false;return route.fulfill({json:{requiresLogin:true}});}
  if(path==='/api/client/cases')return route.fulfill({json:[{...data.summary},{...data.summary,id:8,courtName:'Other Court'}]});
  if(path==='/api/client/home'){homeCalls++;return route.fulfill({json:data});}
  if(path==='/api/client/messages'&&method==='POST'){const d=route.request().postDataJSON();assert.ok(d.requestId);assert.ok(d.data.startsWith('data:application/pdf;base64,'));sends++;messages.push({id:2,senderId:1,senderName:'ลูกความทดสอบ',body:d.body,fileId:5,fileTitle:d.fileName,createdAt:'2026-11-15T06:00:00'});return route.fulfill({json:{id:2,fileId:5}});}
  if(path==='/api/client/messages')return route.fulfill({json:messages.slice().reverse()});
  return route.fulfill({json:{}});
 });
 await page.goto('http://localhost:5088/client.html',{waitUntil:'domcontentloaded'});
 await page.locator('#clientPassword').waitFor();assert.equal(homeCalls,0);
 await page.locator('[name=currentPassword]').fill('1234567890123');await page.locator('[name=newPassword]').fill('fixture-password');await page.locator('[name=confirmPassword]').fill('different-password');await page.locator('#clientPassword button').first().click();await page.getByText('รหัสผ่านยืนยันไม่ตรงกัน',{exact:true}).waitFor();
 await page.locator('[name=confirmPassword]').fill('fixture-password');await page.locator('#clientPassword button').first().click();await page.locator('#clientLogin').waitFor();await page.locator('[name=username]').fill('อ123/2569');await page.locator('[name=password]').fill('fixture-password');await page.locator('#clientLogin button').click();await page.getByRole('heading',{name:'ข้อมูลคดีของคุณ'}).waitFor();assert.equal(homeCalls,1);await page.locator('#clientCaseSelect').selectOption('8');await page.waitForFunction(()=>ClientSpace.caseId===8&&ClientSpace.data);await page.locator('#clientCaseSelect').selectOption('7');await page.waitForFunction(()=>ClientSpace.caseId===7&&ClientSpace.data);
 await fs.mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/client-portal-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'▤ วันนัดและเอกสาร',exact:true}).click();await page.getByText('เอกสารที่ทนายแชร์',{exact:true}).waitFor();assert.equal(await page.locator('a[href="/api/client/files/3?caseId=7"]').count(),1);
 await page.getByRole('button',{name:/✉ คุยกับทนาย/}).click();await page.locator('.cp-message').waitFor();assert.equal(await page.locator('#clientThread img').count(),0);
 await page.locator('#clientMessageForm textarea').fill('ส่งเอกสารให้ทนาย');await page.locator('#clientMessageForm input[type=file]').setInputFiles({name:'fixture.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture')});await page.locator('#clientMessageForm button').click();await page.locator('a[href="/api/client/files/5?caseId=7"]').waitFor();assert.equal(sends,1);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/client-portal-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: dedicated client UI, forced password setup and re-login, case/appointment/file rendering, escaped chat text, PDF attachment send, responsive layout. APIs mocked.');
}finally{await browser.close();}
