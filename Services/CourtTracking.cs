using Dapper;

namespace SmartLaws.Web.Services;

public static class CourtTracking
{
    public const string DefaultUrl = "https://cios.coj.go.th/tracking/";
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c = db.CreateConnection();
        await c.ExecuteAsync("""
            IF OBJECT_ID('SL_CourtTrackingSettings','U') IS NULL
              CREATE TABLE SL_CourtTrackingSettings (
                Id int NOT NULL PRIMARY KEY CHECK (Id=1),
                Url nvarchar(2048) NOT NULL,
                UpdatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
                UpdatedBy int NULL REFERENCES SL_UserAccounts(Id));
            IF NOT EXISTS(SELECT 1 FROM SL_CourtTrackingSettings WHERE Id=1)
              INSERT SL_CourtTrackingSettings(Id,Url) VALUES(1,@url);
            """, new { url = DefaultUrl });
    }

    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/court-tracking/settings", async (HttpContext h, DatabaseService db) => {
            if (AccountSecurity.User(h).Role is not ("Lawyer" or "Clerk" or "Admin")) return Results.StatusCode(403);
            using var c = db.CreateConnection();
            var url = await c.ExecuteScalarAsync<string>("SELECT Url FROM SL_CourtTrackingSettings WHERE Id=1");
            return Results.Ok(new { url = url ?? DefaultUrl, defaultUrl = DefaultUrl });
        });
        api.MapPut("/admin/court-tracking", async (CourtTrackingInput input, HttpContext h, DatabaseService db) => {
            var actor = AccountSecurity.User(h);
            if (actor.Role != "Admin") return Results.StatusCode(403);
            var url = input.Url?.Trim() ?? "";
            if (url.Length > 2048 || url.Any(char.IsControl) || !Uri.TryCreate(url, UriKind.Absolute, out var uri)
                || uri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(uri.UserInfo) || string.IsNullOrEmpty(uri.Host))
                return Results.BadRequest(new { message = "กรุณาระบุลิงก์ HTTPS ที่ถูกต้อง เช่น https://cios.coj.go.th/tracking/" });
            using var c = db.CreateConnection();
            await c.OpenAsync();
            using var tx = c.BeginTransaction();
            await c.ExecuteAsync("""
                UPDATE SL_CourtTrackingSettings SET Url=@url,UpdatedAt=SYSUTCDATETIME(),UpdatedBy=@actor WHERE Id=1;
                INSERT SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'COURT_TRACKING_LINK_UPDATE',@url);
                """, new { url, actor = actor.Id }, tx);
            tx.Commit();
            return Results.Ok(new { url, message = "บันทึกลิงก์ตรวจสอบนัดคดีศาลแล้ว" });
        });
    }
}

public sealed record CourtTrackingInput(string? Url);
