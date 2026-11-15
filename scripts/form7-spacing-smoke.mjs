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
await evaluate(`App.createNewDocFromTemplate(App.state.templates.find(t=>t.formCode==='(๗)').id);`);
const results=[];
for(const mode of ['screen','print']) {
    await call('Emulation.setEmulatedMedia',{media:mode});
    for(const repetitions of [1,8,40]) {
        const result=await evaluate(`(()=>{
            const d={...App.state.currentDoc,documentTitle:'คำร้องคำแถลงปิดคดี',drafterName:'ทนายผู้เรียง',typistName:'ผู้พิมพ์',clausesJson:JSON.stringify([{ClauseTitle:'ข้อ ๑.',Content:'คดีนี้ศาลอนุญาตให้จำเลยยื่นคำแถลงปิดคดี ขอให้ศาลพิจารณาข้อเท็จจริงและพยานหลักฐานตามสำนวน '.repeat(${repetitions})}])};
            const host=document.createElement('div');host.id='spacingTest';host.innerHTML=CourtRenderer.renderDocumentPagesHtml(d,App.getAccessibleCases()[0]);document.body.append(host);
            const pages=[...host.querySelectorAll('.court-page')];
            const page=pages[0],lines=[...page.querySelectorAll('.court-thai-line')],note=page.querySelector('.court-page-bottom-note');
            const gap=note.getBoundingClientRect().top-page.querySelector('.court-lined-body').getBoundingClientRect().bottom;
            const overflow=pages.some(p=>p.getBoundingClientRect().height>1124 || p.scrollHeight>p.clientHeight+2);
            const r={mode:'${mode}',repetitions:${repetitions},lines:lines.length,pages:pages.length,gap,overflow};host.remove();return r;
        })()`);
        if(repetitions>1)assert.ok(result.lines>4,JSON.stringify(result));assert.ok(result.gap>=14&&result.gap<50,JSON.stringify(result));assert.equal(result.overflow,false,JSON.stringify(result));results.push(result);
    }
}
await call('Emulation.setEmulatedMedia',{media:'screen'});
await evaluate(`App.state.currentClauses=[{ClauseTitle:'ข้อ ๑.',Content:'คดีนี้ศาลอนุญาตให้จำเลยยื่นคำแถลงปิดคดี ขอให้ศาลพิจารณาข้อเท็จจริงและพยานหลักฐานตามสำนวน '.repeat(4)}];App.renderClausesEditorList();App.syncEditorToPreview();`);
await fs.writeFile('artifacts/form7-spacing.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
console.log(JSON.stringify(results,null,2));assert.deepEqual(errors,[]);socket.close();
