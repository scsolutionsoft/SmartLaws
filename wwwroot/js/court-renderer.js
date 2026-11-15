// ============================================================================
// SmartLaws - Court Paper Renderer Engine (จำลองแบบพิมพ์ศาลยุติธรรม A4 100%)
// ยึดรูปแบบตามไฟล์ PDF แบบพิมพ์ศาลที่แก้ไขใหม่ครบทุกแบบ:
// (๑) ปกหน้าสำนวน, (๒) หน้าสำนวน, (๓) สารบาญ, (๔) คำฟ้อง, (๕) คำขอท้ายคำฟ้องแพ่ง,
// (๖) คำขอท้ายคำฟ้องอาญา, (๗) คำร้อง/คำแถลง/คำขอ, (๘) บัญชีทรัพย์, (๙) ใบแต่งทนายความ,
// (๑๐) ใบมอบฉันทะ, (๑๑)/(๑๑ ก.) คำให้การจำเลย, (๑๒) หมายเรียกมโนสาเร่,
// (๑๓) หมายเรียกแพ่งสามัญ, (๑๔) หมายเรียกคดีอาญา, (๑๕) บัญชีพยาน, (๔๐ ก.) ใบต่อ
// ============================================================================

window.CourtRenderer = {
    _measureCanvas: null,
    _thaiSegmenter: (typeof Intl !== 'undefined' && Intl.Segmenter)
        ? new Intl.Segmenter('th', { granularity: 'word' })
        : null,

    toThaiNum(val, enabled = true) {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (!enabled) return str;
        const map = { '0': '๐', '1': '๑', '2': '๒', '3': '๓', '4': '๔', '5': '๕', '6': '๖', '7': '๗', '8': '๘', '9': '๙' };
        return str.replace(/[0-9]/g, d => map[d] || d);
    },

    // =========================================================================
    // ระบบจัดระเบียบการเคาะวรรคและการตัดคำตามระบบภาษาไทย (ใช้แนวทางเดียวกันทั้งโปรเจ็กต์)
    // ยึดเกณฑ์การเว้นวรรคของราชบัณฑิตยสภาและงานสารบรรณศาลยุติธรรม:
    // - เคาะวรรค ๑ เคาะมาตรฐานคงที่ (ไม่ถ่างช่องว่างระหว่างคำจนห่างผิดธรรมชาติ)
    // - เคาะวรรค ๑ เคาะหน้าและหลังตัวเลข จำนวนเงิน วันที่ ชื่อเฉพาะ และคำย่อสำคัญ
    // - ห้ามเคาะวรรคหลังวงเล็บเปิด '(' และหน้าวงเล็บปิด ')'
    // =========================================================================
    normalizeThaiSpacing(input) {
        if (input === null || input === undefined) return '';
        let str = String(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        return str.split('\n').map(rawLine => {
            let line = rawLine
                .replace(/[\t\u00A0\u2000-\u200A]+/g, ' ')
                .replace(/ {2,}/g, ' ')
                .trim();

            if (!line) return '';

            // 1. ลบช่องว่างเกินหลังวงเล็บเปิด '(' และหน้าวงเล็บปิด ')'
            line = line.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

            // 2. เคาะวรรค ๑ เคาะหน้าวงเล็บเปิด '(' เมื่อติดกับตัวอักษรไทยหรือตัวเลข และหลังวงเล็บปิด ')' เมื่อตามด้วยตัวอักษรไทยหรือตัวเลข
            line = line.replace(/([ก-๙0-9๐-๙])\(/g, '$1 (');
            line = line.replace(/\)([ก-๙0-9๐-๙])/g, ') $1');

            // 3. รูปแบบคำย่อมาตรฐานในเอกสารศาล เช่น (น.ส. ๓ ก.), พ.ศ. ๒๕๖๕, ม. ๓๔๑
            line = line.replace(/น\.ส\.\s*([0-9๐-๙])\s*ก\./g, 'น.ส. $1 ก.');
            line = line.replace(/พ\.ศ\.\s*([0-9๐-๙])/g, 'พ.ศ. $1');
            line = line.replace(/(?<![ก-๙])ม\.\s*([0-9๐-๙])/g, 'ม. $1');

            // 4. เคาะวรรค ๑ เคาะระหว่างตัวอักษรไทยกับตัวเลข (เช่น วันที่ ๑๑, จำนวน ๑๕๐,๐๐๐ บาท, ร้อยละ ๕ ต่อปี, จำเลยที่ ๒)
            line = line.replace(/([ก-ฮะ-์])([0-9๐-๙])/g, '$1 $2');
            line = line.replace(/([0-9๐-๙])([ก-ฮเ-ไ])/g, '$1 $2');

            // 5. เครื่องหมายจุลภาค ',' ในตัวเลขห้ามเว้นวรรคเด็ดขาด (เช่น ๑๕๐,๐๐๐ หรือ 150,000)
            //    หมายเหตุ: ห้ามใช้ [ก-๙] เพราะใน Unicode ช่วง ก-๙ รวมเลขไทย ๐-๙ (\u0E50-\u0E59) อยู่ด้วย! ต้องใช้ [ก-ฮเ-ไ] เท่านั้น
            line = line.replace(/,([ก-ฮเ-ไ])/g, ', $1');
            line = line.replace(/([0-9๐-๙])\s*,\s*([0-9๐-๙])/g, '$1,$2');
            line = line.replace(/([0-9๐-๙])\s*\.\s*([0-9๐-๙])/g, '$1.$2');
            line = line.replace(/([0-9๐-๙])\s*\/\s*([0-9๐-๙])/g, '$1/$2');

            // 6. คำย่อ ต. / อ. / จ. ให้เขียนชิดชื่อ (ต.ศรีสำราญ อ.วังหิน จ.ศรีสะเกษ) และเคาะวรรค ๑ เคาะคั่นระหว่างกัน
            line = line.replace(/(?<![ก-ฮเ-ไ])(ต|อ|จ)\.\s+([ก-ฮเ-ไ])/g, '$1.$2');
            line = line.replace(/([ก-ฮะ-์])((?:ต|อ|จ)\.[ก-ฮเ-ไ])/g, '$1 $2');

            // 7. ยุบช่องว่างซ้ำทั้งหมดให้เป็น ๑ เคาะมาตรฐานตามระบบภาษาไทย
            line = line.replace(/ {2,}/g, ' ').trim();
            return line;
        }).join('\n');
    },

    // นับความยาวตัวอักษรแนวนอนจริงของภาษาไทย (ไม่นับสระบน-ล่าง และวรรณยุกต์ที่ไม่กินความกว้างแนวนอน)
    getThaiVisualLength(str) {
        if (!str) return 0;
        return String(str).replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u200B]/g, '').length;
    },

    // วัดความกว้างพิกเซลจริงของข้อความด้วยฟอนต์ Sarabun 14pt บน HTML5 Canvas เพื่อให้จัดข้อความเต็มบรรทัดพอดี
    measureThaiTextPx(text, isBold = false, fontFamily = 'Sarabun, sans-serif', fontSizePt = 14) {
        if (!text) return 0;
        const fontScale = fontSizePt / 14;
        const fallbackPx = this.getThaiVisualLength(text) * (isBold ? 9.2 : 8.7) * fontScale;
        try {
            if (!this._measureCanvas && typeof document !== 'undefined') {
                this._measureCanvas = document.createElement('canvas');
            }
            if (this._measureCanvas) {
                const ctx = this._measureCanvas.getContext('2d');
                ctx.font = `${isBold ? '700' : '400'} ${fontSizePt}pt ${fontFamily}`;
                const measured = ctx.measureText(text).width;
                // Canvas uses the selected font metrics; the character-count fallback
                // systematically overestimates Thai text and leaves a visible right gap.
                if (Number.isFinite(measured) && measured > 0) return measured;
            }
        } catch {
            // fallback
        }
        return fallbackPx;
    },

    // แยกคำภาษาไทยตามระบบภาษาไทย:
    // 1. จัดให้เต็มบรรทัดก่อน แล้วพิจารณาคำฉีก โดยฉีกคำประสมออกเป็นคำย่อยที่มีความหมายตามพจนานุกรมภาษาไทย (Intl.Segmenter 'th')
    // 2. ยกเว้นตัวเลขที่เป็นตัวเงิน/รหัสตัวเลข (เช่น ๑๕๐,๐๐๐, ๘,๑๒๕, ๑๕๘,๑๒๕, ๙๔/๙๓) ห้ามฉีกกลางตัวเลขเด็ดขาด
    // 3. วันเดือนปี แบ่งออกเป็นส่วน "วัน" (เช่น วันที่ ๑๑, วันที่ ๑๒) / "เดือน" (เช่น พฤศจิกายน, มกราคม) / "ปี" (เช่น พ.ศ. ๒๕๖๕, ๒๕๖๕) เพื่อให้ตัดแบ่งระหว่าง วัน-เดือน-ปี ได้อย่างถูกต้องตามรูปแบบภาษาไทย
    tokenizeThaiLineText(text) {
        const clean = this.normalizeThaiSpacing(text);
        if (!clean) return [];

        const thaiMonths = '(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.)';

        // ล็อกเฉพาะหน่วยที่ห้ามฉีกกลางหน่วย:
        // - ส่วน "วัน": วันที่ ๑๑, วันที่ ๑๒, วันที่ ๖
        // - ส่วน "เดือน": เดือน มกราคม, พฤศจิกายน, มกราคม
        // - ส่วน "ปี": พ.ศ. ๒๕๖๕, พุทธศักราช ๒๕๖๙, พ.ศ. ๒๕๒๗
        // - ตัวเลขที่เป็นตัวเงินและรหัสตัวเลข: ๑๕๐,๐๐๐, ๑๕๘,๑๒๕, ๘,๑๒๕, ๙๔/๙๓, ๐๘๔-๑๘๕๖๔๘๓
        // - เลขมาตรา/ข้อ/คำย่อสั้น: (น.ส. ๓ ก.), เลขที่ ๙๔/๙๓, มาตรา ๓๔๑, หมู่ที่ ๔, ต.ศรีสำราญ, อ.วังหิน, จ.ศรีสะเกษ
        const atomicPattern = new RegExp(
            '(' +
            `วันที่\\s*[0-9๐-๙]+` +
            '|' +
            `(?:เดือน\\s*)?${thaiMonths}` +
            '|' +
            `(?:พ\\.ศ\\.|พุทธศักราช)\\s*[0-9๐-๙]{2,4}` +
            '|' +
            `\\(น\\.ส\\.\\s*[0-9๐-๙]+\\s*ก\\.\\)` +
            '|' +
            `(?:เลขที่|หมู่ที่|มาตรา|ม\\.|ข้อ)\\s*[0-9๐-๙]+(?:[,./-][0-9๐-๙]+)*` +
            '|' +
            `ร้อยละ\\s*[0-9๐-๙]+(?:\\.[0-9๐-๙]+)?` +
            '|' +
            `(?:ต|อ|จ|นพ|รพ|สภ|น\\.ส|ด\\.ช|ด\\.ญ|พล\\.ต\\.อ|พล\\.ต\\.ท|พล\\.ต\\.ต|พ\\.ต\\.อ|พ\\.ต\\.ท|พ\\.ต\\.ต|ร\\.ต\\.อ)\\.[ก-ฮะ-์]+` +
            '|' +
            `(?:ป\\.วิ\\.พ\\.|ป\\.วิ\\.อ\\.|ป\\.อ\\.|พ\\.ร\\.ก\\.|พ\\.ร\\.บ\\.|พ\\.ศ\\.|ค\\.ศ\\.|ม\\.)` +
            '|' +
            // Treat numeric values as one unbreakable unit, including currency decimals.
            `[0-9๐-๙]+(?:[,.][0-9๐-๙]+)*(?:[/][0-9๐-๙]+)?(?:-[0-9๐-๙]+)*` +
            ')',
            'g'
        );

        const rawTokens = [];
        let lastIndex = 0;
        let match;

        const pushSegmentedChunk = (chunk) => {
            if (!chunk) return;
            if (this._thaiSegmenter) {
                for (const seg of this._thaiSegmenter.segment(chunk)) {
                    if (seg.segment) rawTokens.push(seg.segment);
                }
            } else {
                rawTokens.push(...chunk.split(/( +)/).filter(Boolean));
            }
        };

        while ((match = atomicPattern.exec(clean)) !== null) {
            if (match.index > lastIndex) {
                pushSegmentedChunk(clean.slice(lastIndex, match.index));
            }
            rawTokens.push(match[0]);
            lastIndex = atomicPattern.lastIndex;
        }
        if (lastIndex < clean.length) {
            pushSegmentedChunk(clean.slice(lastIndex));
        }

        // รวมเครื่องหมายวรรคตอนปิดเข้ากับคำหน้า และเครื่องหมายเปิดเข้ากับคำหลัง เพื่อไม่ให้ตกบรรทัดผิดหลักภาษาไทย
        const merged = [];
        for (let i = 0; i < rawTokens.length; i++) {
            const tok = rawTokens[i];
            if (/^[.,;:"”')}%ๆ]+$/.test(tok) && merged.length > 0 && merged[merged.length - 1] !== ' ') {
                merged[merged.length - 1] += tok;
            } else if (merged.length > 0 && /^[(“"]+$/.test(merged[merged.length - 1])) {
                merged[merged.length - 1] += tok;
            } else {
                merged.push(tok);
            }
        }
        return merged;
    },

    // แปลงข้อความภาษาไทยสำหรับแสดงผล inline พร้อมจุดตัดคำภาษาไทย <wbr> และเคาะวรรคมาตรฐาน ๑ เคาะ
    formatThaiInlineHtml(text) {
        const tokens = this.tokenizeThaiLineText(text);
        return tokens.map(tok => tok === ' ' ? ' ' : `<span class="court-nowrap-token">${tok}</span><wbr>`).join('');
    },

    // จัดวางย่อหน้าภาษาไทยลงทีละบรรทัดตามความกว้างจริงของกระดาษแบบพิมพ์ศาล A4 (172mm = 650px):
    // 1. จัดให้เต็มบรรทัดก่อน แล้วจึงพิจารณาคำฉีก (ฉีกคำได้แต่ให้มีความหมายตามพจนานุกรมภาษาไทย)
    // 2. ยกเว้นตัวเลขที่เป็นตัวเงินห้ามฉีกกลางตัวเลข และวันเดือนปีแบ่งเป็น วัน / เดือน / ปี
    // 3. เกลี่ยระยะตัวอักษรในบรรทัดที่ไม่ใช่บรรทัดสุดท้ายให้เต็มเส้นประอย่างสวยงามโดยไม่ถ่างช่องว่างระหว่างคำ
    layoutParagraphIntoThaiLines(title, rawText, isIndented = true, options = {}) {
        const cleanTitle = this.normalizeThaiSpacing(title || '');
        const cleanText = this.normalizeThaiSpacing(rawText || '');
        const tokens = this.tokenizeThaiLineText(cleanText);
        const fontFamily = options.fontFamily || 'Sarabun, sans-serif';
        const fontSizePt = options.fontSizePt || 14;

        const maxFullLinePx = 648; // Match the printable width of the dotted rule (650px less right padding).
        const maxIndentedLinePx = 608; // First line reserves 40px for the paragraph indent.

        const lines = [];
        let isFirstLine = true;
        const titlePrefixPlain = cleanTitle ? `${cleanTitle} ` : '';
        const titlePrefixHtml = cleanTitle ? `<strong>${cleanTitle}</strong> ` : '';
        const titlePrefixPx = cleanTitle ? this.measureThaiTextPx(titlePrefixPlain, true, fontFamily, fontSizePt) : 0;

        let currentPlain = '';
        let currentHtml = '';

        const flushLine = (isLastLine = false) => {
            const trimmedPlain = currentPlain.trimEnd();
            const trimmedHtml = currentHtml.replace(/\s+$/, '');
            const fullLinePlain = (isFirstLine ? titlePrefixPlain : '') + trimmedPlain;
            const bodyPx = this.measureThaiTextPx(trimmedPlain, false, fontFamily, fontSizePt);
            const fullLinePx = (isFirstLine ? titlePrefixPx : 0) + bodyPx;
            const effectiveLimit = (isFirstLine && isIndented) ? maxIndentedLinePx : maxFullLinePx;

            let autoFitStyle = '';
            if (fullLinePx > effectiveLimit + 12) {
                autoFitStyle = `font-size: ${(fontSizePt - 0.7).toFixed(1)}pt; letter-spacing: -0.18px;`;
            } else if (fullLinePx > effectiveLimit + 2) {
                autoFitStyle = `font-size: ${(fontSizePt - 0.4).toFixed(1)}pt; letter-spacing: -0.1px;`;
            } else if (!isLastLine && fullLinePx < effectiveLimit - 1) {
                // กรณีไม่ใช่บรรทัดสุดท้ายของย่อหน้า ให้เกลี่ยช่องไฟละเอียดเพื่อให้ข้อความเต็มบรรทัดพอดีตามแบบพิมพ์ศาล
                const gapPx = effectiveLimit - fullLinePx;
                const charCount = Math.max(1, this.getThaiVisualLength(fullLinePlain));
                const addLetterPx = +(gapPx / charCount).toFixed(2);
                if (addLetterPx > 0) {
                    autoFitStyle = `letter-spacing: ${addLetterPx}px;`;
                }
            }

            const lineHeightPx = Math.min(29, Math.max(25, fontSizePt * 1.6));
            const contentFontStyle = options.fontFamily
                ? `font-family:${fontFamily};font-size:${fontSizePt}pt;font-weight:${options.fontWeight ?? 400};line-height:${lineHeightPx}px;padding-top:${Math.max(0, 30 - lineHeightPx)}px;`
                : '';
            lines.push({
                indent: isFirstLine && isIndented,
                plain: fullLinePlain,
                html: (isFirstLine ? titlePrefixHtml : '') + trimmedHtml,
                extraStyle: [contentFontStyle, autoFitStyle].filter(Boolean).join(' ')
            });
            isFirstLine = false;
            currentPlain = '';
            currentHtml = '';
        };

        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];
            if (currentPlain.length === 0 && tok === ' ') {
                continue;
            }

            const candidatePlain = currentPlain + tok;
            const currentLimitPx = (isFirstLine && isIndented)
                ? (maxIndentedLinePx - titlePrefixPx)
                : maxFullLinePx;

            const candidatePx = this.measureThaiTextPx(candidatePlain, false, fontFamily, fontSizePt);
            const wrappedTokHtml = tok === ' ' ? ' ' : `<span class="court-nowrap-token">${tok}</span>`;

            if (candidatePx <= currentLimitPx || currentPlain.length === 0) {
                currentPlain = candidatePlain;
                currentHtml += wrappedTokHtml;
            } else {
                flushLine(false);
                if (tok !== ' ') {
                    currentPlain = tok;
                    currentHtml = wrappedTokHtml;
                }
            }
        }

        if (currentPlain.trim().length > 0 || lines.length === 0) {
            flushLine(true);
        }

        return lines;
    },

    // สร้าง HTML บรรทัดเส้นประสำหรับแบบพิมพ์ (๕), (๖), (๑๐) ให้ใช้ระบบเคาะวรรคภาษาไทยเดียวกันทั้งหมด
    renderThaiClausesLinedHtml(clauses, t, minLines = 4) {
        const allLines = [];
        (clauses || []).forEach((c, idx) => {
            const title = t(this.normalizeThaiSpacing(c.ClauseTitle || c.clauseTitle || `${idx + 1}.`));
            const rawContent = t(this.normalizeThaiSpacing(c.Content || c.content || ''));
            const paragraphs = rawContent.split('\n').map(s => s.trim()).filter(Boolean);
            paragraphs.forEach((p, pIdx) => {
                const pLines = this.layoutParagraphIntoThaiLines(pIdx === 0 ? title : '', p, true);
                allLines.push(...pLines);
            });
        });
        while (allLines.length < minLines) {
            allLines.push({ indent: false, plain: '', html: '&nbsp;', extraStyle: '' });
        }
        return allLines.map(line => `
            <div class="court-thai-line" style="${line.indent ? 'padding-left: 2.5rem;' : 'padding-left: 0;'} ${line.extraStyle || ''}">
                ${line.html}
            </div>
        `).join('');
    },

    // ใช้ตราครุฑตามรูปแบบภาพที่ 5 (/images/garuda.png)
    getGarudaHtml() {
        return `<img src="/images/garuda.png" class="court-garuda-img" alt="ตราครุฑแบบพิมพ์ศาล" />`;
    },

    renderCitizenBoxes(cid, useThai = true) {
        const clean = (cid || '').replace(/[^0-9๐-๙]/g, '');
        const digits = [];
        for (let i = 0; i < 13; i++) {
            const ch = clean[i] ? this.toThaiNum(clean[i], useThai) : '&nbsp;';
            digits.push(`<span class="citizen-digit-box">${ch}</span>`);
            if (i === 0 || i === 4 || i === 9 || i === 11) {
                digits.push(`<span style="margin:0 1px;font-weight:bold;">-</span>`);
            }
        }
        return `<span class="citizen-id-boxes">${digits.join('')}</span>`;
    },

    // การลงชื่อให้อยู่กึ่งกลางบรรทัด และต้องอยู่คนละบรรทัด (ล็อกความสูงบรรทัดละ 32px พอดี ไม่ให้เลื่อนไปทับเส้นประ)
    renderCenteredSigRow(sigBase64, signerName, signerRole, lineMinWidth = '210px') {
        const sigOverlay = sigBase64
            ? `<img src="${sigBase64}" style="position:absolute; left:50%; transform:translateX(-58%); bottom:3px; max-height:38px; max-width:160px; object-fit:contain; pointer-events:none;" alt="ลายเซ็นอิเล็กทรอนิกส์" />`
            : '';
        return `
        <div class="court-signature-row">
            <div class="court-signature-line">
                ${sigOverlay}
                <span>ลงชื่อ <span class="court-dotted-line" style="min-width:${lineMinWidth};">&nbsp;</span> ${signerRole || ''}</span>
            </div>
            ${signerName ? `<div class="court-signature-line court-signature-name">(${signerName})</div>` : ''}
        </div>`;
    },

    // การลงชื่อชิดขวาใต้หมายเหตุท้ายหน้าแรก ตามภาพที่ 4 (คำร้อง) และภาพที่ 5 (คำฟ้อง/คำให้การจำเลย) — นำเส้นประ 2 เส้นล่างสุดออกตามคำสั่งผู้ใช้
    renderBottomNoteSection(doc, lawCase, isPlaint4, isDefense11) {
        const sigBase64 = doc.signatureImageBase64 || '';
        const sigOverlay = sigBase64
            ? `<img src="${sigBase64}" style="position:absolute; right:95px; bottom:4px; max-height:44px; max-width:165px; object-fit:contain; pointer-events:none;" alt="ลายเซ็นอิเล็กทรอนิกส์" />`
            : '';

        // ตรวจสอบว่าเป็นคำร้อง (ภาพที่ 4) หรือ คำฟ้อง/คำให้การ (ภาพที่ 5 โดยดูว่าเป็นโจทก์หรือจำเลย)
        if (!isPlaint4 && !isDefense11) {
            // คำร้อง / คำแถลง / คำขอ (๗) -> จัดชิดขวา: ..................................................... ผู้ร้อง / ผู้แถลง / ผู้ขอ
            return `
            <div class="court-page-bottom-note">
                <div><strong><u>หมายเหตุ</u></strong> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ข้าพเจ้ารอฟังคำสั่งอยู่ ถ้าไม่รอให้ถือว่าทราบแล้ว</div>
                <div class="court-note-right-sig">
                    ${sigOverlay}
                    <span class="court-dotted-line" style="min-width:230px;">&nbsp;</span> ผู้ร้อง / ผู้แถลง / ผู้ขอ
                </div>
            </div>`;
        }

        // กรณีคำฟ้อง (๔) หรือ คำให้การ (๑๑)/(๑๑ ก.) -> ดูว่าเป็นโจทก์หรือจำเลย จัดรูปแบบตามภาพที่ 5
        const roleStr = `${doc.lawyerRoleInDoc || ''} ${doc.requesterStatus || ''} ${doc.signerRole || ''} ${lawCase?.lawyerRole || ''}`;
        const isDefendantSide = isDefense11 || (roleStr.includes('จำเลย') && !roleStr.includes('โจทก์'));
        const rightPartyLabel = isDefendantSide ? 'จำเลย' : 'โจทก์';
        const multiPartyCaption = isDefendantSide
            ? '(กรณีจำเลยหลายคนให้ระบุชื่อและรายละเอียดของจำเลยแต่ละคนแนบท้ายคำให้การจำเลย)'
            : '(กรณีโจทก์หลายคนให้ระบุชื่อและรายละเอียดของโจทก์แต่ละคนแนบท้ายคำฟ้อง)';

        return `
        <div class="court-page-bottom-note">
            <div><strong><u>หมายเหตุ</u></strong> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ข้าพเจ้ารอฟังคำสั่งอยู่ ถ้าไม่รอให้ถือว่าทราบแล้ว</div>
            <div class="court-note-right-sig">
                ${sigOverlay}
                <span class="court-dotted-line" style="min-width:260px;">&nbsp;</span> ${rightPartyLabel}
            </div>
            <div style="font-size:12.5pt; margin-top:2px;">${multiPartyCaption}</div>
        </div>`;
    },

    // ควรมิควรแล้วแต่จะโปรด ต้องอยู่กึ่งกลางกระดาษ แล้วเคาะไปทางขวาอีก 6 เคาะ
    normalizeClosingPrayer(text) {
        const value = String(text || '').trim();
        return !value || value === 'ซึ่งเป็นวันสืบพยานด้วย' ? 'ควรมิควรแล้วแต่จะโปรด' : value;
    },
    renderClosingPrayerLine(prayerText) {
        const text = this.normalizeClosingPrayer(prayerText).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        return `<div class="court-closing-gap" aria-hidden="true"></div><div class="court-closing-prayer">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${text}</div><div class="court-before-signature-gap" aria-hidden="true"></div>`;
    },

    // กล่องเลขคดีดำ-แดง มุมบนขวา (เหมือนกันทุกฟอร์มในโปรเจ็กต์ ตามภาพที่ 2: คดีหมายเลขดำ 1 บรรทัด / คดีหมายเลขแดง 1 บรรทัดอยู่ใต้คดีดำ ห้ามตกบรรทัด)
    renderCaseNumberBoxHtml(doc, lawCase, t) {
        let extra = {};
        try { extra = JSON.parse(doc.extraFieldsJson || '{}'); } catch { extra = {}; }

        const blackNoRaw = (extra.BlackCaseNo !== undefined ? extra.BlackCaseNo : (lawCase?.blackCaseNo || '')).trim();
        const blackYrRaw = (extra.BlackCaseYear !== undefined ? extra.BlackCaseYear : (lawCase?.blackCaseYear || '')).trim();
        const redNoRaw = (extra.RedCaseNo !== undefined ? extra.RedCaseNo : (lawCase?.redCaseNo || '')).trim();
        const redYrRaw = (extra.RedCaseYear !== undefined ? extra.RedCaseYear : (lawCase?.redCaseYear || '')).trim();

        const blackNo = blackNoRaw ? t(blackNoRaw) : '&nbsp;';
        const blackYr = blackYrRaw ? t(blackYrRaw) : '&nbsp;';
        const redNo = redNoRaw ? t(redNoRaw) : '&nbsp;';
        const redYr = redYrRaw ? t(redYrRaw) : '&nbsp;';

        return `
        <div class="court-case-number-box">
            <div class="court-case-number-line">คดีหมายเลขดำที่ <span class="court-dotted-line" style="min-width:74px;">${blackNo}</span> /๒๕<span class="court-dotted-line" style="min-width:42px;">${blackYr}</span></div>
            <div class="court-case-number-line">คดีหมายเลขแดง<span class="court-dotted-line" style="min-width:78px; ${redNoRaw ? 'color:#b91c1c;' : ''}">${redNo}</span> /๒๕<span class="court-dotted-line" style="min-width:42px; ${redYrRaw ? 'color:#b91c1c;' : ''}">${redYr}</span></div>
        </div>`;
    },

    renderCommonHeader(doc, lawCase, t, options = {}) {
        const courtName = t(lawCase?.courtName || 'จังหวัดศรีสะเกษ');
        const category = lawCase?.caseCategory || 'อาญา';
        const day = t(doc.docDay || '');
        const month = doc.docMonth || '';
        const year = t(doc.docYear || '');
        const plaintiff = t(lawCase?.plaintiffName || '');
        const defendant = t(lawCase?.defendantName || '');

        const showForCourtUse = options.forCourtUse === true;
        const hideDateRow = options.hideDateRow === true;
        const royalHeading = options.royalHeading || '';

        return `
            <div class="court-punch-hole" title="ตำแหน่งเจาะรูเข้าสำนวนศาล"></div>
            ${showForCourtUse ? `<div style="position:absolute; top:11mm; right:14mm; font-size:13pt; text-decoration:underline; font-weight:600;">สำหรับศาลใช้</div>` : ''}
            <div class="court-form-code-box">
                <div>${t(doc.formCode || '(๗)')}</div>
                <div style="font-size:13.5pt; font-weight:700;">${t(doc.documentTitle || 'คำร้อง')}</div>
            </div>
            <div class="court-garuda-center">
                ${this.getGarudaHtml()}
                ${royalHeading ? `<div style="font-weight:700; font-size:15.5pt; margin-top:2px;">${royalHeading}</div>` : ''}
            </div>
            ${this.renderCaseNumberBoxHtml(doc, lawCase, t)}

            <div style="text-align:center; margin-top:8px; clear:both;">
                <div style="white-space:nowrap;">ศาล <span class="court-dotted-line" style="min-width:250px; font-weight:600;">${courtName}</span></div>
                ${!hideDateRow ? `<div style="white-space:nowrap;">วันที่ <span class="court-dotted-line" style="min-width:45px;">${day}</span> เดือน <span class="court-dotted-line" style="min-width:125px;">${month}</span> พุทธศักราช ๒๕<span class="court-dotted-line" style="min-width:42px;">${year}</span></div>` : ''}
                <div style="white-space:nowrap;">ความ <span class="court-dotted-line" style="min-width:160px; font-weight:600;">${category}</span></div>
            </div>

            <table class="court-parties-table">
                <tr>
                    <td rowspan="2" style="width:52px; vertical-align:middle; font-size:13pt; text-align:right; padding-right:4px;">ระหว่าง</td>
                    <td rowspan="2" class="court-brace-cell">{</td>
                    <td style="padding:4px 8px;">
                        <span class="court-dotted-line" style="width:88%; text-align:left;">${plaintiff}</span>
                        <span style="float:right; font-weight:600;">โจทก์</span>
                    </td>
                </tr>
                <tr>
                    <td style="padding:4px 8px;">
                        <span class="court-dotted-line" style="width:88%; text-align:left;">${defendant}</span>
                        <span style="float:right; font-weight:600;">จำเลย</span>
                    </td>
                </tr>
            </table>
        `;
    },

    // ตรวจสอบโหมดการลงลายมือชื่อ (ใช้ลายเซ็นอิเล็กทรอนิกส์ หรือ เว้นว่างเพื่อให้ผู้เซ็นเซ็นจริงในเอกสารที่สั่งพิมพ์)
    resolveEffectiveDocumentSignatures(doc, extra = {}) {
        const batchMode = (typeof window !== 'undefined' && window.App?.state?.batchPrintSigningMode)
            ? window.App.state.batchPrintSigningMode
            : 'DOC_DEFAULT';

        let signingMode = extra.SigningMode ?? 'ELECTRONIC';
        if (batchMode === 'FORCE_WET' || batchMode === 'WET_SIGNATURE') {
            signingMode = 'WET_SIGNATURE';
        } else if (batchMode === 'FORCE_ELECTRONIC') {
            signingMode = 'ELECTRONIC';
        }

        const isWetSignatureAll = signingMode === 'WET_SIGNATURE' || signingMode === 'FORCE_WET';

        const showMain = !isWetSignatureAll && (extra.ShowMainElectronicSig !== false);
        const showDrafter = !isWetSignatureAll && (extra.ShowDrafterElectronicSig !== false);
        const showTypist = !isWetSignatureAll && (extra.ShowTypistElectronicSig !== false);

        return {
            ...doc,
            signatureImageBase64: showMain ? (doc.signatureImageBase64 || '') : '',
            drafterSignatureBase64: showDrafter ? (doc.drafterSignatureBase64 || '') : '',
            typistSignatureBase64: showTypist ? (doc.typistSignatureBase64 || '') : ''
        };
    },

    renderDocumentPagesHtml(rawDoc, lawCase) {
        const useThai = rawDoc.useThaiNumerals !== false;
        const t = (v) => this.toThaiNum(v, useThai);
        const formCode = (rawDoc.formCode || '(๗)').trim();

        let clauses = [];
        try { clauses = JSON.parse(rawDoc.clausesJson || '[]'); } catch { clauses = []; }
        let extra = {};
        try { extra = JSON.parse(rawDoc.extraFieldsJson || '{}'); } catch { extra = {}; }

        const doc = this.resolveEffectiveDocumentSignatures(rawDoc, extra);

        let html;
        if (formCode === '(๑)') html = this.renderCaseCoverForm1(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๒)') html = this.renderCaseFrontForm2(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๓)') html = this.renderIndexForm3(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๕)') html = this.renderEndOfPlaintForm5(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๖)') html = this.renderEndOfCrimPlaintForm6(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๘)') html = this.renderPropertyListForm8(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๙)') html = this.renderAppointmentForm9(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๑๐)') html = this.renderProxyForm10(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๑๒)') html = this.renderSummonsForm12(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๑๓)') html = this.renderSummonsForm13(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๑๔)') html = this.renderSummonsForm14(doc, lawCase, clauses, extra, t);
        else if (formCode === '(๑๕)') html = this.renderWitnessForm15(doc, lawCase, clauses, extra, t);
        else html = this.renderStandardGarudaAndContinuation(doc, lawCase, clauses, extra, t);

        const fontFamilies = {
            'th-sarabun-new': "'TH Sarabun New', 'TH SarabunPSK', 'Sarabun', sans-serif",
            sarabun: "'Sarabun', 'TH Sarabun New', sans-serif",
            'angsana-new': "'Angsana New', 'AngsanaUPC', serif",
            'cordia-new': "'Cordia New', 'CordiaUPC', sans-serif"
        };
        const isDefenseForm = formCode === '(๑๑)' || formCode === '(๑๑ ก.)';
        const family = fontFamilies[extra.TextFontFamily] || fontFamilies[isDefenseForm ? 'th-sarabun-new' : 'sarabun'];
        const size = [12, 14, 16, 18].includes(Number(extra.TextFontSize)) ? Number(extra.TextFontSize) : (isDefenseForm ? 16 : 14);
        const pageStyle = `--court-entry-font-family:${family};--court-entry-font-size:${size}pt;`;
        return html.replace(/<div class="court-page"(?=[\s>])/g, `<div class="court-page" style="${pageStyle}"`);
    },

    // แบบ (๑) ปกหน้าสำนวน ตาม PDF
    renderCaseCoverForm1(doc, lawCase, clauses, extra, t) {
        let rowsHtml = '';
        const overflow = [];
        const safe = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const note = (index) => {
            const value = String(clauses[index]?.Content || clauses[index]?.content || '');
            if (value.length > 32 || value.includes('\n')) {
                overflow.push({index:index + 1, value});
                return `ดูบันทึก ${t(index + 1)} ในใบต่อแนบ`;
            }
            return safe(t(value));
        };
        for (let i = 1; i <= 9; i++) {
            const leftNo = t(i);
            const rightNo = t(i + 9);
            const leftVal = note(i - 1);
            const rightVal = note(i + 8);
            rowsHtml += `
                <div style="display:flex; justify-content:space-between; gap:18px; margin-bottom:10px;">
                    <div style="width:48%; min-width:0;">${leftNo}. <span class="court-dotted-line" style="width:88%; text-align:left; font-size:13pt;">${leftVal}</span></div>
                    <div style="width:48%; min-width:0;">${rightNo}. <span class="court-dotted-line" style="width:86%; text-align:left; font-size:13pt;">${rightVal}</span></div>
                </div>`;
        }

        clauses.slice(18).forEach((item,index) => overflow.push({index:index+19,value:String(item.Content || item.content || '')}));
        const attachments = overflow.sort((a,b) => a.index-b.index).flatMap(item => {
            // Reserve space for explicit newlines as well as naturally wrapped text.
            const chunks = []; let chunk = '', weight = 0;
            for (const part of new Intl.Segmenter('th',{granularity:'grapheme'}).segment(item.value)) {
                chunk += part.segment; weight += part.segment.includes('\n') ? 40 : part.segment.length;
                if (weight >= 700) {chunks.push(chunk); chunk=''; weight=0;}
            }
            if (chunk) chunks.push(chunk);
            const pages = chunks.map((text,index) => `<div class="court-page"><h3>ใบต่อบันทึกปกสำนวน — รายการ ${t(item.index)}${index ? ' (ต่อ)' : ''}</h3><div style="white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7;">${safe(t(text))}</div></div>`);
            return pages;
        }).join('');
        return `
        <div class="court-page">
            ${this.renderCommonHeader(doc, lawCase, t, { forCourtUse: true, hideDateRow: true })}
            <div style="margin:10px 0;">
                เรื่อง <span class="court-dotted-line" style="width:92%; text-align:left;">${t(lawCase?.chargeOrCauseOfAction || '')}</span>
            </div>
            <div style="margin:10px 0;">
                ทุนทรัพย์ <span class="court-dotted-line" style="min-width:230px;">${t(lawCase?.claimAmount ? lawCase.claimAmount.toLocaleString() + ' บาท' : '-')}</span>
                เอกสารเก็บเลขที่ <span class="court-dotted-line" style="min-width:210px;">${t(extra.ArchiveNo ?? '')}</span>
            </div>
            <div style="text-align:center; font-weight:700; text-decoration:underline; margin:16px 0 12px 0;">บันทึก</div>
            <div>${rowsHtml}</div>
        </div>${attachments}`;
    },

    // แบบ (๒) หน้าสำนวน ตาม PDF
    renderCaseFrontForm2(doc, lawCase, clauses, extra, t) {
        return `
        <div class="court-page">
            ${this.renderCommonHeader(doc, lawCase, t, { forCourtUse: true, hideDateRow: true })}
            <div style="margin:6px 0;">เรื่อง <span class="court-dotted-line" style="width:92%; text-align:left;">${t(lawCase?.chargeOrCauseOfAction || '')}</span></div>
            <div style="margin:6px 0;">ทุนทรัพย์ <span class="court-dotted-line" style="width:88%; text-align:left;">${t(lawCase?.claimAmount ? lawCase.claimAmount.toLocaleString() + ' บาท' : '-')}</span></div>
            <div style="margin:6px 0;">ฟ้องหรือร้องวันที่ <span class="court-dotted-line" style="min-width:60px;">${t(doc.docDay || '')}</span> เดือน <span class="court-dotted-line" style="min-width:160px;">${doc.docMonth || ''}</span> พ.ศ. ๒๕<span class="court-dotted-line" style="min-width:50px;">${t(doc.docYear || '')}</span></div>
            ${[['IssueDate','นัดชี้สองสถานวันที่'],['FirstHearingDate','พิจารณาหรือไต่สวนครั้งแรกวันที่'],['EndHearingDate','พิจารณาหรือไต่สวนเสร็จสำนวนวันที่']].map(([key,label]) => `<div style="margin:6px 0;">${label} <span class="court-dotted-line" style="min-width:280px;">${t(extra[key] || '')}</span></div>`).join('')}

            <div style="text-align:center; font-weight:700; text-decoration:underline; margin:16px 0 10px 0;">บันทึก</div>
            <div>วันที่ <span class="court-dotted-line" style="min-width:280px;">${t(extra.JudgmentReadDate ?? '')}</span> ศาลได้อ่าน</div>
            <div>คำพิพากษาหรือคำสั่ง <span class="court-dotted-line" style="min-width:280px;">${t(extra.JudgmentOrder ?? '')}</span> ในคดีเรื่องนี้ ให้คู่ความฟังแล้ว จึงได้ให้ลงลายมือชื่อไว้เป็นสำคัญ</div>

            <div style="margin-top:18px;">
                ${this.renderCenteredSigRow('', '', 'โจทก์')}
                ${this.renderCenteredSigRow('', '', 'จำเลย')}
                ${this.renderCenteredSigRow('', '', 'ผู้ร้อง')}
                ${this.renderCenteredSigRow('', '', 'ผู้พิพากษา')}
            </div>
        </div>`;
    },

    // แบบ (๓) สารบาญ ตาม PDF
    renderIndexForm3(doc, lawCase, items, extra, t) {
        // Decode values already escaped by the editor, then use textContent for every cell.
        const decode = value => { const el=document.createElement('textarea'); el.innerHTML=String(value ?? ''); return el.value; };
        const rows = (Array.isArray(items) ? items : []).map(r => [r.OrderNo ?? r.orderNo ?? '',r.WitnessNameAndDesc ?? r.witnessNameAndDesc ?? r.Content ?? '',r.AddressText ?? r.addressText ?? '',r.Note ?? r.note ?? ''].map(v=>decode(t(v))));
        const rowHtml = row => {
            const tr=document.createElement('tr');
            row.forEach(value=>{const td=document.createElement('td'); td.textContent=value || '\u00a0'; tr.append(td);});
            return tr.outerHTML;
        };
        // Measure with the same font, column widths and wrapping rules used by the printed table.
        const probe=document.createElement('table');
        probe.className='court-index-table';
        probe.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;width:172mm;';
        const columns='<colgroup><col style="width:12%"><col style="width:56%"><col style="width:16%"><col style="width:16%"></colgroup>';
        document.body.append(probe);
        const height=row=>{probe.innerHTML=columns+`<tbody>${rowHtml(row)}</tbody>`;return probe.getBoundingClientRect().height;};
        const pages=[]; let current=[], used=0;
        const limit=156 * 96 / 25.4;
        const blank=['','','',''];
        const finish=()=>{const blankHeight=height(blank); while(used+blankHeight<=limit && current.length<15){current.push(blank);used+=blankHeight;} pages.push(current);current=[];used=0;};
        const place=row=>{
            const h=height(row);
            if(h>limit && row.some(v=>Array.from(v).length>1)) {
                // Oversized cells continue on subsequent rows/pages without losing text.
                const halves=row.map((v,i)=>{if((i===0 || i===2) && v.length<=30)return [v,''];const parts=Array.from(new Intl.Segmenter('th',{granularity:'grapheme'}).segment(v),p=>p.segment);const mid=Math.ceil(parts.length/2);return [parts.slice(0,mid).join(''),parts.slice(mid).join('')];});
                place(halves.map(p=>p[0]));place(halves.map(p=>p[1]));return;
            }
            if(current.length && (used+h>limit || current.length>=15)) finish();
            current.push(row);used+=h;
        };
        try { rows.forEach(place); if(current.length || !pages.length) finish(); } finally {probe.remove();}
        return pages.map((page,index)=>`
        <div class="court-page court-index-page">
            <div class="court-punch-hole"></div>
            <div style="position:absolute; top:11mm; right:14mm; font-size:13pt; text-decoration:underline; font-weight:600;">สำหรับศาลใช้</div>
            <div style="font-weight:700; font-size:14pt; margin-left:8mm;">(๓)</div>
            <div class="court-index-title">สารบาญ${index ? ' (ต่อ)' : ''}</div>
            <table class="court-index-table">
                ${columns}
                <thead>
                    <tr>
                        <th style="width:12%;">อันดับ</th>
                        <th style="width:56%;">รายการ</th>
                        <th style="width:16%;">จำนวน<br/>แผ่น</th>
                        <th style="width:16%;">หมายเหตุ</th>
                    </tr>
                </thead>
                <tbody>
                    ${page.map(rowHtml).join('')}
                </tbody>
            </table>
        </div>`).join('');
    },

    // แบบ (๘) บัญชีทรัพย์ ตาม PDF
    renderPropertyListForm8(doc, lawCase, items, extra, t) {
        const rows = Array.isArray(items) ? [...items] : [];
        while (rows.length < 12) {
            rows.push({ OrderNo: '', WitnessNameAndDesc: '', AddressText: '', Note: '' });
        }
        return `
        <div class="court-page">
            <div class="court-punch-hole"></div>
            <div class="court-form-code-box"><div>(๘)</div></div>
            <div class="court-garuda-center">${this.getGarudaHtml()}</div>
            ${this.renderCaseNumberBoxHtml(doc, lawCase, t)}
            <div style="text-align:center; font-weight:700; font-size:16pt; margin:8px 0;">บัญชีทรัพย์</div>
            <table class="court-witness-table">
                <thead>
                    <tr>
                        <th rowspan="2" style="width:10%;">อันดับ</th>
                        <th rowspan="2" style="width:42%;">รายการ</th>
                        <th rowspan="2" style="width:12%;">จำนวน</th>
                        <th colspan="2" style="width:22%;">ราคา</th>
                        <th rowspan="2" style="width:14%;">หมายเหตุ</th>
                    </tr>
                    <tr>
                        <th>บาท</th>
                        <th>สตางค์</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td style="text-align:center;">${r.OrderNo ? t(r.OrderNo) : '&nbsp;'}</td>
                            <td>${t(r.WitnessNameAndDesc || r.Content || '') || '&nbsp;'}</td>
                            <td style="text-align:center;">${t(r.AddressText || '') || '&nbsp;'}</td>
                            <td style="text-align:right;">${t(r.Note || '') || '&nbsp;'}</td>
                            <td style="text-align:center;">${t(r.Satang || '') || '&nbsp;'}</td>
                            <td>${t(r.Remark || '') || '&nbsp;'}</td>
                        </tr>
                    `).join('')}
                    <tr>
                        <td colspan="3" style="font-weight:700; border-top:1.5px solid #000;">รวม</td>
                        <td style="text-align:right; font-weight:700; border-top:1.5px solid #000;">${t(lawCase?.claimAmount ? lawCase.claimAmount.toLocaleString() : '-')}</td>
                        <td style="text-align:center; border-top:1.5px solid #000;">-</td>
                        <td style="border-top:1.5px solid #000;">&nbsp;</td>
                    </tr>
                </tbody>
            </table>
            ${this.renderCenteredSigRow(doc.signatureImageBase64, t(doc.signerName || doc.requesterFullName), 'ผู้ยื่น')}
        </div>`;
    },

    // แยกย่อหน้า "ขอศาลได้โปรดอนุญาต" ออกจากเนื้อหาข้อ เพื่อจัดให้อยู่ย่อหน้าสุดท้ายก่อน "ควรมิควรแล้วแต่จะโปรด"
    // และรองรับการเลือกเปิด/ปิดการแสดงผลจากหน้าจอ Editor (extra.ShowPermission)
    extractPermissionParagraph(clauses, extra = {}) {
        const cloned = (clauses || []).map(c => ({ ...c }));
        let hasPermissionLine = false;
        let extractedText = '';

        const permRegex = /(ขอศาลได้โปรดอนุญาต(?:ด้วย)?.*)/;

        for (let i = cloned.length - 1; i >= 0; i--) {
            const raw = cloned[i].Content || cloned[i].content || '';
            const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
            const remainingLines = [];

            lines.forEach(line => {
                if (permRegex.test(line) && line.length <= 65) {
                    hasPermissionLine = true;
                    extractedText = line;
                } else {
                    remainingLines.push(line);
                }
            });

            if (hasPermissionLine) {
                cloned[i].Content = remainingLines.join('\n');
                cloned[i].content = remainingLines.join('\n');
                break;
            }
        }

        const shouldShow = extra.ShowPermission === true;
        const savedPermission = typeof extra.PermissionText === 'string' && extra.PermissionText !== '[object Object]'
            ? extra.PermissionText.trim() : '';

        const finalPermissionText = shouldShow
            ? (savedPermission || extractedText || 'ขอศาลได้โปรดอนุญาต')
            : '';

        return {
            cleanedClauses: cloned.filter(c => (c.Content || c.content || '').trim().length > 0),
            permissionText: finalPermissionText,
            hasPermissionInClauses: hasPermissionLine,
            extractedText
        };
    },

    // แบบ (๔) คำฟ้อง, แบบ (๗) คำร้อง/คำแถลง/คำขอ, แบบ (๑๑)/(๑๑ ก.) คำให้การจำเลย และใบต่อ (๔๐ ก.)
    renderStandardGarudaAndContinuation(doc, lawCase, clauses, extra, t) {
        const formCode = (doc.formCode || '(๗)').trim();
        const isPlaint4 = formCode === '(๔)';
        const isDefense11 = formCode === '(๑๑)' || formCode === '(๑๑ ก.)';

        const { cleanedClauses, permissionText } = this.extractPermissionParagraph(clauses, extra);

        // ส่วนหัวข้อมูลผู้ยื่นในหน้าแรก จัดให้ตรงตามไฟล์ PDF ต้นฉบับของแต่ละแบบพิมพ์ (แบบ ๔, แบบ ๗, แบบ ๑๑)
        // ใช้ .court-preamble-row (flex nowrap) เพื่อล็อกไม่ให้ฉีกคำตกบรรทัดตามภาพที่ 1
        let page1PreambleHtml = '';
        if (isPlaint4) {
            // ตามไฟล์ 04_แบบพิมพ์คำฟ้อง.pdf
            page1PreambleHtml = `
                <div class="court-preamble-row">
                    <span>ข้อหาหรือฐานความผิด</span>
                    <span class="court-dotted-line" data-plaint-charge style="flex:1; min-width:0; white-space:pre-wrap !important; overflow:visible; overflow-wrap:anywhere; text-align:left;">${t(extra.Charge ?? lawCase?.chargeOrCauseOfAction ?? '')}</span>
                </div>
                <div class="court-preamble-row">
                    <span>จำนวนทุนทรัพย์</span>
                    <span class="court-dotted-line" style="flex:3;">${t(extra.ClaimAmountBaht ?? (lawCase?.claimAmount ? lawCase.claimAmount.toLocaleString() : '-'))}</span>
                    <span>บาท</span>
                    <span class="court-dotted-line" style="flex:1;">${t(extra.ClaimAmountSatang ?? '-')}</span>
                    <span>สตางค์</span>
                </div>
                <div class="court-preamble-row indent">
                    <span>ข้าพเจ้า</span>
                    <span class="court-dotted-line" style="flex:1; text-align:left; font-weight:600;">${t(doc.requesterFullName || '')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>เลขประจำตัวประชาชน</span>
                    ${this.renderCitizenBoxes(doc.requesterCitizenId, doc.useThaiNumerals !== false)}
                    <span>โจทก์ เชื้อชาติ</span>
                    <span class="court-dotted-line" style="flex:1;">${t(doc.requesterRace || 'ไทย')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>สัญชาติ</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterNationality || 'ไทย')}</span>
                    <span>อาชีพ</span> <span class="court-dotted-line" style="flex:1.8;">${t(doc.requesterOccupation || '-')}</span>
                    <span>อายุ</span> <span class="court-dotted-line" style="flex:0.8;">${t(doc.requesterAge || '-')}</span> <span>ปี</span>
                    <span>อยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:1.1;">${t(doc.requesterHouseNo || '-')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.7;">${t(doc.requesterMoo || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterRoad || '-')}</span>
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterSoi || '-')}</span>
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterSubDistrict || '-')}</span>
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterDistrict || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.3;">${t(doc.requesterProvince || 'ศรีสะเกษ')}</span>
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.9;">${t(doc.requesterPostalCode || '๓๓๐๐๐')}</span>
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1.5;">${t(doc.requesterPhone || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>โทรสาร</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ไปรษณีย์อิเล็กทรอนิกส์</span> <span class="court-dotted-line" style="flex:2;">-</span>
                </div>
                <div class="court-preamble-row">
                    <span>ขอยื่นฟ้อง</span>
                    <span class="court-dotted-line" style="flex:1; text-align:left; font-weight:600;">${t(extra.DefName ?? lawCase?.defendantName ?? '')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>เลขประจำตัวประชาชน</span>
                    ${this.renderCitizenBoxes(extra.DefCitizenId ?? '', doc.useThaiNumerals !== false)}
                    <span>จำเลย เชื้อชาติ</span>
                    <span class="court-dotted-line" style="flex:1;">ไทย</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>สัญชาติ</span> <span class="court-dotted-line" style="flex:1;">ไทย</span>
                    <span>อาชีพ</span> <span class="court-dotted-line" style="flex:1.8;">-</span>
                    <span>อายุ</span> <span class="court-dotted-line" style="flex:0.8;">-</span> <span>ปี</span>
                    <span>อยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:1.1;">${t(extra.DefHouseNo ?? '-')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.7;">${t(extra.DefMoo ?? '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DefSubDistrict ?? '-')}</span>
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DefDistrict ?? '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.3;">${t(extra.DefProvince ?? 'ศรีสะเกษ')}</span>
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.9;">๓๓๐๐๐</span>
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1.5;">-</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>โทรสาร</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ไปรษณีย์อิเล็กทรอนิกส์</span> <span class="court-dotted-line" style="flex:2;">-</span>
                </div>
                <div style="margin:2px 0; font-weight:600;">มีข้อความตามที่จะกล่าวต่อไปนี้</div>
            `;
        } else if (isDefense11) {
            // ตามไฟล์ 11_แบบฟอร์มคำให้การจำเลย.pdf
            page1PreambleHtml = `
                <div class="court-preamble-row indent">
                    <span>ข้าพเจ้า</span>
                    <span class="court-dotted-line" style="flex:1; text-align:left; font-weight:600;">${t(doc.requesterFullName || '')}</span>
                    <span style="font-weight:600;">จำเลย</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>เลขประจำตัวประชาชน</span>
                    ${this.renderCitizenBoxes(doc.requesterCitizenId, doc.useThaiNumerals !== false)}
                    <span>เชื้อชาติ</span>
                    <span class="court-dotted-line" style="flex:1;">${t(doc.requesterRace || 'ไทย')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>สัญชาติ</span> <span class="court-dotted-line" style="flex:0.9;">${t(doc.requesterNationality || 'ไทย')}</span>
                    <span>อาชีพ</span> <span class="court-dotted-line" style="flex:1.5;">${t(doc.requesterOccupation || '-')}</span>
                    <span>เกิดวันที่</span> <span class="court-dotted-line" style="flex:0.6;">-</span>
                    <span>เดือน</span> <span class="court-dotted-line" style="flex:1.1;">-</span>
                    <span>พ.ศ.</span> <span class="court-dotted-line" style="flex:0.8;">-</span>
                    <span>อายุ</span> <span class="court-dotted-line" style="flex:0.6;">${t(doc.requesterAge || '-')}</span> <span>ปี</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>อยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterHouseNo || '-')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.6;">${t(doc.requesterMoo || '-')}</span>
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:1.5;">${t(doc.requesterRoad || '-')}</span>
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterSoi || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterSubDistrict || '-')}</span>
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterDistrict || '-')}</span>
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterProvince || 'ศรีสะเกษ')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.9;">${t(doc.requesterPostalCode || '๓๓๐๐๐')}</span>
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1.5;">${t(doc.requesterPhone || '-')}</span>
                    <span>โทรสาร</span> <span class="court-dotted-line" style="flex:1.2;">-</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ไปรษณีย์อิเล็กทรอนิกส์</span> <span class="court-dotted-line" style="flex:1;">-</span>
                </div>
                <div style="margin:2px 0; font-weight:600;">ได้ทราบคำฟ้องตลอดแล้ว ขอให้การตามที่จะกล่าวต่อไปนี้</div>
            `;
        } else {
            // ตามไฟล์ 07_แบบฟอร์มคำร้อง.pdf
            page1PreambleHtml = `
                <div class="court-preamble-row indent">
                    <span>ข้าพเจ้า</span>
                    <span class="court-dotted-line" style="flex:1; text-align:left; font-weight:600;">${t(doc.requesterFullName || '')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>เลขประจำตัวประชาชน</span>
                    ${this.renderCitizenBoxes(doc.requesterCitizenId, doc.useThaiNumerals !== false)}
                </div>
                <div class="court-preamble-row compact">
                    <span>เชื้อชาติ</span> <span class="court-dotted-line" style="flex:0.8;">${t(doc.requesterRace || 'ไทย')}</span>
                    <span>สัญชาติ</span> <span class="court-dotted-line" style="flex:0.8;">${t(doc.requesterNationality || 'ไทย')}</span>
                    <span>อาชีพ</span> <span class="court-dotted-line" style="flex:1.4;">${t(doc.requesterOccupation || '-')}</span>
                    <span>เกิดวันที่</span> <span class="court-dotted-line" style="flex:0.6;">-</span>
                    <span>เดือน</span> <span class="court-dotted-line" style="flex:1.1;">-</span>
                    <span>พ.ศ.</span> <span class="court-dotted-line" style="flex:0.8;">-</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>อายุ</span> <span class="court-dotted-line" style="flex:0.6;">${t(doc.requesterAge || '-')}</span> <span>ปี</span>
                    <span>อยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterHouseNo || '-')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.6;">${t(doc.requesterMoo || '-')}</span>
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:2;">${t(doc.requesterRoad || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterSoi || '-')}</span>
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterSubDistrict || '-')}</span>
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterDistrict || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.3;">${t(doc.requesterProvince || 'ศรีสะเกษ')}</span>
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.9;">${t(doc.requesterPostalCode || '๓๓๐๐๐')}</span>
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1.5;">${t(doc.requesterPhone || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>โทรสาร</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ไปรษณีย์อิเล็กทรอนิกส์</span> <span class="court-dotted-line" style="flex:2;">-</span>
                </div>
                <div style="margin:2px 0; font-weight:600;">ขอยื่นคำร้อง / คำแถลง / คำขอ มีข้อความตามที่จะกล่าวต่อไปนี้</div>
            `;
        }

        // Forms 7 and 11 fill the actual writing area available above the bottom note.
        let page1MaxLines = isPlaint4 ? 3 : (isDefense11 ? 5 : 4);
        // Measure with the same A4 styles as preview/print and keep a quiet gap before the note.
        if ((formCode === '(๗)' || isDefense11) && typeof document !== 'undefined' && document.body) {
            const probe = document.createElement('div');
            probe.className = 'court-page';
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;zoom:1;';
            probe.style.setProperty('padding', '15mm 16mm 16mm 22mm', 'important');
            probe.innerHTML = `<div class="court-page-top">${this.renderCommonHeader(doc, lawCase, t, { forCourtUse:isDefense11 })}${page1PreambleHtml}<div data-body-start></div></div>${this.renderBottomNoteSection(doc, lawCase, isPlaint4, isDefense11)}`;
            document.body.appendChild(probe);
            try {
                const start = probe.querySelector('[data-body-start]').getBoundingClientRect().top;
                const end = probe.querySelector('.court-page-bottom-note').getBoundingClientRect().top;
                const availableLines = Math.floor(Math.max(0, end - start - 16) / 31);
                page1MaxLines = isDefense11 ? availableLines : Math.max(4, availableLines);
            } finally { probe.remove(); }
        }

        const permissionParagraphHtml = permissionText
            ? `<div class="court-closing-permission">${t(permissionText)}</div>`
            : '';
        const footerSignBlock = `
            ${permissionParagraphHtml}
            ${this.renderClosingPrayerLine(t(doc.closingPrayer || 'ควรมิควรแล้วแต่จะโปรด'))}
            ${this.renderCenteredSigRow(doc.signatureImageBase64, t(doc.signerName || ''), t(doc.signerRole || doc.lawyerRoleInDoc || (isDefense11 ? 'จำเลย' : (isPlaint4 ? 'โจทก์' : 'ผู้ร้อง / ผู้แถลง / ผู้ขอ'))))}
            ${(doc.drafterName || doc.typistName) ? `
            <div class="court-signature-line">
                คำคู่ความฉบับนี้ <span class="court-dotted-line" style="min-width:165px; font-weight:600;">${t(doc.drafterName || '')}</span> เป็นผู้เรียง / <span class="court-dotted-line" style="min-width:165px; font-weight:600;">${t(doc.typistName || '')}</span> เป็นผู้พิมพ์
            </div>
            ${this.renderCenteredSigRow(doc.drafterSignatureBase64, t(doc.drafterName || ''), 'ผู้เรียง')}
            ${this.renderCenteredSigRow(doc.typistSignatureBase64, t(doc.typistName || ''), 'ผู้พิมพ์')}` : ''}
        `;

        let contPageMaxLines = 21; // Browser rendering replaces this fallback with the measured A4 capacity.
        let footerLinesCount = (permissionText ? 1 : 0) + 6 + ((doc.drafterName || doc.typistName) ? 5 : 0);
        let contLastPageMaxLines = Math.max(1, contPageMaxLines - footerLinesCount);
        if (isDefense11 && typeof document !== 'undefined' && document.body) {
            const probe = document.createElement('div');
            probe.className = 'court-page';
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;transform:none;margin:0;zoom:1;';
            probe.style.setProperty('padding', '15mm 16mm 16mm 22mm', 'important');
            probe.innerHTML = `<div class="court-page-top">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13pt;color:#334155;">
                    <div><strong>(๔๐ ก.)</strong> ใบต่อคำคู่ความ — ${t(doc.documentTitle)}</div>
                    <div>- ${t(2)} -</div>
                </div>
                <div class="court-lined-body">
                    <div class="court-thai-line" data-continuation-line>&nbsp;</div>
                    ${footerSignBlock}
                </div>
            </div>`;
            document.body.appendChild(probe);
            try {
                const line = probe.querySelector('[data-continuation-line]');
                const pageRect = probe.getBoundingClientRect();
                const contentBottom = pageRect.bottom - parseFloat(getComputedStyle(probe).paddingBottom);
                const lineRect = line.getBoundingClientRect();
                const lastFooterElement = line.parentElement.lastElementChild;
                const footerBottom = lastFooterElement.getBoundingClientRect().bottom
                    + parseFloat(getComputedStyle(lastFooterElement).marginBottom || '0');
                const lineHeight = lineRect.height;
                contPageMaxLines = Math.max(1, Math.floor((contentBottom - lineRect.top - 8) / lineHeight));
                const footerSpace = Math.max(0, footerBottom - lineRect.bottom);
                contLastPageMaxLines = Math.max(1, Math.floor((contentBottom - lineRect.top - footerSpace - 8) / lineHeight));
                footerLinesCount = Math.max(1, contPageMaxLines - contLastPageMaxLines);
            } finally { probe.remove(); }
        }

        // แปลงแต่ละข้อเป็นบรรทัดที่ตัดคำตามพจนานุกรมภาษาไทย (Intl.Segmenter 'th') และเคาะวรรค ๑ เคาะตามระบบภาษาไทย
        const allLines = [];
        const fontFamilies = {
            'th-sarabun-new': "'TH Sarabun New', 'TH SarabunPSK', 'Sarabun', sans-serif",
            sarabun: "'Sarabun', 'TH Sarabun New', sans-serif",
            'angsana-new': "'Angsana New', 'AngsanaUPC', serif",
            'cordia-new': "'Cordia New', 'CordiaUPC', sans-serif"
        };
        const allowedFontSizes = [12, 14, 16, 18];
        const legacyTextStyle = cleanedClauses.find(c => c.FontFamily || c.FontSize) || {};
        const defaultFont = isDefense11 ? 'th-sarabun-new' : 'sarabun';
        const requestedFont = extra.TextFontFamily || legacyTextStyle.FontFamily;
        const fontKey = fontFamilies[requestedFont] ? requestedFont : defaultFont;
        const requestedSize = Number(extra.TextFontSize || legacyTextStyle.FontSize || (isDefense11 ? 16 : 14));
        const fontSize = allowedFontSizes.includes(requestedSize) ? requestedSize : (isDefense11 ? 16 : 14);
        const textStyle = {
            fontFamily: fontFamilies[fontKey],
            fontSizePt: fontSize,
            fontWeight: isDefense11 ? 300 : 400
        };
        cleanedClauses.forEach(c => {
            const title = t(this.normalizeThaiSpacing(c.ClauseTitle || c.clauseTitle || ''));
            const rawContent = t(this.normalizeThaiSpacing(c.Content || c.content || ''));
            const paragraphs = rawContent.split('\n').map(s => s.trim()).filter(Boolean);
            paragraphs.forEach((p, pIdx) => {
                const pLines = this.layoutParagraphIntoThaiLines(pIdx === 0 ? title : '', p, true, textStyle);
                allLines.push(...pLines);
            });
        });

        // แบ่งบรรทัดลงหน้า ๑ (สูงสุด page1MaxLines บรรทัด) และส่วนที่เกินส่งไปหน้าใบต่อ (๔๐ ก.) หน้าละ contPageMaxLines บรรทัด
        const page1Lines = allLines.slice(0, page1MaxLines);
        const remainingLines = allLines.slice(page1MaxLines);
        const contPages = [];
        for (let i = 0; i < remainingLines.length; i += contPageMaxLines) {
            contPages.push(remainingLines.slice(i, i + contPageMaxLines));
        }

        // ตรวจสอบว่าส่วนลงชื่อท้ายคำคู่ความสามารถอยู่ในหน้า ๑ ได้โดยไม่ล้นเส้นทึบก่อนหมายเหตุหรือไม่
        const footerOnPage1 = contPages.length === 0 && (page1Lines.length + footerLinesCount <= page1MaxLines);
        if (!footerOnPage1) {
            // Fill the remaining writing area with evenly spaced dotted lines.
            while (page1Lines.length < page1MaxLines) {
                page1Lines.push({ indent: false, plain: '', html: '&nbsp;', extraStyle: '' });
            }
            if (contPages.length === 0) {
                contPages.push([]);
            }
        }

        // ตรวจสอบหน้าใบต่อ (๔๐ ก.) หน้าสุดท้ายว่าเมื่อรวมส่วนลงชื่อท้ายคำคู่ความแล้วเกินความจุหน้าหรือไม่ หากเกินให้ตัดขึ้นหน้าใบต่อใหม่ทันทีเพื่อไม่ให้ตกหน้ากระดาษ
        if (contPages.length > 0) {
            const lastChunk = contPages[contPages.length - 1];
            if (lastChunk.length > contLastPageMaxLines) {
                const carryOver = lastChunk.splice(contLastPageMaxLines);
                contPages.push(carryOver);
            }
        }

        if (contPages.length > 1) {
            const penultimatePage = contPages[contPages.length - 2];
            const lastPage = contPages[contPages.length - 1];
            const availableLines = Math.max(0, contPageMaxLines - penultimatePage.length);
            // Move every line that fits before the final signature page.
            const movableLines = Math.min(availableLines, lastPage.length);
            penultimatePage.push(...lastPage.splice(0, movableLines));
        }

        const renderLineHtml = (line) => `
            <div class="court-thai-line" style="${line.indent ? 'padding-left: 2.5rem;' : 'padding-left: 0;'} ${line.extraStyle || ''}">
                ${line.html}
            </div>
        `;

        // Page 1 HTML (ใช้ Flex Column แยกเนื้อหาด้านบน กับ เส้นทึบสีดำก่อนท้ายกระดาษด้านล่าง เพื่อไม่ให้ทับกันเด็ดขาด)
        let html = `
        <div class="court-page">
            <div class="court-page-top">
                ${this.renderCommonHeader(doc, lawCase, t, { forCourtUse: isDefense11 })}
                ${page1PreambleHtml}

                <div class="court-lined-body">
                    ${page1Lines.map(renderLineHtml).join('')}
                    ${footerOnPage1 ? footerSignBlock : ''}
                </div>
            </div>

            ${this.renderBottomNoteSection(doc, lawCase, isPlaint4, isDefense11)}
        </div>`;

        // Continuation Pages (๔๐ ก.) สำหรับข้อความที่ล้นจากหน้าแรก
        if (contPages.length > 0) {
            contPages.forEach((chunk, pageIdx) => {
                const isLastPage = pageIdx === contPages.length - 1;
                const pageLines = chunk.slice();
                if (!isLastPage) {
                    // Keep the ruled area full when signature space shifts lines to the final page.
                    while (pageLines.length < contPageMaxLines) {
                        pageLines.push({ indent: false, plain: '', html: '&nbsp;', extraStyle: '' });
                    }
                }
                html += `
                <div class="court-page">
                    <div class="court-page-top">
                        <div class="court-punch-hole"></div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:13pt; color:#334155;">
                            <div><strong>(๔๐ ก.)</strong> ใบต่อคำคู่ความ — ${t(doc.documentTitle)}</div>
                            <div>- ${t(pageIdx + 2)} -</div>
                        </div>
                        <div class="court-lined-body">
                            ${pageLines.map(renderLineHtml).join('')}
                            ${isLastPage ? footerSignBlock : ''}
                        </div>
                    </div>
                </div>`;
            });
        }

        return html;
    },

    // แบบ (๕) คำขอท้ายคำฟ้องแพ่ง ตาม PDF
    renderEndOfPlaintForm5(doc, lawCase, clauses, extra, t) {
        return `
        <!-- หน้า ๑ คำขอท้ายคำฟ้องแพ่ง (๕) -->
        <div class="court-page">
            <div class="court-punch-hole"></div>
            <div style="font-weight:700; font-size:14.5pt; margin-left:8mm;">(๕)</div>
            <div style="font-weight:700; font-size:15pt; margin-left:8mm; margin-bottom:12px;">คำขอท้ายคำฟ้องแพ่ง</div>
            <div style="text-indent:2.5rem; margin-bottom:14px;">
                เพราะฉะนั้นขอศาลออกหมายเรียกตัวจำเลยมาพิจารณาพิพากษา และบังคับจำเลยตามคำขอต่อไปนี้
            </div>

            <div class="court-lined-body">
                ${this.renderThaiClausesLinedHtml(clauses, t, 8)}
            </div>

            <div style="margin-top:16px; text-indent:2.5rem;">
                ข้าพเจ้าได้ยื่นสำเนาคำฟ้องโดยข้อความถูกต้องเป็นอย่างเดียวกันมาด้วย <span class="court-dotted-line" style="min-width:55px;">${t(extra.CopiesCount ?? '๑')}</span> ฉบับ และรอฟังคำสั่งอยู่ ถ้าไม่รอให้ถือว่าทราบแล้ว
            </div>

            ${this.renderClosingPrayerLine(t(doc.closingPrayer || 'ควรมิควรแล้วแต่จะโปรด'))}
            ${this.renderCenteredSigRow(doc.signatureImageBase64, t(doc.signerName || ''), 'โจทก์')}
            <div style="text-align:right; margin-top:18px; font-weight:600;">(พลิก)</div>
        </div>

        <!-- หน้า ๒ หลังใบคำขอท้ายคำฟ้องแพ่ง (ผู้เรียง / ผู้เขียนหรือพิมพ์) -->
        <div class="court-page">
            <div class="court-punch-hole"></div>
            <div style="margin-top:12mm; margin-bottom:28px;">
                <div class="court-preamble-row indent">
                    <span>คำฟ้องฉบับนี้ข้าพเจ้า</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.drafterName || 'นายปิยะณัฐ วัชราภรณ์')}</span>
                </div>
                <div class="court-preamble-row compact" style="margin:4px 0;">
                    <span>เลขประจำตัวประชาชน</span> ${this.renderCitizenBoxes(extra.DrafterCitizenId ?? '3730100915068', doc.useThaiNumerals !== false)}
                </div>
                <div class="court-preamble-row compact">
                    <span>ทนายความใบอนุญาตที่</span> <span class="court-dotted-line" style="flex:1.1;">${t(extra.DrafterLicenseNo ?? '๗๘๓๔/๒๕๒๙')}</span>
                    <span>อยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:0.8;">${t(extra.DrafterHouseNo ?? '๙๐/๓')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.5;">-</span>
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:1.2;">ปลัดมณฑล</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DrafterSubDistrict ?? 'เมืองเหนือ')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DrafterDistrict ?? 'เมือง')}</span>
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DrafterProvince ?? 'ศรีสะเกษ')}</span>
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.8;">${t(extra.DrafterPostalCode ?? '๓๓๐๐๐')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DrafterPhone ?? '๐๘๙-๒๘๐๒๔๕๐')}</span>
                    <span>โทรสาร</span> <span class="court-dotted-line" style="flex:1;">-</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ไปรษณีย์อิเล็กทรอนิกส์</span> <span class="court-dotted-line" style="flex:1;">-</span> <span>เป็นผู้เรียง</span>
                </div>
                ${this.renderCenteredSigRow(doc.drafterSignatureBase64, t(doc.drafterName || ''), 'ผู้เรียง')}
            </div>

            <div style="margin-top:34px;">
                <div class="court-preamble-row indent">
                    <span>คำฟ้องฉบับนี้ข้าพเจ้า</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.typistName || 'นายชาญณรงค์ ผ่องแผ้ว')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>อยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:0.9;">${t(extra.TypistHouseNo ?? '๒๖๐/๑๗')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.6;">${t(extra.TypistMoo ?? '๕')}</span>
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:1.8;">-</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.TypistSubDistrict ?? 'หนองครก')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.TypistDistrict ?? 'เมือง')}</span>
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.TypistProvince ?? 'ศรีสะเกษ')}</span>
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.8;">${t(extra.TypistPostalCode ?? '๓๓๐๐๐')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1;">${t(extra.TypistPhone ?? '๐๘๘-๗๗๗๖-๗๗๕')}</span> <span>เป็นผู้เขียนหรือพิมพ์</span>
                </div>
                ${this.renderCenteredSigRow(doc.typistSignatureBase64, t(doc.typistName || ''), 'ผู้เขียนหรือพิมพ์')}
            </div>
        </div>`;
    },

    // แบบ (๖) คำขอท้ายคำฟ้องอาญา ตาม PDF
    renderEndOfCrimPlaintForm6(doc, lawCase, clauses, extra, t) {
        return `
        <div class="court-page">
            <div class="court-punch-hole"></div>
            <div style="font-weight:700; font-size:14.5pt; margin-left:8mm;">(๖)</div>
            <div style="font-weight:700; font-size:15pt; margin-left:8mm; margin-bottom:12px;">คำขอท้ายคำฟ้องอาญา</div>
            <div style="text-indent:2.5rem;">
                การที่จำเลยได้กระทำตามข้อความที่กล่าวมาในคำฟ้องนั้น ข้าพเจ้าถือว่าเป็นความผิดต่อกฎหมาย และบทมาตราดังนี้ คือ
                <span class="court-dotted-line" data-criminal-legal-basis style="display:block; width:100%; text-indent:0; white-space:pre-wrap; overflow-wrap:anywhere;">${t(extra.CriminalLegalBasis ?? (clauses[0]?.Content || clauses[0]?.content || lawCase?.chargeOrCauseOfAction || ''))}</span>
            </div>
            <div style="text-indent:2.5rem; margin-top:12px;">
                ขอให้ศาลออกหมาย <span class="court-dotted-line" style="min-width:160px;">เรียก</span> จำเลยมาพิจารณาพิพากษาลงโทษตามกฎหมาย และขอให้ศาลสั่งและบังคับจำเลยตามคำขอต่อไปนี้
            </div>
            <div class="court-lined-body" style="margin-top:8px;">
                ${this.renderThaiClausesLinedHtml(clauses, t, 6)}
            </div>
            <div style="margin-top:10px; text-indent:2.5rem;">
                ข้าพเจ้าได้ยื่นสำเนาคำฟ้องโดยข้อความถูกต้องเป็นอย่างเดียวกันมาด้วย <span class="court-dotted-line" style="min-width:45px;">๑</span> ฉบับ และรอฟังคำสั่งอยู่ ถ้าไม่รอให้ถือว่าทราบแล้ว
            </div>
            ${this.renderClosingPrayerLine(t(doc.closingPrayer || 'ควรมิควรแล้วแต่จะโปรด'))}
            ${this.renderCenteredSigRow(doc.signatureImageBase64, t(doc.signerName || ''), 'โจทก์')}
        </div>
        <!-- หน้า ๒ หน้าหลังคำขอท้ายคำฟ้องอาญา (๖) ตาม PDF -->
        <div class="court-page">
            <div class="court-punch-hole"></div>
            <div style="margin-top:12mm; margin-bottom:28px;">
                <div class="court-preamble-row indent">
                    <span>คำฟ้องฉบับนี้ข้าพเจ้า</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.drafterName || 'นายปิยะณัฐ วัชราภรณ์')}</span>
                </div>
                <div class="court-preamble-row compact" style="margin:4px 0;">
                    <span>เลขประจำตัวประชาชน</span> ${this.renderCitizenBoxes(extra.DrafterCitizenId ?? '3730100915068', doc.useThaiNumerals !== false)}
                </div>
                <div class="court-preamble-row compact">
                    <span>ทนายความใบอนุญาตที่</span> <span class="court-dotted-line" style="flex:1.1;">${t(extra.DrafterLicenseNo ?? '๗๘๓๔/๒๕๒๙')}</span>
                    <span>อยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:0.8;">${t(extra.DrafterHouseNo ?? '๙๐/๓')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.5;">-</span>
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:1.2;">ปลัดมณฑล</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DrafterSubDistrict ?? 'เมืองเหนือ')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DrafterDistrict ?? 'เมือง')}</span>
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DrafterProvince ?? 'ศรีสะเกษ')}</span>
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.8;">${t(extra.DrafterPostalCode ?? '๓๓๐๐๐')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.DrafterPhone ?? '๐๘๙-๒๘๐๒๔๕๐')}</span>
                    <span>โทรสาร</span> <span class="court-dotted-line" style="flex:1;">-</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ไปรษณีย์อิเล็กทรอนิกส์</span> <span class="court-dotted-line" style="flex:1;">-</span> <span>เป็นผู้เรียง</span>
                </div>
                ${this.renderCenteredSigRow(doc.drafterSignatureBase64, t(doc.drafterName || ''), 'ผู้เรียง')}
            </div>

            <div style="margin-top:34px;">
                <div class="court-preamble-row indent">
                    <span>คำฟ้องฉบับนี้ข้าพเจ้า</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.typistName || 'นายชาญณรงค์ ผ่องแผ้ว')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>อยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:0.9;">${t(extra.TypistHouseNo ?? '๒๖๐/๑๗')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.6;">${t(extra.TypistMoo ?? '๕')}</span>
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:1.8;">-</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.TypistSubDistrict ?? 'หนองครก')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.TypistDistrict ?? 'เมือง')}</span>
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.2;">${t(extra.TypistProvince ?? 'ศรีสะเกษ')}</span>
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.8;">${t(extra.TypistPostalCode ?? '๓๓๐๐๐')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1;">${t(extra.TypistPhone ?? '๐๘๘-๗๗๗๖-๗๗๕')}</span> <span>เป็นผู้เขียนหรือพิมพ์</span>
                </div>
                ${this.renderCenteredSigRow(doc.typistSignatureBase64, t(doc.typistName || ''), 'ผู้เขียนหรือพิมพ์')}
            </div>
        </div>`;
    },

    // แบบ (๙) ใบแต่งทนายความ ตาม PDF
    renderAppointmentForm9(doc, lawCase, clauses, extra, t) {
        const powerText = clauses[0]?.Content || clauses[0]?.content ||
            'ดำเนินกระบวนพิจารณาใดๆ ไปในทางจำหน่ายสิทธิของข้าพเจ้าได้ด้วย เช่น การยอมรับตามที่คู่ความอีกฝ่ายหนึ่งเรียกร้อง การถอนฟ้อง การประนีประนอมยอมความ การสละสิทธิหรือใช้สิทธิในการอุทธรณ์หรือฎีกาหรือขอให้พิจารณาคดีใหม่';
        const lawyerProfile = extra.Form9Lawyer || {};
        const lawyerValue = (key, legacyValue = '') => t(
            Object.prototype.hasOwnProperty.call(lawyerProfile, key)
                ? lawyerProfile[key] ?? ''
                : legacyValue ?? ''
        );
        const lawyerName = lawyerValue('fullName', extra.AppointedLawyerName ?? doc.drafterName ?? '');

        return `
        <!-- หน้า ๑ ใบแต่งทนายความ (๙) -->
        <div class="court-page court-form9-page">
            ${this.renderCommonHeader(doc, lawCase, t)}

            <div class="court-preamble-row" style="margin-top:10px;">
                <span>ข้าพเจ้า</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.requesterFullName || '')}</span>
                <span style="font-weight:600;">${t(doc.requesterStatus || 'โจทก์/จำเลย')}</span>
            </div>
            <div class="court-preamble-row" style="margin-top:8px;">
                <span>ขอแต่งให้</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(lawyerName)}</span>
            </div>
            <div style="margin-top:8px; text-align:left; word-spacing:normal;">
                เป็นทนายความของข้าพเจ้าในคดีนี้ และให้มีอำนาจ * <span class="court-dotted-block" style="padding:0 4px;">${this.formatThaiInlineHtml(t(powerText))}</span>
            </div>
            <div class="court-preamble-row" style="margin-top:10px;">
                <span>ข้าพเจ้ายอมรับผิดชอบตามที่</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(lawyerName)}</span>
            </div>
            <div>ทนายความจะได้ดำเนินกระบวนพิจารณาต่อไปตามกฎหมาย</div>

            ${this.renderCenteredSigRow(doc.signatureImageBase64, t(doc.signerName || doc.requesterFullName), 'ผู้แต่งทนายความ')}
            <div style="text-align:right; font-weight:600; margin-top:6px;">(พลิก)</div>

            <div style="margin-top:12px; border-top:1.5px solid #000; padding-top:8px; font-size:12pt; color:#1e293b;">
                <strong><u>หมายเหตุ</u> *</strong> ตามประมวลกฎหมายวิธีพิจารณาความแพ่งมาตรา ๖๒ ทนายความไม่มีอำนาจดำเนินกระบวนพิจารณาใดไปในทางจำหน่ายสิทธิของคู่ความนั้น เช่น การยอมรับตามที่คู่ความอีกฝ่ายหนึ่งเรียกร้อง การถอนฟ้อง การประนีประนอมยอมความ การสละสิทธิ หรือการใช้สิทธิในการอุทธรณ์หรือฎีกา หรือในการขอให้พิจารณาคดีใหม่ ถ้าจะมอบให้มีอำนาจดังกล่าวประการใดบ้าง ให้กรอกลงในช่องที่ว่างไว้โดยระบุให้ชัดแจ้ง (คำที่ไม่ใช้และช่องว่างที่เหลือให้ขีดเสีย)
            </div>
        </div>

        <!-- หน้า ๒ คำรับเป็นทนายความ (ด้านหลังแบบพิมพ์ ๙ ตาม PDF) -->
        <div class="court-page court-form9-page">
            <div class="court-punch-hole"></div>
            <div style="text-align:center; font-weight:700; font-size:15.5pt; text-decoration:underline; margin-bottom:14px;">คำรับเป็นทนายความ</div>

            <div class="court-preamble-row indent">
                <span>ข้าพเจ้า</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(lawyerName)}</span>
            </div>
            <div class="court-preamble-row compact" style="margin:6px 0;">
                <span>เลขประจำตัวประชาชน</span> ${this.renderCitizenBoxes(lawyerValue('citizenId', doc.requesterCitizenId), doc.useThaiNumerals !== false)}
            </div>
            <div class="court-preamble-row compact">
                <span>ใบอนุญาตให้เป็นทนายความเลขที่</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${lawyerValue('licenseNo', extra.LicenseNo)}</span>
                <span>ได้รับอนุญาตให้ว่าความ</span> <span class="court-dotted-line" style="flex:1.2;">${lawyerValue('licenseJurisdiction', extra.Jurisdiction)}</span>
            </div>
            <div class="court-preamble-row indent compact">
                <span>ที่อยู่ปัจจุบันเลขที่</span> <span class="court-dotted-line" style="flex:0.8;">${lawyerValue('houseNo', doc.requesterHouseNo)}</span>
                <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.5;">${lawyerValue('moo', doc.requesterMoo)}</span>
                <span>ถนน</span> <span class="court-dotted-line" style="flex:1.4;">${lawyerValue('road', doc.requesterRoad)}</span>
            </div>
            <div class="court-preamble-row compact">
                <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">${lawyerValue('soi', doc.requesterSoi)}</span>
                <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${lawyerValue('subDistrict', doc.requesterSubDistrict)}</span>
            </div>
            <div class="court-preamble-row compact">
                <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.1;">${lawyerValue('district', doc.requesterDistrict)}</span>
                <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.1;">${lawyerValue('province', doc.requesterProvince)}</span>
                <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.8;">${lawyerValue('postalCode', doc.requesterPostalCode)}</span>
            </div>
            <div class="court-preamble-row compact">
                <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1;">${lawyerValue('phone', doc.requesterPhone)}</span>
                <span>โทรสาร</span> <span class="court-dotted-line" style="flex:1;">-</span>
            </div>
            <div class="court-preamble-row compact"><span>ไปรษณีย์อิเล็กทรอนิกส์</span> <span class="court-dotted-line" style="flex:1;">-</span></div>

            <div class="court-preamble-row indent compact" style="margin-top:6px;">
                <span>สำนักงานอยู่ที่</span> <span class="court-dotted-line" style="flex:0.8;">${lawyerValue('houseNo', doc.requesterHouseNo)}</span>
                <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.5;">${lawyerValue('moo', doc.requesterMoo)}</span>
                <span>ถนน</span> <span class="court-dotted-line" style="flex:1.4;">${lawyerValue('road', doc.requesterRoad)}</span>
            </div>
            <div class="court-preamble-row compact">
                <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">${lawyerValue('soi', doc.requesterSoi)}</span>
                <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${lawyerValue('subDistrict', doc.requesterSubDistrict)}</span>
            </div>
            <div class="court-preamble-row compact">
                <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1;">${lawyerValue('district', doc.requesterDistrict)}</span>
                <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1;">${lawyerValue('province', doc.requesterProvince)}</span>
                <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.7;">${lawyerValue('postalCode', doc.requesterPostalCode)}</span>
                <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1;">${lawyerValue('phone', doc.requesterPhone)}</span>
            </div>
            <div class="court-preamble-row" style="margin-top:8px;">
                <span>ขอรับเป็นทนายความของ</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.requesterFullName || '')}</span>
            </div>
            <div>เพื่อดำเนินกระบวนพิจารณาต่อไปตามหน้าที่ในกฎหมาย</div>

            ${this.renderCenteredSigRow(doc.drafterSignatureBase64, t(lawyerName), 'ทนายความ')}

            <div style="margin-top:24px;">
                <div style="text-align:center; font-weight:700; text-decoration:underline; font-size:15pt;">คำสั่ง</div>
                <div class="court-lined-body">
                    <div class="court-thai-line">&nbsp;</div>
                    <div class="court-thai-line">&nbsp;</div>
                    <div class="court-thai-line">&nbsp;</div>
                </div>
                ${this.renderCenteredSigRow('', '', 'ผู้พิพากษา')}
            </div>
        </div>`;
    },

    // แบบ (๑๐) ใบมอบฉันทะ ตาม PDF (มีเลขบัตรประชาชน ๑๓ หลักของทั้งผู้มอบฉันทะและผู้รับมอบฉันทะ)
    renderProxyForm10(doc, lawCase, clauses, extra, t) {
        return `
        <div class="court-page">
            ${this.renderCommonHeader(doc, lawCase, t)}

            <div class="court-preamble-row indent" style="margin-top:6px;">
                <span>ข้าพเจ้า</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.requesterFullName || doc.drafterName || '')}</span>
            </div>
            <div class="court-preamble-row compact" style="margin:4px 0;">
                <span>เลขประจำตัวประชาชน</span> ${this.renderCitizenBoxes(doc.requesterCitizenId || '3730100915068', doc.useThaiNumerals !== false)}
            </div>
            <div class="court-preamble-row" style="margin:4px 0;">
                <span>ขอมอบฉันทะให้</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.typistName || 'นายชาญณรงค์ ผ่องแผ้ว (เสมียนทนาย)')}</span>
            </div>
            <div class="court-preamble-row compact" style="margin:4px 0;">
                <span>เลขประจำตัวประชาชน</span> ${this.renderCitizenBoxes(extra.ProxyCitizenId ?? '3330100881294', doc.useThaiNumerals !== false)}
            </div>
            <div class="court-preamble-row compact">
                <span>อยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:0.8;">${t(doc.requesterHouseNo || '๒๖๐/๑๗')}</span>
                <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.5;">${t(doc.requesterMoo || '๕')}</span>
                <span>ถนน</span> <span class="court-dotted-line" style="flex:1.6;">${t(doc.requesterRoad || '-')}</span>
            </div>
            <div class="court-preamble-row compact">
                <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">-</span>
                <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterSubDistrict || 'หนองครก')}</span>
            </div>
            <div class="court-preamble-row compact">
                <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.1;">${t(doc.requesterDistrict || 'เมืองฯ')}</span>
                <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.1;">${t(doc.requesterProvince || 'ศรีสะเกษ')}</span>
                <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.8;">${t(doc.requesterPostalCode || '๓๓๐๐๐')}</span>
            </div>
            <div class="court-preamble-row compact">
                <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1;">${t(doc.requesterPhone || '-')}</span>
                <span>โทรสาร</span> <span class="court-dotted-line" style="flex:0.8;">-</span>
                <span>ไปรษณีย์อิเล็กทรอนิกส์</span> <span class="court-dotted-line" style="flex:1.2;">-</span>
            </div>
            <div style="margin:8px 0;">
                ทำการแทน โดยข้าพเจ้ายอมรับผิดชอบในการที่ผู้รับมอบฉันทะของข้าพเจ้าได้ทำการไปนั้นทุกประการ ในกิจการดังที่จะกล่าวต่อไปนี้
            </div>

            <div class="court-lined-body">
                ${this.renderThaiClausesLinedHtml(clauses, t, 4)}
            </div>

            ${this.renderCenteredSigRow(doc.signatureImageBase64, t(doc.signerName || doc.requesterFullName), 'ผู้มอบฉันทะ')}
            ${this.renderCenteredSigRow(doc.typistSignatureBase64, t(doc.typistName || 'นายชาญณรงค์ ผ่องแผ้ว'), 'ผู้รับมอบฉันทะ')}
            ${this.renderCenteredSigRow('', '', 'พยาน')}
            ${this.renderCenteredSigRow('', '', 'พยาน')}
        </div>`;
    },

    // แบบ (๑๒) หมายเรียกคดีมโนสาเร่หรือคดีไม่มีข้อยุ่งยาก (หน้า ๑ และ หน้า ๒ ตาม PDF)
    renderSummonsForm12(doc, lawCase, clauses, extra, t) {
        return `
        <div class="court-page">
            ${this.renderCommonHeader(doc, lawCase, t, { forCourtUse: true, royalHeading: 'ในพระปรมาภิไธยพระมหากษัตริย์' })}
            <div class="court-preamble-row" style="margin:8px 0;">
                <span>หมายถึง</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.requesterFullName || lawCase?.defendantName || '')}</span> <span>จำเลย</span>
            </div>
            <div style="text-indent:2.5rem;">
                ด้วยโจทก์ได้ยื่นฟ้องจำเลยต่อศาลนี้มีข้อหาเป็นใจความว่า <span class="court-dotted-line" style="min-width:320px;">${t(clauses[0]?.Content || clauses[0]?.content || 'ตามสำเนาคำฟ้องซึ่งได้ส่งมาพร้อมกับหมายเรียกนี้')}</span>
            </div>
            <div class="court-preamble-row" style="margin:8px 0;">
                <span>จำนวนทุนทรัพย์หรือราคาที่เรียกร้อง</span> <span class="court-dotted-line" style="flex:2; font-weight:600;">${t(extra.ClaimAmountBaht ?? (lawCase?.claimAmount ? lawCase.claimAmount.toLocaleString() : '๑๕๘,๑๒๕'))}</span> <span>บาท</span> <span class="court-dotted-line" style="flex:0.8;">${t(extra.ClaimAmountSatang ?? '-')}</span> <span>สตางค์</span>
            </div>
            <div style="text-indent:2.5rem; margin:10px 0;">
                เพราะฉะนั้น ให้ท่านไปศาลเพื่อการไกล่เกลี่ย ให้การแก้ข้อหาแห่งคดี และสืบพยาน
            </div>
            <div class="court-preamble-row">
                <span>วันที่</span> <span class="court-dotted-line" style="flex:0.7;">${t(extra.HearingDay ?? doc.docDay ?? '๑๒')}</span>
                <span>เดือน</span> <span class="court-dotted-line" style="flex:1.4;">${extra.HearingMonth ?? doc.docMonth ?? 'กุมภาพันธ์'}</span>
                <span>พ.ศ. ๒๕</span><span class="court-dotted-line" style="flex:0.6;">${t(doc.docYear || '๖๗')}</span>
                <span>เวลา</span> <span class="court-dotted-line" style="flex:0.9;">${t(extra.HearingTime ?? '๐๙.๐๐')}</span> <span>นาฬิกา</span>
            </div>
            <div style="margin-top:28px;">
                ${this.renderCenteredSigRow('', '', 'ผู้พิพากษา')}
            </div>
            <div style="position:absolute; bottom:16mm; right:16mm; font-weight:600;">(พลิก)</div>
        </div>

        <!-- หน้า ๒ ด้านหลังหมายเรียกคดีมโนสาเร่ (๑๒) ตาม PDF -->
        <div class="court-page">
            <div class="court-punch-hole"></div>
            <div style="margin-top:16mm;">
                <div class="court-preamble-row compact">
                    <span>จำเลยอยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:0.9;">${t(doc.requesterHouseNo || '-')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.6;">${t(doc.requesterMoo || '-')}</span>
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:1.6;">${t(doc.requesterRoad || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterSubDistrict || '-')}</span>
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterDistrict || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterProvince || 'ศรีสะเกษ')}</span>
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.8;">${t(doc.requesterPostalCode || '๓๓๐๐๐')}</span>
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1.3;">${t(doc.requesterPhone || '-')}</span>
                </div>
            </div>
            <div style="margin-top:42mm; text-align:center; font-weight:700; text-decoration:underline;">คำแนะนำ</div>
            <div style="text-indent:2.5rem; margin-top:12px;">
                หากประสงค์จะไกล่เกลี่ยให้ติดต่อหน่วยงานไกล่เกลี่ยประนอมข้อพิพาทประจำศาล
            </div>
            <div class="court-preamble-row"><span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1;">&nbsp;</span></div>
        </div>`;
    },

    // แบบ (๑๓) หมายเรียกคดีแพ่งสามัญ ตาม PDF
    renderSummonsForm13(doc, lawCase, clauses, extra, t) {
        return `
        <div class="court-page">
            ${this.renderCommonHeader(doc, lawCase, t, { forCourtUse: true, royalHeading: 'ในพระปรมาภิไธยพระมหากษัตริย์' })}
            <div class="court-preamble-row" style="margin:8px 0;">
                <span>หมายถึง</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.requesterFullName || lawCase?.defendantName || '')}</span> <span>จำเลย</span>
            </div>
            <div style="text-indent:2.5rem;">
                ด้วยโจทก์ได้ยื่นฟ้องจำเลยต่อศาลนี้ มีข้อความตามสำเนาคำฟ้อง ซึ่งได้ส่งมาให้ทราบพร้อมกับหมายนี้แล้ว
            </div>
            <div style="text-indent:2.5rem; margin-top:6px;">
                เพราะฉะนั้น ให้ท่านทำคำให้การแก้คดียื่นต่อศาลภายใน ๑๕ วัน นับแต่วันที่ได้รับหมายหรือถือว่าได้รับหมายนี้
            </div>
            <div class="court-preamble-row indent compact" style="margin-top:6px;">
                <span>นัดชี้สองสถาน/สืบพยานโจทก์ วันที่</span> <span class="court-dotted-line" style="flex:0.6;">${t(extra.HearingDay ?? doc.docDay ?? '')}</span>
                <span>เดือน</span> <span class="court-dotted-line" style="flex:1.2;">${extra.HearingMonth ?? doc.docMonth ?? ''}</span>
                <span>พ.ศ. ๒๕</span><span class="court-dotted-line" style="flex:0.5;">${t(doc.docYear || '')}</span>
                <span>เวลา</span> <span class="court-dotted-line" style="flex:0.7;">${t(extra.HearingTime ?? '')}</span> <span>นาฬิกา</span>
            </div>
            <div style="margin-top:20px;">
                ${this.renderCenteredSigRow('', '', 'ผู้พิพากษา')}
            </div>
            <div style="margin-top:16px; font-size:13.5pt;">
                <div>รับหมายวันที่ <span class="court-dotted-line" style="min-width:180px;">&nbsp;</span></div>
                <div>ปิดหมายวันที่ <span class="court-dotted-line" style="min-width:180px;">&nbsp;</span></div>
                <div>ผู้ส่ง <span class="court-dotted-line" style="min-width:210px;">&nbsp;</span></div>
            </div>
            <div style="text-align:right; font-weight:600;">(พลิก)</div>
            <div class="court-preamble-row compact" style="margin-top:8px;">
                <span>จำเลยอยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:0.9;">${t(doc.requesterHouseNo || '-')}</span>
                <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.6;">${t(doc.requesterMoo || '-')}</span>
                <span>ถนน</span> <span class="court-dotted-line" style="flex:1.6;">${t(doc.requesterRoad || '-')}</span>
            </div>
        </div>`;
    },

    // แบบ (๑๔) หมายเรียกคดีอาญา ตาม PDF
    renderSummonsForm14(doc, lawCase, clauses, extra, t) {
        return `
        <div class="court-page">
            ${this.renderCommonHeader(doc, lawCase, t, { forCourtUse: true, royalHeading: 'ในพระปรมาภิไธยพระมหากษัตริย์' })}
            <div class="court-preamble-row" style="margin:8px 0;">
                <span>หมายถึง</span> <span class="court-dotted-line" style="flex:1; font-weight:600;">${t(doc.requesterFullName || lawCase?.defendantName || '')}</span> <span>จำเลย</span>
            </div>
            <div style="text-indent:2.5rem;">
                ตามที่โจทก์ได้ยื่นฟ้องกล่าวโทษจำเลยต่อศาลนี้หาว่ากระทำผิดเป็นความอาญา มีข้อความตามสำเนาคำฟ้องซึ่งได้ส่งมาให้ทราบพร้อมกับหมายนัดไต่สวนมูลฟ้องแล้วนั้น
            </div>
            <div style="text-indent:2.5rem; margin-top:6px;">
                บัดนี้ ศาลได้มีคำสั่งประทับฟ้องในกระทงความผิด <span class="court-dotted-line" style="min-width:280px;">${t(lawCase?.chargeOrCauseOfAction || '')}</span>
            </div>
            <div class="court-preamble-row compact" style="margin-top:8px;">
                <span>และนัดจำเลยให้การ/สืบพยานโจทก์ วันที่</span> <span class="court-dotted-line" style="flex:0.6;">${t(extra.HearingDay ?? doc.docDay ?? '')}</span>
                <span>เดือน</span> <span class="court-dotted-line" style="flex:1.2;">${extra.HearingMonth ?? doc.docMonth ?? ''}</span>
                <span>พ.ศ. ๒๕</span><span class="court-dotted-line" style="flex:0.5;">${t(doc.docYear || '')}</span>
                <span>เวลา</span> <span class="court-dotted-line" style="flex:0.7;">${t(extra.HearingTime ?? '')}</span> <span>นาฬิกา</span>
            </div>
            <div style="text-indent:2.5rem; margin-top:6px;">เพราะฉะนั้น ให้จำเลยไปศาลตามกำหนดนี้</div>
            <div style="margin-top:20px;">
                ${this.renderCenteredSigRow('', '', 'ผู้พิพากษา')}
            </div>
            <div style="margin-top:16px;">
                <div>ศาล <span class="court-dotted-line" style="min-width:180px;">${t(lawCase?.courtName || 'จังหวัดศรีสะเกษ')}</span></div>
                <div>โทรศัพท์ <span class="court-dotted-line" style="min-width:160px;">&nbsp;</span></div>
            </div>
            <div style="text-align:right; font-weight:600;">(พลิก)</div>
        </div>

        <!-- หน้า ๒ ด้านหลังหมายเรียกคดีอาญา (๑๔) ตาม PDF -->
        <div class="court-page">
            <div class="court-punch-hole"></div>
            <div style="margin-top:16mm;">
                <div class="court-preamble-row compact">
                    <span>จำเลยอยู่บ้านเลขที่</span> <span class="court-dotted-line" style="flex:0.9;">${t(doc.requesterHouseNo || '-')}</span>
                    <span>หมู่ที่</span> <span class="court-dotted-line" style="flex:0.6;">${t(doc.requesterMoo || '-')}</span>
                    <span>ถนน</span> <span class="court-dotted-line" style="flex:1.6;">${t(doc.requesterRoad || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>ตรอก/ซอย</span> <span class="court-dotted-line" style="flex:1;">-</span>
                    <span>ตำบล/แขวง</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterSubDistrict || '-')}</span>
                    <span>อำเภอ/เขต</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterDistrict || '-')}</span>
                </div>
                <div class="court-preamble-row compact">
                    <span>จังหวัด</span> <span class="court-dotted-line" style="flex:1.2;">${t(doc.requesterProvince || 'ศรีสะเกษ')}</span>
                    <span>รหัสไปรษณีย์</span> <span class="court-dotted-line" style="flex:0.8;">${t(doc.requesterPostalCode || '๓๓๐๐๐')}</span>
                    <span>โทรศัพท์</span> <span class="court-dotted-line" style="flex:1.3;">${t(doc.requesterPhone || '-')}</span>
                </div>
            </div>
            <div style="margin-top:42mm; text-align:center; font-weight:700; text-decoration:underline;">คำเตือน</div>
            <div style="text-align:center; margin-top:10px;">
                หากจำเลยไม่มาตามหมายเรียกโดยไม่มีข้อแก้ตัวอันควรเป็นเหตุที่ศาลอาจออกหมายจับได้
            </div>
        </div>`;
    },

    // แบบ (๑๕) บัญชีพยาน
    renderWitnessForm15(doc, lawCase, witnesses, extra, t) {
        const rows = Array.isArray(witnesses) ? [...witnesses] : [];
        const totalDeclared = t(extra.TotalWitnessCount ?? rows.length ?? '๑๐');
        while (rows.length < 12) {
            rows.push({ OrderNo: '', WitnessNameAndDesc: '', AddressText: '', Note: '' });
        }

        return `
        <div class="court-page">
            ${this.renderCommonHeader(doc, lawCase, t)}

            <div style="display:flex; justify-content:space-between; margin:6px 0;">
                <div>ข้าพเจ้า <span class="court-dotted-line" style="min-width:260px; font-weight:600;">${t(doc.requesterFullName || '')}</span></div>
                <div style="font-weight:600;">${t(doc.requesterStatus || doc.lawyerRoleInDoc || '')}</div>
            </div>
            <div style="margin-bottom:6px;">
                ขอระบุพยานของข้าพเจ้ารวม <span class="court-dotted-line" style="min-width:55px; font-weight:700;">${totalDeclared}</span> อันดับ ตามบัญชีตารางข้างล่างนี้
            </div>

            <table class="court-witness-table">
                <thead>
                    <tr>
                        <th style="width:10%;">อันดับ</th>
                        <th style="width:46%;">ชื่อและสกุลพยาน / เอกสารวัตถุพยาน</th>
                        <th style="width:32%;">บ้านเลขที่ หมู่ที่ ถนน ซอย<br/>ตำบล/แขวง อำเภอ/เขต จังหวัด</th>
                        <th style="width:12%;">หมายเหตุ<br/>(นำ/หมาย)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(w => {
            const ord = w.OrderNo || w.orderNo || '';
            const name = w.WitnessNameAndDesc || w.witnessNameAndDesc || w.Content || w.content || '';
            const addr = w.AddressText || w.addressText || '-';
            const note = w.Note || w.note || '';
            return `
                        <tr>
                            <td style="text-align:center; font-weight:600;">${ord ? t(ord) : '&nbsp;'}</td>
                            <td>${name ? t(name) : '&nbsp;'}</td>
                            <td>${name ? t(addr) : '&nbsp;'}</td>
                            <td style="text-align:center; font-weight:600;">${note ? t(note) : '&nbsp;'}</td>
                        </tr>`;
        }).join('')}
                </tbody>
            </table>

            ${this.renderCenteredSigRow(doc.signatureImageBase64, t(doc.signerName || doc.requesterFullName), 'ผู้ระบุ')}
            <div style="font-size:12pt; color:#334155; text-align:center; margin-top:6px;">
                หมายเหตุ: กรณีเด็กอายุไม่เกิน ๑๘ ปี ให้ระบุด้วย เพื่อประสานงานในการสืบพยานเด็ก
            </div>
        </div>`;
    }
};
