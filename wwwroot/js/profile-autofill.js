(() => {
 'use strict';
 const A=App,esc=A.escapeHtml;
 const displayName=p=>{const title=String(p?.title??p?.Title??'').trim(),name=String(p?.fullName??p?.FullName??'').trim();if(!title||name.startsWith(title))return name;const needsSpace=/^(บริษัท|ห้างหุ้นส่วน|สมาคม|มูลนิธิ|องค์การ|สำนักงาน)/.test(title)||/[A-Za-z]$/.test(title);return `${title}${needsSpace?' ':''}${name}`;};
 const F=window.ProfileAutofill={generation:0,
  async fill(type){
   const cid=Number(A.state.currentCaseId),user=A.state.currentUser;
   if(!user||user.role==='Admin'||!A.getAccessibleCases().some(c=>c.id===cid)||Number(A.state.currentDoc?.caseId)!==cid)return A.showToast('กรุณาเลือกเอกสารในคดีที่มีสิทธิ์');
   if(!['SELF','LAWYER_PLAINTIFF','LAWYER_DEFENDANT','CLIENT'].includes(type))return;
   const generation=++this.generation,doc=A.state.currentDoc,source=type==='CLIENT'?'client':doc.formCode==='(๙)'?'case-lawyer':'self';
   const buttons=[...document.querySelectorAll('button[onclick^="App.quickFillProfile"]')];buttons.forEach(b=>b.disabled=true);
   try{const r=await fetch(`/api/cases/${cid}/quick-fill?source=${source}`);const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.message||'ไม่มีสิทธิ์ดึงข้อมูลในคดีนี้');
    if(generation!==this.generation||A.state.currentDoc!==doc||Number(A.state.currentCaseId)!==cid)return;
    const apply=p=>{if(generation!==this.generation||Number(A.state.currentCaseId)!==cid||A.state.currentDoc!==doc)return A.showToast('เปลี่ยนเอกสารแล้ว กรุณากดดึงข้อมูลใหม่');this.apply(p,data.statusText,source);};
    if(data.profiles.length===1)apply(data.profiles[0]);
    else if(data.profiles.length>1){const dialog=document.getElementById('workspaceDialog');document.getElementById('workspaceDialogBody').innerHTML=`<h2 id="dialogTitle">เลือกลูกความในคดีนี้</h2><p class="sl-muted">แสดงเฉพาะบุคคลที่ระบุว่าเป็นลูกความของเราในคดีที่เลือก</p><label class="sl-label">ลูกความ<select id="quickFillClient">${data.profiles.map((p,i)=>`<option value="${i}">${esc(displayName(p))} · ${esc(p.partySide)} ${p.partyOrder||''}</option>`).join('')}</select></label><div class="sl-row" style="margin-top:20px"><button type="button" class="sl-button primary" id="confirmQuickFill">ดึงข้อมูลที่เลือก</button><button type="button" class="sl-button" onclick="document.getElementById('workspaceDialog').close()">ยกเลิก</button></div>`;document.getElementById('confirmQuickFill').onclick=()=>{const p=data.profiles[Number(document.getElementById('quickFillClient').value)];dialog.close();if(p)apply(p);};if(!dialog.open)dialog.showModal();}
    else A.showToast('ยังไม่มีข้อมูลลูกความ กรุณาเพิ่มข้อมูลในคดี');
   }catch(e){A.showToast(e.message);}finally{buttons.forEach(b=>b.disabled=false);}
  },
  apply(p,status,source){
   if(source==='client'&&Number(p.id??p.Id)>0&&window.CourtFormEditor){
    const editor=window.CourtFormEditor,partyId=Number(p.id??p.Id);
    editor.selectCaseParty(String(partyId),true,p);
    const current=A.collectCurrentDocFromInputs();
    // Selection may have been cancelled, or may have restored a saved document.
    if(Number(current.partyId)!==partyId)return;
    const fullName=editor.partyDisplayName(p),role=editor.partyStatus(p);
    const previousName=current.signerName||'';
    if(!editor.samePartyName(previousName,fullName)&&!editor.samePartyName(previousName,p.fullName??p.FullName))current.signatureImageBase64='';
    const nameInput=document.getElementById('edSignerName'),roleInput=document.getElementById('edSignerRole');
    if(nameInput)nameInput.value=fullName;
    if(roleInput)roleInput.value=role;
    current.signerName=fullName;current.signerRole=role;
    A.state.currentDoc=current;
    A.syncEditorToPreview();
    A.showToast('ดึงข้อมูลลูกความ พร้อมชื่อผู้ลงนามหลักและตำแหน่งใต้เส้นลงนามแล้ว');
    return;
   }
   const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value??'';};
   const fullName=displayName(p);
   if(source==='case-lawyer'&&A.state.currentDoc?.formCode==='(๙)'){
    let extra={};try{extra=JSON.parse(A.state.currentDoc.extraFieldsJson||'{}')||{};}catch{}
    extra.Form9Lawyer=A.toForm9LawyerProfile(p);
    A.state.currentDoc.extraFieldsJson=JSON.stringify(extra);
    A.state.currentDoc.drafterName=p.fullName||'';
    A.state.currentDoc.drafterSignatureBase64=p.signatureDataUrl||'';
    A.syncEditorToPreview();A.showToast('ดึงข้อมูลทนายเจ้าของคดีจากการตั้งค่าแล้ว');return;
   }
   for(const key of ['CitizenId','Race','Nationality','Occupation','Age','HouseNo','Moo','Road','Soi','NearBy','SubDistrict','District','Province','PostalCode','Phone'])set('edRequester'+key,p[key[0].toLowerCase()+key.slice(1)]);
   set('edRequesterFullName',fullName);
   const role=status||p.partySide+(p.partyOrder?`ที่ ${p.partyOrder}`:'');set('edRequesterStatus',role);set('edSignerName',fullName);set('edSignerRole',role);
   if(source==='client'){
    const side=p.partySide??p.PartySide??'',field=['โจทก์','ผู้ร้อง'].includes(side)?'plaintiffName':['จำเลย','ผู้คัดค้าน'].includes(side)?'defendantName':'';
    const caseInput=field?document.querySelector(`[data-court-field="${field}"]`):null;if(caseInput)caseInput.value=fullName;
    const doc=A.collectCurrentDocFromInputs(),extra=(()=>{try{return JSON.parse(doc.extraFieldsJson||'{}')||{};}catch{return {};}})(),partyId=Number(p.id??p.Id??0);
    if(partyId){doc.partyId=partyId;extra.SelectedPartyId=partyId;extra.SelectedPartySide=side;extra.SelectedPartyName=fullName;extra.SelectedPartyStatus=role;doc.extraFieldsJson=JSON.stringify(extra);A.state.currentDoc=doc;}
   }
   if(source==='self')set('edDrafterName',fullName);
   A.state.currentDoc.signatureImageBase64=source==='self'?(p.signatureDataUrl||''):'';
   A.state.currentDoc.drafterSignatureBase64=source==='self'?(p.signatureDataUrl||''):'';
   A.syncEditorToPreview();A.showToast(source==='self'?'ดึงข้อมูลของบัญชีที่เข้าสู่ระบบแล้ว':'ดึงข้อมูลลูกความจากคดีที่เลือกแล้ว');
  }
 };
})();
