using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using System.IO.Compression;
using Dapper;
using Microsoft.Data.SqlClient;

var prefix="archivefixture"+Guid.NewGuid().ToString("N")[..10];var password=Guid.NewGuid().ToString("N");
var testBaseUrl=Environment.GetEnvironmentVariable("SMARTLAWS_TEST_BASE_URL")??"http://localhost:5088";
var fixtureUsers=new List<int>();
using var db=new SqlConnection(JsonNode.Parse(await File.ReadAllTextAsync("appsettings.json"))!["ConnectionStrings"]!["DefaultConnection"]!.GetValue<string>());await db.OpenAsync();
HttpClient Session()=>new(new HttpClientHandler{CookieContainer=new()}){BaseAddress=new(testBaseUrl),Timeout=TimeSpan.FromMinutes(3)};
using var admin=Session();using var lawyer=Session();using var target=Session();using var other=Session();using var client=Session();
void Check(bool value,string text){if(!value)throw new Exception(text);}
async Task<JsonNode> Send(HttpClient http,string path,object body,HttpMethod? method=null){using var r=await http.SendAsync(new HttpRequestMessage(method??HttpMethod.Post,path){Content=JsonContent.Create(body)});var text=await r.Content.ReadAsStringAsync();if(!r.IsSuccessStatusCode)throw new Exception(path+" "+r.StatusCode+" "+text);return string.IsNullOrEmpty(text)?new JsonObject():JsonNode.Parse(text)!;}
async Task<JsonNode> SendMultipart(HttpClient http,string path,MultipartFormDataContent form){using var r=await http.PostAsync(path,form);var text=await r.Content.ReadAsStringAsync();if(!r.IsSuccessStatusCode)throw new Exception(path+" "+r.StatusCode+" "+text);return JsonNode.Parse(text)!;}
async Task<int> Register(HttpClient http,string suffix){var username=prefix+suffix;await Send(http,"/api/auth/register",new{username,passwordHash=password,fullName=username,licenseNo="TEST",email=username+"@example.invalid"});await Send(http,"/api/auth/login",new{username,password});var id=await db.ExecuteScalarAsync<int>("SELECT Id FROM SL_UserAccounts WHERE Username=@username",new{username});fixtureUsers.Add(id);return id;}
async Task<HttpResponseMessage> Upload(string path,byte[] zip,bool confirm=false){var r=new HttpRequestMessage(HttpMethod.Post,path){Content=new ByteArrayContent(zip)};r.Content.Headers.ContentType=new("application/zip");if(confirm)r.Headers.Add("X-Restore-Confirmation","RESTORE");return await admin.SendAsync(r);}
try{
 var adminId=await Register(admin,"admin");await db.ExecuteAsync("UPDATE SL_UserAccounts SET Role='Admin' WHERE Id=@adminId",new{adminId});
 int owner=await Register(lawyer,"owner"),targetId=await Register(target,"target"),otherId=await Register(other,"other");
 int profile=await db.ExecuteScalarAsync<int>("SELECT LawyerProfileId FROM SL_UserAccounts WHERE Id=@owner",new{owner});
 var c1=await Send(lawyer,"/api/cases",new{courtName="Fixture",blackCaseNo=prefix,blackCaseYear="2569",plaintiffName="TEST",defendantName="TEST"});int caseId=(int)c1["id"]!;
 var c2=await Send(other,"/api/cases",new{courtName="Other",blackCaseNo=prefix+"other",blackCaseYear="2569",plaintiffName="TEST",defendantName="TEST"});int otherCase=(int)c2["id"]!;
 var p1=await Send(lawyer,"/api/parties",new{caseId,fullName=prefix+"client",isOurClient=true});int partyId=(int)p1["id"]!;
 var p2=await Send(other,"/api/parties",new{caseId=otherCase,fullName=prefix+"client",isOurClient=true});
 const string citizen="8234567890123";
 var account=await Send(lawyer,$"/api/client-management/{caseId}",new{partyId,citizenId=citizen});int clientId=(int)account["userId"]!;
 await Send(other,$"/api/client-management/{otherCase}",new{partyId=(int)p2["id"]!,citizenId=citizen});
 await Send(client,"/api/auth/login",new{username=citizen,password=citizen});await Send(client,"/api/client/password",new{currentPassword=citizen,newPassword=password,confirmPassword=password});await Send(client,"/api/auth/login",new{username=citizen,password});
 var expectedBytes=Encoding.ASCII.GetBytes("%PDF-1.4\nfixture\n%%EOF");var pdf=Convert.ToBase64String(expectedBytes);
 var docId=await db.QuerySingleAsync<int>("INSERT INTO SL_CaseDocuments(CaseId,FormCode,DocumentTitle,SignatureImageBase64) OUTPUT INSERTED.Id VALUES(@caseId,N'(7)',N'Fixture document',@pdf)",new{caseId,pdf});
 var upload=new MultipartFormDataContent();foreach(var pair in new Dictionary<string,string>{{"caseId",caseId.ToString()},{"documentId",docId.ToString()},{"fileTitle","Fixture PDF"},{"storageType","PDF"},{"mimeType","application/pdf"},{"pageCount","1"}})upload.Add(new StringContent(pair.Value),pair.Key);upload.Add(new ByteArrayContent(expectedBytes),"file","fixture.pdf");
 var file=await SendMultipart(lawyer,"/api/files",upload);int fileId=(int)file["id"]!;
 Check((await lawyer.GetByteArrayAsync($"/api/files/{fileId}/content")).SequenceEqual(expectedBytes),"Multipart upload downloads byte-for-byte");
 await Send(lawyer,$"/api/client-management/{caseId}/{clientId}/files",new{fileIds=new[]{fileId}},HttpMethod.Put);
 await Send(client,$"/api/client/messages?caseId={caseId}",new{body="History",requestId=Guid.NewGuid()});
 var personalUpload=new MultipartFormDataContent();personalUpload.Add(new StringContent("lawyer-license"),"kind");personalUpload.Add(new StringContent("License"),"title");personalUpload.Add(new StringContent("application/pdf"),"mimeType");personalUpload.Add(new ByteArrayContent(expectedBytes),"file","license.pdf");
 await SendMultipart(lawyer,"/api/personal-documents",personalUpload);
 var appointment=await db.QuerySingleAsync<int>("INSERT INTO SL_Appointments(CaseId,Title,Kind,StartsAt,EndsAt,Location,Responsible,Notes,Status,ReminderMinutes,CreatedBy) OUTPUT INSERTED.Id VALUES(@caseId,N'Fixture',N'hearing',SYSDATETIMEOFFSET(),DATEADD(hour,1,SYSDATETIMEOFFSET()),N'Court',N'Lawyer',N'Notes','scheduled',60,@owner)",new{caseId,owner});
 await db.ExecuteAsync("INSERT INTO SL_AppointmentFiles(AppointmentId,FileId,CreatedBy) VALUES(@appointment,@fileId,@owner); INSERT INTO SL_ClientDocuments(FileId,CaseId,PartyId,Kind) VALUES(@fileId,@caseId,@partyId,'other'); UPDATE SL_UserAccounts SET UsedCasesCount=7 WHERE Id=@owner; UPDATE SL_UserAccounts SET MaxCasesQuota=50,PlanName=N'Renewed' WHERE Id=@targetId",new{appointment,fileId,owner,caseId,partyId,targetId});
 await db.ExecuteAsync("INSERT INTO SL_Messages(UserId,SenderId,Body) VALUES(@owner,@adminId,N'Admin history')",new{owner,adminId});
 foreach(var http in new[]{lawyer,other,client}){
  Check((await http.GetAsync($"/api/admin/lawyer-archives/{owner}/backup")).StatusCode==HttpStatusCode.Forbidden,"Non-admin backup denied");
  Check((await http.SendAsync(new HttpRequestMessage(HttpMethod.Delete,$"/api/admin/lawyer-archives/{owner}"){Content=JsonContent.Create(new{receipt="",saved=true,confirmation="test"})})).StatusCode==HttpStatusCode.Forbidden,"Non-admin delete denied");
  Check((await http.PostAsync("/api/admin/lawyer-archives/preview",new ByteArrayContent([]))).StatusCode==HttpStatusCode.Forbidden,"Non-admin preview denied");
  Check((await http.PostAsync($"/api/admin/lawyer-archives/{targetId}/restore",new ByteArrayContent([]))).StatusCode==HttpStatusCode.Forbidden,"Non-admin restore denied");
 }
 using var first=await admin.GetAsync($"/api/admin/lawyer-archives/{owner}/backup");Check(first.IsSuccessStatusCode,"Backup succeeds: "+await first.Content.ReadAsStringAsync());var receipt=first.Headers.GetValues("X-Lawyer-Backup-Receipt").Single();
 await db.ExecuteAsync("UPDATE SL_LawCases SET CaseSummary=N'changed' WHERE Id=@caseId",new{caseId});
 var stale=await admin.SendAsync(new HttpRequestMessage(HttpMethod.Delete,$"/api/admin/lawyer-archives/{owner}"){Content=JsonContent.Create(new{receipt,saved=true,confirmation="ลบทนายและคดีทั้งหมด"})});Check(stale.StatusCode==HttpStatusCode.Conflict,"Stale backup blocks deletion");
 using var backup=await admin.GetAsync($"/api/admin/lawyer-archives/{owner}/backup");Check(backup.IsSuccessStatusCode,"Fresh backup");var zip=await backup.Content.ReadAsByteArrayAsync();receipt=backup.Headers.GetValues("X-Lawyer-Backup-Receipt").Single();
 var attachmentKey=await db.ExecuteScalarAsync<string>("SELECT StorageKey FROM SL_CaseFileAttachments WHERE Id=@fileId",new{fileId});var personalKey=await db.ExecuteScalarAsync<string>("SELECT StorageKey FROM SL_PersonalDocuments WHERE UserId=@owner",new{owner});
 using(var z=new ZipArchive(new MemoryStream(zip))){using var reader=new StreamReader(z.GetEntry("lawyer-data.json")!.Open());var json=await reader.ReadToEndAsync();Check(!json.Contains("PasswordHash")&&z.GetEntry("files/"+attachmentKey)!=null&&z.GetEntry("files/"+personalKey)!=null,"Archive contains disk-backed files but no password hashes");using var attachment=new MemoryStream();await z.GetEntry("files/"+attachmentKey)!.Open().CopyToAsync(attachment);Check(attachment.ToArray().SequenceEqual(expectedBytes),"Archive attachment bytes match");}
 using var preview=await Upload("/api/admin/lawyer-archives/preview",zip);Check(preview.IsSuccessStatusCode,"Preview signed archive");
 var tampered=zip.ToArray();using(var memory=new MemoryStream()){using(var input=new ZipArchive(new MemoryStream(zip)))using(var output=new ZipArchive(memory,ZipArchiveMode.Create,true)){foreach(var entry in input.Entries){using var from=entry.Open();using var to=output.CreateEntry(entry.FullName).Open();if(entry.FullName=="lawyer-data.json")to.Write(Encoding.UTF8.GetBytes("{}"));else from.CopyTo(to);}}tampered=memory.ToArray();}
 using var bad=await Upload("/api/admin/lawyer-archives/preview",tampered);Check(bad.StatusCode==HttpStatusCode.BadRequest,"Modified archive rejected");
 using var early=await Upload($"/api/admin/lawyer-archives/{targetId}/restore",zip,true);Check(early.StatusCode==HttpStatusCode.BadRequest,"Cannot duplicate live cases");
 await Send(admin,$"/api/admin/lawyer-archives/{owner}",new{receipt,saved=true,confirmation="ลบทนายและคดีทั้งหมด"},HttpMethod.Delete);
 Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Id=@owner",new{owner})==0,"Lawyer deleted");
 Check((await lawyer.GetAsync("/api/auth/me")).StatusCode==HttpStatusCode.Unauthorized,"Deleted lawyer session revoked");
 Check((await client.GetAsync($"/api/client/home?caseId={otherCase}")).IsSuccessStatusCode,"Shared client retains other lawyer case");
 var priorHash=await db.ExecuteScalarAsync<string>("SELECT PasswordHash FROM SL_UserAccounts WHERE Id=@targetId",new{targetId});
 using var restored=await Upload($"/api/admin/lawyer-archives/{targetId}/restore",zip,true);Check(restored.IsSuccessStatusCode,"Restore: "+await restored.Content.ReadAsStringAsync());
 var targetProfile=await db.ExecuteScalarAsync<int>("SELECT LawyerProfileId FROM SL_UserAccounts WHERE Id=@targetId",new{targetId});var restoredCase=await db.ExecuteScalarAsync<int>("SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId=@targetProfile",new{targetProfile});
 Check(restoredCase>0&&restoredCase!=caseId,"Case IDs remapped");
 Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseFileAttachments f JOIN SL_CaseDocuments d ON d.Id=f.DocumentId AND d.CaseId=f.CaseId JOIN SL_AppointmentFiles l ON l.FileId=f.Id JOIN SL_Appointments a ON a.Id=l.AppointmentId AND a.CaseId=f.CaseId JOIN SL_ClientDocuments cd ON cd.FileId=f.Id JOIN SL_CaseParties p ON p.Id=cd.PartyId AND p.CaseId=f.CaseId WHERE f.CaseId=@restoredCase",new{restoredCase})==1,"All linked IDs restored coherently");
 var restoredPersonalKey=await db.ExecuteScalarAsync<string>("SELECT StorageKey FROM SL_PersonalDocuments WHERE UserId=@targetId",new{targetId});
 Check(!string.IsNullOrEmpty(restoredPersonalKey)&&File.ReadAllBytes(Path.Combine("App_Data","Uploads",restoredPersonalKey)).SequenceEqual(expectedBytes),"Personal PDF restored byte-for-byte");
 Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientChat WHERE CaseId=@restoredCase AND ClientUserId=@clientId",new{restoredCase,clientId})==1,"Client conversation restored");
 var state=await db.QuerySingleAsync("SELECT PasswordHash,MaxCasesQuota,UsedCasesCount,PlanName FROM SL_UserAccounts WHERE Id=@targetId",new{targetId});Check(state.PasswordHash==priorHash&&(int)state.MaxCasesQuota==50&&(int)state.UsedCasesCount==7&&(string)state.PlanName=="Renewed","Credentials and renewed quota retained without refunding used credits");
 using var twice=await Upload($"/api/admin/lawyer-archives/{targetId}/restore",zip,true);Check(twice.StatusCode==HttpStatusCode.BadRequest,"Repeat restore rejected");
 Check((await client.GetAsync($"/api/client/home?caseId={restoredCase}")).IsSuccessStatusCode,"Client can access restored case");
 Console.WriteLine("PASS: admin-only, complete signed ZIP, tamper/stale rejection, safe deletion, shared-client isolation, transactional remapped restore, original files, credentials/subscription/credit preservation and duplicate protection.");
}finally{
 var cleanupKeys=(await db.QueryAsync<string>("""
 SELECT StorageKey FROM SL_CaseFileAttachments WHERE StorageKey IS NOT NULL AND CaseId IN
   (SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId IN(SELECT LawyerProfileId FROM SL_UserAccounts WHERE Username LIKE @pattern))
 UNION SELECT StorageKey FROM SL_PersonalDocuments WHERE StorageKey IS NOT NULL AND UserId IN(SELECT Id FROM SL_UserAccounts WHERE Username LIKE @pattern)
 UNION SELECT SlipStorageKey FROM SL_PaymentSlips WHERE SlipStorageKey IS NOT NULL AND UserId IN(SELECT Id FROM SL_UserAccounts WHERE Username LIKE @pattern)
 """,new{pattern=prefix+"%"})).ToArray();
 var uploadDirectory=Path.Combine("App_Data","Uploads");
 foreach(var key in cleanupKeys){if(!SmartLaws.Web.Services.FileStorage.IsValidKey(key))continue;var path=Path.Combine(uploadDirectory,key);if(File.Exists(path))File.Delete(path);}
 await db.ExecuteAsync("""
 SELECT Id,LawyerProfileId,FullName INTO #ArchiveUsers FROM SL_UserAccounts WHERE Username LIKE @pattern OR FullName LIKE @pattern;
 SELECT Id INTO #ArchiveCases FROM SL_LawCases WHERE PrimaryLawyerId IN(SELECT LawyerProfileId FROM #ArchiveUsers WHERE LawyerProfileId>0);
 DELETE FROM SL_ClientChat WHERE CaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_ClientShares WHERE CaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_ClientCaseLinks WHERE CaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_ClientIdentities WHERE UserId IN(SELECT Id FROM #ArchiveUsers);
 DELETE FROM SL_ClientDocuments WHERE CaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_AppointmentFiles WHERE AppointmentId IN(SELECT Id FROM SL_Appointments WHERE CaseId IN(SELECT Id FROM #ArchiveCases));
 DELETE FROM SL_Appointments WHERE CaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_LitigationEvents WHERE CaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_CaseFileAttachments WHERE CaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_CaseDocuments WHERE CaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_CaseParties WHERE CaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_LawCases WHERE Id IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_PersonalDocuments WHERE UserId IN(SELECT Id FROM #ArchiveUsers);
 DELETE FROM SL_Messages WHERE UserId IN(SELECT Id FROM #ArchiveUsers) OR SenderId IN(SELECT Id FROM #ArchiveUsers);
 DELETE FROM SL_LawyerClerkMappings WHERE LawyerUserId IN(SELECT Id FROM #ArchiveUsers);
 DELETE FROM SL_PaymentSlips WHERE UserId IN(SELECT Id FROM #ArchiveUsers);
 DELETE FROM SL_LawyerRestoreCases WHERE TargetCaseId IN(SELECT Id FROM #ArchiveCases);
 DELETE FROM SL_LawyerRestores WHERE TargetUserId IN(SELECT Id FROM #ArchiveUsers);
 DELETE FROM SL_Sessions WHERE UserId IN(SELECT Id FROM #ArchiveUsers);
 DELETE FROM SL_AuditLog WHERE UserId IN(SELECT Id FROM #ArchiveUsers);
 DELETE FROM SL_AuditLog WHERE UserId IN @fixtureUsers;
 DELETE FROM SL_UserAccounts WHERE Id IN(SELECT Id FROM #ArchiveUsers);
 DELETE FROM SL_LawyerProfiles WHERE Id IN(SELECT LawyerProfileId FROM #ArchiveUsers WHERE LawyerProfileId>0);
 DELETE FROM SL_ElectronicSignatures WHERE SignerName LIKE @pattern;
 """,new{pattern=prefix+"%",fixtureUsers=fixtureUsers.ToArray()});
}
