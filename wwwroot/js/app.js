// ============================================================================
// SmartLaws - Main Application Controller (Front-Office, Studio, E-Sign, Reports, Back-Office)
// ============================================================================

window.App = {
    state: {
        activeTab: 'dashboard',
        globalRoleFilter: 'ALL',
        caseCategoryFilter: 'ALL',
        cases: [],
        documents: [],
        templates: [],
        lawyers: [],
        signatures: [],
        users: [],
        plans: [],
        paymentSlips: [],
        caseFiles: [],
        clerkMappings: [],
        activeClerkPrincipalLawyerUserId: null,
        clerkModalMode: 'EXISTING',
        currentUser: null,
        currentCaseId: 1,
        currentDoc: null,
        currentClauses: [],
        pendingUploadBase64: '',
        pendingUploadFile: null,
        pendingUploadMimeType: 'application/pdf',
        pendingSlipBase64: '',
        pendingSlipFile: null,
        rawUploadedSigImage: null,
        batchPrintSigningMode: 'DOC_DEFAULT',
        imageZoomScale: 1,
        penColor: '#1e3a8a',
        isDrawing: false
    },

    // สารบัญแบบพิมพ์ศาลมาตรฐาน (อ้างอิงตามไฟล์ 00_สารบัญแบบพิมพ์ศาล.pdf) ใช้เป็นฟังก์ชันกลางร่วมกันทั้งระบบ
    courtDirectoryCatalog: {
        '(๐๐)': { idx: 0, name: 'สารบัญแบบพิมพ์ศาล (อ้างอิงมาตรฐานศาลยุติธรรม)' },
        '(๑)': { idx: 1, name: 'แบบฟอร์มปกหน้าสำนวน' },
        '(๒)': { idx: 2, name: 'แบบฟอร์มหน้าสำนวน' },
        '(๓)': { idx: 3, name: 'แบบฟอร์มสารบาญสำนวน' },
        '(๔)': { idx: 4, name: 'แบบพิมพ์คำฟ้อง' },
        '(๕)': { idx: 5, name: 'แบบฟอร์มคำขอท้ายคำฟ้องแพ่ง' },
        '(๖)': { idx: 6, name: 'แบบฟอร์มคำขอท้ายคำฟ้องอาญา' },
        '(๗)': { idx: 7, name: 'แบบฟอร์มคำร้อง / คำแถลง / คำขอ' },
        '(๘)': { idx: 8, name: 'แบบฟอร์มบัญชีทรัพย์' },
        '(๙)': { idx: 9, name: 'แบบฟอร์มใบแต่งทนายความ' },
        '(๑๐)': { idx: 10, name: 'แบบฟอร์มใบมอบฉันทะ' },
        '(๑๑)': { idx: 11, name: 'แบบฟอร์มคำให้การจำเลย' },
        '(๑๑ ก.)': { idx: 11, name: 'แบบฟอร์มคำให้การจำเลย (เพิ่มเติม)' },
        '(๑๒)': { idx: 12, name: 'แบบฟอร์มหมายเรียกคดีมโนสาเร่หรือคดีไม่มีข้อยุ่งยาก' },
        '(๑๓)': { idx: 13, name: 'แบบฟอร์มหมายเรียกคดีแพ่งสามัญ' },
        '(๑๔)': { idx: 14, name: 'แบบฟอร์มหมายเรียกคดีอาญา' },
        '(๑๕)': { idx: 15, name: 'แบบฟอร์มบัญชีระบุพยาน' },
        '(๑๖)': { idx: 16, name: 'รายงานกระบวนพิจารณาคดี' },
        '(๔๐ ก.)': { idx: 40, name: 'ใบต่อคำคู่ความ' }
    },

    getDirectoryMeta(formCode) {
        return this.courtDirectoryCatalog[formCode] || { idx: 7, name: 'เอกสารคำคู่ความตามสารบัญแบบพิมพ์ศาล' };
    },

    // คำนวณสถานะไฟล์ของแต่ละหมวดสารบัญแบบพิมพ์ศาล (๑)-(๑๕) ว่ามีกี่ไฟล์ กี่หน้า และสถานะล่าสุดเป็นอย่างไรในสำนวนที่เลือก
    getFormCodeFileStats(caseId, formCode) {
        const isAllCases = !caseId || caseId === 'ALL';
        const cidNum = Number(caseId);
        const matchCode = (code) => {
            if (!code) return false;
            if (code === formCode) return true;
            if (formCode === '(๑๑)' && code === '(๑๑ ก.)') return true;
            return false;
        };

        const matchedFiles = (this.getAccessibleCaseFiles() || []).filter(f => {
            if (!isAllCases && Number(f.caseId) !== cidNum) return false;
            return matchCode(f.formCode);
        });

        // นับรวมเอกสารคำคู่ความใน Studio ของสำนวนเดียวกันที่ยังไม่ได้ผูกเข้าตาราง CaseFileAttachments ซ้ำ
        const linkedDocIds = new Set(matchedFiles.map(f => f.documentId).filter(Boolean));
        const unlinkedDocs = (this.getAccessibleDocuments() || []).filter(d => {
            if (!isAllCases && Number(d.caseId) !== cidNum) return false;
            if (linkedDocIds.has(d.id)) return false;
            return matchCode(d.formCode);
        });

        let totalFiles = matchedFiles.length + unlinkedDocs.length;
        let totalPages = matchedFiles.reduce((sum, f) => sum + (Number(f.pageCount) || 1), 0);

        unlinkedDocs.forEach(d => {
            let clauses = [];
            try { clauses = JSON.parse(d.clausesJson || '[]'); } catch { clauses = []; }
            const totalChars = clauses.reduce((s, c) => s + ((c.Content || c.content || '').length), 0);
            const estPages = ['(๕)', '(๖)', '(๙)', '(๑๒)', '(๑๔)'].includes(d.formCode)
                ? 2
                : (totalChars > 240 ? Math.max(2, Math.ceil(totalChars / 1100) + 1) : 1);
            totalPages += estPages;
        });

        const latestStatus = matchedFiles.length > 0
            ? (matchedFiles[0].fileStatus || 'ยื่นต่อศาลแล้ว')
            : (unlinkedDocs.length > 0 ? (unlinkedDocs[0].status || 'ฉบับสมบูรณ์') : '');

        return {
            fileCount: totalFiles,
            totalPages,
            latestStatus,
            files: matchedFiles,
            docs: unlinkedDocs
        };
    },

    // อัปเดตดรอปดาวน์รหัสสารบัญแบบพิมพ์ศาล (๑)-(๑๕) ให้แสดงสถานะว่ามีไฟล์แล้วกี่ไฟล์ กี่หน้า หรือยังไม่มีไฟล์
    populateFormCodeDropdownWithStats(selectId, caseId, options = {}) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const currentVal = sel.value || options.defaultValue || (options.includeAll ? 'ALL' : '(๗)');

        const formItems = [
            ...(options.includeZero ? [{ code: '(๐๐)', label: 'สารบัญแบบพิมพ์ศาล' }] : []),
            { code: '(๑)', label: 'ปกหน้าสำนวน' },
            { code: '(๒)', label: 'หน้าสำนวน' },
            { code: '(๓)', label: 'สารบาญสำนวน' },
            { code: '(๔)', label: 'แบบพิมพ์คำฟ้อง' },
            { code: '(๕)', label: 'คำขอท้ายคำฟ้องแพ่ง' },
            { code: '(๖)', label: 'คำขอท้ายคำฟ้องอาญา' },
            { code: '(๗)', label: 'คำร้อง / คำแถลง / คำขอ' },
            { code: '(๘)', label: 'บัญชีทรัพย์' },
            { code: '(๙)', label: 'ใบแต่งทนายความ' },
            { code: '(๑๐)', label: 'ใบมอบฉันทะ' },
            { code: '(๑๑)', label: 'คำให้การจำเลย' },
            ...(options.include11Kor ? [{ code: '(๑๑ ก.)', label: 'คำให้การจำเลย (๑๑ ก.)' }] : []),
            { code: '(๑๒)', label: 'หมายเรียกคดีมโนสาเร่' },
            { code: '(๑๓)', label: 'หมายเรียกคดีแพ่งสามัญ' },
            { code: '(๑๔)', label: 'หมายเรียกคดีอาญา' },
            { code: '(๑๕)', label: 'บัญชีระบุพยาน' },
            { code: '(๑๖)', label: 'รายงานกระบวนพิจารณาคดี (เอกสารประกอบนัด)' }
        ];

        let html = '';
        if (options.includeAll) {
            const allFiles = (this.getAccessibleCaseFiles() || []).filter(f => !caseId || caseId === 'ALL' || Number(f.caseId) === Number(caseId));
            const allPages = allFiles.reduce((s, f) => s + (Number(f.pageCount) || 1), 0);
            html += `<option value="ALL" ${currentVal === 'ALL' ? 'selected' : ''}>แสดงทุกหมวดตามสารบัญแบบพิมพ์ศาล (รวม ${allFiles.length} ไฟล์ • ${allPages} หน้า)</option>`;
        }

        formItems.forEach(item => {
            const st = this.getFormCodeFileStats(caseId, item.code);
            const statusText = st.fileCount > 0
                ? `✅ มีไฟล์แล้ว ${st.fileCount} ไฟล์ (${st.totalPages} หน้า) [${st.latestStatus}]`
                : `⚪ ยังไม่มีไฟล์ (0 ไฟล์)`;
            const selectedAttr = item.code === currentVal ? 'selected' : '';
            html += `<option value="${item.code}" ${selectedAttr}>${item.code} ${item.label} — ${statusText}</option>`;
        });

        sel.innerHTML = html;
        if ([...sel.options].some(o => o.value === currentVal)) {
            sel.value = currentVal;
        }
    },

    // เตรียม Container พิมพ์กระดาษศาล A4 ระดับ Root เพื่อให้การสั่งพิมพ์ออกเป็นไฟล์ PDF เหมือนหน้าตัวอย่างก่อนพิมพ์ 100%
    preparePrintRootContainer(mode = 'auto') {
        const printRoot = document.getElementById('printOnlyRootContainer');
        if (!printRoot) return false;

        let targetMode = mode;
        if (targetMode === 'auto') {
            if (this.state.activeTab === 'printcenter') targetMode = 'batch';
            else if (this.state.activeTab === 'studio') targetMode = 'studio';
            else if (!document.getElementById('filePreviewModal')?.classList.contains('hidden')) targetMode = 'popup';
        }

        if (targetMode === 'studio') {
            this.syncEditorToPreview();
            const studioEl = document.getElementById('studioPaperPreview');
            if (studioEl && studioEl.innerHTML.trim()) {
                printRoot.innerHTML = `<div class="court-paper-wrapper">${studioEl.innerHTML}</div>`;
                document.body.classList.add('printing-court-paper');
                return true;
            }
        } else if (targetMode === 'batch') {
            const cid = Number(document.getElementById('batchPrintCaseSelect')?.value || this.state.currentCaseId);
            this.updateBatchPrintPreview(cid);
            const batchEl = document.getElementById('batchPrintPreviewContainer');
            if (batchEl && batchEl.innerHTML.trim()) {
                printRoot.innerHTML = `<div class="court-paper-wrapper">${batchEl.innerHTML}</div>`;
                document.body.classList.add('printing-court-paper');
                return true;
            }
        } else if (targetMode === 'popup') {
            const popupPaper = document.querySelector('#popupViewerBody .court-paper-wrapper');
            if (popupPaper && popupPaper.innerHTML.trim()) {
                printRoot.innerHTML = `<div class="court-paper-wrapper">${popupPaper.innerHTML}</div>`;
                document.body.classList.add('printing-court-paper');
                return true;
            }
        }

        document.body.classList.remove('printing-court-paper');
        return false;
    },

    printCourtPaper(mode = 'studio') {
        this.preparePrintRootContainer(mode);
        setTimeout(() => {
            window.print();
        }, 60);
    },

    getFileStatusBadgeHtml(status) {
        const s = status || 'ร่าง';
        if (s.includes('ศาลรับ')) return `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">✅ ${s}</span>`;
        if (s.includes('ยื่นต่อศาล')) return `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300">🏛️ ${s}</span>`;
        if (s.includes('ลงนาม')) return `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">✍️ ${s}</span>`;
        if (s.includes('ตรวจทาน')) return `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">🔍 ${s}</span>`;
        return `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">📝 ${s}</span>`;
    },

    async init() {
        await this.loadDashboardData();
        this.initSignatureCanvas();
        this.loadSamplePaperSignatureForBgRemoval(true);
        this.applyRoleBasedNavigation();
        this.renderAllViews();
        if (window.lucide) lucide.createIcons();
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => this.syncEditorToPreview());
        }
        window.addEventListener('beforeprint', () => {
            if (!document.body.classList.contains('printing-court-paper')) {
                this.preparePrintRootContainer('auto');
            }
        });
        window.addEventListener('afterprint', () => {
            document.body.classList.remove('printing-court-paper');
        });
    },

    async loadDashboardData() {
        try {
            const res = await fetch('/api/dashboard');
            const data = await res.json();
            this.state.cases = data.cases || [];
            this.state.documents = data.recentDocuments || [];
            this.state.templates = data.templates || [];
            this.state.lawyers = data.lawyers || [];
            this.state.signatures = data.signatures || [];
            this.state.users = data.users || [];
            this.state.plans = data.plans || [];
            this.state.paymentSlips = data.paymentSlips || [];
            this.state.caseFiles = data.caseFiles || [];
            this.state.clerkMappings = data.clerkMappings || [];

            if (!this.state.currentUser && this.state.users.length > 0) {
                // เริ่มต้นด้วยบัญชีทนายปิยะณัฐ วัชราภรณ์ (ทดลองใช้ 3 คดี) หรือบัญชีแรกในระบบ
                this.state.currentUser = this.state.users.find(u => u.username === 'piyanat') || this.state.users[0];
            } else if (this.state.currentUser) {
                this.state.currentUser = this.state.users.find(u => u.id === this.state.currentUser.id) || this.state.currentUser;
            }

            if (this.state.currentUser?.role === 'Clerk') {
                const myPrincipalLinks = this.state.clerkMappings.filter(m => m.clerkUserId === this.state.currentUser.id);
                if (myPrincipalLinks.length > 0 && !myPrincipalLinks.some(m => m.lawyerUserId === this.state.activeClerkPrincipalLawyerUserId)) {
                    this.state.activeClerkPrincipalLawyerUserId = myPrincipalLinks[0].lawyerUserId;
                }
            }

            this.syncActiveCaseToCurrentAccount();
            this.renderHeaderAccountBar();
        } catch (err) {
            console.error('Error loading dashboard data:', err);
            this.showToast('เกิดข้อผิดพลาดในการโหลดข้อมูลจากฐานข้อมูล');
        }
    },

    // ดึงแอคเคาท์ทนายความเจ้าของสำนวน (กรณีล็อกอินเป็นเสมียนทนาย จะคืนค่าแอคเคาท์ทนายที่เสมียนกำลังปฏิบัติงานให้)
    getEffectiveLawyerAccount() {
        const u = this.state.currentUser;
        if (!u) return this.state.users.find(x => x.role === 'Lawyer') || this.state.users[0];
        if (u.role === 'Clerk') {
            const myLinks = this.state.clerkMappings.filter(m => m.clerkUserId === u.id);
            const targetLawyerUserId = this.state.activeClerkPrincipalLawyerUserId || myLinks[0]?.lawyerUserId;
            return this.state.users.find(x => x.id === Number(targetLawyerUserId)) || u;
        }
        return u;
    },

    // แยกแอคเคาท์ทนายความ: ทนายแต่ละคนจะเห็นเฉพาะคดีของตนเองเท่านั้น (ส่วนแอดมินไม่สามารถดูข้อมูลสำนวนคดีของทนายได้)
    toForm9LawyerProfile(profile) {
        if (!profile) return null;
        return {
            fullName: profile.fullName || '',
            licenseNo: profile.licenseNo || '',
            licenseJurisdiction: profile.licenseJurisdiction || '',
            citizenId: profile.citizenId || '',
            houseNo: profile.houseNo || '',
            moo: profile.moo || '',
            road: profile.road || '',
            soi: profile.soi || '',
            subDistrict: profile.subDistrict || '',
            district: profile.district || '',
            province: profile.province || '',
            postalCode: profile.postalCode || '',
            phone: profile.phone || ''
        };
    },

    getAccessibleCases() {
        const u = this.state.currentUser;
        if (!u) return [];
        if (u.role === 'Admin') {
            return [];
        }
        const effectiveLawyer = this.getEffectiveLawyerAccount();
        const targetProfileId = Number(effectiveLawyer?.lawyerProfileId || 0);
        if (targetProfileId > 0) {
            return (this.state.cases || []).filter(c => Number(c.primaryLawyerId) === targetProfileId);
        }
        return [];
    },

    getAccessibleDocuments() {
        const allowedCaseIds = new Set(this.getAccessibleCases().map(c => c.id));
        return (this.state.documents || []).filter(d => allowedCaseIds.has(d.caseId));
    },

    getAccessibleCaseFiles() {
        const allowedCaseIds = new Set(this.getAccessibleCases().map(c => c.id));
        return (this.state.caseFiles || []).filter(f => allowedCaseIds.has(f.caseId));
    },

    // สำหรับแอดมิน: เห็นเฉพาะชื่อคดีและทนายผู้ถือโควต้าเท่านั้น ไม่สามารถดูชื่อคู่ความ ทุนทรัพย์ หรือข้อมูลในสำนวนคดีทนายได้
    getAdminServiceCaseTitlesOnly() {
        return (this.state.cases || []).map(c => {
            const ownerUser = (this.state.users || []).find(u => u.role === 'Lawyer' && Number(u.lawyerProfileId) === Number(c.primaryLawyerId));
            const assignedClerk = (this.state.lawyers || []).find(l => Number(l.id) === Number(c.clerkId));
            return {
                id: c.id,
                caseCode: c.caseCode || `CASE-${c.id}`,
                caseTitleOnly: `คดี${c.caseCategory} หมายเลขดำที่ ${c.blackCaseNo}/๒๕${c.blackCaseYear} (ศาล${c.courtName})`,
                caseCategory: c.caseCategory,
                ownerLawyerName: ownerUser?.fullName || `ทนายความรหัส #${c.primaryLawyerId}`,
                ownerUsername: ownerUser?.username || '-',
                ownerPlanName: ownerUser?.planName || '-',
                assignedClerkName: assignedClerk?.fullName || '-',
                status: c.status || 'กำลังดำเนินการ'
            };
        });
    },

    syncActiveCaseToCurrentAccount() {
        const myCases = this.getAccessibleCases();
        if (myCases.length > 0) {
            if (!myCases.some(c => c.id === Number(this.state.currentCaseId))) {
                this.state.currentCaseId = myCases[0].id;
            }
            const myDocs = this.getAccessibleDocuments().filter(d => d.caseId === Number(this.state.currentCaseId));
            if (myDocs.length > 0 && (!this.state.currentDoc || !myDocs.some(d => d.id === this.state.currentDoc.id))) {
                this.loadDocumentIntoEditorState(myDocs[0]);
            }
        }
    },

    applyRoleBasedNavigation() {
        const isAdmin = this.state.currentUser?.role === 'Admin';
        document.querySelectorAll('[data-lawyer-only="true"]').forEach(el => {
            el.classList.toggle('hidden', isAdmin);
        });
        document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
            el.classList.toggle('hidden', !isAdmin);
        });
        const navReportsLabel = document.getElementById('navReportsLabel');
        if (navReportsLabel) {
            navReportsLabel.textContent = isAdmin ? 'รายงานบริการ (เฉพาะชื่อคดี)' : 'ระบบรายงานและสถิติคดีของฉัน';
        }

        const lawyerOnlyTabs = ['dashboard', 'cases', 'studio', 'files', 'procedure', 'esign', 'printcenter', 'clientDesk', 'clientDeskChat'];
        if (isAdmin && lawyerOnlyTabs.includes(this.state.activeTab)) {
            this.switchTab('backoffice');
        } else if (!isAdmin && this.state.activeTab === 'backoffice') {
            this.switchTab('dashboard');
        }
    },

    renderHeaderAccountBar() {
        const sel = document.getElementById('headerAccountSelect');
        const badge = document.getElementById('headerQuotaBadge');
        const clerkWrap = document.getElementById('headerClerkPrincipalWrap');
        const clerkPrincipalSel = document.getElementById('headerClerkPrincipalSelect');

        if (sel && this.state.users.length > 0) {
            sel.innerHTML = this.state.users.map(u => {
                const myOwnCasesCount = (this.state.cases || []).filter(c => Number(c.primaryLawyerId) === Number(u.lawyerProfileId)).length;
                const roleTag = u.role === 'Admin'
                    ? '🛡️ [Admin บริหารระบบบริการ]'
                    : u.role === 'Clerk'
                        ? `👨‍💼 [เสมียนทนาย • สังกัด ${this.state.clerkMappings.filter(m => m.clerkUserId === u.id).length} ทนาย]`
                        : `⚖️ [ทนายความ • คดีของตนเอง ${myOwnCasesCount} คดี]`;
                return `
                <option value="${u.id}" ${this.state.currentUser?.id === u.id ? 'selected' : ''}>
                    ${roleTag} ${u.fullName}
                </option>`;
            }).join('');
        }

        const u = this.state.currentUser;
        if (u && u.role === 'Clerk') {
            const myMappings = this.state.clerkMappings.filter(m => m.clerkUserId === u.id);
            if (clerkWrap) clerkWrap.classList.remove('hidden');
            if (clerkPrincipalSel) {
                if (myMappings.length > 0 && !myMappings.some(m => m.lawyerUserId === Number(this.state.activeClerkPrincipalLawyerUserId))) {
                    this.state.activeClerkPrincipalLawyerUserId = myMappings[0].lawyerUserId;
                }
                clerkPrincipalSel.innerHTML = myMappings.map(m => `
                    <option value="${m.lawyerUserId}" ${m.lawyerUserId === Number(this.state.activeClerkPrincipalLawyerUserId) ? 'selected' : ''}>
                        ⚖️ ${m.lawyerFullName} (${m.permissions || m.permissionScope || 'ผู้พิมพ์และผู้รับมอบฉันทะ'})
                    </option>
                `).join('');
            }
        } else {
            if (clerkWrap) clerkWrap.classList.add('hidden');
        }

        if (badge && u) {
            const thaiNum = n => window.CourtRenderer ? window.CourtRenderer.toThaiNum(n, true) : n;
            if (u.role === 'Admin') {
                badge.className = 'px-2.5 py-0.5 rounded-md bg-rose-100 text-rose-900 border border-rose-300 text-[11px] font-bold';
                badge.textContent = '🛡️ แอดมินบริการ (เห็นเฉพาะชื่อคดี ไม่ดูข้อมูลคดีทนาย)';
            } else if (u.role === 'Clerk') {
                const principal = this.getEffectiveLawyerAccount();
                const remain = Math.max(0, (principal?.maxCasesQuota || 0) - (principal?.usedCasesCount || 0));
                badge.className = 'px-2.5 py-0.5 rounded-md bg-indigo-100 text-indigo-900 border border-indigo-300 text-[11px] font-bold';
                badge.textContent = `👨‍💼 เสมียนรับผิดชอบคดีของทนาย ${principal?.fullName || '-'} (โควต้า ${thaiNum(principal?.usedCasesCount || 0)}/${thaiNum(principal?.maxCasesQuota || 0)} เหลือ ${thaiNum(remain)})`;
            } else {
                const remain = Math.max(0, u.maxCasesQuota - u.usedCasesCount);
                const clerkCount = this.state.clerkMappings.filter(m => m.lawyerUserId === u.id).length;
                badge.className = remain > 0
                    ? 'px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold'
                    : 'px-2.5 py-0.5 rounded-md bg-rose-100 text-rose-900 border border-rose-300 text-[11px] font-bold';
                badge.textContent = `โควต้าคดีของฉัน ${thaiNum(u.usedCasesCount)}/${thaiNum(u.maxCasesQuota)} คดี (เหลือ ${thaiNum(remain)}) • เสมียนในสังกัด ${thaiNum(clerkCount)} คน`;
            }
        }
    },

    switchActiveAccount(userId) {
        const u = this.state.users.find(x => x.id === Number(userId));
        if (!u) return;
        this.state.currentUser = u;
        if (u.role === 'Clerk') {
            const myLinks = this.state.clerkMappings.filter(m => m.clerkUserId === u.id);
            if (myLinks.length > 0) {
                this.state.activeClerkPrincipalLawyerUserId = myLinks[0].lawyerUserId;
            }
        }
        this.syncActiveCaseToCurrentAccount();
        this.applyRoleBasedNavigation();
        this.renderHeaderAccountBar();
        this.renderAllViews();
        if (u.role === 'Admin') {
            this.showToast(`🛡️ เข้าสู่โหมดแอดมินระบบบริการ (${u.fullName}) — เห็นเฉพาะระบบบริหารบริการและชื่อคดีเท่านั้น`);
        } else {
            this.showToast(`⚖️ สลับเข้าใช้งานบัญชี: ${u.fullName} (แสดงเฉพาะสำนวนคดีของแอคเคาท์นี้)`);
        }
    },

    onSwitchClerkPrincipalLawyer(lawyerUserId) {
        this.state.activeClerkPrincipalLawyerUserId = Number(lawyerUserId);
        const principal = this.getEffectiveLawyerAccount();
        this.syncActiveCaseToCurrentAccount();
        this.renderHeaderAccountBar();
        this.renderAllViews();
        this.showToast(`👨‍💼 สลับปฏิบัติงานรับผิดชอบคดีของทนาย: ${principal?.fullName || ''}`);
    },

    showToast(msg) {
        const el = document.getElementById('toastNotice');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 3200);
    },

    toggleSidebar() {
        document.getElementById('sidebar')?.classList.toggle('open');
    },

    setGlobalRoleFilter(role) {
        this.state.globalRoleFilter = role;
        const btnAll = document.getElementById('roleBtnAll');
        const btnPl = document.getElementById('roleBtnPlaintiff');
        const btnDef = document.getElementById('roleBtnDefendant');

        [btnAll, btnPl, btnDef].forEach(b => {
            if (!b) return;
            b.className = 'text-xs py-1.5 rounded-md font-medium text-slate-300 hover:text-white transition';
        });

        if (role === 'ALL' && btnAll) {
            btnAll.className = 'text-xs py-1.5 rounded-md font-semibold bg-amber-500 text-slate-950 transition';
        } else if (role === 'ทนายโจทก์' && btnPl) {
            btnPl.className = 'text-xs py-1.5 rounded-md font-semibold bg-blue-600 text-white transition';
        } else if (role === 'ทนายจำเลย' && btnDef) {
            btnDef.className = 'text-xs py-1.5 rounded-md font-semibold bg-teal-600 text-white transition';
        }

        this.renderAllViews();
        this.showToast(`กรองการแสดงผลตามบทบาท: ${role === 'ALL' ? 'ทุกบทบาท (เฉพาะคดีของฉัน)' : role}`);
    },

    switchTab(tabName) {
        const isAdmin = this.state.currentUser?.role === 'Admin';
        const lawyerOnlyTabs = ['dashboard', 'cases', 'studio', 'files', 'procedure', 'esign', 'printcenter'];
        if (isAdmin && lawyerOnlyTabs.includes(tabName)) {
            this.showToast('🔒 แอดมินเห็นเฉพาะระบบบริการและชื่อคดีเท่านั้น ไม่สามารถเข้าดูข้อมูลสำนวนคดีของทนายความได้');
            tabName = 'backoffice';
        } else if (!isAdmin && tabName === 'backoffice') {
            this.showToast('🔒 เฉพาะผู้ดูแลระบบบริการ (Admin) เท่านั้น');
            tabName = 'dashboard';
        }

        this.state.activeTab = tabName;
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tabName);
        });

        const views = ['dashboard', 'cases', 'studio', 'files', 'procedure', 'esign', 'printcenter', 'subscription', 'reports', 'backoffice'];
        views.forEach(v => {
            const sec = document.getElementById(`view-${v}`);
            if (sec) sec.classList.toggle('hidden', v !== tabName);
        });

        const effectiveLawyer = this.getEffectiveLawyerAccount();
        const titles = {
            dashboard: [`แดชบอร์ดสำนวนคดีของ ${effectiveLawyer?.fullName || 'ทนายความ'}`, 'แยกแอคเคาท์ทนายความ เห็นเฉพาะคดีของตนเอง พร้อมระบบมอบหมายเสมียนทนายรับผิดชอบคดี'],
            cases: [`สำนวนคดีของ ${effectiveLawyer?.fullName || 'ทนายความ'} & มอบหมายเสมียนรับผิดชอบคดี`, 'แสดงเฉพาะสำนวนคดีที่ทนายความท่านนี้เป็นเจ้าของ พร้อมเพิ่ม/เลือกเสมียนทนายผู้รับผิดชอบแต่ละคดี'],
            studio: ['สตูดิโอร่างคำฟ้อง คำร้อง คำให้การ และแบบพิมพ์ศาล (A4 Live Studio)', 'นำข้อความคำร้องลงแบบฟอร์มศาล จัดบรรทัดไม่ฉีกตัวเลข/วันที่ และเลือกใช้ลายเซ็นอิเล็กทรอนิกส์หรือเว้นว่างเพื่อเซ็นจริง'],
            files: ['คลังไฟล์สำนวนคดีของฉัน & เอกสารอ้างอิงตามสารบัญแบบพิมพ์ศาล (แบบ ๑ – ๑๕)', 'จัดเก็บไฟล์ PDF, รูปภาพ, ลิงก์ไฟล์ และแบบพิมพ์ศาลของสำนวนตนเอง พร้อมป๊อบอัพเปิดอ่าน PDF/รูปภาพ'],
            procedure: ['แผนผังวิธีพิจารณาคดี อาญา · แพ่ง · ทุจริตฯ · ปกครอง', 'ขั้นตอน เอกสาร และวันนัด แยกตามประเภทศาล'],
            esign: ['โปรไฟล์ทนาย & ลายเซ็นอิเล็กทรอนิกส์', 'จัดเก็บข้อมูลทนายและที่อยู่สำหรับเติมแบบพิมพ์ศาล พร้อมวาดหรืออัปโหลดลายเซ็น'],
            printcenter: ['ศูนย์พิมพ์แบบฟอร์มศาลครบชุด (Batch Print & Export)', 'พิมพ์ชุดคำฟ้องหรือชุดคำให้การทั้งสำนวน พร้อมตัวเลือกพิมพ์ลายเซ็นอิเล็กทรอนิกส์ หรือเว้นว่างไว้เซ็นจริง'],
            subscription: ['ระบบสมาชิกทนายความ ทดลองใช้ฟรี ๓ คดี & ซื้อโควต้าคดี / แจ้งสลิปโอนเงิน', 'เลือกแพ็กเกจรายเดือน รายปี หรือซื้อโควต้าจำนวนคดี พร้อมจัดการเสมียนทนายในสังกัด'],
            reports: isAdmin
                ? ['รายงานระบบบริการสำหรับแอดมิน (แสดงเฉพาะชื่อคดีและสถานะโควต้า)', 'แอดมินเห็นเฉพาะชื่อคดีเพื่อการบริหารโควต้า ไม่สามารถดูรายละเอียดสำนวนคดีของทนายความได้']
                : [`รายงานสรุปสำนวนคดีของ ${effectiveLawyer?.fullName || 'ทนายความ'}`, 'สรุปข้อมูลสำนวนคดีของตนเอง ทุนทรัพย์ และสถานะการยื่นคำคู่ความ'],
            backoffice: ['ระบบบริหารจัดการบริการ (Admin Service Management — เห็นเฉพาะชื่อคดี)', 'จัดการสมาชิกทนายความ ตรวจสอบสลิปโอนเงิน ตั้งราคาแพ็กเกจ และดูทะเบียนชื่อคดีโดยไม่เข้าถึงข้อมูลความลับทนาย']
        };

        if (titles[tabName]) {
            document.getElementById('pageHeaderTitle').textContent = titles[tabName][0];
            document.getElementById('pageHeaderSubtitle').textContent = titles[tabName][1];
        }

        if (tabName === 'studio') {
            this.populateStudioDropdowns();
            this.syncEditorToPreview();
        } else if (tabName === 'printcenter') {
            this.populatePrintCenterDropdown();
        } else if (tabName === 'files') {
            this.populateFilesFilterDropdowns();
            this.renderFilesDirectoryView();
        } else if (tabName === 'subscription') {
            this.renderSubscriptionView();
        } else if (tabName === 'backoffice') {
            this.renderBackofficeView();
        } else if (tabName === 'esign') {
            this.loadLawyerProfileSettings();
        }

        document.getElementById('sidebar')?.classList.remove('open');
        if (window.lucide) lucide.createIcons();
    },

    getFilteredCases() {
        return this.getAccessibleCases().filter(c => {
            if (this.state.globalRoleFilter !== 'ALL' && !c.lawyerRole.includes(this.state.globalRoleFilter.replace('ทนาย', ''))) {
                return false;
            }
            if (this.state.caseCategoryFilter !== 'ALL' && c.caseCategory !== this.state.caseCategoryFilter) {
                return false;
            }
            const q = (document.getElementById('caseSearchInput')?.value || '').trim().toLowerCase();
            if (q) {
                const hay = `${c.blackCaseNo} ${c.plaintiffName} ${c.defendantName} ${c.chargeOrCauseOfAction} ${c.courtName}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    },

    renderAllViews() {
        this.applyRoleBasedNavigation();
        this.renderHeaderAccountBar();
        this.renderDashboardView();
        this.renderCasesView();
        this.populateStudioDropdowns();
        this.populateFilesFilterDropdowns();
        this.renderFilesDirectoryView();
        this.renderProcedureWorkflowView();
        this.renderSignaturesGallery();
        this.renderSubscriptionView();
        this.renderReportsView();
        this.renderBackofficeView();
        if (window.lucide) lucide.createIcons();
    },

    async loadLawyerProfileSettings() {
        try {
            const profileId = Number(this.state.currentUser?.lawyerProfileId || 0);
            if (!profileId) throw new Error('ไม่พบบัญชีโปรไฟล์ทนายความ');

            const response = await fetch('/api/lawyers');
            if (!response.ok) throw new Error(`โหลดโปรไฟล์ไม่สำเร็จ (HTTP ${response.status})`);
            const profiles = await response.json();
            const profile = profiles.find(p => Number(p.id) === profileId);
            if (!profile) throw new Error('ไม่พบข้อมูลโปรไฟล์ทนายความ');

            this.state.lawyerProfile = profile;
            document.querySelectorAll('#lawyerProfileSettings [data-lawyer-profile-field]').forEach(input => {
                input.value = profile[input.dataset.lawyerProfileField] ?? '';
            });
        } catch (error) {
            console.error('โหลดโปรไฟล์ทนายไม่สำเร็จ', error);
            this.showToast(error.message || 'โหลดโปรไฟล์ทนายไม่สำเร็จ');
        }
    },

    async saveLawyerProfileSettings() {
        try {
            const profileId = Number(this.state.currentUser?.lawyerProfileId || 0);
            if (!profileId) throw new Error('ไม่พบบัญชีโปรไฟล์ทนายความ');
            const payload = { ...(this.state.lawyerProfile || {}) };
            document.querySelectorAll('#lawyerProfileSettings [data-lawyer-profile-field]').forEach(input => {
                payload[input.dataset.lawyerProfileField] = input.value.trim();
            });

            const response = await fetch(`/api/lawyers/${profileId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`บันทึกโปรไฟล์ไม่สำเร็จ (HTTP ${response.status})`);

            const profile = await response.json();
            this.state.lawyerProfile = profile;
            const profileIndex = this.state.lawyers.findIndex(p => Number(p.id) === profileId);
            if (profileIndex >= 0) this.state.lawyers[profileIndex] = profile;
            this.state.users.filter(u => Number(u.lawyerProfileId) === profileId).forEach(user => {
                user.fullName = profile.fullName;
                user.licenseNo = profile.licenseNo;
                user.citizenId = profile.citizenId;
                user.phone = profile.phone;
                user.officeName = profile.officeName;
            });
            this.showToast('บันทึกโปรไฟล์ทนายและที่อยู่เรียบร้อยแล้ว');
        } catch (error) {
            console.error('บันทึกโปรไฟล์ทนายไม่สำเร็จ', error);
            this.showToast(error.message || 'บันทึกโปรไฟล์ทนายไม่สำเร็จ');
        }
    },

    // ==================== 1. DASHBOARD VIEW (เฉพาะคดีของทนายความเจ้าของบัญชี) ====================
    renderDashboardView() {
        const cases = this.getAccessibleCases();
        const docs = this.getAccessibleDocuments();
        const effectiveLawyer = this.getEffectiveLawyerAccount();
        const crimCount = cases.filter(c => c.caseCategory === 'อาญา').length;
        const civCount = cases.filter(c => c.caseCategory === 'แพ่ง').length;
        const plRoleCount = cases.filter(c => c.lawyerRole.includes('โจทก์')).length;
        const defRoleCount = cases.filter(c => c.lawyerRole.includes('จำเลย')).length;

        const kpiGrid = document.getElementById('dashboardKpiGrid');
        if (kpiGrid) {
            kpiGrid.innerHTML = `
                <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <div class="text-xs font-semibold text-slate-500">สำนวนคดีของฉัน (${effectiveLawyer?.fullName || ''})</div>
                        <div class="text-2xl font-extrabold text-slate-900 mt-1">${cases.length} สำนวน</div>
                        <div class="text-xs text-slate-600 mt-1">อาญา <strong class="text-rose-600">${crimCount}</strong> | แพ่ง <strong class="text-indigo-600">${civCount}</strong></div>
                    </div>
                    <div class="w-12 h-12 rounded-2xl bg-slate-900 text-amber-400 flex items-center justify-center font-bold text-xl">📁</div>
                </div>
                <div class="bg-white rounded-2xl p-5 border border-blue-200 shadow-sm flex items-center justify-between">
                    <div>
                        <div class="text-xs font-semibold text-blue-700">คดีที่เป็น ทนายโจทก์</div>
                        <div class="text-2xl font-extrabold text-blue-950 mt-1">${plRoleCount} คดี</div>
                        <div class="text-xs text-slate-600 mt-1">คำฟ้อง, ท้ายฟ้องแพ่ง, ปิดหมาย, หมายเรียก</div>
                    </div>
                    <div class="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xl">⚔️</div>
                </div>
                <div class="bg-white rounded-2xl p-5 border border-teal-200 shadow-sm flex items-center justify-between">
                    <div>
                        <div class="text-xs font-semibold text-teal-700">คดีที่เป็น ทนายจำเลย</div>
                        <div class="text-2xl font-extrabold text-teal-950 mt-1">${defRoleCount} คดี</div>
                        <div class="text-xs text-slate-600 mt-1">คำให้การ, บัญชีพยาน, คำแถลงปิดคดี</div>
                    </div>
                    <div class="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center font-bold text-xl">🛡️</div>
                </div>
                <div class="bg-white rounded-2xl p-5 border border-amber-200 shadow-sm flex items-center justify-between">
                    <div>
                        <div class="text-xs font-semibold text-amber-800">เอกสารแบบพิมพ์ศาลในคดีของฉัน</div>
                        <div class="text-2xl font-extrabold text-slate-900 mt-1">${docs.length} ฉบับ</div>
                        <div class="text-xs text-emerald-700 font-medium mt-1">พร้อมพิมพ์ A4 & ส่งออก Word</div>
                    </div>
                    <div class="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-xl">📜</div>
                </div>
            `;
        }

        // แสดงการ์ดตัวอย่างเฉพาะคดีที่เป็นของแอคเคาท์ทนายความที่กำลังล็อกอิน
        const hasCase1 = cases.some(c => c.id === 1);
        const hasCase2 = cases.some(c => c.id === 2);
        const card1El = document.getElementById('dashboardHighlightCase1Card');
        const card2El = document.getElementById('dashboardHighlightCase2Card');
        const hlGrid = document.getElementById('dashboardHighlightedCasesGrid');
        if (card1El) card1El.classList.toggle('hidden', !hasCase1);
        if (card2El) card2El.classList.toggle('hidden', !hasCase2);
        if (hlGrid) {
            hlGrid.className = (hasCase1 && hasCase2)
                ? 'grid grid-cols-1 lg:grid-cols-2 gap-5'
                : 'grid grid-cols-1 gap-5';
        }

        const c1Docs = docs.filter(d => d.caseId === 1);
        const c2Docs = docs.filter(d => d.caseId === 2);

        const c1El = document.getElementById('case1QuickDocs');
        if (c1El) {
            c1El.innerHTML = c1Docs.map(d => `
                <button onclick="App.openDocInStudio(${d.id})" class="px-2.5 py-1 rounded-lg bg-white border border-teal-300 hover:bg-teal-600 hover:text-white text-teal-900 text-xs font-semibold transition shadow-sm">
                    ${d.formCode} ${d.documentTitle}
                </button>
            `).join('');
        }

        const c2El = document.getElementById('case2QuickDocs');
        if (c2El) {
            c2El.innerHTML = c2Docs.map(d => `
                <button onclick="App.openDocInStudio(${d.id})" class="px-2.5 py-1 rounded-lg bg-white border border-blue-300 hover:bg-blue-600 hover:text-white text-blue-900 text-xs font-semibold transition shadow-sm">
                    ${d.formCode} ${d.documentTitle}
                </button>
            `).join('');
        }

        // Recent Documents Table (เฉพาะคดีของทนายท่านนี้)
        const docsTable = document.getElementById('dashboardDocsTable');
        if (docsTable) {
            docsTable.innerHTML = `
                <table class="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr class="border-b border-slate-200 text-slate-500">
                            <th class="py-2.5 px-3">แบบพิมพ์</th>
                            <th class="py-2.5 px-3">ชื่อคำคู่ความ / คำร้อง</th>
                            <th class="py-2.5 px-3">สำนวนคดีของฉัน</th>
                            <th class="py-2.5 px-3">บทบาททนายความ</th>
                            <th class="py-2.5 px-3">ผู้เรียง / เสมียนผู้พิมพ์</th>
                            <th class="py-2.5 px-3 text-right">จัดการ / พิมพ์</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${docs.map(d => {
                            const c = cases.find(x => x.id === d.caseId);
                            const isPlaintiff = (d.lawyerRoleInDoc || '').includes('โจทก์');
                            return `
                            <tr class="hover:bg-slate-50">
                                <td class="py-2.5 px-3 font-bold text-amber-700">${d.formCode}</td>
                                <td class="py-2.5 px-3 font-semibold text-slate-900">${d.documentTitle}</td>
                                <td class="py-2.5 px-3 text-slate-600">${c ? `${c.caseCategory} (${c.blackCaseNo}/๒๕${c.blackCaseYear})` : '-'}</td>
                                <td class="py-2.5 px-3">
                                    <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold ${isPlaintiff ? 'bg-blue-100 text-blue-800' : 'bg-teal-100 text-teal-800'}">
                                        ${d.lawyerRoleInDoc || '-'}
                                    </span>
                                </td>
                                <td class="py-2.5 px-3 text-slate-500">${d.drafterName || '-'} / ${d.typistName || '-'}</td>
                                <td class="py-2.5 px-3 text-right space-x-1">
                                    <button onclick="App.openDocInStudio(${d.id})" class="px-2.5 py-1 rounded bg-slate-900 text-white font-semibold hover:bg-slate-700">เปิดแก้ไข/พิมพ์</button>
                                    <a href="/api/documents/${d.id}/export-docx" class="inline-block px-2 py-1 rounded bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100">.docx</a>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }

        // Templates List
        const tplList = document.getElementById('dashboardTemplatesList');
        if (tplList) {
            tplList.innerHTML = this.state.templates.map(t => `
                <div class="p-3 rounded-xl border border-slate-200 hover:border-amber-400 bg-slate-50/60 flex items-start justify-between gap-2 transition">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded bg-slate-900 text-amber-300 font-bold text-xs">${t.formCode}</span>
                            <span class="font-bold text-xs text-slate-900">${t.formName}</span>
                        </div>
                        <div class="text-[11px] text-slate-500 mt-1">${t.proceduralLawRef} • สำหรับ: <strong>${t.applicableRole}</strong></div>
                    </div>
                    <button onclick="App.createNewDocFromTemplate(${t.id})" class="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px]">
                        ใช้ฟอร์มนี้
                    </button>
                </div>
            `).join('');
        }
    },

    // ==================== 2. CASES VIEW (เฉพาะคดีของทนายตนเอง + มอบหมายเสมียนรับผิดชอบคดี) ====================
    filterCases(cat) {
        this.state.caseCategoryFilter = cat;
        this.renderCasesView();
    },

    async assignClerkToCase(caseId, clerkProfileId) {
        const cid = Number(caseId);
        const targetCase = this.state.cases.find(c => c.id === cid);
        if (!targetCase) return;
        const res = await fetch(`/api/cases/${cid}/clerk`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clerkId: Number(clerkProfileId || 0) })
        });
        if (res.ok) {
            const clerkProfile = this.state.lawyers.find(l => l.id === Number(clerkProfileId));
            await this.loadDashboardData();
            this.renderCasesView();
            this.showToast(`👨‍💼 มอบหมายเสมียนทนาย "${clerkProfile?.fullName || 'ไม่ระบุ'}" รับผิดชอบสำนวนคดี ${targetCase.blackCaseNo}/๒๕${targetCase.blackCaseYear} เรียบร้อยแล้ว`);
        }
    },

    renderCasesView() {
        const container = document.getElementById('casesCardsContainer');
        if (!container) return;
        const list = this.getFilteredCases();
        const effectiveLawyer = this.getEffectiveLawyerAccount();
        const myClerks = (this.state.clerkMappings || []).filter(m => m.lawyerUserId === effectiveLawyer?.id);

        if (list.length === 0) {
            container.innerHTML = `
                <div class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
                    <div class="text-sm font-bold text-slate-800">ไม่พบสำนวนคดีของแอคเคาท์ ${effectiveLawyer?.fullName || ''} ในหมวดที่เลือก</div>
                    <p class="text-xs text-slate-500">ทนายความแต่ละแอคเคาท์จะเห็นเฉพาะสำนวนคดีที่ตนเองเป็นเจ้าของเท่านั้น สามารถกด "+ เพิ่มสำนวนคดี" เพื่อสร้างคดีใหม่ของท่านได้ทันที</p>
                    <button onclick="App.openNewCaseModal()" class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs">+ เปิดสำนวนคดีใหม่ของฉัน</button>
                </div>
            `;
            return;
        }

        container.innerHTML = list.map(c => {
            const caseDocs = this.state.documents.filter(d => d.caseId === c.id);
            const isCrim = c.caseCategory === 'อาญา';
            const isPl = c.lawyerRole.includes('โจทก์');
            const ownerLawyer = this.state.lawyers.find(l => Number(l.id) === Number(c.primaryLawyerId));
            return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
                <div>
                    <div class="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 ${isCrim ? 'bg-rose-50/60' : 'bg-indigo-50/60'}">
                        <div class="flex items-center gap-2">
                            <span class="px-2.5 py-0.5 rounded-md text-xs font-bold ${isCrim ? 'bg-rose-600 text-white' : 'bg-indigo-600 text-white'}">
                                คดี${c.caseCategory}
                            </span>
                            <span class="px-2.5 py-0.5 rounded-md text-xs font-bold ${isPl ? 'bg-blue-100 text-blue-900 border border-blue-300' : 'bg-teal-100 text-teal-900 border border-teal-300'}">
                                ฐานะ: ${c.lawyerRole} (${c.representingPartyOrder || ''})
                            </span>
                        </div>
                        <span class="text-xs font-bold text-slate-700">ศาล${c.courtName} • คดีดำที่ ${c.blackCaseNo}/๒๕${c.blackCaseYear}</span>
                    </div>

                    <div class="p-5 space-y-3">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                            <div><span class="text-slate-400">โจทก์:</span> <strong class="text-slate-900">${c.plaintiffName}</strong></div>
                            <div><span class="text-slate-400">จำเลย:</span> <strong class="text-slate-900">${c.defendantName}</strong></div>
                            <div class="sm:col-span-2"><span class="text-slate-400">ข้อหา/ฐานความผิด:</span> <span class="font-medium text-slate-800">${c.chargeOrCauseOfAction}</span></div>
                            ${c.claimAmount > 0 ? `<div class="sm:col-span-2"><span class="text-slate-400">ทุนทรัพย์:</span> <strong class="text-emerald-700">${c.claimAmount.toLocaleString()} บาท (ดอกเบี้ยร้อยละ ${c.interestRate} ต่อปี)</strong></div>` : ''}
                            <div class="sm:col-span-2 pt-1 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                                <span><span class="text-slate-400">ทนายเจ้าของสำนวน:</span> <strong class="text-blue-900">⚖️ ${ownerLawyer?.fullName || effectiveLawyer?.fullName || '-'}</strong></span>
                            </div>
                        </div>

                        <!-- ส่วนตั้งและมอบหมายแอคเคาท์เสมียนทนายในการรับผิดชอบคดีที่ตนเองสร้าง -->
                        <div class="bg-teal-50/70 border border-teal-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div class="flex items-center gap-1.5 font-bold text-teal-950">
                                <span>👨‍💼 เสมียนทนายผู้รับผิดชอบคดีนี้:</span>
                            </div>
                            <div class="flex flex-wrap items-center gap-1.5">
                                <select onchange="App.assignClerkToCase(${c.id}, this.value)" class="px-2.5 py-1 rounded-lg border border-teal-300 bg-white text-xs font-bold text-teal-950">
                                    <option value="0">-- ยังไม่ระบุเสมียนรับผิดชอบ --</option>
                                    ${myClerks.map(m => `
                                        <option value="${m.clerkProfileId}" ${Number(c.clerkId) === Number(m.clerkProfileId) ? 'selected' : ''}>
                                            👨‍💼 ${m.clerkFullName} (@${m.clerkUsername || 'clerk'})
                                        </option>
                                    `).join('')}
                                </select>
                                <button onclick="App.openManageClerkModal(${effectiveLawyer?.id || 'null'})" class="px-2.5 py-1 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-[11px] font-bold">
                                    + เพิ่มแอคเคาท์เสมียน
                                </button>
                            </div>
                        </div>

                        <p class="text-xs text-slate-600 leading-relaxed">${c.caseSummary || ''}</p>

                        <div class="space-y-1.5">
                            <div class="text-xs font-bold text-slate-800">คำคู่ความและแบบพิมพ์ศาลในสำนวนนี้ (${caseDocs.length} ฉบับ):</div>
                            <div class="flex flex-wrap gap-1.5">
                                ${caseDocs.map(d => `
                                    <button onclick="App.openDocInStudio(${d.id})" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-800 text-xs font-medium transition">
                                        ${d.formCode} ${d.documentTitle}
                                    </button>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="px-5 py-3 bg-slate-50 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span class="text-slate-500">ขั้นตอน: <strong>${c.currentProceduralStage || c.status}</strong></span>
                    <div class="flex items-center gap-2">
                        <button onclick="App.openCaseFilesDirectory(${c.id})" class="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-900 border border-indigo-200 font-semibold hover:bg-indigo-100">
                            📂 คลังไฟล์สารบัญสำนวน (${this.state.caseFiles.filter(f => f.caseId === c.id).length})
                        </button>
                        <button onclick="App.selectCaseAndOpenStudio(${c.id})" class="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800">
                            จัดการคำร้อง/พิมพ์ฟอร์ม →
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    // ==================== 3. COURT FORM STUDIO ====================
    populateStudioDropdowns() {
        const myCases = this.getAccessibleCases();
        const caseSel = document.getElementById('studioCaseSelect');
        if (caseSel) {
            caseSel.innerHTML = myCases.map(c => `
                <option value="${c.id}" ${c.id === Number(this.state.currentCaseId) ? 'selected' : ''}>
                    [${c.caseCategory} - ${c.lawyerRole}] ${c.blackCaseNo}/๒๕${c.blackCaseYear} (${c.plaintiffName} vs ${c.defendantName})
                </option>
            `).join('');
        }

        const caseDocs = this.getAccessibleDocuments().filter(d => d.caseId === Number(this.state.currentCaseId));
        const docSel = document.getElementById('studioDocSelect');
        if (docSel) {
            docSel.innerHTML = caseDocs.map(d => `
                <option value="${d.id}" ${this.state.currentDoc?.id === d.id ? 'selected' : ''}>
                    ${d.formCode} ${d.documentTitle}
                </option>
            `).join('') + `<option value="NEW">+ สร้างเอกสารใหม่ในสำนวนนี้...</option>`;
        }

        const tplSel = document.getElementById('studioTemplateSelect');
        if (tplSel) {
            tplSel.innerHTML = `<option value="">-- เลือกแม่แบบฟอร์มศาลเพื่อเปลี่ยนโครงสร้าง --</option>` +
                this.state.templates.map(t => `<option value="${t.id}">${t.formCode} ${t.formName} (${t.applicableRole})</option>`).join('');
        }

        const sigSel = document.getElementById('edSignatureSelect');
        if (sigSel) {
            sigSel.innerHTML =
                `<option value="">-- เลือกลายเซ็นอิเล็กทรอนิกส์ --</option>` +
                `<option value="NONE">🖨️ เว้นว่างไว้เพื่อให้ผู้เซ็นเซ็นจริงในเอกสารที่สั่งพิมพ์ (ไม่แสดงลายเซ็น)</option>` +
                this.state.signatures.map(s => `<option value="${s.id}">✍️ ${s.signerName} (${s.signerRole})</option>`).join('');
        }

        const clerkSel = document.getElementById('edAssignedClerkSelect');
        if (clerkSel) {
            const effectiveLawyer = this.getEffectiveLawyerAccount();
            let myClerks = (this.state.clerkMappings || []).filter(m => m.lawyerUserId === effectiveLawyer?.id);
            if (myClerks.length === 0) {
                myClerks = this.state.clerkMappings || [];
            }
            clerkSel.innerHTML = `<option value="">-- เลือกเสมียนในสังกัดทนาย (${myClerks.length} คน) --</option>` +
                myClerks.map(m => `
                    <option value="${m.clerkProfileId}" data-name="${m.clerkFullName}">
                        ${(m.isDefaultTypist || m.isDefaultClerk) ? '★ ' : ''}${m.clerkFullName} (เสมียนของ ${m.lawyerFullName})
                    </option>
                `).join('');
        }

        this.populateFormCodeDropdownWithStats('edFormCode', this.state.currentCaseId, {
            include11Kor: true,
            defaultValue: this.state.currentDoc?.formCode || '(๗)'
        });
    },

    onSelectAssignedClerkInStudio(clerkProfileId) {
        if (!clerkProfileId) return;
        const p = this.state.lawyers.find(l => l.id === Number(clerkProfileId));
        const mapping = this.state.clerkMappings.find(m => m.clerkProfileId === Number(clerkProfileId));
        const clerkName = p?.fullName || mapping?.clerkFullName || '';
        if (!clerkName) return;

        const typistEl = document.getElementById('edTypistName');
        if (typistEl) typistEl.value = clerkName;
        if (this.state.currentDoc) {
            this.state.currentDoc.typistName = clerkName;
            if (p?.signatureDataUrl) {
                this.state.currentDoc.typistSignatureBase64 = p.signatureDataUrl;
            }
        }
        this.syncEditorToPreview();
        this.showToast(`👨‍💼 เลือกเสมียนทนาย "${clerkName}" เป็นผู้พิมพ์พร้อมแนบลายเซ็นอิเล็กทรอนิกส์แล้ว`);
    },

    selectCaseAndOpenStudio(caseId) {
        if (this.state.currentUser?.role === 'Admin') {
            this.showToast('🔒 แอดมินไม่สามารถเข้าดูข้อมูลสำนวนคดีของทนายความได้');
            return;
        }
        this.state.currentCaseId = Number(caseId);
        const docs = this.getAccessibleDocuments().filter(d => d.caseId === this.state.currentCaseId);
        if (docs.length > 0) {
            this.loadDocumentIntoEditorState(docs[0]);
        }
        this.switchTab('studio');
    },

    openDocInStudio(docId) {
        if (this.state.currentUser?.role === 'Admin') {
            this.showToast('🔒 แอดมินไม่สามารถเปิดดูเอกสารคำคู่ความของทนายความได้');
            return;
        }
        const doc = this.getAccessibleDocuments().find(d => d.id === Number(docId));
        if (!doc) return;
        this.state.currentCaseId = doc.caseId;
        this.loadDocumentIntoEditorState(doc);
        this.switchTab('studio');
    },

    onStudioCaseChange(caseId) {
        this.state.currentCaseId = Number(caseId);
        const docs = this.getAccessibleDocuments().filter(d => d.caseId === this.state.currentCaseId);
        if (docs.length > 0) {
            this.loadDocumentIntoEditorState(docs[0]);
        } else {
            this.openStudioForNewDoc();
        }
        this.populateStudioDropdowns();
        this.syncEditorToPreview();
    },

    onStudioDocChange(val) {
        if (val === 'NEW') {
            this.openStudioForNewDoc();
            return;
        }
        const doc = this.getAccessibleDocuments().find(d => d.id === Number(val));
        if (doc) {
            this.loadDocumentIntoEditorState(doc);
            this.syncEditorToPreview();
        }
    },

    onStudioTemplateChange(tplId) {
        if (!tplId) return;
        this.createNewDocFromTemplate(Number(tplId));
    },

    createNewDocFromTemplate(tplId) {
        const tpl = this.state.templates.find(t => t.id === Number(tplId));
        if (!tpl) return;
        const accessibleCases = this.getAccessibleCases();
        const lawCase = accessibleCases.find(c => c.id === Number(this.state.currentCaseId)) || accessibleCases[0];
        const isDef = lawCase?.lawyerRole?.includes('จำเลย');
        const effectiveLawyer = this.state.currentUser;
        if (!lawCase || !effectiveLawyer || effectiveLawyer.role === 'Admin') return this.showToast('กรุณาเลือกคดีที่มีสิทธิ์ก่อน');
        const defaultLawyer = this.state.lawyers.find(l => l.id === effectiveLawyer?.lawyerProfileId);
        const caseLawyer = this.state.lawyers.find(l => Number(l.id) === Number(lawCase.primaryLawyerId));
        const clerk = effectiveLawyer?.role === 'Clerk' ? defaultLawyer : null;
        const isAppointmentForm9 = tpl.formCode === '(๙)';
        const emptyRequesterFields = isAppointmentForm9 ? {
            docDay: '', docMonth: '', docYear: '',
            requesterFullName: '',
            requesterStatus: '',
            requesterCitizenId: '',
            requesterOccupation: '',
            requesterAge: '',
            requesterHouseNo: '',
            requesterMoo: '',
            requesterRoad: '',
            requesterSoi: '',
            requesterNearBy: '',
            requesterSubDistrict: '',
            requesterDistrict: '',
            requesterProvince: '',
            requesterPostalCode: '',
            requesterPhone: ''
        } : {};
        const form9Extra = isAppointmentForm9
            ? { Form9Lawyer: this.toForm9LawyerProfile(caseLawyer) || {} }
            : {};

        let defaultClauses = [];
        try { defaultClauses = JSON.parse(tpl.defaultClausesJson || '[]'); } catch { defaultClauses = []; }
        if (tpl.formCode === '(๑๕)' && defaultClauses.length === 0) {
            defaultClauses = [
                { OrderNo: 1, WitnessNameAndDesc: isDef ? 'จำเลยอ้างตนเองเป็นพยาน' : 'โจทก์อ้างตนเองเป็นพยาน', AddressText: 'ตามคำฟ้อง/คำให้การ', Note: 'นำ' },
                { OrderNo: 2, WitnessNameAndDesc: 'พยานเอกสารตามสำเนาท้ายคำคู่ความ', AddressText: '-', Note: 'นำ' }
            ];
        }

        const newDoc = {
            id: 0,
            caseId: lawCase?.id || 1,
            templateId: tpl.id,
            formCode: tpl.formCode,
            documentTitle: tpl.defaultHeaderTitle || tpl.formName,
            lawyerRoleInDoc: lawCase?.representingPartyOrder ? 'ทนาย'+lawCase.representingPartyOrder : lawCase?.lawyerRole || 'ทนายโจทก์',
            docDay: '๑๔',
            docMonth: 'พฤศจิกายน',
            docYear: '๖๙',
            requesterFullName: defaultLawyer?.fullName || '',
            requesterStatus: lawCase?.representingPartyOrder ? 'ทนาย'+lawCase.representingPartyOrder : lawCase?.lawyerRole || 'ทนายความ',
            requesterCitizenId: defaultLawyer?.citizenId || '',
            requesterRace: 'ไทย',
            requesterNationality: 'ไทย',
            requesterOccupation: 'ทนายความ',
            requesterAge: defaultLawyer?.age || '-',
            requesterHouseNo: defaultLawyer?.houseNo || '',
            requesterMoo: defaultLawyer?.moo || '-',
            requesterRoad: defaultLawyer?.road || '-',
            requesterSoi: '-',
            requesterNearBy: '-',
            requesterSubDistrict: defaultLawyer?.subDistrict || '',
            requesterDistrict: defaultLawyer?.district || '',
            requesterProvince: defaultLawyer?.province || 'ศรีสะเกษ',
            requesterPostalCode: defaultLawyer?.postalCode || '๓๓๐๐๐',
            requesterPhone: defaultLawyer?.phone || '-',
            clausesJson: JSON.stringify(defaultClauses),
            extraFieldsJson: JSON.stringify(form9Extra),
            closingPrayer: tpl.formCode === '(๔)' ? 'ควรมิควรแล้วแต่จะโปรด' : window.CourtRenderer.normalizeClosingPrayer(tpl.defaultClosingText),
            signerName: isAppointmentForm9 ? '' : defaultLawyer?.fullName || '',
            signerRole: isAppointmentForm9 ? '' : lawCase?.representingPartyOrder ? 'ทนาย'+lawCase.representingPartyOrder : lawCase?.lawyerRole || 'ทนายความ',
            drafterName: isAppointmentForm9 ? caseLawyer?.fullName || defaultLawyer?.fullName || '' : defaultLawyer?.fullName || '',
            typistName: clerk?.fullName || '',
            signatureImageBase64: isAppointmentForm9 ? '' : defaultLawyer?.signatureDataUrl || '',
            drafterSignatureBase64: isAppointmentForm9 ? caseLawyer?.signatureDataUrl || '' : defaultLawyer?.signatureDataUrl || '',
            typistSignatureBase64: clerk?.signatureDataUrl || '',
            useThaiNumerals: true,
            status: 'ร่าง'
        };
        Object.assign(newDoc, emptyRequesterFields);

        this.loadDocumentIntoEditorState(newDoc);
        this.switchTab('studio');
        this.showToast(`โหลดแม่แบบศาล ${tpl.formCode} ${tpl.formName} เรียบร้อยแล้ว`);
    },

    openStudioForNewDoc() {
        const firstTpl = this.state.templates.find(t => t.formCode === '(๗)') || this.state.templates[0];
        if (firstTpl) {
            this.createNewDocFromTemplate(firstTpl.id);
        }
    },

    loadDocumentIntoEditorState(doc) {
        this.state.currentDoc = { ...doc };
        try {
            this.state.currentClauses = JSON.parse(doc.clausesJson || '[]');
        } catch {
            this.state.currentClauses = [];
        }

        let extra = {};
        try {
            extra = JSON.parse(doc.extraFieldsJson || '{}') || {};
        } catch {
            extra = {};
        }

        const lawCase = this.state.cases.find(c => c.id === Number(doc.caseId || this.state.currentCaseId)) || {};

        const setVal = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.value = v ?? '';
        };

        setVal('edFormCode', doc.formCode || '(๗)');
        const isDefenseForm = ['(๑๑)', '(๑๑ ก.)'].includes(doc.formCode);
        const legacyTextStyle = this.state.currentClauses.find(c => c.FontFamily || c.FontSize) || {};
        setVal('edClauseTextFontFamily', extra.TextFontFamily || legacyTextStyle.FontFamily || (isDefenseForm ? 'th-sarabun-new' : 'sarabun'));
        setVal('edClauseTextFontSize', extra.TextFontSize || legacyTextStyle.FontSize || (isDefenseForm ? 16 : 14));
        setVal('edDocumentTitle', doc.documentTitle || '');
        setVal('edDocDay', doc.docDay || '');
        setVal('edDocMonth', doc.docMonth || '');
        setVal('edDocYear', doc.docYear || '');

        const blackNo = extra.BlackCaseNo !== undefined ? extra.BlackCaseNo : (lawCase.blackCaseNo || '');
        let blackYear = extra.BlackCaseYear !== undefined ? extra.BlackCaseYear : (lawCase.blackCaseYear || '');
        if (blackYear.startsWith('๒๕')) blackYear = blackYear.substring(2);
        else if (blackYear.startsWith('25') && blackYear.length === 4) blackYear = blackYear.substring(2);

        const redNo = extra.RedCaseNo !== undefined ? extra.RedCaseNo : (lawCase.redCaseNo || '');
        let redYear = extra.RedCaseYear !== undefined ? extra.RedCaseYear : (lawCase.redCaseYear || '');
        if (redYear.startsWith('๒๕')) redYear = redYear.substring(2);
        else if (redYear.startsWith('25') && redYear.length === 4) redYear = redYear.substring(2);

        setVal('edBlackCaseNo', blackNo);
        setVal('edBlackCaseYear', blackYear);
        setVal('edRedCaseNo', redNo);
        setVal('edRedCaseYear', redYear);

        setVal('edRequesterFullName', doc.requesterFullName || '');
        setVal('edRequesterStatus', doc.requesterStatus || '');
        setVal('edRequesterCitizenId', doc.requesterCitizenId || '');
        setVal('edRequesterOccupation', doc.requesterOccupation || '');
        setVal('edRequesterAge', doc.requesterAge || '');
        setVal('edRequesterHouseNo', doc.requesterHouseNo || '');
        setVal('edRequesterMoo', doc.requesterMoo || '');
        setVal('edRequesterRoad', doc.requesterRoad || '');
        setVal('edRequesterSubDistrict', doc.requesterSubDistrict || '');
        setVal('edRequesterDistrict', doc.requesterDistrict || '');
        setVal('edRequesterProvince', doc.requesterProvince || '');
        setVal('edRequesterPostalCode', doc.requesterPostalCode || '');
        setVal('edRequesterPhone', doc.requesterPhone || '');
        setVal('edSignerName', doc.signerName || '');
        setVal('edSignerRole', (doc.signerRole || '').replaceAll('(ผู้จัดทำร่างหมายเรียก)', '').trim());
        setVal('edDrafterName', doc.drafterName || '');
        setVal('edTypistName', doc.typistName || '');
        const legacyClosing = ['เพื่อดำเนินกระบวนพิจารณาต่อไปตามหน้าที่ในกฎหมาย', 'ซึ่งเป็นวันสืบพยานด้วย'];
        setVal('edClosingPrayer', doc.formCode === '(๔)' && !extra.CustomClosingPrayer && legacyClosing.includes((doc.closingPrayer || '').trim())
            ? 'ควรมิควรแล้วแต่จะโปรด' : (doc.closingPrayer || 'ควรมิควรแล้วแต่จะโปรด'));

        const chk = document.getElementById('edUseThaiNumerals');
        if (chk) chk.checked = doc.useThaiNumerals !== false;

        // Detect or load "ขอศาลได้โปรดอนุญาต" toggle & text
        const extractedPerm = window.CourtRenderer?.extractPermissionParagraph
            ? window.CourtRenderer.extractPermissionParagraph(this.state.currentClauses, {})
            : null;
        const showPermEl = document.getElementById('edShowPermission');
        const permTextEl = document.getElementById('edPermissionText');
        if (showPermEl) {
            if (typeof extra.ShowPermission === 'boolean') {
                showPermEl.checked = extra.ShowPermission;
            } else {
                showPermEl.checked = false;
            }
        }
        if (permTextEl) {
            permTextEl.value = (typeof extra.PermissionText === 'string' && extra.PermissionText.trim() && extra.PermissionText !== '[object Object]')
                ? extra.PermissionText : (extractedPerm?.extractedText || 'ขอศาลได้โปรดอนุญาต');
        }

        // Load Electronic vs Wet Signature mode & individual toggles
        const signingMode = extra.SigningMode || 'ELECTRONIC';
        const sigModeEl = document.getElementById('edSigningModeSelect');
        if (sigModeEl) sigModeEl.value = signingMode;

        const mainChk = document.getElementById('edShowMainSigChk');
        const drafterChk = document.getElementById('edShowDrafterSigChk');
        const typistChk = document.getElementById('edShowTypistSigChk');
        if (mainChk) mainChk.checked = extra.ShowMainElectronicSig !== false;
        if (drafterChk) drafterChk.checked = extra.ShowDrafterElectronicSig !== false;
        if (typistChk) typistChk.checked = extra.ShowTypistElectronicSig !== false;

        const togglesBox = document.getElementById('edIndividualSigToggles');
        if (togglesBox) {
            togglesBox.classList.toggle('opacity-50', signingMode === 'WET_SIGNATURE');
        }

        this.renderClausesEditorList();
        this.syncEditorToPreview();
    },

    setStudioSigningMode(mode) {
        const mainChk = document.getElementById('edShowMainSigChk');
        const drafterChk = document.getElementById('edShowDrafterSigChk');
        const typistChk = document.getElementById('edShowTypistSigChk');
        const togglesBox = document.getElementById('edIndividualSigToggles');

        if (mode === 'WET_SIGNATURE') {
            if (mainChk) mainChk.checked = false;
            if (drafterChk) drafterChk.checked = false;
            if (typistChk) typistChk.checked = false;
            if (togglesBox) togglesBox.classList.add('opacity-50');
        } else {
            if (mainChk && !mainChk.checked && drafterChk && !drafterChk.checked && typistChk && !typistChk.checked) {
                mainChk.checked = true;
                drafterChk.checked = true;
                typistChk.checked = true;
            }
            if (togglesBox) togglesBox.classList.remove('opacity-50');
        }

        this.syncEditorToPreview();
        if (mode === 'WET_SIGNATURE') {
            this.showToast('🖨️ ตั้งค่า "เว้นว่างลายเซ็นทุกช่องสำหรับเซ็นจริง (Wet Signature)" เรียบร้อยแล้ว');
        } else {
            this.showToast('✍️ ตั้งค่า "แสดงลายเซ็นอิเล็กทรอนิกส์" บนแบบพิมพ์ศาลแล้ว');
        }
    },

    onToggleIndividualSigCheckbox() {
        const mainChk = document.getElementById('edShowMainSigChk');
        const drafterChk = document.getElementById('edShowDrafterSigChk');
        const typistChk = document.getElementById('edShowTypistSigChk');
        const sigModeEl = document.getElementById('edSigningModeSelect');
        const togglesBox = document.getElementById('edIndividualSigToggles');

        const anyChecked = Boolean(mainChk?.checked || drafterChk?.checked || typistChk?.checked);
        if (sigModeEl) {
            sigModeEl.value = anyChecked ? 'ELECTRONIC' : 'WET_SIGNATURE';
        }
        if (togglesBox) {
            togglesBox.classList.toggle('opacity-50', !anyChecked);
        }
        this.syncEditorToPreview();
    },

    getStudioTextSettings(isDefenseForm = false) {
        const families = {
            'th-sarabun-new': "'TH Sarabun New', 'TH SarabunPSK', 'Sarabun', sans-serif",
            sarabun: "'Sarabun', 'TH Sarabun New', sans-serif",
            'angsana-new': "'Angsana New', 'AngsanaUPC', serif",
            'cordia-new': "'Cordia New', 'CordiaUPC', sans-serif"
        };
        const allowedSizes = [12, 14, 16, 18];
        const selectedFont = document.getElementById('edClauseTextFontFamily')?.value;
        const selectedSize = document.getElementById('edClauseTextFontSize')?.value;
        const fontFamily = families[selectedFont] ? selectedFont : (isDefenseForm ? 'th-sarabun-new' : 'sarabun');
        const requestedSize = Number(selectedSize || (isDefenseForm ? 16 : 14));
        const sizePt = allowedSizes.includes(requestedSize) ? requestedSize : (isDefenseForm ? 16 : 14);
        return { fontFamily, cssFamily: families[fontFamily], sizePt, weight: isDefenseForm ? 300 : 400 };
    },

    updateClauseTextStyle() {
        const isDefenseForm = ['(๑๑)', '(๑๑ ก.)'].includes(document.getElementById('edFormCode')?.value);
        const settings = this.getStudioTextSettings(isDefenseForm);
        document.querySelectorAll('#clausesEditorList .clause-content-editor').forEach(textarea => {
            textarea.style.fontFamily = settings.cssFamily;
            textarea.style.fontSize = `${settings.sizePt}pt`;
            textarea.style.fontWeight = String(settings.weight);
        });
        this.syncEditorToPreview();
    },

    renderClausesEditorList() {
        const isDefenseForm = ['(๑๑)', '(๑๑ ก.)'].includes(document.getElementById('edFormCode')?.value);
        const listEl = document.getElementById('clausesEditorList');
        if (!listEl) return;
        const formCode = document.getElementById('edFormCode')?.value || '(๗)';
        const isTabular = formCode === '(๑๕)' || formCode === '(๓)' || formCode === '(๘)';
        document.getElementById('clauseTextStyleControls')?.classList.remove('hidden');
        const textSettings = this.getStudioTextSettings(isDefenseForm);

        const lbl = document.getElementById('clausesSectionLabel');
        if (lbl) {
            if (formCode === '(๓)') lbl.textContent = 'รายการสารบาญสำนวน (อันดับ, รายการ, จำนวนแผ่น, หมายเหตุ)';
            else if (formCode === '(๘)') lbl.textContent = 'รายการบัญชีทรัพย์ (อันดับ, รายการทรัพย์สิน, จำนวน, ราคาบาท)';
            else if (formCode === '(๑๕)') lbl.textContent = 'ตารางบัญชีระบุพยาน (อันดับ, ชื่อและสกุลพยาน/เอกสาร, ที่อยู่, นำ/หมาย)';
            else lbl.textContent = 'รายการเนื้อหาคำคู่ความ / คำฟ้อง / คำร้อง (แยกข้ออัตโนมัติ)';
        }

        if (isTabular) {
            listEl.innerHTML = this.state.currentClauses.map((w, idx) => `
                <div class="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-slate-700">อันดับที่ ${idx + 1}</span>
                        <button type="button" onclick="App.removeClauseItem(${idx})" class="text-xs text-rose-600 hover:underline">ลบ</button>
                    </div>
                    <input type="text" value="${(w.WitnessNameAndDesc || w.witnessNameAndDesc || '').replace(/"/g, '&quot;')}"
                        oninput="App.updateWitnessField(${idx}, 'WitnessNameAndDesc', this.value)"
                        placeholder="ชื่อพยานบุคคล หรือ ชื่อเอกสาร/วัตถุพยาน"
                        class="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white font-medium" />
                    <div class="grid grid-cols-3 gap-2">
                        <input type="text" value="${(w.AddressText || w.addressText || '').replace(/"/g, '&quot;')}"
                            oninput="App.updateWitnessField(${idx}, 'AddressText', this.value)"
                            placeholder="บ้านเลขที่ ตำบล อำเภอ จังหวัด"
                            class="col-span-2 px-2.5 py-1 rounded border border-slate-300 text-xs bg-white" />
                        <select onchange="App.updateWitnessField(${idx}, 'Note', this.value)" class="px-2 py-1 rounded border border-slate-300 text-xs bg-white font-semibold">
                            <option value="นำ" ${(w.Note || w.note) === 'นำ' ? 'selected' : ''}>นำ</option>
                            <option value="หมาย" ${(w.Note || w.note) === 'หมาย' ? 'selected' : ''}>หมาย</option>
                        </select>
                    </div>
                </div>
            `).join('');
        } else {
            listEl.innerHTML = this.state.currentClauses.map((c, idx) => {
                return `
                <div class="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <input type="text" value="${(c.ClauseTitle || c.clauseTitle || `ข้อ ${idx + 1}.`).replace(/"/g, '&quot;')}"
                            oninput="App.updateClauseField(${idx}, 'ClauseTitle', this.value)"
                            class="w-28 px-2 py-1 rounded border border-slate-300 text-xs font-bold bg-white" />
                        <button type="button" onclick="App.removeClauseItem(${idx})" class="text-xs text-rose-600 hover:underline">ลบข้อนี้</button>
                    </div>
                    <textarea id="clauseContent${idx}" rows="4" oninput="App.updateClauseField(${idx}, 'Content', this.value)"
                        style="font-family:${textSettings.cssFamily};font-size:${textSettings.sizePt}pt;font-weight:${textSettings.weight};"
                        class="clause-content-editor w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white leading-relaxed">${c.Content || c.content || ''}</textarea>
                </div>
            `;
            }).join('');
        }
    },

    updateClauseField(idx, field, val) {
        if (!this.state.currentClauses[idx]) return;
        this.state.currentClauses[idx][field] = val;
        this.syncEditorToPreview();
    },

    updateWitnessField(idx, field, val) {
        if (!this.state.currentClauses[idx]) return;
        this.state.currentClauses[idx][field] = val;
        this.state.currentClauses[idx].OrderNo = idx + 1;
        this.syncEditorToPreview();
    },

    addClauseItem() {
        const formCode = document.getElementById('edFormCode')?.value || '(๗)';
        const nextNo = this.state.currentClauses.length + 1;
        if (formCode === '(๑๕)' || formCode === '(๓)' || formCode === '(๘)') {
            this.state.currentClauses.push({
                OrderNo: nextNo,
                WitnessNameAndDesc: '',
                AddressText: '-',
                Note: formCode === '(๑๕)' ? 'นำ' : '-'
            });
        } else {
            const thaiNo = window.CourtRenderer.toThaiNum(nextNo, true);
            this.state.currentClauses.push({
                ClauseTitle: (formCode === '(๕)' || formCode === '(๖)') ? `${thaiNo}.` : `ข้อ ${thaiNo}.`,
                Content: ''
            });
        }
        this.renderClausesEditorList();
        this.syncEditorToPreview();
    },

    removeClauseItem(idx) {
        this.state.currentClauses.splice(idx, 1);
        this.renderClausesEditorList();
        this.syncEditorToPreview();
    },

    toggleSmartPasteBox() {
        document.getElementById('smartPasteContainer')?.classList.toggle('hidden');
    },

    parseRawTextIntoClauses() {
        const raw = (document.getElementById('rawPetitionPasteInput')?.value || '').trim();
        if (!raw) {
            this.showToast('กรุณาวางข้อความคำฟ้องหรือคำร้องก่อนกดแยกข้อ');
            return;
        }

        // Split by "ข้อ ๑", "ข้อ 1", or numbered paragraphs
        const regex = /(?=ข้อ\s*[๐-๙0-9]+\.?)/g;
        let parts = raw.split(regex).map(s => s.trim()).filter(Boolean);

        if (parts.length <= 1) {
            parts = raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
        }

        this.state.currentClauses = parts.map((p, idx) => {
            const match = p.match(/^(ข้อ\s*[๐-๙0-9]+\.?)\s*(.*)$/s);
            if (match) {
                return {
                    ClauseTitle: window.CourtRenderer.normalizeThaiSpacing(match[1].trim()),
                    Content: window.CourtRenderer.normalizeThaiSpacing(match[2].trim())
                };
            }
            const thaiIdx = window.CourtRenderer.toThaiNum(idx + 1, true);
            return {
                ClauseTitle: `ข้อ ${thaiIdx}.`,
                Content: window.CourtRenderer.normalizeThaiSpacing(p)
            };
        });

        this.renderClausesEditorList();
        this.syncEditorToPreview();
        this.showToast(`แยกข้อความออกเป็น ${this.state.currentClauses.length} ข้อ พร้อมจัดเคาะวรรคตามระบบภาษาไทยเรียบร้อยแล้ว`);
    },

    formatAllClausesThaiSpacing() {
        this.state.currentClauses = (this.state.currentClauses || []).map(c => {
            const next = { ...c };
            if (next.ClauseTitle !== undefined) next.ClauseTitle = window.CourtRenderer.normalizeThaiSpacing(next.ClauseTitle);
            if (next.clauseTitle !== undefined) next.clauseTitle = window.CourtRenderer.normalizeThaiSpacing(next.clauseTitle);
            if (next.Content !== undefined) next.Content = window.CourtRenderer.normalizeThaiSpacing(next.Content);
            if (next.content !== undefined) next.content = window.CourtRenderer.normalizeThaiSpacing(next.content);
            if (next.WitnessNameAndDesc !== undefined) next.WitnessNameAndDesc = window.CourtRenderer.normalizeThaiSpacing(next.WitnessNameAndDesc);
            if (next.AddressText !== undefined) next.AddressText = window.CourtRenderer.normalizeThaiSpacing(next.AddressText);
            return next;
        });
        this.renderClausesEditorList();
        this.syncEditorToPreview();
        this.showToast('จัดระเบียบการเคาะวรรคตามระบบภาษาไทยครบทุกข้อแล้ว');
    },

    insertLegalPhrase(phrase) {
        if (phrase && phrase.includes('ขอศาลได้โปรดอนุญาต')) {
            const showPermEl = document.getElementById('edShowPermission');
            const permTextEl = document.getElementById('edPermissionText');
            if (showPermEl) showPermEl.checked = true;
            if (permTextEl) permTextEl.value = phrase;
            this.syncEditorToPreview();
            this.showToast('เปิดแสดงข้อความ "ขอศาลได้โปรดอนุญาต" ย่อหน้าสุดท้ายก่อน ควรมิควรแล้วแต่จะโปรด แล้ว');
            return;
        }
        if (this.state.currentClauses.length === 0) {
            this.addClauseItem();
        }
        const last = this.state.currentClauses[this.state.currentClauses.length - 1];
        last.Content = ((last.Content || last.content || '') + '\n' + phrase).trim();
        this.renderClausesEditorList();
        this.syncEditorToPreview();
    },

    quickFillProfile(type) {
        return window.ProfileAutofill.fill(type);
    },

    onSelectSignerSignature(sigId) {
        if (!sigId) return;
        if (sigId === 'NONE') {
            const sigModeEl = document.getElementById('edSigningModeSelect');
            const mainChk = document.getElementById('edShowMainSigChk');
            if (sigModeEl) sigModeEl.value = 'WET_SIGNATURE';
            if (mainChk) mainChk.checked = false;
            this.setStudioSigningMode('WET_SIGNATURE');
            return;
        }
        const sig = this.state.signatures.find(s => s.id === Number(sigId));
        if (!sig || !this.state.currentDoc) return;
        this.state.currentDoc.signatureImageBase64 = sig.imageDataUrl;
        document.getElementById('edSignerName').value = sig.signerName;
        const sigModeEl = document.getElementById('edSigningModeSelect');
        const mainChk = document.getElementById('edShowMainSigChk');
        if (sigModeEl) sigModeEl.value = 'ELECTRONIC';
        if (mainChk) mainChk.checked = true;
        this.syncEditorToPreview();
        this.showToast(`แนบลายเซ็นอิเล็กทรอนิกส์ของ ${sig.signerName} ลงในฟอร์มแล้ว`);
    },

    collectCurrentDocFromInputs() {
        const base = this.state.currentDoc || {};
        const getVal = id => document.getElementById(id)?.value ?? '';

        let extra = {};
        try {
            extra = JSON.parse(base.extraFieldsJson || '{}') || {};
        } catch {
            extra = {};
        }

        extra.BlackCaseNo = getVal('edBlackCaseNo').trim();
        extra.BlackCaseYear = getVal('edBlackCaseYear').trim();
        extra.RedCaseNo = getVal('edRedCaseNo').trim();
        extra.RedCaseYear = getVal('edRedCaseYear').trim();
        extra.ShowPermission = document.getElementById('edShowPermission')?.checked === true;
        extra.PermissionText = getVal('edPermissionText').trim() || 'ขอศาลได้โปรดอนุญาต';
        extra.SigningMode = document.getElementById('edSigningModeSelect')?.value || 'ELECTRONIC';
        extra.ShowMainElectronicSig = document.getElementById('edShowMainSigChk')?.checked !== false;
        extra.ShowDrafterElectronicSig = document.getElementById('edShowDrafterSigChk')?.checked !== false;
        extra.ShowTypistElectronicSig = document.getElementById('edShowTypistSigChk')?.checked !== false;
        const isDefenseForm = ['(๑๑)', '(๑๑ ก.)'].includes(getVal('edFormCode'));
        const textSettings = this.getStudioTextSettings(isDefenseForm);
        extra.TextFontFamily = textSettings.fontFamily;
        extra.TextFontSize = textSettings.sizePt;

        return {
            ...base,
            caseId: Number(this.state.currentCaseId),
            formCode: getVal('edFormCode') || '(๗)',
            documentTitle: getVal('edDocumentTitle') || 'คำร้อง',
            lawyerRoleInDoc: getVal('edRequesterStatus') || 'ทนายความ',
            docDay: getVal('edDocDay'),
            docMonth: getVal('edDocMonth'),
            docYear: getVal('edDocYear'),
            requesterFullName: getVal('edRequesterFullName'),
            requesterStatus: getVal('edRequesterStatus'),
            requesterCitizenId: getVal('edRequesterCitizenId'),
            requesterRace: 'ไทย',
            requesterNationality: 'ไทย',
            requesterOccupation: getVal('edRequesterOccupation'),
            requesterAge: getVal('edRequesterAge'),
            requesterHouseNo: getVal('edRequesterHouseNo'),
            requesterMoo: getVal('edRequesterMoo'),
            requesterRoad: getVal('edRequesterRoad'),
            requesterSoi: '-',
            requesterNearBy: '-',
            requesterSubDistrict: getVal('edRequesterSubDistrict'),
            requesterDistrict: getVal('edRequesterDistrict'),
            requesterProvince: getVal('edRequesterProvince'),
            requesterPostalCode: getVal('edRequesterPostalCode'),
            requesterPhone: getVal('edRequesterPhone'),
            clausesJson: JSON.stringify(this.state.currentClauses),
            extraFieldsJson: JSON.stringify(extra),
            closingPrayer: getVal('edFormCode') === '(๔)' ? (getVal('edClosingPrayer').trim() || 'ควรมิควรแล้วแต่จะโปรด') : window.CourtRenderer.normalizeClosingPrayer(base.closingPrayer),
            signerName: getVal('edSignerName'),
            signerRole: getVal('edSignerRole').replaceAll('(ผู้จัดทำร่างหมายเรียก)', '').trim(),
            drafterName: getVal('edDrafterName'),
            typistName: getVal('edTypistName'),
            signatureImageBase64: base.signatureImageBase64 || '',
            drafterSignatureBase64: base.drafterSignatureBase64 || '',
            typistSignatureBase64: base.typistSignatureBase64 || '',
            useThaiNumerals: document.getElementById('edUseThaiNumerals')?.checked !== false,
            status: 'ฉบับสมบูรณ์'
        };
    },

    onClosingPrayerInput() {
        if (this.state.currentDoc) {
            let extra = {};
            try { extra = JSON.parse(this.state.currentDoc.extraFieldsJson || '{}'); } catch { }
            extra.CustomClosingPrayer = true;
            this.state.currentDoc.extraFieldsJson = JSON.stringify(extra);
        }
        this.syncEditorToPreview();
    },

    syncEditorToPreview() {
        const doc = this.collectCurrentDocFromInputs();
        this.state.currentDoc = doc;
        const lawCase = this.state.cases.find(c => c.id === Number(this.state.currentCaseId));
        const previewEl = document.getElementById('studioPaperPreview');
        if (previewEl) {
            previewEl.innerHTML = window.CourtRenderer.renderDocumentPagesHtml(doc, lawCase);
        }
    },

    async saveCurrentStudioDocument() {
        this.formatAllClausesThaiSpacing();
        const doc = this.collectCurrentDocFromInputs();
        try {
            const isUpdate = doc.id && doc.id > 0;
            const url = isUpdate ? `/api/documents/${doc.id}` : '/api/documents';
            const method = isUpdate ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(doc)
            });
            const saved = await res.json();
            if (!res.ok) throw new Error(saved.message || 'บันทึกเอกสารไม่สำเร็จ');
            this.state.currentDoc = saved;
            await this.loadDashboardData();
            this.populateStudioDropdowns();
            this.showToast('✅ บันทึกเอกสารคำคู่ความลงฐานข้อมูล SmartLaws สำเร็จ!');
        } catch (err) {
            console.error(err);
            this.showToast('เกิดข้อผิดพลาดในการบันทึกเอกสาร');
        }
    },

    async exportCurrentDocx() {
        if (!this.state.currentDoc?.id || this.state.currentDoc.id === 0) {
            await this.saveCurrentStudioDocument();
        }
        if (this.state.currentDoc?.id) {
            window.location.href = `/api/documents/${this.state.currentDoc.id}/export-docx`;
        }
    },

    // ==================== 4. PROCEDURE WORKFLOW VIEW ====================
    renderProcedureWorkflowView() {
        const crimStages = [
            {
                step: '๑. ชั้นยื่นฟ้อง / ไต่สวนมูลฟ้อง (ป.วิ.อ. ม.๑๕๘, ๑๖๒)',
                role: 'ทนายโจทก์ / ทนายจำเลย',
                desc: 'โจทก์ยื่นคำฟ้องอาญา (๔) พร้อมใบแต่งทนายความ (๙) ส่วนจำเลยแต่งทนายความซักค้านชั้นไต่สวนมูลฟ้อง',
                forms: [{ code: '(๔)', name: 'คำฟ้องอาญา', tplId: 1 }, { code: '(๙)', name: 'ใบแต่งทนายความ', tplId: 4 }]
            },
            {
                step: '๒. ชั้นคำให้การจำเลย & ขอยื่นคำให้การเพิ่มเติม (ป.วิ.อ. ม.๑๗๒)',
                role: 'ทนายจำเลย',
                desc: 'จำเลยยื่นคำให้การต่อสู้คดี (๑๑ ก.) และคำร้องขอยื่นคำให้การเพิ่มเติม (๗) ดังเช่นคดี อ ๓๙๘/๒๕๖๘',
                forms: [{ code: '(๗)', name: 'คำร้องขอยื่นคำให้การ', tplId: 3 }, { code: '(๑๑ ก.)', name: 'คำให้การจำเลย', tplId: 6 }]
            },
            {
                step: '๓. ชั้นตรวจพยานหลักฐาน & สืบพยาน (ป.วิ.อ. ม.๒๒๙/๑)',
                role: 'ทนายโจทก์ / ทนายจำเลย',
                desc: 'ยื่นบัญชีระบุพยาน (๑๕) และใบมอบฉันทะเสมียนทนาย (๑๐) ส่งเอกสารและนำสืบพยาน',
                forms: [{ code: '(๑๕)', name: 'บัญชีพยาน', tplId: 9 }, { code: '(๑๐)', name: 'ใบมอบฉันทะ', tplId: 5 }]
            },
            {
                step: '๔. ชั้นแถลงปิดคดี & คำพิพากษา (ป.วิ.อ. ม.๒๒๗)',
                role: 'ทนายจำเลย / ทนายโจทก์',
                desc: 'ยื่นคำแถลงปิดคดี (๗) ชี้ช่องว่างพยานหลักฐานเพื่อขอให้ศาลยกประโยชน์แห่งความสงสัยตาม ม.๒๒๗',
                forms: [{ code: '(๗)', name: 'คำแถลงปิดคดี', tplId: 3 }, { code: '(๔๐ ก.)', name: 'ใบต่อคำคู่ความ', tplId: 10 }]
            }
        ];

        const civStages = [
            {
                step: '๑. ชั้นยื่นคำฟ้องแพ่ง / มโนสาเร่ (ป.วิ.พ. ม.๑๗๒, ๑๙๓)',
                role: 'ทนายโจทก์',
                desc: 'ยื่นคำฟ้องแพ่ง (๔) คู่กับคำขอท้ายคำฟ้องแพ่ง (๕) และใบแต่งทนายความ (๙) ดังเช่นคดีนางไพลิน อาจสามารถ',
                forms: [{ code: '(๔)', name: 'คำฟ้องแพ่ง', tplId: 1 }, { code: '(๕)', name: 'คำขอท้ายคำฟ้องแพ่ง', tplId: 2 }, { code: '(๙)', name: 'ใบแต่งทนาย', tplId: 4 }]
            },
            {
                step: '๒. ชั้นออกหมายเรียก & ขอปิดหมาย (ป.วิ.พ. ม.๗๙, ๑๗๓)',
                role: 'ทนายโจทก์',
                desc: 'จัดทำร่างหมายเรียกคดีมโนสาเร่ (๑๒) หรือแพ่งสามัญ (๑๓) พร้อมคำร้องขอปิดหมาย (๗) แนบทะเบียนราษฎร',
                forms: [{ code: '(๗)', name: 'คำร้องขอปิดหมาย', tplId: 3 }, { code: '(๑๒)', name: 'หมายเรียกมโนสาเร่', tplId: 7 }, { code: '(๑๓)', name: 'หมายเรียกแพ่งสามัญ', tplId: 8 }]
            },
            {
                step: '๓. ชั้นยื่นคำให้การแก้ฟ้องแพ่ง & ขยายเวลา (ป.วิ.พ. ม.๑๗๗, ๒๓)',
                role: 'ทนายจำเลย',
                desc: 'ยื่นคำร้องขอขยายเวลายื่นคำให้การ (๗) และคำให้การจำเลยต่อสู้คดีแพ่ง (๑๑ ก.)',
                forms: [{ code: '(๑๑ ก.)', name: 'คำให้การจำเลย', tplId: 6 }, { code: '(๗)', name: 'คำร้องขอขยายเวลา', tplId: 3 }]
            },
            {
                step: '๔. ชั้นสืบพยาน & บังคับคดีแพ่ง (ป.วิ.พ. ม.๘๘, ๒๗๔)',
                role: 'ทนายโจทก์ / ทนายจำเลย',
                desc: 'ยื่นบัญชีพยาน (๑๕) คำแถลงขอออกหมายบังคับคดี และตั้งเจ้าพนักงานบังคับคดี',
                forms: [{ code: '(๑๕)', name: 'บัญชีพยาน', tplId: 9 }, { code: '(๗)', name: 'คำขอออกหมายบังคับคดี', tplId: 3 }]
            }
        ];

        const renderCards = (items, colorClass) => items.map(item => `
            <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-col justify-between space-y-3">
                <div class="space-y-1.5">
                    <div class="text-xs font-bold ${colorClass}">${item.step}</div>
                    <div class="text-[11px] font-semibold text-slate-500">สำหรับ: ${item.role}</div>
                    <p class="text-xs text-slate-600 leading-relaxed">${item.desc}</p>
                </div>
                <div class="flex flex-wrap gap-1.5 pt-2 border-t border-slate-200">
                    ${item.forms.map(f => `
                        <button onclick="App.createNewDocFromTemplate(${f.tplId})" class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-amber-500 hover:text-slate-950 text-white text-[11px] font-semibold transition">
                            + ${f.code} ${f.name}
                        </button>
                    `).join('')}
                </div>
            </div>
        `).join('');

        const crimEl = document.getElementById('criminalProcedureGrid');
        if (crimEl) crimEl.innerHTML = renderCards(crimStages, 'text-rose-700');

        const civEl = document.getElementById('civilProcedureGrid');
        if (civEl) civEl.innerHTML = renderCards(civStages, 'text-indigo-700');
    },

    // ==================== 5. ELECTRONIC SIGNATURE PAD ====================
    initSignatureCanvas() {
        const canvas = document.getElementById('signatureCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = this.state.penColor;
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * (canvas.width / rect.width),
                y: (clientY - rect.top) * (canvas.height / rect.height)
            };
        };

        const start = (e) => {
            e.preventDefault();
            this.state.isDrawing = true;
            const pos = getPos(e);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
        };

        const move = (e) => {
            if (!this.state.isDrawing) return;
            e.preventDefault();
            const pos = getPos(e);
            ctx.strokeStyle = this.state.penColor;
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        };

        const stop = () => {
            this.state.isDrawing = false;
        };

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        window.addEventListener('mouseup', stop);

        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', stop);
    },

    setPenColor(color) {
        this.state.penColor = color;
    },

    clearSignatureCanvas() {
        const canvas = document.getElementById('signatureCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    },

    async saveDrawnSignature() {
        const canvas = document.getElementById('signatureCanvas');
        const signerName = (document.getElementById('sigSignerName')?.value || '').trim();
        const signerRole = document.getElementById('sigSignerRole')?.value || 'ทนายความ';
        const licenseOrCitizenId = (document.getElementById('sigLicenseNo')?.value || '').trim();

        if (!signerName) {
            this.showToast('กรุณาระบุชื่อ-นามสกุล เจ้าของลายเซ็น');
            return;
        }

        const dataUrl = canvas.toDataURL('image/png');
        const res = await fetch('/api/signatures', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                signerName,
                signerRole,
                licenseOrCitizenId,
                signatureType: 'E-Signature Pad',
                imageDataUrl: dataUrl,
                isDefault: true
            })
        });

        if (res.ok) {
            await this.loadDashboardData();
            this.renderSignaturesGallery();
            this.populateStudioDropdowns();
            this.clearSignatureCanvas();
            this.showToast(`✅ บันทึกลายเซ็นอิเล็กทรอนิกส์ของ ${signerName} สำเร็จ!`);
        }
    },

    // ==================== 5B. IMAGE SIGNATURE UPLOAD & AUTOMATIC BACKGROUND REMOVAL ====================
    onSelectSignatureUploadFile(inputEl) {
        const file = inputEl?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.state.uploadedSigRawImage = img;
                this.processSignatureBackgroundRemoval();
                this.showToast(`โหลดไฟล์ภาพลายเซ็น "${file.name}" และลบพื้นหลังอัตโนมัติเรียบร้อย`);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    loadSamplePaperSignatureForBgRemoval(silent = false) {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = 480;
        offCanvas.height = 150;
        const ctx = offCanvas.getContext('2d');

        // จำลองกระดาษสีเทาอมเหลืองที่มีเงา (เหมือนถ่ายด้วยกล้องมือถือ)
        const grad = ctx.createLinearGradient(0, 0, 480, 150);
        grad.addColorStop(0, '#f3efe6');
        grad.addColorStop(0.5, '#e6e1d6');
        grad.addColorStop(1, '#dcd6c8');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 480, 150);

        // วาดเส้นลายเซ็นปากกาน้ำเงินเข้ม
        ctx.strokeStyle = '#14348f';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(65, 98);
        ctx.bezierCurveTo(105, 42, 145, 118, 195, 62);
        ctx.bezierCurveTo(235, 32, 270, 95, 330, 58);
        ctx.bezierCurveTo(365, 44, 395, 82, 425, 50);
        ctx.stroke();

        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(95, 116);
        ctx.quadraticCurveTo(245, 95, 405, 108);
        ctx.stroke();

        ctx.fillStyle = '#14348f';
        ctx.font = 'italic bold 20px Sarabun, sans-serif';
        const effectiveLawyer = this.getEffectiveLawyerAccount();
        const sampleName = effectiveLawyer?.fullName?.replace(/^(นาย|นางสาว|นาง)/, '').trim() || 'ปิยะณัฐ วัชราภรณ์';
        ctx.fillText(sampleName, 155, 76);

        const img = new Image();
        img.onload = () => {
            this.state.uploadedSigRawImage = img;
            const nameInput = document.getElementById('sigSignerName');
            if (nameInput && !nameInput.value && effectiveLawyer) {
                nameInput.value = effectiveLawyer.fullName;
            }
            this.processSignatureBackgroundRemoval();
            if (!silent) {
                this.showToast('✨ โหลดภาพตัวอย่างลายเซ็นบนกระดาษถ่ายรูป พร้อมลบพื้นหลังให้โปร่งใสอัตโนมัติแล้ว');
            }
        };
        img.src = offCanvas.toDataURL('image/png');
    },

    processSignatureBackgroundRemoval() {
        const previewCanvas = document.getElementById('sigUploadPreviewCanvas');
        if (!previewCanvas) return;
        const ctx = previewCanvas.getContext('2d');

        const threshold = Number(document.getElementById('sigBgThresholdSlider')?.value || 205);
        const lbl = document.getElementById('sigBgThresholdValLabel');
        if (lbl) lbl.textContent = String(threshold);

        const autoRemoveBg = document.getElementById('sigAutoRemoveBgChk')?.checked !== false;
        const inkColorMode = document.getElementById('sigInkColorMode')?.value || 'BLUE_COURT';

        ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

        const srcImg = this.state.uploadedSigRawImage;
        if (!srcImg) return;

        // Fit image into preview canvas preserving aspect ratio
        const scale = Math.min(
            (previewCanvas.width - 24) / Math.max(1, srcImg.width),
            (previewCanvas.height - 16) / Math.max(1, srcImg.height)
        );
        const drawW = Math.round(srcImg.width * scale);
        const drawH = Math.round(srcImg.height * scale);
        const offsetX = Math.round((previewCanvas.width - drawW) / 2);
        const offsetY = Math.round((previewCanvas.height - drawH) / 2);

        ctx.drawImage(srcImg, offsetX, offsetY, drawW, drawH);

        if (autoRemoveBg) {
            const imgData = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
            const data = imgData.data;

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const a = data[i + 3];
                if (a === 0) continue;

                // คำนวณความสว่างของพิกเซล (Luminance) และความอิ่มตัวของสีหมึก
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                const maxCh = Math.max(r, g, b);
                const minCh = Math.min(r, g, b);
                const chroma = maxCh - minCh;

                // หากความสว่างสูงกว่า Threshold และไม่ใช่สีหมึกน้ำเงินเข้ม ให้ตัดพื้นหลังโปร่งใส
                const effectiveLum = lum - chroma * 0.35;
                if (effectiveLum >= threshold) {
                    data[i + 3] = 0;
                } else {
                    // ทำขอบตัวอักษรให้คมชัดและเนียน (Soft Anti-aliased Alpha)
                    const darkness = Math.min(1, Math.max(0.15, (threshold - effectiveLum) / Math.max(25, threshold * 0.42)));
                    const newAlpha = Math.min(255, Math.round(darkness * 255));
                    data[i + 3] = newAlpha;

                    if (inkColorMode === 'BLUE_COURT') {
                        data[i] = 18;
                        data[i + 1] = 48;
                        data[i + 2] = 142;
                    } else if (inkColorMode === 'BLACK_COURT') {
                        data[i] = 15;
                        data[i + 1] = 23;
                        data[i + 2] = 42;
                    }
                }
            }
            ctx.putImageData(imgData, 0, 0);
        }

        this.state.uploadedSigProcessedDataUrl = previewCanvas.toDataURL('image/png');
    },

    async saveUploadedProcessedSignature() {
        if (!this.state.uploadedSigRawImage) {
            this.loadSamplePaperSignatureForBgRemoval(true);
        }
        this.processSignatureBackgroundRemoval();

        const dataUrl = this.state.uploadedSigProcessedDataUrl
            || document.getElementById('sigUploadPreviewCanvas')?.toDataURL('image/png');
        if (!dataUrl) {
            this.showToast('กรุณาเลือกไฟล์ภาพลายเซ็นก่อนกดบันทึก');
            return;
        }

        const effectiveLawyer = this.getEffectiveLawyerAccount();
        const signerName = (document.getElementById('sigSignerName')?.value || effectiveLawyer?.fullName || '').trim();
        const signerRole = document.getElementById('sigSignerRole')?.value || 'ทนายความ';
        const licenseOrCitizenId = (document.getElementById('sigLicenseNo')?.value || effectiveLawyer?.licenseNo || '').trim();

        if (!signerName) {
            this.showToast('กรุณาระบุชื่อ-นามสกุล เจ้าของลายเซ็นในช่องด้านซ้าย');
            return;
        }

        const res = await fetch('/api/signatures', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                signerName,
                signerRole,
                licenseOrCitizenId,
                signatureType: 'Uploaded Image (BG Removed)',
                imageDataUrl: dataUrl,
                isDefault: true
            })
        });

        if (res.ok) {
            await this.loadDashboardData();
            this.renderSignaturesGallery();
            this.populateStudioDropdowns();
            this.showToast(`✅ บันทึกไฟล์ภาพลายเซ็น (ลบพื้นหลังโปร่งใส) ของ "${signerName}" ลงคลังสำเร็จ!`);
        }
    },

    renderSignaturesGallery() {
        const grid = document.getElementById('signaturesGalleryGrid');
        if (!grid) return;
        grid.innerHTML = this.state.signatures.map(s => `
            <div class="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col justify-between space-y-3">
                <div class="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-center h-24" style="background-image: linear-gradient(45deg, #f8fafc 25%, transparent 25%), linear-gradient(-45deg, #f8fafc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f8fafc 75%), linear-gradient(-45deg, transparent 75%, #f8fafc 75%); background-size: 12px 12px; background-position: 0 0, 0 6px, 6px -6px, -6px 0;">
                    <img src="${s.imageDataUrl}" alt="${s.signerName}" class="max-h-16 object-contain" />
                </div>
                <div>
                    <div class="flex items-center justify-between gap-1">
                        <div class="font-bold text-xs text-slate-900">${s.signerName}</div>
                        <span class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-semibold">${s.signatureType || 'E-Sign'}</span>
                    </div>
                    <div class="text-[11px] text-slate-600">${s.signerRole} • ${s.licenseOrCitizenId || ''}</div>
                    <div class="text-[10px] text-emerald-700 font-mono mt-0.5">Verify: ${s.verificationHash || 'VERIFIED'}</div>
                </div>
                <div class="flex justify-between items-center pt-2 border-t border-slate-200">
                    <button onclick="App.applySignatureToCurrentStudioDoc(${s.id})" class="px-3 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-semibold hover:bg-amber-500 hover:text-slate-950 transition">
                        นำไปวางในฟอร์มศาลปัจจุบัน
                    </button>
                </div>
            </div>
        `).join('');

        if (!this.state.uploadedSigRawImage) {
            this.loadSamplePaperSignatureForBgRemoval(true);
        }
    },

    applySignatureToCurrentStudioDoc(sigId) {
        this.onSelectSignerSignature(sigId);
        this.switchTab('studio');
    },

    // ==================== 6. BATCH PRINT CENTER ====================
    populatePrintCenterDropdown() {
        const sel = document.getElementById('batchPrintCaseSelect');
        if (!sel) return;
        const accessibleCases = this.getAccessibleCases();
        sel.innerHTML = accessibleCases.map(c => `
            <option value="${c.id}" ${c.id === Number(this.state.currentCaseId) ? 'selected' : ''}>
                [${c.caseCategory} - ${c.lawyerRole}] คดีดำที่ ${c.blackCaseNo}/๒๕${c.blackCaseYear} (${c.plaintiffName} vs ${c.defendantName})
            </option>
        `).join('');
        const modeSel = document.getElementById('batchPrintSigningModeSelect');
        if (modeSel) {
            modeSel.value = this.state.batchPrintSigningMode || 'DOC_DEFAULT';
        }
        const targetCaseId = accessibleCases.some(c => c.id === Number(this.state.currentCaseId))
            ? this.state.currentCaseId
            : (accessibleCases[0]?.id || 0);
        this.renderPrintCenter(targetCaseId);
    },

    setBatchPrintSigningMode(mode) {
        this.state.batchPrintSigningMode = mode || 'DOC_DEFAULT';
        const cid = Number(document.getElementById('batchPrintCaseSelect')?.value || this.state.currentCaseId);
        this.updateBatchPrintPreview(cid);
        if (mode === 'FORCE_WET') {
            this.showToast('✍️ ตั้งค่าศูนย์พิมพ์: เว้นว่างลายเซ็นทุกฉบับเพื่อให้ผู้เซ็นเซ็นจริงด้วยปากกา');
        } else if (mode === 'FORCE_ELECTRONIC') {
            this.showToast('🖊️ ตั้งค่าศูนย์พิมพ์: แสดงลายเซ็นอิเล็กทรอนิกส์ทุกฉบับ');
        } else {
            this.showToast('ตั้งค่าศูนย์พิมพ์: ใช้ตามที่ตั้งค่าไว้ในแต่ละเอกสาร');
        }
    },

    renderPrintCenter(caseId) {
        const cid = Number(caseId);
        const caseDocs = this.getAccessibleDocuments().filter(d => d.caseId === cid);

        const chkContainer = document.getElementById('printCenterDocCheckboxes');
        if (chkContainer) {
            chkContainer.innerHTML = caseDocs.map(d => `
                <label class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold cursor-pointer">
                    <input type="checkbox" class="batch-doc-chk rounded text-amber-600" value="${d.id}" checked onchange="App.updateBatchPrintPreview(${cid})" />
                    <span>${d.formCode} ${d.documentTitle}</span>
                </label>
            `).join('');
        }

        this.updateBatchPrintPreview(cid);
    },

    updateBatchPrintPreview(caseId) {
        const cid = Number(caseId);
        const lawCase = this.getAccessibleCases().find(c => c.id === cid);
        const checkedIds = Array.from(document.querySelectorAll('.batch-doc-chk:checked')).map(el => Number(el.value));
        const selectedDocs = this.getAccessibleDocuments().filter(d => checkedIds.includes(d.id));

        const container = document.getElementById('batchPrintPreviewContainer');
        if (container) {
            container.innerHTML = selectedDocs.map(d => window.CourtRenderer.renderDocumentPagesHtml(d, lawCase)).join('');
        }
    },

    // ==================== 7. REPORTS VIEW ====================
    renderReportsView() {
        const el = document.getElementById('reportsSummaryContent');
        if (!el) return;

        // กรณีแอดมิน: เห็นเฉพาะชื่อคดีและภาพรวมบริการ ห้ามดูรายละเอียดคดีทนายความ
        if (this.state.currentUser?.role === 'Admin') {
            const serviceCases = this.getAdminServiceCaseTitlesOnly();
            el.innerHTML = `
                <div class="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 font-semibold">
                    🔒 <strong>โหมดรายงานสำหรับผู้ดูแลระบบ (Admin Service Report):</strong> แอดมินสามารถดูได้เฉพาะชื่อคดีและสถานะโควต้าของทนายความเท่านั้น ข้อมูลคู่ความ ทุนทรัพย์ และเนื้อหาคำคู่ความถูกปกปิดตามสิทธิ์ความเป็นส่วนตัวของทนายความ
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-xs border border-slate-200">
                        <thead class="bg-slate-900 text-white">
                            <tr>
                                <th class="p-3">รหัสระบบ</th>
                                <th class="p-3">ชื่อคดีในระบบ (เฉพาะชื่อคดี)</th>
                                <th class="p-3">แอคเคาท์ทนายความเจ้าของสำนวน</th>
                                <th class="p-3">เสมียนทนายผู้รับผิดชอบ</th>
                                <th class="p-3">สถานะความเป็นส่วนตัว</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                            ${serviceCases.map(sc => `
                                <tr>
                                    <td class="p-3 font-bold">${sc.caseCode}</td>
                                    <td class="p-3 font-bold text-slate-900">${sc.caseTitleOnly}</td>
                                    <td class="p-3 font-semibold text-blue-900">⚖️ ${sc.ownerLawyerName} (${sc.ownerLicenseNo})</td>
                                    <td class="p-3 font-semibold text-indigo-800">👨‍💼 ${sc.assignedClerkName}</td>
                                    <td class="p-3"><span class="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[11px]">🔒 ปกปิดข้อมูลคดีของทนาย</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            return;
        }

        const cases = this.getAccessibleCases();
        const docs = this.getAccessibleDocuments();
        const effectiveLawyer = this.getEffectiveLawyerAccount();

        el.innerHTML = `
            <div class="p-3.5 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-950">
                <div><strong>⚖️ รายงานเฉพาะสำนวนคดีของแอคเคาท์:</strong> ${effectiveLawyer?.fullName || '-'} (${effectiveLawyer?.licenseNo || '-'})</div>
                <span class="px-2.5 py-0.5 rounded-full bg-white border border-blue-300 font-bold text-[11px]">แยกข้อมูลอิสระตามบัญชีทนายความ</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div class="text-xs text-slate-500">มูลค่าทุนทรัพย์รวมในคดีแพ่ง (เฉพาะบัญชีนี้)</div>
                    <div class="text-xl font-extrabold text-slate-900 mt-1">${cases.reduce((acc, c) => acc + (c.claimAmount || 0), 0).toLocaleString()} บาท</div>
                </div>
                <div class="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div class="text-xs text-slate-500">สัดส่วนทนายโจทก์ : ทนายจำเลย (เฉพาะบัญชีนี้)</div>
                    <div class="text-xl font-extrabold text-slate-900 mt-1">
                        ${cases.filter(c => c.lawyerRole.includes('โจทก์')).length} : ${cases.filter(c => c.lawyerRole.includes('จำเลย')).length} สำนวน
                    </div>
                </div>
                <div class="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div class="text-xs text-slate-500">เอกสารแบบพิมพ์ศาลที่ลงลายเซ็นแล้ว</div>
                    <div class="text-xl font-extrabold text-emerald-700 mt-1">${docs.filter(d => d.signatureImageBase64).length} / ${docs.length} ฉบับ</div>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-xs border border-slate-200">
                    <thead class="bg-slate-900 text-white">
                        <tr>
                            <th class="p-3">รหัสคดี / เลขคดีดำ</th>
                            <th class="p-3">ศาล</th>
                            <th class="p-3">ประเภท</th>
                            <th class="p-3">บทบาททนายความ</th>
                            <th class="p-3">คู่ความ (โจทก์ - จำเลย)</th>
                            <th class="p-3">เสมียนทนายผู้รับผิดชอบ</th>
                            <th class="p-3">จำนวนเอกสารในสำนวน</th>
                            <th class="p-3">สถานะ / นัดถัดไป</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200">
                        ${cases.map(c => {
                            const dCount = docs.filter(d => d.caseId === c.id).length;
                            const clerkProf = this.state.lawyers.find(l => l.id === c.clerkId);
                            return `
                            <tr>
                                <td class="p-3 font-bold">${c.blackCaseNo}/๒๕${c.blackCaseYear}</td>
                                <td class="p-3">ศาล${c.courtName}</td>
                                <td class="p-3 font-semibold">${c.caseCategory}</td>
                                <td class="p-3 font-bold text-blue-900">${c.lawyerRole} (${c.representingPartyOrder || '-'})</td>
                                <td class="p-3">${c.plaintiffName} <span class="text-slate-400">vs</span> ${c.defendantName}</td>
                                <td class="p-3 font-semibold text-indigo-800">👨‍💼 ${clerkProf?.fullName || 'ยังไม่ได้มอบหมาย'}</td>
                                <td class="p-3 font-bold">${dCount} ฉบับ</td>
                                <td class="p-3">${c.status} (${c.nextHearingNote || '-'})</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    // ==================== 8. CASE FILE REPOSITORY & SHARED POPUP VIEWER ====================

    openCaseFilesDirectory(caseId) {
        this.state.currentCaseId = Number(caseId);
        const sel = document.getElementById('filesFilterCaseSelect');
        if (sel) sel.value = String(caseId);
        this.switchTab('files');
    },

    populateFilesFilterDropdowns() {
        const accessibleCases = this.getAccessibleCases();
        const accessibleFiles = this.getAccessibleCaseFiles();
        const sel = document.getElementById('filesFilterCaseSelect');
        if (sel) {
            const cur = sel.value || 'ALL';
            sel.innerHTML = `<option value="ALL">แสดงทุกสำนวนคดีของคุณ (${accessibleFiles.length} ไฟล์)</option>` +
                accessibleCases.map(c => {
                    const cFiles = accessibleFiles.filter(f => Number(f.caseId) === Number(c.id));
                    const cPages = cFiles.reduce((s, f) => s + (Number(f.pageCount) || 1), 0);
                    return `
                        <option value="${c.id}" ${String(c.id) === cur ? 'selected' : ''}>
                            [คดี${c.caseCategory} - ${c.lawyerRole}] ${c.blackCaseNo}/๒๕${c.blackCaseYear} (${c.plaintiffName} vs ${c.defendantName}) — ${cFiles.length} ไฟล์ (${cPages} หน้า)
                        </option>
                    `;
                }).join('');
        }
        const upCase = document.getElementById('upCaseId');
        if (upCase) {
            upCase.innerHTML = accessibleCases.map(c => {
                const cFiles = accessibleFiles.filter(f => Number(f.caseId) === Number(c.id));
                const cPages = cFiles.reduce((s, f) => s + (Number(f.pageCount) || 1), 0);
                return `
                    <option value="${c.id}" ${c.id === Number(this.state.currentCaseId) ? 'selected' : ''}>
                        [${c.caseCategory}] คดีดำที่ ${c.blackCaseNo}/๒๕${c.blackCaseYear} (${c.plaintiffName} vs ${c.defendantName}) — มีแล้ว ${cFiles.length} ไฟล์ (${cPages} หน้า)
                    </option>
                `;
            }).join('');
        }

        const filterCaseVal = document.getElementById('filesFilterCaseSelect')?.value || 'ALL';
        this.populateFormCodeDropdownWithStats('filesFilterFormCodeSelect', filterCaseVal, {
            includeAll: true,
            includeZero: true
        });

        const upCaseVal = document.getElementById('upCaseId')?.value || this.state.currentCaseId;
        this.populateFormCodeDropdownWithStats('upFormCode', upCaseVal, {
            defaultValue: document.getElementById('upFormCode')?.value || '(๗)'
        });
        this.updateUploadModalFormStatusBadge(upCaseVal, document.getElementById('upFormCode')?.value || '(๗)');
    },

    onUploadModalCaseChange(caseId) {
        const curFormCode = document.getElementById('upFormCode')?.value || '(๗)';
        this.populateFormCodeDropdownWithStats('upFormCode', caseId, { defaultValue: curFormCode });
        this.updateUploadModalFormStatusBadge(caseId, curFormCode);
    },

    onUploadModalFormCodeChange(formCode) {
        const caseId = document.getElementById('upCaseId')?.value || this.state.currentCaseId;
        if (formCode === '(๑๖)') {
            const title = document.getElementById('upFileTitle');
            const remark = document.getElementById('upRemark');
            if (title && !title.value.trim()) title.placeholder = 'เช่น รายงานกระบวนพิจารณา นัดวันที่ ๑๕ พฤศจิกายน ๒๕๖๙';
            if (remark && !remark.value.trim()) remark.placeholder = 'ระบุวันนัดหรือครั้งที่นัด เพื่อค้นหาเอกสารได้ง่าย';
        }
        this.updateUploadModalFormStatusBadge(caseId, formCode);
    },

    updateUploadModalFormStatusBadge(caseId, formCode) {
        const badgeEl = document.getElementById('upFormCodeStatusBadge');
        if (!badgeEl) return;
        const st = this.getFormCodeFileStats(caseId, formCode);
        const meta = this.getDirectoryMeta(formCode);

        if (st.fileCount > 0) {
            const fileNames = [
                ...st.files.map(f => `${f.fileTitle} (${f.pageCount || 1} หน้า • ${f.fileStatus || 'ยื่นต่อศาลแล้ว'})`),
                ...st.docs.map(d => `${d.documentTitle} (แบบพิมพ์ในสตูดิโอ • ${d.status || 'ฉบับสมบูรณ์'})`)
            ];
            badgeEl.innerHTML = `
                <div class="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-[11px] flex flex-col gap-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="font-bold">✅ หมวด ${formCode} ${meta.name}: มีเอกสารในสำนวนนี้แล้ว <strong>${st.fileCount} ไฟล์ (รวม ${st.totalPages} หน้า)</strong></span>
                        <span class="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold text-[10px]">สถานะล่าสุด: ${st.latestStatus}</span>
                    </div>
                    <div class="text-emerald-800 truncate">📄 รายการที่มีอยู่: ${fileNames.join(' | ')}</div>
                </div>
            `;
        } else {
            badgeEl.innerHTML = `
                <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-[11px] flex items-center justify-between">
                    <span>⚪ หมวด <strong>${formCode} ${meta.name}</strong>: ยังไม่มีไฟล์ในสำนวนคดีนี้ (0 ไฟล์ • 0 หน้า)</span>
                    <span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[10px]">พร้อมอัปโหลดไฟล์แรก</span>
                </div>
            `;
        }
    },

    renderFilesDirectoryView() {
        const container = document.getElementById('filesDirectoryTableContainer');
        if (!container) return;

        const caseFilter = document.getElementById('filesFilterCaseSelect')?.value || 'ALL';
        const canDeleteFiles = this.state.currentUser?.role === 'Lawyer';
        this.populateFormCodeDropdownWithStats('filesFilterFormCodeSelect', caseFilter, {
            includeAll: true,
            includeZero: true,
            defaultValue: document.getElementById('filesFilterFormCodeSelect')?.value || 'ALL'
        });
        const codeFilter = document.getElementById('filesFilterFormCodeSelect')?.value || 'ALL';
        const statusFilter = document.getElementById('filesFilterStatusSelect')?.value || 'ALL';

        const filtered = this.getAccessibleCaseFiles().filter(f => {
            if (caseFilter !== 'ALL' && Number(f.caseId) !== Number(caseFilter)) return false;
            if (codeFilter !== 'ALL' && f.formCode !== codeFilter) return false;
            if (statusFilter !== 'ALL' && !(f.fileStatus || '').includes(statusFilter)) return false;
            return true;
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">ไม่พบรายการไฟล์เอกสารในหมวดที่เลือกสำหรับบัญชีทนายความนี้ สามารถกดปุ่ม "+ อัปโหลดไฟล์ PDF / รูปภาพ" หรือบันทึกจากหน้าสตูดิโอได้ทันที</div>`;
            return;
        }

        container.innerHTML = `
            <table class="w-full text-left border-collapse text-xs border border-slate-200 rounded-xl overflow-hidden">
                <thead class="bg-slate-900 text-white">
                    <tr>
                        <th class="p-3">ลำดับสารบัญศาล</th>
                        <th class="p-3">สำนวนคดี</th>
                        <th class="p-3">ชื่อคำร้อง / เอกสารในสำนวน</th>
                        <th class="p-3">วันที่อัปโหลด</th>
                        <th class="p-3">ประเภทไฟล์</th>
                        <th class="p-3">สถานะไฟล์</th>
                        <th class="p-3">ผู้จัดเก็บ / จำนวนแผ่น</th>
                        <th class="p-3 text-right">การจัดการ &amp; ป๊อบอัพอ่านไฟล์</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 bg-white">
                    ${filtered.map(f => {
                        const lawCase = this.getAccessibleCases().find(c => c.id === f.caseId);
                        const meta = this.getDirectoryMeta(f.formCode);
                        const typeBadge = f.storageType === 'PDF'
                            ? `<span class="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[11px]">📄 PDF</span>`
                            : f.storageType === 'IMAGE'
                                ? `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px]">🖼️ รูปภาพ</span>`
                                : f.storageType === 'COURT_FORM'
                                    ? `<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[11px]">⚖️ ฟอร์มศาล</span>`
                                    : `<span class="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold text-[11px]">🔗 Link</span>`;

                        return `
                        <tr class="hover:bg-slate-50 transition" data-file-id="${f.id}">
                            <td class="p-3">
                                <div class="font-extrabold text-slate-900">${f.formCode}</div>
                                <div class="text-[11px] text-slate-500">${this.escapeHtml(f.directoryCategoryName || meta.name)}</div>
                            </td>
                            <td class="p-3">
                                <div class="font-bold text-slate-900">${lawCase ? `${lawCase.blackCaseNo}/๒๕${lawCase.blackCaseYear}` : `คดี #${f.caseId}`}</div>
                                <div class="text-[11px] text-slate-500">${lawCase ? `${lawCase.lawyerRole}` : ''}</div>
                            </td>
                            <td class="p-3">
                                <div class="font-bold text-slate-900">${this.escapeHtml(f.fileTitle)}</div>
                                <div class="text-[11px] text-slate-500">${this.escapeHtml(f.remark || '')}</div>
                            </td>
                            <td class="p-3 whitespace-nowrap">${this.formatUploadDate(f.createdAt)}</td>
                            <td class="p-3">${typeBadge}</td>
                            <td class="p-3">
                                <div class="flex flex-col gap-1">
                                    <div>${this.getFileStatusBadgeHtml(f.fileStatus)}</div>
                                    <select onchange="App.updateCaseFileStatus(${f.id}, this.value)" class="px-2 py-0.5 rounded border border-slate-300 text-[11px] bg-white">
                                        ${['ร่าง', 'ตรวจทานแล้ว', 'ลงนามแล้ว', 'ยื่นต่อศาลแล้ว', 'ศาลรับคำคู่ความแล้ว'].map(st => `
                                            <option value="${st}" ${f.fileStatus === st ? 'selected' : ''}>เปลี่ยนสถานะ: ${st}</option>
                                        `).join('')}
                                    </select>
                                </div>
                            </td>
                            <td class="p-3">
                                <div class="font-semibold text-slate-800">${this.escapeHtml(f.uploadedBy || '-')}</div>
                                <div class="text-[11px] text-slate-500">${f.pageCount || 1} แผ่น</div>
                            </td>
                            <td class="p-3 text-right space-x-1 whitespace-nowrap">
                                <button onclick="App.openCaseFileInPopup(${f.id})" class="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-amber-500 hover:text-slate-950 text-white font-bold text-xs transition shadow-sm">
                                    👁️ เปิดอ่านในป๊อบอัพ
                                </button>
                                ${f.documentId ? `
                                <button onclick="App.openDocInStudio(${f.documentId})" class="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold text-xs">
                                    ✏️ แก้ไขฟอร์ม
                                </button>` : ''}
                                ${canDeleteFiles ? `
                                <button onclick="App.deleteCaseFileAttachment(${f.id})" class="px-2 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 text-xs font-semibold">
                                    ลบ
                                </button>` : ''}
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        `;
    },

    async updateCaseFileStatus(fileId, newStatus) {
        const res = await fetch(`/api/files/${fileId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileStatus: newStatus })
        });
        if (res.ok) {
            await this.loadDashboardData();
            this.renderFilesDirectoryView();
            this.showToast(`อัปเดตสถานะไฟล์เป็น "${newStatus}" เรียบร้อยแล้ว`);
        }
    },

    async deleteCaseFileAttachment(fileId) {
        if (this.state.currentUser?.role !== 'Lawyer') {
            this.showToast('เฉพาะทนายเจ้าของสำนวนเท่านั้นที่ลบไฟล์ได้');
            return;
        }
        if (!window.confirm('ลบไฟล์นี้ถาวรและยกเลิกการแนบจากวันนัด แชทลูกความ และรายการขั้นตอนคดีหรือไม่? ข้อความและรายการคดีจะยังอยู่ แต่จะไม่มีไฟล์แนบ')) return;
        try {
            const res = await fetch(`/api/files/${fileId}?detachLinks=true`, { method: 'DELETE' });
            if (!res.ok) {
                const error = await res.json().catch(() => ({}));
                this.showToast(error.message || `ลบไฟล์ไม่สำเร็จ (HTTP ${res.status})`);
                return;
            }
            await this.loadDashboardData();
            this.renderFilesDirectoryView();
            this.showToast('ลบรายการไฟล์ออกจากคลังสำนวนแล้ว');
        } catch (error) {
            this.showToast(`เชื่อมต่อระบบลบไฟล์ไม่สำเร็จ: ${error.message}`);
        }
    },

    openOfficialCourtPdfInPopup(sampleKey) {
        const names = {
            'form-00': '00_สารบัญแบบพิมพ์ศาล.pdf',
            'form-01': '01_แบบฟอร์มปกหน้าสำนวน.pdf',
            'form-02': '02_แบบฟอร์มหน้าสำนวน.pdf',
            'form-03': '03_แบบฟอร์มสารบาญ.pdf',
            'form-04': '04_แบบพิมพ์คำฟ้อง.pdf',
            'form-05': '05_แบบฟอร์มคำขอท้ายคำฟ้องแพ่ง.pdf',
            'form-06': '06_แบบฟอร์มคำขอท้ายคำฟ้องอาญา.pdf',
            'form-07': '07_แบบฟอร์มคำร้อง.pdf',
            'form-08': '08_แบบฟอร์มบัญชีทรัพย์.pdf',
            'form-09': '09_แบบฟอร์มใบแต่งทนายความ.pdf',
            'form-10': '10_แบบฟอร์มใบมอบฉันทะ.pdf',
            'form-11': '11_แบบฟอร์มคำให้การจำเลย.pdf',
            'form-12': '12_แบบฟอร์มหมายเรียกคดีมโนสาเร่.pdf',
            'form-13': '13_แบบฟอร์มหมายเรียกคดีแพ่งสามัญ.pdf',
            'form-14': '14_แบบฟอร์มหมายเรียกคดีอาญา.pdf'
        };
        this.openPopupFileViewer({
            title: names[sampleKey] || sampleKey,
            storageType: 'PDF',
            url: `/api/files/stream-sample/${sampleKey}`,
            status: 'แบบพิมพ์ศาลยุติธรรมมาตรฐาน (PDF ต้นฉบับ)'
        });
    },

    openCaseFileInPopup(fileId) {
        if (this.state.currentUser?.role === 'Admin') {
            this.showToast('🔒 แอดมินไม่มีสิทธิ์เปิดดูเอกสารในสำนวนคดีของทนายความ');
            return;
        }
        const f = this.getAccessibleCaseFiles().find(x => x.id === Number(fileId));
        if (!f) return;
        const lawCase = this.getAccessibleCases().find(c => c.id === f.caseId);
        const doc = f.documentId ? this.getAccessibleDocuments().find(d => d.id === f.documentId) : null;

        this.openPopupFileViewer({
            title: `${f.formCode} ${f.fileTitle}`,
            subtitle: `${lawCase ? `สำนวนคดีดำที่ ${lawCase.blackCaseNo}/๒๕${lawCase.blackCaseYear} (ศาล${lawCase.courtName})` : ''} • สถานะ: ${f.fileStatus} • ผู้จัดเก็บ: ${f.uploadedBy || '-'}`,
            storageType: f.storageType,
            url: f.fileUrlOrPath,
            dataBase64: f.fileDataBase64,
            document: doc,
            lawCase: lawCase
        });
    },

    // ฟังก์ชันกลางสำหรับเปิดป๊อบอัพอ่านไฟล์ PDF, ดูไฟล์ภาพ (ซูมได้), ดูสลิปโอนเงิน หรือดูแบบพิมพ์ศาล (ใช้ร่วมกันทั้งระบบ)
    openPopupFileViewer(options) {
        const modal = document.getElementById('filePreviewModal');
        const badge = document.getElementById('popupViewerBadge');
        const title = document.getElementById('popupViewerTitle');
        const sub = document.getElementById('popupViewerSub');
        const body = document.getElementById('popupViewerBody');
        const dlBtn = document.getElementById('popupViewerDownloadBtn');
        if (!modal || !body) return;

        this.state.imageZoomScale = 1;
        const stType = options.storageType || 'PDF';
        if (badge) badge.textContent = stType;
        if (title) title.textContent = options.title || 'เปิดอ่านไฟล์เอกสาร';
        if (sub) sub.textContent = options.subtitle || options.status || '';

        const srcUrl = options.dataBase64 || options.url || '';
        if (dlBtn) {
            if (srcUrl) {
                dlBtn.href = srcUrl;
                dlBtn.classList.remove('hidden');
            } else {
                dlBtn.classList.add('hidden');
            }
        }

        if (stType === 'PDF' && srcUrl) {
            body.innerHTML = `
                <div class="w-full h-full flex flex-col gap-2">
                    <iframe src="${srcUrl}" class="w-full flex-1 rounded-xl border border-slate-300 bg-white shadow-inner" title="PDF Reader"></iframe>
                </div>
            `;
        } else if (stType === 'IMAGE' && srcUrl) {
            body.innerHTML = `
                <div class="w-full h-full flex flex-col items-center justify-between gap-3">
                    <div class="flex items-center gap-2 bg-white px-4 py-1.5 rounded-full shadow border border-slate-200 text-xs font-bold">
                        <button onclick="App.zoomPopupImage(-0.2)" class="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200">➖ ย่อ</button>
                        <button onclick="App.zoomPopupImage(0)" class="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200">๑๐๐%</button>
                        <button onclick="App.zoomPopupImage(0.2)" class="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200">➕ ขยาย</button>
                    </div>
                    <div class="flex-1 w-full overflow-auto flex items-center justify-center p-4">
                        <img id="popupZoomableImg" src="${srcUrl}" style="transform: scale(1); transform-origin: top center; transition: transform 0.18s ease;" class="max-w-full rounded-xl shadow-lg border border-slate-300 bg-white" alt="Preview Image" />
                    </div>
                </div>
            `;
        } else if (stType === 'COURT_FORM' && options.document) {
            const pagesHtml = window.CourtRenderer.renderDocumentPagesHtml(options.document, options.lawCase);
            body.innerHTML = `
                <div class="w-full h-full overflow-y-auto p-4">
                    <div class="court-paper-wrapper">${pagesHtml}</div>
                </div>
            `;
        } else if (srcUrl) {
            body.innerHTML = `
                <div class="bg-white p-8 rounded-2xl border border-slate-200 shadow-lg text-center space-y-4 max-w-lg">
                    <div class="text-4xl">🔗</div>
                    <div class="font-bold text-base text-slate-900">${options.title}</div>
                    <div class="text-xs text-slate-500 break-all">${srcUrl}</div>
                    <a href="${srcUrl}" target="_blank" class="inline-block px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow">
                        เปิดลิงก์เอกสารในแท็บใหม่ ↗
                    </a>
                </div>
            `;
        }

        modal.classList.remove('hidden');
    },

    zoomPopupImage(delta) {
        if (delta === 0) this.state.imageZoomScale = 1;
        else this.state.imageZoomScale = Math.min(2.5, Math.max(0.5, this.state.imageZoomScale + delta));
        const img = document.getElementById('popupZoomableImg');
        if (img) img.style.transform = `scale(${this.state.imageZoomScale})`;
    },

    closePopupFileViewer() {
        document.getElementById('filePreviewModal')?.classList.add('hidden');
        const body = document.getElementById('popupViewerBody');
        if (body) body.innerHTML = '';
    },

    // บันทึกคำร้อง/คำฟ้องที่กำลังทำใน Studio เข้าคลังสารบัญสำนวนคดี (พร้อมแปลงเป็นไฟล์ภาพเก็บไว้และผูกแบบพิมพ์ศาล)
    async archiveCurrentFormToCaseDirectory() {
        const doc = this.collectCurrentDocFromInputs();
        const lawCase = this.state.cases.find(c => c.id === Number(doc.caseId));
        const meta = this.getDirectoryMeta(doc.formCode);

        // สร้างไฟล์ภาพ Snapshot ของแบบพิมพ์ศาล (SVG Image) เพื่อจัดเก็บเป็นไฟล์ภาพในสารบัญสำนวนด้วย
        const svgSnap = `<svg xmlns='http://www.w3.org/2000/svg' width='794' height='1123' viewBox='0 0 794 1123'>
            <rect width='794' height='1123' fill='#ffffff' stroke='#cbd5e1' stroke-width='2'/>
            <circle cx='85' cy='70' r='16' fill='none' stroke='#0f172a' stroke-width='2'/>
            <text x='115' y='76' font-family='Sarabun, sans-serif' font-size='18' font-weight='700' fill='#0f172a'>${doc.formCode} ${doc.documentTitle}</text>
            <text x='720' y='76' font-family='Sarabun, sans-serif' font-size='15' font-weight='700' fill='#0f172a' text-anchor='end'>คดีหมายเลขดำที่ ${lawCase?.blackCaseNo || '........'}/๒๕${lawCase?.blackCaseYear || '....'}</text>
            <text x='720' y='100' font-family='Sarabun, sans-serif' font-size='15' font-weight='700' fill='#b91c1c' text-anchor='end'>คดีหมายเลขแดง ${lawCase?.redCaseNo || '........'}/๒๕${lawCase?.redCaseYear || '....'}</text>
            <text x='397' y='150' font-family='Sarabun, sans-serif' font-size='20' font-weight='700' fill='#0f172a' text-anchor='middle'>ศาล${lawCase?.courtName || 'จังหวัดศรีสะเกษ'} • ความ${lawCase?.caseCategory || 'อาญา/แพ่ง'}</text>
            <text x='397' y='182' font-family='Sarabun, sans-serif' font-size='16' fill='#334155' text-anchor='middle'>วันที่ ${doc.docDay} เดือน ${doc.docMonth} พุทธศักราช ๒๕${doc.docYear}</text>
            <rect x='65' y='210' width='664' height='70' rx='8' fill='#f8fafc' stroke='#94a3b8'/>
            <text x='85' y='240' font-family='Sarabun, sans-serif' font-size='16' font-weight='700' fill='#0f172a'>โจทก์: ${lawCase?.plaintiffName || '-'}</text>
            <text x='85' y='266' font-family='Sarabun, sans-serif' font-size='16' font-weight='700' fill='#0f172a'>จำเลย: ${lawCase?.defendantName || '-'}</text>
            <text x='65' y='320' font-family='Sarabun, sans-serif' font-size='16' font-weight='700' fill='#1e3a8a'>ผู้ยื่นคำคู่ความ: ${doc.requesterFullName} (${doc.requesterStatus})</text>
            <text x='397' y='920' font-family='Sarabun, sans-serif' font-size='18' font-weight='700' fill='#0f172a' text-anchor='middle'>      ${doc.closingPrayer || 'ควรมิควรแล้วแต่จะโปรด'}</text>
            <text x='397' y='965' font-family='Sarabun, sans-serif' font-size='16' fill='#0f172a' text-anchor='middle'>ลงชื่อ ....................................................... ${doc.signerRole || ''}</text>
            <text x='397' y='995' font-family='Sarabun, sans-serif' font-size='16' fill='#0f172a' text-anchor='middle'>(${doc.signerName || doc.requesterFullName})</text>
            <text x='397' y='1040' font-family='Sarabun, sans-serif' font-size='14' fill='#475569' text-anchor='middle'>คำคู่ความฉบับนี้ ${doc.drafterName || '-'} เป็นผู้เรียง / ${doc.typistName || '-'} เป็นผู้พิมพ์</text>
        </svg>`;
        const imgBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgSnap)));

        const actualPageCount = document.querySelectorAll('#studioPaperPreview .court-page').length || 1;
        const payload = {
            caseId: doc.caseId,
            documentId: doc.id || null,
            directoryIndexNo: meta.idx,
            formCode: doc.formCode,
            directoryCategoryName: meta.name,
            fileTitle: `${doc.documentTitle} (${doc.requesterFullName || doc.signerName})`,
            storageType: 'COURT_FORM',
            fileStatus: doc.signatureImageBase64 ? 'ลงนามแล้ว' : 'ร่าง',
            fileUrlOrPath: '',
            fileDataBase64: imgBase64,
            mimeType: 'image/svg+xml',
            pageCount: actualPageCount,
            uploadedBy: this.state.currentUser?.fullName || doc.drafterName || 'ทนายความ',
            remark: `จัดเก็บจากสตูดิโอแบบพิมพ์ศาล (${actualPageCount} หน้า) อ้างอิงสารบัญแบบพิมพ์ศาล ${doc.formCode} ${meta.name}`
        };

        const res = await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            await this.loadDashboardData();
            this.populateStudioDropdowns();
            this.populateFilesFilterDropdowns();
            this.renderFilesDirectoryView();
            this.showToast(`📸 จัดเก็บ "${doc.formCode} ${doc.documentTitle}" (${actualPageCount} หน้า) เข้าคลังสารบัญสำนวนเรียบร้อยแล้ว`);
        }
    },

    openUploadFileModal(defaultType = 'PDF') {
        this.populateFilesFilterDropdowns();
        this.state.pendingUploadBase64 = '';
        this.state.pendingUploadFile = null;
        const stSel = document.getElementById('upStorageType');
        if (stSel) {
            stSel.value = defaultType;
            this.onChangeUploadStorageType(defaultType);
        }
        const upCaseVal = document.getElementById('upCaseId')?.value || this.state.currentCaseId;
        const upFormVal = document.getElementById('upFormCode')?.value || '(๗)';
        this.populateFormCodeDropdownWithStats('upFormCode', upCaseVal, { defaultValue: upFormVal });
        this.updateUploadModalFormStatusBadge(upCaseVal, upFormVal);
        document.getElementById('uploadFileModal')?.classList.remove('hidden');
    },

    closeUploadFileModal() {
        document.getElementById('uploadFileModal')?.classList.add('hidden');
    },

    onChangeUploadStorageType(val) {
        document.getElementById('upFilePickerRow')?.classList.toggle('hidden', val === 'LINK');
        document.getElementById('upLinkInputRow')?.classList.toggle('hidden', val !== 'LINK');
    },

    onSelectAttachmentFile(inputEl) {
        const file = inputEl.files?.[0];
        if (!file) return;
        const titleInput = document.getElementById('upFileTitle');
        if (titleInput && !titleInput.value) {
            titleInput.value = file.name;
        }
        this.state.pendingUploadFile = file;
        this.state.pendingUploadBase64 = '';
        this.state.pendingUploadMimeType = file.type || 'application/pdf';
        const stSel = document.getElementById('upStorageType');
        if (stSel) {
            stSel.value = file.type.startsWith('image/') ? 'IMAGE' : 'PDF';
        }
        const reader = new FileReader();
        reader.onload = e => {
            this.state.pendingUploadBase64 = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    async submitUploadFileAttachment() {
        const caseId = Number(document.getElementById('upCaseId')?.value || this.state.currentCaseId);
        const formCode = document.getElementById('upFormCode')?.value || '(๗)';
        const meta = this.getDirectoryMeta(formCode);
        const storageType = document.getElementById('upStorageType')?.value || 'PDF';
        const fileTitle = document.getElementById('upFileTitle')?.value?.trim() || `${formCode} ${meta.name}`;
        const fileStatus = document.getElementById('upFileStatus')?.value || 'ยื่นต่อศาลแล้ว';
        const pageCount = Number(document.getElementById('upPageCount')?.value || 1);
        const fileUrl = document.getElementById('upFileUrl')?.value?.trim() || (storageType === 'PDF' && !this.state.pendingUploadFile && !this.state.pendingUploadBase64 ? '/api/files/stream-sample/form-07' : '');
        const remark = document.getElementById('upRemark')?.value?.trim() || `อ้างอิงสารบัญแบบพิมพ์ศาล ${formCode} ${meta.name}`;

        const payload = {
            caseId,
            documentId: null,
            directoryIndexNo: meta.idx,
            formCode,
            directoryCategoryName: meta.name,
            fileTitle,
            storageType,
            fileStatus,
            fileUrlOrPath: fileUrl,
            mimeType: this.state.pendingUploadMimeType,
            pageCount,
            uploadedBy: this.state.currentUser?.fullName || 'นายปิยะณัฐ วัชราภรณ์',
            remark
        };

        const body = new FormData();
        for (const [key, value] of Object.entries(payload)) body.append(key, String(value ?? ''));
        if (this.state.pendingUploadFile) body.append('file', this.state.pendingUploadFile, this.state.pendingUploadFile.name);
        const res = await fetch('/api/files', { method: 'POST', body });

        if (res.ok) {
            this.closeUploadFileModal();
            await this.loadDashboardData();
            this.renderFilesDirectoryView();
            this.showToast(`✅ จัดเก็บไฟล์ "${fileTitle}" ลงสารบัญสำนวนเรียบร้อยแล้ว`);
        }
    },

    // ==================== 9. SUBSCRIPTION, 3-CASE TRIAL & SLIP NOTIFICATION VIEW ====================

    renderSubscriptionView() {
        const banner = document.getElementById('currentUserQuotaBanner');
        const activeUser = this.state.currentUser || this.state.users[0];
        const u = this.getEffectiveLawyerAccount() || activeUser;
        const isClerkSession = activeUser?.role === 'Clerk';
        if (banner && u) {
            const remain = Math.max(0, u.maxCasesQuota - u.usedCasesCount);
            const pct = Math.min(100, Math.round((u.usedCasesCount / Math.max(1, u.maxCasesQuota)) * 100));
            const clerkCount = this.state.clerkMappings.filter(m => m.lawyerUserId === u.id).length;
            banner.innerHTML = `
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div class="space-y-1">
                        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-300 text-xs font-bold">
                            <span>${isClerkSession ? `👨‍💼 เสมียน ${activeUser.fullName} (กำลังทำงานภายใต้แอคเคาท์ทนาย: ${u.fullName})` : `⚖️ บัญชีทนายความที่กำลังใช้งาน: ${u.fullName}`}</span>
                            <span>•</span>
                            <span>ใบอนุญาต: ${u.licenseNo || '-'}</span>
                            <span>•</span>
                            <span>เสมียนในสังกัด: ${clerkCount} คน</span>
                        </div>
                        <h2 class="text-xl font-extrabold mt-1">${u.planName}</h2>
                        <p class="text-xs text-slate-300">${u.officeName || ''} • โทร: ${u.phone || '-'} • สถานะบัญชี: <strong class="text-emerald-400">${u.accountStatus}</strong></p>
                    </div>
                    <div class="bg-white/10 backdrop-blur border border-white/15 rounded-2xl p-4 min-w-[280px] space-y-2">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-slate-300">โควต้าสำนวนคดีของทนายความ</span>
                            <span class="font-extrabold text-amber-300 text-sm">${u.usedCasesCount} / ${u.maxCasesQuota} คดี (คงเหลือ ${remain} คดี)</span>
                        </div>
                        <div class="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                            <div class="h-full bg-gradient-to-r from-amber-400 to-emerald-400" style="width:${pct}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }

        const clerksBox = document.getElementById('lawyerClerksManagementContainer');
        if (clerksBox) {
            const filterLawyerId = u?.role === 'Lawyer' ? u.id : null;
            clerksBox.innerHTML = this.renderSharedClerkMappingsHtml(filterLawyerId, false);
        }

        const plansGrid = document.getElementById('subscriptionPlansGrid');
        if (plansGrid) {
            plansGrid.innerHTML = (this.state.plans || []).map(p => {
                const isTrial = p.planCategory === 'Trial';
                const isYearly = p.planCategory === 'Yearly';
                return `
                <div class="rounded-2xl border ${isYearly ? 'border-amber-400 bg-amber-50/40 shadow-md' : 'border-slate-200 bg-white'} p-5 flex flex-col justify-between space-y-4">
                    <div class="space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ${isTrial ? 'bg-indigo-100 text-indigo-800' : isYearly ? 'bg-amber-400 text-slate-950' : 'bg-emerald-100 text-emerald-800'}">
                                ${p.planCategory === 'Trial' ? '🎁 ทดลองใช้ฟรี' : p.planCategory === 'Monthly' ? '📅 รายเดือน' : p.planCategory === 'Yearly' ? '👑 รายปี VIP' : '📦 ซื้อโควต้าเพิ่ม'}
                            </span>
                            <span class="text-xs font-bold text-slate-500">+${p.casesQuotaIncluded} คดี</span>
                        </div>
                        <div class="font-bold text-sm text-slate-900">${p.planName}</div>
                        <div class="text-2xl font-extrabold text-slate-900">
                            ${p.priceBaht === 0 ? 'ฟรี ๐ บาท' : `${p.priceBaht.toLocaleString()} <span class="text-xs font-normal text-slate-500">บาท</span>`}
                        </div>
                        <p class="text-xs text-slate-600 leading-relaxed">${p.description || ''}</p>
                    </div>
                    <div class="pt-2 border-t border-slate-100">
                        ${isTrial ? `
                            <button onclick="App.openRegisterLawyerModal()" class="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition">
                                ลงทะเบียนรับสิทธิ์ฟรี ๓ คดี
                            </button>
                        ` : `
                            <button onclick="App.openPaymentSlipModal(${p.id})" class="w-full py-2 rounded-xl bg-slate-900 hover:bg-emerald-600 text-white text-xs font-bold transition">
                                💳 เลือกแพ็กเกจ &amp; แจ้งสลิปโอน
                            </button>
                        `}
                    </div>
                </div>`;
            }).join('');
        }

        const slipsTable = document.getElementById('userPaymentSlipsTable');
        if (slipsTable) {
            slipsTable.innerHTML = this.renderSharedSlipsTableHtml(false);
        }
    },

    renderSharedSlipsTableHtml(isAdminMode = false) {
        const list = this.state.paymentSlips || [];
        if (list.length === 0) {
            return `<div class="p-6 text-center text-xs text-slate-500">ยังไม่มีรายการแจ้งสลิปโอนเงิน</div>`;
        }
        return `
            <table class="w-full text-left border-collapse text-xs border border-slate-200 rounded-xl overflow-hidden">
                <thead class="bg-slate-900 text-white">
                    <tr>
                        <th class="p-3">รหัสสลิป / วันเวลาโอน</th>
                        <th class="p-3">ทนายความผู้แจ้งโอน</th>
                        <th class="p-3">แพ็กเกจ / โควต้าคดีที่ขอเพิ่ม</th>
                        <th class="p-3">จำนวนเงิน (บาท)</th>
                        <th class="p-3">หลักฐานสลิปโอนเงิน</th>
                        <th class="p-3">สถานะการตรวจสอบ</th>
                        ${isAdminMode ? `<th class="p-3 text-right">การอนุมัติโควต้า (Admin)</th>` : ''}
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 bg-white">
                    ${list.map(s => {
                        const stBadge = s.status === 'อนุมัติแล้ว'
                            ? `<span class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-[11px]">✅ อนุมัติแล้ว</span>`
                            : s.status === 'ปฏิเสธ'
                                ? `<span class="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 font-bold text-[11px]">❌ ปฏิเสธ</span>`
                                : `<span class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[11px]">⏳ รอแอดมินอนุมัติ</span>`;
                        return `
                        <tr class="hover:bg-slate-50">
                            <td class="p-3">
                                <div class="font-bold text-slate-900">#SLIP-${s.id}</div>
                                <div class="text-[11px] text-slate-500">${s.transferDateText || '-'} ${s.transferTimeText || ''} (${s.bankName || ''})</div>
                            </td>
                            <td class="p-3 font-bold text-slate-900">${s.userFullName}</td>
                            <td class="p-3">
                                <div class="font-bold text-indigo-900">${s.planName}</div>
                                <div class="text-[11px] text-emerald-700 font-semibold">+ เพิ่มโควต้า ${s.casesQuotaRequested} คดี</div>
                            </td>
                            <td class="p-3 font-extrabold text-emerald-700 text-sm">${Number(s.amountBaht || 0).toLocaleString()} ฿</td>
                            <td class="p-3">
                                <button onclick="App.openSlipInPopup(${s.id})" class="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-800 font-semibold text-xs border border-slate-300 transition">
                                    🔍 ดูภาพสลิปโอนเงิน
                                </button>
                            </td>
                            <td class="p-3">
                                <div>${stBadge}</div>
                                ${s.adminRemark ? `<div class="text-[11px] text-slate-500 mt-0.5">${s.adminRemark}</div>` : ''}
                            </td>
                            ${isAdminMode ? `
                            <td class="p-3 text-right space-x-1 whitespace-nowrap">
                                ${s.status !== 'อนุมัติแล้ว' ? `
                                <button onclick="App.approvePaymentSlip(${s.id})" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm">
                                    ✅ อนุมัติ &amp; เพิ่ม +${s.casesQuotaRequested} คดี
                                </button>
                                <button onclick="App.rejectPaymentSlip(${s.id})" class="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs border border-rose-200">
                                    ปฏิเสธ
                                </button>` : `<span class="text-[11px] font-semibold text-emerald-700">เพิ่มโควต้าสำเร็จแล้ว</span>`}
                            </td>` : ''}
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        `;
    },

    openSlipInPopup(slipId) {
        const s = this.state.paymentSlips.find(x => x.id === Number(slipId));
        if (!s) return;
        this.openPopupFileViewer({
            title: `หลักฐานสลิปโอนเงิน #SLIP-${s.id} — ${s.userFullName}`,
            subtitle: `แพ็กเกจ: ${s.planName} (+${s.casesQuotaRequested} คดี) • ยอดโอน ${Number(s.amountBaht).toLocaleString()} บาท • สถานะ: ${s.status}`,
            storageType: 'IMAGE',
            dataBase64: s.slipImageBase64,
            url: s.slipImageUrl
        });
    },

    openRegisterLawyerModal() {
        document.getElementById('registerLawyerModal')?.classList.remove('hidden');
    },

    closeRegisterLawyerModal() {
        document.getElementById('registerLawyerModal')?.classList.add('hidden');
    },

    async submitRegisterLawyer() {
        const username = document.getElementById('regUsername')?.value?.trim() || '';
        const passwordHash = document.getElementById('regPassword')?.value?.trim() || '123456';
        const fullName = document.getElementById('regFullName')?.value?.trim() || '';
        const licenseNo = document.getElementById('regLicenseNo')?.value?.trim() || '';
        const citizenId = document.getElementById('regCitizenId')?.value?.trim() || '';
        const phone = document.getElementById('regPhone')?.value?.trim() || '';
        const email = document.getElementById('regEmail')?.value?.trim() || '';
        const officeName = document.getElementById('regOfficeName')?.value?.trim() || '';

        if (!username || !fullName) {
            this.showToast('กรุณากรอก Username และชื่อ-นามสกุลทนายความ');
            return;
        }

        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, passwordHash, fullName, licenseNo, citizenId, phone, email, officeName })
        });
        const data = await res.json();
        if (!res.ok) {
            this.showToast(data.message || 'ไม่สามารถสมัครสมาชิกได้');
            return;
        }

        this.closeRegisterLawyerModal();
        this.state.currentUser = data;
        await this.loadDashboardData();
        this.renderAllViews();
        this.showToast(`🎉 ลงทะเบียนสำเร็จ! ยินดีต้อนรับ ${data.fullName} รับสิทธิ์ทดลองใช้งานฟรี ๓ คดี`);
    },

    openPaymentSlipModal(defaultPlanId = null) {
        this.state.pendingSlipBase64 = '';
        const uSel = document.getElementById('slipUserSelect');
        if (uSel) {
            const lawyerUsers = this.state.users.filter(u => u.role !== 'Admin');
            uSel.innerHTML = lawyerUsers.map(u => `
                <option value="${u.id}" ${u.id === this.state.currentUser?.id ? 'selected' : ''}>
                    ${u.fullName} (โควต้าปัจจุบัน ${u.usedCasesCount}/${u.maxCasesQuota} คดี)
                </option>
            `).join('');
        }

        const pSel = document.getElementById('slipPlanSelect');
        const paidPlans = (this.state.plans || []).filter(p => p.priceBaht > 0);
        if (pSel && paidPlans.length > 0) {
            const chosenId = defaultPlanId || paidPlans[0].id;
            pSel.innerHTML = paidPlans.map(p => `
                <option value="${p.id}" ${p.id === Number(chosenId) ? 'selected' : ''}>
                    ${p.planName} — ราคา ${p.priceBaht.toLocaleString()} บาท (+${p.casesQuotaIncluded} คดี)
                </option>
            `).join('');
            this.onSelectPaymentPlan(chosenId);
        }

        document.getElementById('paymentSlipModal')?.classList.remove('hidden');
    },

    closePaymentSlipModal() {
        document.getElementById('paymentSlipModal')?.classList.add('hidden');
    },

    onSelectPaymentPlan(planId) {
        const p = this.state.plans.find(x => x.id === Number(planId));
        if (!p) return;
        const amtEl = document.getElementById('slipAmount');
        const qEl = document.getElementById('slipQuotaCount');
        const bankBox = document.getElementById('slipBankInfoBox');
        if (amtEl) amtEl.value = p.priceBaht;
        if (qEl) qEl.value = p.casesQuotaIncluded;
        if (bankBox) {
            bankBox.innerHTML = `🏦 <strong>บัญชีสำหรับโอนชำระค่าบริการ:</strong><br/>${p.bankAccountInfo || 'ธ.กรุงไทย เลขที่ 311-0-88999-1 บจก.สมาร์ทลอว์ โซลูชั่น'}`;
        }
    },

    onSelectSlipImageFile(inputEl) {
        const file = inputEl.files?.[0];
        if (!file) return;
        this.state.pendingSlipFile = file;
    },

    async submitPaymentSlip() {
        const userId = Number(document.getElementById('slipUserSelect')?.value || this.state.currentUser?.id || 2);
        const userObj = this.state.users.find(u => u.id === userId);
        const planId = Number(document.getElementById('slipPlanSelect')?.value || 2);
        const planObj = this.state.plans.find(p => p.id === planId);

        const payload = {
            userId,
            userFullName: userObj?.fullName || 'ทนายความสมาชิก',
            planId,
            planName: planObj?.planName || 'แพ็กเกจเพิ่มโควต้าคดี',
            planCategory: planObj?.planCategory || 'QuotaPack',
            amountBaht: Number(document.getElementById('slipAmount')?.value || planObj?.priceBaht || 290),
            casesQuotaRequested: Number(document.getElementById('slipQuotaCount')?.value || planObj?.casesQuotaIncluded || 5),
            transferDateText: document.getElementById('slipDate')?.value || '14/11/2569',
            transferTimeText: document.getElementById('slipTime')?.value || '18:15',
            bankName: document.getElementById('slipBankName')?.value || 'ธนาคารกรุงไทย',
            referenceNote: document.getElementById('slipRefNote')?.value || ''
        };

        const formData = new FormData();
        for (const [key, value] of Object.entries(payload)) formData.append(key, String(value ?? ''));
        if (this.state.pendingSlipFile) formData.append('file', this.state.pendingSlipFile, this.state.pendingSlipFile.name);
        const res = await fetch('/api/payments/slips', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            this.state.pendingSlipFile = null;
            this.state.pendingSlipBase64 = '';
            this.closePaymentSlipModal();
            await this.loadDashboardData();
            this.renderAllViews();
            this.showToast('📤 ส่งแจ้งยอดสลิปโอนเงินเรียบร้อยแล้ว แอดมินสามารถกดอนุมัติเพื่อเพิ่มโควต้าได้ทันที');
        }
    },

    async approvePaymentSlip(slipId) {
        const res = await fetch(`/api/admin/slips/${slipId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reviewedBy: this.state.currentUser?.fullName || 'ผู้ดูแลระบบสูงสุด (Admin)',
                adminRemark: 'ตรวจสอบสลิปถูกต้อง อนุมัติเพิ่มโควต้าคดีอัตโนมัติเรียบร้อย'
            })
        });
        if (res.ok) {
            const data = await res.json();
            await this.loadDashboardData();
            this.renderAllViews();
            this.showToast(`✅ อนุมัติสลิปเรียบร้อย! เพิ่มโควต้า +${data.addedQuota} คดี ให้บัญชี ${data.user?.fullName || ''}`);
        }
    },

    async rejectPaymentSlip(slipId) {
        const res = await fetch(`/api/admin/slips/${slipId}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reviewedBy: this.state.currentUser?.fullName || 'ผู้ดูแลระบบสูงสุด (Admin)',
                adminRemark: 'กรุณาตรวจสอบยอดโอนหรือแนบภาพสลิปใหม่อีกครั้ง'
            })
        });
        if (res.ok) {
            await this.loadDashboardData();
            this.renderAllViews();
            this.showToast('ปฏิเสธรายการสลิปโอนเงินแล้ว');
        }
    },

    async quickAddUserQuota(userId, addCount) {
        const u = this.state.users.find(x => x.id === Number(userId));
        if (!u) return;
        const updated = {
            ...u,
            maxCasesQuota: Number(u.maxCasesQuota || 0) + Number(addCount)
        };
        const res = await fetch(`/api/admin/users/${u.id}/quota`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
        });
        if (res.ok) {
            await this.loadDashboardData();
            this.renderAllViews();
            this.showToast(`✅ เพิ่มโควต้า +${addCount} คดี ให้ ${u.fullName} (รวมเป็น ${updated.maxCasesQuota} คดี) เรียบร้อยแล้ว`);
        }
    },

    openEditPlanModal(planId = null) {
        const p = planId ? this.state.plans.find(x => x.id === Number(planId)) : null;
        document.getElementById('mdlPlanId').value = p ? p.id : 0;
        document.getElementById('mdlPlanCode').value = p ? p.planCode : 'QUOTA-30';
        document.getElementById('mdlPlanCategory').value = p ? p.planCategory : 'QuotaPack';
        document.getElementById('mdlPlanName').value = p ? p.planName : '';
        document.getElementById('mdlPlanPrice').value = p ? p.priceBaht : 990;
        document.getElementById('mdlPlanQuota').value = p ? p.casesQuotaIncluded : 30;
        document.getElementById('mdlPlanDays').value = p ? p.durationDays : 365;
        document.getElementById('mdlPlanDesc').value = p ? p.description : '';
        document.getElementById('mdlPlanBank').value = p ? p.bankAccountInfo : 'ธ.กรุงไทย สาขาศรีสะเกษ เลขที่ 311-0-88999-1 ชื่อบัญชี บจก.สมาร์ทลอว์ โซลูชั่น (พร้อมเพย์ 089-2802450)';
        document.getElementById('editPlanModal')?.classList.remove('hidden');
    },

    closeEditPlanModal() {
        document.getElementById('editPlanModal')?.classList.add('hidden');
    },

    async savePlanConfig() {
        const id = Number(document.getElementById('mdlPlanId').value || 0);
        const payload = {
            id,
            planCode: document.getElementById('mdlPlanCode').value || 'CUSTOM-PLAN',
            planCategory: document.getElementById('mdlPlanCategory').value || 'QuotaPack',
            planName: document.getElementById('mdlPlanName').value || 'แพ็กเกจโควต้าคดี',
            priceBaht: Number(document.getElementById('mdlPlanPrice').value || 0),
            casesQuotaIncluded: Number(document.getElementById('mdlPlanQuota').value || 3),
            durationDays: Number(document.getElementById('mdlPlanDays').value || 30),
            description: document.getElementById('mdlPlanDesc').value || '',
            bankAccountInfo: document.getElementById('mdlPlanBank').value || '',
            isActive: true
        };

        const url = id > 0 ? `/api/admin/plans/${id}` : '/api/admin/plans';
        const method = id > 0 ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            this.closeEditPlanModal();
            await this.loadDashboardData();
            this.renderAllViews();
            this.showToast(`💾 บันทึกราคาแพ็กเกจ "${payload.planName}" (${payload.priceBaht.toLocaleString()} บาท) เรียบร้อยแล้ว`);
        }
    },

    // ==================== 10. BACK-OFFICE ADMIN VIEW (SERVICE MANAGEMENT & CASE TITLES ONLY) ====================
    renderBackofficeView() {
        const headerEl = document.getElementById('adminSummaryHeader');
        if (headerEl) {
            const pendingSlips = (this.state.paymentSlips || []).filter(s => s.status === 'รอตรวจสอบ').length;
            const totalRevenue = (this.state.paymentSlips || []).filter(s => s.status === 'อนุมัติแล้ว').reduce((acc, s) => acc + Number(s.amountBaht || 0), 0);
            headerEl.innerHTML = `
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <div class="text-xs uppercase tracking-wider text-amber-300 font-bold">SmartLaws Admin Service Control Center</div>
                        <h2 class="text-xl font-extrabold mt-0.5">ระบบบริหารจัดการบริการสมาชิกทนายความ ตั้งราคาแพ็กเกจ อนุมัติสลิปโอนเงิน &amp; เพิ่มโควต้าคดี</h2>
                        <p class="text-xs text-rose-200 mt-1">🔒 สิทธิ์แอดมิน (Admin): เห็นเฉพาะระบบบริการและเห็นเฉพาะชื่อคดี ไม่สามารถเข้าดูข้อมูลคดี คู่ความ หรือเอกสารสำนวนของทนายความได้</p>
                    </div>
                    <div class="flex flex-wrap gap-3 text-xs">
                        <div class="bg-white/10 px-4 py-2.5 rounded-xl border border-white/15">
                            <div class="text-slate-300">สมาชิกทั้งหมด</div>
                            <div class="text-lg font-extrabold text-white">${this.state.users.length} บัญชี</div>
                        </div>
                        <div class="bg-amber-500/20 px-4 py-2.5 rounded-xl border border-amber-400/40">
                            <div class="text-amber-200">สลิปรอตรวจสอบ</div>
                            <div class="text-lg font-extrabold text-amber-300">${pendingSlips} รายการ</div>
                        </div>
                        <div class="bg-emerald-500/20 px-4 py-2.5 rounded-xl border border-emerald-400/40">
                            <div class="text-emerald-200">ยอดอนุมัติสะสม</div>
                            <div class="text-lg font-extrabold text-emerald-300">${totalRevenue.toLocaleString()} บาท</div>
                        </div>
                    </div>
                </div>
            `;
        }

        // ตารางแสดงเฉพาะชื่อคดี (Case Titles Only) โดยปกปิดข้อมูลคู่ความ ทุนทรัพย์ และเอกสารคำคู่ความของทนายความ
        const adminServiceCasesEl = document.getElementById('adminServiceCasesTitleOnlyContainer');
        if (adminServiceCasesEl) {
            const serviceCases = this.getAdminServiceCaseTitlesOnly();
            adminServiceCasesEl.innerHTML = `
                <table class="w-full text-left border-collapse text-xs border border-slate-200 rounded-xl overflow-hidden">
                    <thead class="bg-slate-900 text-white">
                        <tr>
                            <th class="p-3">รหัสระบบ</th>
                            <th class="p-3">ชื่อคดีในระบบ (แสดงเฉพาะชื่อคดี)</th>
                            <th class="p-3">แอคเคาท์ทนายความเจ้าของสำนวน</th>
                            <th class="p-3">แอคเคาท์เสมียนทนายผู้รับผิดชอบ</th>
                            <th class="p-3">สถานะการใช้งานระบบ</th>
                            <th class="p-3 text-right">การคุ้มครองความลับลูกความ</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 bg-white">
                        ${serviceCases.map(sc => `
                            <tr class="hover:bg-slate-50">
                                <td class="p-3 font-bold text-slate-800">${sc.caseCode}</td>
                                <td class="p-3">
                                    <div class="font-extrabold text-slate-900 text-sm">${sc.caseTitleOnly}</div>
                                    <div class="text-[11px] text-slate-400">ประเภท: คดี${sc.caseCategory}</div>
                                </td>
                                <td class="p-3">
                                    <div class="font-bold text-blue-900">⚖️ ${sc.ownerLawyerName}</div>
                                    <div class="text-[11px] text-slate-500">ใบอนุญาต: ${sc.ownerLicenseNo}</div>
                                </td>
                                <td class="p-3">
                                    <span class="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-900 border border-indigo-200 font-bold text-[11px]">
                                        👨‍💼 ${sc.assignedClerkName}
                                    </span>
                                </td>
                                <td class="p-3 font-semibold text-emerald-700">${sc.statusText}</td>
                                <td class="p-3 text-right">
                                    <span class="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 font-bold text-[11px]">
                                        🔒 ปกปิดข้อมูลคดี/คู่ความ/คำคู่ความของทนาย
                                    </span>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        const adminSlipsEl = document.getElementById('adminSlipsTableContainer');
        if (adminSlipsEl) {
            adminSlipsEl.innerHTML = this.renderSharedSlipsTableHtml(true);
        }

        const adminClerksEl = document.getElementById('adminClerksMappingContainer');
        if (adminClerksEl) {
            adminClerksEl.innerHTML = this.renderSharedClerkMappingsHtml(null, true);
        }

        const adminUsersEl = document.getElementById('adminUsersTableContainer');
        if (adminUsersEl) {
            adminUsersEl.innerHTML = `
                <table class="w-full text-left border-collapse text-xs border border-slate-200 rounded-xl overflow-hidden">
                    <thead class="bg-slate-900 text-white">
                        <tr>
                            <th class="p-3">Username / บทบาท</th>
                            <th class="p-3">ชื่อ-นามสกุลทนายความ / เสมียนทนาย</th>
                            <th class="p-3">เลขใบอนุญาต / สังกัดสำนักงาน</th>
                            <th class="p-3">แพ็กเกจ / สังกัดแอคเคาท์ทนาย</th>
                            <th class="p-3">โควต้าสำนวนคดี / เสมียนในสังกัด</th>
                            <th class="p-3 text-right">การจัดการโควต้า, ตั้งเสมียน &amp; สลับบัญชีทดสอบ</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 bg-white">
                        ${(this.state.users || []).map(u => {
                            const isClerk = u.role === 'Clerk';
                            const isLawyer = u.role === 'Lawyer';
                            const clerkLawyers = this.state.clerkMappings.filter(m => m.clerkUserId === u.id);
                            const lawyerClerks = this.state.clerkMappings.filter(m => m.lawyerUserId === u.id);
                            const roleBadgeClass = u.role === 'Admin'
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : isClerk
                                    ? 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                                    : 'bg-blue-100 text-blue-800 border border-blue-300';
                            const roleText = u.role === 'Admin' ? 'Admin' : isClerk ? '👨‍💼 เสมียนทนาย (Sub-Account)' : '⚖️ ทนายความ (Lawyer)';

                            return `
                            <tr class="hover:bg-slate-50">
                                <td class="p-3">
                                    <div class="font-bold text-slate-900">@${u.username}</div>
                                    <span class="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold ${roleBadgeClass}">${roleText}</span>
                                </td>
                                <td class="p-3">
                                    <div class="font-bold text-slate-900">${u.fullName}</div>
                                    <div class="text-[11px] text-slate-500">โทร: ${u.phone || '-'} | ปชช.: ${u.citizenId || '-'}</div>
                                </td>
                                <td class="p-3">
                                    <div class="font-semibold text-slate-800">${u.licenseNo || '-'}</div>
                                    <div class="text-[11px] text-slate-500">${u.officeName || '-'}</div>
                                </td>
                                <td class="p-3">
                                    ${isClerk ? `
                                        <div class="text-[11px] font-bold text-indigo-900 mb-1">ทำงานให้ทนายความ ${clerkLawyers.length} ท่าน:</div>
                                        <div class="flex flex-wrap gap-1">
                                            ${clerkLawyers.map(m => `<span class="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold text-[10px]">⚖️ ${m.lawyerFullName}</span>`).join('') || '<span class="text-slate-400">ยังไม่ได้ผูกสังกัดทนาย</span>'}
                                        </div>
                                    ` : `
                                        <span class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[11px]">${u.planName}</span>
                                    `}
                                </td>
                                <td class="p-3">
                                    ${isClerk ? `
                                        <div class="text-xs font-bold text-indigo-700">ใช้โควต้าร่วมกับแอคเคาท์ทนายต้นสังกัด</div>
                                        <div class="text-[11px] text-slate-500">ผู้พิมพ์คำคู่ความ &amp; ผู้รับมอบฉันทะ</div>
                                    ` : `
                                        <div class="font-extrabold text-sm ${u.usedCasesCount >= u.maxCasesQuota ? 'text-rose-600' : 'text-emerald-700'}">
                                            ใช้ไป ${u.usedCasesCount} / ${u.maxCasesQuota} คดี
                                        </div>
                                        ${isLawyer ? `<div class="text-[11px] text-indigo-700 font-semibold mt-0.5">👨‍💼 มีเสมียนในสังกัด ${lawyerClerks.length} คน: ${lawyerClerks.map(c => c.clerkFullName).join(', ') || '-'}</div>` : ''}
                                    `}
                                </td>
                                <td class="p-3 text-right space-x-1 whitespace-nowrap">
                                    ${isClerk ? `
                                        <button onclick="App.openManageClerkModal(null, ${u.id})" class="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs">
                                            + ผูกเพิ่มกับทนายท่านอื่น
                                        </button>
                                    ` : `
                                        ${isLawyer ? `
                                        <button onclick="App.openManageClerkModal(${u.id})" class="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs">
                                            👨‍💼 ตั้งเสมียน
                                        </button>` : ''}
                                        <button onclick="App.quickAddUserQuota(${u.id}, 3)" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs">
                                            + เพิ่ม ๓ คดี
                                        </button>
                                        <button onclick="App.quickAddUserQuota(${u.id}, 10)" class="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs">
                                            + เพิ่ม ๑๐ คดี
                                        </button>
                                    `}
                                    <button onclick="App.switchActiveAccount(${u.id})" class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-amber-400 hover:text-slate-950 text-white font-semibold text-xs">
                                        สลับเข้าบัญชีนี้
                                    </button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }

        const adminPlansEl = document.getElementById('adminPlansConfigTable');
        if (adminPlansEl) {
            adminPlansEl.innerHTML = `
                <table class="w-full text-left border-collapse text-xs border border-slate-200 rounded-xl overflow-hidden">
                    <thead class="bg-slate-900 text-white">
                        <tr>
                            <th class="p-3">รหัสแพ็กเกจ</th>
                            <th class="p-3">ชื่อแพ็กเกจบริการ</th>
                            <th class="p-3">ประเภท</th>
                            <th class="p-3">ราคาที่ตั้งไว้ (บาท)</th>
                            <th class="p-3">โควต้าคดีที่ได้รับ</th>
                            <th class="p-3">ระยะเวลา (วัน)</th>
                            <th class="p-3 text-right">ปรับตั้งราคา / โควต้า</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 bg-white">
                        ${(this.state.plans || []).map(p => `
                            <tr class="hover:bg-slate-50">
                                <td class="p-3 font-bold">${p.planCode}</td>
                                <td class="p-3">
                                    <div class="font-bold text-slate-900">${p.planName}</div>
                                    <div class="text-[11px] text-slate-500">${p.description || ''}</div>
                                </td>
                                <td class="p-3 font-semibold">${p.planCategory}</td>
                                <td class="p-3 font-extrabold text-emerald-700 text-sm">${p.priceBaht.toLocaleString()} บาท</td>
                                <td class="p-3 font-bold text-indigo-900">+${p.casesQuotaIncluded} คดี</td>
                                <td class="p-3">${p.durationDays} วัน</td>
                                <td class="p-3 text-right">
                                    <button onclick="App.openEditPlanModal(${p.id})" class="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs">
                                        ⚙️ แก้ไขราคา/โควต้า
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        const lawyersEl = document.getElementById('backofficeLawyersList');
        if (lawyersEl) {
            lawyersEl.innerHTML = this.state.lawyers.map(l => `
                <div class="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
                    <div>
                        <div class="font-bold text-sm text-slate-900">${l.fullName} <span class="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-900 ml-1">${l.roleType}</span></div>
                        <div class="text-xs text-slate-600 mt-1">ใบอนุญาต: <strong>${l.licenseNo}</strong> • เลข ปชช.: ${l.citizenId}</div>
                        <div class="text-xs text-slate-500">ที่อยู่: ${l.houseNo} ถ.${l.road} ต.${l.subDistrict} อ.${l.district} จ.${l.province} ${l.postalCode} • โทร: ${l.phone}</div>
                    </div>
                    ${l.signatureDataUrl ? `<img src="${l.signatureDataUrl}" class="h-12 bg-white px-2 py-1 rounded border border-slate-200" alt="sig" />` : ''}
                </div>
            `).join('');
        }

        const tplEl = document.getElementById('backofficeTemplatesList');
        if (tplEl) {
            tplEl.innerHTML = this.state.templates.map(t => `
                <div class="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-xs text-slate-900">${t.formCode} — ${t.formName}</span>
                        <span class="text-[11px] px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-semibold">${t.category} / ${t.applicableRole}</span>
                    </div>
                    <div class="text-[11px] text-slate-600">${t.description}</div>
                    <div class="text-[10px] text-amber-800 font-medium">ไฟล์ต้นฉบับอ้างอิง: ${t.sourceWordFileName} | ${t.proceduralLawRef}</div>
                </div>
            `).join('');
        }
    },

    // ==================== SHARED LAWYER <-> CLERK (MANY-TO-MANY) MANAGEMENT ====================
    renderSharedClerkMappingsHtml(filterLawyerUserId = null, isAdminMode = false) {
        const allMappings = this.state.clerkMappings || [];
        const list = filterLawyerUserId
            ? allMappings.filter(m => m.lawyerUserId === Number(filterLawyerUserId))
            : allMappings;

        // สรุปการ์ดเสมียนแต่ละคนว่าทำงานให้ทนายกี่ท่าน (Many-to-Many)
        const clerkUsers = (this.state.users || []).filter(u => u.role === 'Clerk');
        const summaryCardsHtml = clerkUsers.map(cu => {
            const assignedLawyers = allMappings.filter(m => m.clerkUserId === cu.id);
            const clerkProfile = this.state.lawyers.find(l => l.id === cu.lawyerProfileId);
            return `
                <div class="p-4 rounded-xl border border-indigo-200 bg-indigo-50/50 flex flex-wrap items-center justify-between gap-3">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="px-2.5 py-0.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold">👨‍💼 แอคเคาท์เสมียนทนาย (@${cu.username})</span>
                            <span class="font-extrabold text-sm text-slate-900">${cu.fullName}</span>
                            <span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[11px] font-bold">
                                ปฏิบัติงานให้ทนายความ ${assignedLawyers.length} ท่าน
                            </span>
                        </div>
                        <div class="text-xs text-slate-600">
                            เลข ปชช.: ${cu.citizenId || '-'} • โทร: ${cu.phone || '-'} • ที่อยู่: ${clerkProfile ? `${clerkProfile.houseNo} ต.${clerkProfile.subDistrict} อ.${clerkProfile.district} จ.${clerkProfile.province}` : cu.officeName}
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5 pt-1">
                            <span class="text-[11px] font-bold text-indigo-900">ทนายความที่ตั้งเสมียนท่านนี้ไว้ในสังกัด:</span>
                            ${assignedLawyers.map(m => `
                                <span class="px-2.5 py-0.5 rounded-lg bg-white border border-indigo-300 text-indigo-950 font-bold text-[11px] shadow-sm">
                                    ⚖️ ${m.lawyerFullName} (${m.lawyerLicenseNo || '-'})
                                </span>
                            `).join('') || '<span class="text-xs text-slate-400">ยังไม่มีทนายความผูกสังกัด</span>'}
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        ${clerkProfile?.signatureDataUrl ? `<img src="${clerkProfile.signatureDataUrl}" class="h-10 bg-white px-2 py-1 rounded border border-indigo-200" alt="clerk sig" />` : ''}
                        <button onclick="App.openManageClerkModal(null, ${cu.id})" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm">
                            + แอดเสมียนท่านนี้ให้ทนายอื่น
                        </button>
                        <button onclick="App.switchActiveAccount(${cu.id})" class="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-amber-400 hover:text-slate-950 text-white text-xs font-bold">
                            สลับเข้าโหมดเสมียน
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="space-y-3">
                <div class="grid grid-cols-1 gap-3">${summaryCardsHtml}</div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-xs border border-slate-200 rounded-xl overflow-hidden">
                        <thead class="bg-slate-900 text-white">
                            <tr>
                                <th class="p-3">แอคเคาท์ทนายความเจ้าของสำนวน (ผู้แต่งตั้งเสมียน)</th>
                                <th class="p-3">แอคเคาท์เสมียนทนายในสังกัด</th>
                                <th class="p-3">ขอบเขตหน้าที่ในสำนวนคดี (แบบพิมพ์ศาล)</th>
                                <th class="p-3">สถานะเสมียนหลัก (ผู้พิมพ์เริ่มต้น)</th>
                                <th class="p-3 text-right">การจัดการสังกัดเสมียน</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200 bg-white">
                            ${list.map(m => {
                                const totalLawyersForThisClerk = allMappings.filter(x => x.clerkUserId === m.clerkUserId).length;
                                return `
                                <tr class="hover:bg-slate-50">
                                    <td class="p-3">
                                        <div class="font-bold text-slate-900">⚖️ ${m.lawyerFullName}</div>
                                        <div class="text-[11px] text-slate-500">${m.lawyerLicenseNo || ''}</div>
                                    </td>
                                    <td class="p-3">
                                        <div class="font-bold text-indigo-950">👨‍💼 ${m.clerkFullName} <span class="text-slate-400 font-normal">(@${m.clerkUsername})</span></div>
                                        <div class="text-[11px] text-emerald-700 font-semibold">ทำงานให้ทนายรวม ${totalLawyersForThisClerk} ท่าน • โทร: ${m.clerkPhone || '-'}</div>
                                    </td>
                                    <td class="p-3">
                                        <div class="font-semibold text-slate-800">${m.permissionScope || '-'}</div>
                                        <div class="text-[11px] text-slate-500">${m.assignedRoleTitle || ''}</div>
                                    </td>
                                    <td class="p-3">
                                        ${m.isDefaultClerk
                                            ? `<span class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[11px]">★ เสมียนหลักของทนายท่านนี้</span>`
                                            : `<button onclick="App.setDefaultClerkMapping(${m.id})" class="px-2.5 py-0.5 rounded-full bg-slate-100 hover:bg-amber-100 text-slate-700 font-semibold text-[11px] border border-slate-300">ตั้งเป็นเสมียนหลัก</button>`
                                        }
                                    </td>
                                    <td class="p-3 text-right space-x-1 whitespace-nowrap">
                                        ${!isAdminMode ? `
                                        <button onclick="App.onSelectAssignedClerkInStudio(${m.clerkProfileId}); App.switchTab('studio');" class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-amber-500 hover:text-slate-950 text-white font-semibold text-xs">
                                            ใช้เป็นผู้พิมพ์ในฟอร์มศาล
                                        </button>` : ''}
                                        <button onclick="App.deleteClerkMapping(${m.id})" class="px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 font-semibold text-xs">
                                            ยกเลิกสังกัด
                                        </button>
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    openManageClerkModal(defaultLawyerUserId = null, preselectedClerkUserId = null) {
        const lawyerSel = document.getElementById('clkLawyerUserSelect') || document.getElementById('clkTargetLawyerSelect');
        const lawyerUsers = (this.state.users || []).filter(u => u.role === 'Lawyer');
        const effectiveLawyer = this.getEffectiveLawyerAccount();
        const chosenLawyerId = defaultLawyerUserId || (effectiveLawyer?.role === 'Lawyer' ? effectiveLawyer.id : lawyerUsers[0]?.id);

        if (lawyerSel) {
            lawyerSel.innerHTML = lawyerUsers.map(u => {
                const count = (this.state.clerkMappings || []).filter(m => m.lawyerUserId === u.id).length;
                return `
                    <option value="${u.id}" ${u.id === Number(chosenLawyerId) ? 'selected' : ''}>
                        ⚖️ ${u.fullName} (${u.licenseNo || '-'}) — ปัจจุบันมีเสมียนในสังกัด ${count} คน
                    </option>
                `;
            }).join('');
        }

        const existingClerkSel = document.getElementById('clkExistingUserSelect') || document.getElementById('clkExistingClerkSelect');
        const clerkUsers = (this.state.users || []).filter(u => u.role === 'Clerk');
        if (existingClerkSel) {
            existingClerkSel.innerHTML = clerkUsers.map(cu => {
                const mappedLawyers = (this.state.clerkMappings || []).filter(m => m.clerkUserId === cu.id).map(m => m.lawyerFullName);
                return `
                    <option value="${cu.id}" ${preselectedClerkUserId && cu.id === Number(preselectedClerkUserId) ? 'selected' : ''}>
                        👨‍💼 ${cu.fullName} (@${cu.username}) — ปัจจุบันทำงานให้ทนาย ${mappedLawyers.length} ท่าน (${mappedLawyers.join(', ') || '-'})
                    </option>
                `;
            }).join('');
        }

        this.setClerkModalMode('EXISTING');
        document.getElementById('manageClerkModal')?.classList.remove('hidden');
    },

    closeManageClerkModal() {
        document.getElementById('manageClerkModal')?.classList.add('hidden');
    },

    setClerkModalMode(mode) {
        this.state.clerkModalMode = mode;
        const btnEx = document.getElementById('clkModeExistingBtn');
        const btnNew = document.getElementById('clkModeNewBtn');
        const boxEx = document.getElementById('clkExistingSection');
        const boxNew = document.getElementById('clkNewSection') || document.getElementById('clkNewAccountSection');

        if (mode === 'EXISTING') {
            if (btnEx) btnEx.className = 'py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white transition';
            if (btnNew) btnNew.className = 'py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-200 transition';
            boxEx?.classList.remove('hidden');
            boxNew?.classList.add('hidden');
        } else {
            if (btnNew) btnNew.className = 'py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white transition';
            if (btnEx) btnEx.className = 'py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-200 transition';
            boxNew?.classList.remove('hidden');
            boxEx?.classList.add('hidden');
        }
    },

    async submitAssignClerk() {
        const lawyerSel = document.getElementById('clkLawyerUserSelect') || document.getElementById('clkTargetLawyerSelect');
        const lawyerUserId = Number(lawyerSel?.value || 0);
        if (!lawyerUserId) {
            this.showToast('กรุณาเลือกแอคเคาท์ทนายความที่ต้องการตั้งเสมียน');
            return;
        }

        const mode = this.state.clerkModalMode || 'EXISTING';
        const existingSel = document.getElementById('clkExistingUserSelect') || document.getElementById('clkExistingClerkSelect');
        const existingClerkUserId = Number(existingSel?.value || 0);
        const username = document.getElementById('clkNewUsername')?.value?.trim() || '';
        const passwordHash = document.getElementById('clkNewPassword')?.value?.trim() || '123456';
        const fullName = document.getElementById('clkNewFullName')?.value?.trim() || '';
        const citizenId = document.getElementById('clkNewCitizenId')?.value?.trim() || '';
        const phone = document.getElementById('clkNewPhone')?.value?.trim() || '';
        const addressText = document.getElementById('clkNewAddress')?.value?.trim() || '';
        const permEl = document.getElementById('clkPermissions') || document.getElementById('clkPermissionScope');
        const permissionScope = permEl?.value || 'พิมพ์คำคู่ความ / รับมอบฉันทะยื่น-ส่งเอกสาร / ตรวจสำนวน';
        const defChk = document.getElementById('clkIsDefaultTypist') || document.getElementById('clkIsDefaultChk');
        const isDefaultClerk = defChk?.checked !== false;

        if (mode === 'NEW' && (!username || !fullName)) {
            this.showToast('กรุณาระบุ Username และชื่อ-นามสกุลของเสมียนทนาย');
            return;
        }

        const res = await fetch(`/api/lawyers/${lawyerUserId}/clerks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode,
                existingClerkUserId,
                username,
                passwordHash,
                fullName,
                citizenId,
                phone,
                addressText,
                permissionScope,
                isDefaultClerk
            })
        });

        const data = await res.json();
        if (!res.ok) {
            this.showToast(data.message || 'ไม่สามารถตั้งเสมียนทนายได้');
            return;
        }

        this.closeManageClerkModal();
        await this.loadDashboardData();
        this.renderAllViews();
        this.showToast(`✅ ${data.message || 'ตั้งเสมียนทนายเข้าสังกัดแอคเคาท์ทนายความเรียบร้อยแล้ว'}`);
    },

    async setDefaultClerkMapping(mapId) {
        const res = await fetch(`/api/clerk-mappings/${mapId}/default`, { method: 'PUT' });
        if (res.ok) {
            await this.loadDashboardData();
            this.renderAllViews();
            this.showToast('★ ตั้งเป็นเสมียนหลัก (ผู้พิมพ์เริ่มต้น) ของทนายความท่านนี้แล้ว');
        }
    },

    async deleteClerkMapping(mapId) {
        const res = await fetch(`/api/clerk-mappings/${mapId}`, { method: 'DELETE' });
        if (res.ok) {
            await this.loadDashboardData();
            this.renderAllViews();
            this.showToast('ยกเลิกการผูกสังกัดเสมียนทนายแล้ว');
        }
    },

    // ==================== MODAL: CREATE NEW CASE (WITH 3-CASE TRIAL, QUOTA CHECK & CLERK ASSIGNMENT) ====================
    openNewCaseModal() {
        if (this.state.currentUser?.role === 'Admin') {
            this.showToast('🔒 แอดมินทำหน้าที่บริหารจัดการระบบบริการเท่านั้น ไม่สามารถสร้างสำนวนคดีได้');
            return;
        }
        const u = this.getEffectiveLawyerAccount();
        if (u && u.role !== 'Admin' && u.usedCasesCount >= u.maxCasesQuota) {
            this.showToast(`⚠️ โควต้าสำนวนคดีของทนาย ${u.fullName} เต็มแล้ว (${u.usedCasesCount}/${u.maxCasesQuota} คดี) กรุณาแจ้งสลิปโอนเงินเพื่อเพิ่มโควต้า`);
            this.openPaymentSlipModal();
            return;
        }

        // Populate Clerk dropdown for this Lawyer's new case
        const clerkSel = document.getElementById('mdlAssignedClerkId');
        if (clerkSel) {
            const myClerks = this.getClerksForCurrentLawyer();
            const clerkProfiles = myClerks.length > 0
                ? myClerks.map(m => ({ id: m.clerkProfileId, name: `${m.clerkFullName} (@${m.clerkUsername})` }))
                : this.state.lawyers.filter(l => l.roleType?.includes('เสมียน')).map(l => ({ id: l.id, name: l.fullName }));

            clerkSel.innerHTML = `<option value="0">-- ไม่ระบุ / ทนายความดำเนินการเอง --</option>` +
                clerkProfiles.map((cp, idx) => `
                    <option value="${cp.id}" ${idx === 0 ? 'selected' : ''}>👨‍💼 มอบหมายเสมียน: ${cp.name}</option>
                `).join('');
        }

        document.getElementById('caseModal')?.classList.remove('hidden');
    },

    closeCaseModal() {
        document.getElementById('caseModal')?.classList.add('hidden');
    },

    async createNewCase() {
        const u = this.getEffectiveLawyerAccount();
        const assignedClerkId = Number(document.getElementById('mdlAssignedClerkId')?.value || 0);
        const payload = {
            caseCategory: document.getElementById('mdlCaseCategory').value,
            lawyerRole: document.getElementById('mdlLawyerRole').value,
            representingPartyOrder: document.getElementById('mdlLawyerRole').value === 'ทนายโจทก์' ? 'โจทก์' : 'จำเลย',
            courtName: document.getElementById('mdlCourtName').value || 'จังหวัดศรีสะเกษ',
            blackCaseNo: document.getElementById('mdlBlackNo').value || 'อ ๑๐๑',
            blackCaseYear: document.getElementById('mdlBlackYear').value || '๖๙',
            plaintiffName: document.getElementById('mdlPlaintiff').value || 'โจทก์',
            defendantName: document.getElementById('mdlDefendant').value || 'จำเลย',
            chargeOrCauseOfAction: document.getElementById('mdlCharge').value || '-',
            claimAmount: Number(document.getElementById('mdlClaimAmount').value || 0),
            interestRate: 5.0,
            primaryLawyerId: u?.lawyerProfileId || 1,
            clerkId: assignedClerkId > 0 ? assignedClerkId : null,
            currentProceduralStage: 'ชั้นยื่นคำคู่ความเริ่มต้น',
            status: 'กำลังดำเนินการ',
            caseSummary: document.getElementById('mdlSummary').value || ''
        };

        const res = await fetch(`/api/cases?userId=${u?.id || 0}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            this.closeCaseModal();
            this.showToast(data.message || 'โควต้าสำนวนคดีเต็มแล้ว กรุณาซื้อโควต้าเพิ่ม');
            if (data.quotaExceeded) {
                this.openPaymentSlipModal();
            }
            return;
        }

        this.closeCaseModal();
        await this.loadDashboardData();
        this.state.currentCaseId = data.id;
        this.renderAllViews();
        this.showToast(`✅ เปิดสำนวนคดีใหม่ (${data.blackCaseNo}/๒๕${data.blackCaseYear}) ของทนาย ${u?.fullName || ''} เรียบร้อยแล้ว`);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.App.init();
});
