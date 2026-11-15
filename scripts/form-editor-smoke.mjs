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
await evaluate('App.createNewDocFromTemplate(App.state.templates.find(t=>t.formCode === "(๔)").id)');
await evaluate('App.state.currentClauses=[{Content:"ข้อความคำฟ้องเดิม"}];App.syncEditorToPreview();document.getElementById("edFormCode").value="(๑)";document.getElementById("edFormCode").dispatchEvent(new Event("change"))');
assert.equal(await evaluate('document.getElementById("edDocumentTitle").value'),'ปกหน้าสำนวน');
assert.equal(await evaluate('App.state.currentClauses.length'),0);
await evaluate('document.querySelector("[data-court-field=ArchiveNo]").value="ARCHIVE-TEST";document.querySelector("[data-court-field=plaintiffName]").value="โจทก์ทดสอบ";App.syncEditorToPreview()');
assert.ok(await evaluate('document.getElementById("studioPaperPreview").textContent.includes("ARCHIVE-TEST") && document.getElementById("studioPaperPreview").textContent.includes("โจทก์ทดสอบ")'));
await evaluate('App.addClauseItem();App.updateClauseField(0,"Content","ข้อความยาวสำหรับตรวจการตัดบรรทัด ".repeat(30));App.loadDocumentIntoEditorState(App.collectCurrentDocFromInputs())');
assert.equal(await evaluate('document.querySelector("[data-court-field=ArchiveNo]").value'),'ARCHIVE-TEST');
assert.ok(await evaluate('document.querySelectorAll("#studioPaperPreview .court-page").length > 1'));
assert.equal(await evaluate('[...document.querySelectorAll("#studioPaperPreview .court-page")].every(el=>el.scrollWidth<=el.clientWidth+1)'),true);
await evaluate('CourtFormEditor.changeForm("(๔)")');
assert.equal(await evaluate('App.state.currentClauses[0].Content'),'ข้อความคำฟ้องเดิม');
await evaluate('CourtFormEditor.changeForm("(๓)");App.addClauseItem();App.updateWitnessField(0,"WitnessNameAndDesc","รายการเอกสารทดสอบ");App.updateWitnessField(0,"AddressText","5");App.updateWitnessField(0,"Note","หมายเหตุทดสอบ")');
assert.ok(await evaluate('document.getElementById("studioPaperPreview").textContent.includes("หมายเหตุทดสอบ")'));
assert.equal(await evaluate('document.querySelectorAll("#clausesEditorList select").length'),0);
await evaluate('CourtFormEditor.changeForm("(๘)");App.addClauseItem();App.updateWitnessField(0,"Satang","50");App.updateWitnessField(0,"Remark","ทรัพย์ทดสอบ")');
assert.ok(await evaluate('document.getElementById("studioPaperPreview").textContent.includes("ทรัพย์ทดสอบ")'));
await evaluate('CourtFormEditor.changeForm("(๑)")');
assert.equal(await evaluate('document.querySelector("[data-court-field=ArchiveNo]").value'),'ARCHIVE-TEST');
const codes = await evaluate('[...document.getElementById("edFormCode").options].map(o=>o.value).filter(Boolean)');
for(const code of codes) {
    await evaluate(`CourtFormEditor.changeForm(${JSON.stringify(code)})`);
    assert.equal(await evaluate('App.state.currentDoc.formCode'),code);
    assert.ok(await evaluate('document.querySelectorAll("#studioPaperPreview .court-page").length > 0'),code);
    assert.ok(await evaluate('App.state.currentDoc.templateId > 0'),`Missing template: ${code}`);
}
await evaluate('CourtFormEditor.changeForm("(๒)");document.querySelector("[data-court-field=IssueDate]").value="FIRST-HEARING";App.syncEditorToPreview()');
assert.ok(await evaluate('document.getElementById("studioPaperPreview").textContent.includes("FIRST-HEARING")'));
await evaluate('CourtFormEditor.changeForm("(๑๔)");document.querySelector("[data-court-field=HearingMonth]").value="HEARING-MONTH";App.syncEditorToPreview()');
assert.ok(await evaluate('document.getElementById("studioPaperPreview").textContent.includes("HEARING-MONTH")'));
await evaluate('CourtFormEditor.changeForm("(๑)")');
let savedId;
try {
    savedId = await evaluate('(async()=>{const doc=App.collectCurrentDocFromInputs();doc.id=0;doc.documentTitle="FORM-MAPPING-SMOKE";const r=await fetch("/api/documents",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc)});if(!r.ok)throw Error(await r.text());return (await r.json()).id;})()');
    assert.ok(savedId > 0);
    await evaluate(`(async()=>{const r=await fetch('/api/documents/${savedId}');const data=await r.json();App.loadDocumentIntoEditorState(data.document);})()`);
    assert.equal(await evaluate('document.querySelector("[data-court-field=ArchiveNo]").value'),'ARCHIVE-TEST');
} finally {
    if(savedId) assert.equal(await evaluate(`(async()=>{const r=await fetch('/api/documents/${savedId}',{method:'DELETE'});return r.ok;})()`),true);
}
await until('document.querySelector("#studioPaperPreview .court-page").getBoundingClientRect().width <= document.getElementById("studioPaperPreview").clientWidth');
await fs.writeFile('artifacts/form-editor.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
await call('Emulation.setEmulatedMedia',{media:'print'});
assert.equal(await evaluate('[...document.querySelectorAll("#studioPaperPreview .court-page")].every(el=>el.scrollHeight<=el.clientHeight+1)'),true,'Printed cover pages overflow');
await call('Emulation.setEmulatedMedia',{media:''});
await evaluate('Workspace.logout()');
await until('location.pathname === "/login.html"');
assert.deepEqual(errors,[]);
console.log(`PASS: ${codes.length} form codes, isolated drafts, field mapping, table columns, reload and long cover notes`);
socket.close();
