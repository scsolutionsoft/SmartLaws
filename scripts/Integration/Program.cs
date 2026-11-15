using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Services;
using SmartLaws.Web.Models;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

// Isolated fixture: every row created by this run is removed in finally.
var root = Directory.GetCurrentDirectory();
var settings = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(root,"appsettings.json")))!;
using var db = new SqlConnection(settings["ConnectionStrings"]!["DefaultConnection"]!.GetValue<string>());
await db.OpenAsync();
using var client = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer() }) { BaseAddress = new Uri("http://localhost:5088") };
var username = "test_" + Guid.NewGuid().ToString("N")[..16];
var password = Guid.NewGuid().ToString("N");
int userId=0, profileId=0, caseId=0;
void Check(bool condition,string message) { if(!condition) throw new Exception(message); }
async Task<JsonNode> Send(string path,object payload, HttpMethod? method=null)
{
    using var req=new HttpRequestMessage(method??HttpMethod.Post,path){Content=JsonContent.Create(payload)};
    var response=await client.SendAsync(req);
    Check(response.IsSuccessStatusCode,$"{path}: HTTP {(int)response.StatusCode}");
    return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
}
try
{
    var wordService = new WordExportService();
    foreach (var showPermission in new[] { false, true })
    {
        var doc = new CaseDocument { ClosingPrayer = "ซึ่งเป็นวันสืบพยานด้วย", ClausesJson = "[{\"ClauseTitle\":\"ข้อ ๑.\",\"Content\":\"ข้อความสุดท้าย\\nขอศาลได้โปรดอนุญาต\"}]", ExtraFieldsJson = JsonSerializer.Serialize(new { ShowPermission = showPermission, PermissionText = "[object Object]" }) };
        using var ms = new MemoryStream(wordService.GenerateCourtDocumentDocx(doc, new LawCase()));
        using var word = WordprocessingDocument.Open(ms, false);
        var paragraphs = word.MainDocumentPart!.Document!.Body!.Elements<Paragraph>().ToList();
        var closingIndex = paragraphs.FindIndex(p => p.InnerText.Contains("ควรมิควรแล้วแต่จะโปรด"));
        Check(closingIndex > 0 && string.IsNullOrWhiteSpace(paragraphs[closingIndex - 1].InnerText), "One blank paragraph before closing prayer");
        Check(paragraphs[closingIndex - 1].ParagraphProperties!.GetFirstChild<SpacingBetweenLines>()!.Line == "465", "Closing gap is exactly one 31px line");
        Check(!word.MainDocumentPart!.Document!.InnerText.Contains("ซึ่งเป็นวันสืบพยานด้วย"), "Replace incorrect closing text");
        Check(paragraphs.Skip(closingIndex + 1).Take(2).All(p => string.IsNullOrWhiteSpace(p.InnerText) && p.ParagraphProperties!.GetFirstChild<SpacingBetweenLines>()!.Line == "465"), "Two blank 31px lines after closing");
        Check(paragraphs[closingIndex + 3].InnerText.StartsWith("ลงชื่อ"), "Signature follows two blank lines");
        Check(paragraphs.Any(p => p.InnerText.Contains("ขอศาลได้โปรดอนุญาต")) == showPermission, "Word permission toggle");
        Check(!word.MainDocumentPart!.Document!.InnerText.Contains("[object Object]"), "Word object text regression");
    }
    var user=await Send("/api/auth/register",new {username,passwordHash=password,fullName=username,licenseNo="TEST",email=username+"@example.invalid"});
    userId=user["id"]!.GetValue<int>();profileId=user["lawyerProfileId"]!.GetValue<int>();
    await Send("/api/auth/login",new {username,password});
    var c=await Send("/api/cases?userId=1",new {primaryLawyerId=999999,courtName="ศาลทดสอบ",plaintiffName="TEST",defendantName="TEST",caseCategory="แพ่ง"});
    caseId=c["id"]!.GetValue<int>();Check(c["primaryLawyerId"]!.GetValue<int>()==profileId,"Case owner must come from session");
    var quota=await db.ExecuteScalarAsync<int>("SELECT UsedCasesCount FROM SL_UserAccounts WHERE Id=@userId",new{userId});Check(quota==1,"Quota must be charged to authenticated account");
    var file=await Send("/api/files",new {caseId,fileTitle="Test reference",storageType="LINK",fileUrlOrPath="https://example.invalid/judgment.pdf",pageCount=1,formCode="(๓๑)"});
    var fileId=file["id"]!.GetValue<int>();
    var entry=await Send("/api/litigation",new{caseId,stage="คำพิพากษา",courtLevel="ศาลชั้นต้น",courtName="ศาลทดสอบ",eventDate="2026-11-14",deadline="2026-12-14",deadlineBasis="กำหนดทดสอบ ไม่ใช่คำแนะนำกฎหมาย",summary="Integration fixture",outcome="Test only",status="มีคำสั่งแล้ว",attachmentId=fileId});
    var eventId=entry["id"]!.GetValue<int>();
    var persisted=await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LitigationEvents WHERE Id=@eventId AND CaseId=@caseId",new{eventId,caseId});Check(persisted==1,"Event persistence");
    var protectedDelete=await client.DeleteAsync($"/api/files/{fileId}");Check(protectedDelete.StatusCode==HttpStatusCode.Conflict,"Linked evidence must not be deleted");
    await Send($"/api/litigation/{eventId}/status",new{status="เสร็จสิ้น"},HttpMethod.Put);
    var status=await db.ExecuteScalarAsync<string>("SELECT Status FROM SL_LitigationEvents WHERE Id=@eventId",new{eventId});Check(status=="เสร็จสิ้น","Close follow-up");
    await Send("/api/auth/password",new{currentPassword=password,newPassword=password+"new"});
    Check((await client.GetAsync("/api/auth/me")).StatusCode==HttpStatusCode.Unauthorized,"Password change revokes session");
    await Send("/api/auth/login",new{username,password=password+"new"});
    var renamed=username+"_new";
    var duplicate=await client.PutAsJsonAsync("/api/auth/credentials",new{username="admin",currentPassword=password+"new"});
    Check(duplicate.StatusCode==HttpStatusCode.Conflict,"Duplicate username rejected");
    var mismatch=await client.PutAsJsonAsync("/api/auth/credentials",new{username=renamed,currentPassword=password+"new",newPassword=password+"next",confirmPassword="mismatch"});
    Check(mismatch.StatusCode==HttpStatusCode.BadRequest,"Mismatched reset confirmation rejected");
    await Send("/api/auth/credentials",new{username=renamed,currentPassword=password+"new"},HttpMethod.Put);
    Check((await client.GetAsync("/api/auth/me")).StatusCode==HttpStatusCode.Unauthorized,"Username change revokes session");
    await Send("/api/auth/login",new{username=renamed,password=password+"new"});
    var report=await client.GetFromJsonAsync<List<CaseReportRow>>("/api/reports/cases");
    Check(report!.Count==1 && report[0].Id==caseId && report[0].LawyerName==username && report[0].PlaintiffName=="TEST", "Report fields and ownership");
    Check((await client.PutAsJsonAsync($"/api/admin/users/{userId}/credentials",new{username=renamed})).StatusCode==HttpStatusCode.Forbidden,"Lawyer cannot use admin reset");
    if (Environment.GetEnvironmentVariable("SMARTLAWS_ADMIN") is { Length: > 0 } adminUsername && Environment.GetEnvironmentVariable("SMARTLAWS_ADMIN_PASSWORD") is { Length: > 0 } adminPassword)
    {
        using var adminClient = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer() }) { BaseAddress = client.BaseAddress };
        Check((await adminClient.PostAsJsonAsync("/api/auth/login",new { username=adminUsername,password=adminPassword })).IsSuccessStatusCode,"Admin fixture login");
        var reset = await adminClient.PutAsJsonAsync($"/api/admin/users/{userId}/credentials", new { username=renamed,newPassword=password+"reset",confirmPassword=password+"reset" });
        Check(reset.IsSuccessStatusCode,"Admin can reset fixture password");
        Check((await client.GetAsync("/api/auth/me")).StatusCode==HttpStatusCode.Unauthorized,"Admin reset revokes target session");
        await Send("/api/auth/login",new {username=renamed,password=password+"reset"});
        var adminReport=await adminClient.GetFromJsonAsync<List<CaseReportRow>>("/api/reports/cases");
        Check(adminReport!.Any(row=>row.Id==caseId && row.LawyerName==username && row.PlaintiffName=="TEST" && row.DefendantName=="TEST"),"Admin report includes authorized party names");
        await adminClient.PostAsJsonAsync("/api/auth/logout",new{});
    }
    Console.WriteLine("PASS: accounts, username uniqueness, rename/reset, session revocation, report access/fields, litigation persistence, and Word permission toggle/one-line closing gap.");
}
finally
{
    // Recover IDs if a registration response failed after its commit.
    var record=await db.QuerySingleOrDefaultAsync("SELECT Id,LawyerProfileId FROM SL_UserAccounts WHERE FullName=@username AND Username LIKE @prefix",new{username,prefix=username+"%"});
    if(record!=null){userId=(int)record.Id;profileId=(int)record.LawyerProfileId;}
    if(userId>0 && profileId>0) {
    using var tx=db.BeginTransaction();
    await db.ExecuteAsync("""
        DELETE FROM SL_LitigationEvents WHERE CreatedBy=@userId;
        DELETE FROM SL_CaseFileAttachments WHERE CaseId IN(SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@profileId);
        DELETE FROM SL_CaseDocuments WHERE CaseId IN(SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@profileId);
        DELETE FROM SL_CaseParties WHERE CaseId IN(SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@profileId);
        DELETE FROM SL_LawCases WHERE PrimaryLawyerId=@profileId;
        DELETE FROM SL_Sessions WHERE UserId=@userId;
        DELETE FROM SL_AuditLog WHERE UserId=@userId;
        DELETE FROM SL_UserAccounts WHERE Id=@userId AND FullName=@username;
        DELETE FROM SL_LawyerProfiles WHERE Id=@profileId AND FullName=@username;
        DELETE FROM SL_ElectronicSignatures WHERE SignerName=@username;
        """,new{userId,profileId,username},tx);
    tx.Commit();
    }
}
