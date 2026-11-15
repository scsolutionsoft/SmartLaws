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
await evaluate("App.createNewDocFromTemplate(App.state.templates.find(t=>t.formCode==='(๑๕)').id)");
await evaluate('document.fonts.ready');
async function fixture(n,long=false){await evaluate(`App.state.currentClauses=Array.from({length:${n}},(_,i)=>({OrderNo:i+1,WitnessNameAndDesc:${long?"'ข้อความพยานทดสอบ '.repeat(1000)":"'พยานรายการ '+(i+1)"},AddressText:'ที่อยู่ทดสอบ',Note:'นำ'}));App.syncEditorToPreview()`);}
async function checkLayout(){const bounds=await evaluate(`Array.from(document.querySelectorAll('#studioPaperPreview .court-witness-paged')).map(p=>{const t=p.querySelector('.witness-page-table').getBoundingClientRect(),f=p.querySelector('.witness-page-footer').getBoundingClientRect(),h=p.querySelector('.witness-front-header')?.getBoundingClientRect();return {width:p.scrollWidth-p.clientWidth,height:p.scrollHeight-p.clientHeight,footerGap:f.top-t.bottom,headerGap:h?t.top-h.bottom:0,cells:[...p.querySelectorAll('.witness-page-table td')].every(c=>c.scrollHeight<=c.clientHeight+1&&c.scrollWidth<=c.clientWidth+1)}})`);for(const b of bounds){assert.ok(b.width<=1&&b.height<=1,JSON.stringify(b));assert.ok(b.footerGap>=0,JSON.stringify(b));assert.ok(b.headerGap>=0,JSON.stringify(b));assert.ok(b.cells,JSON.stringify(b));}return bounds;}
await fixture(0);
const firstCapacity=await evaluate("document.querySelectorAll('#studioPaperPreview .witness-front .witness-page-table tbody tr').length");
assert.ok(firstCapacity>7);
for(const [n,pages] of [[0,1],[1,1],[7,1],[8,1],[firstCapacity,1],[firstCapacity+1,2],[firstCapacity+18,2],[firstCapacity+19,3]]){
 await fixture(n);assert.equal(await evaluate("document.querySelectorAll('#studioPaperPreview .court-witness-paged').length"),pages);
 const counts=await evaluate("[...document.querySelectorAll('#studioPaperPreview .court-witness-paged')].map(p=>p.querySelectorAll('.witness-page-table tbody tr').length)");assert.equal(counts[0],firstCapacity);for(const c of counts.slice(1))assert.equal(c,18);
 assert.equal(await evaluate("[...document.querySelectorAll('#studioPaperPreview tr[data-witness-index]')].length"),n);await checkLayout();
}
await fixture(8);
await evaluate("App.state.currentClauses[0].WitnessNameAndDesc='ป'.repeat(100);App.syncEditorToPreview()");
const mixed=await checkLayout();assert.ok(mixed[0].headerGap>=0&&mixed[0].headerGap<=20,JSON.stringify(mixed));assert.ok(mixed[0].footerGap<=23,JSON.stringify(mixed));
assert.equal(await evaluate("document.querySelectorAll('#studioPaperPreview tr[data-witness-index]').length"),8);
await fs.writeFile('artifacts/witness-multiline-first-page.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
await fixture(1,true);assert.ok(await evaluate("document.querySelectorAll('#studioPaperPreview .court-witness-paged').length>1"));
assert.equal(await evaluate("[...document.querySelectorAll('#studioPaperPreview tr[data-witness-index] td:nth-child(2)')].map(c=>c.textContent.replaceAll('\\u00a0','')).join('')"),'ข้อความพยานทดสอบ '.repeat(1000));await checkLayout();
await fixture(firstCapacity+1);
await call('Emulation.setEmulatedMedia',{media:'print'});await checkLayout();await call('Emulation.setEmulatedMedia',{media:''});
await fs.writeFile('artifacts/witness-pagination.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
const html=await evaluate("document.getElementById('studioPaperPreview').innerHTML");assert.ok(html.includes('data-witness-page="2"'));
assert.deepEqual(errors,[]);console.log('PASS: dynamic front capacity '+firstCapacity+', continuation 18 slots, multiline rows, 3mm header gap, filled table, continuous numbering, long text preserved, screen/print bounds');socket.close();
