using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Authentication;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public class CredentialUpdate
{
    public string Username { get; set; } = "";
    public string CurrentPassword { get; set; } = "";
    public string NewPassword { get; set; } = "";
    public string ConfirmPassword { get; set; } = "";
}
public class CaseReportRow
{
    public int Id { get; set; }
    public string LawyerName { get; set; } = "";
    public string CaseCode { get; set; } = "";
    public string BlackCaseNo { get; set; } = "";
    public string BlackCaseYear { get; set; } = "";
    public string PlaintiffName { get; set; } = "";
    public string DefendantName { get; set; } = "";
    public string CourtName { get; set; } = "";
    public string Status { get; set; } = "";
}

public static class AccountManagement
{
    public static void Map(RouteGroupBuilder api)
    {
        api.MapPut("/auth/credentials", (CredentialUpdate request, HttpContext http, DatabaseService db) =>
            Update(AccountSecurity.User(http).Id, request, http, db, false));
        api.MapPut("/admin/users/{id:int}/credentials", (int id, CredentialUpdate request, HttpContext http, DatabaseService db) =>
            Update(id, request, http, db, true));
        api.MapGet("/reports/cases", async (HttpContext http, DatabaseService db) =>
        {
            using var conn = db.CreateConnection();
            var admin = AccountSecurity.User(http).Role == "Admin";
            var parameters = new DynamicParameters(AccountSecurity.User(http)); parameters.Add("admin",admin);
            var rows = await conn.QueryAsync<CaseReportRow>($"""
                SELECT c.Id,c.CaseCode,c.BlackCaseNo,c.BlackCaseYear,c.PlaintiffName,c.DefendantName,
                    c.CourtName,c.Status,COALESCE(p.FullName,N'ยังไม่ได้ระบุทนาย') AS LawyerName
                FROM SL_LawCases c LEFT JOIN SL_LawyerProfiles p ON p.Id=c.PrimaryLawyerId
                WHERE @admin=1 OR c.Id IN ({CapacitySupport.CaseScope}) ORDER BY p.FullName,c.Id DESC
                """, parameters);
            return Results.Ok(rows);
        });
    }

    private static async Task<IResult> Update(int id, CredentialUpdate request, HttpContext http, DatabaseService db, bool admin)
    {
        var actor = AccountSecurity.User(http);
        if (admin && actor.Role != "Admin") return Results.StatusCode(403);
        var username = request.Username.Trim();
        if (!Regex.IsMatch(username, @"\A[a-zA-Z0-9._-]{3,100}\z"))
            return Results.BadRequest(new { message = "ชื่อผู้ใช้ต้องมี 3–100 ตัว ใช้ A–Z, a–z, 0–9, จุด ขีดกลาง หรือขีดล่าง" });
        if (!admin && !AccountSecurity.Verify(actor, request.CurrentPassword))
            return Results.BadRequest(new { message = "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
        if (request.NewPassword.Length > 0 && (request.NewPassword.Length < 10 || request.NewPassword.Length > 200 || request.NewPassword != request.ConfirmPassword))
            return Results.BadRequest(new { message = "รหัสผ่านใหม่ต้องมี 10–200 ตัวอักษร และตรงกับช่องยืนยัน" });
        using var conn = db.CreateConnection();
        await conn.OpenAsync();
        using var tx = conn.BeginTransaction(System.Data.IsolationLevel.Serializable);
        // Lock the account namespace until the rename commits, including email login aliases.
        var accounts = (await conn.QueryAsync<UserAccount>("SELECT * FROM SL_UserAccounts WITH (UPDLOCK,HOLDLOCK)", transaction: tx)).ToList();
        var target = accounts.SingleOrDefault(u => u.Id == id);
        if (target == null) return Results.NotFound();
        if (accounts.Any(u => u.Id != id && (string.Equals(u.Username, username, StringComparison.OrdinalIgnoreCase) || string.Equals(u.Email, username, StringComparison.OrdinalIgnoreCase))))
            return Results.Conflict(new { message = "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาเลือกชื่ออื่น" });
        bool changed = target.Username != username || request.NewPassword.Length > 0;
        if (changed)
        {
            await conn.ExecuteAsync("""
                UPDATE SL_UserAccounts SET Username=@username,PasswordHash=@hash WHERE Id=@id;
                UPDATE SL_LawyerClerkMappings SET ClerkUsername=@username WHERE ClerkUserId=@id;
                DELETE FROM SL_Sessions WHERE UserId=@id;
                """, new { id, username, hash = request.NewPassword.Length > 0 ? AccountSecurity.Hash(request.NewPassword) : target.PasswordHash }, tx);
        }
        tx.Commit();
        if (changed && actor.Id == id) await http.SignOutAsync();
        return Results.Ok(new { message = changed ? "บันทึกข้อมูลเข้าสู่ระบบแล้ว เซสชันเดิมถูกปิด กรุณาใช้ข้อมูลใหม่เข้าสู่ระบบ" : "ไม่มีข้อมูลเปลี่ยนแปลง", username, requiresLogin = changed && actor.Id == id });
    }
}
