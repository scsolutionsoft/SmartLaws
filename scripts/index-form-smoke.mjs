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
await evaluate('App.createNewDocFromTemplate(App.state.templates.find(t=>t.formCode === "(๓)").id);App.state.currentClauses=[];App.addClauseItem()');
assert.equal(await evaluate('document.querySelectorAll("[data-index-row]").length'),4);
for (const [key,value] of Object.entries({OrderNo:'27',WitnessNameAndDesc:'คำฟ้องและเอกสารประกอบ\nรายการบรรทัดที่สอง',AddressText:'12',Note:'ต้นฉบับ <ข้อความ>'})) {
    await evaluate(`{const input=document.querySelector('[data-index-row="0"][data-index-field="${key}"]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input'));}`);
}
assert.deepEqual(await evaluate('[...document.querySelectorAll(".court-index-page tbody tr:first-child td")].map(td=>td.textContent)'),['๒๗','คำฟ้องและเอกสารประกอบ\nรายการบรรทัดที่สอง','๑๒','ต้นฉบับ <ข้อความ>']);
await evaluate('App.addClauseItem()');
assert.equal(await evaluate('App.state.currentClauses[1].OrderNo'),28);
await evaluate('App.removeClauseItem(1);App.loadDocumentIntoEditorState(App.collectCurrentDocFromInputs())');
assert.equal(await evaluate('document.querySelector("[data-index-field=OrderNo]").value'),'27');
await fs.writeFile('artifacts/index-form.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
let savedId;
try {
    savedId=await evaluate('(async()=>{const d=App.collectCurrentDocFromInputs();d.id=0;const r=await fetch("/api/documents",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});if(!r.ok)throw Error(await r.text());return (await r.json()).id;})()');
    await evaluate(`(async()=>{const r=await fetch('/api/documents/${savedId}');App.loadDocumentIntoEditorState((await r.json()).document);})()`);
    assert.equal(await evaluate('document.querySelector("[data-index-field=OrderNo]").value'),'27');
    assert.equal(await evaluate('document.querySelector("[data-index-field=AddressText]").value'),'12');
} finally {
    if(savedId) assert.ok(await evaluate(`(async()=>{const r=await fetch('/api/documents/${savedId}',{method:'DELETE'});return r.ok;})()`));
}
await evaluate('App.state.currentClauses=Array.from({length:33},(_,i)=>({OrderNo:i+1,WitnessNameAndDesc:"รายการทดสอบ "+i,AddressText:"2",Note:"หมายเหตุ"}));App.syncEditorToPreview()');
assert.equal(await evaluate('document.querySelectorAll(".court-index-page").length'),3);
await evaluate('App.state.currentClauses=[{OrderNo:27,WitnessNameAndDesc:"ข้อความยาว ".repeat(900),AddressText:"12",Note:"หมายเหตุท้ายรายการ"}];App.syncEditorToPreview()');
assert.ok(await evaluate('document.querySelectorAll(".court-index-page").length>1'));
assert.equal(await evaluate('[...document.querySelectorAll(".court-index-page tbody tr td:nth-child(2)")].map(td=>td.textContent.replaceAll("\\u00a0", "")).join("")'), 'ข้อความยาว '.repeat(900));
await call('Emulation.setEmulatedMedia',{media:'print'});
assert.ok(await evaluate('[...document.querySelectorAll(".court-index-page")].every(p=>p.scrollHeight<=p.clientHeight+1 && p.scrollWidth<=p.clientWidth+1)'));
await call('Emulation.setEmulatedMedia',{media:''});
assert.deepEqual(errors,[]);
console.log('PASS: four index inputs, custom ordinal, live cells, multiline and escaped text, save/reload, 33 rows and oversized row pagination, A4 overflow');
await evaluate('Workspace.logout()');
socket.close();
