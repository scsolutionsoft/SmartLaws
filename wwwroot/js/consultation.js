(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const labels = {New:'รอทนายตอบกลับ',Reviewing:'กำลังพิจารณา',Closed:'ปิดคำปรึกษา',Converted:'เปิดสำนวนแล้ว'};
  const loginName = value => {const raw=String(value||'').trim(),digits=raw.replace(/[๐-๙]/g,ch=>String(ch.charCodeAt(0)-0x0e50)).replace(/\D/g,'');return digits.length>=9?digits:raw;};
  const state = {user:null, role:'', cases:[], selectedId:0, messages:[]};
  const api = async (path, options={}) => {
    const res = await fetch('/api'+path, {...options, headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const body = await res.json().catch(()=>({}));
    if(!res.ok) throw Error(body.message || (res.status===401?'กรุณาเข้าสู่ระบบใหม่':'ทำรายการไม่สำเร็จ'));
    return body;
  };
  const showNotice = (message, bad=false) => {const n=$('notice');n.textContent=message;n.hidden=!message;n.classList.toggle('error-notice',bad);};
  const date = value => value ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(value))?value:String(value)+'Z').toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}) : '';
  const setTop = () => {
    if(state.role==='Admin') document.body.dataset.theme=localStorage.getItem(`sl-theme-${state.user.id}`)||'admin-dark';
    $('topActions').innerHTML = state.user ? `<div class="top-actions"><span class="muted">${esc(state.user.fullName||'')}</span>${['Lawyer','Admin','Clerk'].includes(state.role)?'<a class="quiet back-work" href="/">← กลับเข้าสู่งาน</a>':''}${state.role==='Admin'?'<a class="quiet" href="/?page=news">จัดการประชาสัมพันธ์</a>':''}${state.role==='Client'?'<a class="quiet" href="/client.html">พื้นที่ลูกความ</a>':''}<button type="button" onclick="ConsultationUI.logout()">ออกจากระบบ</button></div>` : '<a class="quiet" href="/login.html">เข้าสู่ระบบทนาย</a>';
    const manage=$('consultationManageNews');if(manage)manage.hidden=state.role!=='Admin';
  };
  const showAuth = () => {$('authPanel').hidden=false;$('portalPanel').hidden=true;$('staffPanel').hidden=true;};
  const showLogin = (register=false) => {
    $('loginForm').hidden=register;$('registerForm').hidden=!register;
    $('loginTab').classList.toggle('active',!register);$('registerTab').classList.toggle('active',register);
    $('loginError').textContent='';$('registerError').textContent='';
    if(register) loadLawyers();
  };
  async function loadLawyers(){
    const select=$('lawyerSelect');if(select.dataset.loaded)return;
    try {const res=await fetch('/api/consultations/lawyers');if(!res.ok)throw Error();const lawyers=await res.json();select.innerHTML='<option value="">เลือกทนาย</option>'+lawyers.map(x=>`<option value="${Number(x.id)}">${esc(x.fullName)}${x.officeName?' · '+esc(x.officeName):''}</option>`).join('');select.dataset.loaded='1';if(!lawyers.length)select.innerHTML='<option value="">ยังไม่มีรายชื่อทนายที่เปิดรับ</option>';}
    catch{select.innerHTML='<option value="">โหลดรายชื่อทนายไม่สำเร็จ</option>';}
  }
  async function start(){
    $('loginTab').onclick=()=>showLogin(false);$('registerTab').onclick=()=>showLogin(true);
    $('loginForm').onsubmit=login;$('registerForm').onsubmit=register;
    try {const u=await api('/auth/me');state.user=u;state.role=u.role;setTop();await showWorkspace();}
    catch {setTop();showAuth();showLogin(false);}
  }
  async function login(e){
    e.preventDefault();const form=e.currentTarget,err=$('loginError'),button=form.querySelector('button[type=submit]');err.textContent='';button.disabled=true;
    const d=Object.fromEntries(new FormData(form));
    try {const u=await api('/auth/login',{method:'POST',body:JSON.stringify({username:loginName(d.username),password:d.password})});state.user=u;state.role=u.role;setTop();if(['Admin','Lawyer','Clerk'].includes(u.role)){location.href='/';return;}await showWorkspace();}
    catch(x){err.textContent=x.message;}finally{button.disabled=false;}
  }
  async function register(e){
    e.preventDefault();const form=e.currentTarget,err=$('registerError'),button=form.querySelector('button[type=submit]');err.textContent='';
    const d=Object.fromEntries(new FormData(form));if(d.password!==d.confirmPassword){err.textContent='รหัสผ่านทั้งสองช่องไม่ตรงกัน';return;}
    button.disabled=true;
    try {const u=await api('/consultations/register',{method:'POST',body:JSON.stringify({fullName:d.fullName,phone:d.phone,password:d.password,lawyerProfileId:Number(d.lawyerProfileId),summary:d.summary})});state.user=u;state.role=u.role;setTop();showNotice('สร้างบัญชีและส่งคำขอปรึกษาแล้ว คุณส่งข้อความเพิ่มเติมถึงทนายได้จากกล่องสนทนา');await showWorkspace();}
    catch(x){err.textContent=x.message;}finally{button.disabled=false;}
  }
  async function showWorkspace(){
    document.body.dataset.role=state.role;
    $('authPanel').hidden=true;
    if(state.role==='Lawyer'||state.role==='Admin'){ $('staffPanel').hidden=false;$('portalPanel').hidden=true;await loadStaff(); }
    else if(state.role==='Prospect'||state.role==='Client'){ $('portalPanel').hidden=false;$('staffPanel').hidden=true;await loadMine(); }
    else {showAuth();showLogin(false);}
  }
  async function loadMine(){state.cases=await api('/consultations/mine');if(!state.selectedId||!state.cases.some(x=>x.id===state.selectedId))state.selectedId=state.cases[0]?.id||0;await loadMessages();renderPortal();}
  async function loadMessages(){if(!state.selectedId){state.messages=[];return;}state.messages=await api(`/consultations/${state.selectedId}/messages`);}
  function messageMarkup(){return state.messages.map(m=>`<article class="message ${m.senderId===state.user.id?'mine':''}"><header>${esc(m.senderName)}</header><p>${esc(m.body)}</p><time>${esc(date(m.createdAt))}${m.readAt&&m.senderId===state.user.id?' · อ่านแล้ว':''}</time></article>`).join('')||'<div class="empty">ส่งข้อความแรกถึงทนายได้เลย</div>';}
  function renderPortal(){
    const selected=state.cases.find(x=>x.id===state.selectedId),host=$('portalPanel');
    host.innerHTML=`<aside class="pane"><h2>คำปรึกษาของฉัน</h2><p class="detail">บัญชี ${esc(state.user.fullName)} · ${esc(state.user.phone||'')}</p><div class="list">${state.cases.map(x=>`<button class="item ${x.id===state.selectedId?'selected':''}" data-select="${x.id}"><strong>${esc(x.lawyerName)}</strong><small><span class="badge ${x.status==='New'?'new':''}">${esc(labels[x.status]||x.status)}</span> · ${esc(date(x.updatedAt))}${x.unread?` · ข้อความใหม่ ${x.unread}`:''}</small></button>`).join('')||'<div class="empty">ยังไม่มีคำขอปรึกษา</div>'}</div></aside>
      <section class="pane">${selected?`<h2>คุยกับ ${esc(selected.lawyerName)}</h2><p class="detail">${selected.convertedCaseId?`เปิดเป็นสำนวนแล้ว · <a href="/client.html">ไปยังพื้นที่ลูกความ</a>`:esc(labels[selected.status]||selected.status)}</p><div class="thread" id="thread">${messageMarkup()}</div><form id="sendForm" class="composer"><textarea name="body" maxlength="4000" placeholder="พิมพ์ข้อความถึงทนาย…" required></textarea><button class="primary" type="submit">ส่ง</button></form>`:'<div class="empty">เลือกคำปรึกษาเพื่อเปิดกล่องข้อความ</div>'}</section>`;
    host.querySelectorAll('[data-select]').forEach(b=>b.onclick=async()=>{state.selectedId=Number(b.dataset.select);await loadMessages();renderPortal();});
    const thread=$('thread');if(thread)thread.scrollTop=thread.scrollHeight;
    const form=$('sendForm');if(form)form.onsubmit=sendMessage;
  }
  async function sendMessage(e){e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),body=new FormData(form).get('body')?.toString().trim();if(!body)return;button.disabled=true;try{await api(`/consultations/${state.selectedId}/messages`,{method:'POST',body:JSON.stringify({body})});await loadMessages();state.cases=await api('/consultations/mine');renderPortal();}catch(x){showNotice(x.message,true);}finally{button.disabled=false;}}

  async function loadStaff(){state.cases=await api('/consultations');if(!state.selectedId||!state.cases.some(x=>x.id===state.selectedId))state.selectedId=state.cases[0]?.id||0;await loadMessages();renderStaff();}
  function renderStaff(){
    const selected=state.cases.find(x=>x.id===state.selectedId),host=$('staffPanel');
    host.innerHTML=`<aside class="pane"><h2>รายการขอปรึกษา</h2><p class="detail">แสดงรายการที่ส่งถึงทนายหรือสำนักงานของคุณ</p><div class="list">${state.cases.map(x=>`<button class="item ${x.id===state.selectedId?'selected':''}" data-select="${x.id}"><strong>${esc(x.fullName)}</strong><small>${esc(x.phone)} · <span class="badge ${x.status==='New'?'new':''}">${esc(labels[x.status]||x.status)}</span>${x.unread?` · ใหม่ ${x.unread}`:''}</small><small>${esc(x.summary||'ไม่ได้ระบุรายละเอียด')} · ${esc(date(x.updatedAt))}</small></button>`).join('')||'<div class="empty">ยังไม่มีคำขอปรึกษา</div>'}</div></aside>
      <section class="pane">${selected?`<h2>${esc(selected.fullName)}</h2><p class="detail">เบอร์ติดต่อ <a href="tel:${esc(selected.phone)}">${esc(selected.phone)}</a> · ทนาย ${esc(selected.lawyerName)} · ${esc(labels[selected.status]||selected.status)}</p><div class="thread" id="thread">${messageMarkup()}</div><form id="sendForm" class="composer"><textarea name="body" maxlength="4000" placeholder="ตอบกลับผู้ขอปรึกษา…" required></textarea><button class="primary" type="submit">ส่ง</button></form>
      <div class="toolbar"><button class="secondary" type="button" onclick="ConsultationUI.setStatus('Reviewing')">รับเรื่อง / กำลังพิจารณา</button><button class="quiet" type="button" onclick="ConsultationUI.setStatus('Closed')">ปิดคำปรึกษา</button></div>
      ${selected.convertedCaseId?`<p class="detail">เปิดเป็นลูกความและสำนวนแล้ว (รหัสสำนวน ${selected.convertedCaseId})</p>`:`<form id="convertForm" class="case-form"><h3>รับว่าจ้างและเปิดสำนวน</h3><p class="convert-note">เมื่อเปิดสำนวน ระบบจะเปลี่ยนบัญชีผู้ขอคำปรึกษาเป็นลูกความ เชื่อมข้อมูลเข้ากับสำนวนใหม่ และเก็บประวัติแชตนี้ไว้</p><label>ประเภทคดี<select name="caseCategory" required><option value="civil">คดีแพ่ง</option><option value="criminal">คดีอาญา</option></select></label><label>ฝ่ายที่ทนายรับว่าความ<select name="partySide" required><option value="Plaintiff">โจทก์</option><option value="Defendant">จำเลย</option></select></label><label>ศาล<input name="courtName" value="ศาลจังหวัดศรีสะเกษ" maxlength="200" required></label><label>ชื่อคู่กรณีอีกฝ่าย<input name="opposingPartyName" maxlength="250" required></label><label>ข้อหาหรือมูลเหตุคดี <span class="muted">(ไม่บังคับ)</span><textarea name="chargeOrCauseOfAction" maxlength="500"></textarea></label><button class="primary" type="submit">ยืนยันรับว่าจ้างและเปิดสำนวน</button></form>`}`:'<div class="empty">เลือกคำขอเพื่ออ่านและตอบข้อความ</div>'}</section>`;
    host.querySelectorAll('[data-select]').forEach(b=>b.onclick=async()=>{state.selectedId=Number(b.dataset.select);await loadMessages();renderStaff();});
    const thread=$('thread');if(thread)thread.scrollTop=thread.scrollHeight;
    const form=$('sendForm');if(form)form.onsubmit=sendStaffMessage;
    const convert=$('convertForm');if(convert)convert.onsubmit=convertClient;
  }
  async function sendStaffMessage(e){e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),body=new FormData(form).get('body')?.toString().trim();if(!body)return;button.disabled=true;try{await api(`/consultations/${state.selectedId}/messages`,{method:'POST',body:JSON.stringify({body})});await loadStaff();}catch(x){showNotice(x.message,true);}finally{button.disabled=false;}}
  async function setStatus(status){try{await api(`/consultations/${state.selectedId}/status`,{method:'PUT',body:JSON.stringify({status})});await loadStaff();showNotice(status==='Closed'?'ปิดคำปรึกษาแล้ว':'ทำเครื่องหมายรับเรื่องแล้ว');}catch(x){showNotice(x.message,true);}}
  async function convertClient(e){e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),data=Object.fromEntries(new FormData(form));if(!confirm('ยืนยันว่าผู้ขอปรึกษาตกลงว่าจ้าง และเปิดสำนวนลูกความจากข้อมูลนี้หรือไม่?'))return;button.disabled=true;try{const result=await api(`/consultations/${state.selectedId}/convert`,{method:'POST',body:JSON.stringify(data)});state.role='Client';showNotice(`เปิดสำนวนสำเร็จ รหัส ${result.caseCode} และเปลี่ยนบัญชีเป็นลูกความแล้ว`);setTop();await loadMine();}catch(x){showNotice(x.message,true);}finally{button.disabled=false;}}
  async function logout(){try{await api('/auth/logout',{method:'POST',body:'{}'});}catch{}state.user=null;state.role='';document.body.removeAttribute('data-role');document.body.removeAttribute('data-theme');setTop();showAuth();showLogin(false);showNotice('ออกจากระบบแล้ว');}
  window.ConsultationUI={logout,setStatus};
  start().catch(e=>{showNotice(e.message,true);showAuth();});
})();
