using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public static class AccountSecurity
{
    public static string Hash(string password) => new PasswordHasher<UserAccount>().HashPassword(new(), password);
    public static bool Verify(UserAccount user, string password)
    {
        if (string.IsNullOrEmpty(password)) return false;
        if (!user.PasswordHash.StartsWith("AQAAAA"))
            return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(user.PasswordHash), System.Text.Encoding.UTF8.GetBytes(password));
        try { return new PasswordHasher<UserAccount>().VerifyHashedPassword(user, user.PasswordHash, password) != PasswordVerificationResult.Failed; }
        catch (FormatException) { return false; }
    }
    public static UserAccount User(HttpContext http) => (UserAccount)http.Items["account"]!;
    public static async Task SignIn(HttpContext http, DatabaseService db, UserAccount user)
    {
        using var conn = db.CreateConnection();
        var sid = Guid.NewGuid().ToString("N");
        await conn.ExecuteAsync("INSERT INTO SL_Sessions (Id, UserId, ExpiresAt) VALUES (@sid,@Id,DATEADD(hour,8,SYSUTCDATETIME()))", new { sid, user.Id });
        await conn.ExecuteAsync("INSERT INTO SL_AuditLog(UserId,Action,Resource) VALUES(@Id,'LOGIN','/api/auth/login')", user);
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Role, user.Role), new Claim("sid", sid) };
        await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    }
}

