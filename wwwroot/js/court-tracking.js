(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const valid=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
  const T=window.CourtTracking={url:'',defaultUrl:'https://cios.coj.go.th/tracking/',dialog:null,
    async load(){const r=await fetch('/api/court-tracking/settings');if(!r.ok)throw Error('โหลดลิงก์ตรวจสอบนัดไม่สำเร็จ กรุณาลองใหม่');const data=await r.json();if(!valid(data.url))throw Error('ลิงก์ตรวจสอบนัดไม่ถูกต้อง กรุณาติดต่อแอดมิน');this.url=data.url;return data;},
    async open(){
      if(!this.dialog){this.dialog=document.createElement('dialog');this.dialog.className='ct-dialog';this.dialog.setAttribute('aria-labelledby','ctTitle');document.body.append(this.dialog);}
      this.dialog.innerHTML='<div class="ct-content"><p role="status">กำลังเตรียมลิงก์ตรวจสอบนัดคดีศาล…</p><button class="sl-button" onclick="CourtTracking.dialog.close()">ปิด</button></div>';
      if(!this.dialog.open)this.dialog.showModal();
      try{await this.load();if(!this.dialog.open)return;const host=new URL(this.url).hostname;
        this.dialog.innerHTML=`<header class="ct-header"><div><span class="ct-eyebrow">COURT CASE TRACKING</span><h2 id="ctTitle">ตรวจสอบนัดคดีศาล</h2></div><button class="ct-close" type="button" aria-label="ปิด" onclick="CourtTracking.dialog.close()">✕</button></header><div class="ct-content"><div class="ct-intro"><span aria-hidden="true">⚖</span><div><h3>ตรวจสอบข้อมูลจากเว็บไซต์ศาล</h3><p>เตรียมชื่อศาล อักษรย่อ หมายเลขคดีดำ และปีคดี แล้วกรอกในเว็บไซต์ปลายทาง</p></div></div><div class="ct-destination"><small>เว็บไซต์ที่จะเปิด</small><strong>${esc(host)}</strong><a href="${esc(this.url)}" target="_blank" rel="noopener noreferrer">${esc(this.url)}</a></div><p class="ct-note">เว็บไซต์ศาลเปิดในหน้าต่างแยก เพื่อใช้งานระบบค้นหาของศาลโดยตรง ข้อมูลจะไม่ถูกนำมาบันทึกเป็นนัดใน SmartLaws อัตโนมัติ</p><div class="ct-actions"><button class="sl-button primary" type="button" onclick="CourtTracking.launch()">เปิดตรวจสอบในป๊อปอัป ↗</button><a class="sl-button" href="${esc(this.url)}" target="_blank" rel="noopener noreferrer">เปิดแท็บใหม่</a></div><p id="ctStatus" role="status" class="ct-status"></p>${App.state.currentUser.role==='Admin'?'<button class="ct-settings-link" onclick="CourtTracking.dialog.close();Workspace.open(\'settings\');document.getElementById(\'courtTrackingSettings\')?.scrollIntoView({block:\'center\',behavior:\'smooth\'})">ตั้งค่าลิงก์เว็บไซต์ →</button>':''}</div>`;
      }catch(e){if(this.dialog.open){this.dialog.querySelector('[role=status]').textContent=e.message;}}
    },
    launch(){
      if(!valid(this.url))return;
      const w=Math.min(1100,screen.availWidth),h=Math.min(850,screen.availHeight);
      const popup=window.open('about:blank','_blank',`popup=yes,width=${w},height=${h},left=${Math.max(0,Math.round((screen.availWidth-w)/2))},top=${Math.max(0,Math.round((screen.availHeight-h)/2))}`);
      const status=document.getElementById('ctStatus');
      if(!popup){status.textContent='เบราว์เซอร์ปิดกั้นป๊อปอัป กรุณาอนุญาตป๊อปอัป หรือกด “เปิดแท็บใหม่”';return;}
      popup.opener=null;popup.location.replace(this.url);status.textContent='เปิดหน้าตรวจสอบแล้ว หากไม่เห็นหน้าต่าง ให้ใช้ปุ่มเปิดแท็บใหม่';
    },
    async settings(){
      if(App.state.currentUser.role!=='Admin')return;
      const card=document.createElement('section');card.id='courtTrackingSettings';card.className='sl-card ct-settings';
      card.innerHTML=`<div class="sl-eyebrow">COURT TRACKING LINK</div><h2>ตั้งค่าลิงก์ตรวจสอบนัดคดีศาล</h2><p class="sl-muted">ลิงก์นี้ใช้ร่วมกันทั้งสำนักงาน ทนายและเสมียนเปิดตรวจสอบได้ ส่วนการแก้ไขให้สิทธิ์เฉพาะแอดมิน</p><form id="ctSettingsForm" class="sl-form"><label class="sl-label">เว็บไซต์ตรวจสอบนัด (HTTPS)<input name="url" type="url" maxlength="2048" required placeholder="${this.defaultUrl}" disabled></label><p id="ctSettingsStatus" role="status" class="ct-status">กำลังโหลด…</p><div class="sl-row"><button class="sl-button primary" type="submit" disabled>บันทึกลิงก์</button><button class="sl-button" id="ctDefault" type="button">ใช้ลิงก์ CIOS เดิม</button><button class="sl-button subtle" type="button" onclick="CourtTracking.open()">เปิดลิงก์ที่บันทึกไว้ ↗</button></div></form>`;
      document.getElementById('workspaceView').append(card);
      const form=card.querySelector('form'),input=form.elements.url,button=form.querySelector('[type=submit]'),status=card.querySelector('[role=status]');
      card.querySelector('#ctDefault').onclick=()=>{if(!input.disabled){input.value=this.defaultUrl;status.textContent='กดบันทึกเพื่อใช้ลิงก์ CIOS เดิม';}};
      try{await this.load();if(!card.isConnected)return;input.value=this.url;input.disabled=false;button.disabled=false;status.textContent='';}catch(e){status.textContent=e.message;return;}
      form.onsubmit=async e=>{e.preventDefault();if(!valid(input.value.trim())){status.textContent='กรุณาใช้ลิงก์ HTTPS ที่ถูกต้อง';return;}button.disabled=true;status.textContent='กำลังบันทึก…';try{const r=await fetch('/api/admin/court-tracking',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:input.value.trim()})});const data=await r.json();if(!r.ok)throw Error(data.message||'บันทึกไม่สำเร็จ');this.url=data.url;input.value=data.url;status.textContent='บันทึกแล้ว ผู้ใช้งานจะเปิดลิงก์ใหม่ในครั้งถัดไป';}catch(err){status.textContent=err.message;}finally{button.disabled=false;}};
    }
  };
  const install=Workspace.installShell.bind(Workspace);Workspace.installShell=function(){install();const nav=document.querySelector('#sidebar nav');nav.insertAdjacentHTML('afterbegin','<button class="nav-item" data-court-tracking onclick="CourtTracking.open()">⚖ <span>ตรวจสอบนัดคดีศาล</span><small class="ct-external" aria-hidden="true">↗</small></button>');};
  const settings=Workspace.settings.bind(Workspace);Workspace.settings=function(){settings();T.settings();};
})();
