using Dapper;
using SmartLaws.Web.Models;
using SmartLaws.Web.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<DatabaseService>();
builder.Services.AddSingleton<WordExportService>();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

var app = builder.Build();

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

// Initialize DB and Seed Data on Startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<DatabaseService>();
    await db.InitializeDatabaseAsync();
}

// ==================== API ENDPOINTS ====================

// 1. Dashboard & Reports Summary
app.MapGet("/api/dashboard", async (DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var cases = (await conn.QueryAsync<LawCase>("SELECT * FROM SL_LawCases ORDER BY UpdatedAt DESC")).ToList();
    var docs = (await conn.QueryAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments ORDER BY UpdatedAt DESC")).ToList();
    var lawyers = (await conn.QueryAsync<LawyerProfile>("SELECT * FROM SL_LawyerProfiles ORDER BY Id")).ToList();
    var templates = (await conn.QueryAsync<CourtFormTemplate>("SELECT * FROM SL_CourtFormTemplates ORDER BY Id")).ToList();
    var signatures = (await conn.QueryAsync<ElectronicSignature>("SELECT * FROM SL_ElectronicSignatures ORDER BY Id")).ToList();
    var users = (await conn.QueryAsync<UserAccount>("SELECT * FROM SL_UserAccounts ORDER BY Id")).ToList();
    var plans = (await conn.QueryAsync<SubscriptionPlan>("SELECT * FROM SL_SubscriptionPlans ORDER BY Id")).ToList();
    var slips = (await conn.QueryAsync<PaymentSlip>("SELECT * FROM SL_PaymentSlips ORDER BY Id DESC")).ToList();
    var caseFiles = (await conn.QueryAsync<CaseFileAttachment>("SELECT * FROM SL_CaseFileAttachments ORDER BY DirectoryIndexNo, Id DESC")).ToList();
    var clerkMappings = (await conn.QueryAsync<LawyerClerkMapping>("SELECT * FROM SL_LawyerClerkMappings ORDER BY LawyerUserId, IsDefaultTypist DESC, Id")).ToList();

    return Results.Ok(new
    {
        TotalCases = cases.Count,
        CriminalCases = cases.Count(c => c.CaseCategory == "อาญา"),
        CivilCases = cases.Count(c => c.CaseCategory == "แพ่ง"),
        PlaintiffLawyerCases = cases.Count(c => c.LawyerRole.Contains("โจทก์") || c.LawyerRole.Contains("ผู้ร้อง")),
        DefendantLawyerCases = cases.Count(c => c.LawyerRole.Contains("จำเลย") || c.LawyerRole.Contains("ผู้คัดค้าน")),
        TotalDocuments = docs.Count,
        TotalClaimAmount = cases.Sum(c => c.ClaimAmount),
        Cases = cases,
        RecentDocuments = docs,
        Lawyers = lawyers,
        Templates = templates,
        Signatures = signatures,
        Users = users,
        Plans = plans,
        PaymentSlips = slips,
        CaseFiles = caseFiles,
        ClerkMappings = clerkMappings
    });
});

// 2. Cases CRUD
app.MapGet("/api/cases", async (DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var cases = await conn.QueryAsync<LawCase>("SELECT * FROM SL_LawCases ORDER BY Id DESC");
    return Results.Ok(cases);
});

app.MapGet("/api/cases/{id:int}", async (int id, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var lawCase = await conn.QueryFirstOrDefaultAsync<LawCase>("SELECT * FROM SL_LawCases WHERE Id = @Id", new { Id = id });
    if (lawCase == null) return Results.NotFound();
    var parties = await conn.QueryAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE CaseId = @Id ORDER BY PartySide, PartyOrder", new { Id = id });
    var docs = await conn.QueryAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WHERE CaseId = @Id ORDER BY Id DESC", new { Id = id });
    return Results.Ok(new { Case = lawCase, Parties = parties, Documents = docs });
});

app.MapPost("/api/cases", async (HttpContext http, LawCase model, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var userIdStr = http.Request.Query["userId"].FirstOrDefault();
    if (int.TryParse(userIdStr, out var userId) && userId > 0)
    {
        var user = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Id = @Id", new { Id = userId });
        if (user != null && user.Role != "Admin" && user.UsedCasesCount >= user.MaxCasesQuota)
        {
            return Results.BadRequest(new
            {
                quotaExceeded = true,
                message = $"โควต้าสำนวนคดีของบัญชี {user.FullName} เต็มแล้ว ({user.UsedCasesCount}/{user.MaxCasesQuota} คดี) กรุณาเลือกแพ็กเกจรายเดือน รายปี หรือซื้อโควต้าคดีเพิ่ม"
            });
        }
    }

    if (string.IsNullOrWhiteSpace(model.CaseCode))
    {
        var prefix = model.CaseCategory == "อาญา" ? "CRIM" : "CIV";
        model.CaseCode = $"{prefix}-{DateTime.Now:yyMMdd-HHmm}";
    }

    var id = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_LawCases (
            CaseCode, BlackCaseNo, BlackCaseYear, RedCaseNo, RedCaseYear, CourtName,
            CaseCategory, SubCategory, LawyerRole, RepresentingPartyOrder,
            PlaintiffName, DefendantName, ChargeOrCauseOfAction, ClaimAmount, InterestRate,
            CurrentProceduralStage, Status, NextHearingDate, NextHearingNote, PrimaryLawyerId, ClerkId, CaseSummary
        )
        OUTPUT INSERTED.Id
        VALUES (
            @CaseCode, @BlackCaseNo, @BlackCaseYear, @RedCaseNo, @RedCaseYear, @CourtName,
            @CaseCategory, @SubCategory, @LawyerRole, @RepresentingPartyOrder,
            @PlaintiffName, @DefendantName, @ChargeOrCauseOfAction, @ClaimAmount, @InterestRate,
            @CurrentProceduralStage, @Status, @NextHearingDate, @NextHearingNote, @PrimaryLawyerId, @ClerkId, @CaseSummary
        );
    ", model);

    if (int.TryParse(userIdStr, out var uid) && uid > 0)
    {
        await conn.ExecuteAsync("UPDATE SL_UserAccounts SET UsedCasesCount = UsedCasesCount + 1 WHERE Id = @Id", new { Id = uid });
    }
    else if (model.PrimaryLawyerId > 0)
    {
        await conn.ExecuteAsync("UPDATE SL_UserAccounts SET UsedCasesCount = UsedCasesCount + 1 WHERE LawyerProfileId = @LawyerProfileId", new { LawyerProfileId = model.PrimaryLawyerId });
    }

    model.Id = id;
    return Results.Ok(model);
});

app.MapPut("/api/cases/{id:int}", async (int id, LawCase model, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    model.Id = id;
    await conn.ExecuteAsync(@"
        UPDATE SL_LawCases SET
            BlackCaseNo = @BlackCaseNo,
            BlackCaseYear = @BlackCaseYear,
            RedCaseNo = @RedCaseNo,
            RedCaseYear = @RedCaseYear,
            CourtName = @CourtName,
            CaseCategory = @CaseCategory,
            SubCategory = @SubCategory,
            LawyerRole = @LawyerRole,
            RepresentingPartyOrder = @RepresentingPartyOrder,
            PlaintiffName = @PlaintiffName,
            DefendantName = @DefendantName,
            ChargeOrCauseOfAction = @ChargeOrCauseOfAction,
            ClaimAmount = @ClaimAmount,
            InterestRate = @InterestRate,
            CurrentProceduralStage = @CurrentProceduralStage,
            Status = @Status,
            NextHearingDate = @NextHearingDate,
            NextHearingNote = @NextHearingNote,
            PrimaryLawyerId = @PrimaryLawyerId,
            ClerkId = @ClerkId,
            CaseSummary = @CaseSummary,
            UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id;
    ", model);
    return Results.Ok(model);
});

app.MapPut("/api/cases/{id:int}/clerk", async (int id, LawCase req, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.ExecuteAsync(@"
        UPDATE SL_LawCases SET
            ClerkId = @ClerkId,
            UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id;
    ", new { Id = id, req.ClerkId });
    var updated = await conn.QueryFirstOrDefaultAsync<LawCase>("SELECT * FROM SL_LawCases WHERE Id = @Id", new { Id = id });
    return Results.Ok(updated);
});

app.MapDelete("/api/cases/{id:int}", async (int id, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.ExecuteAsync("DELETE FROM SL_CaseDocuments WHERE CaseId = @Id; DELETE FROM SL_CaseParties WHERE CaseId = @Id; DELETE FROM SL_LawCases WHERE Id = @Id;", new { Id = id });
    return Results.Ok(new { Deleted = true });
});

// 3. Case Parties CRUD
app.MapPost("/api/parties", async (CaseParty party, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var id = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_CaseParties (
            CaseId, PartySide, PartyOrder, Title, FullName, CitizenId, Race, Nationality,
            Occupation, Age, BirthDateText, HouseNo, Moo, Road, Soi, NearBy,
            SubDistrict, District, Province, PostalCode, Phone, Fax, Email, IsOurClient
        )
        OUTPUT INSERTED.Id
        VALUES (
            @CaseId, @PartySide, @PartyOrder, @Title, @FullName, @CitizenId, @Race, @Nationality,
            @Occupation, @Age, @BirthDateText, @HouseNo, @Moo, @Road, @Soi, @NearBy,
            @SubDistrict, @District, @Province, @PostalCode, @Phone, @Fax, @Email, @IsOurClient
        );
    ", party);
    party.Id = id;
    return Results.Ok(party);
});

// 4. Court Form Templates
app.MapGet("/api/templates", async (DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var list = await conn.QueryAsync<CourtFormTemplate>("SELECT * FROM SL_CourtFormTemplates ORDER BY Id");
    return Results.Ok(list);
});

app.MapPost("/api/templates", async (CourtFormTemplate tpl, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var id = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_CourtFormTemplates (FormCode, FormName, Category, ApplicableRole, ProceduralLawRef, LayoutType, DefaultHeaderTitle, DefaultPreambleTemplate, DefaultClausesJson, DefaultClosingText, SourceWordFileName, Description)
        OUTPUT INSERTED.Id
        VALUES (@FormCode, @FormName, @Category, @ApplicableRole, @ProceduralLawRef, @LayoutType, @DefaultHeaderTitle, @DefaultPreambleTemplate, @DefaultClausesJson, @DefaultClosingText, @SourceWordFileName, @Description);
    ", tpl);
    tpl.Id = id;
    return Results.Ok(tpl);
});

// 5. Case Documents (Petitions, Plaints, Answers, Witness Lists, Summons, Appointments)
app.MapGet("/api/documents", async (int? caseId, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    if (caseId.HasValue && caseId.Value > 0)
    {
        var list = await conn.QueryAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WHERE CaseId = @CaseId ORDER BY Id DESC", new { CaseId = caseId.Value });
        return Results.Ok(list);
    }
    var all = await conn.QueryAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments ORDER BY UpdatedAt DESC");
    return Results.Ok(all);
});

app.MapGet("/api/documents/{id:int}", async (int id, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var doc = await conn.QueryFirstOrDefaultAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WHERE Id = @Id", new { Id = id });
    if (doc == null) return Results.NotFound();
    var lawCase = await conn.QueryFirstOrDefaultAsync<LawCase>("SELECT * FROM SL_LawCases WHERE Id = @CaseId", new { doc.CaseId });
    return Results.Ok(new { Document = doc, Case = lawCase });
});

app.MapPost("/api/documents", async (CaseDocument doc, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.OpenAsync();
    var id = await db.InsertDocumentAsync(conn, doc);
    doc.Id = id;
    return Results.Ok(doc);
});

app.MapPut("/api/documents/{id:int}", async (int id, CaseDocument doc, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    doc.Id = id;
    DatabaseService.NormalizeDocumentThaiSpacing(doc);
    await conn.ExecuteAsync(@"
        UPDATE SL_CaseDocuments SET
            CaseId = @CaseId,
            TemplateId = @TemplateId,
            FormCode = @FormCode,
            DocumentTitle = @DocumentTitle,
            DocumentSubTitle = @DocumentSubTitle,
            LawyerRoleInDoc = @LawyerRoleInDoc,
            DocDay = @DocDay,
            DocMonth = @DocMonth,
            DocYear = @DocYear,
            RequesterFullName = @RequesterFullName,
            RequesterStatus = @RequesterStatus,
            RequesterCitizenId = @RequesterCitizenId,
            RequesterRace = @RequesterRace,
            RequesterNationality = @RequesterNationality,
            RequesterOccupation = @RequesterOccupation,
            RequesterAge = @RequesterAge,
            RequesterHouseNo = @RequesterHouseNo,
            RequesterMoo = @RequesterMoo,
            RequesterRoad = @RequesterRoad,
            RequesterSoi = @RequesterSoi,
            RequesterNearBy = @RequesterNearBy,
            RequesterSubDistrict = @RequesterSubDistrict,
            RequesterDistrict = @RequesterDistrict,
            RequesterProvince = @RequesterProvince,
            RequesterPostalCode = @RequesterPostalCode,
            RequesterPhone = @RequesterPhone,
            ClausesJson = @ClausesJson,
            ExtraFieldsJson = @ExtraFieldsJson,
            ClosingPrayer = @ClosingPrayer,
            SignerName = @SignerName,
            SignerRole = @SignerRole,
            DrafterName = @DrafterName,
            TypistName = @TypistName,
            SignatureImageBase64 = @SignatureImageBase64,
            DrafterSignatureBase64 = @DrafterSignatureBase64,
            TypistSignatureBase64 = @TypistSignatureBase64,
            UseThaiNumerals = @UseThaiNumerals,
            Status = @Status,
            UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id;
    ", doc);
    return Results.Ok(doc);
});

app.MapDelete("/api/documents/{id:int}", async (int id, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.ExecuteAsync("DELETE FROM SL_CaseDocuments WHERE Id = @Id", new { Id = id });
    return Results.Ok(new { Deleted = true });
});

// Export Word (.docx)
app.MapGet("/api/documents/{id:int}/export-docx", async (int id, DatabaseService db, WordExportService wordExport) =>
{
    using var conn = db.CreateConnection();
    var doc = await conn.QueryFirstOrDefaultAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WHERE Id = @Id", new { Id = id });
    if (doc == null) return Results.NotFound();
    var lawCase = await conn.QueryFirstOrDefaultAsync<LawCase>("SELECT * FROM SL_LawCases WHERE Id = @CaseId", new { doc.CaseId });

    var bytes = wordExport.GenerateCourtDocumentDocx(doc, lawCase);
    var safeTitle = string.Join("_", (doc.DocumentTitle ?? "CourtForm").Split(Path.GetInvalidFileNameChars()));
    return Results.File(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", $"{safeTitle}.docx");
});

// 6. Lawyers & Electronic Signatures CRUD (Back-office)
app.MapGet("/api/lawyers", async (DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    return Results.Ok(await conn.QueryAsync<LawyerProfile>("SELECT * FROM SL_LawyerProfiles ORDER BY Id"));
});

app.MapPost("/api/lawyers", async (LawyerProfile model, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var id = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_LawyerProfiles (FullName, RoleType, LicenseNo, LicenseJurisdiction, CitizenId, Race, Nationality, Occupation, Age, HouseNo, Moo, Road, Soi, NearBy, SubDistrict, District, Province, PostalCode, Phone, OfficeName, SignatureDataUrl)
        OUTPUT INSERTED.Id
        VALUES (@FullName, @RoleType, @LicenseNo, @LicenseJurisdiction, @CitizenId, @Race, @Nationality, @Occupation, @Age, @HouseNo, @Moo, @Road, @Soi, @NearBy, @SubDistrict, @District, @Province, @PostalCode, @Phone, @OfficeName, @SignatureDataUrl);
    ", model);
    model.Id = id;
    return Results.Ok(model);
});

app.MapPut("/api/lawyers/{id:int}", async (int id, LawyerProfile model, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    model.Id = id;
    await conn.ExecuteAsync(@"
        UPDATE SL_LawyerProfiles SET
            FullName = @FullName, RoleType = @RoleType, LicenseNo = @LicenseNo, LicenseJurisdiction = @LicenseJurisdiction,
            CitizenId = @CitizenId, Age = @Age, HouseNo = @HouseNo, Moo = @Moo, Road = @Road,
            SubDistrict = @SubDistrict, District = @District, Province = @Province, PostalCode = @PostalCode,
            Phone = @Phone, OfficeName = @OfficeName, SignatureDataUrl = @SignatureDataUrl
        WHERE Id = @Id;
    ", model);
    return Results.Ok(model);
});

app.MapGet("/api/signatures", async (DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    return Results.Ok(await conn.QueryAsync<ElectronicSignature>("SELECT * FROM SL_ElectronicSignatures ORDER BY Id DESC"));
});

app.MapPost("/api/signatures", async (ElectronicSignature sig, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    if (string.IsNullOrWhiteSpace(sig.VerificationHash))
    {
        sig.VerificationHash = $"SHA256-{Guid.NewGuid().ToString("N")[..12].ToUpperInvariant()}";
    }
    var id = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_ElectronicSignatures (SignerName, SignerRole, LicenseOrCitizenId, SignatureType, ImageDataUrl, VerificationHash, IsDefault)
        OUTPUT INSERTED.Id
        VALUES (@SignerName, @SignerRole, @LicenseOrCitizenId, @SignatureType, @ImageDataUrl, @VerificationHash, @IsDefault);
    ", sig);
    sig.Id = id;

    if (!string.IsNullOrWhiteSpace(sig.SignerName) && !string.IsNullOrWhiteSpace(sig.ImageDataUrl))
    {
        await conn.ExecuteAsync(@"
            UPDATE SL_LawyerProfiles
            SET SignatureDataUrl = @ImageDataUrl
            WHERE FullName = @SignerName;
        ", new { sig.ImageDataUrl, sig.SignerName });
    }

    return Results.Ok(sig);
});

app.MapDelete("/api/signatures/{id:int}", async (int id, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.ExecuteAsync("DELETE FROM SL_ElectronicSignatures WHERE Id = @Id", new { Id = id });
    return Results.Ok(new { Deleted = true });
});

// ==================== 7. AUTH, LAWYER REGISTRATION (3-CASE TRIAL), QUOTA & ADMIN SYSTEM ====================

app.MapGet("/api/users", async (DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    return Results.Ok(await conn.QueryAsync<UserAccount>("SELECT * FROM SL_UserAccounts ORDER BY Id"));
});

app.MapPost("/api/auth/login", async (UserAccount loginReq, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    UserAccount? user = null;
    if (loginReq.Id > 0)
    {
        user = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Id = @Id", new { loginReq.Id });
    }
    else
    {
        user = await conn.QueryFirstOrDefaultAsync<UserAccount>(
            "SELECT * FROM SL_UserAccounts WHERE (Username = @Username OR Email = @Username) AND (PasswordHash = @PasswordHash OR @PasswordHash = '')",
            new { Username = loginReq.Username?.Trim() ?? "", PasswordHash = loginReq.PasswordHash?.Trim() ?? "" });
    }

    if (user == null)
    {
        return Results.BadRequest(new { message = "ไม่พบบัญชีผู้ใช้งาน หรือรหัสผ่านไม่ถูกต้อง" });
    }
    if (user.AccountStatus == "Suspended")
    {
        return Results.BadRequest(new { message = "บัญชีนี้ถูกระงับการใช้งานชั่วคราว กรุณาติดต่อผู้ดูแลระบบ" });
    }
    return Results.Ok(user);
});

// ลงทะเบียนสมาชิกทนายความใหม่ รับสิทธิ์ทดลองใช้งานฟรี 3 คดีทันที
app.MapPost("/api/auth/register", async (UserAccount reg, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    if (string.IsNullOrWhiteSpace(reg.Username) || string.IsNullOrWhiteSpace(reg.FullName))
    {
        return Results.BadRequest(new { message = "กรุณาระบุชื่อผู้ใช้งาน (Username) และชื่อ-นามสกุลทนายความ" });
    }

    var existing = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Username = @Username", new { Username = reg.Username.Trim() });
    if (existing > 0)
    {
        return Results.BadRequest(new { message = "ชื่อผู้ใช้งาน (Username) นี้มีในระบบแล้ว กรุณาใช้ชื่ออื่น" });
    }

    // สร้างโปรไฟล์ทนายความและลายเซ็นอิเล็กทรอนิกส์อัตโนมัติเพื่อให้ใช้ร่วมกันได้ทุกฟอร์มในระบบ
    var shortName = reg.FullName.Replace("นาย", "").Replace("นางสาว", "").Replace("นาง", "").Trim();
    var svgSig = $@"<svg xmlns='http://www.w3.org/2000/svg' width='280' height='80' viewBox='0 0 280 80'>
        <path d='M25,55 C55,20 75,65 105,35 C130,15 145,58 180,40 C205,28 235,48 260,32' fill='none' stroke='#1e3a8a' stroke-width='2.4' stroke-linecap='round'/>
        <path d='M45,62 Q140,48 245,56' fill='none' stroke='#1e3a8a' stroke-width='1.2' stroke-opacity='0.65' stroke-linecap='round'/>
        <text x='140' y='44' font-family='Sarabun, sans-serif' font-size='15' font-style='italic' font-weight='600' fill='#1e3a8a' text-anchor='middle'>{shortName}</text>
    </svg>";
    var sigDataUrl = "data:image/svg+xml;base64," + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(svgSig));

    var lawyerId = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_LawyerProfiles (FullName, RoleType, LicenseNo, LicenseJurisdiction, CitizenId, Race, Nationality, Occupation, Age, HouseNo, Moo, Road, SubDistrict, District, Province, PostalCode, Phone, OfficeName, SignatureDataUrl)
        OUTPUT INSERTED.Id
        VALUES (@FullName, N'ทนายความ', @LicenseNo, N'ทั่วราชอาณาจักร', @CitizenId, N'ไทย', N'ไทย', N'ทนายความ', N'40', N'99/1', N'-', N'-', N'ในเมือง', N'เมืองฯ', N'ศรีสะเกษ', N'33000', @Phone, @OfficeName, @Sig);
    ", new
    {
        reg.FullName,
        LicenseNo = string.IsNullOrWhiteSpace(reg.LicenseNo) ? "-" : reg.LicenseNo,
        CitizenId = string.IsNullOrWhiteSpace(reg.CitizenId) ? "3-3301-00111-22-3" : reg.CitizenId,
        Phone = string.IsNullOrWhiteSpace(reg.Phone) ? "-" : reg.Phone,
        OfficeName = string.IsNullOrWhiteSpace(reg.OfficeName) ? $"สำนักงานทนายความ{shortName}" : reg.OfficeName,
        Sig = sigDataUrl
    });

    await conn.ExecuteAsync(@"
        INSERT INTO SL_ElectronicSignatures (SignerName, SignerRole, LicenseOrCitizenId, SignatureType, ImageDataUrl, VerificationHash, IsDefault)
        VALUES (@FullName, N'ทนายความ / ผู้เรียง', @LicenseNo, N'E-Signature Pad', @Sig, @Hash, 1);
    ", new
    {
        reg.FullName,
        LicenseNo = $"ใบอนุญาตทนายความ {reg.LicenseNo}",
        Sig = sigDataUrl,
        Hash = $"SHA256-{Guid.NewGuid().ToString("N")[..12].ToUpperInvariant()}"
    });

    reg.LawyerProfileId = lawyerId;
    reg.Role = "Lawyer";
    reg.PlanType = "Trial";
    reg.PlanName = "ทดลองใช้งานฟรี (๓ คดี)";
    reg.MaxCasesQuota = 3; // ให้ทดลองทำได้ 3 คดี
    reg.UsedCasesCount = 0;
    reg.SubscriptionExpireDate = DateTime.UtcNow.AddDays(30);
    reg.AccountStatus = "Active";
    if (string.IsNullOrWhiteSpace(reg.PasswordHash)) reg.PasswordHash = "123456";

    var userId = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_UserAccounts (Username, PasswordHash, FullName, Role, LawyerProfileId, LicenseNo, CitizenId, Phone, Email, OfficeName, PlanType, PlanName, MaxCasesQuota, UsedCasesCount, SubscriptionExpireDate, AccountStatus)
        OUTPUT INSERTED.Id
        VALUES (@Username, @PasswordHash, @FullName, @Role, @LawyerProfileId, @LicenseNo, @CitizenId, @Phone, @Email, @OfficeName, @PlanType, @PlanName, @MaxCasesQuota, @UsedCasesCount, @SubscriptionExpireDate, @AccountStatus);
    ", reg);

    reg.Id = userId;
    return Results.Ok(reg);
});

// แอดมินปรับปรุงโควต้าคดี แพ็กเกจ หรือสถานะสมาชิกทนายความ
app.MapPut("/api/admin/users/{id:int}/quota", async (int id, UserAccount updateReq, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.ExecuteAsync(@"
        UPDATE SL_UserAccounts SET
            FullName = @FullName,
            Role = @Role,
            LicenseNo = @LicenseNo,
            Phone = @Phone,
            OfficeName = @OfficeName,
            PlanType = @PlanType,
            PlanName = @PlanName,
            MaxCasesQuota = @MaxCasesQuota,
            UsedCasesCount = @UsedCasesCount,
            AccountStatus = @AccountStatus
        WHERE Id = @Id;
    ", new
    {
        Id = id,
        updateReq.FullName,
        Role = string.IsNullOrWhiteSpace(updateReq.Role) ? "Lawyer" : updateReq.Role,
        updateReq.LicenseNo,
        updateReq.Phone,
        updateReq.OfficeName,
        updateReq.PlanType,
        updateReq.PlanName,
        updateReq.MaxCasesQuota,
        updateReq.UsedCasesCount,
        AccountStatus = string.IsNullOrWhiteSpace(updateReq.AccountStatus) ? "Active" : updateReq.AccountStatus
    });
    var updated = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Id = @Id", new { Id = id });
    return Results.Ok(updated);
});

// ==================== 8. SUBSCRIPTION PLANS & PAYMENT SLIPS ====================

app.MapGet("/api/plans", async (DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    return Results.Ok(await conn.QueryAsync<SubscriptionPlan>("SELECT * FROM SL_SubscriptionPlans ORDER BY Id"));
});

app.MapPost("/api/admin/plans", async (SubscriptionPlan plan, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var id = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_SubscriptionPlans (PlanCode, PlanName, PlanCategory, PriceBaht, CasesQuotaIncluded, DurationDays, Description, BankAccountInfo, IsActive)
        OUTPUT INSERTED.Id
        VALUES (@PlanCode, @PlanName, @PlanCategory, @PriceBaht, @CasesQuotaIncluded, @DurationDays, @Description, @BankAccountInfo, @IsActive);
    ", plan);
    plan.Id = id;
    return Results.Ok(plan);
});

app.MapPut("/api/admin/plans/{id:int}", async (int id, SubscriptionPlan plan, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    plan.Id = id;
    await conn.ExecuteAsync(@"
        UPDATE SL_SubscriptionPlans SET
            PlanCode = @PlanCode,
            PlanName = @PlanName,
            PlanCategory = @PlanCategory,
            PriceBaht = @PriceBaht,
            CasesQuotaIncluded = @CasesQuotaIncluded,
            DurationDays = @DurationDays,
            Description = @Description,
            BankAccountInfo = @BankAccountInfo,
            IsActive = @IsActive
        WHERE Id = @Id;
    ", plan);
    return Results.Ok(plan);
});

app.MapGet("/api/payments/slips", async (DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    return Results.Ok(await conn.QueryAsync<PaymentSlip>("SELECT * FROM SL_PaymentSlips ORDER BY Id DESC"));
});

app.MapPost("/api/payments/slips", async (PaymentSlip slip, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    if (string.IsNullOrWhiteSpace(slip.SlipImageBase64))
    {
        slip.SlipImageBase64 = DatabaseService.GenerateSvgSlipPreviewDataUrl(
            slip.UserFullName,
            slip.PlanName,
            slip.AmountBaht,
            $"{slip.TransferDateText} {slip.TransferTimeText}",
            $"SLIP-{DateTime.Now:yyMMddHHmm}");
    }
    slip.Status = "รอตรวจสอบ";
    var id = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_PaymentSlips (UserId, UserFullName, PlanId, PlanName, PlanCategory, AmountBaht, CasesQuotaRequested, TransferDateText, TransferTimeText, BankName, SlipImageBase64, ReferenceNote, Status, AdminRemark)
        OUTPUT INSERTED.Id
        VALUES (@UserId, @UserFullName, @PlanId, @PlanName, @PlanCategory, @AmountBaht, @CasesQuotaRequested, @TransferDateText, @TransferTimeText, @BankName, @SlipImageBase64, @ReferenceNote, @Status, N'');
    ", slip);
    slip.Id = id;
    return Results.Ok(slip);
});

app.MapPost("/api/admin/slips/{id:int}/approve", async (int id, PaymentSlip? reviewReq, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var slip = await conn.QueryFirstOrDefaultAsync<PaymentSlip>("SELECT * FROM SL_PaymentSlips WHERE Id = @Id", new { Id = id });
    if (slip == null) return Results.NotFound();

    var quotaToAdd = (reviewReq?.CasesQuotaRequested > 0) ? reviewReq.CasesQuotaRequested : slip.CasesQuotaRequested;
    var remark = !string.IsNullOrWhiteSpace(reviewReq?.AdminRemark) ? reviewReq.AdminRemark : "ตรวจสอบสลิปโอนเงินถูกต้อง อนุมัติเพิ่มโควต้าเรียบร้อย";
    var reviewer = !string.IsNullOrWhiteSpace(reviewReq?.ReviewedBy) ? reviewReq.ReviewedBy : "ผู้ดูแลระบบสูงสุด (Admin)";

    await conn.ExecuteAsync(@"
        UPDATE SL_PaymentSlips SET
            Status = N'อนุมัติแล้ว',
            CasesQuotaRequested = @Quota,
            AdminRemark = @Remark,
            ReviewedBy = @Reviewer,
            ReviewedAt = SYSUTCDATETIME()
        WHERE Id = @Id;
    ", new { Id = id, Quota = quotaToAdd, Remark = remark, Reviewer = reviewer });

    var plan = await conn.QueryFirstOrDefaultAsync<SubscriptionPlan>("SELECT * FROM SL_SubscriptionPlans WHERE Id = @PlanId", new { slip.PlanId });
    int addDays = plan?.DurationDays ?? (slip.PlanCategory == "Yearly" ? 365 : 30);

    await conn.ExecuteAsync(@"
        UPDATE SL_UserAccounts SET
            MaxCasesQuota = MaxCasesQuota + @Quota,
            PlanType = @PlanCategory,
            PlanName = @PlanName,
            SubscriptionExpireDate = DATEADD(day, @AddDays, ISNULL(SubscriptionExpireDate, SYSUTCDATETIME())),
            AccountStatus = N'Active'
        WHERE Id = @UserId;
    ", new
    {
        Quota = quotaToAdd,
        slip.PlanCategory,
        slip.PlanName,
        AddDays = addDays,
        slip.UserId
    });

    var updatedUser = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Id = @UserId", new { slip.UserId });
    return Results.Ok(new { Approved = true, SlipId = id, AddedQuota = quotaToAdd, User = updatedUser });
});

app.MapPost("/api/admin/slips/{id:int}/reject", async (int id, PaymentSlip? reviewReq, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.ExecuteAsync(@"
        UPDATE SL_PaymentSlips SET
            Status = N'ปฏิเสธ',
            AdminRemark = @Remark,
            ReviewedBy = @Reviewer,
            ReviewedAt = SYSUTCDATETIME()
        WHERE Id = @Id;
    ", new
    {
        Id = id,
        Remark = reviewReq?.AdminRemark ?? "ยอดเงินหรือหลักฐานสลิปไม่ถูกต้อง",
        Reviewer = reviewReq?.ReviewedBy ?? "ผู้ดูแลระบบสูงสุด (Admin)"
    });
    return Results.Ok(new { Rejected = true, SlipId = id });
});

// ==================== 9. CASE FILE REPOSITORY & COURT FORM DIRECTORY ((00)-(15)) ====================

app.MapGet("/api/files", async (int? caseId, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    if (caseId.HasValue && caseId.Value > 0)
    {
        return Results.Ok(await conn.QueryAsync<CaseFileAttachment>(
            "SELECT * FROM SL_CaseFileAttachments WHERE CaseId = @CaseId ORDER BY DirectoryIndexNo, Id DESC",
            new { CaseId = caseId.Value }));
    }
    return Results.Ok(await conn.QueryAsync<CaseFileAttachment>("SELECT * FROM SL_CaseFileAttachments ORDER BY CaseId, DirectoryIndexNo, Id DESC"));
});

app.MapPost("/api/files", async (CaseFileAttachment file, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var id = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_CaseFileAttachments (
            CaseId, DocumentId, DirectoryIndexNo, FormCode, DirectoryCategoryName,
            FileTitle, StorageType, FileStatus, FileUrlOrPath, FileDataBase64,
            MimeType, PageCount, UploadedBy, Remark
        )
        OUTPUT INSERTED.Id
        VALUES (
            @CaseId, @DocumentId, @DirectoryIndexNo, @FormCode, @DirectoryCategoryName,
            @FileTitle, @StorageType, @FileStatus, @FileUrlOrPath, @FileDataBase64,
            @MimeType, @PageCount, @UploadedBy, @Remark
        );
    ", file);
    file.Id = id;
    return Results.Ok(file);
});

app.MapPut("/api/files/{id:int}/status", async (int id, CaseFileAttachment req, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.ExecuteAsync(@"
        UPDATE SL_CaseFileAttachments SET
            FileStatus = @FileStatus,
            Remark = ISNULL(@Remark, Remark)
        WHERE Id = @Id;
    ", new { Id = id, req.FileStatus, req.Remark });
    var updated = await conn.QueryFirstOrDefaultAsync<CaseFileAttachment>("SELECT * FROM SL_CaseFileAttachments WHERE Id = @Id", new { Id = id });
    return Results.Ok(updated);
});

app.MapDelete("/api/files/{id:int}", async (int id, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.ExecuteAsync("DELETE FROM SL_CaseFileAttachments WHERE Id = @Id", new { Id = id });
    return Results.Ok(new { Deleted = true });
});

// Stream Real Sample PDFs & Official Court Form PDFs for the Popup PDF Viewer Modal
app.MapGet("/api/files/stream-sample/{key}", (string key) =>
{
    const string crimDir = @"c:\Users\Oh-z600-A\OneDrive\Desktop\คดีความ\คดีพี่โลห์\อ398-2568";
    const string uploadedDir = @"C:\Users\Oh-z600-A\.gemini\antigravity\brain\1978129b-6b9f-4075-ab4a-1c3236adc192\.user_uploaded";

    var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["crim-plaint"] = Path.Combine(crimDir, "อ398-2568.pdf"),
        ["crim-petition-answer"] = Path.Combine(crimDir, "คำร้องขอยืนคำให้การ.pdf"),
        ["crim-answer"] = Path.Combine(crimDir, "คำให้การ398-2568.pdf"),
        ["crim-witness"] = Path.Combine(crimDir, "บัญชีพยาน.pdf"),
        ["crim-closing"] = Path.Combine(crimDir, "คำแถลงปิดคดี398-2568-Full-Version-1.0.pdf"),
        ["form-00"] = Path.Combine(uploadedDir, "media_1794645669552_cf76920b.pdf"),
        ["form-01"] = Path.Combine(uploadedDir, "media_1794645669556_6a8e5206.pdf"),
        ["form-02"] = Path.Combine(uploadedDir, "media_1794645669559_d2caac10.pdf"),
        ["form-03"] = Path.Combine(uploadedDir, "media_1794645669561_a465443c.pdf"),
        ["form-04"] = Path.Combine(uploadedDir, "media_1794645669578_d2211cca.pdf"),
        ["form-05"] = Path.Combine(uploadedDir, "media_1794645669580_f6f0742e.pdf"),
        ["form-06"] = Path.Combine(uploadedDir, "media_1794645669583_42a2f8f9.pdf"),
        ["form-07"] = Path.Combine(uploadedDir, "media_1794645669588_f87fc14e.pdf"),
        ["form-08"] = Path.Combine(uploadedDir, "media_1794645669646_c722955c.pdf"),
        ["form-09"] = Path.Combine(uploadedDir, "media_1794645669646_0dbf9884.pdf"),
        ["form-10"] = Path.Combine(uploadedDir, "media_1794645669664_a456a9c1.pdf"),
        ["form-11"] = Path.Combine(uploadedDir, "media_1794645669698_50ebae47.pdf"),
        ["form-12"] = Path.Combine(uploadedDir, "media_1794645669699_f168fccc.pdf"),
        ["form-13"] = Path.Combine(uploadedDir, "media_1794645669724_e3674e03.pdf"),
        ["form-14"] = Path.Combine(uploadedDir, "media_1794645669725_b083724c.pdf")
    };

    if (map.TryGetValue(key, out var filePath) && File.Exists(filePath))
    {
        var bytes = File.ReadAllBytes(filePath);
        return Results.File(bytes, "application/pdf", enableRangeProcessing: true);
    }

    return Results.NotFound(new { message = $"ไม่พบไฟล์ตัวอย่างสำหรับรหัส {key}" });
});

// ==================== 10. LAWYER <-> CLERK MANY-TO-MANY ACCOUNT MANAGEMENT ====================
// เสมียนทนายเป็นส่วนหนึ่งของแอคเคาท์ทนาย และเสมียน 1 คนสามารถทำงานให้ทนายได้มากกว่า 1 คน ขึ้นอยู่กับที่ทนายจะตั้งเสมียนและแอดแอคเคาท์ให้

app.MapGet("/api/clerk-mappings", async (int? lawyerUserId, int? clerkUserId, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    if (lawyerUserId.HasValue && lawyerUserId.Value > 0)
    {
        return Results.Ok(await conn.QueryAsync<LawyerClerkMapping>(
            "SELECT * FROM SL_LawyerClerkMappings WHERE LawyerUserId = @LawyerUserId ORDER BY IsDefaultTypist DESC, Id",
            new { LawyerUserId = lawyerUserId.Value }));
    }
    if (clerkUserId.HasValue && clerkUserId.Value > 0)
    {
        return Results.Ok(await conn.QueryAsync<LawyerClerkMapping>(
            "SELECT * FROM SL_LawyerClerkMappings WHERE ClerkUserId = @ClerkUserId ORDER BY Id",
            new { ClerkUserId = clerkUserId.Value }));
    }
    return Results.Ok(await conn.QueryAsync<LawyerClerkMapping>("SELECT * FROM SL_LawyerClerkMappings ORDER BY LawyerUserId, Id"));
});

app.MapPost("/api/lawyers/{lawyerUserId:int}/clerks", async (int lawyerUserId, AssignClerkRequest req, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var lawyerUser = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Id = @Id", new { Id = lawyerUserId });
    if (lawyerUser == null)
    {
        return Results.BadRequest(new { message = "ไม่พบแอคเคาท์ทนายความ" });
    }

    UserAccount? clerkUser = null;
    if (req.Mode == "EXISTING" && req.ExistingClerkUserId > 0)
    {
        clerkUser = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Id = @Id", new { Id = req.ExistingClerkUserId });
        if (clerkUser == null)
        {
            return Results.BadRequest(new { message = "ไม่พบแอคเคาท์เสมียนทนายที่เลือก" });
        }
    }
    else
    {
        if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.FullName))
        {
            return Results.BadRequest(new { message = "กรุณาระบุ Username และชื่อ-นามสกุลของเสมียนทนาย" });
        }

        // ตรวจสอบว่ามี Username นี้อยู่แล้วหรือไม่ หากมีอยู่แล้วและเป็นเสมียน ให้ดึงมาผูกกับทนายคนนี้ได้ทันที (เสมียน 1 คนทำงานให้ทนายหลายคนได้)
        clerkUser = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Username = @Username", new { Username = req.Username.Trim() });
        if (clerkUser == null)
        {
            var shortName = req.FullName.Replace("นาย", "").Replace("นางสาว", "").Replace("นาง", "").Trim();
            var svgSig = $@"<svg xmlns='http://www.w3.org/2000/svg' width='280' height='80' viewBox='0 0 280 80'>
                <path d='M25,55 C55,20 75,65 105,35 C130,15 145,58 180,40 C205,28 235,48 260,32' fill='none' stroke='#334155' stroke-width='2.4' stroke-linecap='round'/>
                <path d='M45,62 Q140,48 245,56' fill='none' stroke='#334155' stroke-width='1.2' stroke-opacity='0.65' stroke-linecap='round'/>
                <text x='140' y='44' font-family='Sarabun, sans-serif' font-size='15' font-style='italic' font-weight='600' fill='#334155' text-anchor='middle'>{shortName}</text>
            </svg>";
            var sigDataUrl = "data:image/svg+xml;base64," + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(svgSig));

            var clerkProfileId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO SL_LawyerProfiles (FullName, RoleType, LicenseNo, LicenseJurisdiction, CitizenId, Race, Nationality, Occupation, Age, HouseNo, Moo, Road, SubDistrict, District, Province, PostalCode, Phone, OfficeName, SignatureDataUrl)
                OUTPUT INSERTED.Id
                VALUES (@FullName, N'เสมียนทนาย', N'-', N'-', @CitizenId, N'ไทย', N'ไทย', N'เสมียนทนาย', @Age, @HouseNo, @Moo, N'-', @SubDistrict, @District, @Province, @PostalCode, @Phone, @OfficeName, @Sig);
            ", new
            {
                req.FullName,
                CitizenId = string.IsNullOrWhiteSpace(req.CitizenId) ? "3-3301-00881-29-4" : req.CitizenId,
                Age = string.IsNullOrWhiteSpace(req.Age) ? "35" : req.Age,
                HouseNo = string.IsNullOrWhiteSpace(req.HouseNo) ? "260/17" : req.HouseNo,
                Moo = string.IsNullOrWhiteSpace(req.Moo) ? "5" : req.Moo,
                SubDistrict = string.IsNullOrWhiteSpace(req.SubDistrict) ? "หนองครก" : req.SubDistrict,
                District = string.IsNullOrWhiteSpace(req.District) ? "เมืองฯ" : req.District,
                Province = string.IsNullOrWhiteSpace(req.Province) ? "ศรีสะเกษ" : req.Province,
                PostalCode = string.IsNullOrWhiteSpace(req.PostalCode) ? "33000" : req.PostalCode,
                Phone = string.IsNullOrWhiteSpace(req.Phone) ? "-" : req.Phone,
                OfficeName = lawyerUser.OfficeName,
                Sig = sigDataUrl
            });

            await conn.ExecuteAsync(@"
                INSERT INTO SL_ElectronicSignatures (SignerName, SignerRole, LicenseOrCitizenId, SignatureType, ImageDataUrl, VerificationHash, IsDefault)
                VALUES (@FullName, N'ผู้พิมพ์ / ผู้รับมอบฉันทะ', N'เสมียนทนายความ', N'E-Signature Pad', @Sig, @Hash, 1);
            ", new
            {
                req.FullName,
                Sig = sigDataUrl,
                Hash = $"SHA256-{Guid.NewGuid().ToString("N")[..12].ToUpperInvariant()}"
            });

            var newClerkUserId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO SL_UserAccounts (Username, PasswordHash, FullName, Role, LawyerProfileId, LicenseNo, CitizenId, Phone, Email, OfficeName, PlanType, PlanName, MaxCasesQuota, UsedCasesCount, SubscriptionExpireDate, AccountStatus)
                OUTPUT INSERTED.Id
                VALUES (@Username, @PasswordHash, @FullName, N'Clerk', @ClerkProfileId, N'เสมียนทนาย', @CitizenId, @Phone, @Email, @OfficeName, N'ClerkSubAccount', N'เสมียนทนาย (ทำงานภายใต้แอคเคาท์ทนายความ)', 0, 0, DATEADD(day, 3650, SYSUTCDATETIME()), N'Active');
            ", new
            {
                Username = req.Username.Trim(),
                PasswordHash = string.IsNullOrWhiteSpace(req.PasswordHash) ? "123456" : req.PasswordHash,
                req.FullName,
                ClerkProfileId = clerkProfileId,
                CitizenId = string.IsNullOrWhiteSpace(req.CitizenId) ? "3-3301-00881-29-4" : req.CitizenId,
                Phone = string.IsNullOrWhiteSpace(req.Phone) ? "-" : req.Phone,
                Email = $"{req.Username.Trim()}@smartlaws.co.th",
                OfficeName = lawyerUser.OfficeName
            });

            clerkUser = await conn.QueryFirstOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Id = @Id", new { Id = newClerkUserId });
        }
    }

    if (clerkUser == null) return Results.BadRequest(new { message = "ไม่สามารถสร้างหรือดึงข้อมูลเสมียนทนายได้" });

    var alreadyLinked = await conn.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM SL_LawyerClerkMappings WHERE LawyerUserId = @LawyerUserId AND ClerkUserId = @ClerkUserId",
        new { LawyerUserId = lawyerUser.Id, ClerkUserId = clerkUser.Id });

    if (alreadyLinked > 0)
    {
        return Results.BadRequest(new { message = $"เสมียนทนาย {clerkUser.FullName} ถูกแต่งตั้งอยู่ในสังกัดของ {lawyerUser.FullName} แล้ว" });
    }

    if (req.IsDefaultTypist)
    {
        await conn.ExecuteAsync("UPDATE SL_LawyerClerkMappings SET IsDefaultTypist = 0 WHERE LawyerUserId = @LawyerUserId", new { LawyerUserId = lawyerUser.Id });
    }

    var mapId = await conn.ExecuteScalarAsync<int>(@"
        INSERT INTO SL_LawyerClerkMappings (LawyerUserId, LawyerFullName, ClerkUserId, ClerkProfileId, ClerkFullName, ClerkUsername, ClerkCitizenId, ClerkPhone, Permissions, IsDefaultTypist, IsActive)
        OUTPUT INSERTED.Id
        VALUES (@LawyerUserId, @LawyerFullName, @ClerkUserId, @ClerkProfileId, @ClerkFullName, @ClerkUsername, @ClerkCitizenId, @ClerkPhone, @Permissions, @IsDefaultTypist, 1);
    ", new
    {
        LawyerUserId = lawyerUser.Id,
        LawyerFullName = lawyerUser.FullName,
        ClerkUserId = clerkUser.Id,
        ClerkProfileId = clerkUser.LawyerProfileId > 0 ? clerkUser.LawyerProfileId : 3,
        ClerkFullName = clerkUser.FullName,
        ClerkUsername = clerkUser.Username,
        ClerkCitizenId = clerkUser.CitizenId,
        ClerkPhone = clerkUser.Phone,
        Permissions = string.IsNullOrWhiteSpace(req.Permissions) ? "พิมพ์คำคู่ความ, ยื่นคำร้อง/ปิดหมาย, รับมอบฉันทะ (แบบ ๑๐), จัดเก็บไฟล์สารบัญสำนวน" : req.Permissions,
        req.IsDefaultTypist
    });

    var createdMap = await conn.QueryFirstOrDefaultAsync<LawyerClerkMapping>("SELECT * FROM SL_LawyerClerkMappings WHERE Id = @Id", new { Id = mapId });
    return Results.Ok(createdMap);
});

app.MapPut("/api/clerk-mappings/{id:int}/default", async (int id, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    var m = await conn.QueryFirstOrDefaultAsync<LawyerClerkMapping>("SELECT * FROM SL_LawyerClerkMappings WHERE Id = @Id", new { Id = id });
    if (m == null) return Results.NotFound();
    await conn.ExecuteAsync("UPDATE SL_LawyerClerkMappings SET IsDefaultTypist = 0 WHERE LawyerUserId = @LawyerUserId", new { m.LawyerUserId });
    await conn.ExecuteAsync("UPDATE SL_LawyerClerkMappings SET IsDefaultTypist = 1 WHERE Id = @Id", new { Id = id });
    return Results.Ok(new { Updated = true });
});

app.MapDelete("/api/clerk-mappings/{id:int}", async (int id, DatabaseService db) =>
{
    using var conn = db.CreateConnection();
    await conn.ExecuteAsync("DELETE FROM SL_LawyerClerkMappings WHERE Id = @Id", new { Id = id });
    return Results.Ok(new { Deleted = true });
});

app.Run();
