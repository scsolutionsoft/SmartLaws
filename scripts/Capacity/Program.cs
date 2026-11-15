using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Services;

// Run only against the local development database. Fixtures are isolated by a random prefix.
var root=Directory.GetCurrentDirectory();
var settings=JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(root,"appsettings.json")))!;
using var db=new SqlConnection(settings["ConnectionStrings"]!["DefaultConnection"]!.GetValue<string>());
await db.OpenAsync();
const int accounts=800, active=200, rounds=10;
var prefix="capacity"+Guid.NewGuid().ToString("N")[..12];
var testBaseUrl=Environment.GetEnvironmentVariable("SMARTLAWS_TEST_BASE_URL")??"http://localhost:5088";
var password=Guid.NewGuid().ToString("N");
var hash=AccountSecurity.Hash(password);
var payload=RandomNumberGenerator.GetBytes(64*1024); Encoding.ASCII.GetBytes("%PDF-1.4\n").CopyTo(payload,0);
var base64=Convert.ToBase64String(payload);
var samples=new ConcurrentBag<Sample>();
var uploadedFiles=new ConcurrentBag<(int ClientIndex,int FileId)>();
var clients=new List<HttpClient>();
var failures=new ConcurrentBag<string>();
var suite=Stopwatch.StartNew();
int inflight=0, peak=0;
void Check(bool condition,string message) { if(!condition) throw new Exception(message); }
async Task<byte[]> Request(HttpClient client,string name,string path,object? body=null)
{
    int current=Interlocked.Increment(ref inflight);int observed;
    do {observed=peak;if(observed>=current)break;}while(Interlocked.CompareExchange(ref peak,current,observed)!=observed);
    var watch=Stopwatch.StartNew();int status=0;long size=0;
    try {
        using var req=new HttpRequestMessage(body==null?HttpMethod.Get:HttpMethod.Post,path);
        if(body!=null)req.Content=JsonContent.Create(body);
        using var res=await client.SendAsync(req);
        status=(int)res.StatusCode;var bytes=await res.Content.ReadAsByteArrayAsync();size=bytes.Length;
        Check(res.IsSuccessStatusCode,$"{name}: HTTP {status}");return bytes;
    } finally {samples.Add(new(name,watch.Elapsed.TotalMilliseconds,status,size));Interlocked.Decrement(ref inflight);}
}
try {
    // Decoder boundaries, legacy raw/data-URL storage, and large streamed payloads.
    foreach(int length in new[]{0,1,2,3,6143,6144,6145,1024*1024,10*1024*1024}) {
        var bytes=RandomNumberGenerator.GetBytes(length);
        foreach(var header in new[]{"","data:application/pdf;base64,"}) {
            using var output=new MemoryStream();
            await CapacitySupport.DecodeBase64Async(new StringReader(header+Convert.ToBase64String(bytes)),output,default);
            Check(output.ToArray().SequenceEqual(bytes),$"Streaming decoder boundary {length}");
        }
    }
    await db.ExecuteAsync("""
        ;WITH n AS (SELECT TOP (@accounts) ROW_NUMBER() OVER(ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
        INSERT INTO SL_LawyerProfiles(FullName,RoleType) SELECT CONCAT(@prefix,n),'Lawyer' FROM n;
        INSERT INTO SL_UserAccounts(Username,FullName,PasswordHash,Role,LawyerProfileId,Email,UsedCasesCount)
        SELECT FullName,FullName,@hash,'Lawyer',Id,CONCAT(FullName,'@example.invalid'),1 FROM SL_LawyerProfiles WHERE FullName LIKE @pattern;
        INSERT INTO SL_LawCases(CaseCode,CourtName,CaseCategory,LawyerRole,PrimaryLawyerId,ClerkId,PlaintiffName,DefendantName)
        SELECT Username,N'ศาลทดสอบ',N'แพ่ง',N'ทนายโจทก์',LawyerProfileId,0,Username,N'Test defendant' FROM SL_UserAccounts WHERE Username LIKE @pattern;
        INSERT INTO SL_CaseDocuments(CaseId,FormCode,DocumentTitle,ClausesJson)
        SELECT Id,N'(๔)',@prefix,N'[{"ClauseTitle":"1","Content":"Synthetic load test"}]' FROM SL_LawCases WHERE CaseCode LIKE @pattern;
        INSERT INTO SL_LitigationEvents(CaseId,Stage,CourtLevel,CourtName,ReferenceNo,EventDate,DeadlineBasis,Summary,Outcome,Status,CreatedBy)
        SELECT c.Id,N'คำพิพากษา',N'ศาลชั้นต้น',N'ศาลทดสอบ','TEST',CAST(GETDATE() AS date),'',@prefix,'',N'ร่าง',u.Id
        FROM SL_LawCases c JOIN SL_UserAccounts u ON u.LawyerProfileId=c.PrimaryLawyerId WHERE c.CaseCode LIKE @pattern;
        INSERT INTO SL_CaseFileAttachments(CaseId,DirectoryIndexNo,FormCode,DirectoryCategoryName,FileTitle,StorageType,FileStatus,FileDataBase64,MimeType,PageCount,UploadedBy)
        SELECT TOP (@active) Id,31,N'(๓๑)',N'คำพิพากษา',@prefix,'PDF',N'ร่าง',
          CASE WHEN Id%2=0 THEN CONCAT('data:application/pdf;base64,',@base64) ELSE @base64 END,'application/pdf',1,@prefix
        FROM SL_LawCases WHERE CaseCode LIKE @pattern ORDER BY Id;
        """, new{accounts,active,prefix,pattern=prefix+"%",hash,base64},commandTimeout:120);
    var records=(await db.QueryAsync<Fixture>("""
        SELECT TOP (@active) u.Username,c.Id AS CaseId,f.Id AS FileId
        FROM SL_UserAccounts u JOIN SL_LawCases c ON c.PrimaryLawyerId=u.LawyerProfileId
        JOIN SL_CaseFileAttachments f ON f.CaseId=c.Id WHERE u.Username LIKE @pattern ORDER BY c.Id
        """,new{active,pattern=prefix+"%"})).ToList();
    Check(records.Count==active,"200 active fixtures");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Username LIKE @pattern",new{pattern=prefix+"%"})==accounts,"800 accounts seeded");
    foreach(var record in records)clients.Add(new(new HttpClientHandler{CookieContainer=new CookieContainer()}){BaseAddress=new Uri(testBaseUrl),Timeout=TimeSpan.FromSeconds(90)});
    Console.WriteLine("Seeded 800 accounts/cases/documents and 200 synthetic 64 KiB PDF files. Logging in 200 distinct accounts from one IP.");
    await Task.WhenAll(records.Select(async (record,index)=>{
        try {await Request(clients[index],"login","/api/auth/login",new{username=record.Username,password});}
        catch(Exception e){failures.Add(e.Message);}
    }));
    Check(failures.IsEmpty,"Login failures: "+string.Join(",",failures.Take(5)));
    using(var foreign=await clients[0].GetAsync($"/api/files/{records[1].FileId}/content")) Check(foreign.StatusCode==HttpStatusCode.NotFound,"Cross-account PDF denied");
    using(var anonymous=new HttpClient()) Check((await anonymous.GetAsync($"{testBaseUrl}/api/files/{records[0].FileId}/content")).StatusCode==HttpStatusCode.Unauthorized,"Anonymous PDF denied");
    var workload=Stopwatch.StartNew();
    for(int round=0;round<rounds;round++) {
        await Task.WhenAll(records.Select(async (record,index)=>{
            var client=clients[index];
            try {
                var dashboard=JsonNode.Parse(await Request(client,"dashboard","/api/dashboard"))!;
                Check(dashboard["cases"]!.AsArray().Count==1 && dashboard["cases"]![0]!["id"]!.GetValue<int>()==record.CaseId,"Dashboard case isolation");
                Check(dashboard["caseFiles"]!.AsArray().All(f=>string.IsNullOrEmpty(f!["fileDataBase64"]?.GetValue<string>())),"No PDF bytes in dashboard");
                Check(!dashboard.ToJsonString().Contains("passwordHash"),"No password hashes");
                await Request(client,"files","/api/files");
                var events=JsonNode.Parse(await Request(client,"litigation","/api/litigation"))!.AsArray();
                Check(events.Count==1 && events[0]!["caseId"]!.GetValue<int>()==record.CaseId,"Litigation scope");
                await Request(client,"report","/api/reports/cases");
                var downloaded=await Request(client,"download",$"/api/files/{record.FileId}/content");
                Check(downloaded.SequenceEqual(payload),"Exact PDF bytes preserved");
                if(round==0) {
                    var uploaded=JsonNode.Parse(await Request(client,"upload","/api/files",new{caseId=record.CaseId,fileTitle=prefix,storageType="PDF",fileDataBase64="data:application/pdf;base64,"+base64,mimeType="application/pdf",pageCount=1}))!;
                    Check(string.IsNullOrEmpty(uploaded["fileDataBase64"]?.GetValue<string>()),"Upload response excludes PDF bytes");
                    uploadedFiles.Add((index,uploaded["id"]!.GetValue<int>()));
                    var copy=await Request(client,"download",uploaded["fileUrlOrPath"]!.GetValue<string>());
                    Check(copy.SequenceEqual(payload),"Uploaded PDF roundtrip");
                }
            }catch(Exception e){failures.Add(e.Message);}
        }));
        Console.WriteLine($"Round {round+1}/{rounds} finished; requests={samples.Count}, failures={failures.Count}");
    }
    workload.Stop();
    var report=new {
        timestamp=DateTimeOffset.Now, accounts,activeUsers=active,rounds,peakConcurrentRequests=peak,
        workloadSeconds=Math.Round(workload.Elapsed.TotalSeconds,2),totalRequests=samples.Count,
        errors=failures.ToArray(), environment="Local Kestrel + SQL Server; load generator shares host. Not IIS production certification.",
        metrics=samples.GroupBy(s=>s.Name).Select(g=>{
            var sorted=g.Select(s=>s.Milliseconds).Order().ToArray();
            return new {operation=g.Key,count=g.Count(),errors=g.Count(s=>s.Status<200||s.Status>=300),p50Ms=Math.Round(sorted[(int)((sorted.Length-1)*.5)],1),p95Ms=Math.Round(sorted[(int)((sorted.Length-1)*.95)],1),maxMs=Math.Round(sorted[^1],1),averageBytes=(long)g.Average(s=>s.Bytes)};
        }).ToArray()
    };
    Directory.CreateDirectory("artifacts");await File.WriteAllTextAsync("artifacts/capacity-800-200.json",JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
    Console.WriteLine(JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
    Check(failures.IsEmpty,"Load run failed; inspect artifacts/capacity-800-200.json");
}finally {
    foreach(var upload in uploadedFiles)
    {
        using var deleted=await clients[upload.ClientIndex].DeleteAsync($"/api/files/{upload.FileId}");
        Check(deleted.IsSuccessStatusCode,$"Could not remove uploaded test file {upload.FileId}");
    }
    foreach(var client in clients)client.Dispose();
    await db.ExecuteAsync("""
        DELETE FROM SL_CaseFileAttachments WHERE CaseId IN (SELECT Id FROM SL_LawCases WHERE CaseCode LIKE @pattern);
        DELETE FROM SL_LitigationEvents WHERE CaseId IN (SELECT Id FROM SL_LawCases WHERE CaseCode LIKE @pattern);
        DELETE FROM SL_CaseDocuments WHERE CaseId IN (SELECT Id FROM SL_LawCases WHERE CaseCode LIKE @pattern);
        DELETE FROM SL_LawCases WHERE CaseCode LIKE @pattern;
        DELETE FROM SL_Sessions WHERE UserId IN (SELECT Id FROM SL_UserAccounts WHERE Username LIKE @pattern);
        DELETE FROM SL_AuditLog WHERE UserId IN (SELECT Id FROM SL_UserAccounts WHERE Username LIKE @pattern);
        DELETE FROM SL_UserAccounts WHERE Username LIKE @pattern;
        DELETE FROM SL_LawyerProfiles WHERE FullName LIKE @pattern;
        """,new{pattern=prefix+"%"},commandTimeout:120);
    Console.WriteLine("Isolated capacity fixtures removed.");
}
record Sample(string Name,double Milliseconds,int Status,long Bytes);
class Fixture {public string Username{get;set;}="";public int CaseId{get;set;}public int FileId{get;set;}}
