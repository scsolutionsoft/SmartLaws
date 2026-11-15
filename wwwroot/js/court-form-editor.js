/* The editor and preview share persisted, form-specific field bindings. */
(() => {
    const A = window.App, R = window.CourtRenderer;
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const number = code => Number(String(code).replace(/[๐-๙]/g, c => '๐๑๒๓๔๕๖๗๘๙'.indexOf(c)).replace(/\D/g,''));
    const names = {1:'ปกหน้าสำนวน',2:'หน้าสำนวน',3:'สารบาญ',4:'คำฟ้อง',5:'คำขอท้ายคำฟ้อง',6:'คำขอท้ายคำฟ้องอาญา',7:'คำร้อง / คำแถลง / คำขอ',8:'บัญชีทรัพย์',9:'ใบแต่งทนายความ',10:'ใบมอบฉันทะ',11:'คำให้การ',12:'หมายเรียก',13:'หมายเรียก',14:'หมายเรียก',15:'บัญชีระบุพยาน',31:'คำพิพากษา',32:'อุทธรณ์',33:'คำขอท้ายอุทธรณ์',34:'คำแก้อุทธรณ์',35:'คำขอท้ายคำแก้อุทธรณ์',36:'ฎีกา',37:'คำขอท้ายฎีกา',38:'คำแก้ฎีกา',39:'คำขอท้ายคำแก้ฎีกา'};
    const shared = [['courtName','ศาล'],['caseCategory','ความ'],['plaintiffName','โจทก์'],['defendantName','จำเลย']];
    const special = {
        1:[['ArchiveNo','เอกสารเก็บเลขที่']],
        2:[['IssueDate','วันนัดชี้สองสถาน'],['FirstHearingDate','วันพิจารณา / ไต่สวนครั้งแรก'],['EndHearingDate','วันพิจารณาเสร็จสำนวน'],['JudgmentReadDate','วันอ่านคำพิพากษา'],['JudgmentOrder','คำพิพากษาหรือคำสั่ง']],
        4:[['Charge','ข้อหา / ฐานความผิด'],['ClaimAmountBaht','ทุนทรัพย์ (บาท)'],['ClaimAmountSatang','สตางค์']],
        9:[['AppointedLawyerName','ชื่อทนายความที่แต่งตั้ง'],['LicenseNo','เลขใบอนุญาตทนายความ'],['Jurisdiction','เขตที่ได้รับอนุญาต']],
        10:[['ProxyCitizenId','เลขประจำตัวประชาชนผู้รับมอบฉันทะ']],
        11:[['DefName','ชื่อจำเลย'],['DefCitizenId','เลขประจำตัวประชาชนจำเลย'],['DefHouseNo','บ้านเลขที่จำเลย'],['DefMoo','หมู่'],['DefSubDistrict','ตำบล / แขวง'],['DefDistrict','อำเภอ / เขต'],['DefProvince','จังหวัด']],
        12:[['HearingDay','วันนัด'],['HearingMonth','เดือนนัด'],['HearingTime','เวลานัด'],['ClaimAmountBaht','ทุนทรัพย์ (บาท)'],['ClaimAmountSatang','สตางค์']],
        13:[['HearingDay','วันนัด'],['HearingMonth','เดือนนัด'],['HearingTime','เวลานัด']],
        14:[['HearingDay','วันนัด'],['HearingMonth','เดือนนัด'],['HearingTime','เวลานัด']],
        15:[['TotalWitnessCount','จำนวนพยานที่ระบุ']]
    };
    const drafterFields = [['DrafterCitizenId','เลขบัตรผู้เรียง'],['DrafterLicenseNo','เลขใบอนุญาตผู้เรียง'],['DrafterHouseNo','บ้านเลขที่ผู้เรียง'],['DrafterSubDistrict','ตำบลผู้เรียง'],['DrafterDistrict','อำเภอผู้เรียง'],['DrafterProvince','จังหวัดผู้เรียง'],['DrafterPostalCode','รหัสไปรษณีย์ผู้เรียง'],['DrafterPhone','โทรศัพท์ผู้เรียง'],['TypistHouseNo','บ้านเลขที่ผู้พิมพ์'],['TypistMoo','หมู่ผู้พิมพ์'],['TypistSubDistrict','ตำบลผู้พิมพ์'],['TypistDistrict','อำเภอผู้พิมพ์'],['TypistProvince','จังหวัดผู้พิมพ์'],['TypistPostalCode','รหัสไปรษณีย์ผู้พิมพ์'],['TypistPhone','โทรศัพท์ผู้พิมพ์']];
    special[5] = [['CopiesCount','จำนวนสำเนาคำฟ้อง'],...drafterFields];
    special[6] = [['CriminalLegalBasis','ข้อความใต้ “ผิดต่อกฎหมาย และบทมาตราดังนี้ คือ”'],...drafterFields];
    const parse = s => {try{return JSON.parse(s || '{}') || {};}catch{return {};}};
    const fixedTitles = {1:'ปกหน้าสำนวน',2:'หน้าสำนวน',3:'สารบาญ',8:'บัญชีทรัพย์',9:'ใบแต่งทนายความ',10:'ใบมอบฉันทะ',12:'หมายเรียกคดีมโนสาเร่',13:'หมายเรียกคดีแพ่งสามัญ',14:'หมายเรียกคดีอาญา',15:'บัญชีระบุพยาน'};
    let loading = false;
    const drafts = new Map();
    const E = window.CourtFormEditor = {
        changeForm(code) {
            const old = A.state.currentDoc;
            if (!old || old.formCode === code) return;
            // Collect under the old code before creating an independent draft.
            document.getElementById('edFormCode').value = old.formCode;
            const current = A.collectCurrentDocFromInputs();
            drafts.set(`${current.caseId}:${current.formCode}`, structuredClone(current));
            const key = `${current.caseId}:${code}`, tpl = A.state.templates.find(t => t.formCode === code);
            const extra = parse(current.extraFieldsJson);
            const next = drafts.get(key) || {...current, id:0, templateId:tpl?.id || null, formCode:code,
                documentTitle:names[number(code)] || tpl?.defaultHeaderTitle || tpl?.formName || code,
                closingPrayer: number(code) === 4 ? 'ควรมิควรแล้วแต่จะโปรด' : current.closingPrayer,
                clausesJson:'[]', extraFieldsJson:JSON.stringify({CaseFields:extra.CaseFields || {}, BlackCaseNo:extra.BlackCaseNo, BlackCaseYear:extra.BlackCaseYear, RedCaseNo:extra.RedCaseNo, RedCaseYear:extra.RedCaseYear, ShowPermission:false}), status:'ร่าง'};
            A.loadDocumentIntoEditorState(structuredClone(next));
            A.showToast('เปลี่ยนช่องกรอกตามแบบพิมพ์แล้ว · ร่างเดิมยังอยู่เมื่อสลับกลับในหน้านี้');
        },
        render(doc) {
            const n = number(doc.formCode), extra = parse(doc.extraFieldsJson);
            document.getElementById('closingPrayerEditor').hidden = n !== 4;
            document.getElementById('edDocumentTitle').readOnly = Boolean(fixedTitles[n]);
            const templateSelect = document.getElementById('studioTemplateSelect');
            if (templateSelect) templateSelect.value = doc.templateId || '';
            const docSelect = document.getElementById('studioDocSelect');
            if (docSelect) docSelect.value = doc.id > 0 ? String(doc.id) : 'NEW';
            const lawCase = A.state.cases.find(c => c.id === Number(doc.caseId)) || {};
            const effectiveCase = {...lawCase,...extra.CaseFields};
            const defaults = {
                Charge:effectiveCase.chargeOrCauseOfAction ?? '',
                ClaimAmountBaht:effectiveCase.claimAmount ? Number(effectiveCase.claimAmount).toLocaleString('en-US',{maximumFractionDigits:2}) : '-',
                ClaimAmountSatang:'-',
                CriminalLegalBasis:parse(doc.clausesJson)?.[0]?.Content || parse(doc.clausesJson)?.[0]?.content || effectiveCase.chargeOrCauseOfAction || ''
            };
            let box = document.getElementById('courtFormFields');
            if (!box) {
                box = document.createElement('section'); box.id = 'courtFormFields';
                box.className = 'p-3 rounded-xl border border-teal-200 bg-teal-50 space-y-3';
                document.getElementById('edDocumentTitle').closest('.grid').after(box);
            }
            const fields = n === 3 ? [] : [...shared];
            if ([1,2,14].includes(n)) fields.push(['chargeOrCauseOfAction','เรื่อง'],['claimAmount','ทุนทรัพย์ (บาท)']);
            box.innerHTML = `<div class="text-sm font-bold">${esc(doc.formCode)} ${esc(names[n] || doc.documentTitle)}</div><p class="text-xs">ช่องด้านล่างตรงกับข้อมูลบนแบบพิมพ์ด้านขวา การแก้ไขมีผลเฉพาะเอกสารนี้</p><div class="grid grid-cols-2 gap-2">${fields.map(([key,label]) => E.input(key,label,extra.CaseFields?.[key] ?? lawCase[key],true)).join('')}${(special[n] || []).map(([key,label]) => E.input(key,label,extra[key] ?? defaults[key],false)).join('')}</div>${n >= 31 ? '<p class="text-xs text-amber-800">แบบร่างทั่วไป: ต้องตรวจตำแหน่งกับแบบพิมพ์ต้นฉบับก่อนยื่นศาล</p>' : ''}`;
            box.hidden = false;
            if (n === 15) box.insertAdjacentHTML('beforeend','<p class="text-xs text-teal-800">แบ่งหน้าอัตโนมัติ: หน้าแรกปรับตามพื้นที่ใต้หัวเอกสาร • หน้าต่อสูงสุด 18 ช่อง • ข้อความยาวใช้พื้นที่เพิ่มและต่อหน้าได้ ช่องจำนวนพยานเว้นว่างเพื่อรวมจากรายการอัตโนมัติ</p>');
            const hide = (el, yes) => {if(el) el.hidden = yes;};
            hide(document.getElementById('edDocDay')?.closest('.bg-slate-50'),n === 3);
            const identityHeading = document.getElementById('edDocDay')?.closest('.bg-slate-50')?.querySelector('span.text-xs');
            if (identityHeading) identityHeading.textContent = [1,2,3,8,15].includes(n) ? 'ข้อมูลเลขคดีบนแบบพิมพ์' : [12,13,14].includes(n) ? 'วันออกหมาย / ผู้รับหมายและที่อยู่' : n === 10 ? 'ผู้มอบฉันทะ / ที่อยู่ผู้รับมอบฉันทะ' : 'ฐานะผู้ยื่นคำคู่ความ / ทนายความ';
            hide(document.getElementById('edDocDay')?.parentElement?.parentElement,[1,3,8,15].includes(n));
            document.querySelectorAll('button[onclick^="App.quickFillProfile"]').forEach(el => hide(el,[1,2,3,8,15].includes(n)));
            document.querySelectorAll('[id^=edRequester]').forEach(el => hide(el.closest('label') || el.parentElement,[1,2,3,8,15].includes(n)));
            hide(document.getElementById('edShowPermission')?.closest('[class~="bg-amber-50/80"]'),[1,2,3,8,9,10,12,13,14,15].includes(n));
            hide(document.getElementById('edSignerName')?.closest('.bg-slate-50'),[1,2,3].includes(n));
            hide(document.getElementById('clausesEditorList')?.parentElement,[2,12,13,14].includes(n));
            hide(document.getElementById('rawPetitionPasteInput')?.closest('#smartPasteContainer')?.parentElement,[1,2,3,8,12,13,14,15].includes(n));
            A.renderClausesEditorList();
        },
        input(key,label,value,isCase) {
            if (['Charge','CriminalLegalBasis'].includes(key)) return `<label class="text-xs font-semibold col-span-2">${esc(label)}<textarea data-court-field="${key}" data-case-field="false" rows="3" oninput="App.syncEditorToPreview()" class="w-full mt-1 p-2 border border-slate-300 rounded bg-white">${esc(value)}</textarea></label>`;
            return `<label class="text-xs font-semibold">${esc(label)}<input data-court-field="${key}" data-case-field="${isCase}" value="${esc(value)}" oninput="App.syncEditorToPreview()" class="w-full mt-1 p-2 border border-slate-300 rounded bg-white" /></label>`;
        }
    };
    A.onStudioTemplateChange = function(id) {
        const template = this.state.templates.find(t => t.id === Number(id));
        if (!template) return;
        if (!this.state.currentDoc) return this.createNewDocFromTemplate(template.id);
        E.changeForm(template.formCode);
        this.state.currentDoc.templateId = template.id;
        document.getElementById('studioTemplateSelect').value = template.id;
    };
    const collect = A.collectCurrentDocFromInputs;
    A.collectCurrentDocFromInputs = function() {
        const doc = collect.call(this);
        if (!loading) {
            const extra = parse(doc.extraFieldsJson);
            document.querySelectorAll('[data-court-field]').forEach(el => {
                if (el.dataset.caseField === 'true') (extra.CaseFields ||= {})[el.dataset.courtField] = el.value;
                else extra[el.dataset.courtField] = el.value;
            });
            doc.extraFieldsJson = JSON.stringify(extra);
        }
        return doc;
    };
    const load = A.loadDocumentIntoEditorState;
    A.loadDocumentIntoEditorState = function(doc) {
        if (fixedTitles[number(doc.formCode)]) doc = {...doc,documentTitle:fixedTitles[number(doc.formCode)]};
        if (number(doc.formCode) === 3 && (!doc.clausesJson || doc.clausesJson === '[]')) doc = {...doc,clausesJson:JSON.stringify([{OrderNo:1,WitnessNameAndDesc:'',AddressText:'',Note:''}])};
        loading = true;
        try { load.call(this,doc); E.render(doc); } finally {loading=false;}
        this.syncEditorToPreview();
    };
    const render = R.renderDocumentPagesHtml;
    R.renderDocumentPagesHtml = function(doc, lawCase) {
        const extra = parse(doc.extraFieldsJson), fields = extra.CaseFields || {};
        const safeFields = Object.fromEntries(Object.entries(fields).map(([key,value]) => [key,esc(value)]));
        for (const [key] of special[number(doc.formCode)] || []) {
            if (typeof extra[key] === 'string') extra[key] = esc(extra[key]);
        }
        if ([3,8,15].includes(number(doc.formCode))) {
            let rows;
            try {rows=JSON.parse(doc.clausesJson || '[]');} catch {rows=[];}
            doc = {...doc,clausesJson:JSON.stringify(rows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key,typeof value === 'string' ? esc(value) : value]))))};
        }
        return render.call(this,{...doc,extraFieldsJson:JSON.stringify(extra)},{...lawCase,...safeFields});
    };
    const clauses = A.renderClausesEditorList;
    A.renderClausesEditorList = function() {
        clauses.call(this);
        const n = number(document.getElementById('edFormCode')?.value);
        const addButton = document.querySelector('button[onclick="App.addClauseItem()"]');
        if (addButton) addButton.textContent = n === 3 ? '+ เพิ่มแถวสารบาญ' : n === 4 ? '+ เพิ่มข้อ / รายการพยาน' : '+ เพิ่มข้อ / รายการ';
        if (![1,3,8].includes(n)) return;
        if (n === 3) {
            document.getElementById('clausesSectionLabel').textContent = 'สารบาญสำนวน: อันดับ / รายการ / จำนวนแผ่น / หมายเหตุ';
            document.getElementById('clausesEditorList').innerHTML = this.state.currentClauses.map((row,i) => `<fieldset class="p-3 border rounded-xl bg-slate-50 space-y-3"><legend class="text-xs font-bold">แถวที่ ${i+1}</legend><div class="grid grid-cols-2 gap-3">${[['OrderNo','อันดับ',row.OrderNo ?? row.orderNo ?? i+1],['AddressText','จำนวนแผ่น',row.AddressText ?? row.addressText ?? '']].map(([key,label,value]) => `<label class="text-xs font-semibold">${label}<input data-index-row="${i}" data-index-field="${key}" inputmode="numeric" type="text" value="${esc(value)}" oninput="CourtFormEditor.updateIndex(${i},'${key}',this.value)" class="w-full p-2 mt-1 border rounded bg-white" /></label>`).join('')}</div>${[['WitnessNameAndDesc','รายการ',row.WitnessNameAndDesc ?? row.witnessNameAndDesc ?? row.Content ?? ''],['Note','หมายเหตุ',row.Note ?? row.note ?? '']].map(([key,label,value]) => `<label class="block text-xs font-semibold">${label}<textarea data-index-row="${i}" data-index-field="${key}" rows="${key === 'Note' ? 2 : 3}" oninput="CourtFormEditor.updateIndex(${i},'${key}',this.value)" class="w-full p-2 mt-1 border rounded bg-white">${esc(value)}</textarea></label>`).join('')}<button type="button" onclick="App.removeClauseItem(${i})" class="text-xs text-rose-600">ลบแถวนี้</button></fieldset>`).join('');
            return;
        }
        document.getElementById('clausesSectionLabel').textContent = n === 1 ? 'บันทึกบนปกสำนวน (ไม่เกิน 18 รายการ)' : 'บัญชีทรัพย์: รายการ / จำนวน / บาท / สตางค์ / หมายเหตุ';
        const fields = n === 1 ? [['Content','บันทึก']] : n === 3 ? [['WitnessNameAndDesc','รายการ'],['AddressText','จำนวนแผ่น'],['Note','หมายเหตุ']] : [['WitnessNameAndDesc','รายการทรัพย์สิน'],['AddressText','จำนวน'],['Note','ราคา (บาท)'],['Satang','สตางค์'],['Remark','หมายเหตุ']];
        document.getElementById('clausesEditorList').innerHTML = this.state.currentClauses.map((row,i) => `<div class="p-3 border rounded-xl space-y-2"><div class="flex justify-between text-xs">รายการ ${i+1}<button onclick="App.removeClauseItem(${i})" class="text-rose-600">ลบรายการ</button></div>${fields.map(([key,label]) => `<label class="block text-xs">${label}<textarea rows="2" class="w-full p-2 border rounded" oninput="App.updateWitnessField(${i},'${key}',this.value)">${esc(row[key] || '')}</textarea></label>`).join('')}</div>`).join('');
    };
    E.updateIndex = (index,field,value) => {
        if (!A.state.currentClauses[index]) return;
        A.state.currentClauses[index][field] = value;
        A.syncEditorToPreview();
    };
    const add = A.addClauseItem;
    A.addClauseItem = function() {
        if (number(document.getElementById('edFormCode')?.value) === 3) {
            const last = this.state.currentClauses.at(-1)?.OrderNo;
            const digits = String(last ?? '').replace(/[๐-๙]/g,c=>'๐๑๒๓๔๕๖๗๘๙'.indexOf(c));
            this.state.currentClauses.push({OrderNo:digits && Number.isFinite(Number(digits)) ? Number(digits)+1 : this.state.currentClauses.length+1,WitnessNameAndDesc:'',AddressText:'',Note:''});
            this.renderClausesEditorList(); this.syncEditorToPreview(); return;
        }
        if (number(document.getElementById('edFormCode')?.value) === 1 && this.state.currentClauses.length >= 18) return this.showToast('ปกสำนวนรองรับบันทึก 18 รายการ');
        add.call(this);
    };
    const preview = document.getElementById('studioPaperPreview');
    if (preview) new ResizeObserver(() => {
        const available = preview.clientWidth - 32;
        if (available > 0) preview.style.setProperty('--court-preview-scale',Math.min(1,available / (210 * 96 / 25.4)));
    }).observe(preview);
})();
