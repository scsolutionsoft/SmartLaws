using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public sealed record ConsultationRegistration(string FullName, string Phone, string Password, int LawyerProfileId, string? Summary);
public sealed record ConsultationMessageInput(string Body);
public sealed record ConsultationStateInput(string Status);
public sealed record ConsultationConvertInput(string CaseCategory, string PartySide, string CourtName, string OpposingPartyName, string? ChargeOrCauseOfAction);
sealed class ConsultationForConversion
{
    public int ProspectUserId { get; set; }
    public int? AssignedLawyerProfileId { get; set; }
    public string Summary { get; set; } = "";
    public int? ConvertedCaseId { get; set; }
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Role { get; set; } = "";
}

public static class ConsultationPortal
{
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c = db.CreateConnection();
        await c.ExecuteAsync("""
            IF OBJECT_ID('SL_Consultations','U') IS NULL BEGIN
              CREATE TABLE SL_Consultations(
                Id int IDENTITY PRIMARY KEY,
                ProspectUserId int NOT NULL REFERENCES SL_UserAccounts(Id),
                AssignedLawyerProfileId int NULL,
                AssignedLawyerName nvarchar(200) NOT NULL DEFAULT N'',
                Summary nvarchar(2000) NOT NULL DEFAULT N'',
                Status nvarchar(30) NOT NULL DEFAULT N'New',
                ConvertedCaseId int NULL,
                CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
                UpdatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
              CREATE INDEX IX_SL_Consultations_Lawyer ON SL_Consultations(AssignedLawyerProfileId,Status,UpdatedAt DESC);
              CREATE INDEX IX_SL_Consultations_User ON SL_Consultations(ProspectUserId,CreatedAt DESC);
            END;
            IF OBJECT_ID('SL_ConsultationMessages','U') IS NULL BEGIN
              CREATE TABLE SL_ConsultationMessages(
                Id int IDENTITY PRIMARY KEY,
                ConsultationId int NOT NULL REFERENCES SL_Consultations(Id),
                SenderId int NOT NULL,
                SenderName nvarchar(200) NOT NULL DEFAULT N'',
                Body nvarchar(4000) NOT NULL,
                CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
                ReadAt datetime2 NULL);
              CREATE INDEX IX_SL_ConsultationMessages_Thread ON SL_ConsultationMessages(ConsultationId,Id);
            END;
            IF COL_LENGTH('SL_Consultations','AssignedLawyerName') IS NULL
              ALTER TABLE SL_Consultations ADD AssignedLawyerName nvarchar(200) NOT NULL CONSTRAINT DF_SL_Consultations_LawyerName DEFAULT N'';
            IF COL_LENGTH('SL_ConsultationMessages','SenderName') IS NULL
              ALTER TABLE SL_ConsultationMessages ADD SenderName nvarchar(200) NOT NULL CONSTRAINT DF_SL_ConsultationMessages_SenderName DEFAULT N'';
            UPDATE m SET SenderName=u.FullName FROM SL_ConsultationMessages m JOIN SL_UserAccounts u ON u.Id=m.SenderId WHERE m.SenderName=N'';
            UPDATE q SET AssignedLawyerName=p.FullName FROM SL_Consultations q JOIN SL_LawyerProfiles p ON p.Id=q.AssignedLawyerProfileId WHERE q.AssignedLawyerName=N'';
            DECLARE @dropConsultationFks nvarchar(max)=N'';
            SELECT @dropConsultationFks=@dropConsultationFks+N'ALTER TABLE '+QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id))+N'.'+QUOTENAME(OBJECT_NAME(fk.parent_object_id))+N' DROP CONSTRAINT '+QUOTENAME(fk.name)+N';'
            FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
            JOIN sys.columns col ON col.object_id=fkc.parent_object_id AND col.column_id=fkc.parent_column_id
            WHERE (fk.parent_object_id=OBJECT_ID('SL_Consultations') AND col.name IN('AssignedLawyerProfileId','ConvertedCaseId'))
               OR (fk.parent_object_id=OBJECT_ID('SL_ConsultationMessages') AND col.name='SenderId');
            IF @dropConsultationFks<>N'' EXEC sp_executesql @dropConsultationFks;
            ALTER TABLE SL_Consultations ALTER COLUMN AssignedLawyerProfileId int NULL;
            """);
    }

    public static void Map(RouteGroupBuilder api)
    {
        api.MapPost("/consultations/register", Register).RequireRateLimiting("auth");
        api.MapGet("/consultations/mine", MyConsultations);
        api.MapGet("/consultations", StaffConsultations);
        api.MapGet("/consultations/{id:int}/messages", ReadMessages);
        api.MapPost("/consultations/{id:int}/messages", SendMessage);
        api.MapPut("/consultations/{id:int}/status", UpdateStatus);
        api.MapPost("/consultations/{id:int}/convert", ConvertToClient);
    }

    public static async Task<IResult> Register(ConsultationRegistration r, HttpContext h, DatabaseService db)
    {
        var name = r.FullName?.Trim() ?? "";
        var phoneInput = r.Phone?.Trim() ?? "";
        var compactPhone = Regex.Replace(phoneInput, @"[\s()\-]", "");
        if (!Regex.IsMatch(compactPhone, @"^\+?[0-9๐-๙]{9,16}$"))
            return Results.BadRequest(new { message = "กรุณากรอกเบอร์โทรที่ติดต่อได้ให้ถูกต้อง" });
        var digits = ClientPortal.Digits(compactPhone).TrimStart('+');
        var phone = digits;
        var password = r.Password ?? "";
        var summary = r.Summary?.Trim() ?? "";
        if (name.Length is < 2 or > 200 || !Regex.IsMatch(digits, "^[0-9]{9,15}$") || password.Length is < 10 or > 200 || summary.Length > 2000 || r.LawyerProfileId <= 0)
            return Results.BadRequest(new { message = "กรอกชื่อ นามสกุล เบอร์โทร รหัสผ่าน และเลือกทนายให้ครบถ้วน (รหัสผ่านอย่างน้อย 10 ตัวอักษร)" });

        using var c = db.CreateConnection();
        await c.OpenAsync();
        using var tx = c.BeginTransaction(System.Data.IsolationLevel.Serializable);
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WITH(UPDLOCK,HOLDLOCK) WHERE Username=@digits OR Phone=@digits", new { digits }, tx) > 0)
            return Results.Conflict(new { message = "เบอร์โทรนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบด้วยเบอร์โทรและรหัสผ่านเดิม" });
        var lawyerName = await c.ExecuteScalarAsync<string>("SELECT p.FullName FROM SL_UserAccounts u JOIN SL_LawyerProfiles p ON p.Id=u.LawyerProfileId WHERE u.Role='Lawyer' AND u.AccountStatus='Active' AND u.LawyerProfileId=@id", new { id = r.LawyerProfileId }, tx);
        if (lawyerName == null)
            return Results.BadRequest(new { message = "ไม่พบทนายที่เลือก กรุณาเลือกทนายใหม่" });

        var userId = await c.ExecuteScalarAsync<int>("""
            INSERT INTO SL_UserAccounts(Username,PasswordHash,FullName,Role,Phone,MaxCasesQuota,AccountStatus)
            OUTPUT INSERTED.Id VALUES(@digits,@hash,@name,'Prospect',@phone,0,'Active')
            """, new { digits, hash = AccountSecurity.Hash(password), name, phone, }, tx);
        var consultationId = await c.ExecuteScalarAsync<int>("""
            INSERT INTO SL_Consultations(ProspectUserId,AssignedLawyerProfileId,AssignedLawyerName,Summary)
            OUTPUT INSERTED.Id VALUES(@userId,@profile,@lawyerName,@summary)
            """, new { userId, profile = r.LawyerProfileId, lawyerName, summary }, tx);
        if (summary.Length > 0)
            await c.ExecuteAsync("INSERT INTO SL_ConsultationMessages(ConsultationId,SenderId,SenderName,Body) VALUES(@consultationId,@userId,@name,@summary)", new { consultationId, userId, name, summary }, tx);
        tx.Commit();

        var account = await c.QuerySingleAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Id=@userId", new { userId });
        await AccountSecurity.SignIn(h, db, account);
        return Results.Ok(new { account.Id, account.Username, account.FullName, account.Role, consultationId });
    }

    public static async Task<IResult> PublicLawyers(DatabaseService db)
    {
        using var c = db.CreateConnection();
        var rows = await c.QueryAsync("""
            SELECT p.Id id,p.FullName fullName,COALESCE(NULLIF(p.OfficeName,''),u.OfficeName,'') officeName
            FROM SL_UserAccounts u JOIN SL_LawyerProfiles p ON p.Id=u.LawyerProfileId
            WHERE u.Role='Lawyer' AND u.AccountStatus='Active' ORDER BY p.FullName
            """);
        return Results.Ok(rows);
    }

    static async Task<IResult> MyConsultations(HttpContext h, DatabaseService db)
    {
        var user = AccountSecurity.User(h);
        if (user.Role is not "Prospect" and not "Client") return Results.StatusCode(403);
        using var c = db.CreateConnection();
        return Results.Ok(await c.QueryAsync("""
            SELECT q.Id,q.Summary,q.Status,q.ConvertedCaseId,q.CreatedAt,q.UpdatedAt,COALESCE(p.FullName,q.AssignedLawyerName) LawyerName,
              (SELECT COUNT(*) FROM SL_ConsultationMessages m WHERE m.ConsultationId=q.Id AND m.SenderId<>@userId AND m.ReadAt IS NULL) Unread
            FROM SL_Consultations q LEFT JOIN SL_LawyerProfiles p ON p.Id=q.AssignedLawyerProfileId
            WHERE q.ProspectUserId=@userId ORDER BY q.Id DESC
            """, new { userId = user.Id }));
    }

    static async Task<IResult> StaffConsultations(HttpContext h, DatabaseService db)
    {
        var user = AccountSecurity.User(h);
        if (user.Role is not "Lawyer" and not "Admin") return Results.StatusCode(403);
        using var c = db.CreateConnection();
        return Results.Ok(await c.QueryAsync("""
            SELECT q.Id,q.Summary,q.Status,q.ConvertedCaseId,q.CreatedAt,q.UpdatedAt,
              a.Id ProspectUserId,a.FullName,a.Phone,COALESCE(p.FullName,q.AssignedLawyerName) LawyerName,
              (SELECT COUNT(*) FROM SL_ConsultationMessages m WHERE m.ConsultationId=q.Id AND m.SenderId<>@actor AND m.ReadAt IS NULL) Unread
            FROM SL_Consultations q JOIN SL_UserAccounts a ON a.Id=q.ProspectUserId
            LEFT JOIN SL_LawyerProfiles p ON p.Id=q.AssignedLawyerProfileId
            WHERE @admin=1 OR q.AssignedLawyerProfileId=@profile OR EXISTS(
              SELECT 1 FROM SL_LawOfficeMembers m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId
              WHERE m.OfficeOwnerUserId=@actor AND m.IsActive=1 AND u.LawyerProfileId=q.AssignedLawyerProfileId)
            ORDER BY CASE q.Status WHEN N'New' THEN 0 WHEN N'Reviewing' THEN 1 ELSE 2 END,q.UpdatedAt DESC
            """, new { actor = user.Id, profile = user.LawyerProfileId, admin = user.Role == "Admin" ? 1 : 0 }));
    }

    static async Task<bool> CanAccess(int id, UserAccount user, SqlConnection c, SqlTransaction? tx = null)
    {
        if (user.Role is "Prospect" or "Client")
            return await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_Consultations WHERE Id=@id AND ProspectUserId=@userId", new { id, userId = user.Id }, tx) > 0;
        if (user.Role == "Admin") return await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_Consultations WHERE Id=@id", new { id }, tx) > 0;
        if (user.Role != "Lawyer") return false;
        return await c.ExecuteScalarAsync<int>("""
            SELECT COUNT(*) FROM SL_Consultations q WHERE q.Id=@id AND (
              q.AssignedLawyerProfileId=@profile OR EXISTS(
                SELECT 1 FROM SL_LawOfficeMembers m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId
                WHERE m.OfficeOwnerUserId=@actor AND m.IsActive=1 AND u.LawyerProfileId=q.AssignedLawyerProfileId))
            """, new { id, profile = user.LawyerProfileId, actor = user.Id }, tx) > 0;
    }

    static async Task<IResult> ReadMessages(int id, HttpContext h, DatabaseService db)
    {
        var user = AccountSecurity.User(h);
        using var c = db.CreateConnection();
        if (!await CanAccess(id, user, c)) return Results.NotFound();
        var rows = (await c.QueryAsync("""
            SELECT TOP 200 m.Id,m.SenderId,m.SenderName,m.Body,m.CreatedAt,m.ReadAt
            FROM SL_ConsultationMessages m
            WHERE m.ConsultationId=@id ORDER BY m.Id
            """, new { id })).ToList();
        await c.ExecuteAsync("UPDATE SL_ConsultationMessages SET ReadAt=SYSUTCDATETIME() WHERE ConsultationId=@id AND SenderId<>@actor AND ReadAt IS NULL", new { id, actor = user.Id });
        return Results.Ok(rows);
    }

    static async Task<IResult> SendMessage(int id, ConsultationMessageInput r, HttpContext h, DatabaseService db)
    {
        var user = AccountSecurity.User(h);
        var body = r.Body?.Trim() ?? "";
        if (body.Length is < 1 or > 4000) return Results.BadRequest(new { message = "ข้อความต้องมี 1 ถึง 4,000 ตัวอักษร" });
        using var c = db.CreateConnection();
        if (!await CanAccess(id, user, c)) return Results.NotFound();
        await c.ExecuteAsync("INSERT INTO SL_ConsultationMessages(ConsultationId,SenderId,SenderName,Body) VALUES(@id,@sender,@senderName,@body); UPDATE SL_Consultations SET UpdatedAt=SYSUTCDATETIME() WHERE Id=@id", new { id, sender = user.Id, senderName = user.FullName, body });
        return Results.Ok();
    }

    static async Task<IResult> UpdateStatus(int id, ConsultationStateInput r, HttpContext h, DatabaseService db)
    {
        var user = AccountSecurity.User(h);
        if (user.Role is not "Lawyer" and not "Admin") return Results.StatusCode(403);
        if (r.Status is not "Reviewing" and not "Closed") return Results.BadRequest();
        using var c = db.CreateConnection();
        if (!await CanAccess(id, user, c)) return Results.NotFound();
        await c.ExecuteAsync("UPDATE SL_Consultations SET Status=@status,UpdatedAt=SYSUTCDATETIME() WHERE Id=@id AND ConvertedCaseId IS NULL", new { id, status = r.Status });
        return Results.Ok();
    }

    static async Task<IResult> ConvertToClient(int id, ConsultationConvertInput r, HttpContext h, DatabaseService db)
    {
        var actor = AccountSecurity.User(h);
        if (actor.Role is not "Lawyer" and not "Admin") return Results.StatusCode(403);
        var side = r.PartySide switch { "Plaintiff" => CaseParties.Sides[0], "Defendant" => CaseParties.Sides[1], _ => "" };
        var category = r.CaseCategory switch { "civil" => "แพ่ง", "criminal" => "อาญา", _ => "" };
        var court = r.CourtName?.Trim() ?? "";
        var opponent = r.OpposingPartyName?.Trim() ?? "";
        var cause = r.ChargeOrCauseOfAction?.Trim() ?? "";
        if (side.Length == 0 || category.Length == 0 || court.Length is < 2 or > 200 || opponent.Length is < 2 or > 250 || cause.Length > 500)
            return Results.BadRequest(new { message = "กรอกประเภทคดี ฝ่ายที่รับว่าความ ศาล และชื่อคู่กรณีให้ครบ" });

        using var c = db.CreateConnection();
        await c.OpenAsync();
        using var tx = c.BeginTransaction(System.Data.IsolationLevel.Serializable);
        var q = await c.QuerySingleOrDefaultAsync<ConsultationForConversion>("""
            SELECT q.Id,q.ProspectUserId,q.AssignedLawyerProfileId,q.Summary,q.ConvertedCaseId,
              u.FullName,u.Phone,u.Role
            FROM SL_Consultations q WITH(UPDLOCK,HOLDLOCK) JOIN SL_UserAccounts u ON u.Id=q.ProspectUserId
            WHERE q.Id=@id
            """, new { id }, tx);
        if (q == null || !await CanAccess(id, actor, c, tx)) return Results.NotFound();
        if (q.ConvertedCaseId.HasValue) return Results.Conflict(new { message = "คำปรึกษานี้เปิดเป็นสำนวนแล้ว", caseId = q.ConvertedCaseId.Value });
        if (!q.AssignedLawyerProfileId.HasValue) return Results.Conflict(new { message = "ยังไม่มีทนายรับผิดชอบคำปรึกษานี้" });
        if (actor.Role == "Lawyer" && actor.LawyerProfileId != q.AssignedLawyerProfileId.Value &&
            await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawOfficeMembers m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId WHERE m.OfficeOwnerUserId=@actor AND u.LawyerProfileId=@profile AND m.IsActive=1", new { actor = actor.Id, profile = q.AssignedLawyerProfileId.Value }, tx) == 0)
            return Results.NotFound();
        if (q.Role != "Prospect") return Results.Conflict(new { message = "บัญชีนี้ไม่ใช่ผู้ขอคำปรึกษาแล้ว" });

        var lawyer = q.AssignedLawyerProfileId.Value;
        var lawyerUser = await c.QuerySingleOrDefaultAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Role='Lawyer' AND LawyerProfileId=@lawyer AND AccountStatus='Active'", new { lawyer }, tx);
        if (lawyerUser == null) return Results.Conflict(new { message = "ไม่พบทนายผู้รับผิดชอบที่ยังใช้งานอยู่" });
        var officeOwnerId = await c.ExecuteScalarAsync<int?>("SELECT OfficeOwnerUserId FROM SL_LawOfficeMembers WHERE LawyerUserId=@id AND IsActive=1", new { id = lawyerUser.Id }, tx);
        var billingUser = officeOwnerId.HasValue
            ? await c.QuerySingleAsync<UserAccount>("SELECT * FROM SL_UserAccounts WHERE Id=@id", new { id = officeOwnerId.Value }, tx)
            : lawyerUser;
        if (billingUser.UsedCasesCount >= billingUser.MaxCasesQuota) return Results.Conflict(new { quotaExceeded = true, message = "โควตาสำนวนของสำนักงานเต็มแล้ว จึงยังเปิดสำนวนลูกความไม่ได้" });

        var prospectName = q.FullName;
        var plaintiff = side == CaseParties.Sides[0] ? prospectName : opponent;
        var defendant = side == CaseParties.Sides[1] ? prospectName : opponent;
        var lawyerRole = "ทนาย" + side;
        var blackCase = "CONS-" + DateTime.UtcNow.ToString("yyMMddHHmmss") + "-" + id;
        var caseId = await c.ExecuteScalarAsync<int>("""
            INSERT INTO SL_LawCases(CaseCode,CourtName,CaseCategory,LawyerRole,PlaintiffName,DefendantName,
              ChargeOrCauseOfAction,PrimaryLawyerId,ClerkId,CaseSummary,Status)
            OUTPUT INSERTED.Id VALUES(@code,@court,@category,@lawyerRole,@plaintiff,@defendant,
              @cause,@lawyer,3,@summary,N'กำลังดำเนินการ')
            """, new { code = blackCase, court, category, lawyerRole, plaintiff, defendant, cause, lawyer, summary = (string)q.Summary }, tx);
        var clientParty = new CaseParty { CaseId = caseId, PartySide = side, PartyOrder = 1, FullName = prospectName, Phone = (string?)q.Phone ?? "", IsOurClient = true };
        var opponentParty = new CaseParty { CaseId = caseId, PartySide = side == CaseParties.Sides[0] ? CaseParties.Sides[1] : CaseParties.Sides[0], PartyOrder = 1, FullName = opponent, IsOurClient = false };
        clientParty.Id = await CaseParties.Insert(c, tx, clientParty);
        opponentParty.Id = await CaseParties.Insert(c, tx, opponentParty);
        await CaseParties.Sync(c, tx, caseId);
        var prospectId = q.ProspectUserId;
        await c.ExecuteAsync("IF EXISTS(SELECT 1 FROM SL_ClientIdentities WHERE UserId=@prospectId) UPDATE SL_ClientIdentities SET MustChangePassword=0 WHERE UserId=@prospectId ELSE INSERT INTO SL_ClientIdentities(UserId,MustChangePassword) VALUES(@prospectId,0); INSERT INTO SL_ClientCaseLinks(UserId,CaseId,PartyId) VALUES(@prospectId,@caseId,@partyId); UPDATE SL_UserAccounts SET Role='Client' WHERE Id=@prospectId; UPDATE SL_UserAccounts SET UsedCasesCount=UsedCasesCount+1 WHERE Id=@billingUserId", new { prospectId, caseId, partyId = clientParty.Id, billingUserId = billingUser.Id }, tx);
        if (officeOwnerId.HasValue)
            await c.ExecuteAsync("INSERT INTO SL_OfficeCaseAssignments(CaseId,OfficeOwnerUserId,LawyerUserId,AssignedByUserId) VALUES(@caseId,@owner,@member,@actor)", new { caseId, owner = officeOwnerId.Value, member = lawyerUser.Id, actor = actor.Role == "Admin" ? officeOwnerId.Value : actor.Id }, tx);
        await c.ExecuteAsync("UPDATE SL_Consultations SET Status=N'Converted',ConvertedCaseId=@caseId,UpdatedAt=SYSUTCDATETIME() WHERE Id=@id; INSERT INTO SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'CONSULTATION_CONVERT',@resource)", new { id, caseId, actor = actor.Id, resource = $"consultation:{id}; case:{caseId}; prospect:{prospectId}" }, tx);
        tx.Commit();
        return Results.Ok(new { caseId, caseCode = blackCase });
    }
}
