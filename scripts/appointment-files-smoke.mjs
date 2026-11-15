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
const title='appointment-files-'+Date.now();let appointment,documentId;const fileIds=[];
try {
 appointment=await evaluate(`(async()=>{const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'});const r=await fetch('/api/appointments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId:App.getAccessibleCases()[0].id,title:${JSON.stringify(title)},kind:'นัดศาล',startsAt:date+'T09:00:00+07:00',endsAt:date+'T10:00:00+07:00',location:'ศาล',responsible:'ทดสอบ',notes:'',status:'scheduled',reminderMinutes:1440})});if(!r.ok)throw Error(await r.text());return r.json()})()`);
 await evaluate(`AppointmentFiles.openAppointment(${appointment.id})`);
 await until("!!document.getElementById('appointmentUploadInput')");
 await evaluate('AppointmentFiles.studio()');
 await evaluate(`document.getElementById('edDocumentTitle').value=${JSON.stringify(title+' studio')};App.syncEditorToPreview()`);
 await evaluate("AppointmentFiles.saveStudio(document.querySelector('#appointmentStudioBanner .primary'))");
 await evaluate("[...document.querySelectorAll('#studioSaveStatus button')].find(b=>b.textContent==='กลับไปวันนัด').click()");
 await until("document.querySelectorAll('[data-appointment-file]').length===1");
 documentId=await evaluate('App.state.currentDoc.id');
 let rows=await evaluate(`(async()=> (await fetch('/api/appointments/${appointment.id}/files')).json())()`);fileIds.push(rows[0].id);
 assert.equal(rows[0].documentId,documentId);assert.equal(rows[0].directoryIndexNo,4);
 // Linking the same studio document twice must reuse the catalogue entry and relation.
 await evaluate(`fetch('/api/appointments/${appointment.id}/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId:${documentId}})})`);
 assert.equal(await evaluate(`(async()=> (await (await fetch('/api/appointments/${appointment.id}/files')).json()).length)()`),1);
 const pdfPath=process.cwd()+'\\artifacts\\judgment-fixture.pdf';
 const imagePath=process.cwd()+'\\artifacts\\appointment-image.png';
 await fs.writeFile(imagePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZuoAAAAASUVORK5CYII=','base64'));
 const root=await call('DOM.getDocument');const input=await call('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#appointmentUploadInput'});
 await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[pdfPath,imagePath]});
 await evaluate("window.savedFetch=window.fetch;window.filePosts=0;window.failLink=true;window.fetch=async(url,o)=>{if(url==='/api/files'&&o?.method==='POST')filePosts++;if(String(url).endsWith('/files')&&String(url).startsWith('/api/appointments/')&&o?.method==='POST'&&failLink){failLink=false;return new Response(JSON.stringify({message:'จำลองเชื่อมไม่สำเร็จ'}),{status:503});}return savedFetch(url,o)}");
 await evaluate('AppointmentFiles.upload()');
 assert.equal(await evaluate('AppointmentFiles.entries.filter(e=>e.linked).length'),1);
 assert.equal(await evaluate('AppointmentFiles.entries.every(e=>e.id>0)'),true);
 await evaluate('AppointmentFiles.upload()');
 assert.equal(await evaluate('filePosts'),2);
 await evaluate('window.fetch=window.savedFetch');
 rows=await evaluate(`(async()=> (await fetch('/api/appointments/${appointment.id}/files')).json())()`);
 assert.equal(rows.length,3);for(const row of rows)if(!fileIds.includes(row.id))fileIds.push(row.id);
 assert.ok(rows.some(r=>r.storageType==='IMAGE'));assert.ok(rows.some(r=>r.storageType==='PDF'));
 await evaluate(`AppointmentFiles.view(${rows[0].id})`);
 assert.equal(await evaluate("document.getElementById('appointmentDocumentDetails').open"),true);
 assert.ok((await evaluate("document.getElementById('appointmentDocumentDetails').textContent")).includes(rows[0].fileTitle));
 await evaluate("document.getElementById('closeAppointmentDocument').click()");
 const actions=await evaluate(`CaseCalendar.table([${JSON.stringify(appointment)}])`);
 assert.ok(actions.includes('CaseCalendar.remove'));assert.ok(actions.includes('CaseCalendar.documents'));
 assert.equal(await evaluate(`(async()=> (await fetch('/api/files/${fileIds[0]}',{method:'DELETE'})).status)()`),409);
 assert.equal(await evaluate(`(async()=> (await fetch('/api/documents/${documentId}',{method:'DELETE'})).status)()`),409);
 await evaluate("document.getElementById('workspaceDialog').close();App.switchTab('files');App.renderFilesDirectoryView()");
 assert.ok((await evaluate("document.getElementById('filesDirectoryTableContainer').textContent")).includes(title));
 await evaluate(`AppointmentFiles.openAppointment(${appointment.id})`);await until("document.querySelectorAll('[data-appointment-file]').length===3");
 await fs.writeFile('artifacts/appointment-files.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const login=await fetch('http://localhost:5088/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.SMARTLAWS_OTHER_LAWYER,password:process.env.SMARTLAWS_OTHER_PASSWORD})});assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 for(const method of ['GET','POST'])assert.equal((await fetch(`http://localhost:5088/api/appointments/${appointment.id}/files`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({fileId:fileIds[0]})}:{})})).status,404);
 assert.equal((await fetch(`http://localhost:5088/api/appointments/${appointment.id}/files`)).status,401);
 await fetch('http://localhost:5088/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});
 await evaluate(`fetch('/api/appointments/${appointment.id}/files/${fileIds[1]}',{method:'DELETE'})`);
 assert.equal(await evaluate(`(async()=> (await fetch('/api/files/${fileIds[1]}/content')).status)()`),200);
 assert.deepEqual(errors,[]);console.log('PASS: studio create/link, idempotent linking, PDF/image upload, retry without duplicate files, catalogue backlink, protected deletion, unlink preserves bytes, authorization');
}finally{
 await evaluate('if(window.savedFetch)window.fetch=window.savedFetch');
 if(appointment){const remaining=await evaluate(`(async()=> (await fetch('/api/appointments/${appointment.id}/files')).json())()`);for(const f of remaining)if(!fileIds.includes(f.id))fileIds.push(f.id);await evaluate(`fetch('/api/appointments/${appointment.id}',{method:'DELETE'})`);}
 for(const id of fileIds)await evaluate(`fetch('/api/files/${id}',{method:'DELETE'})`);
 if(documentId)await evaluate(`fetch('/api/documents/${documentId}',{method:'DELETE'})`);
 socket.close();
}
