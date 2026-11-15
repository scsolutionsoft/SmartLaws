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
await evaluate('App.createNewDocFromTemplate(App.state.templates.find(t=>t.formCode === "(๗)").id)');
assert.equal(await evaluate('document.getElementById("edShowPermission").checked'),false);
assert.equal(await evaluate('document.getElementById("edPermissionText").value.includes("[object Object]")'),false);
assert.ok(Math.abs(parseFloat(await evaluate('getComputedStyle(document.querySelector("#studioPaperPreview .court-closing-gap")).height')) - 31) < 0.1);
await call('Emulation.setEmulatedMedia',{media:'print'});
assert.equal(await evaluate('getComputedStyle(document.querySelector("#studioPaperPreview .court-closing-gap")).height'),'31px');
await call('Emulation.setEmulatedMedia',{media:''});
await evaluate('App.switchTab("reports")');
await until('!!document.querySelector("#caseReportTable tbody tr")');
assert.ok(await evaluate('document.getElementById("caseReportTable").textContent.includes("ชื่อทนายความ")'));
await evaluate('Workspace.open("settings")');
assert.equal(await evaluate('document.querySelectorAll(".sl-theme").length'),10);
await evaluate('Workspace.setTheme("burgundy")'); assert.equal(await evaluate('document.body.dataset.theme'),'burgundy');
await evaluate('Workspace.setTheme("classic");Workspace.startWizard()');
assert.equal(await evaluate('document.getElementById("workspaceDialog").open'),true);
await evaluate('document.getElementById("workspaceDialog").close();Workspace.open("litigation")');
assert.equal(await evaluate('document.querySelectorAll("#workspaceView .sl-list li").length'),9);
await evaluate('Workspace.open("home")');
await fs.writeFile('artifacts/dashboard.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await new Promise(r=>setTimeout(r,500));
await fs.writeFile('artifacts/mobile.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),true,'Mobile overflow');
await evaluate('Workspace.logout()');await until('location.pathname === "/login.html"');
await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
for (const role of ['ADMIN','CLERK']) {
    const username=process.env[`SMARTLAWS_${role}`], password=process.env[`SMARTLAWS_${role}_PASSWORD`];
    if(!username||!password)continue;
    await until('!!document.getElementById("authForm")');
    await evaluate(`document.querySelector('[name=username]').value=${JSON.stringify(username)};document.querySelector('[name=password]').value=${JSON.stringify(password)};document.getElementById('authForm').requestSubmit();`);
    await until('!!window.Workspace && document.body.style.visibility === "visible" && !!document.querySelector(".sl-hero")');
    if(role==='ADMIN') {
        await evaluate('App.switchTab("backoffice")');
        assert.ok(await evaluate('!!document.querySelector("#adminUsersTableContainer button")'));
        await evaluate('Workspace.credentials(App.state.currentUser.id)');
        assert.ok(await evaluate('!!document.querySelector("#credentialsForm [name=username]")'));
        await evaluate('document.getElementById("workspaceDialog").close();App.switchTab("reports")');
        await until('!!document.querySelector("#caseReportTable tbody tr")');
        assert.ok(await evaluate('document.getElementById("caseReportTable").textContent.includes("โจทก์")'));
        await evaluate('App.switchTab("backoffice")');
        await evaluate('Workspace.editMember(App.state.currentUser.id)');
        assert.equal(await evaluate('document.getElementById("workspaceDialog").open'),true);
        await evaluate('document.getElementById("workspaceDialog").close();Workspace.open("audit")');
        await until('!!document.querySelector("#workspaceView table")');
    } else {
        await evaluate('App.switchTab("cases")');
        assert.equal(await evaluate('[...document.querySelectorAll("[onclick*=openNewCaseModal]")].filter(e=>e.offsetParent).length'),0);
    }
    await evaluate('Workspace.logout()');await until('location.pathname === "/login.html"');
}
assert.deepEqual(errors,[]);
socket.close();console.log('PASS: login, dashboard, 10 themes, wizard, litigation catalogue, responsive width, logout; no browser runtime errors.');
