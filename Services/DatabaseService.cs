using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public class DatabaseService
{
    private readonly string _connectionString;
    private readonly ILogger<DatabaseService> _logger;

    public DatabaseService(IConfiguration configuration, ILogger<DatabaseService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection is missing");
        var pool = new SqlConnectionStringBuilder(_connectionString) {
            MaxPoolSize = configuration.GetValue("Capacity:SqlMaxPoolSize", 200),
            MinPoolSize = configuration.GetValue("Capacity:SqlMinPoolSize", 5),
            ApplicationName = "SmartLaws"
        };
        _connectionString = pool.ConnectionString;
        _logger = logger;
    }

    public SqlConnection CreateConnection() => new SqlConnection(_connectionString);

    public async Task InitializeDatabaseAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var createTablesSql = @"
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_LawyerProfiles')
        BEGIN
            CREATE TABLE SL_LawyerProfiles (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                FullName NVARCHAR(200) NOT NULL,
                RoleType NVARCHAR(100) NOT NULL DEFAULT N'ทนายความ',
                LicenseNo NVARCHAR(100) NULL,
                LicenseJurisdiction NVARCHAR(150) NULL DEFAULT N'ทั่วราชอาณาจักร',
                CitizenId NVARCHAR(30) NULL,
                Race NVARCHAR(50) NULL DEFAULT N'ไทย',
                Nationality NVARCHAR(50) NULL DEFAULT N'ไทย',
                Occupation NVARCHAR(100) NULL DEFAULT N'ทนายความ',
                Age NVARCHAR(20) NULL DEFAULT N'-',
                HouseNo NVARCHAR(100) NULL,
                Moo NVARCHAR(50) NULL,
                Road NVARCHAR(150) NULL,
                Soi NVARCHAR(150) NULL,
                NearBy NVARCHAR(150) NULL,
                SubDistrict NVARCHAR(150) NULL,
                District NVARCHAR(150) NULL,
                Province NVARCHAR(150) NULL,
                PostalCode NVARCHAR(20) NULL,
                Phone NVARCHAR(100) NULL,
                OfficeName NVARCHAR(250) NULL,
                SignatureDataUrl NVARCHAR(MAX) NULL
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_LawCases')
        BEGIN
            CREATE TABLE SL_LawCases (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                CaseCode NVARCHAR(50) NOT NULL,
                BlackCaseNo NVARCHAR(50) NULL,
                BlackCaseYear NVARCHAR(20) NULL,
                RedCaseNo NVARCHAR(50) NULL,
                RedCaseYear NVARCHAR(20) NULL,
                CourtName NVARCHAR(200) NOT NULL DEFAULT N'จังหวัดศรีสะเกษ',
                CaseCategory NVARCHAR(50) NOT NULL DEFAULT N'อาญา',
                SubCategory NVARCHAR(100) NULL,
                LawyerRole NVARCHAR(100) NOT NULL DEFAULT N'ทนายโจทก์',
                RepresentingPartyOrder NVARCHAR(100) NULL,
                PlaintiffName NVARCHAR(300) NOT NULL,
                DefendantName NVARCHAR(300) NOT NULL,
                ChargeOrCauseOfAction NVARCHAR(500) NULL,
                ClaimAmount DECIMAL(18,2) NOT NULL DEFAULT 0,
                InterestRate DECIMAL(5,2) NOT NULL DEFAULT 5.00,
                CurrentProceduralStage NVARCHAR(200) NULL,
                Status NVARCHAR(100) NOT NULL DEFAULT N'กำลังดำเนินการ',
                NextHearingDate DATETIME2 NULL,
                NextHearingNote NVARCHAR(300) NULL,
                PrimaryLawyerId INT NOT NULL DEFAULT 1,
                ClerkId INT NOT NULL DEFAULT 3,
                CaseSummary NVARCHAR(MAX) NULL,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_CaseParties')
        BEGIN
            CREATE TABLE SL_CaseParties (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                CaseId INT NOT NULL,
                PartySide NVARCHAR(50) NOT NULL,
                PartyOrder INT NOT NULL DEFAULT 1,
                Title NVARCHAR(50) NULL,
                FullName NVARCHAR(250) NOT NULL,
                CitizenId NVARCHAR(30) NULL,
                Race NVARCHAR(50) NULL DEFAULT N'ไทย',
                Nationality NVARCHAR(50) NULL DEFAULT N'ไทย',
                Occupation NVARCHAR(100) NULL,
                Age NVARCHAR(20) NULL,
                BirthDateText NVARCHAR(100) NULL,
                HouseNo NVARCHAR(100) NULL,
                Moo NVARCHAR(50) NULL,
                Road NVARCHAR(150) NULL,
                Soi NVARCHAR(150) NULL,
                NearBy NVARCHAR(150) NULL,
                SubDistrict NVARCHAR(150) NULL,
                District NVARCHAR(150) NULL,
                Province NVARCHAR(150) NULL,
                PostalCode NVARCHAR(20) NULL,
                Phone NVARCHAR(100) NULL,
                Fax NVARCHAR(100) NULL,
                Email NVARCHAR(150) NULL,
                IsOurClient BIT NOT NULL DEFAULT 0
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_CourtFormTemplates')
        BEGIN
            CREATE TABLE SL_CourtFormTemplates (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                FormCode NVARCHAR(30) NOT NULL,
                FormName NVARCHAR(250) NOT NULL,
                Category NVARCHAR(50) NOT NULL,
                ApplicableRole NVARCHAR(100) NOT NULL,
                ProceduralLawRef NVARCHAR(250) NULL,
                LayoutType NVARCHAR(100) NOT NULL DEFAULT 'GarudaStandard',
                DefaultHeaderTitle NVARCHAR(250) NULL,
                DefaultPreambleTemplate NVARCHAR(MAX) NULL,
                DefaultClausesJson NVARCHAR(MAX) NULL,
                DefaultClosingText NVARCHAR(300) NULL,
                SourceWordFileName NVARCHAR(250) NULL,
                Description NVARCHAR(500) NULL
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_CaseDocuments')
        BEGIN
            CREATE TABLE SL_CaseDocuments (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                CaseId INT NOT NULL,
                TemplateId INT NOT NULL DEFAULT 1,
                FormCode NVARCHAR(30) NOT NULL,
                DocumentTitle NVARCHAR(300) NOT NULL,
                DocumentSubTitle NVARCHAR(300) NULL,
                LawyerRoleInDoc NVARCHAR(100) NULL,
                DocDay NVARCHAR(20) NULL,
                DocMonth NVARCHAR(50) NULL,
                DocYear NVARCHAR(20) NULL,
                RequesterFullName NVARCHAR(250) NULL,
                RequesterStatus NVARCHAR(150) NULL,
                RequesterCitizenId NVARCHAR(30) NULL,
                RequesterRace NVARCHAR(50) NULL,
                RequesterNationality NVARCHAR(50) NULL,
                RequesterOccupation NVARCHAR(100) NULL,
                RequesterAge NVARCHAR(20) NULL,
                RequesterHouseNo NVARCHAR(100) NULL,
                RequesterMoo NVARCHAR(50) NULL,
                RequesterRoad NVARCHAR(150) NULL,
                RequesterSoi NVARCHAR(150) NULL,
                RequesterNearBy NVARCHAR(150) NULL,
                RequesterSubDistrict NVARCHAR(150) NULL,
                RequesterDistrict NVARCHAR(150) NULL,
                RequesterProvince NVARCHAR(150) NULL,
                RequesterPostalCode NVARCHAR(20) NULL,
                RequesterPhone NVARCHAR(100) NULL,
                ClausesJson NVARCHAR(MAX) NULL,
                ExtraFieldsJson NVARCHAR(MAX) NULL,
                ClosingPrayer NVARCHAR(300) NULL,
                SignerName NVARCHAR(200) NULL,
                SignerRole NVARCHAR(150) NULL,
                DrafterName NVARCHAR(200) NULL,
                TypistName NVARCHAR(200) NULL,
                SignatureImageBase64 NVARCHAR(MAX) NULL,
                DrafterSignatureBase64 NVARCHAR(MAX) NULL,
                TypistSignatureBase64 NVARCHAR(MAX) NULL,
                UseThaiNumerals BIT NOT NULL DEFAULT 1,
                Status NVARCHAR(50) NOT NULL DEFAULT N'ฉบับสมบูรณ์',
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_ElectronicSignatures')
        BEGIN
            CREATE TABLE SL_ElectronicSignatures (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                SignerName NVARCHAR(200) NOT NULL,
                SignerRole NVARCHAR(100) NOT NULL,
                LicenseOrCitizenId NVARCHAR(100) NULL,
                SignatureType NVARCHAR(50) NOT NULL DEFAULT 'Draw',
                ImageDataUrl NVARCHAR(MAX) NOT NULL,
                VerificationHash NVARCHAR(150) NULL,
                IsDefault BIT NOT NULL DEFAULT 0,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_UserAccounts')
        BEGIN
            CREATE TABLE SL_UserAccounts (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                Username NVARCHAR(100) NOT NULL,
                PasswordHash NVARCHAR(200) NOT NULL DEFAULT '123456',
                FullName NVARCHAR(200) NOT NULL,
                Role NVARCHAR(50) NOT NULL DEFAULT 'Lawyer',
                LawyerProfileId INT NOT NULL DEFAULT 0,
                LicenseNo NVARCHAR(100) NULL,
                CitizenId NVARCHAR(30) NULL,
                Phone NVARCHAR(100) NULL,
                Email NVARCHAR(150) NULL,
                OfficeName NVARCHAR(250) NULL,
                PlanType NVARCHAR(50) NOT NULL DEFAULT 'Trial',
                PlanName NVARCHAR(200) NOT NULL DEFAULT N'ทดลองใช้งานฟรี (๓ คดี)',
                MaxCasesQuota INT NOT NULL DEFAULT 3,
                UsedCasesCount INT NOT NULL DEFAULT 0,
                SubscriptionExpireDate DATETIME2 NULL,
                AccountStatus NVARCHAR(50) NOT NULL DEFAULT 'Active',
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_SubscriptionPlans')
        BEGIN
            CREATE TABLE SL_SubscriptionPlans (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                PlanCode NVARCHAR(50) NOT NULL,
                PlanName NVARCHAR(200) NOT NULL,
                PlanCategory NVARCHAR(50) NOT NULL DEFAULT 'QuotaPack',
                PriceBaht DECIMAL(18,2) NOT NULL DEFAULT 0,
                CasesQuotaIncluded INT NOT NULL DEFAULT 3,
                DurationDays INT NOT NULL DEFAULT 30,
                Description NVARCHAR(500) NULL,
                BankAccountInfo NVARCHAR(500) NULL,
                IsActive BIT NOT NULL DEFAULT 1
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_PaymentSlips')
        BEGIN
            CREATE TABLE SL_PaymentSlips (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                UserId INT NOT NULL,
                UserFullName NVARCHAR(200) NOT NULL,
                PlanId INT NOT NULL,
                PlanName NVARCHAR(200) NOT NULL,
                PlanCategory NVARCHAR(50) NOT NULL DEFAULT 'QuotaPack',
                AmountBaht DECIMAL(18,2) NOT NULL DEFAULT 0,
                CasesQuotaRequested INT NOT NULL DEFAULT 0,
                TransferDateText NVARCHAR(50) NULL,
                TransferTimeText NVARCHAR(50) NULL,
                BankName NVARCHAR(150) NULL,
                SlipImageBase64 NVARCHAR(MAX) NULL,
                ReferenceNote NVARCHAR(500) NULL,
                Status NVARCHAR(50) NOT NULL DEFAULT N'รอตรวจสอบ',
                AdminRemark NVARCHAR(500) NULL,
                ReviewedBy NVARCHAR(150) NULL,
                ReviewedAt DATETIME2 NULL,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_CaseFileAttachments')
        BEGIN
            CREATE TABLE SL_CaseFileAttachments (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                CaseId INT NOT NULL,
                DocumentId INT NULL,
                DirectoryIndexNo INT NOT NULL DEFAULT 1,
                FormCode NVARCHAR(30) NOT NULL DEFAULT N'(๗)',
                DirectoryCategoryName NVARCHAR(250) NULL,
                FileTitle NVARCHAR(300) NOT NULL,
                StorageType NVARCHAR(50) NOT NULL DEFAULT 'PDF',
                FileStatus NVARCHAR(100) NOT NULL DEFAULT N'ยื่นต่อศาลแล้ว',
                FileUrlOrPath NVARCHAR(500) NULL,
                FileDataBase64 NVARCHAR(MAX) NULL,
                MimeType NVARCHAR(100) NULL DEFAULT 'application/pdf',
                PageCount INT NOT NULL DEFAULT 1,
                UploadedBy NVARCHAR(200) NULL,
                Remark NVARCHAR(500) NULL,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SL_LawyerClerkMappings')
        BEGIN
            CREATE TABLE SL_LawyerClerkMappings (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                LawyerUserId INT NOT NULL,
                LawyerFullName NVARCHAR(200) NOT NULL,
                ClerkUserId INT NOT NULL,
                ClerkProfileId INT NOT NULL DEFAULT 3,
                ClerkFullName NVARCHAR(200) NOT NULL,
                ClerkUsername NVARCHAR(100) NULL,
                ClerkCitizenId NVARCHAR(30) NULL,
                ClerkPhone NVARCHAR(100) NULL,
                Permissions NVARCHAR(500) NULL DEFAULT N'พิมพ์คำคู่ความ, ยื่นคำร้อง/ปิดหมาย, รับมอบฉันทะ (แบบ ๑๐), จัดเก็บไฟล์สารบัญสำนวน',
                IsDefaultTypist BIT NOT NULL DEFAULT 1,
                IsActive BIT NOT NULL DEFAULT 1,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END
        ";

        await conn.ExecuteAsync(createTablesSql);
        await SeedInitialDataAsync(conn);
        await SeedMembershipAndFileDirectoryAsync(conn);
        await NormalizeExistingDatabaseRecordsAsync(conn);
    }

    public static void NormalizeDocumentThaiSpacing(CaseDocument doc)
    {
        doc.DocumentTitle = WordExportService.NormalizeThaiSpacing(doc.DocumentTitle);
        doc.ClosingPrayer = WordExportService.NormalizeClosingPrayer(WordExportService.NormalizeThaiSpacing(doc.ClosingPrayer));
        doc.SignerRole = doc.SignerRole?.Replace("(ผู้จัดทำร่างหมายเรียก)", "").Trim() ?? "";
        if (!string.IsNullOrWhiteSpace(doc.ClausesJson))
        {
            try
            {
                if (doc.FormCode == "(๑๕)" || doc.FormCode == "(๓)" || doc.FormCode == "(๘)")
                {
                    var items = JsonSerializer.Deserialize<List<WitnessItem>>(doc.ClausesJson);
                    if (items != null)
                    {
                        foreach (var w in items)
                        {
                            w.WitnessNameAndDesc = WordExportService.NormalizeThaiSpacing(w.WitnessNameAndDesc);
                            w.AddressText = WordExportService.NormalizeThaiSpacing(w.AddressText);
                            w.Note = WordExportService.NormalizeThaiSpacing(w.Note);
                        }
                        doc.ClausesJson = JsonSerializer.Serialize(items);
                    }
                }
                else
                {
                    var clauses = JsonSerializer.Deserialize<List<ClauseItem>>(doc.ClausesJson);
                    if (clauses != null)
                    {
                        foreach (var c in clauses)
                        {
                            c.ClauseTitle = WordExportService.NormalizeThaiSpacing(c.ClauseTitle);
                            c.Content = WordExportService.NormalizeThaiSpacing(c.Content);
                        }
                        doc.ClausesJson = JsonSerializer.Serialize(clauses);
                    }
                }
            }
            catch
            {
                // Keep original JSON if custom schema
            }
        }
    }

    private async Task NormalizeExistingDatabaseRecordsAsync(SqlConnection conn)
    {
        var docs = (await conn.QueryAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments")).ToList();
        foreach (var d in docs)
        {
            var before = d.ClausesJson;
            var beforeTitle = d.DocumentTitle;
            var beforeClosing = d.ClosingPrayer;
            var beforeRole = d.SignerRole;
            NormalizeDocumentThaiSpacing(d);
            if (d.ClausesJson != before || d.DocumentTitle != beforeTitle || d.ClosingPrayer != beforeClosing || d.SignerRole != beforeRole)
            {
                await conn.ExecuteAsync(@"
                    UPDATE SL_CaseDocuments
                    SET DocumentTitle = @DocumentTitle,
                        ClausesJson = @ClausesJson,
                        ClosingPrayer = @ClosingPrayer,
                        SignerRole = @SignerRole
                    WHERE Id = @Id", d);
            }
        }
    }

    private async Task SeedInitialDataAsync(SqlConnection conn)
    {
        var lawyerCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawyerProfiles");
        if (lawyerCount == 0)
        {
            var sigPiyanat = GenerateSvgSignatureDataUrl("ปิยะณัฐ วัชราภรณ์", "#1a365d");
            var sigKriangkrai = GenerateSvgSignatureDataUrl("เกรียงไกร โล่ห์ทวนชัย", "#1e3a8a");
            var sigChannarong = GenerateSvgSignatureDataUrl("ชาญณรงค์ ผ่องแผ้ว", "#334155");
            var sigAkaradej = GenerateSvgSignatureDataUrl("นพ.อัครเดช บุญเย็น", "#0f766e");
            var sigPailin = GenerateSvgSignatureDataUrl("ไพลิน อาจสามารถ", "#4338ca");

            await conn.ExecuteAsync(@"
                INSERT INTO SL_LawyerProfiles (FullName, RoleType, LicenseNo, LicenseJurisdiction, CitizenId, Race, Nationality, Occupation, Age, HouseNo, Moo, Road, Soi, NearBy, SubDistrict, District, Province, PostalCode, Phone, OfficeName, SignatureDataUrl)
                VALUES
                (N'นายปิยะณัฐ วัชราภรณ์', N'ทนายความ', N'7834/2529', N'ทั่วราชอาณาจักร', N'3-7301-00915-06-8', N'ไทย', N'ไทย', N'ทนายความ', N'74', N'90/3', N'-', N'ปลัดมณฑล', N'-', N'-', N'เมืองเหนือ', N'เมืองฯ', N'ศรีสะเกษ', N'33000', N'089-2802450', N'สำนักงานทนายความปิยะณัฐ วัชราภรณ์', @Sig1),
                (N'นายเกรียงไกร โล่ห์ทวนชัย', N'ทนายความ', N'10492/2535', N'ทั่วราชอาณาจักร', N'3-3301-00412-55-1', N'ไทย', N'ไทย', N'ทนายความ', N'68', N'174/5', N'-', N'ปลัดมณฑล', N'-', N'-', N'เมืองเหนือ', N'เมืองฯ', N'ศรีสะเกษ', N'33000', N'093-3269893', N'สำนักงานกฎหมายเกรียงไกร โล่ห์ทวนชัย', @Sig2),
                (N'นายชาญณรงค์ ผ่องแผ้ว', N'เสมียนทนาย', N'-', N'-', N'3-3301-00881-29-4', N'ไทย', N'ไทย', N'เสมียนทนาย', N'42', N'260/17', N'5', N'-', N'-', N'-', N'หนองครก', N'เมืองฯ', N'ศรีสะเกษ', N'33000', N'088-7776775', N'สำนักงานทนายความจังหวัดศรีสะเกษ', @Sig3);
            ", new { Sig1 = sigPiyanat, Sig2 = sigKriangkrai, Sig3 = sigChannarong });

            await conn.ExecuteAsync(@"
                INSERT INTO SL_ElectronicSignatures (SignerName, SignerRole, LicenseOrCitizenId, SignatureType, ImageDataUrl, VerificationHash, IsDefault)
                VALUES
                (N'นายปิยะณัฐ วัชราภรณ์', N'ทนายโจทก์ / ผู้เรียง', N'ใบอนุญาตทนายความ 7834/2529', N'E-Signature Pad', @Sig1, N'SHA256-8F92A4C10D2E', 1),
                (N'นายเกรียงไกร โล่ห์ทวนชัย', N'ทนายจำเลย / ผู้เรียง', N'ใบอนุญาตทนายความ 10492/2535', N'E-Signature Pad', @Sig2, N'SHA256-3B71E9A05F11', 1),
                (N'นายชาญณรงค์ ผ่องแผ้ว', N'ผู้พิมพ์ / ผู้รับมอบฉันทะ', N'เสมียนทนายความ', N'E-Signature Pad', @Sig3, N'SHA256-7C44D2B88E19', 1),
                (N'นายแพทย์อัครเดช บุญเย็น', N'จำเลยที่ ๒ / ผู้ร้อง', N'ลูกความ (คดีหมายเลขดำ อ 398/2568)', N'E-Signature Pad', @Sig4, N'SHA256-9A15F0C33B22', 0),
                (N'นางไพลิน อาจสามารถ', N'โจทก์ / ผู้แต่งทนายความ', N'ลูกความ (คดีแพ่งกู้ยืมเงิน)', N'E-Signature Pad', @Sig5, N'SHA256-5E60B8D41C08', 0);
            ", new { Sig1 = sigPiyanat, Sig2 = sigKriangkrai, Sig3 = sigChannarong, Sig4 = sigAkaradej, Sig5 = sigPailin });
        }

        var expectedTemplates = GetInitialTemplates();
        foreach (var t in expectedTemplates)
        {
            var exists = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CourtFormTemplates WHERE FormCode = @FormCode", new { t.FormCode });
            if (exists == 0)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO SL_CourtFormTemplates (FormCode, FormName, Category, ApplicableRole, ProceduralLawRef, LayoutType, DefaultHeaderTitle, DefaultPreambleTemplate, DefaultClausesJson, DefaultClosingText, SourceWordFileName, Description)
                    VALUES (@FormCode, @FormName, @Category, @ApplicableRole, @ProceduralLawRef, @LayoutType, @DefaultHeaderTitle, @DefaultPreambleTemplate, @DefaultClausesJson, @DefaultClosingText, @SourceWordFileName, @Description)
                ", t);
            }
        }

        var caseCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawCases");
        if (caseCount == 0)
        {
            await SeedExampleCasesAndDocumentsAsync(conn);
        }
    }

    private List<CourtFormTemplate> GetInitialTemplates()
    {
        return new List<CourtFormTemplate>
        {
            new()
            {
                FormCode = "(๑)",
                FormName = "ปกหน้าสำนวน",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทุกฝ่าย",
                ProceduralLawRef = "สารบัญแบบพิมพ์ศาล (แบบ ๑)",
                LayoutType = "CaseCover1",
                DefaultHeaderTitle = "ปกหน้าสำนวน",
                DefaultPreambleTemplate = "",
                DefaultClausesJson = "[]",
                DefaultClosingText = "",
                SourceWordFileName = "แบบ ๑ ปกหน้าสำนวน.pdf",
                Description = "แบบพิมพ์ศาล (๑) ปกหน้าสำนวน ระบุเรื่อง ทุนทรัพย์ เอกสารเก็บเลขที่ และรายการบันทึก ๑-๑๘"
            },
            new()
            {
                FormCode = "(๒)",
                FormName = "หน้าสำนวน",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทุกฝ่าย",
                ProceduralLawRef = "สารบัญแบบพิมพ์ศาล (แบบ ๒)",
                LayoutType = "CaseFront2",
                DefaultHeaderTitle = "หน้าสำนวน",
                DefaultPreambleTemplate = "",
                DefaultClausesJson = "[]",
                DefaultClosingText = "",
                SourceWordFileName = "แบบ ๒ หน้าสำนวน.pdf",
                Description = "แบบพิมพ์ศาล (๒) หน้าสำนวน ระบุวันฟ้อง วันนัดชี้สองสถาน วันพิจารณา และบันทึกการอ่านคำพิพากษาหรือคำสั่ง"
            },
            new()
            {
                FormCode = "(๓)",
                FormName = "สารบาญ",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทุกฝ่าย",
                ProceduralLawRef = "สารบัญแบบพิมพ์ศาล (แบบ ๓)",
                LayoutType = "IndexForm3",
                DefaultHeaderTitle = "สารบาญ",
                DefaultPreambleTemplate = "",
                DefaultClausesJson = JsonSerializer.Serialize(new List<WitnessItem>
                {
                    new() { OrderNo = 1, WitnessNameAndDesc = "คำฟ้อง / คำร้อง", AddressText = "๒", Note = "-" },
                    new() { OrderNo = 2, WitnessNameAndDesc = "ใบแต่งทนายความ", AddressText = "๑", Note = "-" }
                }),
                DefaultClosingText = "",
                SourceWordFileName = "แบบ ๓ สารบาญ.pdf",
                Description = "แบบพิมพ์ศาล (๓) ตารางสารบาญสำนวนความ (อันดับ, รายการ, จำนวนแผ่น, หมายเหตุ)"
            },
            new()
            {
                FormCode = "(๔)",
                FormName = "คำฟ้อง (คดีแพ่ง / คดีอาญา)",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทนายโจทก์",
                ProceduralLawRef = "ป.วิ.พ. มาตรา ๑๗๒ / ป.วิ.อ. มาตรา ๑๕๘ (แบบ ๔)",
                LayoutType = "PlaintForm4",
                DefaultHeaderTitle = "คำฟ้อง",
                DefaultPreambleTemplate = "มีข้อความตามที่จะกล่าวต่อไปนี้",
                DefaultClausesJson = JsonSerializer.Serialize(new List<ClauseItem>
                {
                    new() { ClauseTitle = "ข้อ ๑.", Content = "เมื่อวันที่ ๑๑ พฤศจิกายน ๒๕๖๕ จำเลยได้กู้ยืมเงินโจทก์จำนวน ๑๕๐,๐๐๐ บาท และได้รับเงินไปครบถ้วนแล้ว โดยสัญญาว่าจะชำระเงินคืนให้โจทก์ภายในวันที่ ๑๒ มกราคม ๒๕๖๖..." },
                    new() { ClauseTitle = "ข้อ ๒.", Content = "เมื่อครบกำหนดที่จำเลยจะต้องชำระเงินคืนให้โจทก์ จำเลยไม่ชำระคืน โจทก์ได้ทวงถามจำเลยหลายครั้งแต่จำเลยผลัดผ่อนตลอดมา..." }
                }),
                DefaultClosingText = "ควรมิควรแล้วแต่จะโปรด",
                SourceWordFileName = "คำฟ้อง(สั้น).doc / แบบ ๔ คำฟ้อง.pdf",
                Description = "แบบพิมพ์ศาล (๔) คำฟ้อง ระบุข้อหา จำนวนทุนทรัพย์ ข้อมูลโจทก์ (เลข ปชช. ๑๓ หลัก) ขอยื่นฟ้องจำเลย (เลข ปชช. ๑๓ หลัก) และบรรยายฟ้อง"
            },
            new()
            {
                FormCode = "(๕)",
                FormName = "คำขอท้ายคำฟ้องแพ่ง",
                Category = "แพ่ง",
                ApplicableRole = "ทนายโจทก์",
                ProceduralLawRef = "ป.วิ.พ. มาตรา ๑๗๒ วรรคสอง (แบบ ๕)",
                LayoutType = "EndOfPlaint5",
                DefaultHeaderTitle = "คำขอท้ายคำฟ้องแพ่ง",
                DefaultPreambleTemplate = "เพราะฉะนั้นขอศาลออกหมายเรียกตัวจำเลยมาพิจารณาพิพากษา และบังคับจำเลยตามคำขอต่อไปนี้",
                DefaultClausesJson = JsonSerializer.Serialize(new List<ClauseItem>
                {
                    new() { ClauseTitle = "๑.", Content = "ให้จำเลยชำระเงินจำนวน ๑๕๘,๑๒๕ บาท ให้โจทก์" },
                    new() { ClauseTitle = "๒.", Content = "ให้จำเลยชำระดอกเบี้ยในอัตราร้อยละ ๕ ต่อปี ของเงินต้น ๑๕๐,๐๐๐ บาท นับจากวันฟ้องจนกว่าจะชำระเสร็จแก่โจทก์" },
                    new() { ClauseTitle = "๓.", Content = "ให้จำเลยใช้ค่าฤชาธรรมเนียมและค่าทนายความ รวมทั้งค่าใช้จ่ายในการดำเนินคดีแทนโจทก์" }
                }),
                DefaultClosingText = "ข้าพเจ้าได้ยื่นสำเนาคำฟ้องโดยข้อความถูกต้องเป็นอย่างเดียวกันมาด้วย ๑ ฉบับ และรอฟังคำสั่งอยู่ ถ้าไม่รอให้ถือว่าทราบแล้ว",
                SourceWordFileName = "ท้ายฟ้องแพ่ง.doc / แบบฟอร์มคำขอท้ายคำฟ้องแพ่ง.docx",
                Description = "แบบพิมพ์ศาล (๕) คำขอท้ายคำฟ้องแพ่ง หน้า ๑ (รายการคำขอบังคับ ๑-๔) และหน้า ๒ (พลิก - ข้อมูลทนายความผู้เรียงและเสมียนผู้พิมพ์)"
            },
            new()
            {
                FormCode = "(๖)",
                FormName = "คำขอท้ายคำฟ้องอาญา",
                Category = "อาญา",
                ApplicableRole = "ทนายโจทก์",
                ProceduralLawRef = "ป.วิ.อ. มาตรา ๑๕๘ (๖) (แบบ ๖)",
                LayoutType = "EndOfCrimPlaint6",
                DefaultHeaderTitle = "คำขอท้ายคำฟ้องอาญา",
                DefaultPreambleTemplate = "การที่จำเลยได้กระทำตามข้อความที่กล่าวมาในคำฟ้องนั้น ข้าพเจ้าถือว่าเป็นความผิดต่อกฎหมาย และบทมาตราดังนี้ คือ",
                DefaultClausesJson = JsonSerializer.Serialize(new List<ClauseItem>
                {
                    new() { ClauseTitle = "๑.", Content = "ประมวลกฎหมายอาญา มาตรา ๓๔๑, ๓๔๓ ประกอบมาตรา ๘๓" },
                    new() { ClauseTitle = "๒.", Content = "ขอให้ศาลออกหมายเรียกจำเลยมาพิจารณาพิพากษาลงโทษตามกฎหมาย" }
                }),
                DefaultClosingText = "ข้าพเจ้าได้ยื่นสำเนาคำฟ้องโดยข้อความถูกต้องเป็นอย่างเดียวกันมาด้วย ๑ ฉบับ และรอฟังคำสั่งอยู่ ถ้าไม่รอให้ถือว่าทราบแล้ว",
                SourceWordFileName = "แบบ ๖ คำขอท้ายคำฟ้องอาญา.pdf",
                Description = "แบบพิมพ์ศาล (๖) คำขอท้ายคำฟ้องอาญา ระบุกฎหมายและบทมาตราที่ขอให้ลงโทษจำเลย พร้อมหน้าหลังระบุผู้เรียงและผู้พิมพ์"
            },
            new()
            {
                FormCode = "(๗)",
                FormName = "คำร้อง / คำแถลง / คำขอ (ทั่วไปและปิดคดี)",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทุกฝ่าย",
                ProceduralLawRef = "ป.วิ.พ. มาตรา ๒๑, ๗๙ / ป.วิ.อ. มาตรา ๑๕ (แบบ ๗)",
                LayoutType = "GarudaStandard",
                DefaultHeaderTitle = "คำร้อง / คำแถลง / คำขอ",
                DefaultPreambleTemplate = "ขอยื่นคำร้อง / คำแถลง / คำขอ มีข้อความตามที่จะกล่าวต่อไปนี้",
                DefaultClausesJson = JsonSerializer.Serialize(new List<ClauseItem>
                {
                    new() { ClauseTitle = "ข้อ ๑.", Content = "คดีนี้...\nขอศาลได้โปรดอนุญาต" }
                }),
                DefaultClosingText = "ควรมิควรแล้วแต่จะโปรด",
                SourceWordFileName = "คำร้อง ขอปิดหมาย.doc / คำร้องขอยืนคำให้การ.doc / คำแถลงปิดคดี398-2568-Full-Version-1.0.doc",
                Description = "แบบพิมพ์ศาล (๗) ใช้ได้ทั้งทนายโจทก์และทนายจำเลย เช่น คำร้องขอปิดหมาย คำร้องขอยื่นคำให้การเพิ่มเติม คำร้องขอขยายระยะเวลา และคำแถลงปิดคดี"
            },
            new()
            {
                FormCode = "(๘)",
                FormName = "บัญชีทรัพย์",
                Category = "แพ่ง",
                ApplicableRole = "ทุกฝ่าย",
                ProceduralLawRef = "สารบัญแบบพิมพ์ศาล (แบบ ๘)",
                LayoutType = "PropertyList8",
                DefaultHeaderTitle = "บัญชีทรัพย์",
                DefaultPreambleTemplate = "",
                DefaultClausesJson = JsonSerializer.Serialize(new List<WitnessItem>
                {
                    new() { OrderNo = 1, WitnessNameAndDesc = "หนังสือรับรองการทำประโยชน์ (น.ส. ๓ ก.) เลขที่ ๙๔/๙๓ ต.ศรีสำราญ อ.วังหิน จ.ศรีสะเกษ", AddressText = "๑ แปลง", Note = "๑๕๐,๐๐๐" }
                }),
                DefaultClosingText = "ผู้ยื่น",
                SourceWordFileName = "แบบ ๘ บัญชีทรัพย์.pdf",
                Description = "แบบพิมพ์ศาล (๘) ตารางบัญชีทรัพย์ (อันดับ, รายการ, จำนวน, ราคา บาท-สตางค์, หมายเหตุ และยอดรวม)"
            },
            new()
            {
                FormCode = "(๙)",
                FormName = "ใบแต่งทนายความ",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทุกฝ่าย",
                ProceduralLawRef = "ป.วิ.พ. มาตรา ๖๐, ๖๒ / ป.วิ.อ. มาตรา ๑๕ (แบบ ๙)",
                LayoutType = "Appointment9",
                DefaultHeaderTitle = "ใบแต่งทนายความ",
                DefaultPreambleTemplate = "เป็นทนายความของข้าพเจ้าในคดีนี้ และให้มีอำนาจ* ดำเนินกระบวนพิจารณาใดๆ ไปในทางจำหน่ายสิทธิของข้าพเจ้าได้ด้วย เช่น การยอมรับตามที่คู่ความอีกฝ่ายหนึ่งเรียกร้อง การถอนฟ้อง การประนีประนอมยอมความ การสละสิทธิหรือใช้สิทธิในการอุทธรณ์หรือฎีกา หรือในการขอให้พิจารณาคดีใหม่",
                DefaultClausesJson = "[]",
                DefaultClosingText = "เพื่อดำเนินกระบวนพิจารณาต่อไปตามหน้าที่ในกฎหมาย",
                SourceWordFileName = "ใบแต่งทนายความ-ไพลินรัต.doc / แบบ ๙ ใบแต่งทนายความ.pdf",
                Description = "แบบพิมพ์ศาล (๙) ใบแต่งทนายความ หน้า ๑ (การตั้งทนายและมอบอำนาจตาม ม.๖๒) และหน้า ๒ (พลิก - คำรับเป็นทนายความและคำสั่งศาล)"
            },
            new()
            {
                FormCode = "(๑๐)",
                FormName = "ใบมอบฉันทะ (ทนายความ/เสมียนทนาย)",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทุกฝ่าย",
                ProceduralLawRef = "ป.วิ.พ. มาตรา ๖๔ (แบบ ๑๐)",
                LayoutType = "Proxy10",
                DefaultHeaderTitle = "ใบมอบฉันทะ",
                DefaultPreambleTemplate = "ทำการแทน โดยข้าพเจ้ายอมรับผิดชอบในการที่ผู้รับมอบฉันทะของข้าพเจ้าได้ทำการไปนั้นทุกประการ ในกิจการดังที่จะกล่าวต่อไปนี้",
                DefaultClausesJson = JsonSerializer.Serialize(new List<ClauseItem>
                {
                    new() { ClauseTitle = "๑.", Content = "ยื่นคำคู่ความต่างๆ และกำหนดวันนัดพิจารณาครั้งต่อไป" },
                    new() { ClauseTitle = "๒.", Content = "รับทราบคำสั่งศาล และรับสำเนาคำคู่ความหรือเอกสารในสำนวน" }
                }),
                DefaultClosingText = "ลงชื่อผู้มอบฉันทะ / ผู้รับมอบฉันทะ / พยาน",
                SourceWordFileName = "ใบมอบฉันทะ.doc / แบบ ๑๐ ใบมอบฉันทะ.pdf",
                Description = "แบบพิมพ์ศาล (๑๐) ระบุเลขบัตรประชาชน ୧๓ หลักของผู้มอบฉันทะและผู้รับมอบฉันทะ พร้อมลงชื่อผู้มอบฉันทะ ผู้รับมอบฉันทะ และพยาน ๒ คน"
            },
            new()
            {
                FormCode = "(๑๑)",
                FormName = "คำให้การจำเลย / คำให้การเพิ่มเติม (๑๑ / ๑๑ ก.)",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทนายจำเลย",
                ProceduralLawRef = "ป.วิ.พ. มาตรา ๑๗๗ / ป.วิ.อ. มาตรา ๑๗๒ (แบบ ๑๑)",
                LayoutType = "Defense11A",
                DefaultHeaderTitle = "คำให้การจำเลย",
                DefaultPreambleTemplate = "ได้ทราบคำฟ้องตลอดแล้ว ขอให้การตามที่จะกล่าวต่อไปนี้",
                DefaultClausesJson = JsonSerializer.Serialize(new List<ClauseItem>
                {
                    new() { ClauseTitle = "ข้อ ๑.", Content = "จำเลยขอให้การปฏิเสธฟ้องโจทก์ตลอดข้อกล่าวหา และขอชี้แจงรายละเอียดแห่งข้อต่อสู้ ดังนี้..." }
                }),
                DefaultClosingText = "ควรมิควรแล้วแต่จะโปรด",
                SourceWordFileName = "คำให้การ.doc / แบบ ๑๑ คำให้การจำเลย.pdf",
                Description = "แบบพิมพ์ศาล (๑๑) และ (๑๑ ก.) คำให้การจำเลย มีข้อความสำหรับศาลใช้มุมบนขวา และหมายเหตุท้ายหน้าแรกพร้อมกรณีจำเลยหลายคน"
            },
            new()
            {
                FormCode = "(๑๒)",
                FormName = "หมายเรียกคดีมโนสาเร่หรือคดีไม่มีข้อยุ่งยาก",
                Category = "แพ่ง",
                ApplicableRole = "ทนายโจทก์",
                ProceduralLawRef = "ป.วิ.พ. มาตรา ๑๙๓ (แบบ ๑๒)",
                LayoutType = "Summons12",
                DefaultHeaderTitle = "หมายเรียกคดีมโนสาเร่หรือคดีไม่มีข้อยุ่งยาก",
                DefaultPreambleTemplate = "ด้วยโจทก์ได้ยื่นฟ้องจำเลยต่อศาลนี้มีข้อหาเป็นใจความว่า ตามสำเนาคำฟ้องซึ่งได้ส่งมาพร้อมกับหมายเรียกนี้",
                DefaultClausesJson = "[]",
                DefaultClosingText = "เพราะฉะนั้น ให้ท่านไปศาลเพื่อการไกล่เกลี่ย ให้การแก้ข้อหาแห่งคดี และสืบพยาน",
                SourceWordFileName = "หมายเรียกมโนสาเร่(ศาลแพ่งใต้)(12).doc / แบบ ๑๒.pdf",
                Description = "แบบพิมพ์ศาล (๑๒) หมายเรียกคดีมโนสาเร่ ในพระปรมาภิไธยพระมหากษัตริย์ หน้า ๑ นัดไกล่เกลี่ย/ให้การ/สืบพยาน และหน้า ๒ (พลิก) ที่อยู่จำเลยและคำแนะนำไกล่เกลี่ย"
            },
            new()
            {
                FormCode = "(๑๓)",
                FormName = "หมายเรียกคดีแพ่งสามัญ",
                Category = "แพ่ง",
                ApplicableRole = "ทนายโจทก์",
                ProceduralLawRef = "ป.วิ.พ. มาตรา ๑๗๓ (แบบ ๑๓)",
                LayoutType = "Summons13",
                DefaultHeaderTitle = "หมายเรียกคดีแพ่งสามัญ",
                DefaultPreambleTemplate = "ด้วยโจทก์ได้ยื่นฟ้องจำเลยต่อศาลนี้ มีข้อความตามสำเนาคำฟ้อง ซึ่งได้ส่งมาให้ทราบพร้อมกับหมายนี้แล้ว",
                DefaultClausesJson = "[]",
                DefaultClosingText = "เพราะฉะนั้น ให้ท่านทำคำให้การแก้คดียื่นต่อศาลภายใน ๑๕ วัน นับแต่วันที่ได้รับหมายหรือถือว่าได้รับหมายนี้",
                SourceWordFileName = "หมายเรียกคดีแพ่งสามัญ จำเลยที่ ๑.doc / แบบ ๑๓.pdf",
                Description = "แบบพิมพ์ศาล (๑๓) หมายเรียกคดีแพ่งสามัญ ระบุให้ยื่นคำให้การภายใน ๑๕ วัน วันนัดชี้สองสถาน ช่องรับหมาย/ปิดหมายวันที่/ผู้ส่ง และหน้า ๒ คำแนะนำไกล่เกลี่ย"
            },
            new()
            {
                FormCode = "(๑๔)",
                FormName = "หมายเรียกคดีอาญา",
                Category = "อาญา",
                ApplicableRole = "ทนายโจทก์",
                ProceduralLawRef = "ป.วิ.อ. มาตรา ๕๒, ๑๖๕ (แบบ ๑๔)",
                LayoutType = "Summons14",
                DefaultHeaderTitle = "หมายเรียกคดีอาญา",
                DefaultPreambleTemplate = "ตามที่โจทก์ได้ยื่นฟ้องกล่าวโทษจำเลยต่อศาลนี้หาว่ากระทำผิดเป็นความอาญา มีข้อความตามสำเนาคำฟ้องซึ่งได้ส่งมาให้ทราบพร้อมกับหมายนัดไต่สวนมูลฟ้องแล้วนั้น",
                DefaultClausesJson = "[]",
                DefaultClosingText = "บัดนี้ ศาลได้มีคำสั่งประทับฟ้องในกระทงความผิด และนัดจำเลยให้การแก้ข้อหาแห่งคดี พร้อมกับนัดสืบพยานโจทก์",
                SourceWordFileName = "แบบ ๑๔ หมายเรียกคดีอาญา.pdf",
                Description = "แบบพิมพ์ศาล (๑๔) หมายเรียกคดีอาญาหลังศาลมีคำสั่งประทับฟ้อง และหน้า ๒ คำเตือนหากจำเลยไม่มาศาลอาจถูกออกหมายจับ"
            },
            new()
            {
                FormCode = "(๑๕)",
                FormName = "บัญชีพยาน (โจทก์ / จำเลย / เพิ่มเติม)",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทุกฝ่าย",
                ProceduralLawRef = "ป.วิ.พ. มาตรา ๘๘ / ป.วิ.อ. มาตรา ๒๒๙/๑ (แบบ ๑๕)",
                LayoutType = "Witness15",
                DefaultHeaderTitle = "บัญชีพยาน",
                DefaultPreambleTemplate = "ขอระบุพยานของข้าพเจ้าตามบัญชีตารางข้างล่างนี้",
                DefaultClausesJson = "[]",
                DefaultClosingText = "ผู้ระบุ",
                SourceWordFileName = "บัญชีพยาน.doc",
                Description = "แบบพิมพ์ศาล (๑๕) ตารางบัญชีระบุพยาน (อันดับ, ชื่อและสกุลพยาน/เอกสาร, บ้านเลขที่-ที่อยู่, หมายเหตุ นำ/หมาย)"
            },
            new()
            {
                FormCode = "(๔๐ ก.)",
                FormName = "กระดาษต่อของคำคู่ความ (ใบต่อคำฟ้อง/คำร้อง/คำให้การ)",
                Category = "ทั้งสองประเภท",
                ApplicableRole = "ทุกฝ่าย",
                ProceduralLawRef = "สารบัญแบบพิมพ์ศาล (แบบ ๔๐ ก.)",
                LayoutType = "Continuation40A",
                DefaultHeaderTitle = "ใบต่อคำคู่ความ (๔๐ ก.)",
                DefaultPreambleTemplate = "",
                DefaultClausesJson = "[]",
                DefaultClosingText = "ควรมิควรแล้วแต่จะโปรด",
                SourceWordFileName = "40ก.doc",
                Description = "แบบพิมพ์ศาล (๔๐ ก.) กระดาษต่อบรรทัดเส้นประมาตรฐานศาล สำหรับเนื้อหาคำฟ้อง คำให้การ คำร้อง หรืออุทธรณ์/ฎีกา ที่มีหลายหน้า"
            }
        };
    }

    private async Task SeedExampleCasesAndDocumentsAsync(SqlConnection conn)
    {
        var sigPiyanat = await conn.ExecuteScalarAsync<string>("SELECT SignatureDataUrl FROM SL_LawyerProfiles WHERE Id = 1") ?? "";
        var sigKriangkrai = await conn.ExecuteScalarAsync<string>("SELECT SignatureDataUrl FROM SL_LawyerProfiles WHERE Id = 2") ?? "";
        var sigChannarong = await conn.ExecuteScalarAsync<string>("SELECT SignatureDataUrl FROM SL_LawyerProfiles WHERE Id = 3") ?? "";
        var sigAkaradej = await conn.ExecuteScalarAsync<string>("SELECT ImageDataUrl FROM SL_ElectronicSignatures WHERE Id = 4") ?? sigKriangkrai;
        var sigPailin = await conn.ExecuteScalarAsync<string>("SELECT ImageDataUrl FROM SL_ElectronicSignatures WHERE Id = 5") ?? sigPiyanat;

        // CASE 1: คดีอาญา อ 398/2568 (ทนายจำเลยที่ 2 - คดีพี่โลห์)
        var case1Id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO SL_LawCases (CaseCode, BlackCaseNo, BlackCaseYear, RedCaseNo, RedCaseYear, CourtName, CaseCategory, SubCategory, LawyerRole, RepresentingPartyOrder, PlaintiffName, DefendantName, ChargeOrCauseOfAction, ClaimAmount, InterestRate, CurrentProceduralStage, Status, NextHearingDate, NextHearingNote, PrimaryLawyerId, ClerkId, CaseSummary)
            OUTPUT INSERTED.Id
            VALUES (
                N'CRIM-398-2568', N'อ ๓๙๘', N'๖๘', N'', N'', N'จังหวัดศรีสะเกษ',
                N'อาญา', N'อาญาสามัญ (ฉ้อโกงประชาชน)', N'ทนายจำเลย', N'จำเลยที่ ๒',
                N'พนักงานอัยการจังหวัดศรีสะเกษ', N'นายสามัคคี เดชกล้า ที่ ๑ กับพวกรวม ๒๐ คน',
                N'ร่วมกันฉ้อโกงประชาชน และร่วมกันกู้ยืมเงินที่เป็นการฉ้อโกงประชาชน (ป.อ. ม.๓๔๑, ๓๔๓ ประกอบ ม.๘๓ และ พ.ร.ก.การกู้ยืมเงินที่เป็นการฉ้อโกงประชาชน พ.ศ.๒๕๒๗)',
                0, 0, N'ชั้นสืบพยานจำเลยและยื่นคำแถลงปิดคดี (ป.วิ.อ. ม.๑๗๒, ม.๒๒๗)', N'นัดสืบพยาน / แถลงปิดคดี',
                '2026-11-18T09:00:00', N'นัดสืบพยานจำเลยที่ ๒ และยื่นคำแถลงปิดคดี', 2, 3,
                N'คดีอาญาหมายเลขดำที่ อ ๓๙๘/๒๕๖๘ ศาลจังหวัดศรีสะเกษ เราทำหน้าที่ทนายจำเลยที่ ๒ (นายแพทย์อัครเดช บุญเย็น) ต่อสู้คดีว่าจำเลยที่ ๒ เป็นเพียงผู้ให้คำปรึกษาด้านการแพทย์และสมาชิกโดยสุจริต มิได้รู้เห็นหรือมีส่วนร่วมในการบริหารการเงินหรือหลอกลวงประชาชน และได้แจ้งความลงบันทึกประจำวันลาออกไว้ตั้งแต่ ١๕ ก.พ. ๒๕๖๕ ขอให้ศาลยกประโยชน์แห่งความสงสัยตาม ป.วิ.อ. มาตรา ๒๒๗'
            );
        ");

        await conn.ExecuteAsync(@"
            INSERT INTO SL_CaseParties (CaseId, PartySide, PartyOrder, Title, FullName, CitizenId, Race, Nationality, Occupation, Age, BirthDateText, HouseNo, Moo, Road, Soi, NearBy, SubDistrict, District, Province, PostalCode, Phone, IsOurClient)
            VALUES
            (@CaseId, N'โจทก์', 1, N'', N'พนักงานอัยการจังหวัดศรีสะเกษ', N'-', N'ไทย', N'ไทย', N'พนักงานอัยการ', N'-', N'-', N'-', N'-', N'เทพา', N'-', N'ศาลจังหวัดศรีสะเกษ', N'เมืองเหนือ', N'เมืองศรีสะเกษ', N'ศรีสะเกษ', N'33000', N'-', 0),
            (@CaseId, N'จำเลย', 1, N'นาย', N'นายสามัคคี เดชกล้า ที่ ๑ กับพวกรวม ๒๐ คน', N'-', N'ไทย', N'ไทย', N'กรรมการสมาคมฯ', N'-', N'-', N'-', N'-', N'-', N'-', N'-', N'-', N'เมืองศรีสะเกษ', N'ศรีสะเกษ', N'33000', N'-', 0),
            (@CaseId, N'จำเลย', 2, N'นายแพทย์', N'นายแพทย์อัครเดช บุญเย็น', N'3-3306-00124-88-2', N'ไทย', N'ไทย', N'รับราชการแพทย์ (ผอ.รพ.ปรางค์กู่)', N'๖๐', N'-', N'๒๕๖', N'๑๕', N'-', N'-', N'-', N'สำโรง', N'อุทุมพรพิสัย', N'ศรีสะเกษ', N'33120', N'081-2667109', 1);
        ", new { CaseId = case1Id });

        // CASE 2: คดีแพ่ง ไพลิน อาจสามารถ ฟ้อง นายมงคล อุทัย (ทนายโจทก์)
        var case2Id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO SL_LawCases (CaseCode, BlackCaseNo, BlackCaseYear, RedCaseNo, RedCaseYear, CourtName, CaseCategory, SubCategory, LawyerRole, RepresentingPartyOrder, PlaintiffName, DefendantName, ChargeOrCauseOfAction, ClaimAmount, InterestRate, CurrentProceduralStage, Status, NextHearingDate, NextHearingNote, PrimaryLawyerId, ClerkId, CaseSummary)
            OUTPUT INSERTED.Id
            VALUES (
                N'CIV-158-2567', N'ม ๑๐๘', N'๖๗', N'', N'', N'จังหวัดศรีสะเกษ',
                N'แพ่ง', N'แพ่งมโนสาเร่ / ผิดสัญญากู้ยืมเงิน', N'ทนายโจทก์', N'โจทก์',
                N'นางไพลิน อาจสามารถ', N'นายมงคล อุทัย',
                N'ผิดสัญญากู้ยืมเงิน',
                158125.00, 5.00, N'ชั้นยื่นคำฟ้อง ขอปิดหมาย และนัดไกล่เกลี่ย/สืบพยาน (ป.วิ.พ. ม.๑๗๒, ม.๗๙, ม.๑๙๓)', N'กำลังดำเนินการ',
                '2026-11-24T09:00:00', N'นัดไกล่เกลี่ย ให้การ และสืบพยานโจทก์-จำเลย', 1, 3,
                N'คดีแพ่งกู้ยืมเงิน เราทำหน้าที่ทนายโจทก์ (นางไพลิน อาจสามารถ) ฟ้องบังคับจำเลย (นายมงคล อุทัย) ชำระเงินต้น ๑๕๐,๐๐๐ บาท พร้อมดอกเบี้ยผิดนัดร้อยละ ๕ ต่อปี นับแต่วันที่ ๑๒ ม.ค. ๒๕๖๖ ถึงวันฟ้อง (๑๓ เดือน) เป็นดอกเบี้ย ๘,๑๒๕ บาท รวมทุนทรัพย์ ๑๕๘,๑๒๕ บาท โดยมี น.ส.๓ ก. เลขที่ ๙๔/๙๓ ต.ศรีสำราญ อ.วังหิน จ.ศรีสะเกษ เป็นหลักประกัน'
            );
        ");

        await conn.ExecuteAsync(@"
            INSERT INTO SL_CaseParties (CaseId, PartySide, PartyOrder, Title, FullName, CitizenId, Race, Nationality, Occupation, Age, BirthDateText, HouseNo, Moo, Road, Soi, NearBy, SubDistrict, District, Province, PostalCode, Phone, IsOurClient)
            VALUES
            (@CaseId, N'โจทก์', 1, N'นาง', N'นางไพลิน อาจสามารถ', N'3-3301-00521-44-9', N'ไทย', N'ไทย', N'ค้าขาย/เกษตรกรรม', N'๔๒', N'-', N'๑๑๒', N'๔', N'-', N'-', N'-', N'ศรีสำราญ', N'วังหิน', N'ศรีสะเกษ', N'33270', N'084-1856483', 1),
            (@CaseId, N'จำเลย', 1, N'นาย', N'นายมงคล อุทัย', N'3-3309-00219-73-1', N'ไทย', N'ไทย', N'รับจ้าง', N'๔๕', N'-', N'๘๙', N'๒', N'-', N'-', N'-', N'ศรีสำราญ', N'วังหิน', N'ศรีสะเกษ', N'33270', N'-', 0);
        ", new { CaseId = case2Id });

        // Seed Documents for Case 1 (อ 398/2568 - ทนายจำเลยที่ 2)
        // Doc 1: คำร้องขอยื่นคำให้การ(เพิ่มเติม) และบัญชีระบุพยานจำเลยที่ ๒ (เพิ่มเติม) - แบบ (๗)
        var doc1Clauses = new List<ClauseItem>
        {
            new() { ClauseTitle = "ข้อ ๑.", Content = "คดีนี้ ศาลได้โปรดกำหนดนัดสืบพยานจำเลย ในวันที่ ๑๘ กุมภาพันธ์ ๒๕๖๙ ที่จะถึงนี้ เดิมจำเลยที่ ๒ ได้ยื่นคำให้การต่อสู้คดีไว้แล้ว โดยให้การปฏิเสธฟ้องโจทก์ตลอดข้อกล่าวหา แต่เนื่องจากในขณะที่ยื่นคำให้การฉบับเดิมนั้น จำเลยที่ ๒ ยังรวบรวมพยานหลักฐานไม่ครบถ้วน และเกิดความคลาดเคลื่อนในการสื่อสารข้อเท็จจริงกับทนายความคนเดิม ทำให้คำให้การที่ยื่นไว้เดิมเป็นเพียงการปฏิเสธข้อกล่าวหาโดยรวม ยังมิได้ระบุรายละเอียดแห่งข้อต่อสู้และพยานหลักฐานสำคัญให้ชัดเจนเพียงพอ" },
            new() { ClauseTitle = "ข้อ ๒.", Content = "บัดนี้ จำเลยที่ ๒ ได้แต่งตั้งทนายความคนใหม่ เข้ามาทำหน้าที่ และได้ตรวจพบพยานหลักฐานสำคัญที่แสดงถึงความบริสุทธิ์ของจำเลยที่ ๒ เพิ่มเติมหลายประการ อาทิเช่น หลักฐานการแจ้งความลงบันทึกประจำวันเพื่อลาออก, หลักฐานการเป็นสมาชิกมาตั้งแต่ปี ๒๕๕๕, และหลักฐานการได้รับเงินสงเคราะห์ศพบิดาโดยสุจริตในปี ๒๕๖๒ ซึ่งเป็นสาระสำคัญแห่งคดีที่จะพิสูจน์ได้ว่าจำเลยที่ ๒ มิได้มีเจตนาทุจริตและมิได้เป็นตัวการร่วมในการกระทำความผิด" },
            new() { ClauseTitle = "ข้อ ๓.", Content = "เพื่อให้การต่อสู้คดีของจำเลยที่ ๒ เป็นไปโดยถูกต้องครบถ้วนและเพื่อประโยชน์ในการพิจารณาพิพากษาคดี จำเลยที่ ๒ จึงกราบเรียนขอประทานอนุญาตต่อศาล ขอส่ง \"คำให้การจำเลย (เพิ่มเติม)\" ฉบับลงวันที่วันนี้ และขอส่ง \"บัญชีระบุพยานจำเลย (เพิ่มเติม)\" ฉบับลงวันที่วันนี้ เข้าสู่สำนวนความ เพื่อใช้อ้างอิงและนำสืบหักล้างพยานโจทก์ในวันนัดสืบพยานจำเลย (๑๘ กุมภาพันธ์ ๒๕๖๙) ที่จะถึงนี้ ทั้งนี้ การยื่นคำร้องนี้มิได้มีเจตนาประวิงคดีแต่อย่างใด แต่เป็นไปเพื่อรักษาสิทธิในการต่อสู้คดีของจำเลยในคดีอาญาที่มีอัตราโทษสูง เพื่อให้ศาลได้รับฟังข้อเท็จจริงอย่างรอบด้านที่สุด\nอนึ่ง จำเลยที่ ๒ โดยทนายจำเลยที่ ๒ ได้แนบคำให้การเพิ่มเติมและบัญชีระบุพยานเพิ่มเติมมาพร้อมกับคำร้องฉบับนี้แล้ว\nขอศาลได้โปรดอนุญาต" }
        };

        await InsertDocumentAsync(conn, new CaseDocument
        {
            CaseId = case1Id,
            TemplateId = 3,
            FormCode = "(๗)",
            DocumentTitle = "คำร้อง ขอยื่นคำให้การ(เพิ่มเติม) และบัญชีระบุพยานจำเลยที่ ๒ (เพิ่มเติม)",
            LawyerRoleInDoc = "ทนายจำเลยที่ ๒",
            DocDay = "๓๐",
            DocMonth = "มกราคม",
            DocYear = "๖๙",
            RequesterFullName = "นายเกรียงไกร โล่ห์ทวนชัย",
            RequesterStatus = "ทนายจำเลยที่ ๒",
            RequesterCitizenId = "3-3301-00412-55-1",
            RequesterRace = "ไทย",
            RequesterNationality = "ไทย",
            RequesterOccupation = "ทนายความ",
            RequesterAge = "๖๘",
            RequesterHouseNo = "๑๗๔/๕",
            RequesterMoo = "-",
            RequesterRoad = "ปลัดมณฑล",
            RequesterSoi = "-",
            RequesterNearBy = "-",
            RequesterSubDistrict = "เมืองเหนือ",
            RequesterDistrict = "เมืองฯ",
            RequesterProvince = "ศรีสะเกษ",
            RequesterPostalCode = "๓๓๐๐๐",
            RequesterPhone = "๐๙๓-๓๒๖๙๘๙๓",
            ClausesJson = JsonSerializer.Serialize(doc1Clauses),
            ClosingPrayer = "ควรมิควรแล้วแต่จะโปรด",
            SignerName = "นายเกรียงไกร โล่ห์ทวนชัย",
            SignerRole = "ทนายจำเลยที่ ๒",
            DrafterName = "นายเกรียงไกร โล่ห์ทวนชัย",
            TypistName = "นายชาญณรงค์ ผ่องแผ้ว",
            SignatureImageBase64 = sigKriangkrai,
            DrafterSignatureBase64 = sigKriangkrai,
            TypistSignatureBase64 = sigChannarong,
            Status = "ยื่นต่อศาลแล้ว"
        });

        // Doc 2: คำให้การจำเลย (เพิ่มเติม) - แบบ (๑๑ ก.)
        var doc2Clauses = new List<ClauseItem>
        {
            new() { ClauseTitle = "ข้อ ๑.", Content = "เดิมจำเลยที่ ๒ ได้ให้การปฏิเสธฟ้องโจทก์ไว้แล้วนั้น จำเลยที่ ๒ ขอยืนยันให้การปฏิเสธฟ้องโจทก์ตลอดข้อกล่าวหาเช่นเดิม และขอชี้แจงรายละเอียดแห่งข้อต่อสู้เพิ่มเติม เพื่อแสดงความบริสุทธิ์ใจ ดังนี้" },
            new() { ClauseTitle = "ข้อ ๒.", Content = "จากการสืบพยานโจทก์ที่ผ่านมาจำนวนกว่า ๒๘ ปาก ไม่มีผู้ใดระบุว่าถูกจำเลยที่ ๒ หลอกลวงหรือชักชวน จึงเป็นเพียงการกล่าวหาโดยอาศัยตำแหน่ง ไม่ใช่พฤติการณ์ตามฟ้องโจทก์ ซึ่งจำเลยที่ ๒ มิได้เป็นกรรมการผู้มีอำนาจลงนามผูกพันสมาคมฯ มิได้มีอำนาจอนุมัติการเงิน มิได้เป็นผู้มีหน้าที่บริหารงานใด ๆ เพียงแค่ได้รับเชิญมาเนื่องจากเป็นแพทย์ที่มีความน่าเชื่อถือ เพื่อให้คำปรึกษาด้านสวัสดิการสาธารณสุขเท่านั้น มิได้มีอำนาจบริหารจัดการเงินหรือสั่งการให้หลอกลวงประชาชนแต่อย่างใด" },
            new() { ClauseTitle = "ข้อ ๓.", Content = "จำเลยที่ ๒ มิได้เพิ่งเข้ามาร่วมกับสมาคมฯ เพื่อแสวงหาผลประโยชน์ แต่มีความผูกพันในฐานะสมาชิกผู้ศรัทธามาอย่างยาวนาน กล่าวคือ\n๓.๑ จำเลยที่ ๒ ได้สมัครเป็นสมาชิกสมาคมฯ มาตั้งแต่ ปี พ.ศ. ๒๕๕๕ (ก่อนเกิดเหตุฟ้องร้องนานกว่า ๙ ปี) โดยสมัครให้แก่ตนเองและบุคคลในครอบครัวด้วยความบริสุทธิ์ใจ ประกอบด้วย บิดา (ขณะสมัครอายุ ๖๙ ปี), มารดา (ขณะสมัครอายุ ๖๔ ปี) และตัวจำเลยที่ ๒ (ขณะสมัครอายุ ๔๖ ปี)\n๓.๒ ต่อมาเมื่อวันที่ ๒๙ มีนาคม ๒๕๖๒ บิดาของจำเลยที่ ๒ ได้ถึงแก่ความตาย สมาคมฯ ได้ดำเนินการจ่ายเงินสงเคราะห์ศพให้แก่ทายาทตามระเบียบอย่างถูกต้องครบถ้วน แสดงให้เห็นว่า ณ ช่วงเวลาดังกล่าว สมาคมฯ ยังมีสภาพคล่องและมีการประกอบกิจการจริง มิใช่การหลอกลวงประชาชนตั้งแต่ต้นตามฟ้อง\n๓.๓ ภายหลังจากบิดาเสียชีวิต จำเลยที่ ๒ ได้ให้บุตรสาวสมัครเข้าเป็นสมาชิกทดแทนบิดา โดยหักเงินจากยอดเงินสงเคราะห์ศพของบิดา ย่อมเป็นประจักษ์พยานชัดแจ้งว่า จำเลยที่ ๒ มีความเชื่อโดยสุจริตใจว่าสมาคมฯ มีความมั่นคง" },
            new() { ClauseTitle = "ข้อ ๔.", Content = "จำเลยที่ ๒ ในฐานะผู้อำนวยการโรงพยาบาลปรางค์กู่ ได้อนุเคราะห์ให้ใช้พื้นที่ของโรงพยาบาลปรางค์กู่ จัดตั้งเป็น \"ศูนย์ประสานงานสมาคมฯ ประจำอำเภอปรางค์กู่\" เพื่ออำนวยความสะดวกแก่สมาชิก โดยมีระบบการบริหารจัดการที่รัดกุม ต้องมีการลงลายมือชื่อร่วมกันของคณะกรรมการศูนย์ฯ จำนวน ๓ คน จึงจะสามารถเบิกถอนได้ และเงินถูกนำไปใช้เป็นค่าตอบแทนบำรุงโรงพยาบาล ค่าพวงหรีดเคารพศพ และเงินช่วยงานศพสมาชิกตามประเพณี" },
            new() { ClauseTitle = "ข้อ ๕.", Content = "จำเลยที่ ๒ ได้ยื่นหนังสือลาออกจากตำแหน่งรองนายกสมาคมฯ แต่ทางสมาคมฯ เพิกเฉย จำเลยที่ ๒ จึงได้ไปแจ้งความลงบันทึกประจำวันไว้เป็นหลักฐาน ณ สถานีตำรวจภูธรอุทุมพรพิสัย เมื่อวันที่ ๑๕ เดือน กุมภาพันธ์ พ.ศ. ๒๕๖๕ เพื่อยืนยันเจตนาที่แน่วแน่ในการลาออกและยุติความเกี่ยวข้องกับการบริหารงานของสมาคมฯ อย่างสิ้นเชิง โดยเมื่อพยานหลักฐานยังมีความสงสัยตามสมควร ศาลต้องยกประโยชน์แห่งความสงสัยให้จำเลย ตาม ป.วิ.อาญา ม. ๒๒๗\nด้วยเหตุผลตามข้อเท็จจริงและข้อกฎหมายดังกล่าว คดีนี้ไม่ปรากฏว่าจำเลยที่ ๒ ได้กระทำความผิด จำเลยที่ ๒ จึงเป็นผู้บริสุทธิ์ ขอศาลได้โปรดพิจารณาพิพากษายกฟ้องโจทก์ ปล่อยจำเลยที่ ๒ พ้นข้อหาไป" }
        };

        await InsertDocumentAsync(conn, new CaseDocument
        {
            CaseId = case1Id,
            TemplateId = 6,
            FormCode = "(๑๑ ก.)",
            DocumentTitle = "คำให้การจำเลย (เพิ่มเติม)",
            LawyerRoleInDoc = "ทนายจำเลยที่ ๒",
            DocDay = "๓๐",
            DocMonth = "มกราคม",
            DocYear = "๖๙",
            RequesterFullName = "นายแพทย์อัครเดช บุญเย็น จำเลยที่ ๒ โดยนายเกรียงไกร โล่ห์ทวนชัย",
            RequesterStatus = "ทนายจำเลยที่ ๒",
            RequesterCitizenId = "-",
            RequesterRace = "ไทย",
            RequesterNationality = "ไทย",
            RequesterOccupation = "ทนายความ",
            RequesterAge = "๖๘",
            RequesterHouseNo = "๑๗๔/๕",
            RequesterMoo = "-",
            RequesterRoad = "ปลัดมณฑล",
            RequesterSoi = "-",
            RequesterNearBy = "-",
            RequesterSubDistrict = "เมืองเหนือ",
            RequesterDistrict = "เมืองฯ",
            RequesterProvince = "ศรีสะเกษ",
            RequesterPostalCode = "๓๓๐๐๐",
            RequesterPhone = "๐๙๓-๓๒๖๙๘๓๙",
            ClausesJson = JsonSerializer.Serialize(doc2Clauses),
            ClosingPrayer = "ควรมิควรแล้วแต่จะโปรด",
            SignerName = "นายเกรียงไกร โล่ห์ทวนชัย",
            SignerRole = "ทนายจำเลย",
            DrafterName = "นายเกรียงไกร โล่ห์ทวนชัย",
            TypistName = "นายชาญณรงค์ ผ่องแผ้ว",
            SignatureImageBase64 = sigKriangkrai,
            DrafterSignatureBase64 = sigKriangkrai,
            TypistSignatureBase64 = sigChannarong,
            Status = "ยื่นต่อศาลแล้ว"
        });

        // Doc 3: บัญชีพยานจำเลยที่ ๒ (เพิ่มเติม) - แบบ (๑๕)
        var doc3Witnesses = new List<WitnessItem>
        {
            new() { OrderNo = 1, WitnessNameAndDesc = "จำเลยที่ ๒ อ้างตนเองเป็นพยาน (นายแพทย์อัครเดช บุญเย็น)", AddressText = "๒๕๖ หมู่ ๑๕ ต.สำโรง อ.อุทุมพรพิสัย จ.ศรีสะเกษ", Note = "นำ" },
            new() { OrderNo = 2, WitnessNameAndDesc = "สำเนารายงานประจำวันเกี่ยวกับคดี กรณีการยื่นหนังสือลาออก (บันทึกประจำวัน สภ.อุทุมพรพิสัย)", AddressText = "-", Note = "นำ" },
            new() { OrderNo = 3, WitnessNameAndDesc = "สำเนาหนังสือลาออกจากตำแหน่งกรรมการสมาคมฯ", AddressText = "-", Note = "นำ" },
            new() { OrderNo = 4, WitnessNameAndDesc = "สำเนาใบมรณบัตร บิดาจำเลยที่ ๒", AddressText = "-", Note = "นำ" },
            new() { OrderNo = 5, WitnessNameAndDesc = "ภาพถ่ายการได้รับเช็คเงินสงเคราะห์ศพบิดา จากทางสมาคมฯ", AddressText = "-", Note = "นำ" },
            new() { OrderNo = 6, WitnessNameAndDesc = "ใบสมัครสมาชิกสมาคมบิดาจำเลยที่ ๒", AddressText = "-", Note = "นำ" },
            new() { OrderNo = 7, WitnessNameAndDesc = "เอกสาร ขอคืน/ยกเลิกศูนย์ประสานงานสมาคมฯ รพ.ปรางค์กู่", AddressText = "-", Note = "นำ" },
            new() { OrderNo = 8, WitnessNameAndDesc = "เอกสารรับรองการเป็นสมาชิกของบุตรธิดา ในกรณีบิดาเสียชีวิตต้องมีสมาชิกมาแทน", AddressText = "-", Note = "นำ" },
            new() { OrderNo = 9, WitnessNameAndDesc = "น.ส.จิราวรรณ พรหมมานนท์ (ผู้มีอำนาจคนที่ ๒ ลงนามเบิกจ่ายเงินศูนย์ประสานงานสมาคมฯ รพ.ปรางค์กู่)", AddressText = "๑๓๔/๑๗๑ หมู่ที่ ๗ ต.โพธิ์ อ.เมือง จ.ศรีสะเกษ ๓๓๐๐๐", Note = "หมาย" },
            new() { OrderNo = 10, WitnessNameAndDesc = "นายชำนาญ สุขวงศ์ (เจ้าหน้าที่ผู้ดูแลศูนย์ประสานงานสมาคมฯ รพ.ปรางค์กู่)", AddressText = "๘๒ หมู่ ๖ ต.ตาเกษ อ.อุทุมพรพิสัย จ.ศรีสะเกษ ๓๓๑๒๐", Note = "หมาย" }
        };

        await InsertDocumentAsync(conn, new CaseDocument
        {
            CaseId = case1Id,
            TemplateId = 9,
            FormCode = "(๑๕)",
            DocumentTitle = "บัญชีพยานจำเลยที่ ๒ (เพิ่มเติม)",
            LawyerRoleInDoc = "ทนายจำเลยที่ ๒",
            DocDay = "๓๐",
            DocMonth = "มกราคม",
            DocYear = "๖๙",
            RequesterFullName = "นายเกรียงไกร โล่ห์ทวนชัย",
            RequesterStatus = "ทนายจำเลยที่ ๒",
            ClausesJson = JsonSerializer.Serialize(doc3Witnesses),
            ExtraFieldsJson = JsonSerializer.Serialize(new { TotalWitnessCount = "๑๐" }),
            ClosingPrayer = "ผู้ระบุ",
            SignerName = "นายเกรียงไกร โล่ห์ทวนชัย",
            SignerRole = "ผู้ระบุ (ทนายจำเลยที่ ๒)",
            DrafterName = "นายเกรียงไกร โล่ห์ทวนชัย",
            TypistName = "นายชาญณรงค์ ผ่องแผ้ว",
            SignatureImageBase64 = sigKriangkrai,
            Status = "ยื่นต่อศาลแล้ว"
        });

        // Doc 4: คำแถลงปิดคดี (อ 398/2568) - แบบ (๗)
        var doc4Clauses = new List<ClauseItem>
        {
            new() { ClauseTitle = "ข้อ ๑.", Content = "คดีนี้ศาลอนุญาตให้จำเลยยื่นคำแถลงปิดคดีในวันที่ ๖ พฤศจิกายน ๒๕๖๙ คดีนี้โจทก์ฟ้องจำเลยที่ ๒ กับพวกในความผิดฐานร่วมกันฉ้อโกงประชาชน และร่วมกันกู้ยืมเงินที่เป็นการฉ้อโกงประชาชน ตามประมวลกฎหมายอาญา มาตรา ๓๔๑ มาตรา ๓๔๓ ประกอบมาตรา ๘๓ และพระราชกำหนดการกู้ยืมเงินที่เป็นการฉ้อโกงประชาชน พ.ศ. ๒๕๒๗ จำเลยที่ ๒ ให้การปฏิเสธข้อกล่าวหาและต่อสู้คดีมาโดยตลอด บัดนี้ การสืบพยานเสร็จสิ้นแล้ว จำเลยที่ ๒ จึงขอแถลงปิดคดีเป็นหนังสือ เพื่อประกอบการพิจารณาชั่งน้ำหนักพยานหลักฐานแห่งคดี" },
            new() { ClauseTitle = "ข้อ ๒.", Content = "จากการตรวจสอบคำเบิกความพยานโจทก์ทั้ง ๖ ปากตามที่ได้สืบต่อศาล ปรากฏว่าพยานโจทก์ไม่มีปากใดรู้จักจำเลยที่ ๒ มาก่อน และไม่มีพยานปากใดเบิกความยืนยันว่าจำเลยที่ ๒ ได้ติดต่อ ชักชวน หลอกลวง รับเงิน สั่งการ หรือร่วมดำเนินการใดอันเป็นพฤติการณ์แห่งความผิดตามฟ้อง คำเบิกความของพยานโจทก์จึงเจือสมกับข้อต่อสู้ของจำเลยที่ ๒ อย่างสิ้นเชิง" },
            new() { ClauseTitle = "ข้อ ๓.", Content = "จำเลยที่ ๒ มิได้ปฏิเสธว่าเคยมีชื่อดำรงตำแหน่งรองประธานสมาคม หากแต่การได้รับแต่งตั้งดังกล่าวเป็นการให้ดำรงตำแหน่งเพื่อเป็นองค์ประกอบของคณะกรรมการสมาคม มิได้เป็นการมอบหมายให้จำเลยที่ ๒ เป็นผู้บริหารจัดการกิจการประจำวันหรือควบคุมการดำเนินงานด้านการเงิน จำเลยที่ ๒ ประกอบวิชาชีพแพทย์ และบทบาทที่เกี่ยวข้องเป็นไปในลักษณะการให้คำปรึกษาเกี่ยวกับการแพทย์ โรคภัยไข้เจ็บ และปัญหาสุขภาพ" },
            new() { ClauseTitle = "ข้อ ๖.", Content = "ประมวลกฎหมายอาญา มาตรา ๘๓ บัญญัติถึงความรับผิดของบุคคลที่ร่วมกระทำความผิดด้วยกัน คำพิพากษาศาลฎีกาที่ ๑๒๘๘/๒๕๖๔ และ ๔๔๒๓/๒๕๖๔ วางหลักว่า การเป็นตัวการร่วมต้องพิจารณาทั้งการกระทำและเจตนาของผู้ร่วมกระทำ โดยผู้ร่วมกระทำต้องรู้ถึงการกระทำของกันและกันและมีเจตนาร่วมกันในการกระทำความผิด สำหรับคดีนี้ พยานหลักฐานโจทก์มิได้แสดงว่าจำเลยที่ ๒ ได้ร่วมวางแผน ร่วมแบ่งหน้าที่ ร่วมสั่งการ หรือร่วมดำเนินการอันเป็นความผิด" },
            new() { ClauseTitle = "ข้อ ๑๑.", Content = "ประมวลกฎหมายวิธีพิจารณาความอาญา มาตรา ๒๒๗ วางหลักให้ศาลใช้ดุลพินิจวินิจฉัยชั่งน้ำหนักพยานหลักฐานทั้งปวง และห้ามพิพากษาลงโทษจำเลยจนกว่าจะแน่ใจว่ามีการกระทำความผิดจริงและจำเลยเป็นผู้กระทำความผิดนั้น เมื่อมีความสงสัยตามสมควรว่าจำเลยได้กระทำความผิดหรือไม่ ให้ยกประโยชน์แห่งความสงสัยนั้นให้จำเลย" },
            new() { ClauseTitle = "ข้อ ๑๒.", Content = "ด้วยเหตุผลดังกล่าว จำเลยที่ ๒ จึงขอประทานกราบเรียนต่อศาลที่เคารพว่า พยานหลักฐานของโจทก์ยังไม่มีน้ำหนักเพียงพอที่จะพิสูจน์ความผิดของจำเลยที่ ๒ ให้สิ้นสงสัยตามหลักการพิจารณาคดีอาญา จำเลยที่ ๒ จึงขอศาลได้โปรดพิเคราะห์ข้อเท็จจริง ข้อกฎหมาย และพยานหลักฐานทั้งปวงแห่งคดี แล้วมีคำพิพากษายกฟ้องโจทก์เฉพาะในส่วนของจำเลยที่ ๒ ทุกข้อหา เพื่อประโยชน์แห่งความยุติธรรมสืบไป" }
        };

        await InsertDocumentAsync(conn, new CaseDocument
        {
            CaseId = case1Id,
            TemplateId = 3,
            FormCode = "(๗)",
            DocumentTitle = "คำร้อง คำแถลงปิดคดี",
            LawyerRoleInDoc = "จำเลยที่ ๒ / ทนายจำเลยที่ ๒",
            DocDay = "๕",
            DocMonth = "พฤศจิกายน",
            DocYear = "๖๙",
            RequesterFullName = "นายแพทย์อัครเดช บุญเย็น",
            RequesterStatus = "จำเลยที่ ๒",
            RequesterCitizenId = "3-3306-00124-88-2",
            RequesterRace = "ไทย",
            RequesterNationality = "ไทย",
            RequesterOccupation = "รับราชการแพทย์",
            RequesterAge = "๖๐",
            RequesterHouseNo = "๒๕๖",
            RequesterMoo = "๑๕",
            RequesterRoad = "-",
            RequesterSoi = "-",
            RequesterNearBy = "-",
            RequesterSubDistrict = "สำโรง",
            RequesterDistrict = "อุทุมพรพิสัย",
            RequesterProvince = "ศรีสะเกษ",
            RequesterPostalCode = "๓๓๑๒๐",
            RequesterPhone = "๐๘๑-๒๖๖๗๑๐๙",
            ClausesJson = JsonSerializer.Serialize(doc4Clauses),
            ClosingPrayer = "ควรมิควรแล้วแต่จะโปรด",
            SignerName = "นายแพทย์อัครเดช บุญเย็น",
            SignerRole = "จำเลยที่ ๒",
            DrafterName = "นายแพทย์อัครเดช บุญเย็น",
            TypistName = "นายแพทย์อัครเดช บุญเย็น",
            SignatureImageBase64 = sigAkaradej,
            DrafterSignatureBase64 = sigAkaradej,
            TypistSignatureBase64 = sigAkaradej,
            Status = "ฉบับสมบูรณ์"
        });

        // Seed Documents for Case 2 (คดีแพ่ง ไพลิน อาจสามารถ - ทนายโจทก์)
        // Doc 5: คำฟ้อง (สั้น) - แบบ (๔)
        var doc5Clauses = new List<ClauseItem>
        {
            new() { ClauseTitle = "ข้อ ๑.", Content = "เมื่อวันที่ ๑๑ พฤศจิกายน ๒๕๖๕ จำเลยได้กู้ยืมเงินโจทก์จำนวน ๑๕๐,๐๐๐ บาท และได้รับเงินไปครบถ้วนแล้ว โดยสัญญาว่าจะชำระเงินคืนให้โจทก์ภายในวันที่ ๑๒ มกราคม ๒๕๖๖ ในการกู้ยืมเงินดังกล่าวจำเลยได้มอบหนังสือรับรองการทำประโยชน์ (น.ส. ๓ ก.) เลขที่ ๙๔/๙๓ ต.ศรีสำราญ อ.วังหิน จ.ศรีสะเกษ ซึ่งเป็นที่ดินของจำเลยให้โจทก์ยึดถือไว้เป็นหลักประกันในการกู้ยืมเงิน ปรากฏตามสำเนาสัญญากู้ยืมเอกสารท้ายคำฟ้อง" },
            new() { ClauseTitle = "ข้อ ๒.", Content = "ทั้งเมื่อครบกำหนดที่จำเลยจะต้องชำระเงินคืนให้โจทก์ จำเลยไม่ชำระคืน โจทก์ได้ทวงถามจำเลยหลายครั้งแต่จำเลยผลัดผ่อนตลอดมา โจทก์ไม่สามารถบังคับจำเลยได้เองจึงต้องมาขอพึ่งบารมีศาลเพื่อบังคับจำเลยต่อไป" },
            new() { ClauseTitle = "ข้อ ๓.", Content = "การที่จำเลยไม่ชำระหนี้ตามกำหนดเวลา จำเลยจึงตกเป็นผู้ผิดนัดต้องรับผิดในดอกเบี้ยตามกฎหมายให้โจทก์ร้อยละ ๕ ต่อปี นับจากวันผิดนัดคือตั้งแต่วันที่ ๑๒ มกราคม ๒๕๖๖ ถึงวันฟ้อง เป็นเวลา ๑๓ เดือน เป็นเงินดอกเบี้ย ๘,๑๒๕ บาท รวมเป็นเงินที่จำเลยจะต้องชำระให้โจทก์เป็นเงิน ๑๕๘,๑๒๕ บาท" }
        };

        await InsertDocumentAsync(conn, new CaseDocument
        {
            CaseId = case2Id,
            TemplateId = 1,
            FormCode = "(๔)",
            DocumentTitle = "คำฟ้อง",
            LawyerRoleInDoc = "ทนายโจทก์",
            DocDay = "๑๙",
            DocMonth = "มกราคม",
            DocYear = "๖๗",
            RequesterFullName = "นางไพลิน อาจสามารถ",
            RequesterStatus = "โจทก์",
            RequesterCitizenId = "3-3301-00521-44-9",
            RequesterRace = "ไทย",
            RequesterNationality = "ไทย",
            RequesterOccupation = "ค้าขาย",
            RequesterAge = "๔๒",
            RequesterHouseNo = "๑๑๒",
            RequesterMoo = "๔",
            RequesterRoad = "-",
            RequesterSoi = "-",
            RequesterNearBy = "-",
            RequesterSubDistrict = "ศรีสำราญ",
            RequesterDistrict = "วังหิน",
            RequesterProvince = "ศรีสะเกษ",
            RequesterPostalCode = "๓๓๒๗๐",
            RequesterPhone = "๐๘๔-๑๘๕๖๔๘๓",
            ClausesJson = JsonSerializer.Serialize(doc5Clauses),
            ExtraFieldsJson = JsonSerializer.Serialize(new
            {
                Charge = "กู้ยืม",
                ClaimAmountBaht = "๑๕๘,๑๒๕",
                ClaimAmountSatang = "-",
                DefName = "นายมงคล อุทัย",
                DefHouseNo = "๘๙",
                DefMoo = "๒",
                DefSubDistrict = "ศรีสำราญ",
                DefDistrict = "วังหิน",
                DefProvince = "ศรีสะเกษ"
            }),
            ClosingPrayer = "ควรมิควรแล้วแต่จะโปรด",
            SignerName = "นางไพลิน อาจสามารถ",
            SignerRole = "โจทก์",
            DrafterName = "นายปิยะณัฐ วัชราภรณ์",
            TypistName = "นายชาญณรงค์ ผ่องแผ้ว",
            SignatureImageBase64 = sigPailin,
            DrafterSignatureBase64 = sigPiyanat,
            TypistSignatureBase64 = sigChannarong,
            Status = "ยื่นต่อศาลแล้ว"
        });

        // Doc 6: คำขอท้ายคำฟ้องแพ่ง - แบบ (๕)
        var doc6Clauses = new List<ClauseItem>
        {
            new() { ClauseTitle = "๑.", Content = "ให้จำเลยชำระเงินจำนวน ๑๕๘,๑๒๕ บาท ให้โจทก์" },
            new() { ClauseTitle = "๒.", Content = "ให้จำเลยชำระดอกเบี้ยในอัตราร้อยละ ๕ ต่อปี ของเงินต้น ๑๕๐,๐๐๐ บาท นับจากวันฟ้องจนกว่าจะชำระเสร็จแก่โจทก์" },
            new() { ClauseTitle = "๓.", Content = "ให้จำเลยใช้ค่าฤชาธรรมเนียมและค่าทนายความ รวมทั้งค่าใช้จ่ายในการดำเนินคดีแทนโจทก์" }
        };

        await InsertDocumentAsync(conn, new CaseDocument
        {
            CaseId = case2Id,
            TemplateId = 2,
            FormCode = "(๕)",
            DocumentTitle = "คำขอท้ายคำฟ้องแพ่ง",
            LawyerRoleInDoc = "ทนายโจทก์",
            DocDay = "๑๙",
            DocMonth = "มกราคม",
            DocYear = "๖๗",
            RequesterFullName = "นางไพลิน อาจสามารถ",
            RequesterStatus = "โจทก์",
            ClausesJson = JsonSerializer.Serialize(doc6Clauses),
            ExtraFieldsJson = JsonSerializer.Serialize(new
            {
                CopiesCount = "๑",
                DrafterLicenseNo = "๗๘๓๔/๒๕๒๙",
                DrafterCitizenId = "๓-๗๓๐๑-๐๐๙๑๕-๐๖-๘",
                DrafterHouseNo = "๙๐/๓",
                DrafterSubDistrict = "เมืองเหนือ",
                DrafterDistrict = "เมือง",
                DrafterProvince = "ศรีสะเกษ",
                DrafterPostalCode = "๓๓๐๐๐",
                DrafterPhone = "๐๘๙-๒๘๐๒๔๕๐",
                TypistHouseNo = "๒๖๐/๑๗",
                TypistMoo = "๕",
                TypistSubDistrict = "หนองครก",
                TypistDistrict = "เมือง",
                TypistProvince = "ศรีสะเกษ",
                TypistPostalCode = "๓๓๐๐๐",
                TypistPhone = "๐๘๘-๗๗๗๖-๗๗๕"
            }),
            ClosingPrayer = "ควรมิควรแล้วแต่จะโปรด",
            SignerName = "นางไพลิน อาจสามารถ",
            SignerRole = "โจทก์",
            DrafterName = "นายปิยะณัฐ วัชราภรณ์",
            TypistName = "นายชาญณรงค์ ผ่องแผ้ว",
            SignatureImageBase64 = sigPailin,
            DrafterSignatureBase64 = sigPiyanat,
            TypistSignatureBase64 = sigChannarong,
            Status = "ยื่นต่อศาลแล้ว"
        });

        // Doc 7: คำร้อง ขอปิดหมาย - แบบ (๗)
        var doc7Clauses = new List<ClauseItem>
        {
            new() { ClauseTitle = "ข้อ ๑.", Content = "คดีนี้จำเลยมีที่อยู่ตามคำฟ้องซึ่งโจทก์ได้เสนอหลักฐานที่อยู่ของจำเลยโดยนายทะเบียนรับรองแสดงต่อศาลท้ายคำร้องนี้แล้ว ในการส่งหมายเรียกและสำเนาคำฟ้องให้จำเลยหากไม่สามารถส่งด้วยวิธีธรรมดาได้ ขอศาลได้โปรดอนุญาตให้ปิดหมายเรียกและสำเนาคำฟ้องไว้ ณ ภูมิลำเนาของจำเลยด้วย\nขอศาลได้โปรดอนุญาต" }
        };

        await InsertDocumentAsync(conn, new CaseDocument
        {
            CaseId = case2Id,
            TemplateId = 3,
            FormCode = "(๗)",
            DocumentTitle = "คำร้อง ขอปิดหมาย",
            LawyerRoleInDoc = "ทนายโจทก์",
            DocDay = "๑๒",
            DocMonth = "กุมภาพันธ์",
            DocYear = "๖๗",
            RequesterFullName = "นายปิยะณัฐ วัชราภรณ์",
            RequesterStatus = "ทนายโจทก์",
            RequesterCitizenId = "๓-๗๓๐๑-๐๐๙๑๕-๐๖-๘",
            RequesterRace = "ไทย",
            RequesterNationality = "ไทย",
            RequesterOccupation = "ทนายความ",
            RequesterAge = "๗๔",
            RequesterHouseNo = "๙๐/๓",
            RequesterMoo = "-",
            RequesterRoad = "ปลัดมณฑล",
            RequesterSoi = "-",
            RequesterNearBy = "-",
            RequesterSubDistrict = "เมืองเหนือ",
            RequesterDistrict = "เมืองฯ",
            RequesterProvince = "ศรีสะเกษ",
            RequesterPostalCode = "๓๓๐๐๐",
            RequesterPhone = "๐๘๙-๒๘๐๒๔๕๐",
            ClausesJson = JsonSerializer.Serialize(doc7Clauses),
            ClosingPrayer = "ควรมิควรแล้วแต่จะโปรด",
            SignerName = "นายปิยะณัฐ วัชราภรณ์",
            SignerRole = "ทนายโจทก์",
            DrafterName = "นายปิยะณัฐ วัชราภรณ์",
            TypistName = "นายชาญณรงค์ ผ่องแผ้ว",
            SignatureImageBase64 = sigPiyanat,
            DrafterSignatureBase64 = sigPiyanat,
            TypistSignatureBase64 = sigChannarong,
            Status = "ยื่นต่อศาลแล้ว"
        });

        // Doc 8: ใบแต่งทนายความ - แบบ (๙)
        await InsertDocumentAsync(conn, new CaseDocument
        {
            CaseId = case2Id,
            TemplateId = 4,
            FormCode = "(๙)",
            DocumentTitle = "ใบแต่งทนายความ",
            LawyerRoleInDoc = "ทนายโจทก์",
            DocDay = "๑๙",
            DocMonth = "มกราคม",
            DocYear = "๖๗",
            RequesterFullName = "นางไพลิน อาจสามารถ",
            RequesterStatus = "โจทก์",
            RequesterCitizenId = "๓-๗๓๐๑-๐๐๙๑๕-๐๖-๘",
            RequesterRace = "ไทย",
            RequesterNationality = "ไทย",
            RequesterOccupation = "ทนายความ",
            RequesterAge = "๗๔",
            RequesterHouseNo = "๙๐/๓",
            RequesterMoo = "-",
            RequesterRoad = "ปลัดมณฑล",
            RequesterSoi = "-",
            RequesterNearBy = "-",
            RequesterSubDistrict = "เมืองเหนือ",
            RequesterDistrict = "เมืองฯ",
            RequesterProvince = "ศรีสะเกษ",
            RequesterPostalCode = "๓๓๐๐๐",
            RequesterPhone = "๐๘๙-๒๘๐๒๔๕๐",
            ClausesJson = JsonSerializer.Serialize(new List<ClauseItem>
            {
                new() { ClauseTitle = "อำนาจดำเนินกระบวนพิจารณา (ม.๖๒)", Content = "ดำเนินกระบวนพิจารณาใดๆ ไปในทางจำหน่ายสิทธิของข้าพเจ้าได้ด้วย เช่น การยอมรับตามที่คู่ความอีกฝ่ายหนึ่งเรียกร้อง การถอนฟ้อง การประนีประนอมยอมความ การสละสิทธิหรือใช้สิทธิในการอุทธรณ์หรือฎีกาหรือขอให้พิจารณาคดีใหม่" }
            }),
            ExtraFieldsJson = JsonSerializer.Serialize(new
            {
                AppointedLawyerName = "นายปิยะณัฐ วัชราภรณ์",
                LicenseNo = "7834/2529",
                Jurisdiction = "ทั่วราชอาณาจักร"
            }),
            ClosingPrayer = "เพื่อดำเนินกระบวนพิจารณาต่อไปตามหน้าที่ในกฎหมาย",
            SignerName = "นางไพลิน อาจสามารถ",
            SignerRole = "ผู้แต่งทนายความ (โจทก์)",
            DrafterName = "นายปิยะณัฐ วัชราภรณ์",
            TypistName = "นายชาญณรงค์ ผ่องแผ้ว",
            SignatureImageBase64 = sigPailin,
            DrafterSignatureBase64 = sigPiyanat,
            TypistSignatureBase64 = sigChannarong,
            Status = "ยื่นต่อศาลแล้ว"
        });

        // Doc 9: หมายเรียกคดีมโนสาเร่ - แบบ (๑๒)
        await InsertDocumentAsync(conn, new CaseDocument
        {
            CaseId = case2Id,
            TemplateId = 7,
            FormCode = "(๑๒)",
            DocumentTitle = "หมายเรียกคดีมโนสาเร่หรือคดีไม่มีข้อยุ่งยาก",
            LawyerRoleInDoc = "ทนายโจทก์",
            DocDay = "๑๒",
            DocMonth = "กุมภาพันธ์",
            DocYear = "๖๗",
            RequesterFullName = "นายมงคล อุทัย",
            RequesterStatus = "จำเลย",
            RequesterHouseNo = "๘๙",
            RequesterMoo = "๒",
            RequesterRoad = "-",
            RequesterSoi = "-",
            RequesterNearBy = "-",
            RequesterSubDistrict = "ศรีสำราญ",
            RequesterDistrict = "วังหิน",
            RequesterProvince = "ศรีสะเกษ",
            RequesterPostalCode = "๓๓๒๗๐",
            RequesterPhone = "-",
            ClausesJson = JsonSerializer.Serialize(new List<ClauseItem>
            {
                new() { ClauseTitle = "ข้อหาใจความว่า", Content = "ผิดสัญญากู้ยืมเงิน ตามสำเนาคำฟ้องซึ่งได้ส่งมาพร้อมกับหมายเรียกนี้" }
            }),
            ExtraFieldsJson = JsonSerializer.Serialize(new
            {
                ClaimAmountBaht = "๑๕๘,๑๒๕",
                ClaimAmountSatang = "-",
                HearingDay = "๑๒",
                HearingMonth = "กุมภาพันธ์",
                HearingYear = "๒๕๖๗",
                HearingTime = "๐๙.๐๐"
            }),
            ClosingPrayer = "ซึ่งเป็นวันสืบพยานด้วย",
            SignerName = "นายปิยะณัฐ วัชราภรณ์",
            SignerRole = "ทนายโจทก์",
            DrafterName = "นายปิยะณัฐ วัชราภรณ์",
            TypistName = "นายชาญณรงค์ ผ่องแผ้ว",
            SignatureImageBase64 = sigPiyanat,
            Status = "ยื่นต่อศาลแล้ว"
        });
    }

    public async Task<int> InsertDocumentAsync(SqlConnection conn, CaseDocument doc)
    {
        NormalizeDocumentThaiSpacing(doc);
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO SL_CaseDocuments (
                CaseId, TemplateId, FormCode, DocumentTitle, DocumentSubTitle, LawyerRoleInDoc,
                DocDay, DocMonth, DocYear, RequesterFullName, RequesterStatus, RequesterCitizenId,
                RequesterRace, RequesterNationality, RequesterOccupation, RequesterAge,
                RequesterHouseNo, RequesterMoo, RequesterRoad, RequesterSoi, RequesterNearBy,
                RequesterSubDistrict, RequesterDistrict, RequesterProvince, RequesterPostalCode, RequesterPhone,
                ClausesJson, ExtraFieldsJson, ClosingPrayer, SignerName, SignerRole, DrafterName, TypistName,
                SignatureImageBase64, DrafterSignatureBase64, TypistSignatureBase64, UseThaiNumerals, Status
            )
            OUTPUT INSERTED.Id
            VALUES (
                @CaseId, @TemplateId, @FormCode, @DocumentTitle, @DocumentSubTitle, @LawyerRoleInDoc,
                @DocDay, @DocMonth, @DocYear, @RequesterFullName, @RequesterStatus, @RequesterCitizenId,
                @RequesterRace, @RequesterNationality, @RequesterOccupation, @RequesterAge,
                @RequesterHouseNo, @RequesterMoo, @RequesterRoad, @RequesterSoi, @RequesterNearBy,
                @RequesterSubDistrict, @RequesterDistrict, @RequesterProvince, @RequesterPostalCode, @RequesterPhone,
                @ClausesJson, @ExtraFieldsJson, @ClosingPrayer, @SignerName, @SignerRole, @DrafterName, @TypistName,
                @SignatureImageBase64, @DrafterSignatureBase64, @TypistSignatureBase64, @UseThaiNumerals, @Status
            );
        ", doc);
    }

    private static string GenerateSvgSignatureDataUrl(string name, string colorHex)
    {
        var svg = $@"<svg xmlns='http://www.w3.org/2000/svg' width='280' height='80' viewBox='0 0 280 80'>
            <path d='M25,55 C55,20 75,65 105,35 C130,15 145,58 180,40 C205,28 235,48 260,32' fill='none' stroke='{colorHex}' stroke-width='2.4' stroke-linecap='round'/>
            <path d='M45,62 Q140,48 245,56' fill='none' stroke='{colorHex}' stroke-width='1.2' stroke-opacity='0.65' stroke-linecap='round'/>
            <text x='140' y='44' font-family='Sarabun, sans-serif' font-size='15' font-style='italic' font-weight='600' fill='{colorHex}' text-anchor='middle'>{name}</text>
        </svg>";
        var bytes = System.Text.Encoding.UTF8.GetBytes(svg);
        return "data:image/svg+xml;base64," + Convert.ToBase64String(bytes);
    }

    public static string GenerateSvgSlipPreviewDataUrl(string payerName, string planName, decimal amount, string dateStr, string refCode)
    {
        var svg = $@"<svg xmlns='http://www.w3.org/2000/svg' width='420' height='540' viewBox='0 0 420 540'>
            <rect width='420' height='540' rx='18' fill='#f8fafc' stroke='#cbd5e1' stroke-width='2'/>
            <rect x='0' y='0' width='420' height='92' rx='18' fill='#0f172a'/>
            <circle cx='50' cy='46' r='22' fill='#10b981'/>
            <path d='M40,46 L47,53 L61,38' fill='none' stroke='#ffffff' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/>
            <text x='85' y='42' font-family='Sarabun, sans-serif' font-size='18' font-weight='700' fill='#ffffff'>โอนเงินสำเร็จ (Payment Slip)</text>
            <text x='85' y='66' font-family='Sarabun, sans-serif' font-size='13' fill='#94a3b8'>{dateStr} | Ref: {refCode}</text>
            <line x1='28' y1='125' x2='392' y2='125' stroke='#e2e8f0' stroke-width='1.5' stroke-dasharray='5,5'/>
            <text x='32' y='162' font-family='Sarabun, sans-serif' font-size='14' fill='#64748b'>ผู้โอน (ทนายความสมาชิก)</text>
            <text x='32' y='188' font-family='Sarabun, sans-serif' font-size='17' font-weight='700' fill='#0f172a'>{payerName}</text>
            <text x='32' y='234' font-family='Sarabun, sans-serif' font-size='14' fill='#64748b'>ผู้รับโอน (ระบบบริหารจัดการคดี SmartLaws)</text>
            <text x='32' y='260' font-family='Sarabun, sans-serif' font-size='16' font-weight='700' fill='#1e3a8a'>บจก. สมาร์ทลอว์ โซลูชั่น (ธ.กรุงไทย 311-0-88999-1)</text>
            <text x='32' y='306' font-family='Sarabun, sans-serif' font-size='14' fill='#64748b'>รายการแพ็กเกจ / โควต้าคดี</text>
            <text x='32' y='332' font-family='Sarabun, sans-serif' font-size='16' font-weight='700' fill='#0f766e'>{planName}</text>
            <rect x='28' y='366' width='364' height='82' rx='12' fill='#eff6ff' stroke='#bfdbfe'/>
            <text x='46' y='398' font-family='Sarabun, sans-serif' font-size='14' fill='#1e40af'>จำนวนเงินที่โอนสุทธิ</text>
            <text x='372' y='426' font-family='Sarabun, sans-serif' font-size='26' font-weight='700' fill='#1d4ed8' text-anchor='end'>{amount:N2} บาท</text>
            <text x='210' y='495' font-family='Sarabun, sans-serif' font-size='12' fill='#64748b' text-anchor='middle'>หลักฐานการโอนเงินอิเล็กทรอนิกส์สำหรับตรวจสอบและอนุมัติโควต้าคดี</text>
        </svg>";
        var bytes = System.Text.Encoding.UTF8.GetBytes(svg);
        return "data:image/svg+xml;base64," + Convert.ToBase64String(bytes);
    }

    private async Task SeedMembershipAndFileDirectoryAsync(SqlConnection conn)
    {
        // 1. Seed Subscription & Quota Pricing Plans
        var planCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_SubscriptionPlans");
        if (planCount == 0)
        {
            const string bankInfo = "ธ.กรุงไทย สาขาศรีสะเกษ เลขที่ 311-0-88999-1 ชื่อบัญชี บจก.สมาร์ทลอว์ โซลูชั่น (พร้อมเพย์ 089-2802450)";
            await conn.ExecuteAsync(@"
                INSERT INTO SL_SubscriptionPlans (PlanCode, PlanName, PlanCategory, PriceBaht, CasesQuotaIncluded, DurationDays, Description, BankAccountInfo, IsActive)
                VALUES
                (N'TRIAL-3', N'ทดลองใช้งานฟรี (Free Trial ๓ คดี)', N'Trial', 0, 3, 30, N'สำหรับทนายความสมัครสมาชิกใหม่ ทดลองทำสำนวนคำฟ้อง/คำร้องตามแบบพิมพ์ศาลฟรี ๓ คดีแรก', @Bank, 1),
                (N'QUOTA-5', N'แพ็กเกจเพิ่มโควต้า +๕ คดี (Starter Quota)', N'QuotaPack', 290, 5, 3650, N'ซื้อโควต้าจำนวนคดีเพิ่ม ๕ สำนวนคดี ไม่จำกัดระยะเวลาวันหมดอายุ พิมพ์ฟอร์มศาลได้ครบทุกแบบ', @Bank, 1),
                (N'QUOTA-15', N'แพ็กเกจเพิ่มโควต้า +๑๕ คดี (Pro Quota)', N'QuotaPack', 690, 15, 3650, N'ซื้อโควต้าจำนวนคดีเพิ่ม ๑๕ สำนวนคดี พร้อมระบบคลังไฟล์สารบัญสำนวนและลายเซ็นอิเล็กทรอนิกส์', @Bank, 1),
                (N'MONTHLY-PRO', N'สมาชิกรายเดือน (Monthly Lawyer Plan)', N'Monthly', 490, 30, 30, N'ใช้งานรายเดือน ३๐ วัน ได้โควต้าเพิ่ม ३๐ คดี พร้อมระบบจัดเก็บไฟล์สำนวน PDF/รูปภาพครบวงจร', @Bank, 1),
                (N'YEARLY-VIP', N'สมาชิกรายปี (Yearly Law Firm VIP)', N'Yearly', 4900, 500, 365, N'ใช้งานรายปี ๓๖๕ วัน สำหรับสำนักงานทนายความ ได้โควต้า ๕๐๐ คดี ประหยัดคุ้มค่าที่สุด', @Bank, 1);
            ", new { Bank = bankInfo });
        }

        // 2. Seed Lawyer Accounts from Example Case Files + Clerk Sub-Account + Admin Account
        var userCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts");
        if (userCount == 0)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO SL_UserAccounts (Username, PasswordHash, FullName, Role, LawyerProfileId, LicenseNo, CitizenId, Phone, Email, OfficeName, PlanType, PlanName, MaxCasesQuota, UsedCasesCount, SubscriptionExpireDate, AccountStatus)
                VALUES
                (N'admin', N'admin123', N'ผู้ดูแลระบบสูงสุด (System Admin)', N'Admin', 0, N'ADMIN-001', N'1-1001-00001-01-1', N'02-999-8888', N'admin@smartlaws.co.th', N'ศูนย์บริหารระบบ SmartLaws', N'Yearly', N'ผู้ดูแลระบบสูงสุด (ไม่จำกัดโควต้า)', 9999, 2, DATEADD(day, 3650, SYSUTCDATETIME()), N'Active'),
                (N'piyanat', N'123456', N'นายปิยะณัฐ วัชราภรณ์', N'Lawyer', 1, N'7834/2529', N'3-7301-00915-06-8', N'089-2802450', N'piyanat.law@smartlaws.co.th', N'สำนักงานทนายความปิยะณัฐ วัชราภรณ์', N'Trial', N'ทดลองใช้งานฟรี (๓ คดี)', 3, 1, DATEADD(day, 30, SYSUTCDATETIME()), N'Active'),
                (N'kriangkrai', N'123456', N'นายเกรียงไกร โล่ห์ทวนชัย', N'Lawyer', 2, N'10492/2535', N'3-3301-00412-55-1', N'093-3269893', N'kriangkrai.law@smartlaws.co.th', N'สำนักงานกฎหมายเกรียงไกร โล่ห์ทวนชัย', N'Yearly', N'สมาชิกรายปี (Yearly Law Firm VIP)', 50, 1, DATEADD(day, 365, SYSUTCDATETIME()), N'Active'),
                (N'channarong', N'123456', N'นายชาญณรงค์ ผ่องแผ้ว', N'Clerk', 3, N'เสมียนทนาย', N'3-3301-00881-29-4', N'088-7776775', N'channarong.clerk@smartlaws.co.th', N'เสมียนทนายความสังกัดทนายความ', N'ClerkSubAccount', N'เสมียนทนาย (สังกัดทนายความ)', 0, 0, DATEADD(day, 3650, SYSUTCDATETIME()), N'Active');
            ");
        }
        else
        {
            // อัปเดตให้แอคเคาท์ของ นายชาญณรงค์ ผ่องแผ้ว เป็นบทบาท Clerk (เสมียนทนายภายใต้แอคเคาท์ทนายความ)
            await conn.ExecuteAsync(@"
                UPDATE SL_UserAccounts
                SET Role = N'Clerk',
                    LicenseNo = N'เสมียนทนาย',
                    PlanType = N'ClerkSubAccount',
                    PlanName = N'เสมียนทนาย (ทำงานภายใต้แอคเคาท์ทนายความ)'
                WHERE Username = N'channarong';
            ");
        }

        // 2.5 Seed Many-to-Many Lawyer <-> Clerk Mappings (เสมียน ๑ คน คือ นายชาญณรงค์ ผ่องแผ้ว ทำงานให้ทั้ง ทนายปิยะณัฐ และ ทนายเกรียงไกร)
        var mappingCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawyerClerkMappings");
        if (mappingCount == 0)
        {
            var piyanatUser = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Username = N'piyanat'");
            var kriangkraiUser = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Username = N'kriangkrai'");
            var channarongUser = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Username = N'channarong'");

            if (piyanatUser != null && channarongUser != null)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO SL_LawyerClerkMappings (LawyerUserId, LawyerFullName, ClerkUserId, ClerkProfileId, ClerkFullName, ClerkUsername, ClerkCitizenId, ClerkPhone, Permissions, IsDefaultTypist, IsActive)
                    VALUES (@LawyerId, @LawyerName, @ClerkId, 3, @ClerkName, @ClerkUsername, @Cid, @Phone, N'พิมพ์คำฟ้อง/คำร้อง, ขอปิดหมาย, รับมอบฉันทะ (แบบ ๑๐), จัดเก็บไฟล์สารบัญสำนวน', 1, 1);
                ", new
                {
                    LawyerId = piyanatUser.Id,
                    LawyerName = piyanatUser.FullName,
                    ClerkId = channarongUser.Id,
                    ClerkName = channarongUser.FullName,
                    ClerkUsername = channarongUser.Username,
                    Cid = channarongUser.CitizenId,
                    Phone = channarongUser.Phone
                });
            }

            if (kriangkraiUser != null && channarongUser != null)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO SL_LawyerClerkMappings (LawyerUserId, LawyerFullName, ClerkUserId, ClerkProfileId, ClerkFullName, ClerkUsername, ClerkCitizenId, ClerkPhone, Permissions, IsDefaultTypist, IsActive)
                    VALUES (@LawyerId, @LawyerName, @ClerkId, 3, @ClerkName, @ClerkUsername, @Cid, @Phone, N'พิมพ์คำให้การ/คำแถลงปิดคดี, บัญชีพยาน, รับมอบฉันทะ (แบบ ๑๐), จัดเก็บไฟล์สารบัญสำนวน', 1, 1);
                ", new
                {
                    LawyerId = kriangkraiUser.Id,
                    LawyerName = kriangkraiUser.FullName,
                    ClerkId = channarongUser.Id,
                    ClerkName = channarongUser.FullName,
                    ClerkUsername = channarongUser.Username,
                    Cid = channarongUser.CitizenId,
                    Phone = channarongUser.Phone
                });
            }
        }

        // 3. Seed Sample Payment Slips for Admin Verification
        var slipCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_PaymentSlips");
        if (slipCount == 0)
        {
            var slipImg1 = GenerateSvgSlipPreviewDataUrl("นายปิยะณัฐ วัชราภรณ์", "แพ็กเกจเพิ่มโควต้า +๑๕ คดี (Pro Quota)", 690m, "14 พ.ย. 2569 14:25 น.", "KTB-691114-88291");
            var slipImg2 = GenerateSvgSlipPreviewDataUrl("นายเกรียงไกร โล่ห์ทวนชัย", "สมาชิกรายปี (Yearly Law Firm VIP)", 4900m, "01 พ.ย. 2569 09:15 น.", "KTB-691101-10492");

            await conn.ExecuteAsync(@"
                INSERT INTO SL_PaymentSlips (UserId, UserFullName, PlanId, PlanName, PlanCategory, AmountBaht, CasesQuotaRequested, TransferDateText, TransferTimeText, BankName, SlipImageBase64, ReferenceNote, Status, AdminRemark, ReviewedBy, ReviewedAt)
                VALUES
                (2, N'นายปิยะณัฐ วัชราภรณ์', 3, N'แพ็กเกจเพิ่มโควต้า +๑๕ คดี (Pro Quota)', N'QuotaPack', 690.00, 15, N'14/11/2569', N'14:25', N'ธนาคารกรุงไทย', @Slip1, N'ขอซื้อโควต้าคดีเพิ่ม ๑๕ คดี สำหรับงานฟ้องคดีแพ่งสัญญากู้ยืมเงิน', N'รอตรวจสอบ', N'', N'', NULL),
                (3, N'นายเกรียงไกร โล่ห์ทวนชัย', 5, N'สมาชิกรายปี (Yearly Law Firm VIP)', N'Yearly', 4900.00, 50, N'01/11/2569', N'09:15', N'ธนาคารกรุงไทย', @Slip2, N'สมัครสมาชิกรายปี สำนักงานกฎหมายเกรียงไกร โล่ห์ทวนชัย', N'อนุมัติแล้ว', N'ตรวจสอบยอดโอนถูกต้อง อนุมัติโควต้ารายปีเรียบร้อย', N'ผู้ดูแลระบบสูงสุด (Admin)', SYSUTCDATETIME());
            ", new { Slip1 = slipImg1, Slip2 = slipImg2 });
        }

        // 4. Seed Case File Attachments Referenced by 00_สารบัญแบบพิมพ์ศาล (ทั้งไฟล์ PDF ตัวอย่างคดีจริง และแบบพิมพ์ศาล)
        var fileCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseFileAttachments");
        if (fileCount == 0)
        {
            var cases = (await conn.QueryAsync<LawCase>("SELECT * FROM SL_LawCases ORDER BY Id")).ToList();
            var docs = (await conn.QueryAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments ORDER BY Id")).ToList();

            var crimCase = cases.FirstOrDefault(c => c.CaseCategory == "อาญา") ?? cases.FirstOrDefault();
            var civCase = cases.FirstOrDefault(c => c.CaseCategory == "แพ่ง") ?? cases.LastOrDefault();

            if (crimCase != null)
            {
                var dAns = docs.FirstOrDefault(d => d.CaseId == crimCase.Id && d.FormCode.Contains("๑๑"));
                var dPet = docs.FirstOrDefault(d => d.CaseId == crimCase.Id && d.DocumentTitle.Contains("ขอยื่นคำให้การ"));
                var dClose = docs.FirstOrDefault(d => d.CaseId == crimCase.Id && d.DocumentTitle.Contains("แถลงปิดคดี"));
                var dWit = docs.FirstOrDefault(d => d.CaseId == crimCase.Id && d.FormCode == "(๑๕)");

                await conn.ExecuteAsync(@"
                    INSERT INTO SL_CaseFileAttachments (CaseId, DocumentId, DirectoryIndexNo, FormCode, DirectoryCategoryName, FileTitle, StorageType, FileStatus, FileUrlOrPath, FileDataBase64, MimeType, PageCount, UploadedBy, Remark)
                    VALUES
                    (@CaseId, NULL, 1, N'(๐๐)', N'สารบัญแบบพิมพ์ศาล (อ้างอิงมาตรฐานศาลยุติธรรม)', N'00_สารบัญแบบพิมพ์ศาล.pdf (เอกสารอ้างอิงลำดับแบบพิมพ์ศาล)', N'PDF', N'ศาลรับคำคู่ความแล้ว', N'/api/files/stream-sample/form-00', N'', N'application/pdf', 2, N'นายเกรียงไกร โล่ห์ทวนชัย', N'ตารางสารบัญแบบพิมพ์ศาลยุติธรรมมาตรฐาน (๑)-(๑๕)'),
                    (@CaseId, NULL, 4, N'(๔)', N'แบบพิมพ์คำฟ้อง (สำนวนต้นเรื่องโจทก์)', N'คำฟ้องคดีอาญา หมายเลขดำที่ อ.398/2568 (อ398-2568.pdf)', N'PDF', N'ศาลรับคำคู่ความแล้ว', N'/api/files/stream-sample/crim-plaint', N'', N'application/pdf', 12, N'นายเกรียงไกร โล่ห์ทวนชัย', N'ไฟล์ PDF คำฟ้องโจทก์ต้นฉบับที่ใช้ในการวิเคราะห์ข้อต่อสู้จำเลยที่ ๒'),
                    (@CaseId, @PetDocId, 7, N'(๗)', N'แบบฟอร์มคำร้อง / คำแถลง / คำขอ', N'คำร้องขอยื่นคำให้การจำเลยที่ ๒ (คำร้องขอยืนคำให้การ.pdf)', N'PDF', N'ยื่นต่อศาลแล้ว', N'/api/files/stream-sample/crim-petition-answer', N'', N'application/pdf', 2, N'นายเกรียงไกร โล่ห์ทวนชัย', N'ยื่นคำร้องขออนุญาตยื่นคำให้การเพิ่มเติมตาม ป.วิ.อ. มาตรา ๑๗๒'),
                    (@CaseId, @AnsDocId, 11, N'(๑๑)', N'แบบฟอร์มคำให้การจำเลย', N'คำให้การจำเลยที่ ๒ คดีหมายเลขดำ อ.398/2568 (คำให้การ398-2568.pdf)', N'PDF', N'ยื่นต่อศาลแล้ว', N'/api/files/stream-sample/crim-answer', N'', N'application/pdf', 5, N'นายเกรียงไกร โล่ห์ทวนชัย', N'คำให้การปฏิเสธฟ้องโจทก์ของจำเลยที่ ๒ (นพ.อัครเดช บุญเย็น)'),
                    (@CaseId, @WitDocId, 15, N'(๑๕)', N'แบบฟอร์มบัญชีระบุพยาน', N'บัญชีระบุพยานจำเลยที่ ๒ (บัญชีพยาน.pdf)', N'PDF', N'ยื่นต่อศาลแล้ว', N'/api/files/stream-sample/crim-witness', N'', N'application/pdf', 3, N'นายเกรียงไกร โล่ห์ทวนชัย', N'บัญชีระบุพยานจำเลยที่ ๒ อันดับที่ ๑-๑๐'),
                    (@CaseId, @CloseDocId, 7, N'(๗)', N'แบบฟอร์มคำร้อง / คำแถลง / คำขอ', N'คำแถลงการณ์ปิดคดีจำเลยที่ ๒ ฉบับสมบูรณ์ (คำแถลงปิดคดี398-2568-Full-Version-1.0.pdf)', N'PDF', N'ลงนามแล้ว', N'/api/files/stream-sample/crim-closing', N'', N'application/pdf', 18, N'นายเกรียงไกร โล่ห์ทวนชัย', N'คำแถลงปิดคดีวิเคราะห์พยานหลักฐานโจทก์-จำเลยครบ ๖ ประเด็น');
                ", new
                {
                    CaseId = crimCase.Id,
                    PetDocId = dAns?.Id,
                    AnsDocId = dPet?.Id,
                    WitDocId = dWit?.Id,
                    CloseDocId = dClose?.Id
                });
            }

            if (civCase != null)
            {
                var dCivPlaint = docs.FirstOrDefault(d => d.CaseId == civCase.Id && d.FormCode == "(๔)");
                var dCivEnd = docs.FirstOrDefault(d => d.CaseId == civCase.Id && d.FormCode == "(๕)");
                var dCivPost = docs.FirstOrDefault(d => d.CaseId == civCase.Id && d.FormCode == "(๗)");
                var dCivApp = docs.FirstOrDefault(d => d.CaseId == civCase.Id && d.FormCode == "(๙)");
                var dCivSum = docs.FirstOrDefault(d => d.CaseId == civCase.Id && d.FormCode == "(๑๒)");

                await conn.ExecuteAsync(@"
                    INSERT INTO SL_CaseFileAttachments (CaseId, DocumentId, DirectoryIndexNo, FormCode, DirectoryCategoryName, FileTitle, StorageType, FileStatus, FileUrlOrPath, FileDataBase64, MimeType, PageCount, UploadedBy, Remark)
                    VALUES
                    (@CaseId, @PlaintId, 4, N'(๔)', N'แบบพิมพ์คำฟ้อง', N'คำฟ้องแพ่ง ผิดสัญญากู้ยืมเงิน (04_แบบพิมพ์คำฟ้อง.pdf)', N'PDF', N'ยื่นต่อศาลแล้ว', N'/api/files/stream-sample/form-04', N'', N'application/pdf', 2, N'นายปิยะณัฐ วัชราภรณ์', N'คำฟ้องคดีแพ่ง ทุนทรัพย์ ๑๕๘,๑๒๕ บาท โจทก์ นางไพลิน อาจสามารถ'),
                    (@CaseId, @EndId, 5, N'(๕)', N'แบบฟอร์มคำขอท้ายคำฟ้องแพ่ง', N'คำขอท้ายคำฟ้องแพ่ง (05_แบบฟอร์มคำขอท้ายคำฟ้องแพ่ง.pdf)', N'PDF', N'ยื่นต่อศาลแล้ว', N'/api/files/stream-sample/form-05', N'', N'application/pdf', 2, N'นายปิยะณัฐ วัชราภรณ์', N'คำขอท้ายคำฟ้องแพ่ง ขอให้บังคับจำเลยชำระเงินต้นพร้อมดอกเบี้ยร้อยละ ๕ ต่อปี'),
                    (@CaseId, @PostId, 7, N'(๗)', N'แบบฟอร์มคำร้อง / คำแถลง / คำขอ', N'คำร้องขอปิดหมายเรียกและสำเนาคำฟ้อง (07_แบบฟอร์มคำร้อง.pdf)', N'PDF', N'ยื่นต่อศาลแล้ว', N'/api/files/stream-sample/form-07', N'', N'application/pdf', 2, N'นายปิยะณัฐ วัชราภรณ์', N'คำร้องขอปิดหมาย ณ ภูมิลำเนาจำเลย ต.ศรีสำราญ อ.วังหิน จ.ศรีสะเกษ'),
                    (@CaseId, @AppId, 9, N'(๙)', N'แบบฟอร์มใบแต่งทนายความ', N'ใบแต่งทนายความ นางไพลิน อาจสามารถ แต่งตั้ง นายปิยะณัฐ วัชราภรณ์ (09_แบบฟอร์มใบแต่งทนายความ.pdf)', N'PDF', N'ลงนามแล้ว', N'/api/files/stream-sample/form-09', N'', N'application/pdf', 1, N'นายปิยะณัฐ วัชราภรณ์', N'ใบแต่งทนายความโจทก์ตาม ป.วิ.พ. มาตรา ๖๐-๖๒'),
                    (@CaseId, @SumId, 12, N'(๑๒)', N'แบบฟอร์มหมายเรียกคดีมโนสาเร่', N'หมายเรียกคดีมโนสาเร่ (12_แบบฟอร์มหมายเรียกคดีมโนสาเร่.pdf)', N'PDF', N'ศาลรับคำคู่ความแล้ว', N'/api/files/stream-sample/form-12', N'', N'application/pdf', 2, N'นายปิยะณัฐ วัชราภรณ์', N'หมายเรียกคดีมโนสาเร่ นัดไกล่เกลี่ย ให้การ และสืบพยาน');
                ", new
                {
                    CaseId = civCase.Id,
                    PlaintId = dCivPlaint?.Id,
                    EndId = dCivEnd?.Id,
                    PostId = dCivPost?.Id,
                    AppId = dCivApp?.Id,
                    SumId = dCivSum?.Id
                });
            }
        }
    }
}
