using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Authentication;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public class ClientAccess
{
    public int UserId { get; set; }
    public int CaseId { get; set; }
    public int PartyId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}
public class ClientChatMessage
{
    public int Id { get; set; }
    public int ClientUserId { get; set; }
    public int CaseId { get; set; }
    public int SenderId { get; set; }
    public string Body { get; set; } = "";
    public int? FileId { get; set; }
    public Guid RequestId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ReadAt { get; set; }
    public string SenderName { get; set; } = "";
    public string FileTitle { get; set; } = "";
}
public record ClientShare(int ClientUserId,int CaseId,int FileId);
public record ClientAccountInput(int PartyId,string CitizenId);
public class ClientIdentity { public int UserId { get; set; } public string? CitizenNumber { get; set; } public bool MustChangePassword { get; set; } }
public record ClientAccountState(bool Active);
public record ClientPasswordInput(string CurrentPassword,string NewPassword,string ConfirmPassword);
public record ClientShareInput(int[] FileIds);
public record ClientMessageInput(string Body,string? FileName,string? MimeType,string? Data,Guid RequestId);

public static class ClientPortal
{
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c=db.CreateConnection(); await c.OpenAsync();
        using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
        // Upgrade the original single-case model transactionally, including its foreign keys.
        await c.ExecuteAsync("""
            IF OBJECT_ID('SL_ClientIdentities') IS NULL BEGIN
              CREATE TABLE SL_ClientIdentities(UserId int PRIMARY KEY REFERENCES SL_UserAccounts(Id),
                CitizenNumber varchar(13) NULL,MustChangePassword bit NOT NULL DEFAULT 1);
              CREATE UNIQUE INDEX UX_ClientIdentity_Number ON SL_ClientIdentities(CitizenNumber) WHERE CitizenNumber IS NOT NULL;
              CREATE TABLE SL_ClientCaseLinks(UserId int NOT NULL REFERENCES SL_ClientIdentities(UserId),
                CaseId int NOT NULL REFERENCES SL_LawCases(Id),PartyId int NOT NULL REFERENCES SL_CaseParties(Id),
                IsActive bit NOT NULL DEFAULT 1,CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
                PRIMARY KEY(UserId,CaseId),CONSTRAINT UQ_ClientCaseLink_Party UNIQUE(CaseId,PartyId));
              IF OBJECT_ID('SL_ClientAccess') IS NOT NULL BEGIN
                INSERT INTO SL_ClientIdentities(UserId,MustChangePassword) SELECT UserId,MustChangePassword FROM SL_ClientAccess;
                INSERT INTO SL_ClientCaseLinks(UserId,CaseId,PartyId,IsActive,CreatedAt)
                  SELECT a.UserId,a.CaseId,a.PartyId,CASE WHEN u.AccountStatus=N'Active' THEN 1 ELSE 0 END,a.CreatedAt
                  FROM SL_ClientAccess a JOIN SL_UserAccounts u ON u.Id=a.UserId;
                DECLARE @drop nvarchar(max)=N'';
                SELECT @drop=@drop+N'ALTER TABLE '+QUOTENAME(OBJECT_NAME(parent_object_id))+N' DROP CONSTRAINT '+QUOTENAME(name)+N';'
                  FROM sys.foreign_keys WHERE referenced_object_id=OBJECT_ID('SL_ClientAccess');
                EXEC sp_executesql @drop;
                UPDATE SL_UserAccounts SET AccountStatus=N'Active' WHERE Id IN(SELECT UserId FROM SL_ClientIdentities);
                DROP TABLE SL_ClientAccess;
              END;
            END;
            IF OBJECT_ID('SL_ClientShares') IS NULL
              CREATE TABLE SL_ClientShares(ClientUserId int NOT NULL,CaseId int NOT NULL,
                FileId int NOT NULL REFERENCES SL_CaseFileAttachments(Id) ON DELETE CASCADE,PRIMARY KEY(ClientUserId,FileId));
            IF COL_LENGTH('SL_ClientShares','CaseId') IS NULL BEGIN
              ALTER TABLE SL_ClientShares ADD CaseId int NULL;
              EXEC(N'UPDATE s SET CaseId=f.CaseId FROM SL_ClientShares s JOIN SL_CaseFileAttachments f ON f.Id=s.FileId');
              ALTER TABLE SL_ClientShares ALTER COLUMN CaseId int NOT NULL;
            END;
            IF OBJECT_ID('SL_ClientChat') IS NULL BEGIN
              CREATE TABLE SL_ClientChat(Id int IDENTITY PRIMARY KEY,ClientUserId int NOT NULL,
                CaseId int NOT NULL REFERENCES SL_LawCases(Id),SenderId int NOT NULL REFERENCES SL_UserAccounts(Id),
                Body nvarchar(4000) NOT NULL,FileId int NULL REFERENCES SL_CaseFileAttachments(Id),RequestId uniqueidentifier NOT NULL,
                CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),ReadAt datetime2 NULL);
              CREATE INDEX IX_ClientChat_Thread ON SL_ClientChat(ClientUserId,Id);
            END;
            IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_ClientShares_CaseLink')
              ALTER TABLE SL_ClientShares ADD CONSTRAINT FK_ClientShares_CaseLink FOREIGN KEY(ClientUserId,CaseId) REFERENCES SL_ClientCaseLinks(UserId,CaseId);
            IF NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE name='FK_ClientChat_CaseLink')
              ALTER TABLE SL_ClientChat ADD CONSTRAINT FK_ClientChat_CaseLink FOREIGN KEY(ClientUserId,CaseId) REFERENCES SL_ClientCaseLinks(UserId,CaseId);
            IF EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_ClientChat_Retry' AND object_id=OBJECT_ID('SL_ClientChat'))
              DROP INDEX IX_ClientChat_Retry ON SL_ClientChat;
            IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_ClientChat_CaseRetry' AND object_id=OBJECT_ID('SL_ClientChat'))
              CREATE UNIQUE INDEX IX_ClientChat_CaseRetry ON SL_ClientChat(ClientUserId,CaseId,SenderId,RequestId);
            """,transaction:tx);
        tx.Commit();
    }
    public static bool Owns(HttpContext h,int caseId)=>AccountSecurity.User(h).Role=="Lawyer"&&((HashSet<int>)h.Items["caseIds"]!).Contains(caseId);
    static ClientAccess Access(HttpContext h)=>(ClientAccess)h.Items["clientAccess"]!;
    static async Task<IResult> LinkIdentity(int caseId,ClientAccountInput r,HttpContext h,DatabaseService db)
    {
        if(!Owns(h,caseId))return Results.NotFound();
        var number=Digits(r.CitizenId);
        if(!Regex.IsMatch(number,"^[0-9]{13}$"))return Results.BadRequest(new{message="ระบุเลขประจำตัวประชาชน 13 หลัก"});
        using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
        var name=await c.ExecuteScalarAsync<string>("SELECT FullName FROM SL_CaseParties WHERE Id=@PartyId AND CaseId=@caseId AND IsOurClient=1",new{r.PartyId,caseId},tx);
        if(name==null)return Results.NotFound();
        var citizen=await c.ExecuteScalarAsync<string>("SELECT CitizenId FROM SL_CaseParties WHERE Id=@PartyId",new{r.PartyId},tx);
        if(!string.IsNullOrWhiteSpace(citizen)&&Digits(citizen)!=number)return Results.Conflict(new{message="เลขประชาชนไม่ตรงกับลูกความที่บันทึกในคดี กรุณาตรวจสอบรายชื่อก่อนผูกบัญชี"});
        var old=await c.QuerySingleOrDefaultAsync<ClientIdentity>("SELECT i.* FROM SL_ClientIdentities i JOIN SL_ClientCaseLinks a ON a.UserId=i.UserId WHERE a.CaseId=@caseId AND a.PartyId=@PartyId",new{caseId,r.PartyId},tx);
        if(old?.CitizenNumber!=null&&old.CitizenNumber!=number)return Results.Conflict(new{message="ลูกความในคดีนี้ผูกกับเลขประจำตัวอื่นแล้ว"});
        var target=await c.QuerySingleOrDefaultAsync<ClientIdentity>("SELECT * FROM SL_ClientIdentities WITH(UPDLOCK,HOLDLOCK) WHERE CitizenNumber=@number",new{number},tx);
        bool created=false;
        if(target==null){
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Username=@number AND Id<>@oldId",new{number,oldId=old?.UserId??0},tx)>0)return Results.Conflict(new{message="ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาติดต่อผู้ดูแล"});
            if(old!=null){
                await c.ExecuteAsync("UPDATE SL_ClientIdentities SET CitizenNumber=@number WHERE UserId=@UserId; UPDATE SL_UserAccounts SET Username=@number WHERE Id=@UserId; DELETE FROM SL_Sessions WHERE UserId=@UserId",new{number,old.UserId},tx);target=old;
            }else{
                var id=await c.QuerySingleAsync<int>("INSERT INTO SL_UserAccounts(Username,PasswordHash,FullName,Role,AccountStatus,MaxCasesQuota,CitizenId) OUTPUT INSERTED.Id VALUES(@number,@hash,@name,N'Client',N'Active',0,N'')",new{number,hash=AccountSecurity.Hash(number),name},tx);
                await c.ExecuteAsync("INSERT INTO SL_ClientIdentities(UserId,CitizenNumber) VALUES(@id,@number)",new{id,number},tx);target=new(){UserId=id,MustChangePassword=true};created=true;
            }
        }
        var link=await c.QuerySingleOrDefaultAsync<ClientAccess>("SELECT * FROM SL_ClientCaseLinks WHERE UserId=@UserId AND CaseId=@caseId",new{target.UserId,caseId},tx);
        if(link!=null&&link.PartyId!=r.PartyId)return Results.Conflict(new{message="เลขประจำตัวนี้ผูกกับลูกความอีกชื่อในคดีนี้แล้ว"});
        if(old!=null&&old.UserId!=target.UserId){
            // Move the verified legacy case, preserving its messages, shares and suspension state.
            await c.ExecuteAsync("UPDATE SL_ClientCaseLinks SET PartyId=@PartyId WHERE UserId=@oldId AND CaseId=@caseId",new{r.PartyId,oldId=old.UserId,caseId},tx);
            // The unique party key requires removing it only after dependent rows are temporarily held.
            await c.ExecuteAsync("SELECT * INTO #mergeShares FROM SL_ClientShares WHERE ClientUserId=@oldId AND CaseId=@caseId; SELECT * INTO #mergeChat FROM SL_ClientChat WHERE ClientUserId=@oldId AND CaseId=@caseId; DELETE FROM SL_ClientShares WHERE ClientUserId=@oldId AND CaseId=@caseId; DELETE FROM SL_ClientChat WHERE ClientUserId=@oldId AND CaseId=@caseId; UPDATE SL_ClientCaseLinks SET UserId=@newId WHERE UserId=@oldId AND CaseId=@caseId; INSERT INTO SL_ClientShares(ClientUserId,CaseId,FileId) SELECT @newId,CaseId,FileId FROM #mergeShares; SET IDENTITY_INSERT SL_ClientChat ON; INSERT INTO SL_ClientChat(Id,ClientUserId,CaseId,SenderId,Body,FileId,RequestId,CreatedAt,ReadAt) SELECT Id,@newId,CaseId,CASE WHEN SenderId=@oldId THEN @newId ELSE SenderId END,Body,FileId,RequestId,CreatedAt,ReadAt FROM #mergeChat; SET IDENTITY_INSERT SL_ClientChat OFF; DELETE FROM SL_Sessions WHERE UserId=@oldId; UPDATE SL_UserAccounts SET AccountStatus=N'Suspended' WHERE Id=@oldId AND NOT EXISTS(SELECT 1 FROM SL_ClientCaseLinks WHERE UserId=@oldId)",new{oldId=old.UserId,newId=target.UserId,caseId},tx);
        }else if(link==null){
            await c.ExecuteAsync("INSERT INTO SL_ClientCaseLinks(UserId,CaseId,PartyId) VALUES(@UserId,@caseId,@PartyId)",new{target.UserId,caseId,r.PartyId},tx);
        }
        await c.ExecuteAsync("UPDATE SL_CaseParties SET CitizenId=@number WHERE Id=@PartyId; UPDATE SL_LawCases SET PartyVersion=PartyVersion+1 WHERE Id=@caseId",new{number,r.PartyId,caseId},tx);
        tx.Commit();return Results.Ok(new{userId=target.UserId,username=number,created});
    }
    public static string Digits(string value)=>string.Concat((value??"").Select(ch=>ch is >= '๐' and <= '๙'?(char)('0'+ch-'๐'):ch));
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/client-management/{caseId:int}",async(int caseId,HttpContext h,DatabaseService db)=>{
            if(!Owns(h,caseId))return Results.NotFound();using var c=db.CreateConnection();
            var accounts=await c.QueryAsync("""
                SELECT a.UserId,a.PartyId,i.MustChangePassword,u.Username,p.FullName,CASE WHEN a.IsActive=1 THEN N'Active' ELSE N'Suspended' END AccountStatus,
                  CAST(CASE WHEN i.CitizenNumber IS NULL THEN 1 ELSE 0 END AS bit) NeedsIdentity,
                  (SELECT COUNT(*) FROM SL_ClientChat m WHERE m.ClientUserId=a.UserId AND m.CaseId=a.CaseId AND m.SenderId=a.UserId AND m.ReadAt IS NULL) Unread
                FROM SL_ClientCaseLinks a JOIN SL_ClientIdentities i ON i.UserId=a.UserId JOIN SL_UserAccounts u ON u.Id=a.UserId JOIN SL_CaseParties p ON p.Id=a.PartyId WHERE a.CaseId=@caseId ORDER BY a.UserId
                """,new{caseId});
            var parties=await c.QueryAsync("SELECT Id,FullName FROM SL_CaseParties WHERE CaseId=@caseId AND IsOurClient=1 ORDER BY Id",new{caseId});
            return Results.Ok(new{accounts,parties});
        });
        api.MapPost("/client-management/{caseId:int}",(int caseId,ClientAccountInput r,HttpContext h,DatabaseService db)=>LinkIdentity(caseId,r,h,db));
        api.MapPut("/client-management/{caseId:int}/{clientId:int}/state",async(int caseId,int clientId,ClientAccountState r,HttpContext h,DatabaseService db)=>{
            if(!Owns(h,caseId))return Results.NotFound();using var c=db.CreateConnection();
            var changed=await c.ExecuteAsync("UPDATE SL_ClientCaseLinks SET IsActive=@Active WHERE CaseId=@caseId AND UserId=@clientId",new{caseId,clientId,r.Active});
            if(changed==0)return Results.NotFound();
            await c.ExecuteAsync("DELETE FROM SL_Sessions WHERE UserId=@clientId AND NOT EXISTS(SELECT 1 FROM SL_ClientCaseLinks WHERE UserId=@clientId AND IsActive=1)",new{clientId});return Results.Ok();
        });
        api.MapPost("/client-management/{caseId:int}/{clientId:int}/reset",async(int caseId,int clientId,ClientAccountInput r,HttpContext h,DatabaseService db)=>{
            if(!Owns(h,caseId))return Results.NotFound();var password=Digits(r.CitizenId);if(!Regex.IsMatch(password,"^[0-9]{13}$"))return Results.BadRequest(new{message="ระบุเลข 13 หลัก"});
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction();
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientCaseLinks WHERE UserId=@clientId AND CaseId=@caseId",new{caseId,clientId},tx)==0)return Results.NotFound();
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientCaseLinks a JOIN SL_LawCases lc ON lc.Id=a.CaseId WHERE a.UserId=@clientId AND lc.PrimaryLawyerId<>@owner",new{clientId,owner=AccountSecurity.User(h).LawyerProfileId},tx)>0)return Results.Conflict(new{message="บัญชีนี้มีคดีของทนายอื่นด้วย กรุณาให้ลูกความเปลี่ยนรหัสผ่านด้วยตนเอง"});
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientIdentities WHERE UserId=@clientId AND CitizenNumber=@password",new{clientId,password},tx)!=1)return Results.BadRequest(new{message="เลขประจำตัวไม่ตรงกับบัญชี"});
            await c.ExecuteAsync("UPDATE SL_UserAccounts SET PasswordHash=@hash WHERE Id=@clientId AND Role='Client'; UPDATE SL_ClientIdentities SET MustChangePassword=1 WHERE UserId=@clientId; DELETE FROM SL_Sessions WHERE UserId=@clientId",new{clientId,hash=AccountSecurity.Hash(password)},tx);tx.Commit();return Results.Ok();
        });
        api.MapGet("/client-management/{caseId:int}/{clientId:int}/files",async(int caseId,int clientId,HttpContext h,DatabaseService db)=>{
            if(!Owns(h,caseId))return Results.NotFound();using var c=db.CreateConnection();
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientCaseLinks WHERE UserId=@clientId AND CaseId=@caseId",new{caseId,clientId})==0)return Results.NotFound();
            return Results.Ok(await c.QueryAsync("SELECT f.Id,f.FileTitle,f.StorageType,CAST(CASE WHEN s.FileId IS NULL THEN 0 ELSE 1 END AS bit) Shared FROM SL_CaseFileAttachments f LEFT JOIN SL_ClientShares s ON s.FileId=f.Id AND s.ClientUserId=@clientId WHERE f.CaseId=@caseId ORDER BY f.Id DESC",new{caseId,clientId}));
        });
        api.MapPut("/client-management/{caseId:int}/{clientId:int}/files",async(int caseId,int clientId,ClientShareInput r,HttpContext h,DatabaseService db)=>{
            if(!Owns(h,caseId))return Results.NotFound();if(r.FileIds==null||r.FileIds.Length>1000)return Results.BadRequest();
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientCaseLinks WHERE UserId=@clientId AND CaseId=@caseId",new{caseId,clientId},tx)==0)return Results.NotFound();
            var ids=r.FileIds.Distinct().ToArray();
            if(ids.Length>0&&await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseFileAttachments WHERE CaseId=@caseId AND Id IN @ids",new{caseId,ids},tx)!=ids.Length)return Results.BadRequest(new{message="เลือกได้เฉพาะไฟล์ในคดีนี้"});
            await c.ExecuteAsync("DELETE FROM SL_ClientShares WHERE ClientUserId=@clientId AND CaseId=@caseId",new{clientId,caseId},tx);
            foreach(var id in ids)await c.ExecuteAsync("INSERT INTO SL_ClientShares(ClientUserId,CaseId,FileId) VALUES(@clientId,@caseId,@id)",new{clientId,caseId,id},tx);
            tx.Commit();return Results.Ok();
        });
        api.MapGet("/client/cases",async(HttpContext h,DatabaseService db)=>{
            var links=(List<ClientAccess>)h.Items["clientLinks"]!;using var c=db.CreateConnection();
            return Results.Ok(await c.QueryAsync("SELECT Id,CaseCode,BlackCaseNo,BlackCaseYear,CourtName,Status FROM SL_LawCases WHERE Id IN @ids ORDER BY Id DESC",new{ids=links.Select(a=>a.CaseId).ToArray()}));
        });
        api.MapGet("/client/home",async(HttpContext h,DatabaseService db)=>{
            var a=Access(h);using var c=db.CreateConnection();
            var summary=await c.QuerySingleAsync("""
                SELECT c.Id,c.CaseCode,c.BlackCaseNo,c.BlackCaseYear,c.RedCaseNo,c.RedCaseYear,c.CourtName,c.Status,
                    c.NextHearingDate,u.FullName LawyerName,p.FullName ClientName
                FROM SL_LawCases c JOIN SL_CaseParties p ON p.Id=@PartyId
                JOIN SL_UserAccounts u ON u.LawyerProfileId=c.PrimaryLawyerId AND u.Role='Lawyer'
                WHERE c.Id=@CaseId
                """,a);
            var appointments=await c.QueryAsync("SELECT Id,Title,Kind,CourtLevel,StartsAt,EndsAt,Location,Status FROM SL_Appointments WHERE CaseId=@CaseId ORDER BY StartsAt",a);
            var files=await c.QueryAsync("SELECT f.Id,f.FileTitle,f.StorageType,f.MimeType,f.CreatedAt FROM SL_ClientShares s JOIN SL_CaseFileAttachments f ON f.Id=s.FileId WHERE s.ClientUserId=@UserId AND f.CaseId=@CaseId ORDER BY f.Id DESC",a);
            var unread=await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientChat WHERE ClientUserId=@UserId AND CaseId=@CaseId AND SenderId<>@UserId AND ReadAt IS NULL",a);
            return Results.Ok(new{summary,appointments,files,unread});
        });
        api.MapPost("/client/password",async(ClientPasswordInput r,HttpContext h,DatabaseService db)=>{
            var u=AccountSecurity.User(h);if(!AccountSecurity.Verify(u,r.CurrentPassword)||r.NewPassword==null||r.NewPassword.Length<10||r.NewPassword.Length>200||r.NewPassword!=r.ConfirmPassword||r.NewPassword==r.CurrentPassword||Regex.IsMatch(Digits(r.NewPassword),"^[0-9]{13}$"))return Results.BadRequest(new{message="ตรวจสอบรหัสเดิม และตั้งรหัสใหม่อย่างน้อย 10 ตัวอักษรที่ไม่ใช่เลข 13 หลัก พร้อมยืนยันให้ตรงกัน"});
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction();
            await c.ExecuteAsync("UPDATE SL_UserAccounts SET PasswordHash=@hash WHERE Id=@Id; UPDATE SL_ClientIdentities SET MustChangePassword=0 WHERE UserId=@Id; DELETE FROM SL_Sessions WHERE UserId=@Id",new{u.Id,hash=AccountSecurity.Hash(r.NewPassword)},tx);tx.Commit();await h.SignOutAsync();return Results.Ok(new{requiresLogin=true});
        });
        api.MapGet("/client/files/{id:int}",async(int id,HttpContext h,DatabaseService db,WordExportService word)=>{
            var a=Access(h);using var c=db.CreateConnection();var f=await c.QuerySingleOrDefaultAsync<CaseFileAttachment>("SELECT f.* FROM SL_CaseFileAttachments f JOIN SL_ClientShares s ON s.FileId=f.Id WHERE s.ClientUserId=@UserId AND f.CaseId=@CaseId AND f.Id=@id",new{a.UserId,a.CaseId,id});
            if(f==null)return Results.NotFound();
            if(f.StorageKey is string key)
            {
                var storage=h.RequestServices.GetRequiredService<FileStorage>();
                try{return Results.File(storage.OpenRead(key),f.MimeType,$"case-file-{id}."+(f.MimeType=="application/pdf"?"pdf":f.MimeType=="image/png"?"png":"jpg"),enableRangeProcessing:true);}
                catch(FileNotFoundException){return Results.NotFound();}
            }
            if(!string.IsNullOrEmpty(f.FileDataBase64)){var bytes=Convert.FromBase64String(f.FileDataBase64.Contains(',')?f.FileDataBase64.Split(',',2)[1]:f.FileDataBase64);return Results.File(bytes,f.MimeType,$"case-file-{id}."+(f.MimeType=="application/pdf"?"pdf":f.MimeType=="image/png"?"png":"jpg"));}
            if(f.StorageType=="COURT_FORM"&&f.DocumentId.HasValue){var d=await c.QuerySingleOrDefaultAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WHERE Id=@DocumentId AND CaseId=@CaseId",f);if(d==null)return Results.NotFound();var lc=await c.QuerySingleAsync<LawCase>("SELECT * FROM SL_LawCases WHERE Id=@CaseId",f);return Results.File(word.GenerateCourtDocumentDocx(d,lc),"application/vnd.openxmlformats-officedocument.wordprocessingml.document",$"case-document-{id}.docx");}
            if(f.StorageType=="LINK"&&Uri.TryCreate(f.FileUrlOrPath,UriKind.Absolute,out var link)&&link.Scheme=="https")return Results.Redirect(link.AbsoluteUri);
            return Results.NotFound();
        });
        api.MapGet("/client/messages",(int? before,HttpContext h,DatabaseService db)=>ReadMessages(Access(h).CaseId,Access(h).UserId,before,h,db));
        api.MapPost("/client/messages",async(HttpContext h,DatabaseService db,FileStorage storage)=>await ReceiveMessage(Access(h).CaseId,Access(h).UserId,h,db,storage));
        api.MapGet("/client-management/{caseId:int}/{clientId:int}/messages",(int caseId,int clientId,int? before,HttpContext h,DatabaseService db)=>ReadMessages(caseId,clientId,before,h,db));
        api.MapPost("/client-management/{caseId:int}/{clientId:int}/messages",async(int caseId,int clientId,HttpContext h,DatabaseService db,FileStorage storage)=>await ReceiveMessage(caseId,clientId,h,db,storage));
    }
    static async Task<bool> ThreadAllowed(int caseId,int clientId,HttpContext h,Microsoft.Data.SqlClient.SqlConnection c)
    {
        var u=AccountSecurity.User(h);
        if(u.Role=="Client")return Access(h).UserId==clientId&&Access(h).CaseId==caseId;
        return Owns(h,caseId)&&await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientCaseLinks WHERE UserId=@clientId AND CaseId=@caseId",new{caseId,clientId})==1;
    }
    static async Task<IResult> ReadMessages(int caseId,int clientId,int? before,HttpContext h,DatabaseService db)
    {
        using var c=db.CreateConnection();if(!await ThreadAllowed(caseId,clientId,h,c))return Results.NotFound();
        var rows=(await c.QueryAsync<ClientChatMessage>("""
            SELECT TOP 100 m.*,u.FullName SenderName,ISNULL(f.FileTitle,N'') FileTitle FROM SL_ClientChat m
            JOIN SL_UserAccounts u ON u.Id=m.SenderId LEFT JOIN SL_CaseFileAttachments f ON f.Id=m.FileId
            WHERE m.ClientUserId=@clientId AND m.CaseId=@caseId AND (@before IS NULL OR m.Id<@before) ORDER BY m.Id DESC
            """,new{clientId,caseId,before})).ToList();
        if(rows.Count>0)await c.ExecuteAsync("UPDATE SL_ClientChat SET ReadAt=SYSUTCDATETIME() WHERE Id IN @ids AND SenderId<>@actor AND ReadAt IS NULL",new{ids=rows.Select(m=>m.Id).ToArray(),actor=AccountSecurity.User(h).Id});
        return Results.Ok(rows);
    }
    static async Task<IResult> ReceiveMessage(int caseId,int clientId,HttpContext h,DatabaseService db,FileStorage storage)
    {
        ClientMessageInput input;IFormFile? upload=null;
        if(h.Request.HasFormContentType)
        {
            var form=await FileStorage.ReadFormAsync(h);
            input=new(form["body"].ToString(),form["fileName"].ToString(),form["mimeType"].ToString(),null,
                Guid.TryParse(form["requestId"],out var requestId)?requestId:Guid.Empty);
            upload=form.Files.GetFile("file");
        }
        else input=await h.Request.ReadFromJsonAsync<ClientMessageInput>(cancellationToken:h.RequestAborted)
            ??new ClientMessageInput("","","","",Guid.Empty);
        return await SendMessage(caseId,clientId,input,upload,h,db,storage);
    }

    static async Task<IResult> SendMessage(int caseId,int clientId,ClientMessageInput r,IFormFile? upload,HttpContext h,DatabaseService db,FileStorage storage)
    {
        using var c=db.CreateConnection();if(!await ThreadAllowed(caseId,clientId,h,c))return Results.NotFound();
        if(r.RequestId==Guid.Empty||(r.Body?.Length??0)>4000||string.IsNullOrWhiteSpace(r.Body)&&upload==null&&string.IsNullOrEmpty(r.Data))return Results.BadRequest(new{message="พิมพ์ข้อความไม่เกิน 4,000 ตัวอักษรหรือเลือกไฟล์ก่อนส่ง"});
        if(upload is { Length: > FileStorage.MaxFileBytes })return Results.BadRequest(new{message="ไฟล์ต้องมีขนาดไม่เกิน 1 GB"});
        byte[]? legacyBytes=null;
        if(upload==null&&!string.IsNullOrEmpty(r.Data))
        {
            legacyBytes=IdentityDocuments.Decode(new IdentityUpload(caseId,0,"other",r.FileName??"",r.MimeType??"",r.Data));
            if(legacyBytes==null)return Results.BadRequest(new{message="รองรับ PDF / PNG / JPG ขนาดไม่เกิน 10 MB"});
        }
        await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);var sender=AccountSecurity.User(h);
        var existing=await c.ExecuteScalarAsync<int?>("SELECT Id FROM SL_ClientChat WITH(UPDLOCK,HOLDLOCK) WHERE ClientUserId=@clientId AND CaseId=@caseId AND SenderId=@sender AND RequestId=@RequestId",new{clientId,caseId,sender=sender.Id,r.RequestId},tx);
        if(existing.HasValue)return Results.Ok(new{id=existing.Value});
        string? key=null;var committed=false;
        try
        {
            if(upload!=null)
            {
                if(string.IsNullOrWhiteSpace(r.FileName)||string.IsNullOrWhiteSpace(r.MimeType))return Results.BadRequest(new{message="เลือกไฟล์ PDF / PNG / JPG"});
                await using var stream=upload.OpenReadStream();
                key=await storage.SaveAsync(stream,upload.Length,h.RequestAborted);
                if(!await storage.IsValidDocumentAsync(key,r.MimeType,r.FileName,h.RequestAborted))return Results.BadRequest(new{message="ไฟล์ PDF / PNG / JPG ไม่ถูกต้อง"});
            }
            else if(legacyBytes!=null)
            {
                await using var stream=new MemoryStream(legacyBytes,false);
                key=await storage.SaveAsync(stream,legacyBytes.Length,h.RequestAborted);
            }
            int? fileId=null;
            if(key!=null)
            {
                fileId=await c.QuerySingleAsync<int>("""
                    INSERT INTO SL_CaseFileAttachments(CaseId,DirectoryIndexNo,FormCode,DirectoryCategoryName,FileTitle,StorageType,FileStatus,FileUrlOrPath,FileDataBase64,StorageKey,MimeType,PageCount,UploadedBy,Remark)
                    OUTPUT INSERTED.Id VALUES(@caseId,99,N'แชทลูกความ',N'เอกสารจากการติดต่อกับลูกความ',@FileName,@storage,N'รับจากแชท',N'',N'',@key,@MimeType,1,@actor,N'ไฟล์แนบในการสนทนาทนายและลูกความ')
                    """,new{caseId,FileName=r.FileName??"ไฟล์แนบ",storage=r.MimeType=="application/pdf"?"PDF":"IMAGE",key,MimeType=r.MimeType??"application/pdf",actor=sender.FullName},tx);
                await c.ExecuteAsync("INSERT INTO SL_ClientShares(ClientUserId,CaseId,FileId) VALUES(@clientId,@caseId,@fileId)",new{clientId,caseId,fileId},tx);
            }
            var id=await c.QuerySingleAsync<int>("INSERT INTO SL_ClientChat(ClientUserId,CaseId,SenderId,Body,FileId,RequestId) OUTPUT INSERTED.Id VALUES(@clientId,@caseId,@sender,@body,@fileId,@RequestId)",new{clientId,caseId,sender=sender.Id,body=r.Body?.Trim()??"",fileId,r.RequestId},tx);
            tx.Commit();committed=true;return Results.Ok(new{id,fileId});
        }
        finally{if(!committed)storage.Delete(key);}
    }
}
