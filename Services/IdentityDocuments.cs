using Dapper;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public record IdentityUpload(int CaseId, int PartyId, string Kind, string Title, string MimeType, string Data);
public record ClientDocumentLink(int FileId, int CaseId, int PartyId, string Kind);
public static class IdentityDocuments
{
    sealed record Incoming(string Name,string MimeType,IdentityUpload? Legacy,IFormFile? File);
    static async Task<Incoming> ReadUpload(HttpContext h)
    {
        if(h.Request.HasFormContentType)
        {
            var form=await FileStorage.ReadFormAsync(h);
            return new(form["title"].ToString(),form["mimeType"].ToString(),null,form.Files.GetFile("file"));
        }
        var legacy=await h.Request.ReadFromJsonAsync<IdentityUpload>(cancellationToken:h.RequestAborted)
            ??throw new BadHttpRequestException("ข้อมูลไฟล์ไม่ถูกต้อง");
        return new(legacy.Title,legacy.MimeType,legacy,null);
    }
    static async Task<string?> Store(Incoming incoming,FileStorage storage,HttpContext h)
    {
        if(incoming.File is { } file)
        {
            if(file.Length<=0||file.Length>FileStorage.MaxFileBytes)return null;
            await using var stream=file.OpenReadStream();
            var key=await storage.SaveAsync(stream,file.Length,h.RequestAborted);
            if(!await storage.IsValidDocumentAsync(key,incoming.MimeType,file.FileName,h.RequestAborted))
            {
                storage.Delete(key);
                return null;
            }
            return key;
        }
        if(incoming.Legacy is not { } legacy)return null;
        var bytes=Decode(legacy);
        if(bytes==null)return null;
        await using var memory=new MemoryStream(bytes,false);
        var saved=await storage.SaveAsync(memory,bytes.Length,h.RequestAborted);
        var extension=incoming.MimeType=="application/pdf"?".pdf":incoming.MimeType=="image/png"?".png":".jpg";
        if(!await storage.IsValidDocumentAsync(saved,incoming.MimeType,legacy.Title+extension,h.RequestAborted))
        {
            storage.Delete(saved);
            return null;
        }
        return saved;
    }
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c = db.CreateConnection();
        await c.ExecuteAsync("""
            IF OBJECT_ID('SL_ClientDocuments') IS NULL BEGIN
              CREATE TABLE SL_ClientDocuments(FileId int PRIMARY KEY REFERENCES SL_CaseFileAttachments(Id) ON DELETE CASCADE,
                CaseId int NOT NULL REFERENCES SL_LawCases(Id), PartyId int NOT NULL REFERENCES SL_CaseParties(Id),
                Kind varchar(30) NOT NULL);
              CREATE INDEX IX_ClientDocuments_Case ON SL_ClientDocuments(CaseId,PartyId);
            END;
            IF OBJECT_ID('SL_PersonalDocuments') IS NULL BEGIN
              CREATE TABLE SL_PersonalDocuments(Id int IDENTITY PRIMARY KEY, UserId int NOT NULL REFERENCES SL_UserAccounts(Id),
                Kind varchar(30) NOT NULL, Title nvarchar(200) NOT NULL, MimeType varchar(100) NOT NULL,
                Content varbinary(max) NOT NULL, CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
              CREATE INDEX IX_PersonalDocuments_User ON SL_PersonalDocuments(UserId,Id);
            END;
            """);
    }
    static bool Allowed(HttpContext h,int id) => AccountSecurity.User(h).Role!="Admin" && ((HashSet<int>)h.Items["caseIds"]!).Contains(id);
    internal static byte[]? Decode(IdentityUpload r)
    {
        if(string.IsNullOrWhiteSpace(r.Title)||r.Title.Length>200||string.IsNullOrEmpty(r.Data)||r.Data.Length>14000000)return null;
        try {
            var data=Convert.FromBase64String(r.Data.Contains(',')?r.Data.Split(',',2)[1]:r.Data);
            if(data.Length==0||data.Length>10*1024*1024)return null;
            return (r.MimeType switch {
                "application/pdf"=>data.AsSpan().StartsWith("%PDF-"u8),
                "image/png"=>data.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10}),
                "image/jpeg"=>data.AsSpan().StartsWith(new byte[]{255,216,255}),
                _=>false
            })?data:null;
        } catch(FormatException){return null;}
    }
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/client-records/{caseId:int}",async(int caseId,HttpContext h,DatabaseService db)=>{
            if(!Allowed(h,caseId))return Results.NotFound();
            using var c=db.CreateConnection();
            var parties=await c.QueryAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE CaseId=@caseId AND IsOurClient=1 ORDER BY PartyOrder,Id",new{caseId});
            var files=await c.QueryAsync("""
                SELECT l.FileId,l.CaseId,l.PartyId,l.Kind,f.FileTitle,f.MimeType,f.CreatedAt,p.FullName
                FROM SL_ClientDocuments l JOIN SL_CaseFileAttachments f ON f.Id=l.FileId
                JOIN SL_CaseParties p ON p.Id=l.PartyId WHERE l.CaseId=@caseId ORDER BY f.Id DESC
                """,new{caseId});
            return Results.Ok(new{parties,files});
        });
        api.MapPost("/client-records",async(HttpContext h,DatabaseService db,FileStorage storage)=>{
            var incoming=await ReadUpload(h);var form=h.Request.HasFormContentType?await h.Request.ReadFormAsync(h.RequestAborted):null;
            var caseId=form!=null&&int.TryParse(form["caseId"],out var cid)?cid:incoming.Legacy?.CaseId??0;
            var partyId=form!=null&&int.TryParse(form["partyId"],out var pid)?pid:incoming.Legacy?.PartyId??0;
            var kind=form?["kind"].ToString()??incoming.Legacy?.Kind??"";
            if(!Allowed(h,caseId))return Results.NotFound();
            if(kind is not ("citizen-id" or "house-registration" or "other"))return Results.BadRequest(new{message="ประเภทเอกสารลูกความไม่ถูกต้อง"});
            if(string.IsNullOrWhiteSpace(incoming.Name)||incoming.Name.Length>200)return Results.BadRequest(new{message="ระบุชื่อเอกสาร"});
            string? key=null;var committed=false;
            try
            {
                using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
                if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseParties WHERE Id=@partyId AND CaseId=@caseId AND IsOurClient=1",new{partyId,caseId},tx)!=1)return Results.BadRequest(new{message="เลือกลูกความที่อยู่ในคดีเดียวกัน"});
                key=await Store(incoming,storage,h);
                if(key==null)return Results.BadRequest(new{message="ระบุไฟล์ PDF / PNG / JPG ที่ถูกต้อง ขนาดไม่เกิน 1 GB"});
                var id=await c.QuerySingleAsync<int>("""
                    INSERT INTO SL_CaseFileAttachments(CaseId,DirectoryIndexNo,FormCode,DirectoryCategoryName,FileTitle,StorageType,FileStatus,FileUrlOrPath,FileDataBase64,StorageKey,MimeType,PageCount,UploadedBy,Remark)
                    OUTPUT INSERTED.Id VALUES(@caseId,99,N'เอกสารลูกความ',N'เอกสารประจำตัวลูกความ',@title,@storage,N'จัดเก็บแล้ว',N'',N'',@key,@mimeType,@pages,@actor,N'เอกสารประกอบของลูกความ เชื่อมกับคู่ความและสำนวน')
                    """,new{caseId,title=incoming.Name,storage=incoming.MimeType=="application/pdf"?"PDF":"IMAGE",key,mimeType=incoming.MimeType,pages=await storage.PageCountAsync(key),actor=AccountSecurity.User(h).FullName},tx);
                await c.ExecuteAsync("INSERT INTO SL_ClientDocuments(FileId,CaseId,PartyId,Kind) VALUES(@id,@caseId,@partyId,@kind)",new{id,caseId,partyId,kind},tx);
                tx.Commit();committed=true;return Results.Ok(new{id});
            }
            finally{if(!committed)storage.Delete(key);}
        });
        api.MapGet("/personal-documents",async(HttpContext h,DatabaseService db)=>{
            var u=AccountSecurity.User(h);if(u.Role!="Lawyer")return Results.StatusCode(403);
            using var c=db.CreateConnection();return Results.Ok(await c.QueryAsync("SELECT Id,Kind,Title,MimeType,DATALENGTH(Content) SizeBytes,CreatedAt FROM SL_PersonalDocuments WHERE UserId=@Id ORDER BY Id DESC",u));
        });
        api.MapPost("/personal-documents",async(HttpContext h,DatabaseService db,FileStorage storage)=>{
            var u=AccountSecurity.User(h);if(u.Role!="Lawyer")return Results.StatusCode(403);
            var incoming=await ReadUpload(h);var form=h.Request.HasFormContentType?await h.Request.ReadFormAsync(h.RequestAborted):null;
            var kind=form?["kind"].ToString()??incoming.Legacy?.Kind??"";
            if(kind is not ("lawyer-license" or "citizen-id" or "house-registration" or "other"))return Results.BadRequest(new{message="ประเภทเอกสารไม่ถูกต้อง"});
            if(string.IsNullOrWhiteSpace(incoming.Name)||incoming.Name.Length>200)return Results.BadRequest(new{message="ระบุชื่อเอกสาร"});
            var key=await Store(incoming,storage,h);if(key==null)return Results.BadRequest(new{message="ระบุไฟล์ PDF / PNG / JPG ที่ถูกต้อง ขนาดไม่เกิน 1 GB"});
            var inserted=false;
            try
            {
                using var c=db.CreateConnection();var id=await c.QuerySingleAsync<int>("INSERT INTO SL_PersonalDocuments(UserId,Kind,Title,MimeType,Content,StorageKey) OUTPUT INSERTED.Id VALUES(@userId,@kind,@title,@mimeType,NULL,@key)",new{userId=u.Id,kind,title=incoming.Name,mimeType=incoming.MimeType,key});inserted=true;return Results.Ok(new{id});
            }
            finally{if(!inserted)storage.Delete(key);}
        });
        api.MapGet("/personal-documents/{id:int}/content",async(int id,HttpContext h,DatabaseService db,FileStorage storage)=>{
            var u=AccountSecurity.User(h);if(u.Role!="Lawyer")return Results.StatusCode(403);
            using var c=db.CreateConnection();var file=await c.QuerySingleOrDefaultAsync("SELECT Content,MimeType,StorageKey FROM SL_PersonalDocuments WHERE Id=@id AND UserId=@userId",new{id,userId=u.Id});
            if(file==null)return Results.NotFound();
            string mime=file.MimeType;var ext=mime=="application/pdf"?"pdf":mime=="image/png"?"png":"jpg";
            if(file.StorageKey is string key)
            {
                try{return Results.File(storage.OpenRead(key),mime,$"personal-{id}.{ext}",enableRangeProcessing:true);}
                catch(FileNotFoundException){return Results.NotFound();}
            }
            return Results.File((byte[])file.Content,mime,$"personal-{id}.{ext}");
        });
        api.MapDelete("/personal-documents/{id:int}",async(int id,HttpContext h,DatabaseService db,FileStorage storage)=>{
            var u=AccountSecurity.User(h);if(u.Role!="Lawyer")return Results.StatusCode(403);
            using var c=db.CreateConnection();var key=await c.ExecuteScalarAsync<string>("SELECT StorageKey FROM SL_PersonalDocuments WHERE Id=@id AND UserId=@userId",new{id,userId=u.Id});
            if(await c.ExecuteAsync("DELETE FROM SL_PersonalDocuments WHERE Id=@id AND UserId=@userId",new{id,userId=u.Id})!=1)return Results.NotFound();
            storage.Delete(key);return Results.Ok();
        });
        api.MapGet("/work-summary",async(int? caseId,HttpContext h,DatabaseService db)=>{
            var u=AccountSecurity.User(h);if(u.Role=="Admin")return Results.StatusCode(403);
            if(caseId.HasValue&&!Allowed(h,caseId.Value))return Results.NotFound();
            using var c=db.CreateConnection();var p=new DynamicParameters(u);p.Add("caseId",caseId);
            var scope=$"SELECT Id FROM SL_LawCases WHERE Id IN ({CapacitySupport.CaseScope}) AND (@caseId IS NULL OR Id=@caseId)";
            var cases=await c.QueryAsync<LawCase>($"SELECT * FROM SL_LawCases WHERE Id IN ({scope}) ORDER BY Id DESC",p);
            var files=await c.QueryAsync<CaseFileAttachment>($"SELECT {CapacitySupport.FileColumns} FROM SL_CaseFileAttachments f WHERE f.CaseId IN ({scope}) ORDER BY f.Id DESC",p);
            var documents=await c.QueryAsync($"SELECT Id,CaseId,DocumentTitle,FormCode,Status,UpdatedAt FROM SL_CaseDocuments WHERE CaseId IN ({scope}) ORDER BY Id DESC",p);
            var appointments=await c.QueryAsync<CaseAppointment>($"SELECT * FROM SL_Appointments WHERE CaseId IN ({scope}) ORDER BY StartsAt",p);
            var clients=await c.QueryAsync($"SELECT Id,CaseId,FullName FROM SL_CaseParties WHERE IsOurClient=1 AND CaseId IN ({scope}) ORDER BY Id",p);
            var clientDocuments=await c.QueryAsync<ClientDocumentLink>($"SELECT * FROM SL_ClientDocuments WHERE CaseId IN ({scope})",p);
            return Results.Ok(new{cases,files,documents,appointments,clients,clientDocuments});
        });
    }
}
