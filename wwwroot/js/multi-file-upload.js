(() => {
    'use strict';
    const A = App;
    const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    A.escapeHtml = esc;
    A.formatUploadDate = value => {
        if (!value) return '—';
        // SQL CreatedAt is UTC; JSON datetime2 values do not contain an offset.
        const text = String(value), date = new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(text) ? text : text+'Z');
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('th-TH',{day:'2-digit',month:'long',year:'numeric',timeZone:'Asia/Bangkok'});
    };
    const open = A.openUploadFileModal.bind(A), close = A.closeUploadFileModal.bind(A), change = A.onChangeUploadStorageType.bind(A), submitLink = A.submitUploadFileAttachment.bind(A);
    A.uploadBatch = [];
    A.openUploadFileModal = function(type='PDF') {
        if (this.uploadBatchBusy) return;
        this.uploadBatch=[];this.uploadBatchTarget=null;
        document.getElementById('uploadFileModal').querySelectorAll('input,select,button').forEach(el=>el.disabled=false);
        document.getElementById('upFileInput').value='';
        document.getElementById('upFileTitle').value='';
        document.getElementById('uploadBatchProgress').textContent='';
        open(type);this.renderUploadBatch();
    };
    A.closeUploadFileModal = function() {
        if(this.uploadBatchBusy) return this.showToast('กำลังบันทึกไฟล์ กรุณารอให้เสร็จก่อนปิด');
        close();
    };
    A.onChangeUploadStorageType = function(type) { change(type);this.renderUploadBatch(); };
    A.renderUploadBatch = function() {
        const binary=document.getElementById('upStorageType').value!=='LINK';
        for(const id of ['upFileTitle','upPageCount']) document.getElementById(id).parentElement.classList.toggle('hidden',binary&&this.uploadBatch.length>0);
        document.getElementById('uploadBatchList').innerHTML=this.uploadBatch.length ? `<p class="mb-2 font-semibold">เลือก ${this.uploadBatch.length} ไฟล์ • แก้ชื่อคำร้องและจำนวนแผ่นแยกแต่ละไฟล์ได้</p><table class="sl-table"><thead><tr><th>ไฟล์ / ชื่อคำร้อง</th><th>แผ่น</th><th>สถานะ</th></tr></thead><tbody>${this.uploadBatch.map((entry,i)=>`<tr><td><div class="sl-muted" style="overflow-wrap:anywhere">${esc(entry.file.name)} (${(entry.file.size/1024/1024).toFixed(2)} MB)</div><input aria-label="ชื่อคำร้องไฟล์ที่ ${i+1}" class="sl-input" maxlength="200" value="${esc(entry.title)}" ${entry.status==='saved'?'disabled':''} oninput="App.uploadBatch[${i}].title=this.value"></td><td><input aria-label="จำนวนแผ่นไฟล์ที่ ${i+1}" class="sl-input" style="min-width:70px" type="number" min="1" value="${entry.pages}" ${entry.status==='saved'?'disabled':''} oninput="App.uploadBatch[${i}].pages=Number(this.value)"></td><td><span>${entry.status==='saved'?'✓ บันทึกแล้ว':entry.status==='saving'?'กำลังบันทึก…':entry.status==='error'?'บันทึกไม่สำเร็จ':'รอบันทึก'}</span>${entry.error?`<p class="sl-error">${esc(entry.error)}</p>`:''}${entry.status!=='saved'?`<button type="button" class="sl-link" onclick="App.removeUploadBatchFile(${i})">นำออก</button>`:''}</td></tr>`).join('')}</tbody></table>` : '';
    };
    A.removeUploadBatchFile = function(index) { if(this.uploadBatchBusy)return;this.uploadBatch.splice(index,1);this.renderUploadBatch(); };
    A.onSelectAttachmentFile = function(input) {
        if(this.uploadBatchBusy)return;
        for(const file of input.files || []) {
            if(this.uploadBatch.some(e=>e.file.name===file.name&&e.file.size===file.size&&e.file.lastModified===file.lastModified))continue;
            this.uploadBatch.push({file,title:file.name,pages:1,status:'pending',error:''});
        }
        input.value='';this.renderUploadBatch();
    };
    const read = file => new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('อ่านไฟล์ไม่สำเร็จ'));reader.readAsDataURL(file);});
    A.submitUploadFileAttachment = async function() {
        if(this.uploadBatchBusy)return;
        const progress=document.getElementById('uploadBatchProgress'), modal=document.getElementById('uploadFileModal');
        if(document.getElementById('upStorageType').value==='LINK') {
            this.state.pendingUploadBase64='';
            try { await submitLink(); } catch(e) {progress.textContent=e.message;}
            return;
        }
        if(!this.uploadBatch.length){progress.textContent='กรุณาเลือกไฟล์ก่อนบันทึก';return;}
        const caseId=Number(document.getElementById('upCaseId').value),formCode=document.getElementById('upFormCode').value,meta=this.getDirectoryMeta(formCode);
        if(!this.getAccessibleCases().some(c=>c.id===caseId)){progress.textContent='กรุณาเลือกสำนวนคดี';return;}
        this.uploadBatchTarget ||= {caseId,formCode,directoryIndexNo:meta.idx,directoryCategoryName:meta.name,fileStatus:document.getElementById('upFileStatus').value,remark:document.getElementById('upRemark').value.trim()};
        this.uploadBatchBusy=true;
        const lock=()=>modal.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);
        lock();
        try {
            for(const [index,entry] of this.uploadBatch.entries()) {
                if(entry.status==='saved')continue;
                entry.error='';entry.status='saving';this.renderUploadBatch();lock();
                progress.textContent=`กำลังบันทึกไฟล์ ${index+1} จาก ${this.uploadBatch.length}`;
                try {
                    const file=entry.file;
                    if(!entry.title.trim())throw Error('กรุณาระบุชื่อคำร้อง / เอกสาร');
                    if(!Number.isInteger(entry.pages)||entry.pages<1)throw Error('จำนวนแผ่นต้องเป็นจำนวนเต็มตั้งแต่ 1');
                    if(!file.size||file.size>10*1024*1024)throw Error('ไฟล์ต้องมีขนาดมากกว่า 0 และไม่เกิน 10 MB');
                    const mime=/\.pdf$/i.test(file.name)?'application/pdf':/\.png$/i.test(file.name)?'image/png':/\.jpe?g$/i.test(file.name)?'image/jpeg':null;
                    if(!mime)throw Error('รองรับเฉพาะ PDF, PNG และ JPG');
                    const data=await read(file);
                    const response=await fetch('/api/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...this.uploadBatchTarget,fileTitle:entry.title.trim(),pageCount:entry.pages,storageType:mime==='application/pdf'?'PDF':'IMAGE',mimeType:mime,fileDataBase64:data})});
                    const result=await response.json().catch(()=>({}));
                    if(!response.ok)throw Error(result.message||`บันทึกไม่สำเร็จ (${response.status}) กรุณาลองใหม่`);
                    entry.status='saved';entry.id=result.id;
                    this.state.caseFiles.push(result);
                }catch(error){entry.status='error';entry.error=error.message;}
            }
            await this.loadDashboardData();
            const target=this.uploadBatchTarget;
            this.populateFilesFilterDropdowns();
            document.getElementById('filesFilterCaseSelect').value=String(target.caseId);
            document.getElementById('filesFilterFormCodeSelect').value='ALL';
            document.getElementById('filesFilterStatusSelect').value='ALL';
            this.renderFilesDirectoryView();
        } finally {
            this.uploadBatchBusy=false;this.renderUploadBatch();
            modal.querySelectorAll('input,select,button').forEach(el=>el.disabled=false);
            this.renderUploadBatch();
            if(this.uploadBatch.some(e=>e.status==='saved')) {
                for(const id of ['upCaseId','upFormCode','upFileStatus','upRemark','upStorageType']) document.getElementById(id).disabled=true;
            }
            const saved=this.uploadBatch.filter(e=>e.status==='saved').length;
            progress.textContent=`บันทึกสำเร็จ ${saved}/${this.uploadBatch.length} ไฟล์${saved<this.uploadBatch.length?' • แก้รายการที่ไม่สำเร็จแล้วกดบันทึกอีกครั้ง ระบบจะไม่ส่งไฟล์ที่สำเร็จซ้ำ':''}`;
            if(saved===this.uploadBatch.length){close();this.showToast(`จัดเก็บ ${saved} ไฟล์แล้ว เปิดดูได้ทีละรายการในตาราง`);}
        }
    };
})();
