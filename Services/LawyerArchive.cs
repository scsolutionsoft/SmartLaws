using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace SmartLaws.Web.Services;

// A signed, versioned archive. SQL table/column names always come from the server schema.
public static class LawyerArchive
{
    const long MaxZip = 2L * 1024 * 1024 * 1024;
    const int MaxData = 512 * 1024 * 1024;
    static readonly string[] Tables = ["SL_LawCases","SL_CaseParties","SL_CaseDocuments","SL_CaseFileAttachments","SL_Appointments","SL_LitigationEvents","SL_AppointmentFiles","SL_ClientDocuments","SL_ClientCaseLinks","SL_ClientShares","SL_ClientChat","SL_PersonalDocuments","SL_PaymentSlips","SL_Messages","SL_LawyerClerkMappings","SL_ElectronicSignatures"];
    public record DeleteInput(string Receipt, bool Saved, string Confirmation);
    record Receipt(int UserId,int AdminId,string Hash,DateTimeOffset Expires);
    record LoadedArchive(JsonObject Envelope,string TempPath);
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c=db.CreateConnection();
        await c.ExecuteAsync("""
            IF OBJECT_ID('SL_LawyerRestores') IS NULL CREATE TABLE SL_LawyerRestores(
                ArchiveId uniqueidentifier PRIMARY KEY,SourceUserId int NOT NULL,TargetUserId int NOT NULL,
                AdminId int NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
            IF OBJECT_ID('SL_LawyerRestoreCases') IS NULL CREATE TABLE SL_LawyerRestoreCases(
                SourceUserId int NOT NULL,SourceCaseId int NOT NULL,TargetCaseId int NOT NULL,
                PRIMARY KEY(SourceUserId,SourceCaseId));
            """);
    }
    static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes));
    static int Id(JsonObject row,string key="Id")=>row[key]?.GetValue<int>()??0;
    static string Str(JsonObject row,string key)=>row[key]?.GetValue<string>()??"";
    static JsonObject Obj(JsonNode? node)=>node as JsonObject??throw new InvalidDataException("โครงสร้างไฟล์ไม่ถูกต้อง");
    static IEnumerable<JsonObject> Rows(JsonObject data,string table)=>(data["tables"]?[table]?.AsArray()??throw new InvalidDataException("ตารางข้อมูลไม่ครบ")).Select(Obj);
    static async Task<JsonArray> Query(SqlConnection c,SqlTransaction tx,string sql,object args)
    {
        var rows=await c.QueryAsync(sql,args,tx);
        return JsonSerializer.SerializeToNode(rows.Select(r=>(IDictionary<string,object>)r).ToList())!.AsArray();
    }
    static async Task<JsonObject> Snapshot(SqlConnection c,SqlTransaction tx,int userId)
    {
        var users=await Query(c,tx,"SELECT * FROM SL_UserAccounts WITH(UPDLOCK,HOLDLOCK) WHERE Id=@userId AND Role='Lawyer'",new{userId});
        if(users.Count!=1)throw new InvalidDataException("ไม่พบบัญชีทนาย");
        var user=Obj(users[0]);user.Remove("PasswordHash");var profileId=Id(user,"LawyerProfileId");
        if(profileId<=0||await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE LawyerProfileId=@profileId",new{profileId},tx)!=1)
            throw new InvalidDataException("บัญชีใช้ข้อมูลประวัติร่วมกับบัญชีอื่น กรุณาตรวจสอบก่อนสำรองหรือลบ");
        var profiles=await Query(c,tx,"SELECT * FROM SL_LawyerProfiles WHERE Id=@profileId",new{profileId});
        if(profiles.Count!=1)throw new InvalidDataException("ไม่พบประวัติทนาย");
        var args=new{userId,profileId,name=Str(user,"FullName")};var tables=new JsonObject();
        var owned="SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@profileId";
        foreach(var table in Tables){
            var condition=table switch {
                "SL_LawCases"=>"PrimaryLawyerId=@profileId",
                "SL_AppointmentFiles"=>$"AppointmentId IN(SELECT Id FROM SL_Appointments WHERE CaseId IN({owned}))",
                "SL_PersonalDocuments" or "SL_PaymentSlips"=>"UserId=@userId",
                "SL_Messages"=>"UserId=@userId OR SenderId=@userId",
                "SL_LawyerClerkMappings"=>"LawyerUserId=@userId",
                "SL_ElectronicSignatures"=>"SignerName=@name",
                _=>$"CaseId IN({owned})"
            };
            var order=table switch {"SL_AppointmentFiles"=>"AppointmentId,FileId","SL_ClientDocuments"=>"FileId","SL_ClientCaseLinks"=>"UserId,CaseId","SL_ClientShares"=>"ClientUserId,FileId",_=>"Id"};
            tables[table]=await Query(c,tx,$"SELECT * FROM {table} WHERE {condition} ORDER BY {order}",args);
        }
        var clients=await Query(c,tx,$"SELECT i.UserId,i.CitizenNumber,i.MustChangePassword,u.Username,u.FullName FROM SL_ClientIdentities i JOIN SL_UserAccounts u ON u.Id=i.UserId WHERE i.UserId IN(SELECT UserId FROM SL_ClientCaseLinks WHERE CaseId IN({owned})) ORDER BY i.UserId",args);
        return new JsonObject{["version"]=1,["user"]=user.DeepClone(),["profile"]=profiles[0]!.DeepClone(),["clients"]=clients,["tables"]=tables};
    }
    static object Summary(JsonObject data)=>new {
        sourceUserId=Id(Obj(data["user"])),name=Str(Obj(data["user"]),"FullName"),username=Str(Obj(data["user"]),"Username"),
        licenseNo=Str(Obj(data["user"]),"LicenseNo"),cases=Rows(data,"SL_LawCases").Count(),
        files=Rows(data,"SL_CaseFileAttachments").Count(),documents=Rows(data,"SL_CaseDocuments").Count(),
        appointments=Rows(data,"SL_Appointments").Count(),clients=data["clients"]!.AsArray().Count,
        personalDocuments=Rows(data,"SL_PersonalDocuments").Count(),usedCredits=Id(Obj(data["user"]),"UsedCasesCount")};
    static void Entry(ZipArchive zip,string name,byte[] bytes){using var s=zip.CreateEntry(name).Open();s.Write(bytes);}
    static string[] StorageKeys(JsonObject data)
    {
        return Rows(data,"SL_CaseFileAttachments").Select(r=>Str(r,"StorageKey"))
            .Concat(Rows(data,"SL_PersonalDocuments").Select(r=>Str(r,"StorageKey")))
            .Concat(Rows(data,"SL_PaymentSlips").Select(r=>Str(r,"SlipStorageKey")))
            .Where(k=>k.Length>0).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
    }
    static async Task<string> Fingerprint(byte[] data,IEnumerable<string> storageKeys,Func<string,Stream> open)
    {
        var keys=storageKeys.ToArray();
        if(keys.Length==0)return Hash(data);
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(data);
        var buffer=new byte[81920];
        foreach(var key in keys)
        {
            if(!FileStorage.IsValidKey(key))throw new InvalidDataException("รหัสไฟล์ในข้อมูลสำรองไม่ถูกต้อง");
            var name=Encoding.UTF8.GetBytes(key);hash.AppendData(BitConverter.GetBytes(name.Length));hash.AppendData(name);
            await using var stream=open(key);
            long length=0;int read;while((read=await stream.ReadAsync(buffer))>0){hash.AppendData(buffer.AsSpan(0,read));length+=read;}
            hash.AppendData(BitConverter.GetBytes(length));
        }
        return Convert.ToHexString(hash.GetHashAndReset());
    }
    static Task<string> DataFingerprint(JsonObject data,FileStorage storage) =>
        Fingerprint(JsonSerializer.SerializeToUtf8Bytes(data),StorageKeys(data),storage.OpenRead);
    static async Task<byte[]> Limited(Stream stream,int limit)
    {
        using var memory=new MemoryStream();var buffer=new byte[81920];int count;
        while((count=await stream.ReadAsync(buffer))>0){if(memory.Length+count>limit)throw new InvalidDataException("ไฟล์มีขนาดเกินขีดจำกัด");await memory.WriteAsync(buffer.AsMemory(0,count));}
        return memory.ToArray();
    }
    static async Task<LoadedArchive> Load(HttpContext h,IDataProtectionProvider protection)
    {
        var feature=h.Features.Get<IHttpMaxRequestBodySizeFeature>();if(feature is {IsReadOnly:false})feature.MaxRequestBodySize=MaxZip;
        var tempPath=Path.Combine(Path.GetTempPath(),$"smartlaws-lawyer-archive-{Guid.NewGuid():N}.zip");
        var complete=false;
        try
        {
            await using(var output=new FileStream(tempPath,FileMode.CreateNew,FileAccess.Write,FileShare.None,81920,FileOptions.Asynchronous|FileOptions.SequentialScan))
            {
                var buffer=new byte[81920];long total=0;int read;
                while((read=await h.Request.Body.ReadAsync(buffer,h.RequestAborted))>0)
                {
                    total+=read;if(total>MaxZip)throw new InvalidDataException("ไฟล์สำรองต้องมีขนาดไม่เกิน 2 GB");
                    await output.WriteAsync(buffer.AsMemory(0,read),h.RequestAborted);
                }
            }
            using var archiveStream=File.OpenRead(tempPath);
            using var zip=new ZipArchive(archiveStream,ZipArchiveMode.Read);
            var entry=zip.GetEntry("lawyer-data.json")??throw new InvalidDataException("ไม่พบข้อมูลสำรองทนาย");
            if(entry.Length>MaxData)throw new InvalidDataException("ข้อมูลขนาดใหญ่เกินขีดจำกัด");
            using var stream=entry.Open();var json=await Limited(stream,MaxData);
            var envelope=Obj(JsonNode.Parse(json));
            if(envelope["version"]?.GetValue<int>()!=1||!Guid.TryParse(Str(envelope,"archiveId"),out _))throw new InvalidDataException("เวอร์ชันไฟล์ไม่รองรับ");
            var data=Obj(envelope["data"]);var keys=StorageKeys(data);
            var expected=new HashSet<string>(StringComparer.Ordinal){"lawyer-data.json","signature.txt","README.txt"};
            foreach(var key in keys)expected.Add("files/"+key);
            if(zip.Entries.Count!=expected.Count||zip.Entries.Any(e=>!expected.Remove(e.FullName)))throw new InvalidDataException("รายการไฟล์ใน ZIP ไม่ตรงกับข้อมูลสำรอง");
            foreach(var key in keys)
            {
                var file=zip.GetEntry("files/"+key)!;
                if(file.Length>FileStorage.MaxFileBytes)throw new InvalidDataException("ไฟล์ใน ZIP มีขนาดเกิน 1 GB");
            }
            using var signature=(zip.GetEntry("signature.txt")??throw new InvalidDataException("ไม่มีลายเซ็นตรวจสอบไฟล์")).Open();
            var signed=Encoding.UTF8.GetString(await Limited(signature,16384));
            var fingerprint=await Fingerprint(json,keys,key=>zip.GetEntry("files/"+key)!.Open());
            if(protection.CreateProtector("SmartLaws.LawyerArchive.File.v1").Unprotect(signed)!=fingerprint)throw new InvalidDataException("ข้อมูลสำรองถูกแก้ไข");
            complete=true;return new(envelope,tempPath);
        }
        finally{if(!complete&&File.Exists(tempPath))File.Delete(tempPath);}
    }
    static bool Admin(HttpContext h)=>AccountSecurity.User(h).Role=="Admin";
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/admin/lawyer-archives/{id:int}",async(int id,HttpContext h,DatabaseService db)=>{
            if(!Admin(h))return Results.StatusCode(403);
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            try{var data=await Snapshot(c,tx,id);tx.Commit();return Results.Ok(Summary(data));}catch(InvalidDataException e){return Results.BadRequest(new{message=e.Message});}
        });
        api.MapGet("/admin/lawyer-archives/{id:int}/backup",async(int id,HttpContext h,DatabaseService db,IDataProtectionProvider protection,FileStorage storage)=>{
            if(!Admin(h))return Results.StatusCode(403);
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var tempPath=Path.Combine(Path.GetTempPath(),$"smartlaws-lawyer-backup-{Guid.NewGuid():N}.zip");var transferred=false;
            try{
                var data=await Snapshot(c,tx,id);var fingerprint=await DataFingerprint(data,storage);
                var envelope=new JsonObject{["version"]=1,["archiveId"]=Guid.NewGuid().ToString(),["createdAt"]=DateTimeOffset.UtcNow.ToString("O"),["data"]=data};
                var json=JsonSerializer.SerializeToUtf8Bytes(envelope);if(json.Length>MaxData)throw new InvalidDataException("ข้อมูลเกิน 512 MB กรุณาติดต่อผู้ดูแลระบบจัดเก็บ");
                await using(var output=new FileStream(tempPath,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None,81920,FileOptions.Asynchronous|FileOptions.SequentialScan))
                using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)){
                    Entry(zip,"lawyer-data.json",json);
                    var archiveHash=await Fingerprint(json,StorageKeys(data),storage.OpenRead);
                    Entry(zip,"signature.txt",Encoding.UTF8.GetBytes(protection.CreateProtector("SmartLaws.LawyerArchive.File.v1").Protect(archiveHash)));
                    Entry(zip,"README.txt",Encoding.UTF8.GetBytes("SmartLaws: สำรองทนายและคดี สำหรับกู้คืนผ่านเมนูแอดมินเท่านั้น\nห้ามแก้ไข JSON หรือลายเซ็นตรวจสอบ เก็บ ZIP และ Data Protection key ring ของระบบไว้ในที่ปลอดภัย\nไฟล์ที่อัปโหลดรวมอยู่ในโฟลเดอร์ files/ ไม่รวมรหัสผ่านและเซสชัน\nลิงก์ภายนอกเก็บเฉพาะ URL ไม่ได้ดาวน์โหลดเนื้อหาปลายทาง\n"));
                    foreach(var key in StorageKeys(data)){
                        await using var input=storage.OpenRead(key);await using var target=zip.CreateEntry("files/"+key,CompressionLevel.Fastest).Open();
                        await input.CopyToAsync(target,81920,h.RequestAborted);
                    }
                }
                if(new FileInfo(tempPath).Length>MaxZip)throw new InvalidDataException("ZIP เกิน 2 GB ไม่สามารถนำเข้าผ่านหน้าจอได้");
                await c.ExecuteAsync("INSERT INTO SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'LAWYER_BACKUP',@resource)",new{actor=AccountSecurity.User(h).Id,resource=$"lawyer:{id}"},tx);tx.Commit();
                h.Response.Headers["X-Lawyer-Backup-Receipt"]=protection.CreateProtector("SmartLaws.LawyerArchive.Delete.v1").Protect(JsonSerializer.Serialize(new Receipt(id,AccountSecurity.User(h).Id,fingerprint,DateTimeOffset.UtcNow.AddMinutes(30))));
                var name=string.Concat(Str(Obj(data["user"]),"FullName").Take(80).Select(ch=>char.IsControl(ch)||"<>:\"/\\|?*".Contains(ch)?'-':ch));
                h.Response.OnCompleted(()=>{if(File.Exists(tempPath))File.Delete(tempPath);return Task.CompletedTask;});
                transferred=true;
                return Results.File(new FileStream(tempPath,FileMode.Open,FileAccess.Read,FileShare.Read,81920,FileOptions.Asynchronous|FileOptions.SequentialScan),"application/zip",$"ทนาย-{name}_{DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(7)):dd-MM-yyyy_HH-mm-ss}.zip",enableRangeProcessing:true);
            }catch(InvalidDataException e){return Results.BadRequest(new{message=e.Message});}
            finally{if(!transferred&&File.Exists(tempPath))File.Delete(tempPath);}
        });
        api.MapDelete("/admin/lawyer-archives/{id:int}",async(int id,[FromBody] DeleteInput input,HttpContext h,DatabaseService db,IDataProtectionProvider protection,FileStorage storage)=>{
            if(!Admin(h))return Results.StatusCode(403);
            if(!input.Saved||input.Confirmation!="ลบทนายและคดีทั้งหมด")return Results.BadRequest(new{message="ต้องดาวน์โหลดและตรวจสอบ ZIP พร้อมยืนยันการลบ"});
            Receipt? receipt;try{receipt=JsonSerializer.Deserialize<Receipt>(protection.CreateProtector("SmartLaws.LawyerArchive.Delete.v1").Unprotect(input.Receipt??""));}catch(Exception e)when(e is CryptographicException or JsonException){return Results.BadRequest(new{message="กรุณาดาวน์โหลดสำรองใหม่"});}
            if(receipt==null||receipt.UserId!=id||receipt.AdminId!=AccountSecurity.User(h).Id||receipt.Expires<DateTimeOffset.UtcNow)return Results.BadRequest(new{message="หลักฐานสำรองหมดอายุหรือไม่ตรงบัญชี"});
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            try{
                var data=await Snapshot(c,tx,id);if(await DataFingerprint(data,storage)!=receipt.Hash)return Results.Conflict(new{message="ข้อมูลเปลี่ยนหลังสำรอง กรุณาดาวน์โหลด ZIP ใหม่ก่อนลบ"});
                var storageKeys=StorageKeys(data);
                var ids=Rows(data,"SL_LawCases").Select(r=>Id(r)).ToArray();var profileId=Id(Obj(data["user"]),"LawyerProfileId");
                await c.ExecuteAsync("UPDATE SL_Consultations SET AssignedLawyerProfileId=NULL,Status=N'Closed',UpdatedAt=SYSUTCDATETIME() WHERE AssignedLawyerProfileId=@profileId",new{profileId},tx);
                await c.ExecuteAsync("DELETE FROM SL_Sessions WHERE UserId IN(SELECT UserId FROM SL_ClientCaseLinks WHERE CaseId IN @ids) AND NOT EXISTS(SELECT 1 FROM SL_ClientCaseLinks a WHERE a.UserId=SL_Sessions.UserId AND a.CaseId NOT IN @ids AND a.IsActive=1)",new{ids},tx);
                foreach(var table in Tables.Reverse()){
                    var rows=Rows(data,table).ToArray();if(rows.Length==0)continue;
                    if(table=="SL_ElectronicSignatures"){
                        // Name-based legacy signature ownership may be shared: preserve those shared records.
                        await c.ExecuteAsync("DELETE FROM SL_ElectronicSignatures WHERE Id IN @keys AND NOT EXISTS(SELECT 1 FROM SL_UserAccounts WHERE Id<>@id AND FullName=@name)",new{keys=rows.Select(r=>Id(r)).ToArray(),id,name=Str(Obj(data["user"]),"FullName")},tx);
                    }else if(table=="SL_AppointmentFiles")await c.ExecuteAsync("DELETE FROM SL_AppointmentFiles WHERE AppointmentId IN @keys",new{keys=Rows(data,"SL_Appointments").Select(r=>Id(r)).ToArray()},tx);
                    else if(table is "SL_ClientShares" or "SL_ClientCaseLinks" or "SL_ClientDocuments")await c.ExecuteAsync($"DELETE FROM {table} WHERE CaseId IN @ids",new{ids},tx);
                    else await c.ExecuteAsync($"DELETE FROM {table} WHERE Id IN @keys",new{keys=rows.Select(r=>Id(r)).ToArray()},tx);
                }
                await c.ExecuteAsync("DELETE FROM SL_Sessions WHERE UserId=@id; DELETE FROM SL_UserAccounts WHERE Id=@id; DELETE FROM SL_LawyerProfiles WHERE Id=@profileId; INSERT INTO SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'LAWYER_DELETE',@resource)",new{id,profileId,actor=AccountSecurity.User(h).Id,resource=$"lawyer:{id}; cases:{ids.Length}"},tx);
                tx.Commit();foreach(var key in storageKeys)storage.Delete(key);return Results.Ok(new{deleted=true,cases=ids.Length});
            }catch(InvalidDataException e){return Results.BadRequest(new{message=e.Message});}
        });
        api.MapPost("/admin/lawyer-archives/preview",async(HttpContext h,IDataProtectionProvider protection)=>{
            if(!Admin(h))return Results.StatusCode(403);
            LoadedArchive? loaded=null;
            try{loaded=await Load(h,protection);var envelope=loaded.Envelope;return Results.Ok(new{archiveId=Str(envelope,"archiveId"),createdAt=Str(envelope,"createdAt"),summary=Summary(Obj(envelope["data"]))});}
            catch(Exception e)when(e is InvalidDataException or CryptographicException or JsonException or FormatException){return Results.BadRequest(new{message="อ่านไฟล์ไม่สำเร็จ: ZIP ไม่ถูกต้อง ถูกแก้ไข หรือไม่มีคีย์เดิมของระบบ"});}
            finally{if(loaded!=null&&File.Exists(loaded.TempPath))File.Delete(loaded.TempPath);}
        });
        api.MapPost("/admin/lawyer-archives/{id:int}/restore",async(int id,HttpContext h,DatabaseService db,IDataProtectionProvider protection,FileStorage storage)=>{
            if(!Admin(h))return Results.StatusCode(403);
            if(h.Request.Headers["X-Restore-Confirmation"]!="RESTORE")return Results.BadRequest(new{message="ยืนยันบัญชีปลายทางก่อนกู้คืน"});
            LoadedArchive? loaded=null;
            try{loaded=await Load(h,protection);return await Restore(id,loaded.Envelope,loaded.TempPath,h,db,storage);}
            catch(Exception e)when(e is InvalidDataException or CryptographicException or JsonException or FormatException){return Results.BadRequest(new{message=e is InvalidDataException?e.Message:"ไฟล์สำรองไม่ถูกต้องหรือไม่ผ่านการตรวจสอบ"});}
            finally{if(loaded!=null&&File.Exists(loaded.TempPath))File.Delete(loaded.TempPath);}
        });
    }
    class Column { public string Name {get;set;}="";public string Type {get;set;}="";public bool Identity {get;set;} }
    static object? Value(JsonNode? node,string type)
    {
        if(node==null)return null;
        return type switch {
            "int"=>node.GetValue<int>(),"bigint"=>node.GetValue<long>(),"bit"=>node.GetValue<bool>(),
            "decimal" or "numeric" or "money"=>node.GetValue<decimal>(),
            "datetime" or "datetime2" or "date"=>DateTime.Parse(node.GetValue<string>(),System.Globalization.CultureInfo.InvariantCulture),
            "datetimeoffset"=>DateTimeOffset.Parse(node.GetValue<string>(),System.Globalization.CultureInfo.InvariantCulture),
            "uniqueidentifier"=>Guid.Parse(node.GetValue<string>()),"varbinary" or "binary"=>Convert.FromBase64String(node.GetValue<string>()),
            _=>node.GetValue<string>()};
    }
    static async Task<int> Insert(SqlConnection c,SqlTransaction tx,string table,JsonObject row)
    {
        var columns=(await c.QueryAsync<Column>("SELECT c.name Name,t.name Type,c.is_identity [Identity] FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(@table) AND c.is_computed=0",new{table},tx)).ToArray();
        var selected=columns.Where(x=>!x.Identity&&row.ContainsKey(x.Name)).ToArray();var args=new DynamicParameters();
        foreach(var col in selected)args.Add(col.Name,Value(row[col.Name],col.Type));
        var sql=$"INSERT INTO [{table}]({string.Join(',',selected.Select(x=>$"[{x.Name}]"))}) "+(columns.Any(x=>x.Identity)?"OUTPUT INSERTED.Id ":"")+$"VALUES({string.Join(',',selected.Select(x=>"@"+x.Name))})";
        if(columns.Any(x=>x.Identity))return await c.QuerySingleAsync<int>(sql,args,tx);
        await c.ExecuteAsync(sql,args,tx);return 0;
    }
    static async Task<IResult> Restore(int targetId,JsonObject envelope,string archivePath,HttpContext h,DatabaseService db,FileStorage storage)
    {
        var data=Obj(envelope["data"]);var source=Obj(data["user"]);var sourceId=Id(source);var archiveId=Guid.Parse(Str(envelope,"archiveId"));
        var storageKeys=StorageKeys(data);var restoredKeys=new List<string>();var committed=false;
        try
        {
        using(var archive=ZipFile.OpenRead(archivePath))
        foreach(var key in storageKeys)
        {
            var entry=archive.GetEntry("files/"+key)??throw new InvalidDataException("ไม่พบไฟล์แนบใน ZIP สำรอง");
            await using var stream=entry.Open();
            await storage.SaveWithKeyAsync(stream,key,entry.Length,h.RequestAborted);
            restoredKeys.Add(key);
        }
        using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
        var target=await c.QuerySingleOrDefaultAsync<Models.UserAccount>("SELECT * FROM SL_UserAccounts WITH(UPDLOCK,HOLDLOCK) WHERE Id=@targetId AND Role='Lawyer'",new{targetId},tx);
        if(target==null)throw new InvalidDataException("เลือกบัญชีทนายปลายทางที่สมัครไว้แล้ว");
        if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawCases WHERE PrimaryLawyerId=@LawyerProfileId",target,tx)>0||await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_PersonalDocuments WHERE UserId=@targetId",new{targetId},tx)>0)
            throw new InvalidDataException("บัญชีปลายทางต้องไม่มีคดีหรือเอกสารส่วนตัว เพื่อไม่เขียนทับข้อมูลเดิม");
        if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE LawyerProfileId=@LawyerProfileId",target,tx)!=1)throw new InvalidDataException("ประวัติทนายปลายทางถูกใช้งานร่วมกัน");
        if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawyerRestores WHERE ArchiveId=@archiveId",new{archiveId},tx)>0)throw new InvalidDataException("ไฟล์นี้เคยกู้คืนแล้ว");
        if(sourceId!=targetId&&await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Id=@sourceId",new{sourceId},tx)>0)
            throw new InvalidDataException("บัญชีต้นทางยังอยู่ กรุณาจัดการบัญชีต้นทางก่อนกู้คืนไปบัญชีใหม่");
        var originalIds=Rows(data,"SL_LawCases").Select(r=>Id(r)).ToArray();
        if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawCases WHERE Id IN @originalIds",new{originalIds},tx)>0||await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawyerRestoreCases WHERE SourceUserId=@sourceId AND SourceCaseId IN @originalIds",new{sourceId,originalIds},tx)>0)
            throw new InvalidDataException("คดีต้นทางยังอยู่ในระบบหรือเคยกู้คืนแล้ว ไม่สามารถนำเข้าซ้ำ");
        // Preserve current login, subscription and purchased quota; never refund historical usage.
        await c.ExecuteAsync("UPDATE SL_UserAccounts SET UsedCasesCount=CASE WHEN UsedCasesCount<@used THEN @used ELSE UsedCasesCount END WHERE Id=@targetId",new{targetId,used=Id(source,"UsedCasesCount")},tx);
        await c.ExecuteAsync("UPDATE SL_UserAccounts SET FullName=@name,LicenseNo=@license,CitizenId=@citizen,Phone=@phone,Email=@email,OfficeName=@office WHERE Id=@targetId",new{targetId,name=Str(source,"FullName"),license=Str(source,"LicenseNo"),citizen=Str(source,"CitizenId"),phone=Str(source,"Phone"),email=Str(source,"Email"),office=Str(source,"OfficeName")},tx);
        target.FullName=Str(source,"FullName");
        var profile=Obj(data["profile"]);var profileColumns=await c.QueryAsync<Column>("SELECT c.name Name,t.name Type,c.is_identity [Identity] FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID('SL_LawyerProfiles') AND c.is_identity=0 AND c.is_computed=0",transaction:tx);
        var profileArgs=new DynamicParameters(new{id=target.LawyerProfileId});var assignments=new List<string>();
        foreach(var col in profileColumns.Where(x=>profile.ContainsKey(x.Name))){assignments.Add($"[{col.Name}]=@{col.Name}");profileArgs.Add(col.Name,Value(profile[col.Name],col.Type));}
        await c.ExecuteAsync($"UPDATE SL_LawyerProfiles SET {string.Join(',',assignments)} WHERE Id=@id",profileArgs,tx);
        var userMap=new Dictionary<int,int>{{sourceId,targetId}};
        foreach(var node in data["clients"]!.AsArray()){
            var client=Obj(node);int old=Id(client,"UserId");var number=Str(client,"CitizenNumber");
            var existing=await c.ExecuteScalarAsync<int?>("SELECT i.UserId FROM SL_ClientIdentities i JOIN SL_UserAccounts u ON u.Id=i.UserId AND u.Role='Client' WHERE (@number<>'' AND i.CitizenNumber=@number) OR (@number='' AND i.UserId=@old AND u.Username=@username)",new{number,old,username=Str(client,"Username")},tx);
            if(existing.HasValue){userMap[old]=existing.Value;continue;}
            var username=number.Length>0?number:Str(client,"Username");
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Username=@username",new{username},tx)>0)throw new InvalidDataException("ชื่อผู้ใช้ลูกความชนกับบัญชีอื่น กรุณาตรวจสอบก่อนกู้คืน");
            var newId=await c.QuerySingleAsync<int>("INSERT INTO SL_UserAccounts(Username,PasswordHash,FullName,Role,MaxCasesQuota,AccountStatus) OUTPUT INSERTED.Id VALUES(@username,@hash,@name,'Client',0,'Active')",new{username,hash=AccountSecurity.Hash(number.Length>0?number:Guid.NewGuid().ToString("N")),name=Str(client,"FullName")},tx);
            await c.ExecuteAsync("INSERT INTO SL_ClientIdentities(UserId,CitizenNumber,MustChangePassword) VALUES(@newId,@number,1)",new{newId,number=number.Length>0?number:null},tx);userMap[old]=newId;
        }
        var maps=new Dictionary<string,Dictionary<int,int>>();
        int Remap(string table,int old)=>maps.TryGetValue(table,out var map)&&map.TryGetValue(old,out var value)?value:throw new InvalidDataException("ความสัมพันธ์ข้อมูลไม่ครบ: "+table);
        foreach(var table in Tables){
            maps[table]=new();
            foreach(var original in Rows(data,table)){
                var row=(JsonObject)original.DeepClone();var oldId=Id(row);
                void Ref(string key,string parent){if(row[key]!=null&&Id(row,key)>0)row[key]=Remap(parent,Id(row,key));}
                if(table=="SL_LawCases"){row["PrimaryLawyerId"]=target.LawyerProfileId;row["ClerkId"]=0;}
                else Ref("CaseId","SL_LawCases");
                Ref("PartyId","SL_CaseParties");Ref("DocumentId","SL_CaseDocuments");Ref("FileId","SL_CaseFileAttachments");Ref("AttachmentId","SL_CaseFileAttachments");Ref("AppointmentId","SL_Appointments");
                foreach(var key in new[]{"UserId","ClientUserId","SenderId","CreatedBy","LawyerUserId"}){
                    if(row[key]==null)continue;var old=Id(row,key);
                    if(userMap.TryGetValue(old,out var mapped))row[key]=mapped;
                    else if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Id=@old",new{old},tx)==0)row[key]=AccountSecurity.User(h).Id;
                }
                if(table=="SL_LawyerClerkMappings"){
                    if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Id=@id AND Role='Clerk'",new{id=Id(row,"ClerkUserId")},tx)==0)continue;
                    row["IsActive"]=false;row["LawyerFullName"]=target.FullName;
                }
                if(table=="SL_PaymentSlips")row["UserFullName"]=target.FullName;
                if(table=="SL_ElectronicSignatures"&&await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ElectronicSignatures WHERE SignerName=@name AND ImageDataUrl=@image",new{name=Str(row,"SignerName"),image=Str(row,"ImageDataUrl")},tx)>0)continue;
                var newId=await Insert(c,tx,table,row);if(oldId>0)maps[table][oldId]=newId;
                if(table=="SL_LawCases")await c.ExecuteAsync("INSERT INTO SL_LawyerRestoreCases(SourceUserId,SourceCaseId,TargetCaseId) VALUES(@sourceId,@oldId,@newId)",new{sourceId,oldId,newId},tx);
            }
        }
        await c.ExecuteAsync("DELETE FROM SL_Sessions WHERE UserId=@targetId; INSERT INTO SL_LawyerRestores(ArchiveId,SourceUserId,TargetUserId,AdminId) VALUES(@archiveId,@sourceId,@targetId,@actor); INSERT INTO SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'LAWYER_RESTORE',@resource)",new{targetId,archiveId,sourceId,actor=AccountSecurity.User(h).Id,resource=$"archive:{archiveId}; target:{targetId}; cases:{originalIds.Length}"},tx);
        tx.Commit();committed=true;return Results.Ok(new{restored=true,cases=originalIds.Length});
        }
        finally{if(!committed)foreach(var key in restoredKeys)storage.Delete(key);}
    }
}
