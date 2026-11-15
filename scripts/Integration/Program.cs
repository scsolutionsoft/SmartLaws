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
var testBaseUrl = Environment.GetEnvironmentVariable("SMARTLAWS_TEST_BASE_URL") ?? "http://localhost:5088";
using var client = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer() }) { BaseAddress = new Uri(testBaseUrl) };
var username = "test_" + Guid.NewGuid().ToString("N")[..16];
var password = Guid.NewGuid().ToString("N");
int userId=0, profileId=0, caseId=0;
string? deleteFixtureKey=null;
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
    var profileUpdate = await Send($"/api/lawyers/{profileId}", new
    {
        fullName = username,
        roleType = "ทนายความ",
        licenseNo = "TEST",
        licenseJurisdiction = "ทั่วราชอาณาจักร",
        citizenId = "1234567890123",
        race = "ไทย",
        nationality = "ไทย",
        occupation = "ทนายความ",
        age = "40",
        houseNo = "42/7",
        moo = "3",
        road = "ถนนทดสอบ",
        soi = "ซอยทดสอบ",
        nearBy = "ใกล้ศาลทดสอบ",
        subDistrict = "ตำบลทดสอบ",
        district = "อำเภอทดสอบ",
        province = "ศรีสะเกษ",
        postalCode = "33000",
        phone = "081-234-5678",
        officeName = "สำนักงานทดสอบ"
    }, HttpMethod.Put);
    Check(profileUpdate["soi"]?.GetValue<string>() == "ซอยทดสอบ" && profileUpdate["nearBy"]?.GetValue<string>() == "ใกล้ศาลทดสอบ", "Lawyer profile saves all address fields");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Id=@userId AND FullName=@username AND Phone='081-234-5678'",new{userId,username})==1,"Lawyer profile updates account contact details");
    var c=await Send("/api/cases?userId=1",new {primaryLawyerId=999999,courtName="ศาลทดสอบ",plaintiffName="TEST",defendantName="TEST",caseCategory="แพ่ง"});
    caseId=c["id"]!.GetValue<int>();Check(c["primaryLawyerId"]!.GetValue<int>()==profileId,"Case owner must come from session");
    var lawyerFill=await client.GetFromJsonAsync<JsonNode>($"/api/cases/{caseId}/quick-fill?source=case-lawyer");
    Check(lawyerFill?["profiles"]?[0]?["id"]?.GetValue<int>()==profileId
        && lawyerFill["profiles"]?[0]?["houseNo"]?.GetValue<string>()=="42/7"
        && lawyerFill["profiles"]?[0]?["soi"]?.GetValue<string>()=="ซอยทดสอบ"
        && lawyerFill["profiles"]?[0]?["nearBy"]?.GetValue<string>()=="ใกล้ศาลทดสอบ",
        "Form 9 lawyer quick-fill uses the case owner's saved address");
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
    Check(CommunityModule.YoutubeId("https://youtu.be/dQw4w9WgXcQ")=="dQw4w9WgXcQ","YouTube short URL");
    Check(CommunityModule.YoutubeId("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")==null,"Reject untrusted video host");
    Check(!CommunityModule.ValidImage("data:image/svg+xml;base64,PHN2Zz4="),"Reject active image formats");
    Check((await client.PostAsJsonAsync("/api/admin/news",new NewsInput("test","test","","",DateTimeOffset.UtcNow,DateTimeOffset.UtcNow.AddDays(1)))).StatusCode==HttpStatusCode.Forbidden,"Only admin publishes news");
    Check((await client.GetAsync("/api/public/news")).IsSuccessStatusCode,"Public news is available");
    await Send("/api/messages",new {userId,body="Integration fixture message"});
    var conversation=await client.GetFromJsonAsync<JsonArray>($"/api/messages/{userId}");
    Check(conversation!.Count>0,"Own message persists");
    Check((await client.GetAsync($"/api/messages/{userId+1000000}")).StatusCode==HttpStatusCode.NotFound,"Cannot read another user's messages");
    var creditBefore=await db.ExecuteScalarAsync<int>("SELECT UsedCasesCount FROM SL_UserAccounts WHERE Id=@userId",new{userId});
    var editCase=(await client.GetFromJsonAsync<JsonNode>($"/api/cases/{caseId}"))!["case"]!.Deserialize<LawCase>();
    editCase!.CaseSummary="Updated without charging credit";
    await Send($"/api/cases/{caseId}",editCase,HttpMethod.Put);
    Check(await db.ExecuteScalarAsync<int>("SELECT UsedCasesCount FROM SL_UserAccounts WHERE Id=@userId",new{userId})==creditBefore,"Editing keeps credits unchanged");
    var pdfBytes=System.Text.Encoding.ASCII.GetBytes("%PDF-1.4\nTest judgment fixture\n%%EOF");
    var judgment=await Send("/api/files",new {caseId,fileTitle="Fixture judgment",storageType="PDF",mimeType="application/pdf",fileDataBase64=Convert.ToBase64String(pdfBytes),pageCount=1,formCode="(๓๑)",courtLevel="ศาลชั้นต้น",judgmentBlackCaseNo="TEST/2569",judgmentRedCaseNo="RED/2569",judgmentDate="2026-11-15"});
    var judgmentId=judgment["id"]!.GetValue<int>();
    using(var upload=new MultipartFormDataContent())
    {
        foreach(var pair in new Dictionary<string,string>{{"caseId",caseId.ToString()},{"fileTitle","Deletable fixture"},{"storageType","PDF"},{"mimeType","application/pdf"},{"pageCount","1"}})
            upload.Add(new StringContent(pair.Value),pair.Key);
        upload.Add(new ByteArrayContent(pdfBytes),"file","deletable-fixture.pdf");
        using var created=await client.PostAsync("/api/files",upload);
        Check(created.IsSuccessStatusCode,"Multipart file upload for deletion test");
        var saved=JsonNode.Parse(await created.Content.ReadAsStringAsync())!;
        var deletableId=saved["id"]!.GetValue<int>();
        deleteFixtureKey=await db.ExecuteScalarAsync<string>("SELECT StorageKey FROM SL_CaseFileAttachments WHERE Id=@deletableId",new{deletableId});
        Check(!string.IsNullOrEmpty(deleteFixtureKey),"Disk storage key is persisted");
        Check((await client.GetByteArrayAsync($"/api/files/{deletableId}/content")).SequenceEqual(pdfBytes),"Deletable file is readable before delete");
        using var deleted=await client.DeleteAsync($"/api/files/{deletableId}");
        Check(deleted.IsSuccessStatusCode,"Owner can delete unlinked file");
        Check((await client.GetAsync($"/api/files/{deletableId}/content")).StatusCode==HttpStatusCode.NotFound,"Deleted file is no longer served");
        Check(!File.Exists(Path.Combine("App_Data","Uploads",deleteFixtureKey!)),"Deleted file is removed from disk");
    }
    var party=await Send("/api/parties",new {caseId,fullName="Fixture client",partySide="โจทก์",partyOrder=1,isOurClient=true});
    var partyId=party["id"]!.GetValue<int>();
    var identity=await Send("/api/client-records",new {caseId,partyId,kind="citizen-id",title="Client identity PDF",mimeType="application/pdf",data=Convert.ToBase64String(pdfBytes)});
    var identityId=identity["id"]!.GetValue<int>();
    Check((await client.PostAsJsonAsync("/api/client-records",new {caseId,partyId=partyId+1000000,kind="citizen-id",title="Invalid owner",mimeType="application/pdf",data=Convert.ToBase64String(pdfBytes)})).StatusCode==HttpStatusCode.BadRequest,"Client documents require a party in the same case");
    Check((await client.PostAsJsonAsync("/api/personal-documents",new {kind="lawyer-license",title="Invalid PDF",mimeType="application/pdf",data="bm90IGEgcGRm"})).StatusCode==HttpStatusCode.BadRequest,"Invalid PDF rejected");
    var personal=await Send("/api/personal-documents",new {kind="lawyer-license",title="Fixture lawyer license",mimeType="application/pdf",data=Convert.ToBase64String(pdfBytes)});
    var personalId=personal["id"]!.GetValue<int>();
    using(var other=new HttpClient(new HttpClientHandler{CookieContainer=new CookieContainer()}){BaseAddress=client.BaseAddress}) {
        var otherName=username+"_other";
        Check((await other.PostAsJsonAsync("/api/auth/register",new {username=otherName,passwordHash=password,fullName=otherName,licenseNo="TEST",email=otherName+"@example.invalid"})).IsSuccessStatusCode,"Other-account fixture registered");
        Check((await other.PostAsJsonAsync("/api/auth/login",new {username=otherName,password})).IsSuccessStatusCode,"Other-account fixture login");
        Check((await other.GetAsync($"/api/personal-documents/{personalId}/content")).StatusCode==HttpStatusCode.NotFound,"Another lawyer cannot download personal files");
        Check((await other.DeleteAsync($"/api/personal-documents/{personalId}")).StatusCode==HttpStatusCode.NotFound,"Another lawyer cannot delete personal files");
        Check((await other.GetAsync($"/api/client-records/{caseId}")).StatusCode==HttpStatusCode.NotFound,"Another lawyer cannot read client records");
        Check((await other.GetAsync($"/api/work-summary?caseId={caseId}")).StatusCode==HttpStatusCode.NotFound,"Another lawyer cannot report on this case");
        foreach(var role in new[]{"Admin","Clerk"}) {
            await db.ExecuteAsync("UPDATE SL_UserAccounts SET Role=@role WHERE Username=@otherName",new{role,otherName});
            Check((await other.GetAsync($"/api/personal-documents/{personalId}/content")).StatusCode==HttpStatusCode.Forbidden,role+" cannot read lawyer's private files");
        }
    }
    Check((await client.GetByteArrayAsync($"/api/personal-documents/{personalId}/content")).SequenceEqual(pdfBytes),"Personal document download preserves PDF");
    Check((await client.GetAsync($"/api/personal-documents/{personalId+1000000}/content")).StatusCode==HttpStatusCode.NotFound,"Unavailable personal document not exposed");
    var summary=await client.GetFromJsonAsync<JsonNode>($"/api/work-summary?caseId={caseId}");
    Check(summary!["cases"]!.AsArray().Count==1 && summary["clients"]!.AsArray().Count==1 && summary["clientDocuments"]!.AsArray().Count==1,"Summary includes scoped client documents");
    Check((await client.GetAsync($"/api/work-summary?caseId={caseId+1000000}")).StatusCode==HttpStatusCode.NotFound,"Summary rejects inaccessible case");
    foreach(var level in new[]{"ศาลชั้นต้น","ศาลอุทธรณ์","ศาลฎีกา"}) {
        var hearing=await Send("/api/appointments",new {caseId,title="อ่านคำพิพากษา "+level,kind="ฟังคำพิพากษา",courtLevel=level,startsAt="2026-11-20T09:00:00+07:00",endsAt="2026-11-20T10:00:00+07:00",location="ศาลทดสอบ",responsible="TEST",notes="",status="scheduled",reminderMinutes=1440});
        Check(hearing["courtLevel"]!.GetValue<string>()==level,"Hearing stores court level");
        await Send($"/api/appointments/{hearing["id"]}/files",new {fileId=judgmentId});
    }
    var hearings=await client.GetFromJsonAsync<List<CaseAppointment>>($"/api/cases/{caseId}/hearings");
    Check(hearings!.Count==3,"All three court hearing levels returned");
    var linkedFile=await Send("/api/files",new {caseId,fileTitle="Linked deletion fixture",storageType="LINK",fileUrlOrPath="https://example.invalid/linked-fixture.pdf",pageCount=1,formCode="(๓๑)"});
    var linkedFileId=linkedFile["id"]!.GetValue<int>();
    await db.ExecuteAsync("UPDATE SL_LitigationEvents SET AttachmentId=@linkedFileId WHERE Id=@eventId",new{linkedFileId,eventId});
    await Send($"/api/appointments/{hearings[0].Id}/files",new{fileId=linkedFileId});
    Check((await client.DeleteAsync($"/api/files/{linkedFileId}")).StatusCode==HttpStatusCode.Conflict,"Linked file requires explicit detach confirmation");
    using(var detached=await client.DeleteAsync($"/api/files/{linkedFileId}?detachLinks=true")) Check(detached.IsSuccessStatusCode,"Confirmed delete detaches file from linked records");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseFileAttachments WHERE Id=@linkedFileId",new{linkedFileId})==0
        && await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_AppointmentFiles WHERE FileId=@linkedFileId",new{linkedFileId})==0
        && await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LitigationEvents WHERE AttachmentId=@linkedFileId",new{linkedFileId})==0,
        "Confirmed delete removes file and preserves linked records without the attachment");
    Check((await client.GetAsync($"/api/cases/{caseId+100000}/backup")).StatusCode==HttpStatusCode.NotFound,"Cannot export inaccessible case");
    Check((await client.DeleteAsync($"/api/cases/{caseId}")).StatusCode==HttpStatusCode.BadRequest,"Direct delete without backup is rejected");
    using var backup=await client.GetAsync($"/api/cases/{caseId}/backup");
    Check(backup.IsSuccessStatusCode,"ZIP backup succeeds");
    var token=backup.Headers.GetValues("X-Case-Backup-Token").Single();
    using(var archive=new System.IO.Compression.ZipArchive(new MemoryStream(await backup.Content.ReadAsByteArrayAsync()))) {
        Check(archive.GetEntry("case-data.json")!=null,"Case metadata included");
        Check(archive.GetEntry($"files/{identityId}.pdf")!=null,"Client identity document included in case backup");
        Check(archive.GetEntry($"links/{fileId}.txt")!=null,"External URL preserved without fetching");
        using var stream=archive.GetEntry($"files/{judgmentId}.pdf")!.Open();
        using var copy=new MemoryStream();await stream.CopyToAsync(copy);
        Check(copy.ToArray().SequenceEqual(pdfBytes),"Uploaded PDF preserved byte for byte");
    }
    async Task<HttpResponseMessage> DeleteWith(string receipt,bool confirmed=true) => await client.SendAsync(new HttpRequestMessage(HttpMethod.Delete,$"/api/cases/{caseId}"){Content=JsonContent.Create(new {backupToken=receipt,confirmed,confirmation="ลบคดี"})});
    Check((await DeleteWith("invalid")).StatusCode==HttpStatusCode.BadRequest,"Forged backup receipt rejected");
    Check((await DeleteWith(token,false)).StatusCode==HttpStatusCode.BadRequest,"Second confirmation required");
    editCase.CaseSummary="Changed after backup";
    await Send($"/api/cases/{caseId}",editCase,HttpMethod.Put);
    Check((await DeleteWith(token)).StatusCode==HttpStatusCode.Conflict,"Changes after export prevent deletion");
    using var latest=await client.GetAsync($"/api/cases/{caseId}/backup");
    await latest.Content.ReadAsByteArrayAsync();
    Check((await DeleteWith(latest.Headers.GetValues("X-Case-Backup-Token").Single())).IsSuccessStatusCode,"Current backup and confirmation allow deletion");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_Appointments WHERE CaseId=@caseId",new{caseId})==0,"Case deletion removes hearings");
    Check((await client.GetByteArrayAsync($"/api/personal-documents/{personalId}/content")).SequenceEqual(pdfBytes),"Deleting case preserves personal lawyer files");
    Check((await client.DeleteAsync($"/api/personal-documents/{personalId}")).IsSuccessStatusCode,"Owner can delete personal file");
    Console.WriteLine("PASS: client identities, personal license storage, file validation, scoped reports and backup integration.");
    Console.WriteLine("PASS: three court levels, linked judgment PDF in ZIP, access isolation, mandatory backup, confirmations and stale-backup rejection.");
    Check(await db.ExecuteScalarAsync<int>("SELECT UsedCasesCount FROM SL_UserAccounts WHERE Id=@userId",new{userId})==creditBefore,"Deleting does not refund or consume credits");
    Console.WriteLine("PASS: community access, message isolation, media validation, and edit/delete credit invariants.");
    Console.WriteLine("PASS: accounts, username uniqueness, rename/reset, session revocation, report access/fields, litigation persistence, and Word permission toggle/one-line closing gap.");
}
finally
{
    var cleanupKeys=(await db.QueryAsync<string>("""
        SELECT StorageKey FROM SL_CaseFileAttachments WHERE StorageKey IS NOT NULL AND CaseId IN
          (SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@profileId)
        UNION SELECT StorageKey FROM SL_PersonalDocuments WHERE StorageKey IS NOT NULL AND UserId=@userId
        """,new{profileId,userId})).ToArray();
    if(!string.IsNullOrEmpty(deleteFixtureKey))cleanupKeys=cleanupKeys.Append(deleteFixtureKey).ToArray();
    foreach(var key in cleanupKeys)
        if(SmartLaws.Web.Services.FileStorage.IsValidKey(key))
        {
            var path=Path.Combine("App_Data","Uploads",key);
            if(File.Exists(path))File.Delete(path);
        }
    var otherFixture=await db.QuerySingleOrDefaultAsync("SELECT Id,LawyerProfileId FROM SL_UserAccounts WHERE Username=@name AND FullName=@name",new{name=username+"_other"});
    if(otherFixture!=null) await db.ExecuteAsync("DELETE FROM SL_Sessions WHERE UserId=@Id; DELETE FROM SL_AuditLog WHERE UserId=@Id; DELETE FROM SL_UserAccounts WHERE Id=@Id; DELETE FROM SL_LawyerProfiles WHERE Id=@LawyerProfileId;",new{Id=(int)otherFixture.Id,LawyerProfileId=(int)otherFixture.LawyerProfileId});
    var record=await db.QuerySingleOrDefaultAsync("SELECT Id,LawyerProfileId FROM SL_UserAccounts WHERE FullName=@username AND Username LIKE @prefix",new{username,prefix=username+"%"});
    if(record!=null){userId=(int)record.Id;profileId=(int)record.LawyerProfileId;}
    if(userId>0 && profileId>0) {
    using var tx=db.BeginTransaction();
    await db.ExecuteAsync("""
        DELETE FROM SL_Appointments WHERE CaseId IN(SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@profileId);
        DELETE FROM SL_LitigationEvents WHERE CreatedBy=@userId;
        DELETE FROM SL_CaseFileAttachments WHERE CaseId IN(SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@profileId);
        DELETE FROM SL_CaseDocuments WHERE CaseId IN(SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@profileId);
        DELETE FROM SL_CaseParties WHERE CaseId IN(SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@profileId);
        DELETE FROM SL_LawCases WHERE PrimaryLawyerId=@profileId;
        DELETE FROM SL_PersonalDocuments WHERE UserId=@userId;
        DELETE FROM SL_Messages WHERE UserId=@userId OR SenderId=@userId;
        DELETE FROM SL_Sessions WHERE UserId=@userId;
        DELETE FROM SL_AuditLog WHERE UserId=@userId;
        DELETE FROM SL_UserAccounts WHERE Id=@userId AND FullName=@username;
        DELETE FROM SL_LawyerProfiles WHERE Id=@profileId AND FullName=@username;
        DELETE FROM SL_ElectronicSignatures WHERE SignerName=@username;
        """,new{userId,profileId,username},tx);
    tx.Commit();
    }
}
