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
const prefix='calendar-test-'+Date.now();
let saved;
try {
    await evaluate('CaseCalendar.open()');
    await until("!!document.querySelector('.cal-grid')");
    await evaluate('CaseCalendar.edit()');
    await evaluate(`(()=>{const f=document.getElementById('appointmentForm');f.elements.title.value=${JSON.stringify(prefix+' <นัดศาล>')};f.elements.location.value='ศาลทดสอบ ห้อง 1';f.elements.notes.value='เตรียมต้นฉบับ';f.requestSubmit();})()`);
    await until("!!document.getElementById('appointmentUploadInput')");
    await evaluate("document.getElementById('workspaceDialog').close()");
    await until(`CaseCalendar.rows.some(a=>a.title.startsWith(${JSON.stringify(prefix)}))`);
    saved=await evaluate(`CaseCalendar.rows.find(a=>a.title.startsWith(${JSON.stringify(prefix)}))`);
    assert.equal(saved.location,'ศาลทดสอบ ห้อง 1');
    assert.equal(saved.version,1);
    // Use a separate HTTP session: another lawyer must not read or alter this appointment.
    const otherLogin=await fetch('http://localhost:5088/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.SMARTLAWS_OTHER_LAWYER,password:process.env.SMARTLAWS_OTHER_PASSWORD})});
    assert.equal(otherLogin.status,200);
    const cookie=otherLogin.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
    const range='?'+new URLSearchParams({from:saved.startsAt,to:saved.endsAt});
    assert.equal((await fetch('http://localhost:5088/api/appointments'+range)).status,401);
    const otherRows=await(await fetch('http://localhost:5088/api/appointments'+range,{headers:{Cookie:cookie}})).json();
    assert.ok(!otherRows.some(x=>x.id===saved.id));
    for(const method of ['PUT','DELETE'])assert.equal((await fetch('http://localhost:5088/api/appointments/'+saved.id,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(method==='PUT'?{body:JSON.stringify(saved)}:{})})).status,404);
    await fetch('http://localhost:5088/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});
    assert.ok((await evaluate("document.getElementById('calendarTable').textContent")).includes('<นัดศาล>'));
    assert.equal(await evaluate("document.querySelectorAll('#calendarTable นัดศาล').length"),0);
    await evaluate(`CaseCalendar.edit(${saved.id})`);
    await evaluate("document.querySelector('#appointmentForm [name=notes]').value='แก้ไขแล้ว';document.getElementById('appointmentForm').requestSubmit()");
    await until("!document.getElementById('workspaceDialog').open");
    await until(`CaseCalendar.rows.find(a=>a.id===${saved.id})?.version===2`);
    assert.equal(await evaluate(`(async()=>{const r=await fetch('/api/appointments/${saved.id}',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(saved)})});return r.status})()`),409);
    assert.equal(await evaluate(`(async()=>{const r=await fetch('/api/appointments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...${JSON.stringify(saved)},caseId:2147483647})});return r.status})()`),404);
    assert.equal(await evaluate(`(async()=>{const r=await fetch('/api/appointments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...${JSON.stringify(saved)},endsAt:${JSON.stringify(saved.startsAt)}})});return r.status})()`),400);
    assert.equal(await evaluate("(async()=>{const r=await fetch('/api/appointments?from=2026-01-01T00:00:00Z&to=2028-01-01T00:00:00Z');return r.status})()"),400);
    await evaluate(`CaseCalendar.query=${JSON.stringify(prefix)};CaseCalendar.content()`);
    assert.equal(await evaluate("document.querySelectorAll('#calendarTable tbody tr').length"),1);
    await fs.writeFile('artifacts/calendar-desktop.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    // Capture the separate print document without invoking a native print dialog.
    await evaluate("window.realOpen=window.open;window.printHtml='';window.open=()=>({document:{open(){},close(){},write(s){window.printHtml+=s}},focus(){},close(){}})");
    await evaluate('CaseCalendar.print()');
    const print=await evaluate('printHtml');assert.ok(print.includes(prefix));assert.ok(print.includes('A4 landscape'));assert.ok(print.includes('โจทก์:'));
    await evaluate('window.open=window.realOpen;Workspace.open("home");CaseCalendar.poll()');
    assert.ok((await evaluate("document.getElementById('appointmentDashboard').textContent")).includes(prefix));
    await until("!!document.getElementById('appointmentAlerts')");
    assert.ok((await evaluate("document.getElementById('appointmentAlerts').textContent")).includes(prefix));
    await evaluate('CaseCalendar.dismiss(15)');
    await evaluate('CaseCalendar.notify()');
    assert.equal(await evaluate("!!document.getElementById('appointmentAlerts')"),false);
    await evaluate(`CaseCalendar.edit(${saved.id});document.querySelector('#appointmentForm [name=status]').value='cancelled';document.getElementById('appointmentForm').requestSubmit()`);
    await until("!document.getElementById('workspaceDialog').open");
    await evaluate('CaseCalendar.poll()');
    assert.ok(!(await evaluate('CaseCalendar.due.map(a=>a.id)')).includes(saved.id));
    await evaluate('CaseCalendar.open()');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await until("!!document.querySelector('.cal-grid')");
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);
    assert.equal(await evaluate("document.querySelector('.cal-hero').getBoundingClientRect().right<=window.innerWidth"),true);
    await fs.writeFile('artifacts/calendar-mobile.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    assert.deepEqual(errors,[]);
    console.log('PASS: calendar create/edit, persistence, stale update conflict, invalid time/range, inaccessible case, search/XSS, monthly print, dashboard, reminder/snooze and mobile layout');
} finally {
    await evaluate(`(async()=>{if(window.realOpen)window.open=window.realOpen;for(const a of CaseCalendar.rows.filter(a=>a.title.startsWith(${JSON.stringify(prefix)})))await fetch('/api/appointments/'+a.id,{method:'DELETE'});await CaseCalendar.refresh();})()`);
    socket.close();
}
