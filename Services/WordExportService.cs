using System.Text.Json;
using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public class WordExportService
{
    /// <summary>
    /// จัดระเบียบการเคาะวรรคตามระบบภาษาไทย (ใช้แนวทางเดียวกันทั้งโปรเจ็กต์)
    /// ยึดเกณฑ์ราชบัณฑิตยสภาและงานสารบรรณศาลยุติธรรม เคาะวรรค ๑ เคาะมาตรฐาน
    /// </summary>
    public static string NormalizeThaiSpacing(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return string.Empty;
        var normalizedLines = input.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
        for (int i = 0; i < normalizedLines.Length; i++)
        {
            var line = Regex.Replace(normalizedLines[i], @"[\t\u00A0\u2000-\u200A]+", " ");
            line = Regex.Replace(line, @" {2,}", " ").Trim();
            if (string.IsNullOrEmpty(line))
            {
                normalizedLines[i] = string.Empty;
                continue;
            }

            // 1. ลบช่องว่างเกินหลัง '(' และหน้า ')'
            line = Regex.Replace(line, @"\(\s+", "(");
            line = Regex.Replace(line, @"\s+\)", ")");

            // 2. เคาะวรรค ๑ เคาะหน้า '(' และหลัง ')' เมื่อติดกับอักษรไทยหรือตัวเลข
            line = Regex.Replace(line, @"([ก-๙0-9๐-๙])\(", "$1 (");
            line = Regex.Replace(line, @"\)([ก-๙0-9๐-๙])", ") $1");

            // 3. รูปแบบคำย่อมาตรฐานในเอกสารศาล เช่น (น.ส. ๓ ก.), พ.ศ. ๒๕๖๕, ม. ๓๔๑
            line = Regex.Replace(line, @"น\.ส\.\s*([0-9๐-๙])\s*ก\.", "น.ส. $1 ก.");
            line = Regex.Replace(line, @"พ\.ศ\.\s*([0-9๐-๙])", "พ.ศ. $1");
            line = Regex.Replace(line, @"(?<![ก-๙])ม\.\s*([0-9๐-๙])", "ม. $1");

            // 4. เคาะวรรค ๑ เคาะระหว่างตัวอักษรไทยกับตัวเลข
            line = Regex.Replace(line, @"([ก-ฮะ-์])([0-9๐-๙])", "$1 $2");
            line = Regex.Replace(line, @"([0-9๐-๙])([ก-ฮเ-ไ])", "$1 $2");

            // 5. เครื่องหมายจุลภาคในตัวเลขห้ามเว้นวรรค ส่วนจุลภาคคั่นข้อความให้เคาะวรรคหลัง ',' ๑ เคาะ (ระวัง: [ก-๙] รวมเลขไทย ๐-๙ ด้วย จึงต้องใช้ [ก-ฮเ-ไ])
            line = Regex.Replace(line, @"([0-9๐-๙])\s*,\s*([0-9๐-๙])", "$1,$2");
            line = Regex.Replace(line, @",([ก-ฮเ-ไ])", ", $1");

            // 6. คำย่อ ต. / อ. / จ. ให้เขียนชิดชื่อ และเคาะวรรค ๑ เคาะคั่นระหว่างกัน
            line = Regex.Replace(line, @"(?<![ก-๙])(ต|อ|จ)\.\s+([ก-๙])", "$1.$2");
            line = Regex.Replace(line, @"([ก-๙])((?:ต|อ|จ)\.[ก-๙])", "$1 $2");

            // 7. ยุบช่องว่างซ้ำทั้งหมดให้เป็น ๑ เคาะมาตรฐานตามระบบภาษาไทย
            normalizedLines[i] = Regex.Replace(line, @" {2,}", " ").Trim();
        }
        return string.Join("\n", normalizedLines);
    }
    public byte[] GenerateCourtDocumentDocx(CaseDocument doc, LawCase? lawCase)
    {
        using var ms = new MemoryStream();
        using (var wordDoc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document, true))
        {
            var mainPart = wordDoc.AddMainDocumentPart();
            mainPart.Document = new Document();
            var body = mainPart.Document.AppendChild(new Body());

            // Page Setup: A4, Standard Court Margins
            var sectionProps = new SectionProperties(
                new PageSize { Width = 11906U, Height = 16838U }, // A4 in twips
                new PageMargin { Top = 1440, Right = 1134, Bottom = 1440, Left = 1701, Header = 720, Footer = 720 }
            );

            // Title & Form Code Header (เลขคดีดำ 1 บรรทัด / เลขคดีแดง 1 บรรทัด คนละบรรทัด ห้ามตกบรรทัด)
            AppendStyledParagraph(body, $"แบบพิมพ์ศาล {doc.FormCode} — {doc.DocumentTitle}", "32", true, JustificationValues.Center);
            AppendStyledParagraph(body, $"คดีหมายเลขดำที่ {(lawCase?.BlackCaseNo ?? ".........")}/๒๕{(lawCase?.BlackCaseYear ?? "....")}", "28", false, JustificationValues.Right);
            AppendStyledParagraph(body, $"คดีหมายเลขแดงที่ {(lawCase?.RedCaseNo ?? ".........")}/๒๕{(lawCase?.RedCaseYear ?? "....")}", "28", false, JustificationValues.Right);
            AppendStyledParagraph(body, $"ศาล {lawCase?.CourtName ?? "จังหวัดศรีสะเกษ"}   วันที่ {doc.DocDay} เดือน {doc.DocMonth} พุทธศักราช ๒๕{doc.DocYear}   ความ {lawCase?.CaseCategory ?? "อาญา/แพ่ง"}", "30", true, JustificationValues.Center);
            AppendStyledParagraph(body, $"ระหว่าง   {lawCase?.PlaintiffName ?? "-"}   (โจทก์)   กับ   {lawCase?.DefendantName ?? "-"}   (จำเลย)", "28", false, JustificationValues.Left);
            AppendStyledParagraph(body, "------------------------------------------------------------------------------------------------------------------------", "24", false, JustificationValues.Center);

            string extractedPermissionLine = "";
            bool showPermission = false;
            string savedPermission = "";
            try
            {
                using var extra = JsonDocument.Parse(doc.ExtraFieldsJson ?? "{}");
                showPermission = extra.RootElement.TryGetProperty("ShowPermission", out var show) && show.ValueKind == JsonValueKind.True;
                if (extra.RootElement.TryGetProperty("PermissionText", out var text) && text.ValueKind == JsonValueKind.String)
                    savedPermission = text.GetString() ?? "";
                if (savedPermission == "[object Object]") savedPermission = "";
            }
            catch (JsonException) { }

            if (doc.FormCode == "(๑๕)")
            {
                AppendStyledParagraph(body, $"ข้าพเจ้า {doc.RequesterFullName} ({doc.RequesterStatus}) ขอระบุพยานตามบัญชีตารางข้างล่างนี้", "28", false, JustificationValues.Left);
                var witnesses = TryParseWitnesses(doc.ClausesJson);
                var table = new Table();
                var tblProps = new TableProperties(
                    new TableBorders(
                        new TopBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 6 },
                        new BottomBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 6 },
                        new LeftBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 6 },
                        new RightBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 6 },
                        new InsideHorizontalBorder { Val = new EnumValue<BorderValues>(BorderValues.Dashed), Size = 4 },
                        new InsideVerticalBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 6 }
                    ),
                    new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct }
                );
                table.AppendChild(tblProps);

                table.Append(CreateTableRow(new[] { "อันดับ", "ชื่อและสกุลพยาน / เอกสาร", "บ้านเลขที่ หมู่ที่ ถนน ตำบล อำเภอ จังหวัด", "หมายเหตุ" }, true));
                foreach (var w in witnesses)
                {
                    table.Append(CreateTableRow(new[] { ToThaiDigits(w.OrderNo.ToString(), doc.UseThaiNumerals), w.WitnessNameAndDesc, w.AddressText, w.Note }, false));
                }
                body.Append(table);
            }
            else
            {
                // Standard Preamble (เคาะวรรคตามระบบภาษาไทย ไม่ถ่างช่องว่างระหว่างคำ)
                if (!string.IsNullOrWhiteSpace(doc.RequesterFullName))
                {
                    AppendStyledParagraph(body, NormalizeThaiSpacing($"ข้าพเจ้า {doc.RequesterFullName} ({doc.RequesterStatus}) เลขประจำตัวประชาชน {doc.RequesterCitizenId}"), "28", false, JustificationValues.Left, true);
                    AppendStyledParagraph(body, NormalizeThaiSpacing($"เชื้อชาติ {doc.RequesterRace} สัญชาติ {doc.RequesterNationality} อาชีพ {doc.RequesterOccupation} อายุ {doc.RequesterAge} ปี อยู่บ้านเลขที่ {doc.RequesterHouseNo} หมู่ที่ {doc.RequesterMoo} ถนน {doc.RequesterRoad} ตำบล/แขวง {doc.RequesterSubDistrict} อำเภอ/เขต {doc.RequesterDistrict} จังหวัด {doc.RequesterProvince} รหัสไปรษณีย์ {doc.RequesterPostalCode} โทรศัพท์ {doc.RequesterPhone}"), "28", false, JustificationValues.Left, false);
                }

                var clauses = TryParseClauses(doc.ClausesJson);
                foreach (var clause in clauses)
                {
                    var lines = (clause.Content ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries);
                    for (int i = 0; i < lines.Length; i++)
                    {
                        var trimmed = NormalizeThaiSpacing(lines[i].Trim());
                        if (trimmed.StartsWith("ขอศาลได้โปรดอนุญาต") && trimmed.Length <= 60)
                        {
                            extractedPermissionLine = trimmed;
                            continue;
                        }
                        var cleanTitle = NormalizeThaiSpacing(clause.ClauseTitle);
                        var lineContent = (i == 0 && !string.IsNullOrWhiteSpace(cleanTitle))
                            ? $"{cleanTitle} {trimmed}"
                            : trimmed;
                        AppendStyledParagraph(body, lineContent, "28", false, JustificationValues.Left, true);
                    }
                }
            }

            // ย่อหน้าสุดท้ายก่อน ควรมิควรแล้วแต่จะโปรด: ขอศาลได้โปรดอนุญาต (ถ้ามี)
            if (showPermission)
            {
                var permission = !string.IsNullOrWhiteSpace(savedPermission) ? savedPermission : !string.IsNullOrWhiteSpace(extractedPermissionLine) ? extractedPermissionLine : "ขอศาลได้โปรดอนุญาต";
                AppendStyledParagraph(body, permission, "28", false, JustificationValues.Left, true);
            }

            // ควรมิควรแล้วแต่จะโปรด ต้องอยู่กึ่งกลางกระดาษ แล้วเคาะไปทางขวาอีก 6 เคาะ
            var previousSpacing = body.Elements<Paragraph>().LastOrDefault()?.ParagraphProperties?.GetFirstChild<SpacingBetweenLines>();
            if (previousSpacing != null) previousSpacing.After = "0";
            body.Append(new Paragraph(new ParagraphProperties(
                new KeepNext(), new SpacingBetweenLines { Before = "0", After = "0", Line = "465", LineRule = LineSpacingRuleValues.Exact }), new Run(new Text(" ") { Space = SpaceProcessingModeValues.Preserve })));
            AppendStyledParagraph(body, "      " + NormalizeClosingPrayer(doc.ClosingPrayer), "28", true, JustificationValues.Center);
            var closingProperties = body.Elements<Paragraph>().Last().ParagraphProperties!;
            closingProperties.GetFirstChild<SpacingBetweenLines>()!.After = "0";
            closingProperties.Append(new KeepNext());
            for (var blankLine = 0; blankLine < 2; blankLine++)
                body.Append(new Paragraph(new ParagraphProperties(new KeepNext(),
                    new SpacingBetweenLines { Before = "0", After = "0", Line = "465", LineRule = LineSpacingRuleValues.Exact }),
                    new Run(new Text(" ") { Space = SpaceProcessingModeValues.Preserve })));

            // การลงชื่อให้อยู่กึ่งกลางบรรทัด และต้องอยู่คนละบรรทัด
            AppendStyledParagraph(body, $"ลงชื่อ ........................................................................... {doc.SignerRole}", "28", false, JustificationValues.Center);
            if (!string.IsNullOrWhiteSpace(doc.SignerName))
            {
                AppendStyledParagraph(body, $"({doc.SignerName})", "28", false, JustificationValues.Center);
            }

            if (!string.IsNullOrWhiteSpace(doc.DrafterName) || !string.IsNullOrWhiteSpace(doc.TypistName))
            {
                AppendStyledParagraph(body, $"คำร้องฉบับนี้ {doc.DrafterName} เป็นผู้เรียง / {doc.TypistName} เสมียนทนายเป็นผู้พิมพ์", "26", false, JustificationValues.Center);
                AppendStyledParagraph(body, "ลงชื่อ ........................................................................... ผู้เรียง", "26", false, JustificationValues.Center);
                AppendStyledParagraph(body, "ลงชื่อ ........................................................................... ผู้พิมพ์", "26", false, JustificationValues.Center);
            }

            body.AppendChild(sectionProps);
            mainPart.Document.Save();
        }
        return ms.ToArray();
    }

    public static string NormalizeClosingPrayer(string? text)
    {
        var value = text?.Trim();
        return string.IsNullOrEmpty(value) || value == "ซึ่งเป็นวันสืบพยานด้วย" ? "ควรมิควรแล้วแต่จะโปรด" : value;
    }

    private static void AppendStyledParagraph(Body body, string text, string fontSizeHalfPt, bool bold, JustificationValues align, bool firstLineIndent = false)
    {
        var p = new Paragraph();
        var pPr = new ParagraphProperties(
            new Justification { Val = align },
            new SpacingBetweenLines { After = "120", Line = "300", LineRule = LineSpacingRuleValues.Auto }
        );
        if (firstLineIndent)
        {
            pPr.AppendChild(new Indentation { FirstLine = "720" });
        }
        p.AppendChild(pPr);

        var run = new Run();
        var rPr = new RunProperties(
            new RunFonts { Ascii = "TH SarabunPSK", HighAnsi = "TH SarabunPSK", ComplexScript = "TH SarabunPSK" },
            new FontSize { Val = fontSizeHalfPt },
            new FontSizeComplexScript { Val = fontSizeHalfPt }
        );
        if (bold)
        {
            rPr.AppendChild(new Bold());
            rPr.AppendChild(new BoldComplexScript());
        }
        run.AppendChild(rPr);
        run.AppendChild(new Text(text) { Space = SpaceProcessingModeValues.Preserve });
        p.AppendChild(run);
        body.AppendChild(p);
    }

    private static TableRow CreateTableRow(string[] cells, bool isHeader)
    {
        var tr = new TableRow();
        foreach (var cellText in cells)
        {
            var tc = new TableCell();
            var p = new Paragraph(new ParagraphProperties(new Justification { Val = isHeader ? JustificationValues.Center : JustificationValues.Left }));
            var r = new Run();
            var rPr = new RunProperties(
                new RunFonts { Ascii = "TH SarabunPSK", HighAnsi = "TH SarabunPSK", ComplexScript = "TH SarabunPSK" },
                new FontSize { Val = "28" },
                new FontSizeComplexScript { Val = "28" }
            );
            if (isHeader) rPr.AppendChild(new Bold());
            r.AppendChild(rPr);
            r.AppendChild(new Text(cellText ?? ""));
            p.AppendChild(r);
            tc.AppendChild(p);
            tr.AppendChild(tc);
        }
        return tr;
    }

    private static List<ClauseItem> TryParseClauses(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<List<ClauseItem>>(json) ?? new(); }
        catch { return new(); }
    }

    private static List<WitnessItem> TryParseWitnesses(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<List<WitnessItem>>(json) ?? new(); }
        catch { return new(); }
    }

    private static string ToThaiDigits(string input, bool useThai)
    {
        if (!useThai) return input;
        return input
            .Replace('0', '๐').Replace('1', '๑').Replace('2', '๒').Replace('3', '๓').Replace('4', '๔')
            .Replace('5', '๕').Replace('6', '๖').Replace('7', '๗').Replace('8', '๘').Replace('9', '๙');
    }
}
