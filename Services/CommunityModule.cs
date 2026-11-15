using Dapper;
namespace SmartLaws.Web.Services;

public record NewsInput(string Title, string Body, string Image, string Youtube, DateTimeOffset StartsAt, DateTimeOffset EndsAt);
public record MessageInput(int UserId, string Body);
public static class CommunityModule
{
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c = db.CreateConnection();
        await c.ExecuteAsync("""
            IF OBJECT_ID('SL_News') IS NULL BEGIN
              CREATE TABLE SL_News(Id int IDENTITY PRIMARY KEY, Title nvarchar(200) NOT NULL,
                Body nvarchar(max) NOT NULL, Image nvarchar(max) NOT NULL, Youtube varchar(11) NOT NULL,
                StartsAt datetimeoffset NOT NULL, EndsAt datetimeoffset NOT NULL,
                CreatedBy int NOT NULL, UpdatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
              CREATE INDEX IX_News_Schedule ON SL_News(StartsAt,EndsAt);
            END;
            IF OBJECT_ID('SL_Messages') IS NULL BEGIN
              CREATE TABLE SL_Messages(Id int IDENTITY PRIMARY KEY, UserId int NOT NULL REFERENCES SL_UserAccounts(Id),
                SenderId int NOT NULL REFERENCES SL_UserAccounts(Id), Body nvarchar(4000) NOT NULL,
                CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), ReadAt datetime2 NULL);
              CREATE INDEX IX_Messages_User ON SL_Messages(UserId,Id);
            END;
            """);
    }
    public static string? YoutubeId(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        if (!Uri.TryCreate(value, UriKind.Absolute, out var u) || u.Scheme != "https") return null;
        var id = u.Host.ToLowerInvariant() switch {
            "youtu.be" => u.AbsolutePath.Trim('/'),
            "youtube.com" or "www.youtube.com" or "m.youtube.com" => u.AbsolutePath == "/watch"
                ? Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(u.Query)["v"].ToString()
                : u.AbsolutePath.StartsWith("/shorts/") ? u.AbsolutePath[8..].Trim('/') : "",
            _ => ""
        };
        return System.Text.RegularExpressions.Regex.IsMatch(id, "^[A-Za-z0-9_-]{11}$") ? id : null;
    }
    public static bool ValidImage(string? image)
    {
        if (string.IsNullOrEmpty(image)) return true;
        if (image.Length > 2800000) return false;
        var png = image.StartsWith("data:image/png;base64,");
        if (!png && !image.StartsWith("data:image/jpeg;base64,")) return false;
        try {
            var bytes = Convert.FromBase64String(image[(image.IndexOf(',') + 1)..]);
            return png ? bytes.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})
                : bytes.Length > 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255;
        } catch (FormatException) { return false; }
    }
    public static void Map(WebApplication app, RouteGroupBuilder api)
    {
        app.MapGet("/api/public/news", async(DatabaseService db) => {
            using var c = db.CreateConnection();
            return Results.Ok(await c.QueryAsync("SELECT TOP 30 Id,Title,Body,Image,Youtube,StartsAt,EndsAt FROM SL_News WHERE StartsAt<=SYSUTCDATETIME() AND EndsAt>SYSUTCDATETIME() ORDER BY StartsAt DESC,Id DESC"));
        });
        api.MapGet("/admin/news", async(DatabaseService db) => {
            using var c = db.CreateConnection();
            return Results.Ok(await c.QueryAsync("SELECT * FROM SL_News ORDER BY Id DESC"));
        });
        api.MapPost("/admin/news", (NewsInput n,HttpContext h,DatabaseService db) => Save(0,n,h,db));
        api.MapPut("/admin/news/{id:int}", (int id,NewsInput n,HttpContext h,DatabaseService db) => Save(id,n,h,db));
        api.MapDelete("/admin/news/{id:int}", async(int id,DatabaseService db) => {
            using var c = db.CreateConnection();
            return await c.ExecuteAsync("DELETE FROM SL_News WHERE Id=@id",new{id}) > 0 ? Results.Ok() : Results.NotFound();
        });
        api.MapGet("/messages/contacts",async(HttpContext h,DatabaseService db) => {
            if(AccountSecurity.User(h).Role!="Admin") return Results.StatusCode(403);
            using var c=db.CreateConnection();
            return Results.Ok(await c.QueryAsync("""
                SELECT u.Id,u.FullName,u.Role,
                (SELECT COUNT(*) FROM SL_Messages m WHERE m.UserId=u.Id AND m.SenderId=u.Id AND m.ReadAt IS NULL) Unread
                FROM SL_UserAccounts u WHERE u.Role IN ('Lawyer','Clerk') ORDER BY Unread DESC,u.FullName
                """));
        });
        api.MapGet("/messages/{userId:int}",async(int userId,HttpContext h,DatabaseService db) => {
            var u=AccountSecurity.User(h);
            if(u.Role!="Admin" && userId!=u.Id)return Results.NotFound();
            using var c=db.CreateConnection();
            // Reading a conversation only marks messages from the other side as read.
            await c.ExecuteAsync("UPDATE SL_Messages SET ReadAt=SYSUTCDATETIME() WHERE UserId=@userId AND ReadAt IS NULL AND ((@admin=1 AND SenderId=UserId) OR (@admin=0 AND SenderId<>UserId))",new{userId,admin=u.Role=="Admin"});
            return Results.Ok(await c.QueryAsync("SELECT TOP 200 m.*,u.FullName SenderName FROM SL_Messages m JOIN SL_UserAccounts u ON u.Id=m.SenderId WHERE m.UserId=@userId ORDER BY m.Id DESC",new{userId}));
        });
        api.MapPost("/messages",async(MessageInput m,HttpContext h,DatabaseService db) => {
            var u=AccountSecurity.User(h);
            if(u.Role!="Admin" && m.UserId!=u.Id)return Results.NotFound();
            if(string.IsNullOrWhiteSpace(m.Body)||m.Body.Length>4000)return Results.BadRequest(new{message="ระบุข้อความไม่เกิน 4,000 ตัวอักษร"});
            using var c=db.CreateConnection();
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Id=@UserId AND Role IN ('Lawyer','Clerk')",m)==0)return Results.NotFound();
            var id=await c.QuerySingleAsync<int>("INSERT INTO SL_Messages(UserId,SenderId,Body) OUTPUT INSERTED.Id VALUES(@UserId,@sender,@Body)",new{m.UserId,sender=u.Id,Body=m.Body.Trim()});
            return Results.Ok(new{id});
        });
    }
    static async Task<IResult> Save(int id,NewsInput n,HttpContext h,DatabaseService db)
    {
        var youtube=YoutubeId(n.Youtube);
        if(string.IsNullOrWhiteSpace(n.Title)||n.Title.Length>200||string.IsNullOrWhiteSpace(n.Body)||n.Body.Length>10000||n.EndsAt<=n.StartsAt||youtube==null||!ValidImage(n.Image))
            return Results.BadRequest(new{message="ตรวจสอบชื่อ เนื้อหา ช่วงเวลา ลิงก์ YouTube และภาพ PNG/JPG ไม่เกิน 2 MB"});
        using var c=db.CreateConnection();
        var p=new{id,Title=n.Title.Trim(),n.Body,Image=n.Image??"",Youtube=youtube,n.StartsAt,n.EndsAt,actor=AccountSecurity.User(h).Id};
        if(id==0)id=await c.QuerySingleAsync<int>("INSERT INTO SL_News(Title,Body,Image,Youtube,StartsAt,EndsAt,CreatedBy) OUTPUT INSERTED.Id VALUES(@Title,@Body,@Image,@Youtube,@StartsAt,@EndsAt,@actor)",p);
        else if(await c.ExecuteAsync("UPDATE SL_News SET Title=@Title,Body=@Body,Image=@Image,Youtube=@Youtube,StartsAt=@StartsAt,EndsAt=@EndsAt,UpdatedAt=SYSUTCDATETIME() WHERE Id=@id",p)==0)return Results.NotFound();
        return Results.Ok(new{id});
    }
}
