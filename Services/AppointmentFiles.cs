using Dapper;
using SmartLaws.Web.Models;
namespace SmartLaws.Web.Services;

public record AppointmentFileLink(int? FileId, int? DocumentId);
public record StudioArchiveRequest(int PageCount);
public static class AppointmentFiles
{
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c=db.CreateConnection();
        await c.ExecuteAsync("""
            IF OBJECT_ID('SL_AppointmentFiles') IS NULL BEGIN
            CREATE TABLE SL_AppointmentFiles(AppointmentId int NOT NULL REFERENCES SL_Appointments(Id) ON DELETE CASCADE,
                FileId int NOT NULL REFERENCES SL_CaseFileAttachments(Id), CreatedBy int NOT NULL,
                CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), PRIMARY KEY(AppointmentId,FileId));
            CREATE INDEX IX_AppointmentFiles_File ON SL_AppointmentFiles(FileId);
            END;
            """);
    }
    static bool Allowed(HttpContext h,int cid)=>AccountSecurity.User(h).Role!="Admin" && ((HashSet<int>)h.Items["caseIds"]!).Contains(cid);
    public static void Map(RouteGroupBuilder api)
    {
        api.MapPost("/documents/{id:int}/archive",async(int id,StudioArchiveRequest request,HttpContext h,DatabaseService db)=>{
            if(request.PageCount<1||request.PageCount>10000)return Results.BadRequest(new{message="จำนวนหน้าเอกสารไม่ถูกต้อง"});
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var doc=await c.QuerySingleOrDefaultAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WITH(UPDLOCK) WHERE Id=@id",new{id},tx);
            if(doc==null||!Allowed(h,doc.CaseId))return Results.NotFound();
            var fid=await c.ExecuteScalarAsync<int>("SELECT TOP 1 Id FROM SL_CaseFileAttachments WITH(UPDLOCK) WHERE DocumentId=@Id AND CaseId=@CaseId AND StorageType='COURT_FORM' ORDER BY Id",doc,tx);
            var directory=doc.FormCode switch
            {
                "(๔)"=>(4,"คำฟ้อง"),"(๕)"=>(5,"คำขอท้ายคำฟ้องแพ่ง"),"(๖)"=>(6,"คำขอท้ายคำฟ้องอาญา"),
                "(๘)"=>(8,"บัญชีทรัพย์"),"(๙)"=>(9,"ใบแต่งทนายความ"),"(๑๐)"=>(10,"ใบมอบฉันทะ"),
                "(๑๑)" or "(๑๑ ก.)"=>(11,"คำให้การจำเลย"),"(๑๒)"=>(12,"หมายเรียกคดีมโนสาเร่"),
                "(๑๓)"=>(13,"หมายเรียกคดีแพ่งสามัญ"),"(๑๔)"=>(14,"หมายเรียกคดีอาญา"),
                "(๑๕)"=>(15,"บัญชีระบุพยาน"),_ => (7,"คำร้อง / คำแถลง / คำขอ")
            };
            var party=doc.PartyId is >0
                ? await c.QuerySingleOrDefaultAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE Id=@PartyId AND CaseId=@CaseId",doc,tx)
                : null;
            var partyLabel=party==null?"":$" · {party.PartySide}ที่ {party.PartyOrder} {party.FullName}";
            var fileTitle=$"{doc.DocumentTitle}{partyLabel}";
            if(fileTitle.Length>300)fileTitle=fileTitle[..300];
            var p=new{doc.CaseId,doc.Id,doc.FormCode,doc.DocumentTitle,doc.Status,fid,request.PageCount,fileTitle,directoryCategory=directory.Item2,ordinal=directory.Item1,actor=AccountSecurity.User(h).FullName};
            if(fid==0)fid=await c.QuerySingleAsync<int>("""
                INSERT INTO SL_CaseFileAttachments(CaseId,DocumentId,DirectoryIndexNo,FormCode,DirectoryCategoryName,FileTitle,StorageType,FileStatus,FileUrlOrPath,FileDataBase64,MimeType,PageCount,UploadedBy,Remark,CreatedAt)
                OUTPUT INSERTED.Id VALUES(@CaseId,@Id,@ordinal,@FormCode,@directoryCategory,@fileTitle,'COURT_FORM',@Status,'','','text/html',@PageCount,@actor,N'เอกสารจากสตูดิโอ แสดงเนื้อหาฉบับล่าสุดครบทุกหน้า',SYSUTCDATETIME())
                """,p,tx);
            else await c.ExecuteAsync("""
                UPDATE SL_CaseFileAttachments SET FormCode=@FormCode,DirectoryIndexNo=@ordinal,DirectoryCategoryName=@directoryCategory,FileTitle=@fileTitle,
                FileStatus=@Status,FileUrlOrPath='',FileDataBase64='',MimeType='text/html',PageCount=@PageCount,
                Remark=N'เอกสารจากสตูดิโอ แสดงเนื้อหาฉบับล่าสุดครบทุกหน้า' WHERE Id=@fid
                """,p,tx);
            tx.Commit();return Results.Ok(new{fileId=fid});
        });
        api.MapGet("/appointments/{id:int}",async(int id,HttpContext h,DatabaseService db)=>{
            using var c=db.CreateConnection();var a=await c.QuerySingleOrDefaultAsync<CaseAppointment>("SELECT * FROM SL_Appointments WHERE Id=@id",new{id});
            return a!=null&&Allowed(h,a.CaseId)?Results.Ok(a):Results.NotFound();
        });
        api.MapGet("/appointment-file-links",async(HttpContext h,DatabaseService db)=>{
            if(AccountSecurity.User(h).Role=="Admin")return Results.StatusCode(403);
            using var c=db.CreateConnection();
            return Results.Ok(await c.QueryAsync($"SELECT l.FileId AS fileId,a.Id AS appointmentId,a.CaseId AS caseId,a.Title AS title,a.StartsAt AS startsAt,a.Status AS status FROM SL_AppointmentFiles l JOIN SL_Appointments a ON a.Id=l.AppointmentId WHERE a.CaseId IN ({CapacitySupport.CaseScope})",AccountSecurity.User(h)));
        });
        api.MapGet("/appointments/{id:int}/files",async(int id,HttpContext h,DatabaseService db)=>{
            using var c=db.CreateConnection();var cid=await c.ExecuteScalarAsync<int>("SELECT CaseId FROM SL_Appointments WHERE Id=@id",new{id});
            if(!Allowed(h,cid))return Results.NotFound();
            return Results.Ok(await c.QueryAsync<CaseFileAttachment>($"SELECT {CapacitySupport.FileColumns} FROM SL_CaseFileAttachments f JOIN SL_AppointmentFiles l ON l.FileId=f.Id WHERE l.AppointmentId=@id AND f.CaseId=@cid ORDER BY l.CreatedAt,f.Id",new{id,cid}));
        });
        api.MapPost("/appointments/{id:int}/files",async(int id,AppointmentFileLink link,HttpContext h,DatabaseService db)=>{
            if((link.FileId>0)==(link.DocumentId>0))return Results.BadRequest(new{message="เลือกไฟล์หรือเอกสารอย่างใดอย่างหนึ่ง"});
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var cid=await c.ExecuteScalarAsync<int>("SELECT CaseId FROM SL_Appointments WITH(UPDLOCK) WHERE Id=@id",new{id},tx);
            if(!Allowed(h,cid))return Results.NotFound();
            var fid=link.FileId??0;
            if(link.DocumentId>0){
                var doc=await c.QuerySingleOrDefaultAsync<CaseDocument>("SELECT * FROM SL_CaseDocuments WITH(UPDLOCK) WHERE Id=@DocumentId AND CaseId=@cid",new{link.DocumentId,cid},tx);
                if(doc==null)return Results.NotFound();
                fid=await c.ExecuteScalarAsync<int>("SELECT TOP 1 Id FROM SL_CaseFileAttachments WITH(UPDLOCK) WHERE DocumentId=@Id AND CaseId=@CaseId AND StorageType='COURT_FORM' ORDER BY Id",doc,tx);
                if(fid==0)fid=await c.QuerySingleAsync<int>("""
                    INSERT INTO SL_CaseFileAttachments(CaseId,DocumentId,DirectoryIndexNo,FormCode,DirectoryCategoryName,FileTitle,StorageType,FileStatus,FileUrlOrPath,FileDataBase64,MimeType,PageCount,UploadedBy,Remark,CreatedAt)
                    OUTPUT INSERTED.Id VALUES(@CaseId,@Id,@ordinal,@FormCode,@DocumentTitle,@DocumentTitle,'COURT_FORM',@Status,'','','text/html',1,@actor,N'เชื่อมเอกสารจากสตูดิโอกับวันนัด แสดงฉบับล่าสุด',SYSUTCDATETIME())
                    """,new{doc.CaseId,doc.Id,doc.FormCode,doc.DocumentTitle,doc.Status,ordinal=int.TryParse(string.Concat(doc.FormCode.Where(char.IsDigit).Select(ch=>(int)char.GetNumericValue(ch))),out var n)?n:1,actor=AccountSecurity.User(h).FullName},tx);
            }
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseFileAttachments WHERE Id=@fid AND CaseId=@cid",new{fid,cid},tx)==0)return Results.NotFound();
            await c.ExecuteAsync("IF NOT EXISTS(SELECT 1 FROM SL_AppointmentFiles WHERE AppointmentId=@id AND FileId=@fid) INSERT INTO SL_AppointmentFiles(AppointmentId,FileId,CreatedBy) VALUES(@id,@fid,@actor)",new{id,fid,actor=AccountSecurity.User(h).Id},tx);
            tx.Commit();return Results.Ok(new{fileId=fid});
        });
        api.MapDelete("/appointments/{id:int}/files/{fileId:int}",async(int id,int fileId,HttpContext h,DatabaseService db)=>{
            using var c=db.CreateConnection();var cid=await c.ExecuteScalarAsync<int>("SELECT CaseId FROM SL_Appointments WHERE Id=@id",new{id});
            if(!Allowed(h,cid))return Results.NotFound();
            await c.ExecuteAsync("DELETE FROM SL_AppointmentFiles WHERE AppointmentId=@id AND FileId=@fileId",new{id,fileId});
            return Results.Ok(new{message="ยกเลิกการเชื่อมแล้ว ไฟล์ยังอยู่ในคลัง"});
        });
    }
}
