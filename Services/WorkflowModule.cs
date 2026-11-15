using Dapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Security.Claims;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public class LoginRequest { public string Username { get; set; } = ""; public string Password { get; set; } = ""; }
public class PasswordChange { public string CurrentPassword { get; set; } = ""; public string NewPassword { get; set; } = ""; }
public class AdminPasswordReset { public string NewPassword { get; set; } = ""; }
public class WorkflowStatus { public string Status { get; set; } = ""; }
public class LitigationEvent
{
    public int Id { get; set; }
    public int CaseId { get; set; }
    public string Stage { get; set; } = "คำพิพากษา";
    public string CourtLevel { get; set; } = "ศาลชั้นต้น";
    public string CourtName { get; set; } = "";
    public string ReferenceNo { get; set; } = "";
    public DateTime EventDate { get; set; } = DateTime.Today;
    public DateTime? Deadline { get; set; }
    public string DeadlineBasis { get; set; } = "";
    public string Summary { get; set; } = "";
    public string Outcome { get; set; } = "";
    public string Status { get; set; } = "ร่าง";
    public int? AttachmentId { get; set; }
    public int CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
}

public static class WorkflowModule
{
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync("""
            IF COL_LENGTH('SL_CaseFileAttachments','CourtLevel') IS NULL BEGIN
            ALTER TABLE SL_CaseFileAttachments ADD CourtLevel nvarchar(100) NOT NULL DEFAULT N'',
                JudgmentBlackCaseNo nvarchar(150) NOT NULL DEFAULT N'',
                JudgmentRedCaseNo nvarchar(150) NOT NULL DEFAULT N'', JudgmentDate date NULL;
            END;
            IF OBJECT_ID('SL_Sessions') IS NULL CREATE TABLE SL_Sessions
            (Id varchar(32) PRIMARY KEY, UserId int NOT NULL, ExpiresAt datetime2 NOT NULL);
            IF OBJECT_ID('SL_AuditLog') IS NULL CREATE TABLE SL_AuditLog
            (Id bigint IDENTITY PRIMARY KEY, UserId int NOT NULL, Action nvarchar(30) NOT NULL,
             Resource nvarchar(300) NOT NULL, CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
            IF OBJECT_ID('SL_LitigationEvents') IS NULL BEGIN
            CREATE TABLE SL_LitigationEvents
            (Id int IDENTITY PRIMARY KEY, CaseId int NOT NULL REFERENCES SL_LawCases(Id),
             Stage nvarchar(100) NOT NULL, CourtLevel nvarchar(100) NOT NULL, CourtName nvarchar(200) NOT NULL,
             ReferenceNo nvarchar(150) NOT NULL, EventDate date NOT NULL, Deadline date NULL,
             DeadlineBasis nvarchar(1000) NOT NULL, Summary nvarchar(max) NOT NULL, Outcome nvarchar(2000) NOT NULL,
             Status nvarchar(100) NOT NULL, AttachmentId int NULL, CreatedBy int NOT NULL,
             CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
            CREATE INDEX IX_Litigation_Case ON SL_LitigationEvents(CaseId,EventDate);
            END;
            DELETE FROM SL_Sessions WHERE ExpiresAt<SYSUTCDATETIME();
            """);
        var names = new[] { "คำพิพากษา", "อุทธรณ์", "ท้ายอุทธรณ์", "คำแก้อุทธรณ์", "ท้ายคำแก้อุทธรณ์", "ฎีกา", "ท้ายฎีกา", "คำแก้ฎีกา", "ท้ายคำแก้ฎีกา" };
        for (int i = 0; i < names.Length; i++)
        {
            var code = "(" + string.Concat((31 + i).ToString().Select(c => "๐๑๒๓๔๕๖๗๘๙"[c - '0'])) + ")";
            await conn.ExecuteAsync("""
                IF NOT EXISTS(SELECT 1 FROM SL_CourtFormTemplates WHERE FormCode=@code)
                INSERT INTO SL_CourtFormTemplates(FormCode,FormName,Category,ApplicableRole,ProceduralLawRef,LayoutType,DefaultHeaderTitle,DefaultPreambleTemplate,DefaultClausesJson,DefaultClosingText,SourceWordFileName,Description)
                VALUES(@code,@name,N'ทั้งสองประเภท',N'ทุกฝ่าย',N'ตรวจสอบสิทธิและเงื่อนไขตามประเภทคดี',N'GarudaStandard',@name,N'',N'[]',N'ควรมิควรแล้วแต่จะโปรด',N'',N'แม่แบบร่างสำหรับตรวจทานกับต้นฉบับ https://www.lawyerscouncil.or.th/court-forms ก่อนยื่น')
                """, new { code, name = names[i] });
        }
    }
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/auth/me", (HttpContext http) => Results.Ok(AccountSecurity.User(http)));
        api.MapPost("/auth/logout", async (HttpContext http, DatabaseService db) =>
        {
            using var conn = db.CreateConnection();
            await conn.ExecuteAsync("DELETE FROM SL_Sessions WHERE Id=@sid", new { sid = http.User.FindFirstValue("sid") });
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok(new { message = "ออกจากระบบแล้ว" });
        });
        api.MapPost("/auth/password", async (PasswordChange request, HttpContext http, DatabaseService db) =>
        {
            var user = AccountSecurity.User(http);
            if (!AccountSecurity.Verify(user, request.CurrentPassword) || request.NewPassword.Length < 10)
                return Results.BadRequest(new { message = "ตรวจสอบรหัสผ่านเดิม และใช้รหัสผ่านใหม่อย่างน้อย 10 ตัวอักษร" });
            using var conn = db.CreateConnection();
            await conn.ExecuteAsync("UPDATE SL_UserAccounts SET PasswordHash=@Hash WHERE Id=@Id; DELETE FROM SL_Sessions WHERE UserId=@Id;", new { user.Id, Hash = AccountSecurity.Hash(request.NewPassword) });
            await http.SignOutAsync();
            return Results.Ok(new { message = "เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบอีกครั้ง" });
        });
        api.MapGet("/admin/audit", async (DatabaseService db) =>
        {
            using var conn = db.CreateConnection();
            return Results.Ok(await conn.QueryAsync("SELECT TOP 100 a.Id AS id,a.UserId AS userId,u.FullName AS fullName,a.Action AS action,a.Resource AS resource,a.CreatedAt AS createdAt FROM SL_AuditLog a LEFT JOIN SL_UserAccounts u ON u.Id=a.UserId ORDER BY a.Id DESC"));
        });
        api.MapPost("/admin/users/{id:int}/password", async (int id, AdminPasswordReset request, DatabaseService db) =>
        {
            if (request.NewPassword.Length < 10) return Results.BadRequest(new { message = "รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร" });
            using var conn = db.CreateConnection();
            var changed = await conn.ExecuteAsync("UPDATE SL_UserAccounts SET PasswordHash=@Hash WHERE Id=@id; DELETE FROM SL_Sessions WHERE UserId=@id", new { id, Hash = AccountSecurity.Hash(request.NewPassword) });
            return changed > 0 ? Results.Ok(new { message = "เปลี่ยนรหัสผ่านและปิดเซสชันเดิมแล้ว" }) : Results.NotFound();
        });
        api.MapPut("/litigation/{id:int}/status", async (int id, WorkflowStatus request, DatabaseService db) =>
        {
            if (request.Status != "เสร็จสิ้น") return Results.BadRequest();
            using var conn = db.CreateConnection();
            await conn.ExecuteAsync("UPDATE SL_LitigationEvents SET Status=@Status WHERE Id=@id", new { id, request.Status });
            return Results.Ok(new { message = "ปิดงานติดตามแล้ว" });
        });
        api.MapGet("/litigation", async (int? caseId, HttpContext http, DatabaseService db) =>
        {
            using var conn = db.CreateConnection();
            var parameters=new DynamicParameters(AccountSecurity.User(http)); parameters.Add("caseId",caseId);
            return Results.Ok(await conn.QueryAsync<LitigationEvent>($"SELECT * FROM SL_LitigationEvents WHERE CaseId IN ({CapacitySupport.CaseScope}) AND (@caseId IS NULL OR CaseId=@caseId) ORDER BY EventDate DESC,Id DESC", parameters));
        });
        api.MapPost("/litigation", async (LitigationEvent entry, HttpContext http, DatabaseService db) =>
        {
            if (!new[] { "คำพิพากษา", "อุทธรณ์", "คำแก้อุทธรณ์", "ฎีกา", "คำแก้ฎีกา", "ขออนุญาตฎีกา", "ขยายระยะเวลา", "ทุเลาการบังคับ", "บังคับคดี", "คดีถึงที่สุด" }.Contains(entry.Stage)
                || string.IsNullOrWhiteSpace(entry.Summary) || string.IsNullOrWhiteSpace(entry.CourtName)
                || !new[] { "ร่าง", "รอตรวจทาน", "ยื่นแล้ว", "ศาลรับแล้ว", "มีคำสั่งแล้ว", "เสร็จสิ้น" }.Contains(entry.Status)
                || entry.Deadline.HasValue && string.IsNullOrWhiteSpace(entry.DeadlineBasis))
                return Results.BadRequest(new { message = "กรอกศาล รายละเอียด สถานะ และที่มาของกำหนดเวลาให้ครบ" });
            using var conn = db.CreateConnection();
            await conn.OpenAsync();
            using var tx = conn.BeginTransaction();
            if (entry.AttachmentId is > 0 && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseFileAttachments WHERE Id=@AttachmentId AND CaseId=@CaseId", entry, tx) == 0)
                return Results.BadRequest(new { message = "เอกสารแนบต้องอยู่ในสำนวนเดียวกัน" });
            entry.CreatedBy = AccountSecurity.User(http).Id;
            entry.Id = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO SL_LitigationEvents(CaseId,Stage,CourtLevel,CourtName,ReferenceNo,EventDate,Deadline,DeadlineBasis,Summary,Outcome,Status,AttachmentId,CreatedBy)
                OUTPUT INSERTED.Id VALUES(@CaseId,@Stage,@CourtLevel,@CourtName,@ReferenceNo,@EventDate,@Deadline,@DeadlineBasis,@Summary,@Outcome,@Status,@AttachmentId,@CreatedBy)
                """, entry, tx);
            // Drafts and historical entries must not accidentally advance the case.
            if (entry.Status is "ยื่นแล้ว" or "ศาลรับแล้ว" or "มีคำสั่งแล้ว" or "เสร็จสิ้น")
                await conn.ExecuteAsync("""
                    UPDATE SL_LawCases SET CurrentProceduralStage=@Stage, UpdatedAt=SYSUTCDATETIME()
                    WHERE Id=@CaseId AND NOT EXISTS(SELECT 1 FROM SL_LitigationEvents WHERE CaseId=@CaseId AND EventDate>@EventDate)
                    """, entry, tx);
            tx.Commit();
            return Results.Ok(entry);
        });
    }
}
