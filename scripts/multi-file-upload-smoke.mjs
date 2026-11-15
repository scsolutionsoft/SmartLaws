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
const prefix='multi-'+Date.now();
try {
    await evaluate("App.switchTab('files');App.openUploadFileModal()");
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
    let text='%PDF-1.4\n';const offsets=[];
    objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});
    const xref=Buffer.byteLength(text);
    text+=`xref\n0 5\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const pdf=Buffer.from(text);
    const paths=[];
    for(let i=0;i<3;i++){const path=process.cwd()+`\\artifacts\\${prefix}-${i}.pdf`;await fs.writeFile(path,pdf);paths.push(path);}
    const root=await call('DOM.getDocument');const input=await call('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#upFileInput'});
    await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:paths});
    assert.equal(await evaluate('App.uploadBatch.length'),3);
    await evaluate(`App.uploadBatch.forEach((e,i)=>e.title=${JSON.stringify(prefix)}+' คำร้อง '+(i+1)+' <ต้นฉบับ>');App.renderUploadBatch();window.batchCalls=[];window.batchFetch=window.fetch;window.fetch=async(url,options)=>{if(url==='/api/files'&&options?.method==='POST'){const body=JSON.parse(options.body);batchCalls.push(body.fileTitle);if(batchCalls.length===2)return new Response(JSON.stringify({message:'จำลองการเชื่อมต่อขัดข้อง'}),{status:503,headers:{'Content-Type':'application/json'}});}return batchFetch(url,options);};`);
    await evaluate('App.submitUploadFileAttachment()');
    assert.deepEqual(await evaluate('App.uploadBatch.map(e=>e.status)'),['saved','error','saved']);
    assert.equal(await evaluate("document.getElementById('uploadFileModal').classList.contains('hidden')"),false);
    assert.ok((await evaluate("document.getElementById('uploadBatchProgress').textContent")).includes('2/3'));
    await evaluate('App.submitUploadFileAttachment()');
    assert.deepEqual(await evaluate('App.uploadBatch.map(e=>e.status)'),['saved','saved','saved']);
    assert.equal(await evaluate('batchCalls.length'),4);
    await evaluate('window.fetch=window.batchFetch;App.loadDashboardData()');
    await evaluate('App.renderFilesDirectoryView()');
    const files=await evaluate(`App.state.caseFiles.filter(f=>f.fileTitle.startsWith(${JSON.stringify(prefix)}))`);
    assert.equal(files.length,3);
    for(const file of files){
        const row=await evaluate(`document.querySelector('[data-file-id="${file.id}"]').textContent`);
        assert.ok(row.includes(file.fileTitle));
        assert.ok(row.includes(await evaluate(`App.formatUploadDate(${JSON.stringify(file.createdAt)})`)));
        await evaluate(`App.openCaseFileInPopup(${file.id})`);
        await until("!!document.querySelector('#popupViewerBody iframe')?.src.startsWith('blob:')");
        const data=await evaluate(`(async()=>[...new Uint8Array(await(await fetch('/api/files/${file.id}/content')).arrayBuffer())])()`);
        assert.deepEqual(Buffer.from(data),pdf);
        await evaluate('App.closePopupFileViewer()');
    }
    assert.equal(await evaluate("document.querySelectorAll('#filesDirectoryTableContainer ต้นฉบับ').length"),0);
    await evaluate('App.openUploadFileModal()');
    assert.equal(await evaluate("document.getElementById('upCaseId').disabled"),false);
    assert.equal(await evaluate('App.uploadBatch.length'),0);
    await evaluate('App.closeUploadFileModal()');
    await evaluate("App.openPopupFileViewer({title:'Missing file test',url:'/api/files/stream-sample/missing',storageType:'PDF'})");
    assert.ok((await evaluate("document.querySelector('[data-pdf-error]').textContent")).includes('ไม่พบไฟล์'));
    await evaluate("App.openPopupFileViewer({title:'Invalid PDF test',dataBase64:'data:text/plain;base64,aGVsbG8=',storageType:'PDF'})");
    assert.ok((await evaluate("document.querySelector('[data-pdf-error]').textContent")).includes('ไม่ใช่ไฟล์ PDF'));
    await evaluate('App.closePopupFileViewer()');
    assert.deepEqual(errors,[]);console.log('PASS: 3-file selection, partial failure and retry without duplicates, titles/dates, saved reload, PDF viewers/bytes, missing/invalid PDF errors');
}finally {
    await evaluate(`(async()=>{if(window.batchFetch)window.fetch=window.batchFetch;const rows=await(await fetch('/api/files')).json();for(const f of rows.filter(f=>f.fileTitle.startsWith(${JSON.stringify(prefix)})))await fetch('/api/files/'+f.id,{method:'DELETE'});await App.loadDashboardData();App.renderFilesDirectoryView();})()`);
    socket.close();
}
