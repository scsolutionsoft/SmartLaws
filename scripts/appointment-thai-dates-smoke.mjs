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
try {
 await evaluate('CaseCalendar.open();CaseCalendar.edit()');
 assert.equal(await evaluate("document.querySelectorAll('#workspaceView input[type=date],#workspaceView input[type=month],#appointmentForm input[type=datetime-local]').length"),0);
 assert.ok((await evaluate("document.querySelector('#appointmentForm .cal-thai-date').textContent")).includes('พฤศจิกายน'));
 const result=await evaluate(`(()=>{const input=document.querySelector('#appointmentForm [name=startsAt]'),box=input.nextElementSibling;const set=(part,value)=>{const s=box.querySelector('[data-date-part='+part+']');s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));};set('year','2028');set('month','02');set('day','29');set('hour','14');set('minute','35');const leap=input.value;set('year','2027');return {leap,normal:input.value,year:box.querySelector('[data-date-part=year]').selectedOptions[0].text,valid:document.getElementById('appointmentForm').checkValidity()};})()`);
 assert.deepEqual(result,{leap:'2028-02-29T14:35',normal:'2027-02-28T14:35',year:'พ.ศ. 2570',valid:false});
 // The form needs a title, but every date select has a valid value.
 await evaluate("document.querySelector('#appointmentForm [name=title]').value='ทดสอบวันที่ไทย'");
 assert.equal(await evaluate("document.getElementById('appointmentForm').checkValidity()"),true);
 const table=await evaluate("CaseCalendar.table([{id:1,caseId:App.getAccessibleCases()[0].id,title:'ทดสอบ',startsAt:'2026-11-18T09:00:00+07:00',endsAt:'2026-11-18T10:00:00+07:00',status:'scheduled'}])");
 assert.ok(table.includes('18 พฤศจิกายน 2569'));
 await evaluate("document.getElementById('workspaceDialog').close()");
 assert.deepEqual(errors,[]);console.log('PASS: Thai month/BE year selectors, ISO conversion, leap-day clamp, required validation, Thai table dates');
}finally{socket.close();}
