import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const tabs = await (await fetch('http://localhost:9222/json/list')).json();
const socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, {once:true}));
let seq = 0; const pending = new Map(), errors = [];
socket.addEventListener('message', e => { const m=JSON.parse(e.data); if(m.id) { const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(Error(m.error.message)):p.resolve(m.result); } if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
function call(method,params={}) { const id=++seq; return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));}); }
async function evaluate(expression) { const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value; }
async function until(expression) { for(let i=0;i<60;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,500));}throw Error('Timed out: '+expression); }
await call('Runtime.enable'); await call('Page.enable');
await evaluate('fetch("http://localhost:5088/api/auth/logout",{method:"POST",credentials:"include"})');
await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await call('Page.navigate',{url:'http://localhost:5088/login.html'});
await until('!!document.getElementById("authForm")');
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile('artifacts/login.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
const credentials={username:process.env.SMARTLAWS_LAWYER,password:process.env.SMARTLAWS_LAWYER_PASSWORD};
assert.ok(credentials.username && credentials.password);
await evaluate(`document.querySelector('[name=username]').value=${JSON.stringify(credentials.username)};document.querySelector('[name=password]').value=${JSON.stringify(credentials.password)};document.getElementById('authForm').requestSubmit();`);
await until('!!window.Workspace && document.body.style.visibility === "visible" && !!document.querySelector(".sl-hero")');
await evaluate('document.fonts.ready');
let docId,fileId;
try{
 await evaluate("App.createNewDocFromTemplate(App.state.templates.find(t=>t.formCode==='(๑๕)').id);App.state.currentClauses=Array.from({length:20},(_,i)=>({OrderNo:i+1,WitnessNameAndDesc:'พยานทดสอบ '+i,AddressText:'ทดสอบ',Note:'นำ'}));document.getElementById('edDocumentTitle').value='studio-save-test-'+Date.now();App.syncEditorToPreview()");
 const saved=await evaluate('App.archiveCurrentFormToCaseDirectory()');assert.ok(saved?.id);docId=saved.id;
 assert.equal(await evaluate("document.getElementById('studioSavePercent').textContent"),'100%');
 let files=await evaluate(`App.getAccessibleCaseFiles().filter(f=>f.documentId===${docId})`);assert.equal(files.length,1);fileId=files[0].id;assert.ok(files[0].pageCount>=2);assert.equal(files[0].mimeType,'text/html');
 await evaluate("document.getElementById('studioSaveStatus').close()");
 await evaluate('App.archiveCurrentFormToCaseDirectory()');assert.equal(await evaluate(`App.getAccessibleCaseFiles().filter(f=>f.documentId===${docId}).length`),1);
 await evaluate(`document.getElementById('studioSaveStatus').close();App.openCaseFileInPopup(${fileId})`);
 assert.ok(await evaluate("document.querySelectorAll('#popupViewerBody .court-page').length>=2"));await evaluate('App.closePopupFileViewer()');
 // Partial failure is reported without losing the saved draft or producing another catalogue entry.
 await evaluate("window.originalSaveFetch=window.fetch;window.fetch=(u,o)=>String(u).endsWith('/archive')?Promise.resolve(new Response(JSON.stringify({message:'ทดสอบการเชื่อมต่อขัดข้อง'}),{status:503,headers:{'Content-Type':'application/json'}})):originalSaveFetch(u,o)");
 assert.equal(await evaluate('App.archiveCurrentFormToCaseDirectory()'),null);
 assert.ok((await evaluate("document.getElementById('studioSaveTitle').textContent")).includes('บันทึกร่างแล้ว'));
 assert.notEqual(await evaluate("document.getElementById('studioSavePercent').textContent"),'100%');
 await evaluate("window.fetch=window.originalSaveFetch;document.getElementById('studioSaveStatus').close()");
 const double=await evaluate('(async()=>{const results=await Promise.all([App.saveCurrentStudioDocument(),App.saveCurrentStudioDocument()]);return results.map(r=>r?.id||null)})()');assert.deepEqual(double,[docId,null]);
 await evaluate("document.getElementById('studioSaveStatus').close()");
 const login=await fetch('http://localhost:5088/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.SMARTLAWS_OTHER_LAWYER,password:process.env.SMARTLAWS_OTHER_PASSWORD})});const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 assert.equal((await fetch(`http://localhost:5088/api/documents/${docId}/archive`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{"pageCount":2}'})).status,404);
 await fetch('http://localhost:5088/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});
 assert.deepEqual(errors,[]);console.log('PASS: draft/save-and-archive, multi-page preview, idempotent archive, duplicate click guard, partial failure progress, cross-account protection');
}finally{
 await evaluate('if(window.originalSaveFetch)window.fetch=window.originalSaveFetch');
 if(fileId)await evaluate(`fetch('/api/files/${fileId}',{method:'DELETE'})`);
 if(docId)await evaluate(`fetch('/api/documents/${docId}',{method:'DELETE'})`);
 socket.close();
}
