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
 const result=await evaluate(`(async()=>{
  const c=App.getAccessibleCases()[0];
  const a={id:'legacy-'+c.id,caseId:c.id,title:'ทดสอบวันนัดเดิม',kind:'นัดศาล',startsAt:'2026-11-18T00:00:00+07:00',endsAt:'2026-11-19T00:00:00+07:00',location:'',responsible:'',notes:'',status:'scheduled',reminderMinutes:1440,version:0,legacy:true,expectedDate:'1900-01-01',expectedTitle:'nonmatching-test'};
  CaseCalendar.rows=[a];CaseCalendar.edit(a.id);
  const f=document.getElementById('appointmentForm');
  if(f.querySelector('fieldset').disabled||!f.querySelector('[type=submit]')||f.elements.startsAt.value)throw Error('Legacy editor not enabled or invented time');
  const request={appointment:{...a,id:0},expectedDate:a.expectedDate,expectedTitle:a.expectedTitle};
  const statuses=[];
  for(const remove of [false,true]){const r=await fetch('/api/appointments/legacy/'+c.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,remove})});statuses.push(r.status);}
  const denied=await fetch('/api/appointments/legacy/2147483647',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,appointment:{...request.appointment,caseId:2147483647}})});
  document.getElementById('workspaceDialog').close();await CaseCalendar.refresh();return {statuses,denied:denied.status};
 })()`);
 assert.deepEqual(result,{statuses:[409,409],denied:404});
 assert.deepEqual(errors,[]);
 console.log('PASS: editable legacy popup, no invented hearing time, stale conversion/deletion rejected, inaccessible case rejected');
}finally{socket.close();}
