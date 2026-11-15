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
const ids=[];
try {
 await evaluate('App.createNewDocFromTemplate(App.state.templates.find(t=>t.formCode === "(๔)").id)');
 const original=await evaluate('JSON.stringify(App.state.cases)');
 const fields={courtName:'ศาลทดสอบ',caseCategory:'อาญา',plaintiffName:'โจทก์ทดสอบ',defendantName:'จำเลยทดสอบ',Charge:'ร่วมกันฉ้อโกงประชาชน และร่วมกันกู้ยืมเงินที่เป็นการฉ้อโกงประชาชน '.repeat(3),ClaimAmountBaht:'123,456',ClaimAmountSatang:'50'};
 for(const [k,v] of Object.entries(fields))await evaluate(`document.querySelector('[data-court-field=${k}]').value=${JSON.stringify(v)};App.syncEditorToPreview()`);
 assert.equal(await evaluate("document.getElementById('courtFormFields').hidden"),false);
 assert.ok((await evaluate("document.getElementById('studioPaperPreview').textContent")).includes('ศาลทดสอบ'));
 async function saveReload(){const id=await evaluate(`(async()=>{const d=App.collectCurrentDocFromInputs();d.id=0;d.documentTitle='PLAINT-FIELDS-TEST';const r=await fetch('/api/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw Error(await r.text());return(await r.json()).id;})()`);ids.push(id);await evaluate(`(async()=>{const r=await fetch('/api/documents/${id}');App.loadDocumentIntoEditorState((await r.json()).document);})()`);}
 await saveReload();
 for(const [k,v]of Object.entries(fields))assert.equal(await evaluate(`document.querySelector('[data-court-field=${k}]').value`),v);
 assert.equal(await evaluate('[...document.querySelectorAll("#studioPaperPreview .court-page")].every(e=>e.scrollWidth<=e.clientWidth+1)'),true);
 await evaluate('CourtFormEditor.changeForm("(๖)")');
 const text='ร่วมกันฉ้อโกงประชาชน และร่วมกันกู้ยืมเงินที่เป็นการฉ้อโกงประชาชน (ป.อ. ม.๓๔๑, ๓๔๓ ประกอบ ม.๘๓ และ พ.ร.ก.การกู้ยืมเงินที่เป็นการฉ้อโกงประชาชน พ.ศ.๒๕๒๗)';
 await evaluate(`document.querySelector('[data-court-field=CriminalLegalBasis]').value=${JSON.stringify(text)};App.syncEditorToPreview()`);
 assert.equal(await evaluate("document.querySelector('[data-criminal-legal-basis]').textContent"),text);
 await saveReload();
 assert.equal(await evaluate("document.querySelector('[data-court-field=CriminalLegalBasis]').value"),text);
 await call('Emulation.setEmulatedMedia',{media:'print'});
 assert.equal(await evaluate('[...document.querySelectorAll("#studioPaperPreview .court-page")].every(e=>e.scrollWidth<=e.clientWidth+1)'),true);
 await call('Emulation.setEmulatedMedia',{media:''});
 await evaluate("document.querySelector('[data-court-field=CriminalLegalBasis]').value='';App.syncEditorToPreview()");
 assert.equal(await evaluate("document.querySelector('[data-criminal-legal-basis]').textContent"),'');
 assert.equal(await evaluate('JSON.stringify(App.state.cases)'),original);
 assert.deepEqual(errors,[]);
 console.log('PASS: form 4 fields, form 6 legal basis, live preview, database reload, blank override, paper width and case isolation');
}finally{for(const id of ids)await evaluate(`fetch('/api/documents/${id}',{method:'DELETE'})`);socket.close();}