// Every API endpoint passes this filter; UI visibility is never an authorization boundary.
public class AccessControl(DatabaseService db) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var http = ctx.HttpContext;
        var path = http.Request.Path.Value!.ToLowerInvariant();
        var write = !HttpMethods.IsGet(http.Request.Method);
        if (write && http.Request.Headers.Origin.FirstOrDefault() is { } origin &&
            (!Uri.TryCreate(origin, UriKind.Absolute, out var originUri) || originUri.Authority != http.Request.Host.Value))
            return Results.StatusCode(403);
        if (path is "/api/auth/login" or "/api/auth/register") return await next(ctx);
        using var conn = db.CreateConnection();
        var user = await conn.QuerySingleOrDefaultAsync<UserAccount>("""
            SELECT u.* FROM SL_UserAccounts u JOIN SL_Sessions s ON s.UserId=u.Id
            WHERE s.Id=@sid AND s.ExpiresAt>SYSUTCDATETIME() AND u.AccountStatus=N'Active'
            """, new { sid = http.User.FindFirstValue("sid") ?? "" });
        if (user == null) return Results.Unauthorized();
        http.Items["account"] = user;
        bool admin = user.Role == "Admin", lawyer = user.Role == "Lawyer", clerk = user.Role == "Clerk";
        if (!admin && !lawyer && !clerk) return Results.StatusCode(403);
        var mappings = (await conn.QueryAsync<LawyerClerkMapping>("SELECT * FROM SL_LawyerClerkMappings WHERE IsActive=1 AND (LawyerUserId=@Id OR ClerkUserId=@Id)", user)).ToList();
        var cases = admin ? new List<LawCase>() : (await conn.QueryAsync<LawCase>("""
            SELECT c.* FROM SL_LawCases c WHERE
            (@Role='Lawyer' AND c.PrimaryLawyerId=@LawyerProfileId) OR
            (@Role='Clerk' AND c.ClerkId=@LawyerProfileId AND EXISTS
              (SELECT 1 FROM SL_LawyerClerkMappings m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId
               WHERE m.ClerkUserId=@Id AND m.IsActive=1 AND u.LawyerProfileId=c.PrimaryLawyerId))
            """, user)).ToList();
        var caseIds = cases.Select(c => c.Id).ToHashSet();
        http.Items["caseIds"] = caseIds;
        http.Items["visibleCases"] = cases;
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var area = parts.Length > 1 ? parts[1] : "";
        int routeId = int.TryParse(parts.ElementAtOrDefault(2), out var rid) ? rid : 0;
        if (area == "admin" && !admin) return Results.StatusCode(403);
        if (admin && new[] { "cases", "documents", "files", "parties", "litigation", "signatures", "lawyers", "clerk-mappings" }.Contains(area)) return Results.StatusCode(403);
        if (area == "templates" && write && !admin) return Results.StatusCode(403);
        if (area == "cases")
        {
            if (routeId > 0 && !caseIds.Contains(routeId)) return Results.NotFound();
            if (write && !lawyer) return Results.StatusCode(403);
        }
        if (area is "documents" or "files" or "litigation")
        {
            if (routeId > 0)
            {
                var table = area == "documents" ? "SL_CaseDocuments" : area == "files" ? "SL_CaseFileAttachments" : "SL_LitigationEvents";
                var cid = await conn.ExecuteScalarAsync<int>($"SELECT CaseId FROM {table} WHERE Id=@routeId", new { routeId });
                if (!caseIds.Contains(cid)) return Results.NotFound();
                if (area == "files" && HttpMethods.IsDelete(http.Request.Method) && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_AppointmentFiles WHERE FileId=@routeId",new{routeId})>0)
                    return Results.Conflict(new {message="ไฟล์นี้เชื่อมกับวันนัด กรุณายกเลิกการเชื่อมในวันนัดก่อนลบ"});
                if (area == "documents" && write && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseFileAttachments f JOIN SL_AppointmentFiles l ON l.FileId=f.Id WHERE f.DocumentId=@routeId",new{routeId})>0
                    && (HttpMethods.IsDelete(http.Request.Method) || ctx.Arguments.OfType<CaseDocument>().Any(d=>d.CaseId!=cid)))
                    return Results.Conflict(new {message="เอกสารนี้เชื่อมกับวันนัด จึงยังลบหรือย้ายคดีไม่ได้"});
                if (clerk && area == "documents" && write && await conn.ExecuteScalarAsync<string>("SELECT Status FROM SL_CaseDocuments WHERE Id=@routeId", new { routeId }) != "ร่าง")
                    return Results.StatusCode(403);
                if (area == "files" && HttpMethods.IsDelete(http.Request.Method) && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LitigationEvents WHERE AttachmentId=@routeId", new { routeId }) > 0)
                    return Results.Conflict(new { message = "ไฟล์นี้เป็นหลักฐานอ้างอิงในขั้นตอนคดี จึงยังลบไม่ได้" });
            }
            if (int.TryParse(http.Request.Query["caseId"], out var queryCase) && !caseIds.Contains(queryCase)) return Results.NotFound();
            if (area == "files" && path.Contains("stream-sample")) return Results.NotFound();
            if (clerk && (HttpMethods.IsDelete(http.Request.Method) || area == "litigation" && write)) return Results.StatusCode(403);
        }
        if (area == "lawyers" && write)
        {
            if (!lawyer || (path.EndsWith("/clerks") ? routeId != user.Id : routeId != user.LawyerProfileId)) return Results.StatusCode(403);
        }
        if (area == "clerk-mappings" && write && (!lawyer || !mappings.Any(m => m.Id == routeId && m.LawyerUserId == user.Id))) return Results.StatusCode(403);
        if (area == "signatures" && write)
        {
            if (!lawyer) return Results.StatusCode(403);
            if (routeId > 0 && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ElectronicSignatures WHERE Id=@routeId AND SignerName=@FullName", new { routeId, user.FullName }) == 0) return Results.NotFound();
        }
        foreach (var arg in ctx.Arguments)
        {
            int cid = arg switch { CaseDocument d => d.CaseId, CaseParty p => p.CaseId, CaseFileAttachment f => f.CaseId, LitigationEvent e => e.CaseId, _ => 0 };
            if (cid > 0 && !caseIds.Contains(cid)) return Results.NotFound();
            if (arg is CaseDocument or CaseParty or LitigationEvent && cid <= 0) return Results.BadRequest(new { message = "กรุณาเลือกสำนวนคดี" });
            if (arg is LawCase lc)
            {
                if (HttpMethods.IsPost(http.Request.Method) && (string.IsNullOrWhiteSpace(lc.CourtName) || string.IsNullOrWhiteSpace(lc.PlaintiffName) || string.IsNullOrWhiteSpace(lc.DefendantName))) return Results.BadRequest(new { message = "กรุณาระบุศาลและคู่ความ" });
                lc.PrimaryLawyerId = user.LawyerProfileId;
                if (lc.ClerkId > 0 && !mappings.Any(m => m.ClerkProfileId == lc.ClerkId && m.LawyerUserId == user.Id)) return Results.BadRequest(new { message = "เสมียนไม่ได้อยู่ในสังกัด" });
            }
            if (arg is ElectronicSignature sig) { sig.SignerName = user.FullName; sig.IsDefault = false; }
            if (arg is CaseDocument draft && clerk)
            {
                draft.Status = "ร่าง";
                draft.SignatureImageBase64 = ""; draft.DrafterSignatureBase64 = ""; draft.TypistSignatureBase64 = "";
            }
            if (arg is PaymentSlip slip && !admin)
            {
                if (!lawyer) return Results.StatusCode(403);
                var plan = await conn.QuerySingleOrDefaultAsync<SubscriptionPlan>("SELECT * FROM SL_SubscriptionPlans WHERE Id=@PlanId AND IsActive=1", slip);
                if (plan == null || slip.AmountBaht < 0) return Results.BadRequest(new { message = "กรุณาเลือกแพ็กเกจที่เปิดใช้งานและตรวจสอบยอดเงิน" });
                slip.UserId = user.Id; slip.UserFullName = user.FullName; slip.Status = "รอตรวจสอบ"; slip.ReviewedBy = ""; slip.AdminRemark = "";
                slip.PlanName = plan.PlanName; slip.PlanCategory = plan.PlanCategory; slip.CasesQuotaRequested = plan.CasesQuotaIncluded;
            }
            if (arg is SubscriptionPlan package && (package.PriceBaht < 0 || package.CasesQuotaIncluded < 0 || package.DurationDays < 0 || string.IsNullOrWhiteSpace(package.PlanName)))
                return Results.BadRequest(new { message = "ชื่อแพ็กเกจ ราคา โควต้า หรือระยะเวลาไม่ถูกต้อง" });
            if (arg is AssignClerkRequest assignment)
            {
                if (assignment.Mode != "EXISTING" && assignment.PasswordHash.Length < 10) return Results.BadRequest(new { message = "รหัสผ่านเสมียนต้องมีอย่างน้อย 10 ตัวอักษร" });
                if (assignment.Mode == "EXISTING" && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Id=@Id AND Role='Clerk' AND AccountStatus='Active'", new { Id = assignment.ExistingClerkUserId }) == 0) return Results.BadRequest(new { message = "ต้องเลือกบัญชีเสมียนที่ใช้งานอยู่" });
            }
            if (arg is UserAccount update && area == "admin")
            {
                if (!new[] { "Admin", "Lawyer", "Clerk" }.Contains(update.Role) || !new[] { "Active", "Suspended" }.Contains(update.AccountStatus) || update.MaxCasesQuota < 0 || update.UsedCasesCount < 0)
                    return Results.BadRequest(new { message = "บทบาท สถานะ หรือโควต้าไม่ถูกต้อง" });
                var targetId = int.TryParse(parts.ElementAtOrDefault(3), out var target) ? target : 0;
                if (targetId == user.Id && (update.Role != "Admin" || update.AccountStatus != "Active")) return Results.BadRequest(new { message = "ไม่สามารถระงับหรือลดสิทธิ์ผู้ดูแลที่กำลังใช้งานได้" });
            }
            if (arg is CaseFileAttachment file && HttpMethods.IsPost(http.Request.Method))
            {
                if (!string.IsNullOrEmpty(file.CourtLevel) &&
                    (!new[] { "ศาลชั้นต้น", "ศาลอุทธรณ์", "ศาลฎีกา" }.Contains(file.CourtLevel)
                    || file.StorageType != "PDF" || file.MimeType != "application/pdf"
                    || string.IsNullOrWhiteSpace(file.JudgmentBlackCaseNo) || string.IsNullOrWhiteSpace(file.JudgmentRedCaseNo)
                    || file.JudgmentBlackCaseNo.Length > 150 || file.JudgmentRedCaseNo.Length > 150 || file.JudgmentDate == null))
                    return Results.BadRequest(new { message = "ระบุชั้นศาล เลขคดีดำ เลขคดีแดง วันที่คำพิพากษา และไฟล์ PDF ให้ครบ" });
                if (cid <= 0 || string.IsNullOrWhiteSpace(file.FileTitle)) return Results.BadRequest(new { message = "กรุณาระบุคดีและชื่อไฟล์" });
                if (!new[] { "PDF", "IMAGE", "LINK", "COURT_FORM" }.Contains(file.StorageType) || file.PageCount < 1) return Results.BadRequest(new { message = "ประเภทไฟล์หรือจำนวนหน้าไม่ถูกต้อง" });
                if (file.StorageType is "PDF" or "IMAGE" && string.IsNullOrWhiteSpace(file.FileDataBase64)) return Results.BadRequest(new { message = "กรุณาเลือกไฟล์ก่อนบันทึก" });
                if (file.DocumentId is > 0 && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseDocuments WHERE Id=@DocumentId AND CaseId=@CaseId", file) == 0) return Results.BadRequest();
                file.UploadedBy = user.FullName;
                if (file.StorageType == "LINK" && (!Uri.TryCreate(file.FileUrlOrPath, UriKind.Absolute, out var link) || link.Scheme != "https")) return Results.BadRequest(new { message = "ลิงก์ต้องเป็น HTTPS" });
                if (!string.IsNullOrEmpty(file.FileDataBase64))
                {
                    try
                    {
                        var raw = file.FileDataBase64.Contains(',') ? file.FileDataBase64.Split(',', 2)[1] : file.FileDataBase64;
                        var bytes = Convert.FromBase64String(raw);
                        bool valid = file.MimeType switch { "application/pdf" => bytes.AsSpan().StartsWith("%PDF-"u8), "image/png" => bytes.AsSpan().StartsWith(new byte[] {137,80,78,71,13,10,26,10}), "image/jpeg" => bytes.AsSpan().StartsWith(new byte[] {255,216,255}), _ => false };
                        if (!valid || bytes.Length > 10 * 1024 * 1024) return Results.BadRequest(new { message = "รองรับ PDF, PNG, JPEG ขนาดไม่เกิน 10 MB" });
                        file.FileDataBase64 = $"data:{file.MimeType};base64,{Convert.ToBase64String(bytes)}";
                    }
                    catch (FormatException) { return Results.BadRequest(new { message = "ข้อมูลไฟล์ไม่ถูกต้อง" }); }
                }
            }
        }
        var result = await next(ctx);
        if (write && http.Response.StatusCode < 400 && (result is not IStatusCodeHttpResult status || status.StatusCode is null or < 400))
            await conn.ExecuteAsync("INSERT INTO SL_AuditLog (UserId, Action, Resource) VALUES (@Id,@Action,@Resource)", new { user.Id, Action = http.Request.Method, Resource = path });
        if (result is not IValueHttpResult value || value.Value == null) return result;
        var json = JsonSerializer.SerializeToNode(value.Value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var relatedUserIds = mappings.SelectMany(m => new[] { m.LawyerUserId, m.ClerkUserId }).Append(user.Id).ToHashSet();
        var profileIds = cases.Select(c => c.PrimaryLawyerId).Concat(cases.Select(c => c.ClerkId)).Append(user.LawyerProfileId).Concat(mappings.Select(m => m.ClerkProfileId)).ToHashSet();
        bool Allowed(JsonNode? node, string key)
        {
            int Id(string name) => node?[name]?.GetValue<int>() ?? 0;
            return key switch
            {
                "cases" => caseIds.Contains(Id("id")),
                "documents" or "recentDocuments" or "caseFiles" or "files" or "litigation" => caseIds.Contains(Id("caseId")),
                "users" => admin || relatedUserIds.Contains(Id("id")),
                "lawyers" => !admin && Id("id")==user.LawyerProfileId,
                "signatures" => !admin && node?["signerName"]?.GetValue<string>() == user.FullName,
                "paymentSlips" or "slips" => admin || Id("userId") == user.Id,
                "clerkMappings" or "clerk-mappings" => !admin && (Id("lawyerUserId") == user.Id || Id("clerkUserId") == user.Id),
                _ => true
            };
        }
        void Clean(JsonNode? node, string key)
        {
            if (node is JsonArray array)
            {
                for (int i = array.Count - 1; i >= 0; i--) { if (!Allowed(array[i], key)) array.RemoveAt(i); else Clean(array[i], key); }
            }
            else if (node is JsonObject obj)
            {
                obj.Remove("passwordHash");
                foreach (var property in obj.ToList()) Clean(property.Value, property.Key);
            }
        }
        Clean(json, area == "payments" ? "slips" : area);
        if (area == "dashboard" && json is JsonObject dashboard)
        {
            dashboard["totalCases"] = cases.Count;
            dashboard["criminalCases"] = cases.Count(c => c.CaseCategory == "อาญา");
            dashboard["civilCases"] = cases.Count(c => c.CaseCategory == "แพ่ง");
            dashboard["totalClaimAmount"] = cases.Sum(c => c.ClaimAmount);
            dashboard["totalDocuments"] = (dashboard["recentDocuments"] as JsonArray)?.Count ?? 0;
            dashboard.Remove("plaintiffLawyerCases"); dashboard.Remove("defendantLawyerCases");
        }
        return Results.Json(json, statusCode: (result as IStatusCodeHttpResult)?.StatusCode ?? 200);
    }
}
