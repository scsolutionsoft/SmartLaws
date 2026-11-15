(() => {
 'use strict';
 const A=App,esc=A.escapeHtml;
 const F=window.ProfileAutofill={generation:0,
  async fill(type){
   const cid=Number(A.state.currentCaseId),user=A.state.currentUser;
   if(!user||user.role==='Admin'||!A.getAccessibleCases().some(c=>c.id===cid)||Number(A.state.currentDoc?.caseId)!==cid)return A.showToast('กรุณาเลือกเอกสารในคดีที่มีสิทธิ์');
   if(!['SELF','LAWYER_PLAINTIFF','LAWYER_DEFENDANT','CLIENT'].includes(type))return;
   const generation=++this.generation,doc=A.state.currentDoc,source=type==='CLIENT'?'client':'self';
   const buttons=[...document.querySelectorAll('button[onclick^="App.quickFillProfile"]')];buttons.forEach(b=>b.disabled=true);
   try{const r=await fetch(`/api/cases/${cid}/quick-fill?source=${source}`);const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.message||'ไม่มีสิทธิ์ดึงข้อมูลในคดีนี้');
    if(generation!==this.generation||A.state.currentDoc!==doc||Number(A.state.currentCaseId)!==cid)return;
    const apply=p=>{if(generation!==this.generation||Number(A.state.currentCaseId)!==cid||A.state.currentDoc!==doc)return A.showToast('เปลี่ยนเอกสารแล้ว กรุณากดดึงข้อมูลใหม่');this.apply(p,data.statusText,source);};
    if(data.profiles.length===1)apply(data.profiles[0]);
    else if(data.profiles.length>1){const dialog=document.getElementById('workspaceDialog');document.getElementById('workspaceDialogBody').innerHTML=`<h2 id="dialogTitle">เลือกลูกความในคดีนี้</h2><p class="sl-muted">แสดงเฉพาะบุคคลที่ระบุว่าเป็นลูกความของเราในคดีที่เลือก</p><label class="sl-label">ลูกความ<select id="quickFillClient">${data.profiles.map((p,i)=>`<option value="${i}">${esc(p.fullName)} · ${esc(p.partySide)} ${p.partyOrder||''}</option>`).join('')}</select></label><div class="sl-row" style="margin-top:20px"><button type="button" class="sl-button primary" id="confirmQuickFill">ดึงข้อมูลที่เลือก</button><button type="button" class="sl-button" onclick="document.getElementById('workspaceDialog').close()">ยกเลิก</button></div>`;document.getElementById('confirmQuickFill').onclick=()=>{const p=data.profiles[Number(document.getElementById('quickFillClient').value)];dialog.close();if(p)apply(p);};if(!dialog.open)dialog.showModal();}
    else A.showToast('ยังไม่มีข้อมูลลูกความ กรุณาเพิ่มข้อมูลในคดี');
   }catch(e){A.showToast(e.message);}finally{buttons.forEach(b=>b.disabled=false);}
  },
  apply(p,status,source){
   const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value??'';};
   for(const key of ['FullName','CitizenId','Race','Nationality','Occupation','Age','HouseNo','Moo','Road','Soi','NearBy','SubDistrict','District','Province','PostalCode','Phone'])set('edRequester'+key,p[key[0].toLowerCase()+key.slice(1)]);
   const role=status||p.partySide+(p.partyOrder?`ที่ ${p.partyOrder}`:'');set('edRequesterStatus',role);set('edSignerName',p.fullName);set('edSignerRole',role);
   if(source==='self')set('edDrafterName',p.fullName);
   A.state.currentDoc.signatureImageBase64=source==='self'?(p.signatureDataUrl||''):'';
   A.state.currentDoc.drafterSignatureBase64=source==='self'?(p.signatureDataUrl||''):'';
   A.syncEditorToPreview();A.showToast(source==='self'?'ดึงข้อมูลของบัญชีที่เข้าสู่ระบบแล้ว':'ดึงข้อมูลลูกความจากคดีที่เลือกแล้ว');
  }
 };
})();
