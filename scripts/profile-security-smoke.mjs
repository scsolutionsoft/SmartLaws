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
const otherLogin=await fetch('http://localhost:5088/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.SMARTLAWS_OTHER_LAWYER,password:process.env.SMARTLAWS_OTHER_PASSWORD})});
assert.equal(otherLogin.status,200);const cookie=otherLogin.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
try {
 const me=await evaluate('App.state.currentUser');
 const ownCases=await evaluate('App.getAccessibleCases()');assert.ok(ownCases.length);
 const ownId=ownCases[0].id;
 const remote=async path=>fetch('http://localhost:5088'+path,{headers:{Cookie:cookie}});
 const other=await(await remote('/api/auth/me')).json(),otherCases=await(await remote('/api/cases')).json();assert.ok(otherCases.length);
 const otherId=otherCases[0].id;assert.notEqual(ownId,otherId);
 for(const u of [{id:ownId,uid:me.lawyerProfileId,own:true},{id:otherId,uid:other.lawyerProfileId,own:false}]){
  const path=`/api/cases/${u.id}/quick-fill?source=self&profileId=${u.own?other.lawyerProfileId:me.lawyerProfileId}`;
  const data=u.own?await evaluate(`(async()=> (await fetch(${JSON.stringify(path)})).json())()`):await(await remote(path)).json();
  assert.equal(data.profiles.length,1);assert.equal(data.profiles[0].id,u.uid);
 }
 const profiles=await evaluate("(async()=> (await fetch('/api/lawyers')).json())()");assert.equal(profiles.length,1);assert.equal(profiles[0].id,me.lawyerProfileId);
 const otherProfiles=await(await remote('/api/lawyers')).json();assert.equal(otherProfiles.length,1);assert.equal(otherProfiles[0].id,other.lawyerProfileId);
 const otherDashboard=await(await remote('/api/dashboard')).json();assert.ok(otherDashboard.lawyers.every(p=>p.id===other.lawyerProfileId));
 for(const source of ['self','client']){
  assert.equal((await remote(`/api/cases/${ownId}/quick-fill?source=${source}`)).status,404);
  assert.equal(await evaluate(`(async()=> (await fetch('/api/cases/${otherId}/quick-fill?source=${source}')).status)()`),404);
 }
 assert.equal((await fetch(`http://localhost:5088/api/cases/${ownId}/quick-fill?source=self`)).status,401);
 await evaluate(`App.state.currentCaseId=${ownId};App.createNewDocFromTemplate(App.state.templates.find(t=>t.formCode==='(๔)').id)`);
 assert.equal(await evaluate("document.getElementById('edRequesterFullName').value"),profiles[0].fullName);
 // Poison the local list: the autofill must use the authenticated server response, not array positions.
 await evaluate(`window.originalProfiles=App.state.lawyers;App.state.lawyers.unshift({id:${other.lawyerProfileId},fullName:'FOREIGN-PROFILE',citizenId:'FOREIGN-ID'});App.quickFillProfile('LAWYER_DEFENDANT')`);
 assert.equal(await evaluate("document.getElementById('edRequesterFullName').value"),profiles[0].fullName);
 assert.equal(await evaluate("document.getElementById('edRequesterCitizenId').value"),profiles[0].citizenId);
 await evaluate('App.state.lawyers=window.originalProfiles.filter(p=>p.fullName!=="FOREIGN-PROFILE")');
 const client=await evaluate(`(async()=> (await fetch('/api/cases/${ownId}/quick-fill?source=client')).json())()`);
 await evaluate("document.getElementById('edRequesterCitizenId').value='STALE-PERSON';App.quickFillProfile('CLIENT')");
 if(client.profiles.length>1)await evaluate("document.getElementById('quickFillClient').value='0';document.getElementById('confirmQuickFill').click()");
 assert.equal(await evaluate("document.getElementById('edRequesterFullName').value"),client.profiles[0].fullName);
 assert.notEqual(await evaluate("document.getElementById('edRequesterCitizenId').value"),'STALE-PERSON');
 assert.equal(await evaluate('App.state.currentDoc.signatureImageBase64'),'');
 const before=await evaluate("document.getElementById('edRequesterFullName').value");
 await evaluate(`App.state.currentCaseId=${otherId};App.quickFillProfile('SELF')`);
 assert.equal(await evaluate("document.getElementById('edRequesterFullName').value"),before);
 await evaluate(`App.state.currentCaseId=${ownId}`);
 assert.equal(await evaluate("!!document.querySelector('button[onclick*=LAWYER_DEFENDANT]')"),false);
 assert.deepEqual(errors,[]);console.log('PASS: two-account profile isolation, scoped dashboard/lawyers, foreign-case denial, ignored forged profile IDs, server-backed autofill, current-case client, stale identity/signature clearing');
}finally{await fetch('http://localhost:5088/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});socket.close();}
