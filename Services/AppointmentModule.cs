using Dapper;

namespace SmartLaws.Web.Services;

public class CaseAppointment
{
    public int Id { get; set; }
    public int CaseId { get; set; }
    public string Title { get; set; } = "";
    public string CourtLevel { get; set; } = "";
    public string Kind { get; set; } = "นัดศาล";
    public DateTimeOffset StartsAt { get; set; }
    public DateTimeOffset EndsAt { get; set; }
    public string Location { get; set; } = "";
    public string Responsible { get; set; } = "";
    public string Notes { get; set; } = "";
    public string Status { get; set; } = "scheduled";
    public int ReminderMinutes { get; set; } = 1440;
    public int Version { get; set; } = 1;
}

public static class AppointmentModule
{
    public record LegacyRequest(CaseAppointment Appointment, string ExpectedDate, string ExpectedTitle, bool Remove = false);
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c = db.CreateConnection();
        await c.ExecuteAsync("""
            IF OBJECT_ID('SL_Appointments') IS NULL BEGIN
            CREATE TABLE SL_Appointments (
                Id int IDENTITY PRIMARY KEY, CaseId int NOT NULL REFERENCES SL_LawCases(Id),
                Title nvarchar(200) NOT NULL, Kind nvarchar(50) NOT NULL,
                StartsAt datetimeoffset NOT NULL, EndsAt datetimeoffset NOT NULL,
                Location nvarchar(300) NOT NULL, Responsible nvarchar(200) NOT NULL,
                Notes nvarchar(4000) NOT NULL, Status varchar(20) NOT NULL,
                ReminderMinutes int NOT NULL, Version int NOT NULL DEFAULT 1,
                CreatedBy int NOT NULL, UpdatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
            CREATE INDEX IX_Appointments_CaseDate ON SL_Appointments(CaseId,StartsAt) INCLUDE(EndsAt,Status,ReminderMinutes);
            END;
            IF COL_LENGTH('SL_Appointments','CourtLevel') IS NULL ALTER TABLE SL_Appointments ADD CourtLevel nvarchar(100) NOT NULL DEFAULT N'';
            """);
    }
    private static bool Allowed(HttpContext h, int caseId) => AccountSecurity.User(h).Role != "Admin"
        && ((HashSet<int>)h.Items["caseIds"]!).Contains(caseId);
    private static string? Validate(CaseAppointment a)
    {
        if (a.CourtLevel != "" && !new[] { "ศาลชั้นต้น", "ศาลอุทธรณ์", "ศาลฎีกา" }.Contains(a.CourtLevel)) return "ชั้นศาลไม่ถูกต้อง";
        if (string.IsNullOrWhiteSpace(a.Title) || a.Title.Length > 200 || a.Location == null || a.Location.Length > 300
            || a.Responsible == null || a.Responsible.Length > 200 || a.Notes == null || a.Notes.Length > 4000)
            return "กรุณาระบุชื่อนัด และตรวจสอบความยาวข้อมูล";
        if (!new[] { "นัดศาล", "สืบพยาน", "ไกล่เกลี่ย", "ฟังคำพิพากษา", "ยื่นเอกสาร", "พบลูกความ", "อื่น ๆ" }.Contains(a.Kind)
            || !new[] { "scheduled", "completed", "cancelled" }.Contains(a.Status)) return "ประเภทนัดหรือสถานะไม่ถูกต้อง";
        if (a.StartsAt.Year < 2000 || a.StartsAt.Year > 2200 || a.EndsAt <= a.StartsAt || a.EndsAt - a.StartsAt > TimeSpan.FromDays(7))
            return "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม และระยะนัดไม่เกิน 7 วัน";
        if (a.ReminderMinutes < 0 || a.ReminderMinutes > 43200) return "แจ้งเตือนล่วงหน้าได้ตั้งแต่ 0 ถึง 30 วัน";
        return null;
    }
    public static void Map(RouteGroupBuilder api)
    {
        api.MapPost("/appointments/legacy/{caseId:int}", async (int caseId, LegacyRequest request, HttpContext h, DatabaseService db) =>
        {
            if (!Allowed(h, caseId)) return Results.NotFound();
            if (request.Remove && AccountSecurity.User(h).Role != "Lawyer") return Results.StatusCode(403);
            var a = request.Appointment;
            if (a == null || a.CaseId != caseId) return Results.BadRequest();
            if (!request.Remove && Validate(a) is { } error) return Results.BadRequest(new { message = error });
            using var c = db.CreateConnection(); c.Open();
            using var tx = c.BeginTransaction();
            var changed = await c.ExecuteAsync("""
                UPDATE SL_LawCases SET NextHearingDate=NULL,NextHearingNote=N''
                WHERE Id=@caseId AND CONVERT(varchar(10),NextHearingDate,23)=@ExpectedDate
                AND ISNULL(NextHearingNote,N'')=@ExpectedTitle
                """, new { caseId, request.ExpectedDate, request.ExpectedTitle }, tx);
            if (changed != 1) return Results.Conflict(new { message = "วันนัดเดิมเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่" });
            if (!request.Remove)
            {
                var p = new DynamicParameters(a); p.Add("actor", AccountSecurity.User(h).Id);
                a.Id = await c.QuerySingleAsync<int>("""
                    INSERT INTO SL_Appointments(CaseId,Title,Kind,StartsAt,EndsAt,Location,Responsible,Notes,Status,ReminderMinutes,CourtLevel,CreatedBy)
                    OUTPUT INSERTED.Id VALUES(@CaseId,@Title,@Kind,@StartsAt,@EndsAt,@Location,@Responsible,@Notes,@Status,@ReminderMinutes,@CourtLevel,@actor)
                    """, p, tx);
                a.Version = 1;
            }
            tx.Commit();
            return Results.Ok(a);
        });
        api.MapGet("/appointments", async (DateTimeOffset from, DateTimeOffset to, HttpContext h, DatabaseService db) =>
        {
            if (AccountSecurity.User(h).Role == "Admin") return Results.StatusCode(403);
            if (to <= from || to - from > TimeSpan.FromDays(367)) return Results.BadRequest(new { message = "เลือกช่วงวันที่ไม่เกิน 1 ปี" });
            using var c = db.CreateConnection();
            var p = new DynamicParameters(AccountSecurity.User(h)); p.Add("from", from); p.Add("to", to);
            return Results.Ok(await c.QueryAsync<CaseAppointment>($"SELECT * FROM SL_Appointments WHERE CaseId IN ({CapacitySupport.CaseScope}) AND StartsAt<@to AND EndsAt>@from ORDER BY StartsAt,Id", p));
        });
        api.MapPost("/appointments", async (CaseAppointment a, HttpContext h, DatabaseService db) =>
        {
            if (!Allowed(h, a.CaseId)) return Results.NotFound();
            if (Validate(a) is { } error) return Results.BadRequest(new { message = error });
            using var c = db.CreateConnection();
            var p = new DynamicParameters(a); p.Add("actor", AccountSecurity.User(h).Id);
            a.Id = await c.QuerySingleAsync<int>("""
                INSERT INTO SL_Appointments(CaseId,Title,Kind,StartsAt,EndsAt,Location,Responsible,Notes,Status,ReminderMinutes,CourtLevel,CreatedBy)
                OUTPUT INSERTED.Id VALUES(@CaseId,@Title,@Kind,@StartsAt,@EndsAt,@Location,@Responsible,@Notes,@Status,@ReminderMinutes,@CourtLevel,@actor)
                """, p);
            a.Version = 1;
            return Results.Ok(a);
        });
        api.MapPut("/appointments/{id:int}", async (int id, CaseAppointment a, HttpContext h, DatabaseService db) =>
        {
            if (!Allowed(h, a.CaseId)) return Results.NotFound();
            if (Validate(a) is { } error) return Results.BadRequest(new { message = error });
            using var c = db.CreateConnection();
            var existing = await c.QuerySingleOrDefaultAsync<CaseAppointment>("SELECT * FROM SL_Appointments WHERE Id=@id", new { id });
            if (existing == null || !Allowed(h, existing.CaseId)) return Results.NotFound();
            a.Id = id;
            var count = await c.ExecuteAsync("""
                UPDATE SL_Appointments SET CaseId=@CaseId,Title=@Title,Kind=@Kind,StartsAt=@StartsAt,EndsAt=@EndsAt,
                CourtLevel=@CourtLevel,Location=@Location,Responsible=@Responsible,Notes=@Notes,Status=@Status,ReminderMinutes=@ReminderMinutes,
                Version=Version+1,UpdatedAt=SYSUTCDATETIME() WHERE Id=@Id AND Version=@Version
                AND (CaseId=@CaseId OR NOT EXISTS(SELECT 1 FROM SL_AppointmentFiles WHERE AppointmentId=@Id))
                """, a);
            if (count == 0) return Results.Conflict(new { message = "รายการถูกแก้ไขโดยผู้ใช้อื่น หรือมีเอกสารแนบจึงย้ายคดีไม่ได้ กรุณาตรวจสอบและเปิดนัดใหม่" });
            a.Version++; return Results.Ok(a);
        });
        api.MapDelete("/appointments/{id:int}", async (int id, HttpContext h, DatabaseService db) =>
        {
            if (AccountSecurity.User(h).Role != "Lawyer") return Results.StatusCode(403);
            using var c = db.CreateConnection();
            var cid = await c.ExecuteScalarAsync<int>("SELECT CaseId FROM SL_Appointments WHERE Id=@id", new { id });
            if (!Allowed(h, cid)) return Results.NotFound();
            await c.ExecuteAsync("DELETE FROM SL_Appointments WHERE Id=@id", new { id });
            return Results.Ok(new { message = "ลบนัดแล้ว" });
        });
    }
}
