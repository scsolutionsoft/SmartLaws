(() => {
 'use strict';
 const A=App;
 async function request(url,method,body){const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.message||(r.status===401?'หมดเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่':'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง'));return data;}
 const S=window.StudioSave={busy:false,
  async run(mode='draft',appointment=null){
   if(this.busy)return null;this.busy=true;let saved=null,archived=false,linked=false;
   let modal=document.getElementById('studioSaveStatus');if(!modal){modal=document.createElement('dialog');modal.id='studioSaveStatus';modal.className='studio-save-status';document.body.append(modal);}
   modal.classList.remove('save-complete','save-failed');modal.innerHTML='<div class="save-status-icon" aria-hidden="true">↥</div><h2 id="studioSaveTitle">กำลังบันทึกเอกสาร</h2><p id="studioSaveMessage" role="status" aria-live="polite"></p><progress id="studioSaveProgress" max="100" value="0"></progress><div class="save-progress-caption"><span>ความคืบหน้าตามขั้นตอน</span><strong id="studioSavePercent">0%</strong></div><ol id="studioSaveSteps"></ol><div class="save-status-actions"></div>';
   modal.setAttribute('aria-labelledby','studioSaveTitle');modal.setAttribute('aria-busy','true');modal.oncancel=e=>{if(this.busy)e.preventDefault();};modal.showModal();
   const steps=['บันทึกฉบับร่าง',...(mode==='archive'?['จัดเก็บเข้าคลังสารบัญ']:[]),...(appointment?['เชื่อมเอกสารกับวันนัด']:[]),'อัปเดตข้อมูลบนหน้าจอ'];
   let done=0;const update=message=>{const percent=Math.round(done/steps.length*100);modal.querySelector('progress').value=percent;modal.querySelector('#studioSavePercent').textContent=percent+'%';modal.querySelector('#studioSaveMessage').textContent=message;modal.querySelector('ol').innerHTML=steps.map((s,i)=>`<li class="${i<done?'complete':i===done?'active':''}">${i<done?'✓':i+1} ${s}</li>`).join('');};
   try{
    update('กำลังตรวจสอบและส่งข้อมูล กรุณารอสักครู่');
    A.formatAllClausesThaiSpacing();const d=A.collectCurrentDocFromInputs();
    if(!A.getAccessibleCases().some(c=>c.id===Number(d.caseId)))throw Error('กรุณาเลือกสำนวนคดีที่คุณมีสิทธิ์');
    if(!d.documentTitle?.trim())throw Error('กรุณาระบุชื่อเอกสาร');
    if(appointment&&d.caseId!==appointment.caseId)throw Error('เอกสารต้องเป็นคดีเดียวกับวันนัด');
    saved=await request('/api/documents'+(d.id?'/'+d.id:''),d.id?'PUT':'POST',d);A.state.currentDoc=saved;done++;update('บันทึกฉบับร่างแล้ว');
    if(mode==='archive'){await request('/api/documents/'+saved.id+'/archive','POST',{pageCount:document.querySelectorAll('#studioPaperPreview .court-page').length||1});archived=true;done++;update('จัดเก็บเข้าคลังสารบัญแล้ว');}
    if(appointment){await request('/api/appointments/'+appointment.id+'/files','POST',{documentId:saved.id});linked=true;done++;update('เชื่อมเอกสารกับวันนัดแล้ว');}
    await A.loadDashboardData();A.populateStudioDropdowns();A.populateFilesFilterDropdowns();A.renderFilesDirectoryView();done++;update(appointment?'บันทึกและเชื่อมเอกสารประกอบวันนัดเรียบร้อย':archived?'จัดเก็บเอกสารฉบับล่าสุดเข้าคลังสารบัญแล้ว เปิดอ่านได้ครบทุกหน้า':'บันทึกฉบับร่างแล้ว สามารถกลับมาแก้ไขต่อได้');
    modal.querySelector('h2').textContent='บันทึกสำเร็จ';modal.classList.remove('save-failed');modal.classList.add('save-complete');
    const actions=modal.querySelector('.save-status-actions');const close=document.createElement('button');close.className='sl-button primary';close.textContent='เรียบร้อย';close.onclick=()=>modal.close();actions.append(close);
    if(archived||linked){const open=document.createElement('button');open.className='sl-button';open.textContent=linked?'กลับไปวันนัด':'เปิดคลังสารบัญ';open.onclick=()=>{modal.close();if(linked)AppointmentFiles.back();else A.openCaseFilesDirectory(saved.caseId);};actions.append(open);}
    return saved;
   }catch(e){modal.classList.add('save-failed');modal.querySelector('h2').textContent=saved?'บันทึกร่างแล้ว แต่ขั้นตอนถัดไปยังไม่สำเร็จ':'ยังบันทึกไม่สำเร็จ';update((saved?'ฉบับร่างถูกบันทึกแล้ว'+(archived?' และจัดเก็บเข้าคลังแล้ว':'')+(linked?' และเชื่อมวันนัดแล้ว':'')+' • ':'')+e.message);const close=document.createElement('button');close.className='sl-button primary';close.textContent='กลับไปตรวจสอบ / ลองใหม่';close.onclick=()=>modal.close();modal.querySelector('.save-status-actions').append(close);return null;
   }finally{this.busy=false;modal.setAttribute('aria-busy','false');}
  }
 };
 A.saveCurrentStudioDocument=()=>S.run('draft');
 A.archiveCurrentFormToCaseDirectory=()=>S.run('archive');
 A.exportCurrentDocx=async()=>{const saved=await S.run('draft');if(saved)location.href='/api/documents/'+saved.id+'/export-docx';};
 if(window.AppointmentFiles)AppointmentFiles.saveStudio=()=>S.run('draft',AppointmentFiles.context);
})();
