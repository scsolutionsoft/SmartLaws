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
        10:[
            ['ProxyRecipientName','ชื่อ-นามสกุลผู้รับมอบฉันทะ'],['ProxyCitizenId','เลขประจำตัวประชาชนผู้รับมอบฉันทะ'],
            ['ProxyHouseNo','บ้านเลขที่ผู้รับมอบฉันทะ'],['ProxyMoo','หมู่ที่'],['ProxyRoad','ถนน'],['ProxySoi','ตรอก/ซอย'],
            ['ProxySubDistrict','ตำบล/แขวง'],['ProxyDistrict','อำเภอ/เขต'],['ProxyProvince','จังหวัด'],
            ['ProxyPostalCode','รหัสไปรษณีย์'],['ProxyPhone','โทรศัพท์']
        ],
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
        caseParties:[],
        form10Recipients:[],
        partyLoadVersion:0,
        defendantDrafts:new Map(),
        changeForm(code) {
            const old = A.state.currentDoc;
            if (!old || old.formCode === code) return;
            // Collect under the old code before creating an independent draft.
            document.getElementById('edFormCode').value = old.formCode;
            const current = A.collectCurrentDocFromInputs();
            drafts.set(`${current.caseId}:${current.formCode}`, structuredClone(current));
            const key = `${current.caseId}:${code}`, tpl = A.state.templates.find(t => t.formCode === code);
            const extra = parse(current.extraFieldsJson);
            const currentCase = A.state.cases.find(c => Number(c.id) === Number(current.caseId)) || {};
            const caseLawyer = A.state.lawyers.find(l => Number(l.id) === Number(currentCase.primaryLawyerId));
            const nextExtra = {
                CaseFields:extra.CaseFields || {},
                BlackCaseNo:extra.BlackCaseNo,
                BlackCaseYear:extra.BlackCaseYear,
                RedCaseNo:extra.RedCaseNo,
                RedCaseYear:extra.RedCaseYear,
                TextFontFamily:extra.TextFontFamily,
                TextFontSize:extra.TextFontSize,
                ShowPermission:false
            };
            if (number(code) === 9) nextExtra.Form9Lawyer = A.toForm9LawyerProfile(caseLawyer) || {};
            const next = number(code) === 9 ? {
                ...current,
                id:0,
                templateId:tpl?.id || null,
                formCode:code,
                documentTitle:names[9] || tpl?.defaultHeaderTitle || tpl?.formName || code,
                docDay:'', docMonth:'', docYear:'',
                requesterFullName:'', requesterStatus:'', requesterCitizenId:'', requesterOccupation:'', requesterAge:'',
                requesterRace:'', requesterNationality:'', requesterHouseNo:'', requesterMoo:'', requesterRoad:'', requesterSoi:'',
                requesterNearBy:'', requesterSubDistrict:'', requesterDistrict:'', requesterProvince:'', requesterPostalCode:'', requesterPhone:'',
                signerName:'', signerRole:'', signatureImageBase64:'', drafterSignatureBase64:'', typistSignatureBase64:'',
                drafterName:caseLawyer?.fullName || '', drafterSignatureBase64:caseLawyer?.signatureDataUrl || '',
                clausesJson:'[]', closingPrayer:'',
                extraFieldsJson:JSON.stringify({
                    TextFontFamily:extra.TextFontFamily,
                    TextFontSize:extra.TextFontSize,
                    Form9Lawyer:A.toForm9LawyerProfile(caseLawyer) || {}
                }),
                status:'ร่าง'
            } : drafts.get(key) || {...current, id:0, templateId:tpl?.id || null, formCode:code,
                documentTitle:names[number(code)] || tpl?.defaultHeaderTitle || tpl?.formName || code,
                closingPrayer: number(code) === 4 ? 'ควรมิควรแล้วแต่จะโปรด' : current.closingPrayer,
                clausesJson:'[]', extraFieldsJson:JSON.stringify(nextExtra), status:'ร่าง'};
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
            const formFields = n === 10 ? [] : (n === 9 ? [] : special[n] || []);
            const recipientFields = n === 10
                ? `<div class="rounded-lg border border-sky-200 bg-white p-3 space-y-2"><div class="text-xs font-bold text-sky-900">ข้อมูลผู้รับมอบฉันทะ</div><div class="grid grid-cols-2 gap-2">${(special[10] || []).map(([key,label]) => E.input(key,label,extra[key] ?? defaults[key],false)).join('')}</div></div>`
                : '';
            const standardFieldHtml = fields.map(([key,label]) => E.input(key,label,extra.CaseFields?.[key] ?? lawCase[key],true)).join('')
                + formFields.map(([key,label]) => E.input(key,label,extra[key] ?? defaults[key],false)).join('');
            const partyPicker = ![1,2,3,8,15].includes(n) ? `<label class="block text-xs font-semibold">${n === 11 ? 'เลือกจำเลยในคำให้การ' : n === 10 ? 'เลือกผู้มอบฉันทะจากคู่ความในคดี' : 'ดึงข้อมูลโจทก์ / จำเลย / คู่ความจากทะเบียนคดี'}<select id="casePartyProfileSelect" onchange="CourtFormEditor.selectCaseParty(this.value)" class="w-full mt-1 p-2 border border-slate-300 rounded bg-white"><option value="">${n === 11 ? 'เลือกจำเลยเพื่อเปิดหรือสร้างแบบร่างแยกรายคน' : n === 10 ? 'เลือกโจทก์ / จำเลย หรือกรอกผู้มอบฉันทะเองด้านล่าง' : 'เลือกคู่ความเพื่อเติมชื่อ เลขประชาชน และที่อยู่'}</option></select><small class="block mt-1 font-normal text-slate-500">${n === 11 ? 'ระบบจะเรียกคืนฉบับล่าสุดที่บันทึกไว้ของจำเลยคนนั้น หรือเปิดร่างแยกหากยังไม่มี' : n === 10 ? 'หรือใช้ปุ่มดึงข้อมูลบัญชีทนาย/เสมียน หรือกรอกชื่อและเลขประจำตัวผู้มอบฉันทะเอง' : 'ข้อมูลจะเติมลงช่องผู้ยื่นและช่องคู่ความที่เกี่ยวข้องกับแบบฟอร์ม'}</small></label>` : '';
            const restoreDraft = n === 11 ? `<div class="rounded-lg border border-indigo-200 bg-indigo-50 p-2"><div class="flex flex-wrap items-center gap-2"><button id="btnRestoreLatestDefendantDraft" type="button" onclick="CourtFormEditor.restoreLatestDefendantDraft()" class="px-3 py-1.5 rounded bg-indigo-700 text-white text-xs font-bold disabled:opacity-50" disabled>เรียกคืนแบบร่างล่าสุดของจำเลยที่เลือก</button><span id="defendantDraftInfo" class="text-xs text-indigo-950">เลือกจำเลยเพื่อค้นหาแบบร่างที่บันทึกไว้</span></div></div>` : '';
            box.innerHTML = `<div class="text-sm font-bold">${esc(doc.formCode)} ${esc(names[n] || doc.documentTitle)}</div><p class="text-xs">ช่องด้านล่างตรงกับข้อมูลบนแบบพิมพ์ด้านขวา การแก้ไขมีผลเฉพาะเอกสารนี้</p>${partyPicker}${restoreDraft}${n === 9 ? `<label class="block text-xs font-semibold">ทนายผู้รับแต่ง<select id="form9AttorneySelect" onchange="CourtFormEditor.selectForm9Attorney(this.value)" class="w-full mt-1 p-2 border border-slate-300 rounded bg-white"><option value="">กำลังโหลดรายชื่อทนายในสำนักงาน</option></select></label>` : ''}${n === 10 ? `<div class="space-y-2"><label class="block text-xs font-semibold">เลือกผู้รับมอบฉันทะจากโปรไฟล์ทนาย / เสมียน<select id="form10RecipientProfileSelect" onchange="CourtFormEditor.selectForm10Recipient(this.value)" class="w-full mt-1 p-2 border border-slate-300 rounded bg-white"><option value="">กรอกชื่อเอง หรือเลือกโปรไฟล์</option></select><small class="block mt-1 font-normal text-slate-500">การเลือกจะเติมชื่อ เลขบัตร และที่อยู่ในช่องผู้รับมอบฉันทะ หรือกรอกเองได้</small></label><button type="button" onclick="CourtFormEditor.copyForm10GrantorToRecipient()" class="px-2.5 py-1.5 rounded bg-teal-100 text-teal-900 text-xs font-semibold">คัดลอกชื่อและที่อยู่ผู้มอบมาเป็นผู้รับมอบ</button></div>` : ''}<div class="grid grid-cols-2 gap-2">${standardFieldHtml}</div>${recipientFields}${n === 9 ? '<p class="text-xs text-blue-800">เลือกข้อมูลลูกความที่จะแต่งตั้งทนาย ส่วนข้อมูลหน้า ๒ ดึงจากโปรไฟล์ทนายที่เลือก</p>' : ''}${n === 10 ? '<p class="text-xs text-blue-800">ผู้มอบฉันทะใช้ช่อง “ข้าพเจ้า” และเลขประจำตัวประชาชนในส่วนข้อมูลผู้ยื่น ส่วนผู้รับมอบฉันทะใช้ชื่อและเลขบัตรในช่องกรอกด้านบน</p>' : ''}${n >= 31 ? '<p class="text-xs text-amber-800">แบบร่างทั่วไป: ต้องตรวจตำแหน่งกับแบบพิมพ์ต้นฉบับก่อนยื่นศาล</p>' : ''}`;
            box.hidden = false;
            if (![1,2,3,8,15].includes(n)) this.loadCaseParties(doc, lawCase);
            if (n === 11) this.updateDefendantDraftControl(doc);
            if (n === 9) this.loadForm9Lawyers(doc, lawCase);
            if (n === 10) this.loadForm10Recipients(doc, lawCase);
            if (n === 15) box.insertAdjacentHTML('beforeend','<p class="text-xs text-teal-800">แบ่งหน้าอัตโนมัติ: หน้าแรกปรับตามพื้นที่ใต้หัวเอกสาร • หน้าต่อสูงสุด 18 ช่อง • ข้อความยาวใช้พื้นที่เพิ่มและต่อหน้าได้ ช่องจำนวนพยานเว้นว่างเพื่อรวมจากรายการอัตโนมัติ</p>');
            const hide = (el, yes) => {if(el) el.hidden = yes;};
            const selfFillButton = document.getElementById('btnQuickFillSelf');
            const clientFillButton = document.getElementById('btnQuickFillClient');
            if (selfFillButton) selfFillButton.textContent = n === 9 ? 'ดึงข้อมูลทนายจากการตั้งค่า' : n === 10 ? 'ใช้ข้อมูลบัญชีฉันเป็นผู้มอบ' : 'ดึงข้อมูลของฉัน (บัญชีที่เข้าสู่ระบบ)';
            if (clientFillButton) clientFillButton.textContent = n === 9 ? 'ดึงข้อมูลผู้แต่งทนายในคดี' : n === 10 ? 'ใช้ข้อมูลลูกความเป็นผู้มอบ' : 'ดึงข้อมูลลูกความในคดี';
            hide(document.getElementById('edDocDay')?.closest('.bg-slate-50'),n === 3);
            const identityHeading = document.getElementById('edDocDay')?.closest('.bg-slate-50')?.querySelector('span.text-xs');
            if (identityHeading) identityHeading.textContent = [1,2,3,8,15].includes(n) ? 'ข้อมูลเลขคดีบนแบบพิมพ์' : [12,13,14].includes(n) ? 'วันออกหมาย / ผู้รับหมายและที่อยู่' : n === 10 ? 'ผู้มอบฉันทะ / ที่อยู่ผู้รับมอบฉันทะ' : 'ฐานะผู้ยื่นคำคู่ความ / ทนายความ';
            const grantorNameLabel = document.getElementById('edRequesterFullName')?.closest('div')?.querySelector('label');
            const grantorIdLabel = document.getElementById('edRequesterCitizenId')?.closest('div')?.querySelector('label');
            if (grantorNameLabel) grantorNameLabel.textContent = n === 10 ? 'ชื่อ-นามสกุลผู้มอบฉันทะ (กรอกเองได้)' : 'ข้าพเจ้า (ชื่อผู้ร้อง/โจทก์/จำเลย/ทนาย)';
            if (grantorIdLabel) grantorIdLabel.textContent = n === 10 ? 'เลขประจำตัวประชาชนผู้มอบฉันทะ (๑๓ หลัก)' : 'เลขประจำตัวประชาชน (๑๓ หลัก)';
            hide(document.getElementById('edDocDay')?.parentElement?.parentElement,[1,3,8,15].includes(n));
            document.querySelectorAll('button[onclick^="App.quickFillProfile"]').forEach(el => hide(el,[1,2,3,8,15].includes(n)));
            document.querySelectorAll('[id^=edRequester]').forEach(el => hide(el.closest('label') || el.parentElement,[1,2,3,8,15].includes(n)));
            hide(document.getElementById('edShowPermission')?.closest('[class~="bg-amber-50/80"]'),[1,2,3,8,9,10,12,13,14,15].includes(n));
            hide(document.getElementById('edSignerName')?.closest('.bg-slate-50'),[1,2,3].includes(n));
            hide(document.getElementById('clausesEditorList')?.parentElement,[2,12,13,14].includes(n));
            hide(document.getElementById('rawPetitionPasteInput')?.closest('#smartPasteContainer')?.parentElement,[1,2,3,8,12,13,14,15].includes(n));
            A.renderClausesEditorList();
        },
        async loadCaseParties(doc, lawCase) {
            const select = document.getElementById('casePartyProfileSelect');
            if (!select) return;
            const extra = parse(doc.extraFieldsJson);
            let savedId = Number(extra.SelectedPartyId || extra.Form9DefendantPartyId || doc.partyId || 0);
            const n = number(doc.formCode);
            const loadVersion = ++this.partyLoadVersion;
            this.caseParties = [];
            try {
                const response = await fetch(`/api/cases/${Number(doc.caseId || lawCase.id)}/parties`, {credentials:'same-origin'});
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (loadVersion !== this.partyLoadVersion || Number(A.state.currentDoc?.caseId) !== Number(doc.caseId) || A.state.currentDoc?.formCode !== doc.formCode) return;
                const currentDoc = A.state.currentDoc || doc;
                const currentExtra = parse(currentDoc.extraFieldsJson);
                savedId = Number(currentExtra.SelectedPartyId || currentExtra.Form9DefendantPartyId || currentDoc.partyId || savedId || 0);
                let rows = data.parties || data.Parties || [];
                if (n === 9) {
                    const side = String(lawCase.lawyerRole || data.lawyerRole || data.LawyerRole || '').replace(/^ทนาย/, '');
                    rows = rows.filter(p => (p.partySide || p.PartySide) === side && (p.isOurClient ?? p.IsOurClient) === true);
                }
                if (n === 11) rows = rows.filter(p => (p.partySide || p.PartySide) === 'จำเลย');
                if ([9,11].includes(n) && !savedId) {
                    const savedName = String(doc.requesterFullName || '').trim();
                    const savedStatus = String(doc.requesterStatus || '').trim();
                    const match = rows.find(p => this.samePartyName(this.partyDisplayName(p), savedName) && this.partyStatus(p) === savedStatus);
                    if (match) savedId = Number(match.id ?? match.Id);
                }
                this.caseParties = rows;
                if (!document.getElementById('casePartyProfileSelect')) return;
                select.innerHTML = `<option value="">เลือกคู่ความเพื่อเติมชื่อ เลขประชาชน และที่อยู่</option>${rows.map(p => {
                    const id = Number(p.id ?? p.Id), order = Number(p.partyOrder ?? p.PartyOrder);
                    const side = p.partySide ?? p.PartySide ?? '';
                    const orderThai = String(order).replace(/[0-9]/g,d=>'๐๑๒๓๔๕๖๗๘๙'[Number(d)]);
                    const fullName = this.partyDisplayName(p);
                    const represented = (p.isOurClient ?? p.IsOurClient) === true ? ' · ลูกความ' : '';
                    return `<option value="${id}" ${id === savedId ? 'selected' : ''}>${esc(side)}ที่ ${orderThai} · ${esc(fullName)}${represented}</option>`;
                }).join('')}`;
                select.value = rows.some(p => Number(p.id ?? p.Id) === savedId) ? String(savedId) : '';
                const selectedParty = rows.find(p => Number(p.id ?? p.Id) === savedId);
                if (selectedParty) {
                    const signatureNames = this.partySignatureNames(A.collectCurrentDocFromInputs(), selectedParty);
                    let changed = false;
                    for (const [key, value] of Object.entries(signatureNames)) {
                        const input = document.getElementById('ed' + key[0].toUpperCase() + key.slice(1));
                        if (input && input.value !== value) { input.value = value; changed = true; }
                    }
                    if (changed) A.syncEditorToPreview();
                }
                if ([9,11].includes(n) && savedId && !Number(extra.SelectedPartyId) && Number(A.state.currentDoc?.id) === Number(doc.id)) {
                    const match = rows.find(p => Number(p.id ?? p.Id) === savedId);
                    if (match) {
                        const currentExtra = parse(A.state.currentDoc.extraFieldsJson);
                        currentExtra.SelectedPartyId = savedId;
                        currentExtra.SelectedPartySide = match.partySide ?? match.PartySide;
                        currentExtra.SelectedPartyName = this.partyDisplayName(match);
                        currentExtra.SelectedPartyStatus = this.partyStatus(match);
                        if (n === 9) currentExtra.Form9DefendantPartyId = savedId;
                        A.state.currentDoc.extraFieldsJson = JSON.stringify(currentExtra);
                    }
                }
                if (n === 11) this.updateDefendantDraftControl(doc);
            } catch (error) {
                console.warn('Unable to load case party profiles', error);
                if (loadVersion === this.partyLoadVersion && select.isConnected) select.innerHTML = '<option value="">โหลดรายชื่อคู่ความไม่สำเร็จ</option>';
            }
        },
        partyDisplayName(party) {
            const get = key => party[key] ?? party[key[0].toUpperCase()+key.slice(1)] ?? '';
            const title = String(get('title') || '').trim(), name = String(get('fullName') || '').trim();
            if (!title || name.startsWith(title)) return name;
            const needsSpace = /^(บริษัท|ห้างหุ้นส่วน|สมาคม|มูลนิธิ|องค์การ|สำนักงาน)/.test(title) || /[A-Za-z]$/.test(title);
            return `${title}${needsSpace ? ' ' : ''}${name}`;
        },
        samePartyName(left, right) {
            return String(left || '').replace(/\s+/g, '') === String(right || '').replace(/\s+/g, '');
        },
        partySignatureNames(doc, party) {
            const bareName = String(party.fullName ?? party.FullName ?? '').trim();
            const fullName = this.partyDisplayName(party);
            const names = {};
            for (const key of ['signerName','drafterName','typistName']) {
                const name = String(doc[key] || '').trim();
                if (name && bareName && (this.samePartyName(name, bareName) || this.samePartyName(name, fullName))) names[key] = fullName;
            }
            return names;
        },
        partyStatus(party) {
            const get = key => party[key] ?? party[key[0].toUpperCase()+key.slice(1)] ?? '';
            const orderThai = String(Number(get('partyOrder'))).replace(/[0-9]/g,d=>'๐๑๒๓๔๕๖๗๘๙'[Number(d)]);
            return `${get('partySide')}ที่ ${orderThai}`;
        },
        findLatestDefendantDraft(party, formCode = A.state.currentDoc?.formCode) {
            if (!party) return null;
            const partyId = Number(party.id ?? party.Id), name = this.partyDisplayName(party), status = this.partyStatus(party);
            const documents = A.getAccessibleDocuments().filter(doc =>
                Number(doc.caseId) === Number(A.state.currentCaseId) && doc.formCode === formCode && Number(doc.id) > 0
            );
            return documents.filter(doc => {
                const extra = parse(doc.extraFieldsJson);
                const savedPartyId = Number(extra.SelectedPartyId || extra.Form9DefendantPartyId || doc.partyId || 0);
                if (savedPartyId) return savedPartyId === partyId;
                const savedName = String(extra.SelectedPartyName || doc.requesterFullName || '').trim();
                const savedStatus = String(extra.SelectedPartyStatus || doc.requesterStatus || '').trim();
                return this.samePartyName(savedName, name) && savedStatus === status;
            }).sort((a,b) => {
                const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
                const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
                return dateB - dateA || Number(b.id) - Number(a.id);
            })[0] || null;
        },
        updateDefendantDraftControl(doc = A.state.currentDoc) {
            const button = document.getElementById('btnRestoreLatestDefendantDraft');
            const info = document.getElementById('defendantDraftInfo');
            if (!button || !info) return;
            const extra = parse(doc?.extraFieldsJson);
            const selectedId = Number(document.getElementById('casePartyProfileSelect')?.value || extra.SelectedPartyId || 0);
            const party = this.caseParties.find(p => Number(p.id ?? p.Id) === selectedId);
            const latest = this.findLatestDefendantDraft(party, doc?.formCode);
            button.disabled = !latest;
            if (!party) { info.textContent = 'เลือกจำเลยเพื่อค้นหาแบบร่างที่บันทึกไว้'; return; }
            if (!latest) { info.textContent = `ยังไม่มีแบบร่างที่บันทึกไว้ของ${this.partyStatus(party)}`; return; }
            const updated = latest.updatedAt || latest.createdAt;
            const when = updated ? new Date(updated).toLocaleString('th-TH') : 'ไม่ทราบเวลา';
            info.textContent = `มีฉบับล่าสุด ${this.partyStatus(party)} · ${when}`;
        },
        async restoreLatestDefendantDraft() {
            const select = document.getElementById('casePartyProfileSelect');
            const party = this.caseParties.find(p => Number(p.id ?? p.Id) === Number(select?.value || 0));
            const current = A.collectCurrentDocFromInputs();
            const latest = this.findLatestDefendantDraft(party, current.formCode);
            if (!latest) { A.showToast('ยังไม่มีแบบร่างที่บันทึกไว้ของจำเลยรายนี้'); return; }
            let clauses = [];
            try { clauses = JSON.parse(current.clausesJson || '[]'); } catch { }
            const hasText = clauses.some(row => Object.values(row || {}).some(value => typeof value === 'string' && value.trim()));
            if (Number(current.id) === 0 && hasText && !confirm('การเรียกคืนจะแทนที่ข้อความที่ยังไม่ได้บันทึก ต้องการเรียกคืนแบบร่างล่าสุดหรือไม่?')) return;
            A.loadDocumentIntoEditorState(structuredClone(latest));
            A.populateStudioDropdowns();
            A.syncEditorToPreview();
            A.showToast(`เรียกคืนแบบร่างล่าสุดของ${this.partyStatus(party)}แล้ว`);
        },
        async deleteCurrentDocument() {
            const doc=A.state.currentDoc;
            if(!Number(doc?.id)){A.showToast('เลือกเอกสารที่บันทึกไว้ก่อนลบ');return;}
            const extra=parse(doc.extraFieldsJson),party=extra.SelectedPartyName||doc.requesterFullName||'';
            if(!window.confirm(`ยืนยันลบเอกสาร “${doc.documentTitle}”${party?` ของ ${party}`:''} หรือไม่?\nรายการในคลังสารบัญที่เชื่อมกับเอกสารนี้จะถูกลบด้วย`))return;
            const button=document.getElementById('btnDeleteStudioDocument');if(button)button.disabled=true;
            try{
                const response=await fetch(`/api/documents/${doc.id}`,{method:'DELETE',credentials:'same-origin'}),result=await response.json().catch(()=>({}));
                if(!response.ok)throw Error(result.message||'ลบเอกสารไม่สำเร็จ');
                A.state.currentDoc=null;A.state.currentCaseId=Number(doc.caseId);await A.loadDashboardData();A.openStudioForNewDoc();A.populateStudioDropdowns();A.populateFilesFilterDropdowns();A.renderFilesDirectoryView();A.syncEditorToPreview();A.showToast('ลบเอกสารและรายการในคลังสารบัญแล้ว');
            }catch(error){window.alert(error.message);}
            finally{if(button)button.disabled=false;}
        },
        form9Profile(row) {
            const get = key => row[key] ?? row[key[0].toUpperCase()+key.slice(1)] ?? '';
            return {id:Number(get('id')||0),userId:Number(get('userId')||0),fullName:get('fullName'),licenseNo:get('licenseNo'),licenseJurisdiction:get('licenseJurisdiction'),citizenId:get('citizenId'),houseNo:get('houseNo'),moo:get('moo'),road:get('road'),soi:get('soi'),subDistrict:get('subDistrict'),district:get('district'),province:get('province'),postalCode:get('postalCode'),phone:get('phone')};
        },
        async loadForm9Lawyers(doc, lawCase) {
            const select = document.getElementById('form9AttorneySelect');
            if (!select) return;
            const currentExtra = parse(doc.extraFieldsJson);
            try {
                const response = await fetch('/api/office/form9-lawyers', {credentials:'same-origin'});
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const rows = await response.json();
                this.form9Lawyers = rows.map(row => this.form9Profile(row));
            } catch (error) {
                console.warn('Unable to load office lawyer profiles for Form 9', error);
                const fallback = A.state.lawyers.find(l => Number(l.id) === Number(lawCase.primaryLawyerId));
                this.form9Lawyers = fallback ? [this.form9Profile(fallback)] : [];
            }
            if (!document.getElementById('form9AttorneySelect')) return;
            const currentProfile = currentExtra.Form9Lawyer || {};
            const selectedUserId = Number(currentExtra.Form9LawyerUserId || this.form9Lawyers.find(p => p.fullName === (currentProfile.fullName || currentProfile.FullName))?.userId || 0);
            select.innerHTML = this.form9Lawyers.length
                ? this.form9Lawyers.map(profile => `<option value="${profile.userId}" ${profile.userId === selectedUserId ? 'selected' : ''}>${esc(profile.fullName)}${profile.licenseNo ? ` · ใบอนุญาต ${esc(profile.licenseNo)}` : ''}</option>`).join('')
                : '<option value="">ไม่พบทนายที่ลงทะเบียนในสำนักงาน</option>';
        },
        selectForm9Attorney(value) {
            const profile = this.form9Lawyers.find(p => p.userId === Number(value));
            if (!profile) return;
            const doc = A.collectCurrentDocFromInputs();
            const extra = parse(doc.extraFieldsJson);
            extra.Form9LawyerUserId = profile.userId;
            extra.Form9Lawyer = A.toForm9LawyerProfile(profile);
            doc.extraFieldsJson = JSON.stringify(extra);
            A.state.currentDoc = doc;
            A.syncEditorToPreview();
        },
        async loadForm10Recipients(doc, lawCase) {
            const select = document.getElementById('form10RecipientProfileSelect');
            if (!select) return;
            const recipients = new Map();
            const addRecipient = (key, fullName, citizenId, role, signatureDataUrl = '', address = {}) => {
                if (!key || !String(fullName || '').trim()) return;
                const existing = recipients.get(key) || {};
                recipients.set(key, {
                    key,
                    fullName: String(fullName).trim(),
                    citizenId: String(citizenId || existing.citizenId || '').trim(),
                    role: role || existing.role || 'บุคคลในสำนักงาน',
                    signatureDataUrl: signatureDataUrl || existing.signatureDataUrl || '',
                    houseNo: address.houseNo ?? address.HouseNo ?? existing.houseNo ?? '',
                    moo: address.moo ?? address.Moo ?? existing.moo ?? '',
                    road: address.road ?? address.Road ?? existing.road ?? '',
                    soi: address.soi ?? address.Soi ?? existing.soi ?? '',
                    subDistrict: address.subDistrict ?? address.SubDistrict ?? existing.subDistrict ?? '',
                    district: address.district ?? address.District ?? existing.district ?? '',
                    province: address.province ?? address.Province ?? existing.province ?? '',
                    postalCode: address.postalCode ?? address.PostalCode ?? existing.postalCode ?? '',
                    phone: address.phone ?? address.Phone ?? existing.phone ?? ''
                });
            };
            const actor = A.state.currentUser || {};
            const effectiveLawyer = A.getEffectiveLawyerAccount?.() || actor;
            const mappings = (A.state.clerkMappings || []).filter(m =>
                Number(m.lawyerUserId) === Number(actor.id) || Number(m.clerkUserId) === Number(actor.id) ||
                Number(m.lawyerUserId) === Number(effectiveLawyer.id) || Number(m.clerkUserId) === Number(effectiveLawyer.id)
            );
            const relatedUserIds = new Set([Number(actor.id), Number(effectiveLawyer.id)].filter(Boolean));
            for (const mapping of mappings) {
                relatedUserIds.add(Number(mapping.lawyerUserId));
                relatedUserIds.add(Number(mapping.clerkUserId));
            }
            const caseProfileIds = new Set([Number(lawCase.primaryLawyerId), Number(lawCase.clerkId)].filter(Boolean));
            for (const user of A.state.users || []) {
                const id = Number(user.id), profileId = Number(user.lawyerProfileId);
                if (!relatedUserIds.has(id) && !caseProfileIds.has(profileId)) continue;
                const role = user.role === 'Clerk' ? 'เสมียนทนาย' : 'ทนายความ';
                addRecipient(`account:${id}`, user.fullName, user.citizenId, role, user.signatureDataUrl, user);
            }
            for (const profile of A.state.lawyers || []) {
                const user = (A.state.users || []).find(u => Number(u.lawyerProfileId) === Number(profile.id));
                if (!user && Number(profile.id) !== Number(actor.lawyerProfileId) && !caseProfileIds.has(Number(profile.id))) continue;
                const key = user ? `account:${Number(user.id)}` : `profile:${Number(profile.id)}`;
                const role = String(profile.roleType || '').includes('เสมียน') ? 'เสมียนทนาย' : 'ทนายความ';
                addRecipient(key, profile.fullName, profile.citizenId, role, profile.signatureDataUrl, profile);
            }
            for (const mapping of mappings) {
                addRecipient(`account:${Number(mapping.clerkUserId)}`, mapping.clerkFullName, mapping.clerkCitizenId, 'เสมียนทนาย', '', mapping);
            }
            try {
                const query = actor.role === 'Clerk' ? `?lawyerUserId=${Number(effectiveLawyer.id)}` : '';
                const response = await fetch(`/api/office/form10-recipients${query}`, {credentials:'same-origin'});
                if (response.ok) {
                    const profiles = await response.json();
                    for (const profile of profiles) {
                        const role = profile.accountRole === 'Clerk' ? 'เสมียนทนาย' : 'ทนายความ';
                        addRecipient(`account:${Number(profile.userId)}`, profile.fullName, profile.citizenId, role, profile.signatureDataUrl, profile);
                    }
                }
            } catch (error) {
                console.warn('Unable to load office recipients for Form 10', error);
            }
            const current = A.state.currentDoc;
            if (!select.isConnected || Number(current?.caseId) !== Number(doc.caseId) || current?.formCode !== '(๑๐)') return;
            this.form10Recipients = [...recipients.values()].sort((a,b) => a.fullName.localeCompare(b.fullName, 'th'));
            const extra = parse(doc.extraFieldsJson);
            const savedName = String(extra.ProxyRecipientName || doc.typistName || '').trim();
            const selected = extra.Form10RecipientProfileKey || this.form10Recipients.find(p =>
                this.samePartyName(p.fullName, savedName) && (!extra.ProxyCitizenId || p.citizenId === String(extra.ProxyCitizenId))
            )?.key || '';
            select.innerHTML = `<option value="">กรอกชื่อเอง หรือเลือกโปรไฟล์</option>` + this.form10Recipients.map(p =>
                `<option value="${esc(p.key)}" ${p.key === selected ? 'selected' : ''}>${esc(p.fullName)} · ${esc(p.role)}${p.citizenId ? ` · ${esc(p.citizenId)}` : ''}</option>`
            ).join('');
            select.value = selected;
        },
        selectForm10Recipient(key) {
            const doc = A.collectCurrentDocFromInputs();
            const extra = parse(doc.extraFieldsJson);
            const recipient = this.form10Recipients.find(p => p.key === key);
            if (!recipient) {
                delete extra.Form10RecipientProfileKey;
            } else {
                extra.Form10RecipientProfileKey = recipient.key;
                extra.ProxyRecipientName = recipient.fullName;
                extra.ProxyCitizenId = recipient.citizenId;
                doc.typistSignatureBase64 = recipient.signatureDataUrl || '';
                for (const key of ['HouseNo','Moo','Road','Soi','SubDistrict','District','Province','PostalCode','Phone']) {
                    extra[`Proxy${key}`] = recipient[key[0].toLowerCase()+key.slice(1)] || '';
                }
            }
            if (!recipient) doc.typistSignatureBase64 = '';
            doc.extraFieldsJson = JSON.stringify(extra);
            A.state.currentDoc = doc;
            if (recipient) {
                const values = {
                    ProxyRecipientName:recipient.fullName, ProxyCitizenId:recipient.citizenId,
                    ProxyHouseNo:extra.ProxyHouseNo, ProxyMoo:extra.ProxyMoo, ProxyRoad:extra.ProxyRoad,
                    ProxySoi:extra.ProxySoi, ProxySubDistrict:extra.ProxySubDistrict, ProxyDistrict:extra.ProxyDistrict,
                    ProxyProvince:extra.ProxyProvince, ProxyPostalCode:extra.ProxyPostalCode, ProxyPhone:extra.ProxyPhone
                };
                for (const [field, value] of Object.entries(values)) {
                    const input = document.querySelector(`[data-court-field="${field}"]`);
                    if (input) input.value = value || '';
                }
            }
            A.syncEditorToPreview();
        },
        copyForm10GrantorToRecipient() {
            const doc = A.collectCurrentDocFromInputs();
            const extra = parse(doc.extraFieldsJson);
            const values = {
                ProxyRecipientName:doc.requesterFullName,
                ProxyCitizenId:doc.requesterCitizenId,
                ProxyHouseNo:doc.requesterHouseNo,
                ProxyMoo:doc.requesterMoo,
                ProxyRoad:doc.requesterRoad,
                ProxySoi:doc.requesterSoi,
                ProxySubDistrict:doc.requesterSubDistrict,
                ProxyDistrict:doc.requesterDistrict,
                ProxyProvince:doc.requesterProvince,
                ProxyPostalCode:doc.requesterPostalCode,
                ProxyPhone:doc.requesterPhone
            };
            for (const [key, value] of Object.entries(values)) {
                extra[key] = value || '';
                const input = document.querySelector(`[data-court-field="${key}"]`);
                if (input) input.value = value || '';
            }
            delete extra.Form10RecipientProfileKey;
            doc.typistSignatureBase64 = '';
            doc.extraFieldsJson = JSON.stringify(extra);
            A.state.currentDoc = doc;
            const select = document.getElementById('form10RecipientProfileSelect');
            if (select) select.value = '';
            A.syncEditorToPreview();
            A.showToast('คัดลอกชื่อ เลขประจำตัว และที่อยู่ผู้มอบไปยังช่องผู้รับมอบแล้ว');
        },
        clearForm10RecipientSelection() {
            const select = document.getElementById('form10RecipientProfileSelect');
            if (select) select.value = '';
            const doc = A.state.currentDoc;
            if (!doc) return;
            const extra = parse(doc.extraFieldsJson);
            delete extra.Form10RecipientProfileKey;
            doc.extraFieldsJson = JSON.stringify(extra);
            doc.typistSignatureBase64 = '';
        },
        selectCaseParty(value, sync = true, selectedParty = null) {
            if (!value) {
                const doc = A.collectCurrentDocFromInputs();
                const extra = parse(doc.extraFieldsJson);
                if (number(doc.formCode) === 11 && Number(doc.id) > 0 && Number(extra.SelectedPartyId)) {
                    const select = document.getElementById('casePartyProfileSelect');
                    if (select) select.value = String(extra.SelectedPartyId);
                    return;
                }
                delete extra.SelectedPartyId;
                delete extra.SelectedPartySide;
                delete extra.SelectedPartyName;
                delete extra.SelectedPartyStatus;
                delete extra.Form9DefendantPartyId;
                doc.partyId = null;
                doc.extraFieldsJson = JSON.stringify(extra);
                A.state.currentDoc = doc;
                if (sync) A.syncEditorToPreview();
                this.updateDefendantDraftControl(doc);
                return;
            }
            const party = selectedParty || this.caseParties.find(p => Number(p.id ?? p.Id) === Number(value));
            if (!party) return;
            const before = A.collectCurrentDocFromInputs();
            const formCode = before.formCode;
            const n = number(formCode);
            if (n === 9) {
                const beforeExtra = parse(before.extraFieldsJson);
                const previousId = Number(beforeExtra.SelectedPartyId || beforeExtra.Form9DefendantPartyId || before.partyId || 0);
                const targetId = Number(party.id ?? party.Id);
                if (previousId !== targetId) {
                    if (Number(before.id) === 0 && !previousId && (before.requesterFullName || before.requesterCitizenId) &&
                        !confirm('ข้อมูลลูกความในใบแต่งทนายฉบับร่างที่ยังไม่ได้บันทึกจะถูกแทนที่ ต้องการเปิดแบบร่างแยกสำหรับลูกความที่เลือกหรือไม่?')) {
                        const select = document.getElementById('casePartyProfileSelect');
                        if (select) select.value = '';
                        return;
                    }
                    const latest = this.findLatestDefendantDraft(party, formCode);
                    if (latest) {
                        const restored = structuredClone(latest);
                        const saved = parse(restored.extraFieldsJson);
                        saved.SelectedPartyId = targetId;
                        saved.Form9DefendantPartyId = targetId;
                        saved.SelectedPartySide = party.partySide ?? party.PartySide;
                        saved.SelectedPartyName = this.partyDisplayName(party);
                        saved.SelectedPartyStatus = this.partyStatus(party);
                        restored.partyId = targetId;
                        restored.extraFieldsJson = JSON.stringify(saved);
                        A.loadDocumentIntoEditorState(restored);
                        A.populateStudioDropdowns();
                        A.syncEditorToPreview();
                        A.showToast(`เรียกคืนใบแต่งทนายฉบับล่าสุดของ${this.partyStatus(party)}แล้ว`);
                        return;
                    }
                    const cleanExtra = parse(before.extraFieldsJson);
                    delete cleanExtra.SelectedPartyId;
                    delete cleanExtra.SelectedPartySide;
                    delete cleanExtra.SelectedPartyName;
                    delete cleanExtra.SelectedPartyStatus;
                    delete cleanExtra.Form9DefendantPartyId;
                    const next = {
                        ...before,
                        id:0,
                        partyId:targetId,
                        status:'ร่าง',
                        requesterFullName:'',
                        requesterStatus:'',
                        requesterCitizenId:'',
                        requesterOccupation:'',
                        requesterAge:'',
                        requesterRace:'',
                        requesterNationality:'',
                        requesterHouseNo:'',
                        requesterMoo:'',
                        requesterRoad:'',
                        requesterSoi:'',
                        requesterNearBy:'',
                        requesterSubDistrict:'',
                        requesterDistrict:'',
                        requesterProvince:'',
                        requesterPostalCode:'',
                        requesterPhone:'',
                        extraFieldsJson:JSON.stringify(cleanExtra)
                    };
                    A.loadDocumentIntoEditorState(next);
                    A.populateStudioDropdowns();
                    this.applyCaseParty(party, sync);
                    A.showToast(`เปิดใบแต่งทนายฉบับแยกสำหรับ${this.partyStatus(party)}แล้ว`);
                    return;
                }
            }
            if (n === 11) {
                const beforeExtra = parse(before.extraFieldsJson);
                let previousId = Number(beforeExtra.SelectedPartyId || before.partyId || 0);
                if (!previousId) {
                    const currentName = String(before.requesterFullName || '').trim();
                    previousId = Number(this.caseParties.find(p => this.samePartyName(this.partyDisplayName(p), currentName))?.id ?? 0);
                }
                const targetId = Number(party.id ?? party.Id);
                if (previousId !== targetId) {
                    let clauses = [];
                    try { clauses = JSON.parse(before.clausesJson || '[]'); } catch { }
                    const hasText = clauses.some(row => Object.values(row || {}).some(text => typeof text === 'string' && text.trim()));
                    if (Number(before.id) === 0 && !previousId && hasText && !confirm('ข้อความในแบบร่างที่ยังไม่ได้บันทึกจะถูกแทนที่ ต้องการเปิดแบบร่างแยกสำหรับจำเลยที่เลือกหรือไม่?')) {
                        const select = document.getElementById('casePartyProfileSelect');
                        if (select) select.value = '';
                        return;
                    }
                    if (Number(before.id) === 0 && previousId) this.defendantDrafts.set(`${before.caseId}:${formCode}:${previousId}`, structuredClone(before));
                    const latest = this.findLatestDefendantDraft(party, formCode);
                    if (latest) {
                        const restored = structuredClone(latest);
                        const saved = parse(restored.extraFieldsJson);
                        saved.SelectedPartyId = targetId;
                        saved.SelectedPartySide = 'จำเลย';
                        saved.SelectedPartyName = this.partyDisplayName(party);
                        saved.SelectedPartyStatus = this.partyStatus(party);
                        restored.partyId = targetId;
                        restored.extraFieldsJson = JSON.stringify(saved);
                        A.loadDocumentIntoEditorState(restored);
                        A.populateStudioDropdowns();
                        A.syncEditorToPreview();
                        A.showToast(`เรียกคืนแบบร่างล่าสุดของ${this.partyStatus(party)}แล้ว`);
                        return;
                    }
                    const memoryKey = `${before.caseId}:${formCode}:${targetId}`;
                    const remembered = this.defendantDrafts.get(memoryKey);
                    let next;
                    if (remembered) {
                        next = {...structuredClone(remembered),id:0,status:'ร่าง'};
                    } else {
                        const template = A.state.templates.find(t => Number(t.id) === Number(before.templateId));
                        const cleanExtra = parse(before.extraFieldsJson);
                        delete cleanExtra.SelectedPartyId; delete cleanExtra.SelectedPartySide;
                        delete cleanExtra.SelectedPartyName; delete cleanExtra.SelectedPartyStatus;
                        for (const key of ['DefName','DefCitizenId','DefHouseNo','DefMoo','DefSubDistrict','DefDistrict','DefProvince']) cleanExtra[key] = '';
                        next = {
                            ...before,id:0,status:'ร่าง',
                            documentTitle:template?.defaultHeaderTitle || template?.formName || before.documentTitle,
                            requesterFullName:'',requesterStatus:'',requesterCitizenId:'',requesterOccupation:'',requesterAge:'',
                            requesterRace:'',requesterNationality:'',requesterHouseNo:'',requesterMoo:'',requesterRoad:'',requesterSoi:'',
                            requesterNearBy:'',requesterSubDistrict:'',requesterDistrict:'',requesterProvince:'',requesterPostalCode:'',requesterPhone:'',
                            clausesJson:'[]',extraFieldsJson:JSON.stringify(cleanExtra)
                        };
                    }
                    const nextExtra = parse(next.extraFieldsJson);
                    nextExtra.SelectedPartyId = targetId;
                    nextExtra.SelectedPartySide = 'จำเลย';
                    nextExtra.SelectedPartyName = this.partyDisplayName(party);
                    nextExtra.SelectedPartyStatus = this.partyStatus(party);
                    next.partyId = targetId;
                    next.extraFieldsJson = JSON.stringify(nextExtra);
                    A.loadDocumentIntoEditorState(next);
                    A.populateStudioDropdowns();
                    if (remembered) {
                        A.showToast(`เรียกคืนร่างที่ยังไม่ได้บันทึกของ${this.partyStatus(party)}แล้ว`);
                        this.updateDefendantDraftControl(next);
                        return;
                    }
                    this.applyCaseParty(party, sync);
                    A.showToast(`เปิดแบบร่างแยกสำหรับ${this.partyStatus(party)}แล้ว`);
                    return;
                }
            }
            this.applyCaseParty(party, sync);
        },
        applyCaseParty(party, sync = true) {
            const get = key => party[key] ?? party[key[0].toUpperCase()+key.slice(1)] ?? '';
            const partyId = Number(get('id') || 0);
            const order = Number(get('partyOrder'));
            const orderThai = String(order).replace(/[0-9]/g,d=>'๐๑๒๓๔๕๖๗๘๙'[Number(d)]);
            const side = get('partySide');
            const citizen = get('citizenId') || get('linkedCitizenNumber');
            const fullName = this.partyDisplayName(party);
            // A stored document belongs to one party. Changing the person starts a new document.
            const current = A.collectCurrentDocFromInputs();
            const persisted = A.getAccessibleDocuments().find(d => Number(d.id) === Number(current.id));
            const original = persisted || current;
            const originalExtra = parse(original.extraFieldsJson);
            const originalPartyId = Number(originalExtra.SelectedPartyId || originalExtra.Form9DefendantPartyId || original.partyId || 0);
            if (Number(current.id) > 0 && originalPartyId !== partyId) {
                current.id = 0;
                current.status = 'ร่าง';
            }
            current.partyId = partyId;
            delete current.PartyId;
            const sameSigner = this.samePartyName(current.signerName, fullName) || this.samePartyName(current.signerName, get('fullName'));
            if (originalPartyId !== partyId || !sameSigner) current.signatureImageBase64 = '';
            A.state.currentDoc = current;
            const values = {
                edRequesterFullName:fullName, edRequesterStatus:`${side}ที่ ${orderThai}`,
                edSignerName:fullName, edSignerRole:`${side}ที่ ${orderThai}`,
                edRequesterCitizenId:citizen, edRequesterOccupation:get('occupation'), edRequesterAge:get('age'),
                edRequesterRace:get('race'), edRequesterNationality:get('nationality'), edRequesterHouseNo:get('houseNo'),
                edRequesterMoo:get('moo'), edRequesterRoad:get('road'), edRequesterSoi:get('soi'), edRequesterNearBy:get('nearBy'),
                edRequesterSubDistrict:get('subDistrict'), edRequesterDistrict:get('district'), edRequesterProvince:get('province'),
                edRequesterPostalCode:get('postalCode'), edRequesterPhone:get('phone')
            };
            for (const [key, value] of Object.entries(this.partySignatureNames(current, party))) {
                values['ed' + key[0].toUpperCase() + key.slice(1)] = value;
            }
            values.edSignerName = fullName;
            Object.entries(values).forEach(([id,val]) => { const input=document.getElementById(id); if(input) input.value=val; });
            const caseNameField = ['โจทก์','ผู้ร้อง'].includes(side) ? 'plaintiffName' : ['จำเลย','ผู้คัดค้าน'].includes(side) ? 'defendantName' : '';
            const caseNameInput = caseNameField ? document.querySelector(`[data-court-field="${caseNameField}"]`) : null;
            if (caseNameInput) caseNameInput.value = fullName;
            if (number(A.state.currentDoc?.formCode) === 11 && side === 'จำเลย') {
                const defendantValues = {DefName:fullName,DefCitizenId:citizen,DefHouseNo:get('houseNo'),DefMoo:get('moo'),DefSubDistrict:get('subDistrict'),DefDistrict:get('district'),DefProvince:get('province')};
                Object.entries(defendantValues).forEach(([key,val]) => {const input=document.querySelector(`[data-court-field="${key}"]`);if(input)input.value=val;});
            }
            const doc = A.collectCurrentDocFromInputs();
            const extra = parse(doc.extraFieldsJson);
            doc.partyId = partyId;
            extra.SelectedPartyId = partyId;
            extra.SelectedPartySide = side;
            extra.SelectedPartyName = fullName;
            extra.SelectedPartyStatus = `${side}ที่ ${orderThai}`;
            if (number(doc.formCode) === 9) extra.Form9DefendantPartyId = partyId;
            doc.extraFieldsJson = JSON.stringify(extra);
            A.state.currentDoc = doc;
            if (sync) A.syncEditorToPreview();
            const select = document.getElementById('casePartyProfileSelect');
            if (select) select.value = String(partyId);
            A.populateStudioDropdowns();
            this.updateDefendantDraftControl(doc);
        },
        input(key,label,value,isCase) {
            if (['Charge','CriminalLegalBasis'].includes(key)) return `<label class="text-xs font-semibold col-span-2">${esc(label)}<textarea data-court-field="${key}" data-case-field="false" rows="3" oninput="App.syncEditorToPreview()" class="w-full mt-1 p-2 border border-slate-300 rounded bg-white">${esc(value)}</textarea></label>`;
            const handler = key.startsWith('Proxy')
                ? 'CourtFormEditor.clearForm10RecipientSelection();App.syncEditorToPreview()'
                : 'App.syncEditorToPreview()';
            return `<label class="text-xs font-semibold">${esc(label)}<input data-court-field="${key}" data-case-field="${isCase}" value="${esc(value)}" oninput="${handler}" class="w-full mt-1 p-2 border border-slate-300 rounded bg-white" /></label>`;
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
            const fontFamily = document.getElementById('edClauseTextFontFamily')?.value;
            const fontSize = document.getElementById('edClauseTextFontSize')?.value;
            if (fontFamily) extra.TextFontFamily = fontFamily;
            if (fontSize) extra.TextFontSize = Number(fontSize);
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
        if (extra.Form9Lawyer && typeof extra.Form9Lawyer === 'object') {
            extra.Form9Lawyer = Object.fromEntries(Object.entries(extra.Form9Lawyer).map(([key,value]) => [key, typeof value === 'string' ? esc(value) : value]));
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
    A.deleteStudioDocument = () => E.deleteCurrentDocument();
    const preview = document.getElementById('studioPaperPreview');
    if (preview) new ResizeObserver(() => {
        const available = preview.clientWidth - 32;
        if (available > 0) preview.style.setProperty('--court-preview-scale',Math.min(1,available / (210 * 96 / 25.4)));
    }).observe(preview);
})();
