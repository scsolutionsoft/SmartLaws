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
const title = `judgment-test-${Date.now()}`;
let caseId;
try {
    caseId = await evaluate('App.getAccessibleCases()[0].id');
    await evaluate(`Workspace.open('litigation');Workspace.litigation(${caseId});Workspace.uploadJudgment()`);
    await evaluate(`document.querySelector('[name=judgmentDate]').value='2026-11-14';document.querySelector('[name=judgmentBlackCaseNo]').value='พ 123/2569';document.querySelector('[name=judgmentRedCaseNo]').value='พ 456/2569';document.querySelector('[name=fileTitle]').value=${JSON.stringify(title)}`);
    // A small valid one-page PDF fixture, with calculated object offsets.
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
    let pdf='%PDF-1.4\n', offsets=[0];
    objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
    const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    await fs.writeFile('artifacts/judgment-fixture.pdf',pdf);
    const root=await call('DOM.getDocument'); const input=await call('DOM.querySelector',{nodeId:root.root.nodeId,selector:'[name=pdf]'});
    await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[process.cwd()+'\\artifacts\\judgment-fixture.pdf']});
    await evaluate("document.getElementById('judgmentForm').requestSubmit()");
    await until(`!document.getElementById('workspaceDialog').open && !!App.state.caseFiles.find(f=>f.fileTitle===${JSON.stringify(title)})`);
    await evaluate('App.loadDashboardData()');
    await evaluate(`Workspace.litigation(${caseId})`);
    const saved = await evaluate(`App.state.caseFiles.find(f=>f.fileTitle===${JSON.stringify(title)})`);
    assert.equal(saved.judgmentBlackCaseNo,'พ 123/2569');assert.equal(saved.judgmentRedCaseNo,'พ 456/2569');assert.equal(saved.courtLevel,'ศาลชั้นต้น');assert.equal(saved.caseId,caseId);
    await evaluate(`document.getElementById('judgmentSearch').value='456/2569';Workspace.filterJudgments()`);
    assert.ok((await evaluate("document.getElementById('judgmentResults').textContent")).includes(title));
    await evaluate("document.getElementById('judgmentLevel').value='ศาลฎีกา';Workspace.filterJudgments()");
    assert.ok(!(await evaluate("document.getElementById('judgmentResults').textContent")).includes(title));
    await evaluate("document.getElementById('judgmentLevel').value='';Workspace.filterJudgments()");
    await evaluate(`App.openCaseFileInPopup(${saved.id})`);
    assert.ok((await evaluate("document.getElementById('popupViewerSub').textContent")).includes('พ 456/2569'));
    await until("!!document.querySelector('#popupViewerBody iframe')?.src.startsWith('blob:')");
    await evaluate("document.getElementById('filePreviewModal').classList.add('hidden')");
    // Server rejects invalid metadata and cross-case writes.
    const rejected = await evaluate(`(async()=>{const f={...App.state.caseFiles.find(f=>f.id===${saved.id}),fileDataBase64:${JSON.stringify("data:application/pdf;base64,"+Buffer.from(pdf).toString("base64"))}};return await Promise.all([{...f,judgmentRedCaseNo:''},{...f,courtLevel:'invalid'},{...f,fileDataBase64:btoa('not pdf')},{...f,caseId:2147483647}].map(async body=>(await fetch('/api/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status));})()`);
    assert.ok(rejected.every(s=>s>=400),JSON.stringify(rejected));
    const additional = await evaluate(`(async()=>{const f={...App.state.caseFiles.find(f=>f.id===${saved.id}),fileDataBase64:${JSON.stringify("data:application/pdf;base64,"+Buffer.from(pdf).toString("base64"))}};return await Promise.all(['ศาลอุทธรณ์','ศาลฎีกา'].map(async courtLevel=>{const r=await fetch('/api/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...f,id:0,courtLevel})});return r.status;}));})()`);
    assert.deepEqual(additional,[200,200]);
    await evaluate(`(async()=>{await App.loadDashboardData();Workspace.litigation(${caseId});document.getElementById('judgmentSearch').value='๔๕๖/๒๕๖๙';Workspace.filterJudgments();document.getElementById('toastNotice').classList.add('hidden')})()`);
    assert.equal(await evaluate("document.querySelectorAll('.sl-judgment-file').length"),3);
    await fs.writeFile('artifacts/judgments-desktop.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
    assert.equal(await evaluate("getComputedStyle(document.getElementById('sidebar')).display"),'none');
    await fs.writeFile('artifacts/judgments-mobile.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    assert.deepEqual(errors,[]);console.log('PASS: upload, persistence, case linkage, filtering, PDF viewer, validation and mobile layout');
} finally {
    await evaluate(`(async()=>{const files=await(await fetch('/api/files')).json();for(const f of files.filter(f=>f.fileTitle===${JSON.stringify(title)}))await fetch('/api/files/'+f.id,{method:'DELETE'});})()`);
    await evaluate(`(async()=>{await App.loadDashboardData();Workspace.litigation(${caseId || 0})})()`);
    await call('Emulation.clearDeviceMetricsOverride');
    socket.close();
}
