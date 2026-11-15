(() => {
    'use strict';
    const A = App, W = Workspace;
    const levels = ['ศาลชั้นต้น', 'ศาลอุทธรณ์', 'ศาลฎีกา'];
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const number = (n,y) => n ? `${n}${y ? '/' + y : ''}` : '';
    const searchText = v => String(v).toLocaleLowerCase().replace(/[๐-๙]/g,c=>'๐๑๒๓๔๕๖๗๘๙'.indexOf(c)).replace(/\s+/g,'');
    const original = W.litigation.bind(W);
    const originalOpen = A.openCaseFileInPopup.bind(A);
    A.openCaseFileInPopup = function(id) {
        const f = this.getAccessibleCaseFiles().find(f => f.id === Number(id));
        if (!f?.courtLevel || this.state.currentUser?.role === 'Admin') return originalOpen(id);
        this.openPopupFileViewer({title:f.fileTitle,subtitle:`${f.courtLevel} • คดีดำ ${f.judgmentBlackCaseNo} • คดีแดง ${f.judgmentRedCaseNo}`,storageType:'PDF',dataBase64:f.fileDataBase64,url:f.fileUrlOrPath});
    };
    W.litigation = function(id) {
        original(id);
        const c = A.getAccessibleCases().find(c => c.id === this.litigationCase);
        if (!c) return;
        const container = document.createElement('section'); container.className = 'sl-card sl-judgments';
        container.innerHTML = `<div class="sl-row sl-between"><div><div class="sl-eyebrow">JUDGMENT LIBRARY</div><h2>คลังคำพิพากษา PDF</h2><p class="sl-muted">${esc(c.plaintiffName)} / ${esc(c.defendantName)}</p></div><button class="sl-button primary" onclick="Workspace.uploadJudgment()">+ จัดเก็บคำพิพากษา</button></div><div class="sl-case-numbers"><div><span>คดีหมายเลขดำของสำนวน</span><strong>${esc(number(c.blackCaseNo,c.blackCaseYear) || 'ยังไม่ระบุ')}</strong></div><div><span>คดีหมายเลขแดงของสำนวน</span><strong>${esc(number(c.redCaseNo,c.redCaseYear) || 'ยังไม่ระบุ')}</strong></div></div><div class="sl-grid sl-library-filters"><label class="sl-label">ค้นหาเอกสาร<input id="judgmentSearch" placeholder="ชื่อเอกสาร เลขคดีดำ เลขคดีแดง" oninput="Workspace.filterJudgments()"></label><label class="sl-label">ชั้นศาล<select id="judgmentLevel" onchange="Workspace.filterJudgments()"><option value="">ทุกชั้นศาล</option>${levels.map(l=>`<option>${l}</option>`).join('')}</select></label></div><div id="judgmentResults" aria-live="polite"></div>`;
        document.getElementById('workspaceView').children[0].after(container);
        this.filterJudgments();
    };
    W.filterJudgments = function() {
        const q = searchText(document.getElementById('judgmentSearch').value), level = document.getElementById('judgmentLevel').value;
        const all = A.getAccessibleCaseFiles().filter(f => f.caseId === this.litigationCase && f.courtLevel);
        const files = all.filter(f => (!level || level === f.courtLevel) && searchText([f.fileTitle,f.judgmentBlackCaseNo,f.judgmentRedCaseNo].join(' ')).includes(q));
        document.getElementById('judgmentResults').innerHTML = `<p class="sl-muted">แสดง ${files.length} จาก ${all.length} เอกสาร</p>` + (files.length ? `<div class="sl-judgment-grid">${files.map(f=>`<article class="sl-judgment-file"><div class="sl-row sl-between"><span class="sl-pdf-icon">PDF</span><span class="sl-pill">${esc(f.courtLevel)}</span></div><h3>${esc(f.fileTitle)}</h3><dl><dt>คดีหมายเลขดำ</dt><dd>${esc(f.judgmentBlackCaseNo)}</dd><dt>คดีหมายเลขแดง</dt><dd>${esc(f.judgmentRedCaseNo)}</dd><dt>วันที่คำพิพากษา</dt><dd>${f.judgmentDate ? esc(new Date(f.judgmentDate).toLocaleDateString('th-TH')) : '—'}</dd></dl>${f.remark ? `<p class="sl-muted">${esc(f.remark)}</p>` : ''}<p class="sl-muted">จัดเก็บโดย ${esc(f.uploadedBy)}</p><button class="sl-button subtle" onclick="App.openCaseFileInPopup(${f.id})">เปิดอ่าน / ดาวน์โหลด PDF →</button></article>`).join('')}</div>` : `<div class="sl-empty">${all.length ? 'ไม่พบเอกสารที่ตรงกับการค้นหา' : 'ยังไม่มีคำพิพากษาในสำนวนนี้<br>เพิ่มไฟล์ PDF เพื่อเก็บคำพิพากษาทั้ง 3 ชั้นศาลไว้ด้วยกัน'}</div>`);
    };
    W.uploadJudgment = function() {
        const c = A.getAccessibleCases().find(c => c.id === this.litigationCase); if (!c) return;
        const dialog = document.getElementById('workspaceDialog');
        document.getElementById('workspaceDialogBody').innerHTML = `<div class="sl-row sl-between"><div><div class="sl-eyebrow">ADD JUDGMENT</div><h2 id="dialogTitle">จัดเก็บคำพิพากษา</h2></div><button type="button" class="sl-button" onclick="document.getElementById('workspaceDialog').close()" aria-label="ปิด">✕</button></div><p class="sl-note">ผูกกับสำนวน ${esc(c.caseCode)} • ${esc(c.plaintiffName)} / ${esc(c.defendantName)}<br>ระบุเลขคดีตามคำพิพากษาของชั้นศาลนั้น รวมปี พ.ศ.</p><form id="judgmentForm" class="sl-form"><div class="sl-grid"><label class="sl-label">ชั้นศาล<select name="courtLevel">${levels.map(l=>`<option>${l}</option>`).join('')}</select></label><label class="sl-label">วันที่คำพิพากษา<input name="judgmentDate" type="date" required></label><label class="sl-label">คดีหมายเลขดำ<input name="judgmentBlackCaseNo" required maxlength="150" value="${esc(number(c.blackCaseNo,c.blackCaseYear))}" placeholder="เช่น พ 123/2569"></label><label class="sl-label">คดีหมายเลขแดง<input name="judgmentRedCaseNo" required maxlength="150" value="${esc(number(c.redCaseNo,c.redCaseYear))}" placeholder="เช่น พ 456/2569"></label></div><label class="sl-label">จำนวนหน้า PDF<input name="pageCount" type="number" min="1" max="100000" value="1" required></label><label class="sl-label">ชื่อเอกสาร<input name="fileTitle" required maxlength="200" value="คำพิพากษา"></label><label class="sl-label sl-upload-zone">เลือกไฟล์คำพิพากษา PDF<input name="pdf" type="file" accept="application/pdf,.pdf" required><span class="sl-muted">PDF ขนาดไม่เกิน 10 MB • จัดเก็บในสำนวนที่เลือก</span></label><label class="sl-label">หมายเหตุ<textarea name="remark" maxlength="2000" placeholder="เช่น ฉบับรับรองสำเนาถูกต้อง"></textarea></label><p id="judgmentError" class="sl-error" role="alert"></p><div class="sl-row" style="justify-content:flex-end"><button type="button" class="sl-button" onclick="document.getElementById('workspaceDialog').close()">ยกเลิก</button><button class="sl-button primary" type="submit">บันทึก PDF เข้าสำนวน</button></div></form>`;
        document.getElementById('judgmentForm').onsubmit = async e => {
            e.preventDefault(); const form = e.target, button = form.querySelector('[type=submit]'); button.disabled = true;
            const error = document.getElementById('judgmentError'); error.textContent = '';
            try {
                const data = new FormData(form), file = data.get('pdf');
                if (!file.size || file.size > 10*1024*1024 || !file.name.toLowerCase().endsWith('.pdf') || await file.slice(0,5).text() !== '%PDF-') throw Error('กรุณาเลือกไฟล์ PDF ที่ถูกต้อง ขนาดไม่เกิน 10 MB');
                const encoded = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('อ่านไฟล์ไม่สำเร็จ'));reader.readAsDataURL(file);});
                const values = Object.fromEntries(data); delete values.pdf;
                const res = await fetch('/api/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,caseId:c.id,formCode:'(๓๑)',directoryCategoryName:'คำพิพากษา '+values.courtLevel,directoryIndexNo:31,storageType:'PDF',mimeType:'application/pdf',fileStatus:'ร่าง',pageCount:Number(values.pageCount),fileDataBase64:encoded})});
                const result = await res.json(); if(!res.ok) throw Error(result.message || 'บันทึกไม่สำเร็จ');
                A.state.caseFiles.push(result); dialog.close(); this.litigation(c.id); A.showToast('จัดเก็บคำพิพากษาและผูกกับสำนวนแล้ว');
            } catch(err) { error.textContent = err.message; } finally { button.disabled = false; }
        };
        dialog.showModal();
    };
})();
